import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

const migrationFilename =
  "20260726T191000_payout_policy_e2e_fixture_repair.sql";
const nextMigrationFilename =
  "20260726T191500_payout_operation_identity.sql";
const migrationUrl = new URL(`../migrations/${migrationFilename}`, import.meta.url);
const migration = readFileSync(migrationUrl, "utf8");
const harness = readFileSync(
  new URL("../scripts/_e2e-payout-policies.ts", import.meta.url),
  "utf8",
);
const migrations = readdirSync(new URL("../migrations", import.meta.url))
  .filter((name) => name.endsWith(".sql"))
  .sort();

const SOURCE_HASH_0 =
  "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0";
const SOURCE_HASH_1 =
  "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1";

describe("policy E2E payout fixture repair", () => {
  test("runs immediately before payout operation identity becomes unique", () => {
    const repairIndex = migrations.indexOf(migrationFilename);
    expect(repairIndex).toBeGreaterThan(-1);
    expect(migrations[repairIndex + 1]).toBe(nextMigrationFilename);
  });

  test("recognizes only the two source-generated operation identities", () => {
    expect(migration).toContain(SOURCE_HASH_0);
    expect(migration).toContain(SOURCE_HASH_1);
    expect(migration).toContain("source_row_count <> 4");
    expect(migration).toContain("duplicate_group_count <> 2");
    expect(migration).toContain("expected_duplicate_group_count <> 2");
    expect(migration).toContain("complete_run_count <> 2");
  });

  test("locks and verifies the complete source fixture before changing it", () => {
    expect(migration).toContain(
      "LOCK TABLE economy.crypto_payouts IN ACCESS EXCLUSIVE MODE",
    );
    expect(migration).toContain(
      "LOCK TABLE economy.transactions IN SHARE MODE",
    );
    for (const invariant of [
      "^e2e-policies-[0-9]{13}$",
      "policies-test",
      "wallet.project_id = payout.project_id",
      "wallet.currency = 'USDC'",
      "wallet.owner_type = 'platform'",
      "wallet.identity_id IS NOT NULL",
      "payout.chain = 'ethereum'",
      "payout.token = 'USDC'",
      "payout.amount_base = 4000000",
      "0x000000000000000000000000000000000000dEaD",
      "payout.status = 'broadcast'",
      "payout.error IS NULL",
      "payout.confirmed_at IS NULL",
      "payout.metadata = '{}'::jsonb",
    ]) {
      expect(migration).toContain(invariant);
    }
    expect(migration).toContain("metadata->>'payout_id'");
    expect(migration).toContain("ledger_row_count <> 0");
  });

  test("performs one bounded payout-only terminal repair and proves uniqueness", () => {
    expect(migration).toContain("UPDATE economy.crypto_payouts AS payout");
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE FROM)\s+economy\.wallets\b/i);
    expect(migration).not.toMatch(
      /\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+economy\.transactions\b/i,
    );
    expect(migration).toContain("status = 'failed'");
    expect(migration).toContain("tx_hash = NULL");
    expect(migration).toContain(
      "error = 'synthetic_policy_fixture_no_chain_operation'",
    );
    expect(migration).toContain("'fixture_repair'");
    expect(migration).toContain("'original_tx_hash', payout.tx_hash");
    expect(migration).toContain("repaired_row_count <> 4");
    expect(migration).toContain("remaining_source_count <> 0");
    expect(migration).toContain("remaining_duplicate_count <> 0");
  });

  test("future harness rows never claim a transaction identity and always terminalize", () => {
    expect(harness).not.toContain(SOURCE_HASH_0);
    expect(harness).not.toContain(SOURCE_HASH_1);
    expect(harness).not.toContain('.repeat(64 - String(');
    expect(harness).toMatch(
      /destination_address,\s+status,\s+tx_hash,\s+metadata[\s\S]+?'broadcast',\s+NULL,\s+\$4::jsonb/,
    );
    expect(harness).toContain(
      'fixture_kind: "payout_policy_e2e_daily_ceiling"',
    );
    expect(harness).toContain("async function terminalizeFixtureRows");
    expect(harness).toMatch(
      /finally\s*\{[\s\S]*terminalizeFixtureRows\(cleanup\)/,
    );
    expect(harness).toMatch(
      /UPDATE economy\.crypto_payouts[\s\S]*status = 'failed'[\s\S]*tx_hash = NULL/,
    );
    expect(harness).not.toMatch(/\bDELETE FROM\s+economy\.crypto_payouts\b/i);
  });
});
