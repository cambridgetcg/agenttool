import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  cryptoPayouts,
  transactions,
  wallets,
} from "../src/db/schema/economy";
import {
  payoutRefundPlan,
  refundPayoutAndFail,
} from "../src/workers/payout/refund";

const payoutRow = (
  metadata: Record<string, unknown>,
  amountBase = "1000000",
) => ({
  id: "00000000-0000-4000-8000-000000000001",
  walletId: "00000000-0000-4000-8000-000000000002",
  amountBase,
  destinationAddress: "0x0000000000000000000000000000000000000001",
  metadata,
});

interface Mutation {
  operation: "update" | "insert";
  table: unknown;
  values: Record<string, unknown>;
}

function fakeTransaction(casWins: boolean) {
  const mutations: Mutation[] = [];
  const tx = {
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          mutations.push({ operation: "update" as const, table, values });
          return {
            where() {
              if (table === cryptoPayouts) {
                return {
                  returning: async () =>
                    casWins ? [{ id: payoutRow({}).id }] : [],
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
  return { tx, mutations };
}

describe("payout failure refund integrity", () => {
  test("uses exact server-authored debited_minor, not current USDC conversion", () => {
    const plan = payoutRefundPlan(
      payoutRow(
        {
          debited_minor: 173,
          debit_currency: "GBP",
          gbp_usd_rate: 1.37,
        },
        "999999999999",
      ),
    );

    expect(plan).toEqual({
      refundMinor: 173,
      reverseLedger: true,
      source: "debited_minor",
    });
  });

  test("ignores unmarked debited_minor and matches cancelPayout legacy fallback", () => {
    const plan = payoutRefundPlan(
      payoutRow({ debited_minor: 999_999_999 }, "1500000"),
    );

    expect(plan).toEqual({
      refundMinor: 150,
      reverseLedger: false,
      source: "legacy_amount_base",
    });
  });

  test("fails closed on malformed marked debit provenance", () => {
    expect(() =>
      payoutRefundPlan(
        payoutRow({
          debited_minor: "500",
          debit_currency: "GBP",
          gbp_usd_rate: 1.25,
        }),
      ),
    ).toThrow("invalid_server_authored_debited_minor");
  });

  test("CAS winner restores exact debit and writes its positive ledger reversal", async () => {
    const { tx, mutations } = fakeTransaction(true);
    const row = payoutRow({
      debited_minor: 173,
      debit_currency: "GBP",
      gbp_usd_rate: 1.37,
    });

    await expect(
      refundPayoutAndFail(
        tx as never,
        row,
        "requested",
        "build_or_sign_failed",
      ),
    ).resolves.toEqual({
      refunded: true,
      refundMinor: 173,
      source: "debited_minor",
    });

    expect(mutations.map(({ operation, table }) => [operation, table])).toEqual([
      ["update", cryptoPayouts],
      ["update", wallets],
      ["insert", transactions],
    ]);
    expect(mutations[2]?.values).toMatchObject({
      walletId: row.walletId,
      type: "payout",
      amount: 173,
      counterparty: row.destinationAddress,
      metadata: {
        payout_id: row.id,
        reverses: "payout",
      },
    });
  });

  test("CAS loser performs no wallet credit or ledger reversal", async () => {
    const { tx, mutations } = fakeTransaction(false);
    const row = payoutRow({
      debited_minor: 173,
      debit_currency: "GBP",
      gbp_usd_rate: 1.37,
    });

    await expect(
      refundPayoutAndFail(
        tx as never,
        row,
        "broadcast",
        "tx_reverted_onchain",
      ),
    ).resolves.toEqual({
      refunded: false,
      reason: "status_race_lost",
    });

    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.table).toBe(cryptoPayouts);
  });

  test("legacy row restores fallback but does not invent a ledger reversal", async () => {
    const { tx, mutations } = fakeTransaction(true);

    await expect(
      refundPayoutAndFail(
        tx as never,
        payoutRow({}, "1500000"),
        "broadcast",
        "tx_reverted_onchain",
      ),
    ).resolves.toMatchObject({
      refunded: true,
      refundMinor: 150,
      source: "legacy_amount_base",
    });

    expect(mutations.map(({ table }) => table)).toEqual([
      cryptoPayouts,
      wallets,
    ]);
  });

  test("both worker failure sites use the helper; submit ambiguity stays sticky", () => {
    const workerDir = join(
      __dirname,
      "..",
      "src",
      "workers",
      "payout",
    );
    const broadcast = readFileSync(
      join(workerDir, "broadcast-worker.ts"),
      "utf8",
    );
    const confirm = readFileSync(join(workerDir, "confirm-worker.ts"), "utf8");

    expect(broadcast.match(/refundPayoutAndFail\(/g)).toHaveLength(2);
    expect(confirm.match(/refundPayoutAndFail\(/g)).toHaveLength(1);
    expect(broadcast).not.toContain("creditsForAmount");
    expect(confirm).not.toContain("creditsForAmount");

    const submitMarker = "// ── Phase 2: submit";
    const solanaMarker =
      "// ── Solana branch ───────────────────────────────────────────────────────";
    const evmSubmit = broadcast.slice(
      broadcast.indexOf(submitMarker),
      broadcast.indexOf(solanaMarker),
    );
    const solanaSubmit = broadcast.slice(
      broadcast.indexOf(submitMarker, broadcast.indexOf(solanaMarker)),
    );
    for (const submitPhase of [evmSubmit, solanaSubmit]) {
      expect(submitPhase).toContain("resolveSubmitError");
      expect(submitPhase).not.toContain("refundPayoutAndFail");
      expect(submitPhase).not.toContain('status: "failed"');
    }
  });
});
