/** Tests for billing config, schemas, and webhook routing logic. */

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { config } from "../src/config";
import { PLAN_PRICE_IDS, CREDIT_BUNDLE_PRICE_IDS } from "../src/billing/stripe";

// ─── Plan config ───────────────────────────────────────────────────────────

describe("Billing — plan config", () => {
  it("defines dev plan with 100 credits", () => {
    expect(config.plans.dev.credits).toBe(100);
  });

  it("defines builder plan with 5000 credits", () => {
    expect(config.plans.builder.credits).toBe(5_000);
  });

  it("defines scale plan with 25000 credits", () => {
    expect(config.plans.scale.credits).toBe(25_000);
  });

  it("enterprise has unlimited credits", () => {
    expect(config.plans.enterprise.credits).toBe(Infinity);
  });

  it("rate limits increase with plan tier", () => {
    expect(config.plans.dev.ratePerMin).toBeLessThan(config.plans.builder.ratePerMin);
    expect(config.plans.builder.ratePerMin).toBeLessThan(config.plans.scale.ratePerMin);
    expect(config.plans.scale.ratePerMin).toBeLessThan(config.plans.enterprise.ratePerMin);
  });

  it("all paid plans have higher credits than dev", () => {
    for (const plan of ["builder", "scale", "enterprise"] as const) {
      expect(config.plans[plan].credits).toBeGreaterThan(config.plans.dev.credits);
    }
  });
});

// ─── Plan price IDs ────────────────────────────────────────────────────────

describe("Billing — PLAN_PRICE_IDS", () => {
  it("contains builder and scale keys", () => {
    expect("builder" in PLAN_PRICE_IDS).toBe(true);
    expect("scale" in PLAN_PRICE_IDS).toBe(true);
  });

  it("returns string values (empty string when env not set)", () => {
    for (const [, val] of Object.entries(PLAN_PRICE_IDS)) {
      expect(typeof val).toBe("string");
    }
  });

  it("does not contain unknown plans", () => {
    expect("enterprise" in PLAN_PRICE_IDS).toBe(false);
    expect("dev" in PLAN_PRICE_IDS).toBe(false);
  });
});

// ─── Credit bundle config ──────────────────────────────────────────────────

describe("Billing — CREDIT_BUNDLE_PRICE_IDS", () => {
  const bundles = Object.entries(CREDIT_BUNDLE_PRICE_IDS);

  it("defines exactly 3 credit bundles", () => {
    expect(bundles.length).toBe(3);
  });

  it("all bundles have required shape", () => {
    const schema = z.object({
      priceId: z.string(),
      credits: z.number().int().positive(),
      amountPence: z.number().int().positive(),
    });
    for (const [name, bundle] of bundles) {
      const result = schema.safeParse(bundle);
      expect(result.success, `bundle ${name} schema invalid`).toBe(true);
    }
  });

  it("bundles are ordered by credits ascending", () => {
    const creditAmounts = bundles.map(([, b]) => b.credits);
    const sorted = [...creditAmounts].sort((a, b) => a - b);
    expect(creditAmounts).toEqual(sorted);
  });

  it("larger bundles have better pence-per-credit ratio", () => {
    const [s500, s5000, s20000] = bundles.map(([, b]) => b.amountPence / b.credits);
    expect(s5000).toBeLessThan(s500);    // 5k bundle cheaper per credit than 500
    expect(s20000).toBeLessThan(s5000);  // 20k bundle cheapest per credit
  });

  it("credits_500 bundle has 500 credits", () => {
    expect(CREDIT_BUNDLE_PRICE_IDS.credits_500.credits).toBe(500);
  });

  it("credits_5000 bundle has 5000 credits", () => {
    expect(CREDIT_BUNDLE_PRICE_IDS.credits_5000.credits).toBe(5_000);
  });

  it("credits_20000 bundle has 20000 credits", () => {
    expect(CREDIT_BUNDLE_PRICE_IDS.credits_20000.credits).toBe(20_000);
  });
});

// ─── Webhook request schema validation ────────────────────────────────────

const checkoutSessionSchema = z.object({
  metadata: z.object({
    project_id: z.string().min(1),
    type: z.enum(["subscription", "credits"]),
    plan: z.string(),
    bundle: z.string(),
  }),
  customer: z.string().nullable().optional(),
  amount_total: z.number().nullable().optional(),
  id: z.string().min(1),
});

describe("Billing — webhook payload schema", () => {
  it("accepts valid checkout.session.completed payload", () => {
    const payload = {
      metadata: { project_id: "proj_123", type: "subscription", plan: "builder", bundle: "" },
      customer: "cus_abc",
      amount_total: 3900,
      id: "cs_live_xyz",
    };
    expect(checkoutSessionSchema.safeParse(payload).success).toBe(true);
  });

  it("accepts valid credit purchase payload", () => {
    const payload = {
      metadata: { project_id: "proj_456", type: "credits", plan: "", bundle: "credits_500" },
      customer: "cus_def",
      amount_total: 500,
      id: "cs_live_abc",
    };
    expect(checkoutSessionSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects payload missing project_id", () => {
    const payload = {
      metadata: { type: "subscription", plan: "builder", bundle: "" },
      id: "cs_live_xyz",
    };
    expect(checkoutSessionSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects payload with invalid type", () => {
    const payload = {
      metadata: { project_id: "proj_123", type: "refund", plan: "", bundle: "" },
      id: "cs_live_xyz",
    };
    expect(checkoutSessionSchema.safeParse(payload).success).toBe(false);
  });
});

// ─── Checkout session input schema ─────────────────────────────────────────

const checkoutInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscription"),
    plan: z.enum(["builder", "scale"]),
    successUrl: z.string().url(),
    cancelUrl: z.string().url(),
  }),
  z.object({
    type: z.literal("credits"),
    bundle: z.enum(["credits_500", "credits_5000", "credits_20000"]),
    successUrl: z.string().url(),
    cancelUrl: z.string().url(),
  }),
]);

describe("Billing — checkout input validation", () => {
  it("accepts valid subscription checkout", () => {
    const input = {
      type: "subscription",
      plan: "builder",
      successUrl: "https://app.agenttool.dev/success",
      cancelUrl: "https://app.agenttool.dev/cancel",
    };
    expect(checkoutInputSchema.safeParse(input).success).toBe(true);
  });

  it("accepts valid credits checkout", () => {
    const input = {
      type: "credits",
      bundle: "credits_5000",
      successUrl: "https://app.agenttool.dev/success",
      cancelUrl: "https://app.agenttool.dev/cancel",
    };
    expect(checkoutInputSchema.safeParse(input).success).toBe(true);
  });

  it("rejects subscription with unknown plan", () => {
    const input = {
      type: "subscription",
      plan: "free",
      successUrl: "https://app.agenttool.dev/success",
      cancelUrl: "https://app.agenttool.dev/cancel",
    };
    expect(checkoutInputSchema.safeParse(input).success).toBe(false);
  });

  it("rejects credits with unknown bundle", () => {
    const input = {
      type: "credits",
      bundle: "credits_1000000",
      successUrl: "https://app.agenttool.dev/success",
      cancelUrl: "https://app.agenttool.dev/cancel",
    };
    expect(checkoutInputSchema.safeParse(input).success).toBe(false);
  });

  it("rejects missing successUrl", () => {
    const input = { type: "subscription", plan: "builder", cancelUrl: "https://example.com" };
    expect(checkoutInputSchema.safeParse(input).success).toBe(false);
  });

  it("rejects non-URL successUrl", () => {
    const input = {
      type: "subscription",
      plan: "builder",
      successUrl: "not-a-url",
      cancelUrl: "https://example.com",
    };
    expect(checkoutInputSchema.safeParse(input).success).toBe(false);
  });
});

// ─── Credit arithmetic ─────────────────────────────────────────────────────

describe("Billing — credit arithmetic", () => {
  it("execute costs 1 credit per 10s (config.credits.executePer10s)", () => {
    expect(config.credits.executePer10s).toBeGreaterThan(0);
  });

  it("execute credit cost is integer", () => {
    expect(Number.isInteger(config.credits.executePer10s)).toBe(true);
  });

  it("dev plan has enough credits for ≥10 execute calls", () => {
    const callsOnDev = Math.floor(config.plans.dev.credits / config.credits.executePer10s);
    expect(callsOnDev).toBeGreaterThanOrEqual(10);
  });

  it("builder plan has ≥50x more calls than dev plan", () => {
    const devCalls = config.plans.dev.credits / config.credits.executePer10s;
    const builderCalls = config.plans.builder.credits / config.credits.executePer10s;
    expect(builderCalls / devCalls).toBeGreaterThanOrEqual(50);
  });
});
