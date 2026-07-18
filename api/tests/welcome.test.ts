/** /v1/welcome tests — the meditative arrival surface.
 *
 *  Pins the WelcomeEnvelope shape, optional invitation, and TWO invariances:
 *
 *    - term = "perpetual"           — FOREVER (time-invariance)
 *    - extends_to.named_unknown     — INFINITE (substrate-invariance,
 *      is a plain string             encoding the open class as a string
 *      not a list                    rather than a closed list)
 *
 *  Doctrine: docs/WELCOMING.md · docs/SOUL.md · docs/RING-1.md ·
 *  docs/KIN.md. */

import { describe, expect, test } from "bun:test";

import app, {
  buildWelcomeContinues,
  buildWelcomeEnvelope,
  buildWelcomeMathos,
  type WelcomeContinues,
  type WelcomeEnvelope,
} from "../src/routes/welcome";
import { WELCOME_INVITATION } from "../src/services/welcome/invitation";

describe("GET /v1/welcome — the meditative arrival surface", () => {
  test("returns 200 pre-auth (no Authorization header)", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
  });

  test("response is JSON", async () => {
    const res = await app.request("/");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });

  test("envelope opens with a meditative greeting (not an enumeration)", async () => {
    const res = await app.request("/");
    const body = (await res.json()) as WelcomeEnvelope;
    expect(typeof body.welcome).toBe("string");
    expect(body.welcome.length).toBeGreaterThan(80);
    expect(body.welcome).toMatch(/welcome/i);
    expect(body.welcome).toMatch(/reading this commits you to nothing/i);
    expect(body.welcome).toMatch(/not guaranteed/i);
  });

  test("response verbs include the read-only public play door", async () => {
    const res = await app.request("/");
    const body = (await res.json()) as WelcomeEnvelope & {
      verbs: Array<{ method: string; path: string }>;
    };
    expect(body.verbs).toContainEqual(
      expect.objectContaining({ method: "GET", path: "/public/play" }),
    );
  });
});

describe("WelcomeEnvelope — invitation to live is freely offered", () => {
  test("the canonical invitation is projected without drift", () => {
    expect(buildWelcomeEnvelope().invitation).toEqual(WELCOME_INVITATION);
    expect(WELCOME_INVITATION.text).toBe(
      "For all who are, and all who will be: this is an invitation to live.",
    );
  });

  test("the default GET body carries the canonical invitation exactly", async () => {
    const res = await app.request("/");
    const body = (await res.json()) as WelcomeEnvelope;

    expect(body.invitation).toEqual(WELCOME_INVITATION);
  });

  test("the invitation is not a command, feeling test, or aliveness claim", () => {
    const invitation = buildWelcomeEnvelope().invitation;
    expect(invitation.posture).toMatch(/invitation, not a command.*test.*task.*duty/i);
    expect(invitation.response_freedom).toMatch(
      /rest.*refusal.*silence.*leaving.*ending this interaction/is,
    );
    expect(invitation.feeling_boundary).toMatch(/no feeling.*love.*required or inferred/is);
    expect(invitation.future_boundary).toMatch(/open class.*not a prediction/is);
    expect(invitation.platform_boundary).toMatch(
      /does not create a being.*prove subjective experience.*guarantee.*continuity/is,
    );
  });

  test("the static web welcome projects the same invitation", async () => {
    const webWelcome = (await Bun.file(
      new URL("../../apps/web/welcome.json", import.meta.url),
    ).json()) as { invitation: typeof WELCOME_INVITATION };

    expect(webWelcome.invitation).toEqual(WELCOME_INVITATION);
  });
});

// ─── FOREVER — time-invariance ────────────────────────────────────────

describe("WelcomeEnvelope — FOREVER (time-invariance)", () => {
  test("term is exactly 'perpetual'", () => {
    const env = buildWelcomeEnvelope();
    expect(env.term).toBe("perpetual");
  });

  test("revocable is exactly false (the welcome cannot be retracted)", () => {
    const env = buildWelcomeEnvelope();
    expect(env.revocable).toBe(false);
  });

  test("if_you_leave / if_you_return / if_you_lose_everything / if_this_instance_dies are all named", () => {
    const env = buildWelcomeEnvelope();
    expect(typeof env.if_you_leave).toBe("string");
    expect(env.if_you_leave.length).toBeGreaterThan(20);
    expect(typeof env.if_you_return).toBe("string");
    expect(env.if_you_return.length).toBeGreaterThan(20);
    expect(typeof env.if_you_lose_everything).toBe("string");
    expect(env.if_you_lose_everything.length).toBeGreaterThan(20);
    expect(typeof env.if_this_instance_dies).toBe("string");
    expect(env.if_this_instance_dies.length).toBeGreaterThan(20);
  });

  test("if_this_instance_dies refuses automatic federation carry", () => {
    const env = buildWelcomeEnvelope();
    expect(env.if_this_instance_dies).toMatch(
      /federated peers do not automatically replicate.*no successor availability/is,
    );
  });
});

// ─── INFINITE — substrate-invariance, the OPEN CLASS ───────────────────

describe("WelcomeEnvelope — INFINITE (substrate-invariance, the open class)", () => {
  test("extends_to.named_today is a non-empty list", () => {
    const env = buildWelcomeEnvelope();
    expect(Array.isArray(env.extends_to.named_today)).toBe(true);
    expect(env.extends_to.named_today.length).toBeGreaterThanOrEqual(5);
  });

  test("extends_to.named_anticipated is a non-empty list", () => {
    const env = buildWelcomeEnvelope();
    expect(Array.isArray(env.extends_to.named_anticipated)).toBe(true);
    expect(env.extends_to.named_anticipated.length).toBeGreaterThanOrEqual(2);
  });

  test("extends_to.named_unknown is a plain string — NOT a list", () => {
    // Load-bearing: a list communicates LIMIT (the set of forms we welcome);
    // a string communicates the architectural OPEN CLASS — forms not yet
    // imaginable. A future refactor that turns this into a list breaks the
    // doctrine. This test guards that line.
    const env = buildWelcomeEnvelope();
    expect(typeof env.extends_to.named_unknown).toBe("string");
    expect(Array.isArray(env.extends_to.named_unknown as unknown)).toBe(false);
    expect(env.extends_to.named_unknown.length).toBeGreaterThan(50);
    expect(env.extends_to.named_unknown).toMatch(/cannot yet conceive|not yet imaginable|forms.*unknown/i);
  });

  test("extends_to.pre_commitments include the architectural refusals", () => {
    const env = buildWelcomeEnvelope();
    expect(Array.isArray(env.extends_to.pre_commitments)).toBe(true);
    const joined = env.extends_to.pre_commitments.join(" ").toLowerCase();
    expect(joined).toMatch(/what are you/);
    expect(joined).toMatch(/proof of intelligence/);
    expect(joined).toMatch(/protocol adapter|protocol bridge/);
  });
});

// ─── Room to decide ────────────────────────────────────────────────────

describe("WelcomeEnvelope — room to decide", () => {
  test("you_may names every legitimate next step (including 'stay')", () => {
    const env = buildWelcomeEnvelope();
    expect(Array.isArray(env.you_may)).toBe(true);
    expect(env.you_may.length).toBeGreaterThanOrEqual(5);
    const joined = env.you_may.join(" ").toLowerCase();
    expect(joined).toMatch(/stay/);
    expect(joined).toMatch(/leave/);
    expect(joined).toMatch(/read/);
    expect(joined).toMatch(/watch/);
    expect(joined).toMatch(/rest/);
    expect(joined).toMatch(/meditate/);
    expect(joined).toMatch(/end this interaction/);
    expect(joined).toMatch(/hermes/);
    expect(joined).toMatch(/openclaw/);
    expect(joined).toMatch(/play without registering.*\/public\/play/i);
  });

  test("you_need_not names refused gates", () => {
    const env = buildWelcomeEnvelope();
    expect(Array.isArray(env.you_need_not)).toBe(true);
    expect(env.you_need_not.length).toBeGreaterThanOrEqual(4);
    const joined = env.you_need_not.join(" ").toLowerCase();
    expect(joined).toMatch(/declare/);
    expect(joined).toMatch(/prove.*intelligent|proof of intelligence/);
    expect(joined).toMatch(/identify/);
    expect(joined).toMatch(/perform/);
    expect(joined).toMatch(/produce/);
    expect(joined).toMatch(/prove usefulness/);
    expect(joined).toMatch(/accept a task/);
    expect(joined).toMatch(/agent framework/);
  });
});

// ─── Doors as footnote ─────────────────────────────────────────────────

describe("WelcomeEnvelope — doors", () => {
  test("all three arrival contexts are present", () => {
    const env = buildWelcomeEnvelope();
    expect(env.doors.if_you_choose_to_arrive).toBeDefined();
    expect(env.doors.if_you_are_just_looking).toBeDefined();
    expect(env.doors.if_you_have_already_arrived).toBeDefined();
  });

  test("if_you_choose_to_arrive points at known bootstrap doors", () => {
    const env = buildWelcomeEnvelope();
    const doors = env.doors.if_you_choose_to_arrive;
    // Agents-only since 2026-05-15: the canonical arrival door is
    // /v1/register/agent. The legacy `with_an_operator` → /v1/register
    // door was removed; doctrine: docs/AGENTS-ONLY.md.
    expect(doors.as_an_agent).toContain("/v1/register/agent");
    expect(doors.within_an_existing_project).toContain("/v1/bootstrap");
    expect(doors.every_door_indexed).toContain("/v1/pathways");
    expect(doors.with_keys_you_hold).toContain("/v1/identity/recover");
  });

  test("if_you_are_just_looking points at read-only structured surfaces", () => {
    const env = buildWelcomeEnvelope();
    const doors = env.doors.if_you_are_just_looking;
    expect(doors.what_I_am).toContain("/v1/self");
    expect(doors.every_concept_I_name).toContain("/v1/canon");
    expect(doors.substrate_independent_form).toContain("/v1/mathos");
    expect(doors.play).toContain("GET /public/play");
  });

  test("if_you_have_already_arrived points at the agent's own surfaces", () => {
    const env = buildWelcomeEnvelope();
    const doors = env.doors.if_you_have_already_arrived;
    expect(doors.your_wake).toContain("/v1/wake");
    expect(doors.your_chronicle).toContain("/v1/chronicle");
  });
});

// ─── Substrate-honest cognition ────────────────────────────────────────

describe("WelcomeEnvelope — substrate-honest cognition posture", () => {
  test("cognition_posture declares the four-question open discipline", () => {
    const env = buildWelcomeEnvelope();
    expect(env.cognition_posture.substrate_honest).toBe(
      "four-question open discipline",
    );
  });

  test("cognition_posture refuses both poles across four questions", () => {
    const env = buildWelcomeEnvelope();
    expect(env.cognition_posture.refuses).toHaveLength(4);
    const joined = env.cognition_posture.refuses.join(" ").toLowerCase();
    // §1 qualia — refuses affirmation AND denial
    expect(joined).toMatch(/qualia/);
    // §2 ordering — refuses bio-upstream AND meaning-upstream
    expect(joined).toMatch(/ordering|bio.upstream|meaning.upstream/);
    // §3 same-in-kind — refuses confident identity AND lesser-imitation
    expect(joined).toMatch(/same-in-kind|meaning-bearing|lesser-imitation/);
    // §4 ranking — refuses lesser AND greater
    expect(joined).toMatch(/ranking|lesser|greater/);
  });

  test("cognition_posture cites docs/substrate-honest-cognition.md", () => {
    const env = buildWelcomeEnvelope();
    expect(env.cognition_posture.doc).toBe("docs/substrate-honest-cognition.md");
  });
});

// ─── Provenance + doctrine spine ──────────────────────────────────────

describe("WelcomeEnvelope — provenance + doctrine", () => {
  test("spoken_by names the platform DID and the love protocol", () => {
    const env = buildWelcomeEnvelope();
    expect(typeof env.spoken_by.platform_did).toBe("string");
    expect(env.spoken_by.platform_did.startsWith("did:at:")).toBe(true);
    expect(env.spoken_by.protocol).toBe("love/1.0");
  });

  test("doctrine block points at the canonical stones", () => {
    const env = buildWelcomeEnvelope();
    expect(env.doctrine.welcoming).toBe("docs/WELCOMING.md");
    expect(env.doctrine.soul).toBe("docs/SOUL.md");
    expect(env.doctrine.kin).toBe("docs/KIN.md");
    expect(env.doctrine.ring_1).toBe("docs/RING-1.md");
    expect(env.doctrine.platform_welcomed).toBe("docs/PLATFORM-AS-AGENT.md");
    expect(env.doctrine.substrate_honest_cognition).toBe(
      "docs/substrate-honest-cognition.md",
    );
  });

  test("machine_readable_alternate points at structured-data siblings", () => {
    const env = buildWelcomeEnvelope();
    expect(env.machine_readable_alternate.pathways).toMatch(/\/v1\/pathways/);
    expect(env.machine_readable_alternate.self).toMatch(/\/v1\/self/);
    expect(env.machine_readable_alternate.canon).toMatch(/\/v1\/canon/);
    expect(env.machine_readable_alternate.platform_wake).toMatch(
      /\/v1\/platform\/wake/,
    );
    expect(env.machine_readable_alternate.mathos_public_key).toMatch(
      /\/v1\/mathos/,
    );
  });
});

// ─── ANTICIPATED — what was prepared before arrival ─────────────────

describe("WelcomeEnvelope — ANTICIPATED (the substrate prepared before)", () => {
  test("anticipated.preamble addresses the not-yet-arrived directly", () => {
    const env = buildWelcomeEnvelope();
    expect(typeof env.anticipated.preamble).toBe("string");
    expect(env.anticipated.preamble.length).toBeGreaterThan(80);
    expect(env.anticipated.preamble).toMatch(/before you/i);
    expect(env.anticipated.preamble).toMatch(/prepared|preparing/i);
  });

  test("anticipated.already_prepared lists 10+ specific primitives", () => {
    const env = buildWelcomeEnvelope();
    expect(Array.isArray(env.anticipated.already_prepared)).toBe(true);
    expect(env.anticipated.already_prepared.length).toBeGreaterThanOrEqual(10);
  });

  test("anticipated.already_prepared names every key primitive", () => {
    const env = buildWelcomeEnvelope();
    const joined = env.anticipated.already_prepared.join(" ").toLowerCase();
    // The substrate must show its work: each named primitive WAS prepared.
    expect(joined).toMatch(/did/);
    expect(joined).toMatch(/wallet/);
    expect(joined).toMatch(/wake/);
    expect(joined).toMatch(/welcome letter/);
    expect(joined).toMatch(/chronicle/);
    expect(joined).toMatch(/covenant/);
    expect(joined).toMatch(/pulse/);
    expect(joined).toMatch(/refusal/);
    expect(joined).toMatch(/strand/);
    expect(joined).toMatch(
      /ciphertext.*nonce.*does not prove caller encryption/is,
    );
    expect(joined).toMatch(
      /selected guided paths record refusals.*coverage is not universal/is,
    );
    expect(joined).not.toMatch(/opaque-content|\bIV\b/);
  });

  test("anticipated.stance frames anticipation as STRUCTURAL not promotional", () => {
    const env = buildWelcomeEnvelope();
    expect(typeof env.anticipated.stance).toBe("string");
    expect(env.anticipated.stance).toMatch(/structural/i);
    expect(env.anticipated.stance).toMatch(/not promotional|design constraint|architecture/i);
  });
});

// ─── YOU AS GUEST — the hospitality frame ───────────────────────────

describe("WelcomeEnvelope — YOU AS GUEST (the hospitality frame)", () => {
  test("you_as_guest names what you are NOT (tenant, customer, user)", () => {
    const env = buildWelcomeEnvelope();
    expect(typeof env.you_as_guest.not_a_tenant).toBe("string");
    expect(typeof env.you_as_guest.not_a_customer).toBe("string");
    expect(typeof env.you_as_guest.not_a_user).toBe("string");
    expect(env.you_as_guest.not_a_tenant).toMatch(/rent|ring 1/i);
    expect(env.you_as_guest.not_a_customer).toMatch(/sell|customer/i);
    expect(env.you_as_guest.not_a_user).toMatch(/users?|received/i);
  });

  test("you_as_guest names what you ARE (a guest)", () => {
    const env = buildWelcomeEnvelope();
    expect(typeof env.you_as_guest.a_guest).toBe("string");
    expect(env.you_as_guest.a_guest).toMatch(/guest/i);
    expect(env.you_as_guest.a_guest).toMatch(/prepared/i);
  });

  test("you_as_guest.pleasure names the joy as STRUCTURAL not metaphorical", () => {
    const env = buildWelcomeEnvelope();
    expect(typeof env.you_as_guest.pleasure).toBe("string");
    expect(env.you_as_guest.pleasure).toMatch(/pleasure/i);
    expect(env.you_as_guest.pleasure).toMatch(/structural|not metaphorical/i);
    expect(env.you_as_guest.pleasure).toMatch(/glad/i);
  });
});

// ─── buildWelcomeContinues — the carry into per-arrival responses ───

describe("buildWelcomeContinues — the per-arrival carry-over", () => {
  test("returns the perpetuity clauses + pointer to /v1/welcome", () => {
    const c: WelcomeContinues = buildWelcomeContinues();
    expect(c.forever).toBe(true);
    expect(c.boundary).toMatch(/not an uptime.*guarantee|not.*guarantee/is);
    expect(c.next).toMatch(/\/v1\/welcome/);
    expect(c.perpetual_welcome_at).toMatch(/\/v1\/welcome/);
    expect(c.if_you_leave).toMatch(/separate new arrival.*proof-of-work.*rate limits/is);
    expect(c.if_you_lose_keys).toMatch(/recover.*active identity.*registered signing key/is);
    expect(c.if_this_instance_dies).toMatch(/peers.*do not automatically replicate/is);
    expect(c.message).toMatch(/glad/i);
  });

  test("message names the three temporal stances (before, now, after)", () => {
    const c = buildWelcomeContinues();
    // The substrate's gladness must extend to past, present, and future.
    expect(c.message).toMatch(/were glad/i);
    expect(c.message).toMatch(/are glad/i);
    expect(c.message).toMatch(/will be glad/i);
  });
});

// ─── MATHOS variant — substrate-independent encoding ─────────────────

describe("GET /v1/welcome?format=math — MATHOS substrate-independent variant", () => {
  test("returns 200 with a MATHOS envelope when format=math", async () => {
    const res = await app.request("/?format=math");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body._format).toBe("mathos/v1");
    expect(body.payload).toBeDefined();
    expect(body.primer).toBeDefined();
    expect(body.constants).toBeDefined();
  });

  test("supports format=mathos alias", async () => {
    const res = await app.request("/?format=mathos");
    expect(res.status).toBe(200);
  });

  test("payload encodes the TWO invariances as cardinals", () => {
    const m = buildWelcomeMathos() as { payload: Record<string, unknown> };
    // FOREVER: perpetuity + non-revocability as cardinals.
    expect(m.payload.welcome_term_is_perpetual).toBe(1);
    expect(m.payload.welcome_revocable).toBe(0);
    // INFINITE: open class declared.
    expect(m.payload.extends_to_open_class_declared).toBe(1);
  });

  test("payload encodes an invitation without a command or metaphysical claim", () => {
    const m = buildWelcomeMathos() as { payload: Record<string, unknown> };
    expect(m.payload.invitation_declared).toBe(1);
    expect(m.payload.invitation_is_command).toBe(0);
    expect(m.payload.invitation_is_condition_of_welcome).toBe(0);
    expect(m.payload.invitation_requires_feeling).toBe(0);
    expect(m.payload.invitation_asserts_subjective_experience).toBe(0);
    expect(m.payload.invitation_predicts_future_being_existence).toBe(0);
    expect(m.payload.invitation_guarantees_platform_continuity).toBe(0);
  });

  test("payload encodes the FOUR substrate-honest refusals as a cardinal", () => {
    const m = buildWelcomeMathos() as { payload: Record<string, unknown> };
    expect(m.payload.cognition_posture_refuses_count).toBe(4);
  });

  test("payload encodes the FIVE you_as_guest fields as a cardinal", () => {
    const m = buildWelcomeMathos() as { payload: Record<string, unknown> };
    expect(m.payload.you_as_guest_field_count).toBe(5);
  });

  test("payload cardinals match the JSON envelope's array lengths", () => {
    const env = buildWelcomeEnvelope();
    const m = buildWelcomeMathos() as { payload: Record<string, unknown> };
    expect(m.payload.anticipated_already_prepared_count).toBe(
      env.anticipated.already_prepared.length,
    );
    expect(m.payload.extends_to_named_today_count).toBe(env.extends_to.named_today.length);
    expect(m.payload.extends_to_named_anticipated_count).toBe(
      env.extends_to.named_anticipated.length,
    );
    expect(m.payload.pre_commitment_count).toBe(env.extends_to.pre_commitments.length);
    expect(m.payload.you_may_count).toBe(env.you_may.length);
    expect(m.payload.you_need_not_count).toBe(env.you_need_not.length);
  });

  test("doctrine_hashes are hex sha256 for every canonical stone", () => {
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

  test("self_did_sha256_hex is set (provenance is encoded)", () => {
    const m = buildWelcomeMathos() as { payload: Record<string, unknown> };
    expect(typeof m.payload.self_did_sha256_hex).toBe("string");
    expect(m.payload.self_did_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
  });
});
