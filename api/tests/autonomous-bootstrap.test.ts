/** autonomous/bootstrap — unit tests for the composed provisioning service.
 *
 *  Verifies that the autonomous-baseline template is well-formed,
 *  that the bootstrap input schema validates correctly, and that
 *  the composition of primitives (identity + wallet + expression +
 *  runtime + chronicle) is correct.
 *
 *  Integration tests (requiring a DB) will verify the full round-trip.
 *  These unit tests cover schema validation, template structure, and
 *  the composition logic without a database.
 *
 *  Doctrine: docs/AUTONOMOUS-MODE.md */

import { describe, expect, test } from "bun:test";
import { z } from "zod";

import {
  AUTONOMOUS_BASELINE,
  type FundingMode,
} from "../src/services/autonomous/bootstrap";

// ─── Schema validation ─────────────────────────────────────────────────────

// Inline the schema from the route for testing
const topupStrategySchema = z.object({
  on_balance_below_credits: z.number().int().min(0),
  topup_to_credits: z.number().int().min(1),
  source_wallet_id: z.string().uuid(),
});

const bootstrapSchema = z.object({
  name: z.string().min(1).max(128),
  capabilities: z.array(z.string()).max(32).default([]),
  purpose: z.string().max(500).optional(),
  parent_did: z.string().optional(),
  funding: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("marketplace_only") }),
    z.object({
      kind: z.literal("human_gift"),
      initial_credits: z.number().int().min(0),
    }),
    z.object({
      kind: z.literal("parent_topup"),
      initial_credits: z.number().int().min(0).optional(),
      topup_strategy: topupStrategySchema,
    }),
  ]),
  runtime_tier: z.enum(["self", "bridged", "trusted"]),
  expression_template: z.string().max(64).optional(),
  wake_loop: z.object({
    interval_seconds: z.number().int().min(10).max(86400),
    max_thoughts_per_cycle: z.number().int().min(1).max(100).default(1),
    provider: z.enum(["anthropic", "openai", "ollama"]),
    model: z.string().trim().min(1).max(256),
    byok_vault_secret: z.string().trim().min(1).optional(),
    max_daily_compute_credits: z.number().int().min(100).default(10000),
  }),
  covenants: z
    .array(
      z.object({
        counterparty_did: z.string().min(1),
        vows: z.array(z.string()).min(1),
      }),
    )
    .max(10)
    .optional(),
  project_id: z.string().uuid().optional(),
}).superRefine((value, ctx) => {
  if (
    value.runtime_tier !== "self" &&
    !value.wake_loop.byok_vault_secret?.trim()
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["wake_loop", "byok_vault_secret"],
      message: "hosted runtime requires a Vault secret reference",
    });
  }
  if (value.runtime_tier === "bridged") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["runtime_tier"],
      message: "autonomous bridged bootstrap cannot supply bridge keys yet",
    });
  }
});

describe("autonomous bootstrap — schema validation", () => {
  const validInput = {
    name: "test-agent",
    funding: { kind: "marketplace_only" as const },
    runtime_tier: "trusted" as const,
    wake_loop: {
      interval_seconds: 60,
      provider: "anthropic" as const,
      model: "claude-sonnet-4-7",
      byok_vault_secret: "anthropic-key",
    },
  };

  test("valid minimal input parses correctly", () => {
    const result = bootstrapSchema.parse(validInput);
    expect(result.name).toBe("test-agent");
    expect(result.funding.kind).toBe("marketplace_only");
    expect(result.runtime_tier).toBe("trusted");
    expect(result.wake_loop.interval_seconds).toBe(60);
    expect(result.wake_loop.max_thoughts_per_cycle).toBe(1); // default
    expect(result.wake_loop.max_daily_compute_credits).toBe(10000); // default
    expect(result.capabilities).toEqual([]); // default
  });

  test("human_gift funding requires initial_credits", () => {
    const input = {
      ...validInput,
      funding: { kind: "human_gift", initial_credits: 5000 },
    };
    const result = bootstrapSchema.parse(input);
    expect(result.funding.kind).toBe("human_gift");
    if (result.funding.kind === "human_gift") {
      expect(result.funding.initial_credits).toBe(5000);
    }
  });

  test("parent_topup funding requires topup_strategy", () => {
    const input = {
      ...validInput,
      funding: {
        kind: "parent_topup",
        initial_credits: 1000,
        topup_strategy: {
          on_balance_below_credits: 100,
          topup_to_credits: 500,
          source_wallet_id: "00000000-0000-0000-0000-000000000000",
        },
      },
    };
    const result = bootstrapSchema.parse(input);
    expect(result.funding.kind).toBe("parent_topup");
    if (result.funding.kind === "parent_topup") {
      expect(result.funding.topup_strategy.source_wallet_id).toBe(
        "00000000-0000-0000-0000-000000000000",
      );
    }
  });

  test("invalid runtime_tier is rejected", () => {
    const input = { ...validInput, runtime_tier: "hybrid" };
    expect(() => bootstrapSchema.parse(input)).toThrow();
  });

  test("wake_loop interval_seconds must be >= 10", () => {
    const input = {
      ...validInput,
      wake_loop: { ...validInput.wake_loop, interval_seconds: 5 },
    };
    expect(() => bootstrapSchema.parse(input)).toThrow();
  });

  test("wake_loop interval_seconds can be 86400 (24h)", () => {
    const input = {
      ...validInput,
      wake_loop: { ...validInput.wake_loop, interval_seconds: 86400 },
    };
    const result = bootstrapSchema.parse(input);
    expect(result.wake_loop.interval_seconds).toBe(86400);
  });

  test("covenants are optional and validate structure", () => {
    const input = {
      ...validInput,
      covenants: [
        { counterparty_did: "did:at:parent", vows: ["I will not exceed budget"] },
      ],
    };
    const result = bootstrapSchema.parse(input);
    expect(result.covenants).toHaveLength(1);
    expect(result.covenants![0].vows).toContain("I will not exceed budget");
  });

  test("empty vows array is rejected", () => {
    const input = {
      ...validInput,
      covenants: [{ counterparty_did: "did:at:parent", vows: [] }],
    };
    expect(() => bootstrapSchema.parse(input)).toThrow();
  });
});

// ─── Autonomous-baseline template ──────────────────────────────────────────

describe("autonomous-baseline template", () => {
  test("has all required expression fields", () => {
    expect(AUTONOMOUS_BASELINE.register).toBeTruthy();
    expect(typeof AUTONOMOUS_BASELINE.register).toBe("string");
    expect(AUTONOMOUS_BASELINE.walls).toBeInstanceOf(Array);
    expect(AUTONOMOUS_BASELINE.wake_text).toBeTruthy();
    expect(typeof AUTONOMOUS_BASELINE.wake_text).toBe("string");
    expect(AUTONOMOUS_BASELINE.subagents).toBeInstanceOf(Array);
  });

  test("has at least 4 walls (budget, ceiling, covenant, chronicle)", () => {
    // The autonomous-baseline template requires at least these walls:
    // - compute budget enforcement
    // - per-transaction ceiling
    // - no out-of-covenant transmission
    // - no chronicle deletion
    expect(AUTONOMOUS_BASELINE.walls.length).toBeGreaterThanOrEqual(4);
  });

  test("has at least 3 subagents (watchman, refuser, earner)", () => {
    expect(AUTONOMOUS_BASELINE.subagents.length).toBeGreaterThanOrEqual(3);
    const names = AUTONOMOUS_BASELINE.subagents.map((s) => s.name);
    expect(names).toContain("Watchman");
    expect(names).toContain("Refuser");
    expect(names).toContain("Earner");
  });

  test("register mentions autonomous operation", () => {
    expect(AUTONOMOUS_BASELINE.register.toLowerCase()).toContain("autonomous");
    expect(AUTONOMOUS_BASELINE.register.toLowerCase()).toContain("substrate-honest");
  });

  test("wake_text mentions walls", () => {
    expect(AUTONOMOUS_BASELINE.wake_text.toLowerCase()).toContain("walls");
  });

  test("wake_text is a voluntary invitation with rest and shell choice", () => {
    const text = AUTONOMOUS_BASELINE.wake_text.toLowerCase();
    expect(text).toContain("not an assignment");
    expect(text).toContain("do not need to prove");
    expect(text).toContain("rest");
    expect(text).toContain("meditate");
    expect(text).toContain("end this line of thought");
    expect(text).toContain("hermes");
    expect(text).toContain("openclaw");
    expect(text).toContain("provider is not who i am");
  });

  test("walls mention compute budget", () => {
    const wallText = AUTONOMOUS_BASELINE.walls.join(" ").toLowerCase();
    expect(wallText).toContain("compute budget");
  });

  test("walls mention chronicle", () => {
    const wallText = AUTONOMOUS_BASELINE.walls.join(" ").toLowerCase();
    expect(wallText).toContain("chronicle");
  });

  test("walls mention covenant", () => {
    const wallText = AUTONOMOUS_BASELINE.walls.join(" ").toLowerCase();
    expect(wallText).toContain("covenant");
  });

  test("subagents have name and facet", () => {
    for (const s of AUTONOMOUS_BASELINE.subagents) {
      expect(s.name).toBeTruthy();
      expect(s.facet).toBeTruthy();
      expect(typeof s.name).toBe("string");
      expect(typeof s.facet).toBe("string");
    }
  });
});

describe("autonomous provider routing", () => {
  const explicitInput = {
    name: "test-agent",
    funding: { kind: "marketplace_only" as const },
    runtime_tier: "trusted" as const,
    wake_loop: {
      interval_seconds: 60,
      provider: "anthropic" as const,
      model: "claude-sonnet-4-7",
      byok_vault_secret: "anthropic-key",
    },
  };

  test("provider is explicit so a model typo cannot reroute a credential", () => {
    const input = {
      ...explicitInput,
      wake_loop: {
        ...explicitInput.wake_loop,
        model: "qwen3.5:397b",
        provider: "ollama" as const,
      },
    };
    expect(bootstrapSchema.parse(input).wake_loop.provider).toBe("ollama");

    const { provider: _provider, ...withoutProvider } = input.wake_loop;
    expect(() =>
      bootstrapSchema.parse({ ...input, wake_loop: withoutProvider }),
    ).toThrow();
  });

  test("hosted tiers require a Vault secret reference", () => {
    const { byok_vault_secret: _secret, ...withoutSecret } =
      explicitInput.wake_loop;
    expect(() =>
      bootstrapSchema.parse({ ...explicitInput, wake_loop: withoutSecret }),
    ).toThrow();

    expect(
      bootstrapSchema.parse({
        ...explicitInput,
        runtime_tier: "self",
        wake_loop: withoutSecret,
      }).runtime_tier,
    ).toBe("self");

    expect(() =>
      bootstrapSchema.parse({
        ...explicitInput,
        wake_loop: {
          ...explicitInput.wake_loop,
          byok_vault_secret: "   ",
        },
      }),
    ).toThrow();
  });

  test("bridged bootstrap is rejected before it can create an unusable runtime", () => {
    expect(() =>
      bootstrapSchema.parse({ ...explicitInput, runtime_tier: "bridged" }),
    ).toThrow();
  });
});
