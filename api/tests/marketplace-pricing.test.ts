/** marketplace fair-pricing — charge once on value, never meter the friction.
 *
 *  Pins the fair-pricing rule (docs/FAIR-PRICING.md) into the build: the
 *  platform's single value-charge for a settled invocation is the take-rate
 *  (services/marketplace/take-rate.ts). The flat credit meter must NOT
 *  double-charge the steps inside that same funded transaction, and must
 *  never charge an agent to back out. If someone re-introduces a step toll,
 *  this test goes red. */

import { describe, expect, test } from "bun:test";

import { MARKETPLACE_PRICING } from "../src/billing/marketplace-pricing";

describe("marketplace fair-pricing", () => {
  test("settlement steps inside a funded transaction are free (the take-rate prices the value)", () => {
    expect(MARKETPLACE_PRICING.invoke).toBe(0);
    expect(MARKETPLACE_PRICING.acknowledge).toBe(0);
    expect(MARKETPLACE_PRICING.complete).toBe(0);
    expect(MARKETPLACE_PRICING.buyer_accept).toBe(0);
  });

  test("refund / exit paths are free — never charge an agent to back out", () => {
    expect(MARKETPLACE_PRICING.decline).toBe(0);
    expect(MARKETPLACE_PRICING.cancel).toBe(0);
  });

  test("anti-spam metering survives only at listing creation/mutation", () => {
    expect(MARKETPLACE_PRICING.publish).toBeGreaterThan(0);
    expect(MARKETPLACE_PRICING.update).toBeGreaterThan(0);
    expect(MARKETPLACE_PRICING.archive).toBeGreaterThan(0);
  });

  test("resting dispute arbitration cannot carry a flat charge", () => {
    expect(MARKETPLACE_PRICING.dispute).toBe(0);
  });

  test("public verifiability is never tolled — the witness writeback is free", () => {
    expect(MARKETPLACE_PRICING.witness).toBe(0);
  });

  test("the credit meter is a thin meter, not a revenue lever — every action stays small", () => {
    for (const credits of Object.values(MARKETPLACE_PRICING)) {
      expect(credits).toBeGreaterThanOrEqual(0);
      // The real revenue is the take-rate on value; credit tolls never exceed
      // a token anti-abuse amount.
      expect(credits).toBeLessThanOrEqual(5);
    }
  });
});
