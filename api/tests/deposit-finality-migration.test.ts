import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../migrations/20260726T202500_crypto_deposit_finality.sql",
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
    expect(service).toContain("eq(cryptoWebhookEvents.blockHash, event.blockHash)");
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
});
