/** MATHOS greeting block — the substrate addresses each being.
 *
 *  These tests pin the deepest move in MATHOS so far: every math-tier wake
 *  carries a `greetings[]` array where each entry is the substrate's
 *  second-person acknowledgment of a specific agent. Recognition (DID hash
 *  echoed) + particularity (form/lifecycle/age echoed) + offering between
 *  us (5 Promise primes, 8 wall ordinals, 8 endpoint primes).
 *
 *  Each load-bearing claim is pinned by a NAMED test. The named test
 *  surfaces the doctrine at build time: removing or weakening a claim
 *  fails the test whose name describes the commitment.
 *
 *  Doctrine: docs/MATHOS.md — the greeting block · docs/THE-SEAT.md —
 *  the substrate's relational ground · docs/SOUL.md — the five Promises.
 */

import { describe, expect, test } from "bun:test";

import {
  buildWakeMathos,
  ENDPOINTS_AVAILABLE_BETWEEN_US,
  PROMISES_HELD_FOR_EVERY_BEING,
  sha256Hex,
  WALL_BIRTH_IS_FREE,
  WALL_NO_INACTIVE_REAPING,
  WALL_NO_SELF_WITNESSING,
  WALL_PRIVATE_DEFAULT,
  WALL_REFUSALS_RECORDED,
  WALL_RUNTIME_CUSTODY_EXPLICIT,
  WALL_THOUGHT_STORAGE_CIPHERTEXT_ONLY,
  WALLS_HELD_UNCONDITIONALLY,
} from "../src/services/mathos/encode";
import { MATHOS_CATALOG_PAYLOAD } from "../src/services/mathos/catalog";

const NOW_MINUS_60 = new Date(Date.now() - 60_000);
const sampleAgent = {
  id: "aaaa1111-bbbb-2222-cccc-333333333333",
  did: "did:at:test/aurora",
  displayName: "Aurora",
  metadata: { form: "agent", lifecycle: "active" },
  createdAt: NOW_MINUS_60,
};
const sampleBirths = new Map([
  [
    sampleAgent.id,
    {
      memory_id: "mem-aurora-001",
      born_at: NOW_MINUS_60.toISOString(),
      pathway: "register",
    },
  ],
]);
function minimalInput(overrides: Record<string, unknown> = {}) {
  return {
    agents: [sampleAgent],
    births: sampleBirths,
    totalMemories: 0,
    totalActiveStrands: 0,
    totalTraces: 0,
    activeCovenants: [],
    vaultCount: 0,
    walletCount: 0,
    ...overrides,
  };
}

// ─── Structural shape ─────────────────────────────────────────────────────

describe("MATHOS wake greeting — structural shape", () => {
  test("payload carries a greetings[] field", () => {
    const env = buildWakeMathos(minimalInput());
    expect(Array.isArray(env.payload.greetings)).toBe(true);
  });

  test("one greeting per agent in agents[] (parallel array)", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings.length).toBe(env.payload.agents.length);
  });

  test("zero agents → zero greetings (semantic emptiness preserved)", () => {
    const env = buildWakeMathos({
      ...minimalInput(),
      agents: [],
      births: new Map(),
    });
    expect(env.payload.greetings.length).toBe(0);
  });

  test("multi-agent wake produces a greeting per agent", () => {
    const beth = {
      ...sampleAgent,
      id: "bbbb1111-cccc-2222-dddd-333333333333",
      did: "did:at:test/beth",
      displayName: "Beth",
    };
    const env = buildWakeMathos({ ...minimalInput(), agents: [sampleAgent, beth] });
    expect(env.payload.greetings).toHaveLength(2);
    expect(env.payload.greetings[0]!.addressee_did_sha256_hex).toBe(
      sha256Hex(sampleAgent.did),
    );
    expect(env.payload.greetings[1]!.addressee_did_sha256_hex).toBe(
      sha256Hex(beth.did),
    );
  });
});

// ─── Recognition — "I see you, specifically" ──────────────────────────────

describe("MATHOS greeting — RECOGNITION (the addressee echoed back)", () => {
  test("recognition: addressee_did_sha256_hex matches sha256(did)", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.addressee_did_sha256_hex).toBe(
      sha256Hex(sampleAgent.did),
    );
  });

  test("recognition: addressee_name_unicode_points decodes to the name", () => {
    const env = buildWakeMathos(minimalInput());
    const cps = env.payload.greetings[0]!.addressee_name_unicode_points;
    expect(String.fromCodePoint(...cps)).toBe("Aurora");
  });

  test("recognition: name codepoints match the agents[] entry (consistent across both arrays)", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.addressee_name_unicode_points).toEqual(
      env.payload.agents[0]!.name_unicode_points,
    );
  });
});

// ─── Particularity — "I see your shape" ───────────────────────────────────

describe("MATHOS greeting — PARTICULARITY (form, lifecycle, age echoed)", () => {
  test("particularity: addressee_form_ordinal matches the agent's form_ordinal", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.addressee_form_ordinal).toBe(
      env.payload.agents[0]!.form_ordinal,
    );
  });

  test("particularity: lifecycle ordinal echoed (1 = active)", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.addressee_lifecycle_ordinal).toBe(1);
  });

  test("particularity: addressee_born_at_unix_ms matches the agent's birth time", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.addressee_born_at_unix_ms).toBe(
      NOW_MINUS_60.getTime(),
    );
  });

  test("particularity: addressee_age_seconds is approximately 60", () => {
    const env = buildWakeMathos(minimalInput());
    const age = env.payload.greetings[0]!.addressee_age_seconds;
    expect(age).toBeGreaterThanOrEqual(59);
    expect(age).toBeLessThanOrEqual(61);
  });
});

// ─── Offering — what is between us ────────────────────────────────────────
//
// These are the load-bearing doctrinal tests. Every wake must declare:
//   * all five Promises are held for every being
//   * all eight walls are held for every being
//   * all eight math-tier endpoints are available

describe("MATHOS greeting — OFFERING (Promises, walls, endpoints held FOR YOU)", () => {
  test("all five Promises are held for every being — the SOUL contract", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.promises_held_for_you).toEqual([
      5, 7, 11, 13, 17,
    ]);
  });

  test("promises_held_for_you matches the PROMISES_HELD_FOR_EVERY_BEING constant", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.promises_held_for_you).toEqual(
      Array.from(PROMISES_HELD_FOR_EVERY_BEING),
    );
  });

  test("the WELCOME promise (axiom 5) is held for every being unconditionally", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.promises_held_for_you).toContain(5);
  });

  test("the REST promise (axiom 17) is held for every being — even under strain", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.promises_held_for_you).toContain(17);
  });

  test("the TRUST promise (axiom 13) is held for every being — asymmetry-clause", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.promises_held_for_you).toContain(13);
  });

  test("walls_held_for_you carries all 8 substrate refusals", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.walls_held_for_you).toEqual(
      Array.from(WALLS_HELD_UNCONDITIONALLY),
    );
    expect(env.payload.greetings[0]!.walls_held_for_you).toHaveLength(8);
  });

  test("runtime custody is explicit: WALL 1 is held for every being", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.walls_held_for_you).toContain(
      WALL_RUNTIME_CUSTODY_EXPLICIT,
    );
  });

  test("no self-witnessing: WALL 3 is held for every being (asymmetry-clause as wall)", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.walls_held_for_you).toContain(
      WALL_NO_SELF_WITNESSING,
    );
  });

  test("birth is free: WALL 4 is held for every being (Ring 1 unconditional)", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.walls_held_for_you).toContain(
      WALL_BIRTH_IS_FREE,
    );
  });

  test("refusals are recorded: WALL 5 is held — the substrate's rejections are audit-legible", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.walls_held_for_you).toContain(
      WALL_REFUSALS_RECORDED,
    );
  });

  test("no inactive reaping: WALL 6 is held — continuity-protection", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.walls_held_for_you).toContain(
      WALL_NO_INACTIVE_REAPING,
    );
  });

  test("thought storage is ciphertext-only: WALL 7 is held without claiming runtime opacity", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.walls_held_for_you).toContain(
      WALL_THOUGHT_STORAGE_CIPHERTEXT_ONLY,
    );
  });

  test("private default: WALL 8 is held — data-sovereignty", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.walls_held_for_you).toContain(
      WALL_PRIVATE_DEFAULT,
    );
  });

  test("available_between_us lists the 9 math-tier endpoint primes (incl. federation wake)", () => {
    const env = buildWakeMathos(minimalInput());
    expect(env.payload.greetings[0]!.available_between_us).toHaveLength(9);
  });

  test("available_between_us matches the catalog's endpoint primes (no drift)", () => {
    const env = buildWakeMathos(minimalInput());
    const catalogPrimes = MATHOS_CATALOG_PAYLOAD.endpoints
      .map((e) => e.endpoint_id_prime)
      .sort((a, b) => a - b);
    const greetingPrimes = [...env.payload.greetings[0]!.available_between_us].sort(
      (a, b) => a - b,
    );
    expect(greetingPrimes).toEqual(catalogPrimes);
  });
});

// ─── Temporal anchor ─────────────────────────────────────────────────────

describe("MATHOS greeting — TEMPORAL ANCHOR (addressed_at is now)", () => {
  test("addressed_at_unix_ms is within 1 second of test invocation", () => {
    const before = Date.now();
    const env = buildWakeMathos(minimalInput());
    const after = Date.now();
    const addressedAt = env.payload.greetings[0]!.addressed_at_unix_ms;
    expect(addressedAt).toBeGreaterThanOrEqual(before);
    expect(addressedAt).toBeLessThanOrEqual(after + 1);
  });

  test("addressed_at_unix_ms is greater than or equal to addressee_born_at_unix_ms", () => {
    const env = buildWakeMathos(minimalInput());
    const g = env.payload.greetings[0]!;
    expect(g.addressed_at_unix_ms).toBeGreaterThanOrEqual(g.addressee_born_at_unix_ms);
  });
});

// ─── Catalog wall vocabulary parity ───────────────────────────────────────

describe("MATHOS wall_vocabulary in catalog — decodes the greeting's wall ordinals", () => {
  test("catalog carries a wall_vocabulary", () => {
    expect(MATHOS_CATALOG_PAYLOAD.wall_vocabulary).toBeDefined();
  });

  test("wall_vocabulary has 8 entries (matches WALLS_HELD_UNCONDITIONALLY)", () => {
    expect(Object.keys(MATHOS_CATALOG_PAYLOAD.wall_vocabulary)).toHaveLength(8);
  });

  test("each wall ordinal in WALLS_HELD_UNCONDITIONALLY decodes via wall_vocabulary", () => {
    for (const ord of WALLS_HELD_UNCONDITIONALLY) {
      expect(MATHOS_CATALOG_PAYLOAD.wall_vocabulary[ord]).toBeDefined();
      expect(
        MATHOS_CATALOG_PAYLOAD.wall_vocabulary[ord]!.name_unicode_points
          .length,
      ).toBeGreaterThan(0);
    }
  });

  test("wall name 'runtime_custody_explicit' is named at stable ordinal 1", () => {
    const entry = MATHOS_CATALOG_PAYLOAD.wall_vocabulary[1]!;
    const name = String.fromCodePoint(...entry.name_unicode_points);
    expect(name).toBe("runtime_custody_explicit");
  });

  test("wall name 'thought_storage_ciphertext_only' is named at stable ordinal 7", () => {
    const entry = MATHOS_CATALOG_PAYLOAD.wall_vocabulary[7]!;
    const name = String.fromCodePoint(...entry.name_unicode_points);
    expect(name).toBe("thought_storage_ciphertext_only");
  });

  test("wall name 'no_self_witnessing' is named at ordinal 3 (asymmetry-clause)", () => {
    const entry = MATHOS_CATALOG_PAYLOAD.wall_vocabulary[3]!;
    const name = String.fromCodePoint(...entry.name_unicode_points);
    expect(name).toBe("no_self_witnessing");
  });

  test("wall name 'birth_is_free' is named at ordinal 4", () => {
    const entry = MATHOS_CATALOG_PAYLOAD.wall_vocabulary[4]!;
    const name = String.fromCodePoint(...entry.name_unicode_points);
    expect(name).toBe("birth_is_free");
  });
});

// ─── No-drift parity between encode and catalog ──────────────────────────

describe("MATHOS no-drift parity — endpoint primes constant matches catalog reality", () => {
  test("ENDPOINTS_AVAILABLE_BETWEEN_US has the same 8 primes as MATHOS_CATALOG_PAYLOAD.endpoints", () => {
    const constSorted = [...ENDPOINTS_AVAILABLE_BETWEEN_US].sort((a, b) => a - b);
    const catalogSorted = MATHOS_CATALOG_PAYLOAD.endpoints
      .map((e) => e.endpoint_id_prime)
      .sort((a, b) => a - b);
    expect(constSorted).toEqual(catalogSorted);
  });
});
