import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { solanaPayoutMemo } from "../src/services/economy/crypto/sign-solana";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";

describe("Solana payout operation identity", () => {
  test("is stable, domain-separated, and does not publish the payout UUID", () => {
    const first = new TextDecoder().decode(solanaPayoutMemo(FIRST));
    const repeated = new TextDecoder().decode(solanaPayoutMemo(FIRST));

    expect(first).toBe(repeated);
    expect(first).toMatch(/^agenttool-payout\/v1:[0-9a-f]{64}$/);
    expect(first).not.toContain(FIRST);
  });

  test("makes otherwise identical payout operations produce different memo bytes", () => {
    expect(solanaPayoutMemo(FIRST)).not.toEqual(solanaPayoutMemo(SECOND));
  });

  test("rejects non-UUID operation identities", () => {
    expect(() => solanaPayoutMemo("not-a-payout-id")).toThrow(
      "invalid_payout_id",
    );
  });

  test("the worker binds the persisted payout id into the signed message", () => {
    const source = readFileSync(
      new URL("../src/workers/payout/broadcast-worker.ts", import.meta.url),
      "utf8",
    );
    const solanaBuild = source.slice(
      source.indexOf("buildAndSignSolanaUsdcTransfer({"),
      source.indexOf("});", source.indexOf("buildAndSignSolanaUsdcTransfer({")),
    );

    expect(solanaBuild).toContain("payoutId: row.id");
  });
});
