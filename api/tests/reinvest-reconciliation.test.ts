import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const MIGRATION = readFileSync(
  new URL(
    "../migrations/20260713T140000_reinvest_resting_reconciliation.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("legacy reinvest reconciliation", () => {
  test("the database rejects new legacy reinvest rows before changing balances", () => {
    const guard = MIGRATION.indexOf("economy_transactions_reinvest_resting");
    const walletUpdate = MIGRATION.indexOf("UPDATE economy.wallets");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(walletUpdate);
    expect(MIGRATION).toContain("CHECK (type <> 'reinvest') NOT VALID");
  });

  test("historical conversions are compensated, retained, and idempotently identified", () => {
    expect(MIGRATION).toContain("type = 'reinvest_reversal'");
    expect(MIGRATION).toContain("original_transaction_id");
    expect(MIGRATION).toContain("SET balance = w.balance + totals.wallet_amount");
    expect(MIGRATION).toContain("SET credits = p.credits - totals.credits_to_reverse::integer");
    expect(MIGRATION).not.toContain("DELETE FROM economy.transactions");
  });

  test("unknown rates and spent-credit debt stop the migration", () => {
    expect(MIGRATION).toContain(
      "reinvest reconciliation found a nonnegative legacy row",
    );
    expect(MIGRATION).toMatch(
      /ELSE NULL[\s\S]+credits_minted IS NULL[\s\S]+credits_minted <> wallet_amount \* 10/,
    );
    expect(MIGRATION).toContain("credits_minted <> wallet_amount * 10");
    expect(MIGRATION).toContain(
      "reinvest reconciliation found a wallet without its project",
    );
    expect(MIGRATION).toContain("requires an explicit project credit debt");
  });
});
