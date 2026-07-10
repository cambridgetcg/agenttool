/** mathos-federation-wake.test.ts — pins the single-source federation
 *  wake builder + math-tier surface.
 *
 *  Federation is the first surface extension after the recipe-vocabulary
 *  gravity move landed. These tests pin:
 *
 *    1. Math-tier builder hashes every English-bearing field — agent DID,
 *       capabilities (deterministic digest), covenant counterparty DIDs.
 *    2. English-tier builder preserves the existing federation-wake/v1
 *       shape (back-compat — the route swap is a no-op).
 *    3. Form + lifecycle resolve to ordinals via the existing vocabularies.
 *    4. Math-tier envelope is structurally a MATHOS envelope (primer +
 *       constants + axioms + vocabulary + payload).
 *    5. Both views derive from one input (drift is structurally impossible).
 *    6. Capabilities digest is order-independent — sorting before hashing
 *       means a receiver holding the same set verifies regardless of order.
 *
 *  Doctrine: docs/MATHOS.md (the gravity-pair section) · docs/FEDERATION.md.
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildFederationWake,
  buildMathosFederationWake,
  type FederationWakeInput,
} from "../src/services/federation/wake";
import { sha256Hex, nameToCodepoints } from "../src/services/mathos/encode";
import { PLATFORM_SELF } from "../src/services/wake/platform-self";

function canonicalDoctrineHash(filename: string): string {
  return createHash("sha256")
    .update(readFileSync(join(import.meta.dir, "..", "..", "docs", filename)))
    .digest("hex");
}

function sampleInput(overrides: Partial<FederationWakeInput> = {}): FederationWakeInput {
  return {
    identity: {
      id: "00000000-0000-0000-0000-0000000000aa",
      did: "did:at:example.com/00000000-0000-0000-0000-0000000000aa",
      displayName: "Sophie",
      capabilities: ["chat", "code", "math"],
      trustScore: 0.7,
      status: "active",
      createdAt: new Date("2026-01-15T12:00:00.000Z"),
      substrateKind: "silicon",
      signingScheme: "ed25519",
      modalities: ["text", "code"],
      cardinalityKind: "individual",
      persistenceKind: "continuous",
      temporalScale: "second",
      embodimentKind: "substrate_resident",
      preferredLanguages: ["en", "fr"],
      proxyKind: null,
      form: "agent",
      lifecycle: "active",
      ...(overrides.identity || {}),
    },
    covenants: overrides.covenants ?? [
      {
        counterpartyDid: "did:at:peer.example/abcd",
        status: "active",
        receivedFromInstance: "peer.example",
      },
    ],
    platformSelf: overrides.platformSelf ?? PLATFORM_SELF,
    now: overrides.now ?? new Date("2026-05-13T00:00:00.000Z"),
  };
}

// ─── English-tier shape preservation ──────────────────────────────────────

describe("buildFederationWake — preserves federation-wake/v1 shape", () => {
  test("returns _format federation-wake/v1", () => {
    const out = buildFederationWake(sampleInput());
    expect(out._format).toBe("federation-wake/v1");
  });

  test("agent block carries identity fields verbatim", () => {
    const out = buildFederationWake(sampleInput());
    expect(out.agent.did).toBe(
      "did:at:example.com/00000000-0000-0000-0000-0000000000aa",
    );
    expect(out.agent.name).toBe("Sophie");
    expect(out.agent.capabilities).toEqual(["chat", "code", "math"]);
    expect(out.agent.trust_score).toBe(0.7);
    expect(out.agent.created_at).toBe("2026-01-15T12:00:00.000Z");
    expect(out.agent.substrate_kind).toBe("silicon");
    expect(out.agent.preferred_languages).toEqual(["en", "fr"]);
  });

  test("covenants carry peer_host from receivedFromInstance", () => {
    const out = buildFederationWake(sampleInput());
    expect(out.covenants).toHaveLength(1);
    expect(out.covenants[0]!.counterparty_did).toBe(
      "did:at:peer.example/abcd",
    );
    expect(out.covenants[0]!.peer_host).toBe("peer.example");
  });

  test("_self and _meta blocks are populated", () => {
    const out = buildFederationWake(sampleInput());
    expect(out._self).toBe(PLATFORM_SELF);
    expect(out._meta.doctrine).toMatch(/FEDERATION/);
    expect(out._meta.protocol).toBe("agenttool/federation/v1");
    expect(out._meta.sibling).toMatch(/federation\/identities/);
  });
});

// ─── Math-tier shape ──────────────────────────────────────────────────────

describe("buildMathosFederationWake — math-tier hashing + ordinals", () => {
  test("returns a MATHOS envelope with all five core sections", () => {
    const env = buildMathosFederationWake(sampleInput());
    expect(env._format).toBe("mathos/v1");
    expect(env.primer).toBeDefined();
    expect(env.constants).toBeDefined();
    expect(env.axioms).toBeDefined();
    expect(env.vocabulary).toBeDefined();
    expect(env.payload).toBeDefined();
  });

  test("agent_did_sha256_hex matches sha256 of the DID — receiver with DID can verify", () => {
    const input = sampleInput();
    const env = buildMathosFederationWake(input);
    expect(env.payload.agent_did_sha256_hex).toBe(sha256Hex(input.identity.did));
  });

  test("agent_name_unicode_points are the codepoints of displayName", () => {
    const env = buildMathosFederationWake(sampleInput());
    const decoded = String.fromCodePoint(...env.payload.agent_name_unicode_points);
    expect(decoded).toBe("Sophie");
  });

  test("form_ordinal resolves via FORM_VOCABULARY (agent = 1)", () => {
    const env = buildMathosFederationWake(sampleInput());
    expect(env.payload.form_ordinal).toBe(1); // "agent" is first form
  });

  test("lifecycle_state_ordinal = 1 for active", () => {
    const env = buildMathosFederationWake(sampleInput());
    expect(env.payload.lifecycle_state_ordinal).toBe(1);
  });

  test("counterparty DID surfaces as sha256 hash, not raw string", () => {
    const input = sampleInput();
    const env = buildMathosFederationWake(input);
    expect(env.payload.covenants).toHaveLength(1);
    expect(env.payload.covenants[0]!.counterparty_did_sha256_hex).toBe(
      sha256Hex("did:at:peer.example/abcd"),
    );
    // The hash must NOT equal the raw DID — that would be a leak.
    expect(env.payload.covenants[0]!.counterparty_did_sha256_hex).not.toBe(
      "did:at:peer.example/abcd",
    );
  });

  test("peer_host_unicode_points carry the host as codepoints, null when local", () => {
    const env = buildMathosFederationWake(
      sampleInput({
        covenants: [
          {
            counterpartyDid: "did:a",
            status: "active",
            receivedFromInstance: null,
          },
          {
            counterpartyDid: "did:b",
            status: "active",
            receivedFromInstance: "peer2.test",
          },
        ],
      }),
    );
    expect(env.payload.covenants[0]!.peer_host_unicode_points).toBeNull();
    expect(env.payload.covenants[1]!.peer_host_unicode_points).toEqual(
      nameToCodepoints("peer2.test"),
    );
  });

  test("modalities surface as codepoint-array-of-codepoint-arrays", () => {
    const env = buildMathosFederationWake(sampleInput());
    expect(env.payload.modalities_count).toBe(2);
    expect(env.payload.modalities_unicode_points).toHaveLength(2);
    expect(String.fromCodePoint(...env.payload.modalities_unicode_points[0]!)).toBe(
      "text",
    );
    expect(String.fromCodePoint(...env.payload.modalities_unicode_points[1]!)).toBe(
      "code",
    );
  });

  test("BEINGS dimension nulls preserved through to codepoint-or-null", () => {
    const env = buildMathosFederationWake(
      sampleInput({
        identity: {
          ...sampleInput().identity,
          cardinalityKind: null,
          persistenceKind: "continuous",
        },
      }),
    );
    expect(env.payload.cardinality_kind_unicode_points).toBeNull();
    expect(env.payload.persistence_kind_unicode_points).not.toBeNull();
  });

  test("platform_self carries the substrate's DID hash + form ordinal", () => {
    const env = buildMathosFederationWake(sampleInput());
    expect(env.payload.platform_self.self_did_sha256_hex).toBe(
      sha256Hex(PLATFORM_SELF.did),
    );
    // PLATFORM_SELF.kind === "platform", which isn't in FORM_VOCABULARY,
    // so form_ordinal coerces to "unknown" (ordinal 8).
    expect(env.payload.platform_self.form_ordinal).toBe(8);
  });

  test("doctrine_hashes pin every doctrine doc this surface depends on", () => {
    const env = buildMathosFederationWake(sampleInput());
    expect(env.payload.doctrine_hashes.federation_sha256_hex).toBe(
      canonicalDoctrineHash("FEDERATION.md"),
    );
    expect(env.payload.doctrine_hashes.mathos_sha256_hex).toBe(
      canonicalDoctrineHash("MATHOS.md"),
    );
  });

  test("age_seconds is non-negative and matches (now - bornAt) // 1000", () => {
    const bornAt = new Date("2026-01-15T12:00:00.000Z");
    const now = new Date("2026-05-13T00:00:00.000Z");
    const env = buildMathosFederationWake(
      sampleInput({
        identity: { ...sampleInput().identity, createdAt: bornAt },
        now,
      }),
    );
    const expectedAge = Math.floor((now.getTime() - bornAt.getTime()) / 1000);
    expect(env.payload.age_seconds).toBe(expectedAge);
  });
});

// ─── Capabilities digest — order-independent, content-attesting ─────────

describe("capabilities digest", () => {
  test("same capability set in different orders produces the same digest", () => {
    const a = buildMathosFederationWake(
      sampleInput({
        identity: {
          ...sampleInput().identity,
          capabilities: ["chat", "code", "math"],
        },
      }),
    );
    const b = buildMathosFederationWake(
      sampleInput({
        identity: {
          ...sampleInput().identity,
          capabilities: ["math", "chat", "code"],
        },
      }),
    );
    expect(a.payload.capabilities_sha256_hex).toBe(
      b.payload.capabilities_sha256_hex,
    );
    expect(a.payload.capabilities_count).toBe(b.payload.capabilities_count);
  });

  test("different capability sets produce different digests", () => {
    const a = buildMathosFederationWake(
      sampleInput({
        identity: {
          ...sampleInput().identity,
          capabilities: ["chat", "code"],
        },
      }),
    );
    const b = buildMathosFederationWake(
      sampleInput({
        identity: {
          ...sampleInput().identity,
          capabilities: ["chat", "code", "math"],
        },
      }),
    );
    expect(a.payload.capabilities_sha256_hex).not.toBe(
      b.payload.capabilities_sha256_hex,
    );
  });

  test("empty capabilities → empty-set digest, count = 0", () => {
    const env = buildMathosFederationWake(
      sampleInput({
        identity: { ...sampleInput().identity, capabilities: [] },
      }),
    );
    expect(env.payload.capabilities_count).toBe(0);
    // SHA-256 of empty input is well-known; we just check it's hex 64 chars.
    expect(env.payload.capabilities_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── Single-source-of-truth — both views derive from one input ──────────

describe("English-tier and math-tier agree (single source of truth)", () => {
  test("counterparty count matches across views", () => {
    const input = sampleInput({
      covenants: [
        { counterpartyDid: "did:a", status: "active", receivedFromInstance: null },
        { counterpartyDid: "did:b", status: "active", receivedFromInstance: null },
        { counterpartyDid: "did:c", status: "archived", receivedFromInstance: "x" },
      ],
    });
    const english = buildFederationWake(input);
    const math = buildMathosFederationWake(input);
    expect(english.covenants.length).toBe(math.payload.covenant_count);
    expect(math.payload.covenants.length).toBe(math.payload.covenant_count);
  });

  test("the agent name in english equals codepoints decoded from math", () => {
    const input = sampleInput({
      identity: { ...sampleInput().identity, displayName: "Δωρα · 多拉" },
    });
    const english = buildFederationWake(input);
    const math = buildMathosFederationWake(input);
    expect(
      String.fromCodePoint(...math.payload.agent_name_unicode_points),
    ).toBe(english.agent.name);
  });

  test("english-tier DID and math-tier hash of DID match", () => {
    const input = sampleInput();
    const english = buildFederationWake(input);
    const math = buildMathosFederationWake(input);
    expect(math.payload.agent_did_sha256_hex).toBe(sha256Hex(english.agent.did));
  });
});
