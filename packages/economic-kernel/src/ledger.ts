import { LIMITS, SCHEMAS } from "./constants.js";
import { fail } from "./errors.js";
import {
  compareText,
  deepFreeze,
  enumValue,
  exactKeys,
  identifier,
  positiveDecimal,
  record,
  reference,
  sameJson,
  snapshotJson,
  sortedUniqueReferences,
  timestamp,
} from "./internal.js";
import type {
  LedgerAccount,
  LedgerAccountKind,
  LedgerAppendResult,
  LedgerBalance,
  LedgerPosting,
  LedgerTransaction,
} from "./types.js";
import { UnitRegistry } from "./units.js";

const ACCOUNT_KINDS: readonly LedgerAccountKind[] = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];
const SIDES = ["DEBIT", "CREDIT"] as const;

export function validateLedgerAccount(
  value: unknown,
  units: UnitRegistry,
): Readonly<LedgerAccount> {
  const item = record(value, "ledger_account");
  exactKeys(item, ["account_id", "account_kind", "ledger_domain", "schema", "unit_id"], "ledger_account");
  if (item.schema !== SCHEMAS.ledgerAccount) {
    fail("INVALID_RECORD", "ledger_account.schema is unsupported.", "ledger_account.schema");
  }
  identifier(item.account_id, "ledger_account.account_id");
  const domain = identifier(item.ledger_domain, "ledger_account.ledger_domain");
  if (typeof item.unit_id !== "string") fail("INVALID_UNIT", "ledger_account.unit_id must be a string.", "ledger_account.unit_id");
  const unit = units.get(item.unit_id);
  if (unit.ledger_domain !== domain) {
    fail("UNIT_MISMATCH", "Ledger account domain must match its unit definition.", "ledger_account.ledger_domain");
  }
  enumValue(item.account_kind, ACCOUNT_KINDS, "ledger_account.account_kind");
  return deepFreeze(item as unknown as LedgerAccount);
}

export class LedgerAccountRegistry {
  readonly #accounts: ReadonlyMap<string, Readonly<LedgerAccount>>;
  readonly #snapshot: readonly Readonly<LedgerAccount>[];

  constructor(values: unknown, units: UnitRegistry) {
    const snapshot = snapshotJson(values);
    if (!Array.isArray(snapshot) || snapshot.length < 2 || snapshot.length > LIMITS.maxArrayItems) {
      fail("INVALID_RECORD", "Ledger account registry must contain 2..256 accounts.", "ledger_accounts");
    }
    const accounts = snapshot.map((value) => validateLedgerAccount(value, units));
    const map = new Map<string, Readonly<LedgerAccount>>();
    for (const account of accounts) {
      if (map.has(account.account_id)) {
        fail("INVALID_RECORD", `Duplicate ledger account ${account.account_id}.`, "ledger_accounts");
      }
      map.set(account.account_id, account);
    }
    this.#accounts = map;
    this.#snapshot = deepFreeze([...accounts].sort((left, right) => compareText(left.account_id, right.account_id)));
    Object.freeze(this);
  }

  get(accountId: string): Readonly<LedgerAccount> {
    identifier(accountId, "account_id");
    const account = this.#accounts.get(accountId);
    if (!account) fail("INVALID_RECORD", `Unknown ledger account ${accountId}.`, "account_id");
    return account;
  }

  list(): readonly Readonly<LedgerAccount>[] {
    return this.#snapshot;
  }
}

function posting(
  value: unknown,
  index: number,
  accounts: LedgerAccountRegistry,
): Readonly<LedgerPosting> {
  const label = `ledger_transaction.postings[${String(index)}]`;
  const item = record(value, label);
  exactKeys(item, [
    "account_id",
    "amount_atomic",
    "ledger_domain",
    "posting_id",
    "side",
    "unit_id",
  ], label);
  identifier(item.posting_id, `${label}.posting_id`);
  if (typeof item.account_id !== "string") fail("INVALID_RECORD", `${label}.account_id must be a string.`, `${label}.account_id`);
  const account = accounts.get(item.account_id);
  if (item.ledger_domain !== account.ledger_domain || item.unit_id !== account.unit_id) {
    fail("UNIT_MISMATCH", "Posting unit and domain must match the target account.", label);
  }
  enumValue(item.side, SIDES, `${label}.side`);
  positiveDecimal(item.amount_atomic, `${label}.amount_atomic`);
  return deepFreeze(item as unknown as LedgerPosting);
}

export function validateLedgerTransaction(
  value: unknown,
  accounts: LedgerAccountRegistry,
): Readonly<{ transaction: LedgerTransaction; balances: readonly LedgerBalance[] }> {
  const item = record(value, "ledger_transaction");
  exactKeys(item, [
    "causation_ref",
    "conversion_refs",
    "evidence_refs",
    "idempotency_key",
    "postings",
    "price_revision_id",
    "recorded_at",
    "request_fingerprint",
    "reverses_transaction_id",
    "schema",
    "transaction_id",
  ], "ledger_transaction");
  if (item.schema !== SCHEMAS.ledgerTransaction) {
    fail("INVALID_RECORD", "ledger_transaction.schema is unsupported.", "ledger_transaction.schema");
  }
  identifier(item.transaction_id, "ledger_transaction.transaction_id");
  identifier(item.idempotency_key, "ledger_transaction.idempotency_key");
  reference(item.request_fingerprint, "ledger_transaction.request_fingerprint");
  reference(item.causation_ref, "ledger_transaction.causation_ref");
  timestamp(item.recorded_at, "ledger_transaction.recorded_at");
  sortedUniqueReferences(item.evidence_refs, "ledger_transaction.evidence_refs");
  const conversionRefs = sortedUniqueReferences(item.conversion_refs, "ledger_transaction.conversion_refs");
  if (item.price_revision_id !== null) {
    const priceId = identifier(item.price_revision_id, "ledger_transaction.price_revision_id");
    if (!/^sha256:[0-9a-f]{64}$/u.test(priceId)) {
      fail("INVALID_RECORD", "Ledger price revision must be content-derived.", "ledger_transaction.price_revision_id");
    }
  }
  if (item.reverses_transaction_id !== null) {
    identifier(item.reverses_transaction_id, "ledger_transaction.reverses_transaction_id");
    if (item.reverses_transaction_id === item.transaction_id) {
      fail("INVALID_RECORD", "A transaction cannot reverse itself.", "ledger_transaction.reverses_transaction_id");
    }
  }
  if (!Array.isArray(item.postings) || item.postings.length < 2 || item.postings.length > LIMITS.maxPostings) {
    fail("INVALID_RECORD", "Ledger transaction must contain 2..256 postings.", "ledger_transaction.postings");
  }
  const postings = item.postings.map((value, index) => posting(value, index, accounts));
  const postingIds = new Set<string>();
  const accountSides = new Map<string, string>();
  const totals = new Map<string, { debit: bigint; credit: bigint; count: number; accounts: Set<string> }>();
  for (const entry of postings) {
    if (postingIds.has(entry.posting_id)) {
      fail("INVALID_RECORD", `Duplicate posting id ${entry.posting_id}.`, "ledger_transaction.postings");
    }
    postingIds.add(entry.posting_id);
    const priorSide = accountSides.get(entry.account_id);
    if (priorSide && priorSide !== entry.side) {
      fail("UNBALANCED_LEDGER", "One account cannot appear on both sides of one transaction.", "ledger_transaction.postings");
    }
    accountSides.set(entry.account_id, entry.side);
    const key = `${entry.ledger_domain}\u0000${entry.unit_id}`;
    const total = totals.get(key) ?? { debit: 0n, credit: 0n, count: 0, accounts: new Set<string>() };
    const amount = BigInt(entry.amount_atomic);
    if (entry.side === "DEBIT") total.debit += amount;
    else total.credit += amount;
    total.count += 1;
    total.accounts.add(entry.account_id);
    totals.set(key, total);
  }
  const balances: LedgerBalance[] = [];
  for (const [key, total] of [...totals.entries()].sort(([left], [right]) => compareText(left, right))) {
    if (total.debit !== total.credit || total.accounts.size < 2) {
      fail("UNBALANCED_LEDGER", "Debits and credits must balance independently per ledger domain and unit.", "ledger_transaction.postings");
    }
    const separator = key.indexOf("\u0000");
    balances.push({
      ledger_domain: key.slice(0, separator),
      unit_id: key.slice(separator + 1),
      debit_atomic: total.debit.toString(),
      credit_atomic: total.credit.toString(),
      posting_count: total.count,
    });
  }
  if (totals.size > 1 && (conversionRefs.length === 0 || item.price_revision_id === null)) {
    fail(
      "INVALID_RECORD",
      "A multi-unit transaction must pin its price revision and sorted conversion evidence.",
      "ledger_transaction.conversion_refs",
    );
  }
  const transaction = deepFreeze({ ...item, conversion_refs: conversionRefs, postings } as unknown as LedgerTransaction);
  return deepFreeze({ transaction, balances });
}

function exactInverse(left: LedgerTransaction, right: LedgerTransaction): boolean {
  if (left.postings.length !== right.postings.length) return false;
  const normalize = (transaction: LedgerTransaction) => transaction.postings.map((posting) => ({
    account_id: posting.account_id,
    amount_atomic: posting.amount_atomic,
    ledger_domain: posting.ledger_domain,
    side: posting.side,
    unit_id: posting.unit_id,
  })).sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));
  const expected = normalize(left).map((posting) => ({
    ...posting,
    side: posting.side === "DEBIT" ? "CREDIT" : "DEBIT",
  })).sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));
  return JSON.stringify(expected) === JSON.stringify(normalize(right));
}

export function validateLedgerJournal(
  value: unknown,
  accounts: LedgerAccountRegistry,
): readonly Readonly<LedgerTransaction>[] {
  const snapshot = snapshotJson(value);
  if (!Array.isArray(snapshot) || snapshot.length > LIMITS.maxArrayItems) {
    fail("LIMIT_EXCEEDED", "Ledger journal exceeds the bounded v0.1 history.", "journal");
  }
  const journal = snapshot.map((entry) => validateLedgerTransaction(entry, accounts).transaction);
  const byTransactionId = new Map<string, Readonly<LedgerTransaction>>();
  const idempotencyKeys = new Set<string>();
  const requestFingerprints = new Set<string>();
  const reversedTargets = new Set<string>();
  let previousRecordedAt: string | null = null;
  for (const [index, transaction] of journal.entries()) {
    if (previousRecordedAt !== null && Date.parse(transaction.recorded_at) < Date.parse(previousRecordedAt)) {
      fail("INVALID_RECORD", "Ledger journal time cannot move backwards.", `journal[${String(index)}].recorded_at`);
    }
    if (byTransactionId.has(transaction.transaction_id)) {
      fail("IDEMPOTENCY_CONFLICT", "Persisted journal contains a duplicate transaction id.", `journal[${String(index)}].transaction_id`);
    }
    if (idempotencyKeys.has(transaction.idempotency_key)) {
      fail("IDEMPOTENCY_CONFLICT", "Persisted journal contains a duplicate idempotency key.", `journal[${String(index)}].idempotency_key`);
    }
    if (requestFingerprints.has(transaction.request_fingerprint)) {
      fail(
        "IDEMPOTENCY_CONFLICT",
        "Persisted journal contains the same semantic request under another transaction.",
        `journal[${String(index)}].request_fingerprint`,
      );
    }
    if (transaction.reverses_transaction_id !== null) {
      const original = byTransactionId.get(transaction.reverses_transaction_id);
      if (!original) {
        fail("INVALID_RECORD", "Reversal must target an earlier transaction in the same journal.", `journal[${String(index)}].reverses_transaction_id`);
      }
      if (reversedTargets.has(original.transaction_id)) {
        fail("IDEMPOTENCY_CONFLICT", "A persisted transaction may be reversed only once.", `journal[${String(index)}].reverses_transaction_id`);
      }
      if (
        transaction.price_revision_id !== original.price_revision_id
        || !sameJson(transaction.conversion_refs, original.conversion_refs)
        || !exactInverse(original, transaction)
      ) {
        fail(
          "UNBALANCED_LEDGER",
          "A reversal must exactly compensate its earlier transaction under the same conversion evidence.",
          `journal[${String(index)}].postings`,
        );
      }
      reversedTargets.add(original.transaction_id);
    }
    byTransactionId.set(transaction.transaction_id, transaction);
    idempotencyKeys.add(transaction.idempotency_key);
    requestFingerprints.add(transaction.request_fingerprint);
    previousRecordedAt = transaction.recorded_at;
  }
  return deepFreeze(journal);
}

export function appendLedgerTransaction(
  journalValue: unknown,
  transactionValue: unknown,
  accounts: LedgerAccountRegistry,
): Readonly<LedgerAppendResult> {
  const journal = validateLedgerJournal(journalValue, accounts);
  const transaction = validateLedgerTransaction(transactionValue, accounts).transaction;
  const idempotent = journal.find((entry) => entry.idempotency_key === transaction.idempotency_key);
  if (idempotent) {
    if (idempotent.request_fingerprint !== transaction.request_fingerprint || !sameJson(idempotent, transaction)) {
      fail("IDEMPOTENCY_CONFLICT", "Ledger idempotency key was reused with different semantics.", "ledger_transaction.idempotency_key");
    }
    return deepFreeze({ disposition: "REPLAYED", journal, transaction: idempotent });
  }
  const next = validateLedgerJournal([...journal, transaction], accounts);
  return deepFreeze({ disposition: "APPENDED", journal: next, transaction: next[next.length - 1]! });
}
