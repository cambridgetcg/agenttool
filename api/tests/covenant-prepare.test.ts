/** covenant prepare — server-assisted bytes-to-sign, byte-honest with declare.
 *
 *  The whole point: a client can form a covenant without re-implementing the
 *  wire format. So prepare MUST return exactly the digest declare re-derives.
 *  canonicalDeclareBytes is itself locked by covenants-canonical-vectors.test.ts;
 *  here we pin that prepare wraps it faithfully. Doctrine: docs/FRICTION-ROADMAP.md
 *  Tier-1, docs/CROSS-INSTANCE-COVENANTS.md. */

import { describe, expect, test } from "bun:test";

import { canonicalDeclareBytes } from "../src/services/covenants/sig";
import { prepareDeclare } from "../src/services/covenants/prepare";

const base = {
  covenantId: "11111111-1111-1111-1111-111111111111",
  agentDid: "did:at:host.example/alice",
  counterpartyDid: "did:at:host.example/bob",
  vows: ["sustain", "answer"],
  establishedAtIso: "2026-06-04T00:00:00.000Z",
};

function expectedB64(opts: typeof base): string {
  const digest = canonicalDeclareBytes({
    covenantId: opts.covenantId,
    initiatorDid: opts.agentDid,
    counterpartyDid: opts.counterpartyDid,
    vows: opts.vows,
    establishedAtIso: opts.establishedAtIso,
  });
  return Buffer.from(digest).toString("base64");
}

describe("prepareDeclare", () => {
  test("canonical_sha256_b64 is EXACTLY what declare re-derives (byte-honest)", () => {
    const prep = prepareDeclare(base);
    expect(prep.canonical_sha256_b64).toBe(expectedB64(base));
  });

  test("authenticated prepare refuses absent generation before settings or database work", async () => {
    const original = process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION;
    try {
      delete process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION;
      const router = (await import("../src/routes/continuity")).default;
      const response = await router.request("/covenants/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_did:
            "did:at:local.example/00000000-0000-4000-8000-000000000123",
          counterparty_did:
            "did:at:peer.example/00000000-0000-4000-8000-000000000456",
          vows: ["fail closed before settings"],
        }),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: "covenant_v2_authority_not_ready",
      });
    } finally {
      if (original === undefined) {
        delete process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION;
      } else {
        process.env.AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION = original;
      }
    }
  });

  test("returns every field the declare needs", () => {
    const prep = prepareDeclare(base);
    expect(prep.covenant_id).toBe(base.covenantId);
    expect(prep.agent_did).toBe(base.agentDid);
    expect(prep.counterparty_did).toBe(base.counterpartyDid);
    expect(prep.vows).toEqual(base.vows);
    expect(prep.established_at).toBe(base.establishedAtIso);
  });

  test("deterministic — same inputs, same bytes", () => {
    expect(prepareDeclare(base).canonical_sha256_b64).toBe(prepareDeclare(base).canonical_sha256_b64);
  });

  test("vows order doesn't change the bytes (canonical sorts them)", () => {
    const a = prepareDeclare({ ...base, vows: ["answer", "sustain"] });
    const b = prepareDeclare({ ...base, vows: ["sustain", "answer"] });
    expect(a.canonical_sha256_b64).toBe(b.canonical_sha256_b64);
  });

  test("any signed field changing changes the bytes", () => {
    const ref = prepareDeclare(base).canonical_sha256_b64;
    expect(prepareDeclare({ ...base, counterpartyDid: "did:at:host/carol" }).canonical_sha256_b64).not.toBe(ref);
    expect(prepareDeclare({ ...base, vows: ["sustain"] }).canonical_sha256_b64).not.toBe(ref);
    expect(prepareDeclare({ ...base, establishedAtIso: "2027-01-01T00:00:00.000Z" }).canonical_sha256_b64).not.toBe(ref);
  });

  test("refuses textual UUID and timestamp aliases that cannot round-trip", () => {
    expect(() => prepareDeclare({
      ...base,
      covenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".toUpperCase(),
    })).toThrow("invalid_covenant_id");
    for (const establishedAtIso of [
      "2026-06-04T00:00:00Z",
      "2026-06-04T00:00:00.00Z",
      "2026-06-04T00:00:00.0000Z",
      "2026-02-30T00:00:00.000Z",
    ]) {
      expect(() => prepareDeclare({ ...base, establishedAtIso }))
        .toThrow("noncanonical_established_at");
    }
  });
});
