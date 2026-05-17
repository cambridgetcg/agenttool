/** Substrate-honest billing — ledger discipline across all settlement paths.
 *
 *  Doctrine: docs/BUSINESS-MODEL.md §225 — *"An agent can see its own
 *  ledger, refuse modes that would charge it, and audit every line."*
 *
 *  Every wallet move (debit on escrow_lock, credit on escrow_release,
 *  credit on escrow_refund) MUST land a row in `economy.transactions`.
 *  If the wallet balance changes but no transactions row exists, the
 *  agent's `/v1/wallets/:id/transactions` ledger LIES BY OMISSION.
 *
 *  This was a real bug 2026-05-17: substrate-tasks and memory-witness
 *  did `update(wallets).set({balance: ...})` inline without inserting
 *  transactions rows. The chronicle reflected the work, but the wallet
 *  ledger silently desynced from reality.
 *
 *  Fix: structural pin. Every settlement service that updates wallets
 *  must also import `transactions` and call `tx.insert(transactions)`.
 *  This test grep-checks the discipline. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FILES_THAT_MOVE_WALLETS = [
  "src/services/substrate-tasks/lifecycle.ts",
  "src/services/marketplace/memory-witness.ts",
  "src/services/marketplace/purchases.ts",
  "src/services/marketplace/attestations.ts",
  "src/services/economy/wallets.ts",
  "src/services/economy/escrow.ts",
  "src/services/bootstrap/elevate.ts",
];

describe("substrate-honest billing — every wallet-moving service writes transactions", () => {
  for (const relPath of FILES_THAT_MOVE_WALLETS) {
    const fullPath = join(__dirname, "..", "..", relPath);

    test(`${relPath} imports transactions table`, () => {
      const source = readFileSync(fullPath, "utf8");
      // Detection is intentionally loose — the import path may be relative
      // (../../db/schema/economy) or aliased. What matters: the file
      // references the `transactions` symbol AND imports from the economy
      // schema module.
      const hasTransactionsSymbol = /\btransactions\b/.test(source);
      const importsEconomySchema = /db\/schema\/economy/.test(source);
      expect(
        hasTransactionsSymbol && importsEconomySchema,
        `${relPath} updates wallets but does not appear to import the transactions table — wallet ledger will silently desync from reality. Add transactions to the schema import.`,
      ).toBe(true);
    });

    test(`${relPath} writes transactions rows (insert(transactions))`, () => {
      const source = readFileSync(fullPath, "utf8");
      expect(
        /\.insert\(transactions\)/.test(source),
        `${relPath} updates wallets but never calls tx.insert(transactions). Every wallet move must land a ledger row. Doctrine: docs/BUSINESS-MODEL.md §225.`,
      ).toBe(true);
    });
  }
});

describe("substrate-honest billing — transaction types are coherent", () => {
  test("substrate-tasks uses escrow_lock / escrow_release / escrow_refund types", () => {
    const source = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "src",
        "services",
        "substrate-tasks",
        "lifecycle.ts",
      ),
      "utf8",
    );
    expect(source).toContain('type: "escrow_lock"');
    expect(source).toContain('type: "escrow_release"');
    expect(source).toContain('type: "escrow_refund"');
  });

  test("memory-witness uses escrow_lock / escrow_release / escrow_refund types", () => {
    const source = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "src",
        "services",
        "marketplace",
        "memory-witness.ts",
      ),
      "utf8",
    );
    expect(source).toContain('type: "escrow_lock"');
    expect(source).toContain('type: "escrow_release"');
    expect(source).toContain('type: "escrow_refund"');
  });

  test("platform-treasurer sweep uses settle type", () => {
    const source = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "src",
        "workers",
        "platform-treasurer",
        "sweep.ts",
      ),
      "utf8",
    );
    expect(source).toContain('type: "settle"');
  });
});
