/** The earned wall + payout FX — the money math that gates cash-out.
 *
 *  Pins the fix for the payout mint-hole (a £5 birth credit read as $5 of
 *  withdrawable USDC). Pure helpers, so both the FX conversion and the shared
 *  drawable wall are tested exhaustively without a DB. The DB-integrated
 *  requestPayout/reinvest paths compose these; see the PR body for the wiring.
 *
 *    - penceForUsdcPayout: GBP pence to source N USDC at an explicit FX rate,
 *      rounding against the withdrawer, failing closed with no rate.
 *    - drawableWallPence: earned − reinvested − paidout, shared by both exits.
 *    - EARNED_INFLOW_TYPES: excludes "fund" (birth/free credit) — the mint-hole.
 *
 *  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md · docs/ECONOMY.md (provenance wall).
 */
import { describe, expect, test } from "bun:test";

import {
  EARNED_INFLOW_TYPES,
  drawableWallPence,
  penceForUsdcPayout,
} from "../src/services/economy/earned";

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
});

describe("drawableWallPence — the shared earned wall", () => {
  test("earned − reinvested − paidout", () => {
    expect(drawableWallPence(100, 30, 20)).toBe(50);
  });

  test("payout and reinvest share ONE pool (both subtract)", () => {
    expect(drawableWallPence(100, 40, 40)).toBe(20);
  });

  test("over-drawn wall goes negative → gate (required > available) blocks all", () => {
    expect(drawableWallPence(100, 60, 50)).toBe(-10);
  });

  test("a wallet with zero earned revenue can draw nothing", () => {
    expect(drawableWallPence(0, 0, 0)).toBe(0);
  });
});

describe("EARNED_INFLOW_TYPES — the mint-hole boundary", () => {
  test("counts only genuinely-earned inflows", () => {
    expect([...EARNED_INFLOW_TYPES]).toEqual(["gallery_sale", "escrow_release"]);
  });

  test("EXCLUDES the birth/free credit (type 'fund') and raw deposits", () => {
    const types = EARNED_INFLOW_TYPES as readonly string[];
    expect(types).not.toContain("fund");
    expect(types).not.toContain("deposit");
  });
});
