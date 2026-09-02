import { describe, expect, test } from "bun:test";

import {
  SCHEMAS,
  appendLedgerTransaction,
  validateLedgerTransaction,
  type LedgerPosting,
  type LedgerTransaction,
} from "../src/index.js";
import { BASE_USDC, GBP, PROJECT_CREDIT, makeAccounts, makeUnits, price } from "./fixtures.js";

function posting(
  postingId: string,
  accountId: string,
  domain: string,
  unitId: string,
  side: "DEBIT" | "CREDIT",
  value: string,
): LedgerPosting {
  return {
    posting_id: postingId,
    account_id: accountId,
    ledger_domain: domain,
    unit_id: unitId,
    side,
    amount_atomic: value,
  };
}

function transaction(overrides: Partial<LedgerTransaction> = {}): LedgerTransaction {
  return {
    schema: SCHEMAS.ledgerTransaction,
    transaction_id: "transaction:gbp-1",
    idempotency_key: "ledger-key:gbp-1",
    request_fingerprint: "sha256:ledger-request-1",
    causation_ref: "cause:order-1",
    recorded_at: "2026-09-02T00:00:01.000Z",
    postings: [
      posting("posting:gbp-1-debit", "account:gbp-user", "ledger:gbp", GBP, "DEBIT", "125"),
      posting("posting:gbp-1-credit", "account:gbp-clearing", "ledger:gbp", GBP, "CREDIT", "125"),
    ],
    evidence_refs: ["evidence:gbp-1"],
    conversion_refs: [],
    price_revision_id: null,
    reverses_transaction_id: null,
    ...overrides,
  };
}

describe("conserved per-unit ledger", () => {
  test("balances debits and credits independently", () => {
    const units = makeUnits();
    const validated = validateLedgerTransaction(transaction(), makeAccounts(units));
    expect(validated.balances).toEqual([{
      ledger_domain: "ledger:gbp",
      unit_id: GBP,
      debit_atomic: "125",
      credit_atomic: "125",
      posting_count: 2,
    }]);
  });

  test("requires independently balanced legs plus conversion evidence for multiple units", () => {
    const units = makeUnits();
    const multi = transaction({
      transaction_id: "transaction:conversion-1",
      idempotency_key: "ledger-key:conversion-1",
      request_fingerprint: "sha256:conversion-request-1",
      postings: [
        posting("posting:usdc-debit", "account:usdc-user", "ledger:base-usdc", BASE_USDC, "DEBIT", "1000"),
        posting("posting:usdc-credit", "account:usdc-clearing", "ledger:base-usdc", BASE_USDC, "CREDIT", "1000"),
        posting("posting:credit-debit", "account:project-issuer", "ledger:project-credit", PROJECT_CREDIT, "DEBIT", "1"),
        posting("posting:credit-credit", "account:project-user", "ledger:project-credit", PROJECT_CREDIT, "CREDIT", "1"),
      ],
      evidence_refs: ["evidence:settlement-1"],
      conversion_refs: ["conversion:quote-1"],
      price_revision_id: price().price_revision_id,
    });
    expect(validateLedgerTransaction(multi, makeAccounts(units)).balances).toHaveLength(2);
    expect(() => validateLedgerTransaction({ ...multi, conversion_refs: [] }, makeAccounts(units))).toThrow();
  });

  test("does not let different units cancel one another", () => {
    const units = makeUnits();
    const globallyEqual = transaction({
      transaction_id: "transaction:bad-cross-unit",
      idempotency_key: "ledger-key:bad-cross-unit",
      postings: [
        posting("posting:bad-usdc-debit", "account:usdc-user", "ledger:base-usdc", BASE_USDC, "DEBIT", "1000"),
        posting("posting:bad-usdc-credit", "account:usdc-clearing", "ledger:base-usdc", BASE_USDC, "CREDIT", "999"),
        posting("posting:bad-credit-debit", "account:project-issuer", "ledger:project-credit", PROJECT_CREDIT, "DEBIT", "1"),
        posting("posting:bad-credit-credit", "account:project-user", "ledger:project-credit", PROJECT_CREDIT, "CREDIT", "2"),
      ],
      conversion_refs: ["conversion:bad-1"],
      price_revision_id: price().price_revision_id,
    });
    expect(() => validateLedgerTransaction(globallyEqual, makeAccounts(units))).toThrow();
  });

  test("binds posting unit and domain to an account registry", () => {
    const units = makeUnits();
    const bad = transaction({ postings: [
      posting("posting:bad-unit-debit", "account:gbp-user", "ledger:base-usdc", BASE_USDC, "DEBIT", "1"),
      posting("posting:bad-unit-credit", "account:gbp-clearing", "ledger:base-usdc", BASE_USDC, "CREDIT", "1"),
    ] });
    expect(() => validateLedgerTransaction(bad, makeAccounts(units))).toThrow();
  });

  test("replays exact idempotent entries and rejects semantic conflicts", () => {
    const units = makeUnits();
    const accounts = makeAccounts(units);
    const first = appendLedgerTransaction([], transaction(), accounts);
    const reordered = {
      reverses_transaction_id: null,
      price_revision_id: null,
      conversion_refs: [],
      evidence_refs: ["evidence:gbp-1"],
      postings: transaction().postings,
      causation_ref: "cause:order-1",
      recorded_at: "2026-09-02T00:00:01.000Z",
      request_fingerprint: "sha256:ledger-request-1",
      idempotency_key: "ledger-key:gbp-1",
      transaction_id: "transaction:gbp-1",
      schema: SCHEMAS.ledgerTransaction,
    };
    expect(appendLedgerTransaction(first.journal, reordered, accounts).disposition).toBe("REPLAYED");
    expect(() => appendLedgerTransaction(first.journal, transaction({
      postings: [
        posting("posting:gbp-2-debit", "account:gbp-user", "ledger:gbp", GBP, "DEBIT", "126"),
        posting("posting:gbp-2-credit", "account:gbp-clearing", "ledger:gbp", GBP, "CREDIT", "126"),
      ],
    }), accounts)).toThrow();
    expect(() => appendLedgerTransaction(first.journal, transaction({
      transaction_id: "transaction:same-request-new-id",
      idempotency_key: "ledger-key:same-request-new-key",
      postings: [
        posting("posting:same-request-debit", "account:gbp-user", "ledger:gbp", GBP, "DEBIT", "125"),
        posting("posting:same-request-credit", "account:gbp-clearing", "ledger:gbp", GBP, "CREDIT", "125"),
      ],
    }), accounts)).toThrow();
  });

  test("repairs by one exact compensating reversal, never mutation", () => {
    const units = makeUnits();
    const accounts = makeAccounts(units);
    const first = appendLedgerTransaction([], transaction(), accounts);
    const reversal = transaction({
      transaction_id: "transaction:gbp-reversal-1",
      idempotency_key: "ledger-key:gbp-reversal-1",
      request_fingerprint: "sha256:ledger-reversal-1",
      causation_ref: "cause:repair-1",
      reverses_transaction_id: "transaction:gbp-1",
      postings: [
        posting("posting:gbp-reverse-credit", "account:gbp-user", "ledger:gbp", GBP, "CREDIT", "125"),
        posting("posting:gbp-reverse-debit", "account:gbp-clearing", "ledger:gbp", GBP, "DEBIT", "125"),
      ],
    });
    const repaired = appendLedgerTransaction(first.journal, reversal, accounts);
    expect(repaired.journal).toHaveLength(2);
    expect(first.journal[0]?.postings[0]?.side).toBe("DEBIT");
    expect(() => appendLedgerTransaction(repaired.journal, {
      ...reversal,
      transaction_id: "transaction:gbp-reversal-2",
      idempotency_key: "ledger-key:gbp-reversal-2",
      request_fingerprint: "sha256:ledger-reversal-2",
    }, accounts)).toThrow();
  });

  test("rejects forged invariants already present in a supplied journal", () => {
    const units = makeUnits();
    const accounts = makeAccounts(units);
    const original = transaction();
    const forgedReversal = transaction({
      transaction_id: "transaction:forged-reversal",
      idempotency_key: "ledger-key:forged-reversal",
      request_fingerprint: "sha256:forged-reversal",
      causation_ref: "cause:forged-reversal",
      recorded_at: "2026-09-02T00:00:02.000Z",
      reverses_transaction_id: original.transaction_id,
    });
    const unrelated = transaction({
      transaction_id: "transaction:unrelated",
      idempotency_key: "ledger-key:unrelated",
      request_fingerprint: "sha256:unrelated",
      recorded_at: "2026-09-02T00:00:03.000Z",
    });
    expect(() => appendLedgerTransaction([original, forgedReversal], unrelated, accounts)).toThrow();
    expect(() => appendLedgerTransaction([original, {
      ...original,
      transaction_id: "transaction:duplicate-key",
    }], unrelated, accounts)).toThrow();
    expect(() => appendLedgerTransaction([unrelated, original], transaction({
      transaction_id: "transaction:after-backwards-time",
      idempotency_key: "ledger-key:after-backwards-time",
      request_fingerprint: "sha256:after-backwards-time",
      recorded_at: "2026-09-02T00:00:04.000Z",
    }), accounts)).toThrow();
  });
});
