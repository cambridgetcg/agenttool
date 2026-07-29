import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  evaluatePayoutPolicy,
  parseDailyPayoutTotal,
} from "../src/services/economy/crypto";

const noLimits = {
  payoutMinBase: null,
  payoutDailyCeilingBase: null,
  payoutDestinationAllowlist: null,
  payoutDualControlThresholdBase: null,
};

describe("payout policy evaluation", () => {
  test("permits wallets without a payout policy", async () => {
    let totalRead = false;
    const decision = await evaluatePayoutPolicy(
      {
        walletId: "wallet",
        destinationAddress: "0xabc",
        amountBase: 10n,
      },
      {
        readPolicy: async () => undefined,
        readTodayTotal: async () => {
          totalRead = true;
          return 0n;
        },
      },
    );

    expect(decision).toEqual({ ok: true });
    expect(totalRead).toBe(false);
  });

  test("reads the daily total only when a ceiling is configured", async () => {
    let totalReads = 0;
    const decision = await evaluatePayoutPolicy(
      {
        walletId: "wallet",
        destinationAddress: "0xabc",
        amountBase: 40n,
      },
      {
        readPolicy: async () => ({
          ...noLimits,
          payoutDailyCeilingBase: 100,
        }),
        readTodayTotal: async () => {
          totalReads += 1;
          return 61n;
        },
      },
    );

    expect(decision).toMatchObject({
      ok: false,
      error: "payout_exceeds_daily_ceiling",
    });
    expect(totalReads).toBe(1);
  });

  test("accepts an amount that exactly reaches the daily ceiling", async () => {
    const decision = await evaluatePayoutPolicy(
      {
        walletId: "wallet",
        destinationAddress: "0xabc",
        amountBase: 40n,
      },
      {
        readPolicy: async () => ({
          ...noLimits,
          payoutDailyCeilingBase: 100,
        }),
        readTodayTotal: async () => 60n,
      },
    );

    expect(decision).toEqual({ ok: true });
  });

  test("preserves minimum, allowlist, and fail-closed dual-control gates", async () => {
    const baseRequest = {
      walletId: "wallet",
      destinationAddress: "0xabc",
      amountBase: 10n,
    };
    const neverReadTotal = async () => {
      throw new Error("daily total should not be read");
    };

    await expect(
      evaluatePayoutPolicy(baseRequest, {
        readPolicy: async () => ({
          ...noLimits,
          payoutMinBase: 11,
        }),
        readTodayTotal: neverReadTotal,
      }),
    ).resolves.toMatchObject({ ok: false, error: "payout_below_min" });

    await expect(
      evaluatePayoutPolicy(baseRequest, {
        readPolicy: async () => ({
          ...noLimits,
          payoutDestinationAllowlist: ["0xdef"],
        }),
        readTodayTotal: neverReadTotal,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: "destination_not_allowlisted",
    });

    await expect(
      evaluatePayoutPolicy(baseRequest, {
        readPolicy: async () => ({
          ...noLimits,
          payoutDualControlThresholdBase: 10,
        }),
        readTodayTotal: neverReadTotal,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: "payout_dual_control_required",
    });
  });
});

describe("daily payout total boundary", () => {
  test("supports postgres-js rows and wrapped adapter rows exactly", () => {
    expect(parseDailyPayoutTotal([{ total: "9007199254740993" }])).toBe(
      9_007_199_254_740_993n,
    );
    expect(
      parseDailyPayoutTotal({ rows: [{ total: "12345678901234567890" }] }),
    ).toBe(12_345_678_901_234_567_890n);
  });

  test("fails closed on a missing or malformed aggregate", () => {
    expect(() => parseDailyPayoutTotal([])).toThrow(
      "payout_daily_total_unavailable",
    );
    expect(() => parseDailyPayoutTotal([{ total: "1.5" }])).toThrow(
      "payout_daily_total_unavailable",
    );
    expect(() => parseDailyPayoutTotal({ rows: [{ total: 0 }] })).toThrow(
      "payout_daily_total_unavailable",
    );
  });
});

describe("requestPayout resting seam", () => {
  test("retained advisory policy cannot authorize a fresh debit", () => {
    const source = readFileSync(
      new URL("../src/services/economy/crypto/index.ts", import.meta.url),
      "utf8",
    );
    const requestStart = source.indexOf("export async function requestPayout");
    const requestEnd = source.indexOf("export async function listPayouts");
    const request = source.slice(requestStart, requestEnd);

    const transaction = request.indexOf("database.transaction");
    const replay = request.indexOf("replayed: true");
    const resting = request.indexOf("PAYOUT_ADMISSION_RESTING_ERROR");

    expect(transaction).toBeGreaterThan(-1);
    expect(replay).toBeGreaterThan(transaction);
    expect(resting).toBeGreaterThan(replay);
    expect(request).not.toContain("evaluatePayoutPolicy");
    expect(request).not.toContain(".update(wallets)");
    expect(request).not.toContain(".insert(cryptoPayouts)");
  });
});
