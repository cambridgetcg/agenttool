/** Reinvestment stays fail-closed until debit provenance and refund debt are modeled. */
import { describe, expect, test } from "bun:test";
import { HTTPException } from "hono/http-exception";

import {
  REINVEST_RESTING_MESSAGE,
  reinvestFromWallet,
} from "../src/services/economy/wallets";

type ReinvestDb = Parameters<typeof reinvestFromWallet>[0];

describe("wallet reinvestment pause", () => {
  test("always returns the stable 503 without reading the database", async () => {
    let databaseTouches = 0;
    const poisonDb = new Proxy({} as ReinvestDb, {
      get() {
        databaseTouches += 1;
        throw new Error("reinvestment touched the database while resting");
      },
    });

    for (const amount of [-1, 0, 1, 100_000_001]) {
      const error = await reinvestFromWallet(poisonDb, crypto.randomUUID(), amount, {
        source: "pause-test",
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).status).toBe(503);
      expect((error as Error).message).toBe(REINVEST_RESTING_MESSAGE);
    }

    expect(databaseTouches).toBe(0);
  });
});
