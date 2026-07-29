import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  cryptoPayouts,
  transactions,
  wallets,
} from "../src/db/schema/economy";
import {
  reconcilePayoutDebit,
  refundPayoutAndFail,
  reversePayoutDebit,
  type PayoutLedgerCandidate,
} from "../src/services/economy/crypto/payout-refund";

const PAYOUT_ID = "00000000-0000-4000-8000-000000000001";
const WALLET_ID = "00000000-0000-4000-8000-000000000002";
const DEBIT_ID = "00000000-0000-4000-8000-000000000003";
const DESTINATION = "0x0000000000000000000000000000000000000001";

const payout = {
  id: PAYOUT_ID,
  walletId: WALLET_ID,
  amountBase: "1500000",
  destinationAddress: DESTINATION,
  token: "USDC",
};

function debit(
  overrides: Partial<PayoutLedgerCandidate> = {},
): PayoutLedgerCandidate {
  return {
    id: DEBIT_ID,
    walletId: WALLET_ID,
    type: "payout",
    amount: -173,
    counterparty: DESTINATION,
    metadata: {
      payout_id: PAYOUT_ID,
      amount_base: "1500000",
      token: "USDC",
    },
    ...overrides,
  };
}

interface Mutation {
  operation: "update" | "insert";
  table: unknown;
  values: Record<string, unknown>;
}

function fakeTransaction(
  candidates: readonly PayoutLedgerCandidate[],
  casWins = true,
) {
  const mutations: Mutation[] = [];
  const locks: Array<{ table: unknown; limit: number; mode: string }> = [];
  const tx = {
    select() {
      let selectedTable: unknown;
      let selectedLimit = 0;
      return {
        from(table: unknown) {
          selectedTable = table;
          return this;
        },
        where() {
          return this;
        },
        limit(limit: number) {
          selectedLimit = limit;
          return this;
        },
        async for(mode: string) {
          locks.push({
            table: selectedTable,
            limit: selectedLimit,
            mode,
          });
          return candidates;
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          mutations.push({ operation: "update" as const, table, values });
          return {
            where() {
              if (table === cryptoPayouts) {
                return {
                  returning: async () => (casWins ? [{ id: PAYOUT_ID }] : []),
                };
              }
              return Promise.resolve([]);
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        async values(values: Record<string, unknown>) {
          mutations.push({ operation: "insert" as const, table, values });
        },
      };
    },
  };
  return { tx, mutations, locks };
}

describe("payout debit provenance", () => {
  test("derives the exact refund from one matching negative ledger leg", () => {
    expect(reconcilePayoutDebit(payout, [debit()])).toEqual({
      ok: true,
      debitTransactionId: DEBIT_ID,
      refundMinor: 173,
    });
  });

  test("caller-extensible payout JSON cannot forge or enlarge a refund", () => {
    const payoutWithForgedMetadata = {
      ...payout,
      metadata: {
        debited_minor: Number.MAX_SAFE_INTEGER,
        debit_currency: "GBP",
        gbp_usd_rate: 1,
      },
    };

    expect(reconcilePayoutDebit(payoutWithForgedMetadata, [debit()])).toEqual({
      ok: true,
      debitTransactionId: DEBIT_ID,
      refundMinor: 173,
    });
  });

  test("requires exactly one leg and therefore rejects a prior positive reversal", () => {
    const positive = debit({
      id: "00000000-0000-4000-8000-000000000004",
      amount: 173,
      metadata: {
        payout_id: PAYOUT_ID,
        reverses: "payout",
        original_transaction_id: DEBIT_ID,
      },
    });

    expect(reconcilePayoutDebit(payout, [])).toEqual({
      ok: false,
      reason: "missing_or_duplicate_ledger_leg",
    });
    expect(reconcilePayoutDebit(payout, [debit(), positive])).toEqual({
      ok: false,
      reason: "missing_or_duplicate_ledger_leg",
    });
    expect(reconcilePayoutDebit(payout, [debit(), debit()])).toEqual({
      ok: false,
      reason: "missing_or_duplicate_ledger_leg",
    });
  });

  test("rejects forged wallet, type, destination, payout, amount, or token identity", () => {
    const candidates: PayoutLedgerCandidate[] = [
      debit({ walletId: "00000000-0000-4000-8000-000000000099" }),
      debit({ type: "fund" }),
      debit({ counterparty: "0x0000000000000000000000000000000000000099" }),
      debit({
        metadata: {
          payout_id: "00000000-0000-4000-8000-000000000099",
          amount_base: "1500000",
          token: "USDC",
        },
      }),
      debit({
        metadata: {
          payout_id: PAYOUT_ID,
          amount_base: "1500001",
          token: "USDC",
        },
      }),
      debit({
        metadata: {
          payout_id: PAYOUT_ID,
          amount_base: "1500000",
          token: "USDT",
        },
      }),
    ];

    for (const candidate of candidates) {
      expect(reconcilePayoutDebit(payout, [candidate])).toEqual({
        ok: false,
        reason: "ledger_identity_mismatch",
      });
    }
  });

  test("requires a strictly negative safe-integer debit", () => {
    for (const amount of [0, 173, Number.NaN, Number.NEGATIVE_INFINITY, -1.5]) {
      expect(reconcilePayoutDebit(payout, [debit({ amount })])).toEqual({
        ok: false,
        reason: "invalid_ledger_amount",
      });
    }
  });

  test("the DB lookup narrows and locks the claimed ledger identity", () => {
    const source = readFileSync(
      join(
        __dirname,
        "..",
        "src",
        "services",
        "economy",
        "crypto",
        "payout-refund.ts",
      ),
      "utf8",
    );

    expect(source).toContain('eq(transactions.type, "payout")');
    expect(source).toContain("eq(transactions.walletId, payout.walletId)");
    expect(source).toContain(
      "sql`${transactions.metadata}->>'payout_id' = ${payout.id}`",
    );
    expect(source).toContain('.for("update")');
  });

  test("cancelPayout delegates to ledger reversal and never reads refund metadata", () => {
    const source = readFileSync(
      join(
        __dirname,
        "..",
        "src",
        "services",
        "economy",
        "crypto",
        "index.ts",
      ),
      "utf8",
    );
    const start = source.indexOf("export async function cancelPayout");
    const end = source.indexOf(
      "const SUPPORTED_PAYOUT_TOKENS",
      start,
    );
    const cancelSource = source.slice(start, end);

    expect(cancelSource).toContain("reversePayoutDebit");
    expect(cancelSource).not.toContain("debited_minor");
    expect(cancelSource).not.toContain("CREDITS_PER_USDC");
    expect(cancelSource).not.toContain("payout.metadata");
  });
});

describe("atomic payout reversal", () => {
  test("locks provenance, CASes status, restores exact debit, then writes linked reversal", async () => {
    const { tx, mutations, locks } = fakeTransaction([debit()]);

    await expect(
      refundPayoutAndFail(
        tx as never,
        payout,
        "requested",
        "build_or_sign_failed",
      ),
    ).resolves.toEqual({
      refunded: true,
      refundMinor: 173,
      debitTransactionId: DEBIT_ID,
    });

    expect(locks).toEqual([
      { table: transactions, limit: 2, mode: "update" },
    ]);
    expect(mutations.map(({ operation, table }) => [operation, table])).toEqual([
      ["update", cryptoPayouts],
      ["update", wallets],
      ["insert", transactions],
    ]);
    expect(mutations[2]?.values).toMatchObject({
      walletId: WALLET_ID,
      type: "payout",
      amount: 173,
      counterparty: DESTINATION,
      metadata: {
        payout_id: PAYOUT_ID,
        reverses: "payout",
        original_transaction_id: DEBIT_ID,
      },
    });
  });

  test("a status-CAS loser performs no wallet credit or reversal", async () => {
    const { tx, mutations } = fakeTransaction([debit()], false);

    await expect(
      refundPayoutAndFail(
        tx as never,
        payout,
        "broadcast",
        "tx_reverted_onchain",
      ),
    ).resolves.toEqual({
      refunded: false,
      reason: "status_race_lost",
      terminal: false,
    });
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.table).toBe(cryptoPayouts);
  });

  test("worker terminalizes unreconciled history without moving balance", async () => {
    const { tx, mutations } = fakeTransaction([]);

    await expect(
      refundPayoutAndFail(
        tx as never,
        payout,
        "requested",
        "build_or_sign_failed",
      ),
    ).resolves.toEqual({
      refunded: false,
      reason: "ledger_unreconciled",
      detail: "missing_or_duplicate_ledger_leg",
      terminal: true,
    });
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      operation: "update",
      table: cryptoPayouts,
      values: {
        status: "failed",
        error: "refund_unreconciled",
      },
    });
  });

  test("cancellation leaves unreconciled legacy history open for manual repair", async () => {
    const { tx, mutations } = fakeTransaction([]);

    await expect(
      reversePayoutDebit(tx as never, payout, {
        expectedStatus: "requested",
        terminalStatus: "cancelled",
        terminalError: "cancelled_by_user",
        description: "payout cancelled — original debit reversed",
        terminalizeUnreconciled: false,
      }),
    ).resolves.toEqual({
      refunded: false,
      reason: "ledger_unreconciled",
      detail: "missing_or_duplicate_ledger_leg",
      terminal: false,
    });
    expect(mutations).toEqual([]);
  });
});

describe("worker containment walls", () => {
  test("build/sign failures persist only stable codes", () => {
    const source = readFileSync(
      join(
        __dirname,
        "..",
        "src",
        "workers",
        "payout",
        "broadcast-worker.ts",
      ),
      "utf8",
    );

    expect(source).toContain('"build_or_sign_failed"');
    expect(source).toContain('"worker_pre_submit_failed"');
    expect(source).not.toContain("(err as Error).message");
    expect(source).not.toContain("build_or_sign_failed:");
  });

  test("completed jobs release dedupe id; failed containment stays retained without retry", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "workers", "payout", "queue.ts"),
      "utf8",
    );

    expect(source).toContain("attempts: 1");
    expect(source).toContain("removeOnComplete: true");
    expect(source).toMatch(/removeOnFail:\s*\{\s*age:/);
  });
});
