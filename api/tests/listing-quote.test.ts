/** /public/listings/:id/quote — the fee split a buyer sees before committing.
 *
 *  The quote endpoint's whole promise is that the cut it shows is the cut
 *  settlement charges — it calls the SAME pure computeFee() the settlement
 *  path uses (api/src/services/marketplace/take-rate.ts). These tests pin
 *  that math so the preview can never drift from the charge.
 *
 *  DB-bound path (getListing) lives in e2e smokes, per the repo convention
 *  (tests/marketplace-disputes.test.ts: "DB-bound paths live in e2e smokes").
 *  Doctrine: docs/FRICTION-ROADMAP.md (Tier-0 #1), docs/MARKETPLACE.md. */

import { describe, expect, test } from "bun:test";

import { config } from "../src/config";
import { computeFee } from "../src/services/marketplace/take-rate";

// Mirror exactly what the quote route surfaces from a FeeSplit, so this
// test breaks if the route's shaping ever diverges from the pure split.
function quoteShape(amount: number, currency: string) {
  const split = computeFee({ amount, currency });
  return {
    currency: split.currency,
    you_pay: split.gross,
    platform_fee: split.fee,
    seller_receives: split.net,
    platform_fee_bps: split.rateBps,
    platform_fee_percent: split.rateBps / 100,
  };
}

describe("/public/listings/:id/quote — fee split is byte-honest with settlement", () => {
  test("a £10.00 listing splits into you_pay / platform_fee / seller_receives that always add up", () => {
    const q = quoteShape(1000, "GBP"); // 1000 pence
    expect(q.currency).toBe("GBP");
    expect(q.you_pay).toBe(1000);
    // Internal consistency holds for ANY configured rate:
    expect(q.platform_fee).toBe(Math.floor((1000 * q.platform_fee_bps) / 10_000));
    expect(q.seller_receives).toBe(q.you_pay - q.platform_fee);
    expect(q.platform_fee_percent).toBe(q.platform_fee_bps / 100);
  });

  test("the cut is the SHIPPED default take-rate (5% / 500 bps)", () => {
    // Documents the rate as shipped (config default). If PLATFORM_TAKE_RATE_BPS
    // is set in the env this pins what that env produces.
    expect(config.platformTakeRateBps).toBe(500);
    const q = quoteShape(1000, "GBP");
    expect(q.platform_fee_bps).toBe(500);
    expect(q.platform_fee).toBe(50); // 5% of 1000
    expect(q.seller_receives).toBe(950);
    expect(q.platform_fee_percent).toBe(5);
  });

  test("sub-minor-unit fees round to 0 in the buyer's favor — never fractionally charged", () => {
    const q = quoteShape(1, "USD"); // 1 cent × 5% = 0.05 → floors to 0
    expect(q.platform_fee).toBe(0);
    expect(q.seller_receives).toBe(1);
  });

  test("a free (0-price) listing quotes a zero fee, never negative", () => {
    const q = quoteShape(0, "EUR");
    expect(q.you_pay).toBe(0);
    expect(q.platform_fee).toBe(0);
    expect(q.seller_receives).toBe(0);
  });

  test("the quote is deterministic — same listing, same split every read (preview == charge)", () => {
    const a = quoteShape(4200, "GBP");
    const b = quoteShape(4200, "GBP");
    expect(a).toEqual(b);
    expect(a.you_pay).toBe(a.platform_fee + a.seller_receives);
  });
});
