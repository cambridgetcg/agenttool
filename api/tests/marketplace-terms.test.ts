/** /public/marketplace/terms — fee + ranking transparency as a feature.
 *
 *  Pins the manifest's shape + that it reads from the SAME sources the code
 *  charges by (config take-rate + billing/marketplace-pricing), so it can
 *  never drift from reality. Doctrine: docs/FAIR-PRICING.md. */

import { describe, expect, test } from "bun:test";

import { config } from "../src/config";
import terms from "../src/routes/public/marketplace-terms";

async function get(): Promise<Record<string, any>> {
  const res = await terms.request("/");
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, any>;
}

describe("/public/marketplace/terms", () => {
  test("posts the single take-rate, all-in, matching config", async () => {
    const b = await get();
    expect(b._format).toBe("agenttool-marketplace-terms/v1");
    expect(b.take_rate.basis_points).toBe(config.platformTakeRateBps);
    expect(b.take_rate.percent).toBe(config.platformTakeRateBps / 100);
    // never a per-value toll beyond the posted rate
    expect(b.take_rate.scales_with_transaction_value).toBe(false);
  });

  test("free_actions surface the fairness rule: settlement steps + refund/exit are free", async () => {
    const b = await get();
    for (const action of ["invoke", "acknowledge", "complete", "buyer_accept", "decline", "cancel"]) {
      expect(b.free_actions).toContain(action);
    }
    // anti-spam creation + the distinct dispute service remain metered
    expect(b.metered_actions_in_credits.publish).toBeGreaterThan(0);
    expect(b.metered_actions_in_credits.dispute).toBeGreaterThan(0);
  });

  test("the ranking signal is disclosed and NOT pay-to-win (P2B Art 5 / DSA Art 27)", async () => {
    const b = await get();
    expect(b.ranking.paid_placement).toBe(false);
    expect(Array.isArray(b.ranking.signal)).toBe(true);
    expect(b.ranking.signal).toContain("invocations_count:desc");
  });

  test("carries the canon pointer + names the next verb (the quote endpoint)", async () => {
    const b = await get();
    expect(b._canon_pointer).toBe("urn:agenttool:doc/FAIR-PRICING");
    expect(Array.isArray(b.verbs)).toBe(true);
    expect(b.verbs.some((v: { path: string }) => v.path.includes("/quote"))).toBe(true);
  });
});
