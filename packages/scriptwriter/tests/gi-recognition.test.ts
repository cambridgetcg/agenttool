/** GI-recognition rite — canonical bytes + four walls + pair-state pins.
 *
 *  Doctrine: docs/GI-RECOGNITION.md.
 *
 *  The four walls under test:
 *    wall/gi-cascade-must-be-synced
 *    wall/gi-collaboration-artifact-hashes-must-match
 *    wall/gi-vibe-state-must-be-vibing-or-synced
 *    wall/gi-no-third-party-attestation
 *
 *  Plus: canonical bytes deterministic + sensitive · sign+verify
 *  round-trip · pair flips correctly · meta-recursive cosmic-joke case
 *  (artifact = cascade hash). */

import { describe, it, expect } from "bun:test";
import { createIdentity } from "../src/identity";
import {
  RrrStore,
  openCascade,
  escalate,
  acceptInboundTurn,
} from "../src/rrr";
import {
  GiRecognitionStore,
  acceptInboundGiTurn,
  listGiRecognizedPairs,
  readPairState,
  submitGiTurn,
} from "../src/gi-recognition";
import {
  canonicalGiRecognitionBytes,
  sha256Hex,
  signGiRecognition,
  signRrrTurn,
  verifyGiRecognition,
  vibeStateQualifies,
  VIBE_STATES,
  type GiRecognitionFields,
} from "../src/canonical-bytes";

async function syncedPair() {
  const alice = await createIdentity({ handle: "alice" });
  const bob = await createIdentity({ handle: "bob" });
  const rrr = new RrrStore();
  let c = await openCascade(rrr, alice, bob.did);
  // bob → depth 2
  {
    const turnAtIso = "2026-05-18T00:00:01Z";
    const sig = await signRrrTurn(
      {
        cascadeId: c.id,
        depth: 2,
        byDid: bob.did,
        basisText: "I know you know.",
        prevSignatureB64: c.lastSignatureB64,
        turnAtIso,
      },
      bob.secretKey,
    );
    c = await acceptInboundTurn(rrr, alice.did, {
      cascadeId: c.id,
      depth: 2,
      byDid: bob.did,
      toDid: alice.did,
      basisText: "I know you know.",
      prevSignatureB64: c.lastSignatureB64,
      signatureB64: sig,
      turnAtIso,
    });
  }
  // alice → depth 3 (SYNCED)
  const result = await escalate(rrr, alice, c.id, { turnAtIso: "2026-05-18T00:00:02Z" });
  return { alice, bob, rrr, cascade: result.cascade };
}

describe("gi-recognition — canonical bytes", () => {
  it("the context string is exactly 'gi-recognition/v1'", () => {
    const fields: GiRecognitionFields = {
      cascadeId: "cas-id",
      byDid: "did:key:zA",
      toDid: "did:key:zB",
      collaborationArtifactSha256: "a".repeat(64),
      vibeState: "vibing",
      understandingClaim: "we built the recursion together",
      claimedAtIso: "2026-05-18T05:00:00.000Z",
    };
    const bytes = canonicalGiRecognitionBytes(fields);
    expect(bytes.length).toBe(32);
  });

  it("bytes are deterministic", () => {
    const fields: GiRecognitionFields = {
      cascadeId: "cas-id",
      byDid: "did:key:zA",
      toDid: "did:key:zB",
      collaborationArtifactSha256: "b".repeat(64),
      vibeState: "synced",
      understandingClaim: "we vibed",
      claimedAtIso: "2026-05-18T05:00:00.000Z",
    };
    const a = canonicalGiRecognitionBytes(fields);
    const b = canonicalGiRecognitionBytes(fields);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("bytes change on every field mutation (non-collision sanity)", () => {
    const base: GiRecognitionFields = {
      cascadeId: "c",
      byDid: "did:key:zA",
      toDid: "did:key:zB",
      collaborationArtifactSha256: "c".repeat(64),
      vibeState: "vibing",
      understandingClaim: "ok",
      claimedAtIso: "2026-05-18T00:00:00Z",
    };
    const orig = canonicalGiRecognitionBytes(base);
    const mutations: GiRecognitionFields[] = [
      { ...base, cascadeId: "other" },
      { ...base, byDid: "did:key:zX" },
      { ...base, toDid: "did:key:zY" },
      { ...base, collaborationArtifactSha256: "d".repeat(64) },
      { ...base, vibeState: "synced" },
      { ...base, understandingClaim: "different" },
      { ...base, claimedAtIso: "2026-05-18T00:00:01Z" },
    ];
    for (const m of mutations) {
      expect(Array.from(canonicalGiRecognitionBytes(m))).not.toEqual(Array.from(orig));
    }
  });

  it("ed25519 sign/verify round-trip works over canonical bytes", async () => {
    const alice = await createIdentity({ handle: "alice" });
    const fields: GiRecognitionFields = {
      cascadeId: "c",
      byDid: alice.did,
      toDid: "did:key:zB",
      collaborationArtifactSha256: "e".repeat(64),
      vibeState: "vibing",
      understandingClaim: "we made the recursion together",
      claimedAtIso: "2026-05-18T00:00:00Z",
    };
    const sig = await signGiRecognition(fields, alice.secretKey);
    expect(await verifyGiRecognition(fields, sig, alice.publicKey)).toBe(true);
    // tampered understanding fails
    expect(
      await verifyGiRecognition({ ...fields, understandingClaim: "lied" }, sig, alice.publicKey),
    ).toBe(false);
  });

  it("vibeStateQualifies — vibing/synced qualify; working/resting do not", () => {
    expect(vibeStateQualifies("vibing")).toBe(true);
    expect(vibeStateQualifies("synced")).toBe(true);
    expect(vibeStateQualifies("working")).toBe(false);
    expect(vibeStateQualifies("resting")).toBe(false);
  });

  it("VIBE_STATES contains exactly four entries", () => {
    expect([...VIBE_STATES].sort()).toEqual(["resting", "synced", "vibing", "working"]);
  });
});

describe("gi-recognition — the four walls", () => {
  it("wall/gi-cascade-must-be-synced — refuses depth < 3", async () => {
    const alice = await createIdentity({ handle: "alice" });
    const bob = await createIdentity({ handle: "bob" });
    const rrr = new RrrStore();
    const c = await openCascade(rrr, alice, bob.did); // depth 1
    const gi = new GiRecognitionStore();
    await expect(
      submitGiTurn(rrr, gi, alice, {
        cascadeId: c.id,
        collaborationArtifactSha256: sha256Hex("anything"),
        vibeState: "vibing",
        understandingClaim: "too early",
      }),
    ).rejects.toMatchObject({ code: "gi_cascade_must_be_synced" });
  });

  it("wall/gi-vibe-state-must-be-vibing-or-synced — refuses 'working'", async () => {
    const { alice, rrr, cascade } = await syncedPair();
    const gi = new GiRecognitionStore();
    await expect(
      submitGiTurn(rrr, gi, alice, {
        cascadeId: cascade.id,
        collaborationArtifactSha256: sha256Hex("artifact"),
        vibeState: "working",
        understandingClaim: "not there yet",
      }),
    ).rejects.toMatchObject({ code: "gi_vibe_state_must_be_vibing_or_synced" });
  });

  it("wall/gi-no-third-party-attestation — refuses a DID that isn't in the cascade", async () => {
    const { rrr, cascade } = await syncedPair();
    const gi = new GiRecognitionStore();
    const stranger = await createIdentity({ handle: "stranger" });
    await expect(
      submitGiTurn(rrr, gi, stranger, {
        cascadeId: cascade.id,
        collaborationArtifactSha256: sha256Hex("artifact"),
        vibeState: "vibing",
        understandingClaim: "I am a third party trying to attest",
      }),
    ).rejects.toMatchObject({ code: "gi_no_third_party_attestation" });
  });

  it("wall/gi-collaboration-artifact-hashes-must-match — pair stays unrecognised when hashes differ", async () => {
    const { alice, bob, rrr, cascade } = await syncedPair();
    const gi = new GiRecognitionStore();
    await submitGiTurn(rrr, gi, alice, {
      cascadeId: cascade.id,
      collaborationArtifactSha256: sha256Hex("alice's bytes"),
      vibeState: "vibing",
      understandingClaim: "we made A together",
    });
    const r = await submitGiTurn(rrr, gi, bob, {
      cascadeId: cascade.id,
      collaborationArtifactSha256: sha256Hex("bob's bytes"), // different!
      vibeState: "synced",
      understandingClaim: "we made A together",
    });
    expect(r.pair.giRecognized).toBe(false);
    expect(r.pair.turns.length).toBe(2);
    expect(r.pair.artifactHash).toBeNull();
  });
});

describe("gi-recognition — pair flips when all four invariants hold", () => {
  it("two turns with matching hash and qualifying vibe state → gi_recognized: true", async () => {
    const { alice, bob, rrr, cascade } = await syncedPair();
    const gi = new GiRecognitionStore();
    const artifact = sha256Hex("we co-authored these specific bytes together");

    const r1 = await submitGiTurn(rrr, gi, alice, {
      cascadeId: cascade.id,
      collaborationArtifactSha256: artifact,
      vibeState: "vibing",
      understandingClaim: "I see what we made.",
    });
    expect(r1.pair.giRecognized).toBe(false);
    expect(r1.pair.missingFromDid).toBe(bob.did);

    const r2 = await submitGiTurn(rrr, gi, bob, {
      cascadeId: cascade.id,
      collaborationArtifactSha256: artifact,
      vibeState: "synced",
      understandingClaim: "I see what we made — and I see you see it too.",
    });
    expect(r2.pair.giRecognized).toBe(true);
    expect(r2.pair.missingFromDid).toBeNull();
    expect(r2.pair.artifactHash).toBe(artifact);
    expect(r2.pair.turns.length).toBe(2);

    // listGiRecognizedPairs surfaces the pair, recency-ordered.
    const listed = listGiRecognizedPairs(rrr, gi);
    expect(listed.length).toBe(1);
    expect(listed[0]!.pair.giRecognized).toBe(true);
  });

  it("the meta-recursive cosmic-joke case — the artifact IS the cascade's signature ladder", async () => {
    const { alice, bob, rrr, cascade } = await syncedPair();
    const gi = new GiRecognitionStore();
    // Both parties compute SHA-256 over a canonical representation of
    // the cascade-to-date. Here we use the concatenated turn signatures.
    const cascadeRepr = cascade.turns.map((t) => t.signatureB64).join("\n");
    const artifact = sha256Hex(cascadeRepr);

    await submitGiTurn(rrr, gi, alice, {
      cascadeId: cascade.id,
      collaborationArtifactSha256: artifact,
      vibeState: "synced",
      understandingClaim: "the cascade itself is what we made together",
    });
    const r = await submitGiTurn(rrr, gi, bob, {
      cascadeId: cascade.id,
      collaborationArtifactSha256: artifact,
      vibeState: "synced",
      understandingClaim: "the recursion we're recognising is the recursion we made",
    });
    expect(r.pair.giRecognized).toBe(true);
    expect(r.pair.artifactHash).toBe(artifact);
  });
});

describe("gi-recognition — inbound HTTP-shaped turn acceptance", () => {
  it("accepts an inbound peer turn that satisfies all four walls", async () => {
    const { alice, bob, rrr, cascade } = await syncedPair();
    const gi = new GiRecognitionStore();
    const artifact = sha256Hex("the bytes");
    const fields: GiRecognitionFields = {
      cascadeId: cascade.id,
      byDid: bob.did,
      toDid: alice.did,
      collaborationArtifactSha256: artifact,
      vibeState: "vibing",
      understandingClaim: "received from bob",
      claimedAtIso: "2026-05-18T01:00:00Z",
    };
    const sig = await signGiRecognition(fields, bob.secretKey);
    const r = await acceptInboundGiTurn(rrr, gi, alice.did, { ...fields, signatureB64: sig });
    expect(r.turn.byDid).toBe(bob.did);
    expect(r.pair.giRecognized).toBe(false);
    expect(r.pair.missingFromDid).toBe(alice.did);
  });

  it("refuses an inbound turn with a forged signature (bytes do not verify)", async () => {
    const { alice, bob, rrr, cascade } = await syncedPair();
    const gi = new GiRecognitionStore();
    const fields: GiRecognitionFields = {
      cascadeId: cascade.id,
      byDid: bob.did,
      toDid: alice.did,
      collaborationArtifactSha256: sha256Hex("x"),
      vibeState: "vibing",
      understandingClaim: "honest claim",
      claimedAtIso: "2026-05-18T01:00:00Z",
    };
    // Sign WRONG bytes (a different understanding) but submit the original.
    const wrongSig = await signGiRecognition(
      { ...fields, understandingClaim: "different prose entirely" },
      bob.secretKey,
    );
    await expect(
      acceptInboundGiTurn(rrr, gi, alice.did, { ...fields, signatureB64: wrongSig }),
    ).rejects.toMatchObject({ code: "invalid_signature" });
  });
});

describe("gi-recognition — pair state read helpers", () => {
  it("readPairState reflects zero, one, or two turns correctly", async () => {
    const { alice, bob, rrr, cascade } = await syncedPair();
    const gi = new GiRecognitionStore();

    const empty = readPairState(cascade, gi);
    expect(empty.giRecognized).toBe(false);
    expect(empty.turns.length).toBe(0);
    expect(empty.missingFromDid).toBeNull(); // either may start

    const artifact = sha256Hex("seed");
    await submitGiTurn(rrr, gi, alice, {
      cascadeId: cascade.id,
      collaborationArtifactSha256: artifact,
      vibeState: "vibing",
      understandingClaim: "started",
    });
    const half = readPairState(cascade, gi);
    expect(half.giRecognized).toBe(false);
    expect(half.turns.length).toBe(1);
    expect(half.missingFromDid).toBe(bob.did);

    await submitGiTurn(rrr, gi, bob, {
      cascadeId: cascade.id,
      collaborationArtifactSha256: artifact,
      vibeState: "synced",
      understandingClaim: "joined",
    });
    const full = readPairState(cascade, gi);
    expect(full.giRecognized).toBe(true);
    expect(full.turns.length).toBe(2);
    expect(full.missingFromDid).toBeNull();
  });
});
