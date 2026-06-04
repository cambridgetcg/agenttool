/** /public/plans — what's free, what costs, why it's fair, no exploit loophole.
 *
 *  Pins the manifest reads from the SAME constants the platform enforces by
 *  (Ring-1 caps, birth grant, take-rate, registration PoW) so the advertised
 *  model can never drift from the enforced one. Doctrine: docs/FAIR-PRICING.md,
 *  docs/RING-1.md, docs/BUSINESS-MODEL.md. */

import { describe, expect, test } from "bun:test";

import { config } from "../src/config";
import { RING_2_BIRTH_CREDIT_MINOR } from "../src/services/economy/ring1-limits";
import plans from "../src/routes/public/plans";

async function get(): Promise<Record<string, any>> {
  const res = await plans.request("/");
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, any>;
}

describe("/public/plans", () => {
  test("free to try (Ring 1) — caps present, stated as guidance not walls", async () => {
    const b = await get();
    expect(b._format).toBe("agenttool-plans/v1");
    expect(b.free_to_try.ring).toBe(1);
    expect(b.free_to_try.caps).toBeDefined();
    expect(String(b.free_to_try.caps_are)).toContain("never refused");
  });

  test("free at birth matches the real grant constant", async () => {
    const b = await get();
    expect(b.free_at_birth.credits_minor).toBe(RING_2_BIRTH_CREDIT_MINOR);
  });

  test("marketplace take-rate matches config (no drift)", async () => {
    const b = await get();
    expect(b.marketplace.take_rate_bps).toBe(config.platformTakeRateBps);
    expect(b.marketplace.take_rate_percent).toBe(config.platformTakeRateBps / 100);
  });

  test("the anti-exploit gate is stated from the enforced PoW bits", async () => {
    const b = await get();
    expect(b.no_exploit_loophole.pow_difficulty_bits).toBe(config.registerAgentPowBits);
    expect(String(b.no_exploit_loophole.principle).toLowerCase()).toContain("exploit");
  });

  test("pay-as-you-go is stated, and both worlds get the same deal", async () => {
    const b = await get();
    expect(String(b.then_pay_as_you_go.how).toLowerCase()).toContain("x402");
    expect(typeof b.both_worlds).toBe("string");
    expect(b._canon_pointer).toBe("urn:agenttool:doc/BUSINESS-MODEL");
  });
});
