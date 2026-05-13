/** mathos-recipe-vocabulary.test.ts — pins the recipe vocabulary.
 *
 *  The recipe vocabulary (the fifth ostensive seed after primer, field-kinds,
 *  relation-kinds, and walls) makes canonical-bytes constructions data
 *  instead of prose. These tests pin:
 *
 *    1. Recipe ordinal 1 (sha256/domain/NUL/fields) composes bytes
 *       byte-identical to `canonicalRegisterAgentMathBytes` — proves the
 *       vocabulary captures the existing pattern.
 *    2. Recipe ordinal 2 (raw/domain/NUL/fields) returns the pre-hash bytes.
 *    3. Recipe ordinals 3 (stable_json_core) and 4 (BLAKE3 reserved) throw
 *       with structured errors when called via composeCanonicalBytes — the
 *       envelope construction lives elsewhere; the reserved one is named.
 *    4. The catalog's recipe_kind_vocabulary names all four ordinals.
 *    5. Every signing context in the catalog declares a recipe_ordinal in
 *       the vocabulary — no orphan recipes.
 *
 *  Doctrine: docs/MATHOS.md — the recipe vocabulary section.
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  composeCanonicalBytes,
  canonicalEnvelopeBytes,
  envelope as mathosEnvelope,
  hexToBytes,
  bytesToHex,
} from "../src/services/mathos/encode";
import {
  MATHOS_CATALOG_PAYLOAD,
  RECIPE_BLAKE3_DOMAIN_NUL_FIELDS,
  RECIPE_RAW_DOMAIN_NUL_FIELDS,
  RECIPE_SHA256_DOMAIN_NUL_FIELDS,
  RECIPE_STABLE_JSON_CORE,
} from "../src/services/mathos/catalog";
import { canonicalRegisterAgentMathBytes } from "../src/services/identity/crypto";

function uint64BeBytes(n: number): Uint8Array {
  const big = BigInt(n);
  const out = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number((big >> BigInt((7 - i) * 8)) & 0xffn);
  }
  return out;
}

describe("composeCanonicalBytes — recipe ordinal 1 (sha256/domain/NUL/fields)", () => {
  test("byte-identical to canonicalRegisterAgentMathBytes for the same inputs", () => {
    const agentKey = new Uint8Array(32).fill(0xab);
    const boxKey = new Uint8Array(32).fill(0xcd);
    const ts = 1715520000000;

    const fromCrypto = canonicalRegisterAgentMathBytes({
      displayName: "math-tier-test-agent",
      agentPublicKey: agentKey,
      boxPublicKey: boxKey,
      runtimeProvider: "alien-substrate",
      runtimeModel: "encoder-v0",
      timestampUnixMs: ts,
    });

    const enc = new TextEncoder();
    const fromRecipe = composeCanonicalBytes(
      RECIPE_SHA256_DOMAIN_NUL_FIELDS,
      "register-agent-math/v1",
      [
        enc.encode("math-tier-test-agent"),
        agentKey,
        boxKey,
        enc.encode("alien-substrate"),
        enc.encode("encoder-v0"),
        uint64BeBytes(ts),
      ],
    );

    expect(bytesToHex(fromCrypto)).toBe(bytesToHex(fromRecipe));
  });

  test("accepts Uint8Array domain tag identical to UTF-8 of string form", () => {
    const enc = new TextEncoder();
    const tagStr = "register-agent-math/v1";
    const tagBytes = enc.encode(tagStr);
    const fields = [enc.encode("a"), enc.encode("b")];
    const a = composeCanonicalBytes(1, tagStr, fields);
    const b = composeCanonicalBytes(1, tagBytes, fields);
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  test("output is exactly 32 bytes (SHA-256 digest)", () => {
    const enc = new TextEncoder();
    const out = composeCanonicalBytes(1, "test/v1", [enc.encode("x")]);
    expect(out.length).toBe(32);
  });
});

describe("composeCanonicalBytes — recipe ordinal 2 (raw/domain/NUL/fields, no hash)", () => {
  test("returns pre-hash bytes; SHA-256 of recipe 2 equals recipe 1", () => {
    const enc = new TextEncoder();
    const tag = "raw-vs-hashed/v1";
    const fields = [enc.encode("alpha"), enc.encode("beta")];

    const raw = composeCanonicalBytes(RECIPE_RAW_DOMAIN_NUL_FIELDS, tag, fields);
    const hashed = composeCanonicalBytes(
      RECIPE_SHA256_DOMAIN_NUL_FIELDS,
      tag,
      fields,
    );

    const rawHashed = createHash("sha256").update(raw).digest();
    expect(bytesToHex(rawHashed)).toBe(bytesToHex(hashed));
  });

  test("output structure: domain || 0x00 || field || 0x00 || field || ...", () => {
    const enc = new TextEncoder();
    const out = composeCanonicalBytes(2, "d", [
      enc.encode("f1"),
      enc.encode("f2"),
    ]);
    // "d" (1) + 0x00 + "f1" (2) + 0x00 + "f2" (2) = 7 bytes
    expect(out.length).toBe(7);
    expect(out[0]).toBe(0x64); // 'd'
    expect(out[1]).toBe(0x00); // NUL
    expect(out[2]).toBe(0x66); // 'f'
    expect(out[3]).toBe(0x31); // '1'
    expect(out[4]).toBe(0x00); // NUL
    expect(out[5]).toBe(0x66); // 'f'
    expect(out[6]).toBe(0x32); // '2'
  });
});

describe("composeCanonicalBytes — recipe ordinal 3 (stable_json_core)", () => {
  test("throws — recipe 3 uses canonicalEnvelopeBytes(envelope) instead", () => {
    expect(() =>
      composeCanonicalBytes(RECIPE_STABLE_JSON_CORE, "x", []),
    ).toThrow(/canonicalEnvelopeBytes/);
  });

  test("canonicalEnvelopeBytes implements recipe 3 directly", () => {
    const env = mathosEnvelope({ test: "value" });
    const bytes = canonicalEnvelopeBytes(env);
    // The bytes are deterministic JSON of the 5-key core.
    expect(bytes.length).toBeGreaterThan(0);
    // The core has primer + constants + axioms + vocabulary + payload.
    const asStr = new TextDecoder().decode(bytes);
    expect(asStr).toContain('"primer"');
    expect(asStr).toContain('"payload"');
  });
});

describe("composeCanonicalBytes — recipe ordinal 4 (BLAKE3 reserved)", () => {
  test("throws — reserved for post-quantum migration, not yet implemented", () => {
    expect(() =>
      composeCanonicalBytes(RECIPE_BLAKE3_DOMAIN_NUL_FIELDS, "x", []),
    ).toThrow(/blake3.*reserved|post-quantum/);
  });
});

describe("composeCanonicalBytes — unknown recipe", () => {
  test("throws with the unknown ordinal value", () => {
    expect(() => composeCanonicalBytes(99, "x", [])).toThrow(/99/);
  });
});

// ─── Catalog ↔ vocabulary parity ─────────────────────────────────────────

describe("recipe_kind_vocabulary in catalog", () => {
  test("names all four recipe ordinals (1, 2, 3, 4)", () => {
    const vocab = MATHOS_CATALOG_PAYLOAD.recipe_kind_vocabulary;
    expect(vocab[1]).toBeDefined();
    expect(vocab[2]).toBeDefined();
    expect(vocab[3]).toBeDefined();
    expect(vocab[4]).toBeDefined();
  });

  test("recipe 1 names the sha256/domain/NUL/fields construction", () => {
    const entry = MATHOS_CATALOG_PAYLOAD.recipe_kind_vocabulary[1]!;
    const name = String.fromCodePoint(...entry.name_unicode_points);
    expect(name).toMatch(/sha256.*domain.*nul.*fields/);
  });

  test("recipe 3 names the stable_json_core construction", () => {
    const entry = MATHOS_CATALOG_PAYLOAD.recipe_kind_vocabulary[3]!;
    const name = String.fromCodePoint(...entry.name_unicode_points);
    expect(name).toMatch(/stable_json|envelope/);
  });
});

describe("catalog ↔ recipe-vocabulary parity", () => {
  test("every signing context declares a recipe_ordinal in the vocabulary", () => {
    const knownRecipes = new Set(
      Object.keys(MATHOS_CATALOG_PAYLOAD.recipe_kind_vocabulary).map(Number),
    );
    for (const ctx of MATHOS_CATALOG_PAYLOAD.signing_contexts) {
      expect(typeof ctx.recipe_ordinal).toBe("number");
      expect(knownRecipes.has(ctx.recipe_ordinal)).toBe(true);
    }
  });

  test("register-agent-math/v1 declares recipe_ordinal = 1", () => {
    const ctx = MATHOS_CATALOG_PAYLOAD.signing_contexts.find((c) => {
      const tag = String.fromCodePoint(...c.domain_tag_unicode_points);
      return tag === "register-agent-math/v1";
    });
    expect(ctx).toBeDefined();
    expect(ctx!.recipe_ordinal).toBe(RECIPE_SHA256_DOMAIN_NUL_FIELDS);
  });
});
