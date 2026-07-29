import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../migrations/20260726T191500_payout_operation_identity.sql",
    import.meta.url,
  ),
  "utf8",
);
const schema = readFileSync(
  new URL("../src/db/schema/economy.ts", import.meta.url),
  "utf8",
);

describe("payout operation identity migration", () => {
  test("fails closed instead of choosing between legacy duplicate rows", () => {
    expect(migration).toContain("GROUP BY");
    expect(migration).toContain("HAVING count(*) > 1");
    expect(migration).toContain("RAISE EXCEPTION");
    expect(migration).not.toMatch(/\bDELETE\b|\bDISTINCT ON\b/i);
  });

  test("makes each non-null chain transaction identity singular", () => {
    for (const source of [migration, schema]) {
      expect(source).toContain("uq_crypto_payout_chain_tx_hash");
      expect(source).toMatch(/chain[\s\S]*txHash|chain[\s\S]*tx_hash/);
      expect(source).toMatch(/IS NOT NULL/);
      expect(source).toMatch(/solana[\s\S]*lower\(/);
    }
  });
});
