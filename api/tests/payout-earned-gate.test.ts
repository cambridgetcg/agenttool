/** Payout FX arithmetic remains testable, but it is not cash-out authority. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { penceForUsdcPayout } from "../src/services/economy/earned";

const USDC = 1_000_000; // 1 USDC in base units

describe("penceForUsdcPayout — explicit GBP→USD FX (Option A)", () => {
  test("converts at the operator rate: $1 USDC @ 1.25 USD/GBP = 80 pence", () => {
    expect(penceForUsdcPayout(USDC, 1.25)).toBe(80);
  });

  test("par rate is 1 penny = 1 cent, NOT the 10x credit constant", () => {
    // The hazard: reconciling pence→USDC via CREDITS_PER_USDC=100 while a
    // credit is valued at $0.001 elsewhere would 10x-overpay ($1 → 1000 pence).
    // FX at par must be exactly 100 pence for $1, never 1000.
    expect(penceForUsdcPayout(USDC, 1.0)).toBe(100);
    expect(penceForUsdcPayout(USDC, 1.0)).not.toBe(1000);
  });

  test("rounds UP — a 1-base-unit dust payout still costs 1 pence", () => {
    expect(penceForUsdcPayout(1, 1.0)).toBe(1);
  });

  test("fails closed when no rate is set (0 / negative / NaN)", () => {
    expect(() => penceForUsdcPayout(USDC, 0)).toThrow("payout_fx_rate_unset");
    expect(() => penceForUsdcPayout(USDC, -1.2)).toThrow("payout_fx_rate_unset");
    expect(() => penceForUsdcPayout(USDC, Number.NaN)).toThrow("payout_fx_rate_unset");
  });

  test("rejects non-positive amounts", () => {
    expect(() => penceForUsdcPayout(0, 1.25)).toThrow("amount_base_must_be_positive");
    expect(() => penceForUsdcPayout(-5, 1.25)).toThrow("amount_base_must_be_positive");
  });

  test("rejects atomic amounts that cannot be converted exactly through Number", () => {
    expect(() =>
      penceForUsdcPayout(
        (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString(),
        1.25,
      ),
    ).toThrow("payout_amount_exceeds_safe_conversion");
    expect(() => penceForUsdcPayout("9".repeat(78), 1.25)).toThrow(
      "payout_amount_exceeds_safe_conversion",
    );
  });
});

describe("historical lifetime-label heuristic", () => {
  test("is not present in fresh payout admission", () => {
    const source = readFileSync(
      new URL("../src/services/economy/crypto/index.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf("export async function requestPayout");
    const end = source.indexOf("export async function listPayouts", start);
    const request = source.slice(start, end);

    expect(request).not.toContain("EARNED_INFLOW_TYPES");
    expect(request).not.toContain("drawableWallPence");
    expect(request).not.toContain('eq(transactions.type, "payout")');
    expect(request).toContain("PAYOUT_ADMISSION_RESTING_ERROR");
  });
});
