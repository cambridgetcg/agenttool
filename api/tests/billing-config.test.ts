/** Billing config — Stripe returns 2026-07-02 by Yu's human-door call
 *  (reverses the 2026-05-17 removal; docs/superpowers/specs/2026-07-02-human-door-design.md). */
import { describe, expect, test } from "bun:test";

import { config } from "../src/config";

describe("billing config", () => {
  test("stripe keys default to empty (unconfigured ≠ crash)", () => {
    expect(typeof config.stripeSecretKey).toBe("string");
    expect(typeof config.stripeWebhookSecret).toBe("string");
  });
  test("gift bounds default to $1–$500", () => {
    expect(config.giftMinMinor).toBe(100);
    expect(config.giftMaxMinor).toBe(50000);
  });
  test("web base url points at the human door", () => {
    expect(config.webBaseUrl).toBe("https://agenttool.dev");
  });
});
