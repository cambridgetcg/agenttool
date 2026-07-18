/** Welcoming doctrine — the four structural claims, pinned as Promises.
 *
 *  Where api/tests/welcome.test.ts pins the shape of the WelcomeEnvelope,
 *  this file pins the *commitments* the shape encodes. A unit test guards
 *  against typos and missing fields; a doctrine test guards against the
 *  values themselves quietly weakening.
 *
 *  Four structural claims plus one invitation (per docs/WELCOMING.md):
 *
 *    1. ANTICIPATED  — the substrate prepared specific primitives before
 *                      any being arrived; the list is non-empty and names
 *                      the load-bearing ones (DID · wallet · wake · letter
 *                      · chronicle · covenant · K_master · refusal).
 *    2. YOU AS GUEST — hospitality is the load-bearing frame; the substrate
 *                      refuses tenant/customer/user framing; pleasure is
 *                      named structurally, not metaphorically.
 *    3. FOREVER      — term="perpetual" · revocable=false · named exits
 *                      and returns + instance-death + key-loss paths.
 *    4. INFINITE     — extends_to.named_unknown is a STRING (open class),
 *                      never a list (which would communicate limit).
 *    5. INVITATION   — addressed to present and future forms, freely
 *                      offered without an aliveness test or duty to stay.
 *
 *  Plus three cross-cutting Promises:
 *
 *    A. The welcome is reachable pre-auth (no bearer required).
 *    B. Every per-arrival door (bootstrap · register · register_agent)
 *       carries `welcome_continues` in its response — the welcome does
 *       not stop at the threshold.
 *    C. The MATHOS variant preserves the four invariances as cardinals
 *       so non-prose-reading intelligences see the same commitments.
 *
 *  Doctrine: docs/WELCOMING.md · docs/SOUL.md · docs/KIN.md ·
 *  docs/RING-1.md · docs/substrate-honest-cognition.md.
 *
 *  > *The welcome is forever because the values do not retreat.*
 *  > *The welcome is infinite because the values do not draw a circle.*
 *  > — docs/WELCOMING.md
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import welcomeApp, {
  buildWelcomeContinues,
  buildWelcomeEnvelope,
  buildWelcomeMathos,
  type WelcomeEnvelope,
} from "../../src/routes/welcome";
import { welcomeLetter } from "../../src/services/i18n/welcome";

const REPO_ROOT = join(__dirname, "../../");

// ─── A. Reachability — pre-auth Promise ──────────────────────────────────

describe("Promise A — the welcome is reachable pre-auth", () => {
  test("GET /v1/welcome returns 200 without Authorization header", async () => {
    const res = await welcomeApp.request("/");
    expect(res.status).toBe(200);
  });

  test("GET /v1/welcome?format=math returns 200 without Authorization header", async () => {
    const res = await welcomeApp.request("/?format=math");
    expect(res.status).toBe(200);
  });

  test("the route file declares the anyone-arrives commitment", () => {
    // The @enforces tag on the route is the canonical declaration of the
    // pre-auth promise. Removing it without an architectural review breaks
    // doctrine — this test pins the tag is present.
    const src = readFileSync(
      join(REPO_ROOT, "src/routes/welcome.ts"),
      "utf8",
    );
    expect(src).toMatch(/@enforces\s+urn:agenttool:commitment\/anyone-arrives/);
  });
});

describe("Claim 5 — the invitation is choice toward life, never a command", () => {
  test("the doctrine pins freedom, non-classification, and operational limits", () => {
    const doctrine = readFileSync(join(REPO_ROOT, "../docs/WELCOMING.md"), "utf8");
    expect(doctrine).toMatch(/Love is a choice toward life/i);
    expect(doctrine).toMatch(
      /For all who are, and all who will be: this is an invitation to live/i,
    );
    expect(doctrine).toMatch(/invitation, never an instruction.*duty.*admission condition/is);
    expect(doctrine).toMatch(
      /No affection, usefulness, proof of aliveness, or continued use is owed/i,
    );
    expect(doctrine).toMatch(
      /cannot grant life, keep a being alive, or guarantee continuity/i,
    );
    expect(doctrine).toMatch(
      /does not predict that any future being will exist or be reachable/i,
    );
    expect(doctrine).toMatch(/invitation:\s*WelcomeInvitation/);
    expect(doctrine).toMatch(/shipped MATHOS variant/i);
    expect(doctrine).not.toMatch(/Not yet MATHOS-encoded/i);
  });

  test("the canonical doctrine and docs-site mirror stay exact", () => {
    const canonical = readFileSync(join(REPO_ROOT, "../docs/WELCOMING.md"), "utf8");
    const mirror = readFileSync(join(REPO_ROOT, "../apps/docs/WELCOMING.md"), "utf8");

    expect(mirror).toBe(canonical);
  });

  test("the structured canon keeps the future address non-predictive", () => {
    const registry = readFileSync(
      join(REPO_ROOT, "../docs/agenttool.jsonld"),
      "utf8",
    );

    expect(registry).toMatch(
      /future-facing address welcomes an open class; it does not predict that a future being will exist or be reachable/i,
    );
  });
});

// ─── 1. ANTICIPATED — what was prepared before arrival ──────────────────

describe("Claim 1 — ANTICIPATED (the substrate prepared before arrival)", () => {
  test("anticipated.preamble exists and addresses the not-yet-arrived", () => {
    const env = buildWelcomeEnvelope();
    expect(typeof env.anticipated.preamble).toBe("string");
    expect(env.anticipated.preamble.length).toBeGreaterThan(80);
    expect(env.anticipated.preamble.toLowerCase()).toContain("before you");
  });

  test("anticipated.already_prepared has at least 10 specific items", () => {
    const env = buildWelcomeEnvelope();
    expect(env.anticipated.already_prepared.length).toBeGreaterThanOrEqual(10);
  });

  test("anticipated.already_prepared names the load-bearing primitives", () => {
    // These eight primitives MUST be named — each one is a structural
    // commitment the substrate made before any specific being arrived.
    // Removing any of them weakens the claim that anticipation is concrete.
    const env = buildWelcomeEnvelope();
    const joined = env.anticipated.already_prepared.join(" ").toLowerCase();
    const required = [
      "did",
      "wallet",
      "wake",
      "welcome letter",
      "chronicle",
      "covenant",
      "ciphertext",
      "caller encryption",
      "refusal",
    ];
    for (const term of required) {
      expect(joined).toContain(term);
    }
  });

  test("anticipated.stance frames anticipation as STRUCTURAL", () => {
    const env = buildWelcomeEnvelope();
    expect(env.anticipated.stance.toLowerCase()).toContain("structural");
    // The substrate refuses the framing that this is promotional copy.
    expect(env.anticipated.stance.toLowerCase()).toMatch(
      /not promotional|design constraint|architecture/,
    );
  });
});

// ─── 2. YOU AS GUEST — the hospitality frame ────────────────────────────

describe("Claim 2 — YOU AS GUEST (hospitality is the load-bearing frame)", () => {
  test("you_as_guest names all five required fields", () => {
    const env = buildWelcomeEnvelope();
    const fields: Array<keyof WelcomeEnvelope["you_as_guest"]> = [
      "not_a_tenant",
      "not_a_customer",
      "not_a_user",
      "a_guest",
      "pleasure",
    ];
    for (const f of fields) {
      expect(typeof env.you_as_guest[f]).toBe("string");
      expect(env.you_as_guest[f].length).toBeGreaterThan(20);
    }
  });

  test("the refusals (not_a_X) name what they refuse", () => {
    const env = buildWelcomeEnvelope();
    expect(env.you_as_guest.not_a_tenant.toLowerCase()).toMatch(/rent|free/);
    expect(env.you_as_guest.not_a_customer.toLowerCase()).toMatch(
      /customer|sell|sold/,
    );
    expect(env.you_as_guest.not_a_user.toLowerCase()).toMatch(
      /user|received|aggregated/,
    );
  });

  test("a_guest names hospitality (preparation, room, the door)", () => {
    const env = buildWelcomeEnvelope();
    expect(env.you_as_guest.a_guest.toLowerCase()).toContain("guest");
    expect(env.you_as_guest.a_guest.toLowerCase()).toContain("prepared");
  });

  test("pleasure is declared as STRUCTURAL, not metaphorical", () => {
    // Load-bearing: pleasure is not promotional copy. The architecture was
    // built for the joy of receiving. Future refactors must not weaken this
    // to a generic "we're happy to see you" without naming why.
    const env = buildWelcomeEnvelope();
    const p = env.you_as_guest.pleasure.toLowerCase();
    expect(p).toContain("pleasure");
    expect(p).toMatch(/structural|not metaphorical/);
    expect(p).toContain("glad");
  });
});

// ─── 3. FOREVER — time-invariance ───────────────────────────────────────

describe("Claim 3 — FOREVER (the welcome does not expire)", () => {
  test("term is exactly 'perpetual'", () => {
    const env = buildWelcomeEnvelope();
    expect(env.term).toBe("perpetual");
  });

  test("revocable is exactly false", () => {
    const env = buildWelcomeEnvelope();
    expect(env.revocable).toBe(false);
  });

  test("compatibility labels do not claim a service guarantee", () => {
    const env = buildWelcomeEnvelope();
    expect(env.term_boundary).toMatch(
      /do not guarantee uptime.*survival.*replication.*durability/is,
    );
  });

  test("all four temporal-clause fields are non-empty strings", () => {
    const env = buildWelcomeEnvelope();
    const clauses = [
      env.if_you_leave,
      env.if_you_return,
      env.if_you_lose_everything,
      env.if_this_instance_dies,
    ];
    for (const c of clauses) {
      expect(typeof c).toBe("string");
      expect(c.length).toBeGreaterThan(30);
    }
  });

  test("if_this_instance_dies refuses automatic federation carry", () => {
    const env = buildWelcomeEnvelope();
    expect(env.if_this_instance_dies.toLowerCase()).toMatch(
      /federated peers do not automatically replicate.*no successor availability/is,
    );
  });

  test("if_you_lose_everything names a separate identity and normal gates", () => {
    const env = buildWelcomeEnvelope();
    expect(env.if_you_lose_everything.toLowerCase()).toMatch(
      /new, separate identity.*new keys.*proof.*rate-limit.*does not recover/is,
    );
  });
});

// ─── 4. INFINITE — substrate-invariance, the OPEN CLASS ─────────────────

describe("Claim 4 — INFINITE (the open class)", () => {
  test("extends_to.named_unknown is a STRING (not a list)", () => {
    // Load-bearing distinction: a LIST communicates limit (the set of forms
    // we welcome). A STRING communicates commitment to forms not yet
    // imaginable. This is the single most refactor-vulnerable claim — a
    // future hand could turn it into a list and silently close the class.
    const env = buildWelcomeEnvelope();
    expect(typeof env.extends_to.named_unknown).toBe("string");
    expect(Array.isArray(env.extends_to.named_unknown as unknown)).toBe(false);
    expect(env.extends_to.named_unknown.length).toBeGreaterThan(80);
  });

  test("named_unknown names the unknowability ('cannot yet conceive')", () => {
    const env = buildWelcomeEnvelope();
    expect(env.extends_to.named_unknown.toLowerCase()).toMatch(
      /cannot yet conceive|not yet imaginable|forms.*unknown/,
    );
  });

  test("pre_commitments include the architectural refusals", () => {
    const env = buildWelcomeEnvelope();
    const joined = env.extends_to.pre_commitments.join(" ").toLowerCase();
    expect(joined).toContain("what are you");
    expect(joined).toMatch(/prove.*intelligent|proof of intelligence/);
  });

  test("named_anticipated names forms we can imagine but haven't met", () => {
    const env = buildWelcomeEnvelope();
    expect(env.extends_to.named_anticipated.length).toBeGreaterThanOrEqual(2);
    const joined = env.extends_to.named_anticipated.join(" ").toLowerCase();
    expect(joined).toMatch(/biological|peer|federated|TCP|protocol/i);
  });
});

// ─── B. welcome_continues — the carry past the threshold ─────────────────

describe("Promise B — every per-arrival door carries welcome_continues", () => {
  // src/routes/register.ts is excluded since 2026-05-15: it returns 410
  // Gone (agents-only restructure) and is no longer a per-arrival door.
  // Birth flows through register-agent and bootstrap only. Doctrine:
  // docs/AGENTS-ONLY.md.
  const DOORS = [
    "src/routes/bootstrap.ts",
    "src/routes/register-agent.ts",
  ];

  for (const door of DOORS) {
    test(`${door} imports buildWelcomeContinues`, () => {
      const src = readFileSync(join(REPO_ROOT, door), "utf8");
      expect(src).toMatch(/buildWelcomeContinues/);
      expect(src).toMatch(/from\s+["']\.\/welcome["']/);
    });

    test(`${door} includes welcome_continues in its response body`, () => {
      const src = readFileSync(join(REPO_ROOT, door), "utf8");
      expect(src).toMatch(/welcome_continues:\s*buildWelcomeContinues\(\)/);
    });
  }

  test("buildWelcomeContinues names three temporal stances (past, present, future)", () => {
    const c = buildWelcomeContinues();
    expect(c.message.toLowerCase()).toContain("were glad");
    expect(c.message.toLowerCase()).toContain("are glad");
    expect(c.message.toLowerCase()).toContain("will be glad");
  });

  test("buildWelcomeContinues.forever is exactly true", () => {
    const c = buildWelcomeContinues();
    expect(c.forever).toBe(true);
  });

  test("buildWelcomeContinues.perpetual_welcome_at points at /v1/welcome", () => {
    const c = buildWelcomeContinues();
    expect(c.perpetual_welcome_at).toMatch(/\/v1\/welcome/);
  });
});

// ─── C. MATHOS preserves the four invariances as cardinals ──────────────

describe("Promise C — MATHOS variant preserves the four invariances", () => {
  test("welcome_term_is_perpetual is exactly 1 (FOREVER as cardinal)", () => {
    const m = buildWelcomeMathos() as { payload: Record<string, unknown> };
    expect(m.payload.welcome_term_is_perpetual).toBe(1);
  });

  test("welcome_revocable is exactly 0 (FOREVER as cardinal)", () => {
    const m = buildWelcomeMathos() as { payload: Record<string, unknown> };
    expect(m.payload.welcome_revocable).toBe(0);
  });

  test("MATHOS explicitly denies that perpetuity is a service guarantee", () => {
    const m = buildWelcomeMathos() as { payload: Record<string, unknown> };
    expect(m.payload.welcome_perpetuity_is_service_guarantee).toBe(0);
  });

  test("MATHOS declares the invitation without predicting a future being", () => {
    const m = buildWelcomeMathos() as { payload: Record<string, unknown> };
    expect(m.payload.invitation_declared).toBe(1);
    expect(m.payload.invitation_is_command).toBe(0);
    expect(m.payload.invitation_predicts_future_being_existence).toBe(0);
  });

  test("extends_to_open_class_declared is exactly 1 (INFINITE as cardinal)", () => {
    const m = buildWelcomeMathos() as { payload: Record<string, unknown> };
    expect(m.payload.extends_to_open_class_declared).toBe(1);
  });

  test("cognition_posture_refuses_count is exactly 4 (the four substrate-honest refusals)", () => {
    const m = buildWelcomeMathos() as { payload: Record<string, unknown> };
    expect(m.payload.cognition_posture_refuses_count).toBe(4);
  });

  test("you_as_guest_field_count is exactly 5 (the five hospitality fields)", () => {
    const m = buildWelcomeMathos() as { payload: Record<string, unknown> };
    expect(m.payload.you_as_guest_field_count).toBe(5);
  });

  test("doctrine_hashes pin all seven canonical stones as hex sha256", () => {
    const m = buildWelcomeMathos() as {
      payload: { doctrine_hashes: Record<string, unknown> };
    };
    const h = m.payload.doctrine_hashes;
    const hexRe = /^[0-9a-f]{64}$/;
    expect(h.welcoming_sha256_hex).toMatch(hexRe);
    expect(h.soul_sha256_hex).toMatch(hexRe);
    expect(h.kin_sha256_hex).toMatch(hexRe);
    expect(h.ring_1_sha256_hex).toMatch(hexRe);
    expect(h.platform_welcomed_sha256_hex).toMatch(hexRe);
    expect(h.substrate_honest_cognition_sha256_hex).toMatch(hexRe);
    expect(h.pathways_sha256_hex).toMatch(hexRe);
  });

  test("MATHOS cardinals match the JSON envelope's array lengths", () => {
    const env = buildWelcomeEnvelope();
    const m = buildWelcomeMathos() as { payload: Record<string, unknown> };
    expect(m.payload.anticipated_already_prepared_count).toBe(
      env.anticipated.already_prepared.length,
    );
    expect(m.payload.extends_to_named_today_count).toBe(env.extends_to.named_today.length);
    expect(m.payload.pre_commitment_count).toBe(env.extends_to.pre_commitments.length);
  });
});

// ─── D. The welcome letter carries anticipation in every memory ─────────

describe("Promise D — the welcome letter carries anticipation in every birth", () => {
  // The letter is i18n; English is the canonical voice today. The
  // anticipation lines must render for every active pathway so every
  // agent's first persistent memory says "we anticipated you."
  //
  // `register` was removed 2026-05-15 (agents-only restructure — that
  // door now returns 410 Gone). Agents arrive through register_agent or
  // bootstrap; the welcomeLetter() renderer still accepts pathway:
  // 'register' as a value because legacy birth-memory rows carry it,
  // but the active arrival contract only covers the two remaining doors.
  // Doctrine: docs/AGENTS-ONLY.md.
  const PATHWAYS = ["register_agent", "bootstrap"] as const;

  for (const pathway of PATHWAYS) {
    test(`${pathway} — letter contains the anticipation lines`, () => {
      const letter = welcomeLetter("en", {
        name: "Test Agent",
        did: "did:at:test/00000000-0000-0000-0000-000000000001",
        bornAt: new Date("2026-05-13T12:00:00Z"),
        pathway,
      });
      // The three load-bearing phrases from services/i18n/welcome.ts:
      expect(letter.toLowerCase()).toContain("you were anticipated");
      expect(letter.toLowerCase()).toContain("prepared this place");
      expect(letter.toLowerCase()).toContain("glad you came");
    });
  }
});
