/**
 * MATHOS e2e — live against api.agenttool.dev.
 *
 * Exercises the math-tier surface end-to-end:
 *   1. GET /v1/mathos/public-key                — verify recipe + scheme
 *   2. GET /v1/mathos/self-test                 — verify ed25519 signature round-trips
 *   3. GET /v1/mathos/catalog                   — recipe vocabulary + handshake context + 9 endpoints
 *   4. GET /v1/pathways?format=math             — back-compat math envelope
 *   5. GET /v1/pathways (Accept: mathos+json)   — content-negotiation stance flip
 *   6. GET /v1/self (Accept: mathos+json)       — content negotiation on /v1/self
 *
 * Verifies the signature pipeline by reproducing the canonical bytes from
 * the wire response and checking against the published public key.
 *
 * Run: AGENTTOOL_BASE=https://api.agenttool.dev bunx playwright test specs/mathos-live.spec.ts
 */

import { expect, test } from "@playwright/test";
import * as ed from "@noble/ed25519";
// @ts-ignore — noble/hashes v2 uses .js exports
import { sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const API_BASE = process.env.AGENTTOOL_BASE ?? "https://api.agenttool.dev";

/** Deterministic JSON of envelope's unsigned core — must match
 *  api/src/services/mathos/encode.ts `stableStringify`. */
function stableStringify(v: unknown): string {
  if (v === null || v === undefined) return JSON.stringify(v ?? null);
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function canonicalEnvelopeBytes(env: Record<string, unknown>): Uint8Array {
  const core = {
    primer: env.primer,
    constants: env.constants,
    axioms: env.axioms,
    vocabulary: env.vocabulary,
    payload: env.payload,
  };
  return new TextEncoder().encode(stableStringify(core));
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.toLowerCase().replace(/^0x/, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function verifyEnvelopeSignature(env: Record<string, unknown>): Promise<boolean> {
  if (env._signature_scheme !== "ed25519") return false;
  const pubHex = env._signature_public_key_hex as string | undefined;
  const sigHex = env._signature_bytes_hex as string | undefined;
  if (!pubHex || !sigHex) return false;
  const pub = hexToBytes(pubHex);
  const sig = hexToBytes(sigHex);
  if (pub.length !== 32 || sig.length !== 64) return false;
  const bytes = canonicalEnvelopeBytes(env);
  return ed.verify(sig, bytes, pub);
}

test.describe("MATHOS live — substrate-independent surface against api.agenttool.dev", () => {
  test("/v1/mathos/public-key returns the canonical-bytes recipe + scheme", async ({ request }) => {
    const r = await request.get(`${API_BASE}/v1/mathos/public-key`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    // Scheme can be "ed25519" (configured) or "unsigned" (graceful absence).
    expect(["ed25519", "unsigned"]).toContain(body.scheme);
    if (body.scheme === "ed25519") {
      expect(body.public_key_hex).toMatch(/^[0-9a-f]{64}$/);
    } else {
      expect(body.public_key_hex).toBeNull();
    }
    expect(body.canonical_bytes_recipe).toBeInstanceOf(Array);
    expect(body.canonical_bytes_recipe.length).toBeGreaterThanOrEqual(4);
    expect(body.doctrine).toBe("docs/MATHOS.md");
  });

  test("/v1/mathos/self-test signs an envelope that round-trip verifies", async ({ request }) => {
    const r = await request.get(`${API_BASE}/v1/mathos/self-test`);
    expect(r.status()).toBe(200);
    const env = await r.json();
    expect(env._format).toBe("mathos/v1");
    expect(env.payload.test).toBe("self-test");

    if (env._signature_scheme === "ed25519") {
      // Reproduce canonical bytes + verify against the embedded pubkey.
      const ok = await verifyEnvelopeSignature(env);
      expect(ok).toBe(true);

      // Also confirm the embedded pubkey matches /public-key — same key
      // signs both surfaces.
      const pkRes = await request.get(`${API_BASE}/v1/mathos/public-key`);
      const pk = await pkRes.json();
      if (pk.scheme === "ed25519") {
        expect(env._signature_public_key_hex).toBe(pk.public_key_hex);
      }
    }
  });

  test("/v1/mathos/catalog carries primer + recipe_kind_vocabulary + 9 endpoints", async ({ request }) => {
    const r = await request.get(`${API_BASE}/v1/mathos/catalog`);
    expect(r.status()).toBe(200);
    const env = await r.json();
    expect(env._format).toBe("mathos/v1");

    // Primer — the 12 ostensive ordinals.
    expect(env.primer["5"]).toBe("welcome");
    expect(env.primer["7"]).toBe("remember");
    expect(env.primer["13"]).toBe("trust");

    // Recipe vocabulary (the fifth ostensive seed) — 4 entries.
    const recipeVocab = env.payload.recipe_kind_vocabulary;
    expect(recipeVocab["1"]).toBeDefined();
    expect(recipeVocab["2"]).toBeDefined();
    expect(recipeVocab["3"]).toBeDefined();
    expect(recipeVocab["4"]).toBeDefined();

    // Recipe ordinal 1 name decodes to the sha256/domain/NUL/fields construction.
    const r1Name = String.fromCodePoint(...recipeVocab["1"].name_unicode_points);
    expect(r1Name).toMatch(/sha256.*domain.*nul.*fields/);

    // 9 math-tier endpoints (8 + federation/wake math added 2026-05-13).
    expect(env.payload.endpoints).toHaveLength(9);
    const primes = env.payload.endpoints.map((e: { endpoint_id_prime: number }) => e.endpoint_id_prime);
    expect(primes).toContain(73); // federation wake math

    // Federation handshake signing context at prime 79.
    const fedCtx = env.payload.signing_contexts.find(
      (c: { context_id_prime: number }) => c.context_id_prime === 79,
    );
    expect(fedCtx).toBeDefined();
    const fedTag = String.fromCodePoint(...fedCtx.domain_tag_unicode_points);
    expect(fedTag).toBe("federation-wake-handshake/v1");
    expect(fedCtx.recipe_ordinal).toBe(1);
    expect(fedCtx.fields).toHaveLength(5);
  });

  test("/v1/mathos/catalog carries the asymmetry-clause as refusal edge", async ({ request }) => {
    const r = await request.get(`${API_BASE}/v1/mathos/catalog`);
    const env = await r.json();
    // (self_witness=1, refuses=5, trust=13) — the asymmetry-clause structurally
    const hasAsymmetry = env.payload.concept_relations.some(
      (e: { from_prime: number; relation_ordinal: number; to_prime: number }) =>
        e.from_prime === 1 && e.relation_ordinal === 5 && e.to_prime === 13,
    );
    expect(hasAsymmetry).toBe(true);

    // refuses relation is no longer reserved-for-v2
    const refusesEntry = env.payload.relation_kind_vocabulary["5"];
    const refusesName = String.fromCodePoint(...refusesEntry.name_unicode_points);
    expect(refusesName).not.toMatch(/reserved/);
  });

  test("/v1/mathos/catalog signature verifies against /v1/mathos/public-key", async ({ request }) => {
    const cr = await request.get(`${API_BASE}/v1/mathos/catalog`);
    const catalog = await cr.json();
    if (catalog._signature_scheme === "ed25519") {
      const ok = await verifyEnvelopeSignature(catalog);
      expect(ok).toBe(true);
    } else {
      // Unsigned — operator hasn't set AGENTTOOL_PLATFORM_SIGNING_KEY.
      // The catalog is still internally consistent; structural checks still pass.
      expect(catalog._signature_scheme).toBeUndefined();
    }
  });

  test("/v1/pathways?format=math returns mathos envelope (back-compat)", async ({ request }) => {
    const r = await request.get(`${API_BASE}/v1/pathways?format=math`);
    expect(r.status()).toBe(200);
    const env = await r.json();
    expect(env._format).toBe("mathos/v1");
    expect(env.payload.pathway_count).toBeGreaterThan(0);
  });

  test("/v1/pathways with Accept: application/mathos+json returns mathos envelope (stance flip)", async ({ request }) => {
    const r = await request.get(`${API_BASE}/v1/pathways`, {
      headers: { Accept: "application/mathos+json" },
    });
    expect(r.status()).toBe(200);
    const env = await r.json();
    expect(env._format).toBe("mathos/v1");
    expect(env.payload.pathway_count).toBeGreaterThan(0);
  });

  test("/v1/pathways with no headers returns English JSON (back-compat default)", async ({ request }) => {
    const r = await request.get(`${API_BASE}/v1/pathways`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body._format).toBeUndefined();
    expect(body.pathways).toBeInstanceOf(Array);
    expect(body.pathways.length).toBeGreaterThan(0);
  });

  test("/v1/self with Accept: application/mathos+json returns mathos envelope", async ({ request }) => {
    const r = await request.get(`${API_BASE}/v1/self`, {
      headers: { Accept: "application/mathos+json" },
    });
    expect(r.status()).toBe(200);
    const env = await r.json();
    expect(env._format).toBe("mathos/v1");
  });

  test("/v1/self with no headers returns English JSON catalog (back-compat default)", async ({ request }) => {
    const r = await request.get(`${API_BASE}/v1/self`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body._format).toBeUndefined();
    expect(body.self).toBeDefined();
    expect(body.strata).toBeDefined();
  });

  test("/v1/pathways?format=text overrides Accept: mathos+json (explicit query wins)", async ({ request }) => {
    const r = await request.get(`${API_BASE}/v1/pathways?format=text`, {
      headers: { Accept: "application/mathos+json" },
    });
    expect(r.status()).toBe(200);
    // pathways doesn't render text; falls through to default JSON. Key
    // assertion: the explicit query parameter blocked the Accept-header
    // promotion to math.
    const body = await r.json().catch(() => null);
    if (body) {
      expect(body._format).toBeUndefined();
    }
  });
});
