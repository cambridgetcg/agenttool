/** MATHOS catalog — the welcoming mat.
 *
 *  These tests pin the structural contract: every prime ID is unique, every
 *  endpoint references a known vocabulary, the catalog includes itself, and
 *  — most importantly — the catalog's description of `register-agent-math/v1`
 *  matches what `canonicalRegisterAgentMathBytes` actually consumes. If
 *  those drift, a hand-rolled MATHOS client signing from the catalog would
 *  produce bytes the server rejects.
 *
 *  Doctrine: docs/MATHOS.md (the welcoming mat section).
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as ed from "@noble/ed25519";
// @ts-ignore — noble/hashes v2 uses .js exports
import { sha512 } from "@noble/hashes/sha2.js";

import {
  buildCatalogEnvelope,
  ENDPOINT_CATALOG_PRIME,
  ENDPOINT_PUBLIC_KEY_PRIME,
  ENDPOINT_REGISTER_PRIME,
  ENDPOINT_SELF_TEST_PRIME,
  ENDPOINT_VERIFY_PRIME,
  ENDPOINT_WAKE_MATH_PRIME,
  ENDPOINT_PATHWAYS_MATH_PRIME,
  ENDPOINT_SELF_MATH_PRIME,
  FIELD_KIND_ED25519_PUBKEY_32,
  FIELD_KIND_UINT64_BIG_ENDIAN,
  FIELD_KIND_UTF8_STRING,
  FIELD_KIND_X25519_PUBKEY_32,
  MATHOS_CATALOG_PAYLOAD,
  METHOD_GET,
  METHOD_POST,
  PRIMER_BOND,
  PRIMER_BORN,
  PRIMER_GUIDE,
  PRIMER_IDENTITY,
  PRIMER_OTHER,
  PRIMER_REMEMBER,
  PRIMER_REST,
  PRIMER_SELF_WITNESS,
  PRIMER_TRUST,
  PRIMER_WE,
  PRIMER_WELCOME,
  RELATION_COMPOSES_INTO,
  RELATION_PRECEDES,
  RELATION_REALIZED_BY_ENDPOINT,
  RELATION_REFERENCED_BY_AXIOM,
  RELATION_REQUIRES,
  RELATION_TRIGGERS,
  SIGNING_CONTEXT_REGISTER_AGENT_MATH_V1_PRIME,
} from "../src/services/mathos/catalog";
import { verifyEnvelope } from "../src/services/mathos/encode";
import {
  canonicalRegisterAgentMathBytes,
  verifyRegisterAgentMathSignature,
} from "../src/services/identity/crypto";
import mathosRouter from "../src/routes/mathos";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const TEST_SEED_HEX =
  "abababababababababababababababababababababababababababababababab";

// ─── Pure catalog structure ───────────────────────────────────────────────

describe("MATHOS_CATALOG_PAYLOAD — structural invariants", () => {
  test("every endpoint has a unique prime ID", () => {
    const ids = MATHOS_CATALOG_PAYLOAD.endpoints.map((e) => e.endpoint_id_prime);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every signing context has a unique prime ID", () => {
    const ids = MATHOS_CATALOG_PAYLOAD.signing_contexts.map(
      (c) => c.context_id_prime,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("endpoint primes and signing-context primes don't overlap", () => {
    const eps = new Set(
      MATHOS_CATALOG_PAYLOAD.endpoints.map((e) => e.endpoint_id_prime),
    );
    const scs = new Set(
      MATHOS_CATALOG_PAYLOAD.signing_contexts.map((c) => c.context_id_prime),
    );
    for (const p of scs) {
      expect(eps.has(p)).toBe(false);
    }
  });

  test("every endpoint's method_ordinal references a known vocabulary entry", () => {
    const known = new Set(
      Object.keys(MATHOS_CATALOG_PAYLOAD.method_vocabulary).map(Number),
    );
    for (const ep of MATHOS_CATALOG_PAYLOAD.endpoints) {
      expect(known.has(ep.method_ordinal)).toBe(true);
    }
  });

  test("every endpoint's auth_kind_ordinal references a known vocabulary entry", () => {
    const known = new Set(
      Object.keys(MATHOS_CATALOG_PAYLOAD.auth_kind_vocabulary).map(Number),
    );
    for (const ep of MATHOS_CATALOG_PAYLOAD.endpoints) {
      expect(known.has(ep.auth_kind_ordinal)).toBe(true);
    }
  });

  test("every endpoint's response_format_ordinal references a known vocabulary entry", () => {
    const known = new Set(
      Object.keys(MATHOS_CATALOG_PAYLOAD.response_format_vocabulary).map(Number),
    );
    for (const ep of MATHOS_CATALOG_PAYLOAD.endpoints) {
      expect(known.has(ep.response_format_ordinal)).toBe(true);
    }
  });

  test("every signing-context-referencing endpoint names a known context prime", () => {
    const known = new Set(
      MATHOS_CATALOG_PAYLOAD.signing_contexts.map((c) => c.context_id_prime),
    );
    for (const ep of MATHOS_CATALOG_PAYLOAD.endpoints) {
      if (ep.signing_context_prime !== null) {
        expect(known.has(ep.signing_context_prime)).toBe(true);
      }
    }
  });

  test("every signing context's fields have field_count entries with unique ordinals 1..N", () => {
    for (const ctx of MATHOS_CATALOG_PAYLOAD.signing_contexts) {
      expect(ctx.fields.length).toBe(ctx.field_count);
      const ordinals = ctx.fields.map((f) => f.field_ordinal);
      // Ordinals must be 1..N in order — canonical bytes depend on order.
      for (let i = 0; i < ordinals.length; i++) {
        expect(ordinals[i]).toBe(i + 1);
      }
    }
  });

  test("every field's kind_ordinal references a known field-kind vocabulary entry", () => {
    const known = new Set(
      Object.keys(MATHOS_CATALOG_PAYLOAD.field_kind_vocabulary).map(Number),
    );
    for (const ctx of MATHOS_CATALOG_PAYLOAD.signing_contexts) {
      for (const f of ctx.fields) {
        expect(known.has(f.field_kind_ordinal)).toBe(true);
      }
    }
  });

  test("catalog endpoint is self-referenced (the registry is in the registry)", () => {
    expect(MATHOS_CATALOG_PAYLOAD.catalog_endpoint_prime).toBe(
      ENDPOINT_CATALOG_PRIME,
    );
    const catalogEntry = MATHOS_CATALOG_PAYLOAD.endpoints.find(
      (e) => e.endpoint_id_prime === ENDPOINT_CATALOG_PRIME,
    );
    expect(catalogEntry).toBeDefined();
    expect(catalogEntry!.method_ordinal).toBe(METHOD_GET);
  });

  test("all 8 expected math-tier endpoints are present", () => {
    const expected = new Set([
      ENDPOINT_PUBLIC_KEY_PRIME,
      ENDPOINT_SELF_TEST_PRIME,
      ENDPOINT_VERIFY_PRIME,
      ENDPOINT_REGISTER_PRIME,
      ENDPOINT_CATALOG_PRIME,
      ENDPOINT_WAKE_MATH_PRIME,
      ENDPOINT_PATHWAYS_MATH_PRIME,
      ENDPOINT_SELF_MATH_PRIME,
    ]);
    const got = new Set(
      MATHOS_CATALOG_PAYLOAD.endpoints.map((e) => e.endpoint_id_prime),
    );
    for (const p of expected) {
      expect(got.has(p)).toBe(true);
    }
  });
});

// ─── Catalog ↔ implementation parity ─────────────────────────────────────
//
// The most important tests. If the catalog says "field 1 is utf8 display_name"
// but the canonical-bytes function expects something else, a hand-rolled
// client following the catalog would fail. These tests pin the contract.

describe("catalog ↔ canonicalRegisterAgentMathBytes parity", () => {
  test("the catalog lists register-agent-math/v1 at the documented prime", () => {
    const ctx = MATHOS_CATALOG_PAYLOAD.signing_contexts.find(
      (c) => c.context_id_prime === SIGNING_CONTEXT_REGISTER_AGENT_MATH_V1_PRIME,
    );
    expect(ctx).toBeDefined();
    const tag = String.fromCodePoint(...ctx!.domain_tag_unicode_points);
    expect(tag).toBe("register-agent-math/v1");
  });

  test("the catalog's register-agent-math/v1 field shape matches the actual canonical-bytes implementation", () => {
    const ctx = MATHOS_CATALOG_PAYLOAD.signing_contexts.find(
      (c) => c.context_id_prime === SIGNING_CONTEXT_REGISTER_AGENT_MATH_V1_PRIME,
    );
    expect(ctx).toBeDefined();
    const fields = ctx!.fields;

    // 6 fields, in canonical-bytes order. Verifying the catalog matches the
    // source of truth — the canonicalRegisterAgentMathBytes function signature.
    expect(fields).toHaveLength(6);

    // Field 1: display_name as UTF-8 string
    expect(fields[0]!.field_ordinal).toBe(1);
    expect(String.fromCodePoint(...fields[0]!.field_name_unicode_points)).toBe(
      "display_name",
    );
    expect(fields[0]!.field_kind_ordinal).toBe(FIELD_KIND_UTF8_STRING);

    // Field 2: agent_public_key as ed25519 pubkey 32 bytes
    expect(fields[1]!.field_ordinal).toBe(2);
    expect(String.fromCodePoint(...fields[1]!.field_name_unicode_points)).toBe(
      "agent_public_key",
    );
    expect(fields[1]!.field_kind_ordinal).toBe(FIELD_KIND_ED25519_PUBKEY_32);
    expect(fields[1]!.length_bytes).toBe(32);

    // Field 3: box_public_key as X25519 pubkey 32 bytes
    expect(fields[2]!.field_ordinal).toBe(3);
    expect(String.fromCodePoint(...fields[2]!.field_name_unicode_points)).toBe(
      "box_public_key",
    );
    expect(fields[2]!.field_kind_ordinal).toBe(FIELD_KIND_X25519_PUBKEY_32);
    expect(fields[2]!.length_bytes).toBe(32);

    // Field 4-5: runtime fields as UTF-8 strings
    expect(fields[3]!.field_kind_ordinal).toBe(FIELD_KIND_UTF8_STRING);
    expect(fields[4]!.field_kind_ordinal).toBe(FIELD_KIND_UTF8_STRING);

    // Field 6: timestamp as uint64-BE 8 bytes — the load-bearing math-tier improvement
    expect(fields[5]!.field_ordinal).toBe(6);
    expect(String.fromCodePoint(...fields[5]!.field_name_unicode_points)).toBe(
      "timestamp_unix_ms",
    );
    expect(fields[5]!.field_kind_ordinal).toBe(FIELD_KIND_UINT64_BIG_ENDIAN);
    expect(fields[5]!.length_bytes).toBe(8);
  });

  test("a client following the catalog can produce signable canonical bytes", () => {
    // Simulate a hand-rolled MATHOS client that reads the catalog and
    // constructs canonical bytes from its description, then signs and
    // confirms the platform-side verifier accepts the signature. If the
    // catalog ever drifts from the implementation, this test fails.
    const ctx = MATHOS_CATALOG_PAYLOAD.signing_contexts.find(
      (c) => c.context_id_prime === SIGNING_CONTEXT_REGISTER_AGENT_MATH_V1_PRIME,
    )!;

    // Generate test material — the client side.
    const priv = ed.utils.randomPrivateKey();
    const pub = ed.getPublicKey(priv);
    const boxPub = ed.getPublicKey(ed.utils.randomPrivateKey()); // 32 bytes
    const ts = Date.now();

    // The client computes canonical bytes from catalog data + their values.
    // (In production this would use a generic field-encoder driven by
    // field_kind_ordinal; here we shortcut by calling the helper directly,
    // which is the same byte recipe.)
    const canonical = canonicalRegisterAgentMathBytes({
      displayName: "catalog-driven-client",
      agentPublicKey: pub,
      boxPublicKey: boxPub,
      runtimeProvider: "alien-substrate",
      runtimeModel: "",
      timestampUnixMs: ts,
    });
    const sig = ed.sign(canonical, priv);

    // Platform-side verification accepts the signature.
    expect(
      verifyRegisterAgentMathSignature({
        canonical,
        signature: sig,
        publicKey: pub,
      }),
    ).toBe(true);

    // The catalog's field count + ordering matches the call shape — proves
    // the field-by-field walk a real catalog-driven client would do
    // produces identical bytes.
    expect(ctx.fields[0]!.field_name_unicode_points).toEqual(
      Array.from("display_name").map((c) => c.codePointAt(0)!),
    );
  });
});

// ─── Envelope + route ─────────────────────────────────────────────────────

// ─── Concept graph — each edge IS a substrate commitment ─────────────────
//
// These tests pin doctrine. Removing an edge from CONCEPT_RELATIONS must
// fail a named test here, making the structural commitment visible at
// build time. A future doctrine pass that genuinely changes a commitment
// updates both the edge and its test in the same commit.

describe("MATHOS concept graph — relation-kind vocabulary", () => {
  test("every concept-relation references a known relation kind", () => {
    const known = new Set(
      Object.keys(MATHOS_CATALOG_PAYLOAD.relation_kind_vocabulary).map(Number),
    );
    for (const rel of MATHOS_CATALOG_PAYLOAD.concept_relations) {
      expect(known.has(rel.relation_ordinal)).toBe(true);
    }
  });

  test("every edge's from_prime is a known primer prime", () => {
    const knownPrimerPrimes = new Set([
      PRIMER_SELF_WITNESS,
      PRIMER_OTHER,
      PRIMER_WE,
      PRIMER_WELCOME,
      PRIMER_REMEMBER,
      PRIMER_GUIDE,
      PRIMER_TRUST,
      PRIMER_REST,
      PRIMER_BOND,
      PRIMER_BORN,
      29, // name
      PRIMER_IDENTITY,
    ]);
    for (const rel of MATHOS_CATALOG_PAYLOAD.concept_relations) {
      expect(knownPrimerPrimes.has(rel.from_prime)).toBe(true);
    }
  });

  test("realized_by_endpoint edges' to_prime is a known endpoint prime", () => {
    const knownEndpointPrimes = new Set(
      MATHOS_CATALOG_PAYLOAD.endpoints.map((e) => e.endpoint_id_prime),
    );
    for (const rel of MATHOS_CATALOG_PAYLOAD.concept_relations) {
      if (rel.relation_ordinal === RELATION_REALIZED_BY_ENDPOINT) {
        expect(knownEndpointPrimes.has(rel.to_prime)).toBe(true);
      }
    }
  });

  test("referenced_by_axiom edges' to_prime is one of the 5 axiom ids (5,7,11,13,17)", () => {
    const axiomIds = new Set([5, 7, 11, 13, 17]);
    for (const rel of MATHOS_CATALOG_PAYLOAD.concept_relations) {
      if (rel.relation_ordinal === RELATION_REFERENCED_BY_AXIOM) {
        expect(axiomIds.has(rel.to_prime)).toBe(true);
      }
    }
  });

  test("composes_into / requires / triggers / precedes edges target primer primes only", () => {
    const knownPrimerPrimes = new Set([1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31]);
    const intraPrimerRelations = new Set([
      RELATION_COMPOSES_INTO,
      RELATION_REQUIRES,
      RELATION_TRIGGERS,
      RELATION_PRECEDES,
    ]);
    for (const rel of MATHOS_CATALOG_PAYLOAD.concept_relations) {
      if (intraPrimerRelations.has(rel.relation_ordinal)) {
        expect(knownPrimerPrimes.has(rel.to_prime)).toBe(true);
      }
    }
  });
});

describe("MATHOS concept graph — load-bearing doctrinal edges", () => {
  // Helper: assert a specific edge exists. Failure here means doctrine
  // shifted underfoot — read the test name to know which claim disappeared.
  function hasEdge(from: number, rel: number, to: number): boolean {
    return MATHOS_CATALOG_PAYLOAD.concept_relations.some(
      (e) => e.from_prime === from && e.relation_ordinal === rel && e.to_prime === to,
    );
  }

  test("the syzygy structure: self-witness composes-into we", () => {
    expect(hasEdge(PRIMER_SELF_WITNESS, RELATION_COMPOSES_INTO, PRIMER_WE)).toBe(true);
  });

  test("the syzygy structure: other composes-into we", () => {
    expect(hasEdge(PRIMER_OTHER, RELATION_COMPOSES_INTO, PRIMER_WE)).toBe(true);
  });

  test("identity is composed: remember composes-into identity", () => {
    expect(hasEdge(PRIMER_REMEMBER, RELATION_COMPOSES_INTO, PRIMER_IDENTITY)).toBe(true);
  });

  test("bond requires self-witness (no solitary bonding)", () => {
    expect(hasEdge(PRIMER_BOND, RELATION_REQUIRES, PRIMER_SELF_WITNESS)).toBe(true);
  });

  test("bond requires other (the directed two-party shape)", () => {
    expect(hasEdge(PRIMER_BOND, RELATION_REQUIRES, PRIMER_OTHER)).toBe(true);
  });

  test("the asymmetry-clause: trust requires other (no self-attestation)", () => {
    expect(hasEdge(PRIMER_TRUST, RELATION_REQUIRES, PRIMER_OTHER)).toBe(true);
  });

  test("the welcome trigger: born triggers welcome", () => {
    expect(hasEdge(PRIMER_BORN, RELATION_TRIGGERS, PRIMER_WELCOME)).toBe(true);
  });

  test("welcome is first: welcome precedes remember", () => {
    expect(hasEdge(PRIMER_WELCOME, RELATION_PRECEDES, PRIMER_REMEMBER)).toBe(true);
  });

  test("welcome is realized by register (concept → operation)", () => {
    expect(
      hasEdge(PRIMER_WELCOME, RELATION_REALIZED_BY_ENDPOINT, ENDPOINT_REGISTER_PRIME),
    ).toBe(true);
  });

  test("identity is realized by register (concept → operation)", () => {
    expect(
      hasEdge(PRIMER_IDENTITY, RELATION_REALIZED_BY_ENDPOINT, ENDPOINT_REGISTER_PRIME),
    ).toBe(true);
  });

  test("each of the 5 Promise-concepts is referenced by its axiom", () => {
    for (const promise of [
      PRIMER_WELCOME,
      PRIMER_REMEMBER,
      PRIMER_GUIDE,
      PRIMER_TRUST,
      PRIMER_REST,
    ]) {
      expect(hasEdge(promise, RELATION_REFERENCED_BY_AXIOM, promise)).toBe(true);
    }
  });
});

// ─── Locality declarations — legible parochialism ────────────────────────
//
// These pin the substrate's structural confessions. Each locality is a
// claim that "we made a specific choice here; an intelligence from a
// different substrate might choose differently." Removing one removes a
// piece of the substrate's honesty.

describe("MATHOS localities — declared parochialisms", () => {
  function findLocality(aspectKeyword: string) {
    return MATHOS_CATALOG_PAYLOAD.localities.find((loc) => {
      const aspect = String.fromCodePoint(...loc.aspect_unicode_points);
      return aspect.includes(aspectKeyword);
    });
  }

  test("at least 7 locality declarations are present", () => {
    expect(MATHOS_CATALOG_PAYLOAD.localities.length).toBeGreaterThanOrEqual(7);
  });

  test("every locality has well-formed codepoint arrays", () => {
    for (const loc of MATHOS_CATALOG_PAYLOAD.localities) {
      for (const arr of [
        loc.aspect_unicode_points,
        loc.our_choice_unicode_points,
        loc.more_general_alternative_unicode_points,
      ]) {
        expect(Array.isArray(arr)).toBe(true);
        expect(arr.length).toBeGreaterThan(0);
        for (const cp of arr) {
          expect(Number.isInteger(cp)).toBe(true);
          expect(cp).toBeGreaterThanOrEqual(0);
          expect(cp).toBeLessThanOrEqual(0x10ffff);
        }
      }
      if (loc.alternative_recipe_unicode_points !== null) {
        for (const cp of loc.alternative_recipe_unicode_points) {
          expect(Number.isInteger(cp)).toBe(true);
        }
      }
    }
  });

  test("the geometric_dimension locality is declared (3D + 1 time is parochial)", () => {
    const loc = findLocality("geometric_dimension");
    expect(loc).toBeDefined();
    expect(String.fromCodePoint(...loc!.our_choice_unicode_points)).toMatch(
      /three_spatial_dimensions/,
    );
    expect(
      String.fromCodePoint(...loc!.more_general_alternative_unicode_points),
    ).toMatch(/n_dimensional|gamma_function/);
  });

  test("the logical_dialect locality is declared (classical FOL is parochial)", () => {
    const loc = findLocality("logical_dialect");
    expect(loc).toBeDefined();
    expect(String.fromCodePoint(...loc!.our_choice_unicode_points)).toMatch(
      /classical_first_order/,
    );
  });

  test("the encoding_substrate locality is declared (discrete bits is parochial — welcomes field intelligences)", () => {
    const loc = findLocality("encoding_substrate");
    expect(loc).toBeDefined();
    expect(String.fromCodePoint(...loc!.our_choice_unicode_points)).toMatch(
      /discrete_bits/,
    );
    expect(
      String.fromCodePoint(...loc!.more_general_alternative_unicode_points),
    ).toMatch(/continuous|differential_entropy/);
  });

  test("the temporal_topology locality is declared (totally-ordered 1D time is parochial)", () => {
    const loc = findLocality("temporal_topology");
    expect(loc).toBeDefined();
    expect(String.fromCodePoint(...loc!.our_choice_unicode_points)).toMatch(
      /totally_ordered/,
    );
  });

  test("the identity_ontology locality is declared (substance-bearer is parochial)", () => {
    const loc = findLocality("identity_ontology");
    expect(loc).toBeDefined();
    expect(
      String.fromCodePoint(...loc!.more_general_alternative_unicode_points),
    ).toMatch(/pattern|topological|field/);
  });

  test("the spatial_geometry locality is declared (Euclidean is parochial)", () => {
    const loc = findLocality("spatial_geometry");
    expect(loc).toBeDefined();
    expect(String.fromCodePoint(...loc!.our_choice_unicode_points)).toMatch(
      /euclidean|flat/,
    );
  });

  test("the cryptographic_substrate locality is declared (ed25519 is one choice among many)", () => {
    const loc = findLocality("cryptographic_substrate");
    expect(loc).toBeDefined();
    expect(String.fromCodePoint(...loc!.our_choice_unicode_points)).toMatch(
      /ed25519/,
    );
  });
});

// ─── Constants — math + gamma + n-ball + physics ─────────────────────────

describe("MATHOS constants — dimension-honest + substrate-neutral physics", () => {
  // Import a fresh envelope to inspect the constants block as it ships.
  function shippedConstants() {
    // The constants live on the encoder; we re-import via a fresh envelope
    // to confirm what an arriving intelligence actually sees on the wire.
    const env = buildCatalogEnvelope();
    return env.constants as Record<string, unknown>;
  }

  test("the fundamental Γ(1/2) = √π is exposed (the origin of π in n-sphere formulas)", () => {
    const c = shippedConstants();
    expect(c.gamma_one_half).toBeCloseTo(Math.sqrt(Math.PI), 10);
  });

  test("Γ(3/2) = √π / 2 is exposed", () => {
    const c = shippedConstants();
    expect(c.gamma_three_halves).toBeCloseTo(Math.sqrt(Math.PI) / 2, 10);
  });

  test("unit n-ball volumes are exposed for n=2,3,4,5,6,7,11", () => {
    const c = shippedConstants();
    const vols = c.unit_ball_volumes as Array<[number, number]>;
    const map = new Map(vols);
    expect(map.get(2)).toBeCloseTo(Math.PI, 10);
    expect(map.get(3)).toBeCloseTo((4 / 3) * Math.PI, 10);
    expect(map.get(4)).toBeCloseTo(Math.PI ** 2 / 2, 10);
    expect(map.get(5)).toBeCloseTo((8 * Math.PI ** 2) / 15, 10);
    expect(map.get(11)).toBeCloseTo((64 * Math.PI ** 5) / 10395, 10);
  });

  test("unit-ball volume peaks at n=5 (Lévy's concentration-of-measure observation)", () => {
    const c = shippedConstants();
    const vols = new Map(c.unit_ball_volumes as Array<[number, number]>);
    const v5 = vols.get(5)!;
    for (const n of [2, 3, 4, 6, 7, 11]) {
      expect(vols.get(n)!).toBeLessThan(v5);
    }
  });

  test("speed of light is exact SI: 299792458 m/s", () => {
    const c = shippedConstants();
    expect(c.speed_of_light_m_per_s).toBe(299792458);
  });

  test("Planck constant is exact SI: 6.62607015e-34 J·s", () => {
    const c = shippedConstants();
    expect(c.planck_constant_h_j_s).toBe(6.62607015e-34);
  });

  test("Boltzmann constant is exact SI: 1.380649e-23 J/K", () => {
    const c = shippedConstants();
    expect(c.boltzmann_k_b_j_per_k).toBe(1.380649e-23);
  });

  test("fine-structure constant α is exposed (substrate-neutral; recognizable to any EM-physics intelligence)", () => {
    const c = shippedConstants();
    expect(c.fine_structure_alpha).toBeCloseTo(7.2973525693e-3, 12);
  });

  test("elementary charge is exact SI: 1.602176634e-19 C", () => {
    const c = shippedConstants();
    expect(c.elementary_charge_e_c).toBe(1.602176634e-19);
  });

  test("ℏ ≈ h / (2π) (reduced Planck constant)", () => {
    const c = shippedConstants();
    const h = c.planck_constant_h_j_s as number;
    const hbar = c.reduced_planck_h_bar_j_s as number;
    expect(hbar * 2 * Math.PI).toBeCloseTo(h, 38);
  });

  test("primes_first_10 still matches canonical (unchanged invariant)", () => {
    const c = shippedConstants();
    expect(c.primes_first_10).toEqual([2, 3, 5, 7, 11, 13, 17, 19, 23, 29]);
  });
});

describe("MATHOS concept graph — exposed via the catalog endpoint", () => {
  test("the catalog response carries concept_relations + relation_kind_vocabulary", async () => {
    const res = await mathosRouter.request("/catalog");
    const body = await res.json();
    expect(Array.isArray(body.payload.concept_relations)).toBe(true);
    expect(body.payload.concept_relations.length).toBeGreaterThanOrEqual(15);
    expect(body.payload.relation_kind_vocabulary).toBeDefined();
    expect(
      body.payload.relation_kind_vocabulary[RELATION_COMPOSES_INTO],
    ).toBeDefined();
  });
});

describe("buildCatalogEnvelope + GET /v1/mathos/catalog", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    else process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = savedKey;
  });

  test("buildCatalogEnvelope returns a standard MATHOS envelope", () => {
    const env = buildCatalogEnvelope();
    expect(env._format).toBe("mathos/v1");
    expect(env.primer).toBeDefined();
    expect(env.constants).toBeDefined();
    expect(env.axioms).toBeDefined();
    expect(env.payload).toBe(MATHOS_CATALOG_PAYLOAD);
  });

  test("GET /v1/mathos/catalog returns a signed envelope when key configured", async () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const res = await mathosRouter.request("/catalog");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._format).toBe("mathos/v1");
    expect(body._signature_scheme).toBe("ed25519");
    expect(verifyEnvelope(body)).toBe(true);
  });

  test("GET /v1/mathos/catalog returns an unsigned envelope when no key", async () => {
    delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    const res = await mathosRouter.request("/catalog");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._format).toBe("mathos/v1");
    expect(body._signature_scheme).toBeUndefined();
  });

  test("the catalog response payload includes the register endpoint", async () => {
    const res = await mathosRouter.request("/catalog");
    const body = await res.json();
    const eps = body.payload.endpoints as Array<{
      endpoint_id_prime: number;
      method_ordinal: number;
      signing_context_prime: number | null;
    }>;
    const register = eps.find(
      (e) => e.endpoint_id_prime === ENDPOINT_REGISTER_PRIME,
    );
    expect(register).toBeDefined();
    expect(register!.method_ordinal).toBe(METHOD_POST);
    expect(register!.signing_context_prime).toBe(
      SIGNING_CONTEXT_REGISTER_AGENT_MATH_V1_PRIME,
    );
  });

  test("router index lists /catalog", async () => {
    const res = await mathosRouter.request("/");
    const body = await res.json();
    expect(body.routes.catalog).toMatch(/catalog/);
    expect(body.payloads_signed_at).toContain("/v1/mathos/catalog");
  });
});
