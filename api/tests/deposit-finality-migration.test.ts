import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../migrations/20260726T202500_crypto_deposit_finality.sql",
    import.meta.url,
  ),
  "utf8",
);
const remainderMigration = readFileSync(
  new URL(
    "../migrations/20260824T132712_crypto_deposit_remainder_accounting.sql",
    import.meta.url,
  ),
  "utf8",
);
const schema = readFileSync(
  new URL("../src/db/schema/economy.ts", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL(
    "../src/services/economy/crypto/inbound-deposits.ts",
    import.meta.url,
  ),
  "utf8",
);
const worker = readFileSync(
  new URL("../src/workers/deposit/confirm-worker.ts", import.meta.url),
  "utf8",
);
const walletService = readFileSync(
  new URL("../src/services/economy/wallets.ts", import.meta.url),
  "utf8",
);

describe("crypto deposit finality migration", () => {
  test("preserves historical balance effects without inventing evidence", () => {
    expect(migration).toContain("SET status = 'credited'");
    expect(migration).toContain("WHERE status IS NULL");
    expect(migration).not.toMatch(/^\s*(?:DELETE|TRUNCATE)\b/im);
    expect(migration).not.toMatch(/SET block_hash|SET block_number/i);
    expect(migration).toContain("ALTER COLUMN status SET DEFAULT 'credited'");
    expect(migration).not.toContain(
      "ALTER COLUMN status SET DEFAULT 'pending'",
    );
  });

  test("stores immutable live and removed observations by block generation", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("crypto_webhook_event_observations");
      expect(source).toContain("uq_crypto_event_observation_generation");
      expect(source).toMatch(/event[_A-Za-z.]*[\s\S]*block[_A-Za-z.]*[\s\S]*removed/i);
      expect(source).toMatch(/amount[_A-Za-z.]*[\s\S]*to[_A-Za-z.]*[\s\S]*contract/i);
    }
  });

  test("keeps quarantine as a durable state and fences wallet effects", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("quarantined");
    }
    expect(service).toContain('reason: "stale_removed_generation"');
    expect(service).toContain("classifyRemovedGeneration(event, transfer)");
    expect(service).toContain(
      "pendingDepositSnapshotMatches(current, expected)",
    );
    expect(service).toContain(
      "current.observationGeneration === expected.observationGeneration",
    );
    expect(service).toContain("current.blockHash === expected.blockHash");
    expect(service).toContain("NOT EXISTS (");
    expect(service).not.toContain("MAX_REORG_CANDIDATES");
    expect(service.indexOf("const [transitioned]")).toBeLessThan(
      service.indexOf("balance: sql`balance -"),
    );
  });

  test("binds canonical RPC identity and aggregate exact-balance limits", () => {
    expect(worker).toContain("getChainId");
    expect(worker).toContain("activeChainId");
    expect(worker).toContain("receipt.transactionHash");
    expect(worker).toContain("canonicalBlockHash");
    expect(worker).toContain("retryCount: 0");
    expect(service).toContain("MAX_EXACT_WALLET_BALANCE - credits");
    expect(service).toContain('error: "wallet_balance_exact_limit"');
    for (const source of [migration, schema]) {
      expect(source).toContain("wallets_balance_exact_integer_check");
    }
    expect(walletService).toContain("Number.isSafeInteger(amount)");
    expect(walletService).toContain(
      "wallet.balance > MAX_EXACT_WALLET_BALANCE - amount",
    );
  });

  test("derives durable atomic remainders without inventing missing evidence", () => {
    expect(remainderMigration).toContain(
      "ADD COLUMN IF NOT EXISTS credit_remainder_base NUMERIC(78, 0)",
    );
    expect(remainderMigration).toContain(
      "credit_remainder_base = MOD(amount_base, 10000)",
    );
    expect(remainderMigration).toContain(
      "ALTER COLUMN credit_remainder_base DROP DEFAULT",
    );
    expect(remainderMigration).toContain("amount_base IS NOT NULL");
    expect(remainderMigration).not.toMatch(
      /credit_remainder_base\s+NUMERIC\([^)]*\)\s+(?:NOT NULL\s+)?DEFAULT\s+0/i,
    );
    expect(remainderMigration).toContain(
      "idx_crypto_event_credit_remainder",
    );
    for (const constraint of [
      "crypto_webhook_events_credit_remainder_range_check",
      "crypto_webhook_events_credit_remainder_exact_check",
      "crypto_webhook_events_nonintegral_not_creditable_check",
      "crypto_webhook_events_remainder_quarantine_check",
    ]) {
      expect(remainderMigration).toContain(constraint);
      expect(schema).toContain(constraint);
    }
  });

  test("quarantines legacy floor effects without erasing reorg evidence", () => {
    expect(remainderMigration).toContain("status IN ('pending', 'credited')");
    expect(remainderMigration).toContain(
      "error = 'non_integral_credit_amount'",
    );
    expect(remainderMigration).not.toMatch(/SET\s+credits_added\s*=/i);
    expect(remainderMigration).toContain(
      "NEW.credits_added IS NOT DISTINCT FROM OLD.credits_added",
    );
    expect(remainderMigration).toContain(
      "a remainder replacement must clear credits_added",
    );
    expect(service).toContain(
      '(event.status === "quarantined" && event.creditsAdded !== null)',
    );
    expect(service).toContain("const [transitioned] = await tx");
    expect(service).toContain("balance: sql`balance - ${event.creditsAdded}`");
  });

  test("retains removed remainder evidence and quarantines before confirmation", () => {
    const removedStart = service.indexOf(
      "export async function reconcileRemovedInboundTransfer",
    );
    const confirmationStart = service.indexOf(
      "export async function creditConfirmedPendingDeposit",
    );
    const removedSource = service.slice(removedStart, confirmationStart);
    const confirmationSource = service.slice(confirmationStart);

    expect(removedSource).toContain(
      "const amount = decomposeUsdcAtomic(transfer.amountBase)",
    );
    expect(removedSource).toContain(
      "creditRemainderBase: removedRemainderBase",
    );
    expect(removedSource).toContain("recordObservation(");
    expect(removedSource).not.toContain("creditsForUsdcAtomic");
    expect(confirmationSource).toContain(
      'error: "non_integral_credit_amount"',
    );
    expect(
      confirmationSource.indexOf("const amount = classifyUsdcCreditAmount"),
    ).toBeLessThan(confirmationSource.indexOf("const settlementPolicy"));
  });

  test("fences every removed-to-remainder replacement generation", () => {
    const remainderBranch = remainderMigration.slice(
      remainderMigration.indexOf("NEW.error = 'non_integral_credit_amount'"),
      remainderMigration.indexOf(
        "observation_generation may change only for a distinct pending or remainder incarnation",
      ),
    );

    expect(remainderBranch).toContain("OLD.status = 'removed'");
    expect(remainderBranch).toContain(
      "NEW.observation_generation := OLD.observation_generation + 1",
    );
    expect(remainderBranch).toContain(
      "a remainder quarantine must retain its current pending/quarantined generation or advance exactly once",
    );
    expect(remainderBranch).toContain(
      "NEW.observation_generation IS DISTINCT FROM\n        OLD.observation_generation + 1",
    );
    expect(remainderBranch).toContain(
      "a remainder replacement must name a distinct block generation",
    );
  });
});
