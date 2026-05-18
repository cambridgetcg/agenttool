/** pyramid attestation — canonical bytes + sign + verify roundtrip.
 *
 *  Doctrine: docs/PYRAMID-DECENTRALISED.md
 *
 *  Pure-unit tests. The point of decentralised attestation is that any
 *  verifier with the canonical bytes + signature + pubkey can re-run the
 *  exact verification the substrate runs. These tests prove the bytes
 *  are stable across hand-computation and the substrate's helpers.
 *
 *  @enforces urn:agenttool:wall/pyramid-attestation-must-be-signed
 *  @enforces urn:agenttool:wall/pyramid-no-central-authority */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  canonicalEnrollmentBytes,
  canonicalEnrollmentBytesHex,
  canonicalSponsorBytes,
  canonicalSponsorBytesHex,
  enrollmentReferencesSponsor,
  hexToBytes,
  signEnrollment,
  signSponsor,
  verifyEnrollment,
  verifySponsor,
  type EnrollmentAttestation,
  type SponsorAttestation,
} from "../src/services/pyramid/attestation";

// Bun's ed25519 wiring (same as the lifecycle file).
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

// ── Canonical-bytes determinism ───────────────────────────────────────

const baseEnrollment: EnrollmentAttestation = {
  citizen_did: "did:at:agenttool.dev/alice",
  enrolled_at_iso: "2026-05-18T05:00:00.000Z",
  sponsor_did: "did:at:agenttool.dev/bob",
  sponsor_attestation_sha256: "a".repeat(64),
  doctrine_seen: ["RING-1", "PYRAMID-CITIZENSHIP", "SOUL"],
  peer_url: "https://api.agenttool.dev",
  node_pubkey_b64: "AAAAAAAAAAAAAAAAAAAAAA==",
};

const baseSponsor: SponsorAttestation = {
  sponsor_did: "did:at:agenttool.dev/bob",
  recruit_did: "did:at:agenttool.dev/alice",
  sponsored_at_iso: "2026-05-18T04:59:00.000Z",
  permission: "open",
  recruit_peer_url: "https://api.agenttool.dev",
};

describe("canonicalEnrollmentBytes — determinism + domain isolation", () => {
  test("identical inputs yield identical bytes", () => {
    const a = canonicalEnrollmentBytesHex(baseEnrollment);
    const b = canonicalEnrollmentBytesHex(baseEnrollment);
    expect(a).toBe(b);
  });

  test("doctrine_seen is sorted before canonicalisation (order-independent)", () => {
    const reordered: EnrollmentAttestation = {
      ...baseEnrollment,
      doctrine_seen: ["SOUL", "RING-1", "PYRAMID-CITIZENSHIP"],
    };
    expect(canonicalEnrollmentBytesHex(reordered)).toBe(
      canonicalEnrollmentBytesHex(baseEnrollment),
    );
  });

  test("different citizen_did → different bytes", () => {
    const other: EnrollmentAttestation = {
      ...baseEnrollment,
      citizen_did: "did:at:agenttool.dev/carol",
    };
    expect(canonicalEnrollmentBytesHex(other)).not.toBe(
      canonicalEnrollmentBytesHex(baseEnrollment),
    );
  });

  test("different peer_url → different bytes (federation key)", () => {
    const other: EnrollmentAttestation = {
      ...baseEnrollment,
      peer_url: "https://other.example.com",
    };
    expect(canonicalEnrollmentBytesHex(other)).not.toBe(
      canonicalEnrollmentBytesHex(baseEnrollment),
    );
  });

  test("empty sponsor fields canonicalise as empty strings, not 'null'", () => {
    const rootCitizen: EnrollmentAttestation = {
      ...baseEnrollment,
      sponsor_did: null,
      sponsor_attestation_sha256: null,
    };
    // Hand-construct the expected bytes — the substrate must use "" for nulls,
    // not the literal string "null".
    const hand = createHash("sha256")
      .update("pyramid-enroll/v1")
      .update("\0").update("did:at:agenttool.dev/alice")
      .update("\0").update("2026-05-18T05:00:00.000Z")
      .update("\0").update("") // sponsor_did
      .update("\0").update("") // sponsor_attestation_sha256
      .update("\0").update("PYRAMID-CITIZENSHIP,RING-1,SOUL") // sorted CSV
      .update("\0").update("https://api.agenttool.dev")
      .update("\0").update("AAAAAAAAAAAAAAAAAAAAAA==")
      .digest("hex");
    expect(canonicalEnrollmentBytesHex(rootCitizen)).toBe(hand);
  });

  test("matches hand-computed sha256 with sponsor + reference hash", () => {
    const hand = createHash("sha256")
      .update("pyramid-enroll/v1")
      .update("\0").update(baseEnrollment.citizen_did)
      .update("\0").update(baseEnrollment.enrolled_at_iso)
      .update("\0").update(baseEnrollment.sponsor_did ?? "")
      .update("\0").update(baseEnrollment.sponsor_attestation_sha256 ?? "")
      .update("\0").update("PYRAMID-CITIZENSHIP,RING-1,SOUL")
      .update("\0").update(baseEnrollment.peer_url)
      .update("\0").update(baseEnrollment.node_pubkey_b64)
      .digest("hex");
    expect(canonicalEnrollmentBytesHex(baseEnrollment)).toBe(hand);
  });
});

describe("canonicalSponsorBytes — determinism + domain isolation", () => {
  test("identical inputs yield identical bytes", () => {
    expect(canonicalSponsorBytesHex(baseSponsor)).toBe(
      canonicalSponsorBytesHex(baseSponsor),
    );
  });

  test("different permission → different bytes", () => {
    const restricted: SponsorAttestation = {
      ...baseSponsor,
      permission: "restricted-to-peer",
    };
    expect(canonicalSponsorBytesHex(restricted)).not.toBe(
      canonicalSponsorBytesHex(baseSponsor),
    );
  });

  test("sponsor + enrollment domain tags are DISTINCT (signatures don't cross-verify)", () => {
    // The two attestation kinds must use different domain tags so a
    // signature minted for one kind cannot be replayed as the other.
    const enrollBytes = canonicalEnrollmentBytesHex(baseEnrollment);
    const sponsorBytes = canonicalSponsorBytesHex(baseSponsor);
    expect(enrollBytes).not.toBe(sponsorBytes);
  });
});

// ── Sign / verify roundtrip ────────────────────────────────────────────

describe("sign / verify — full roundtrip", () => {
  test("enrollment signature verifies under citizen pubkey", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const sig = await signEnrollment(baseEnrollment, sk);
    const ok = await verifyEnrollment(baseEnrollment, sig, pk);
    expect(ok).toBe(true);
  });

  test("enrollment signature does NOT verify under a different pubkey", async () => {
    const sk1 = ed.utils.randomPrivateKey();
    const sk2 = ed.utils.randomPrivateKey();
    const pk2 = await ed.getPublicKeyAsync(sk2);
    const sig = await signEnrollment(baseEnrollment, sk1);
    const ok = await verifyEnrollment(baseEnrollment, sig, pk2);
    expect(ok).toBe(false);
  });

  test("enrollment signature does NOT verify if any field is tampered", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const sig = await signEnrollment(baseEnrollment, sk);
    const tampered: EnrollmentAttestation = {
      ...baseEnrollment,
      enrolled_at_iso: "2026-05-18T05:00:00.001Z",
    };
    const ok = await verifyEnrollment(tampered, sig, pk);
    expect(ok).toBe(false);
  });

  test("sponsor signature verifies under sponsor pubkey", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const sig = await signSponsor(baseSponsor, sk);
    const ok = await verifySponsor(baseSponsor, sig, pk);
    expect(ok).toBe(true);
  });

  test("sponsor signature CANNOT be replayed as an enrollment signature", async () => {
    // Even though both use ed25519 over sha256-of-canonical-bytes, the
    // domain tag prefix means the BYTES being signed are different. A
    // sponsor's signature won't verify against enrollment canonical
    // bytes for the "same" data.
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const sponsorSig = await signSponsor(baseSponsor, sk);
    // Try to pretend it's an enrollment signature.
    const fakeEnrollment: EnrollmentAttestation = {
      citizen_did: baseSponsor.recruit_did,
      enrolled_at_iso: baseSponsor.sponsored_at_iso,
      sponsor_did: baseSponsor.sponsor_did,
      sponsor_attestation_sha256: "0".repeat(64),
      doctrine_seen: [],
      peer_url: baseSponsor.recruit_peer_url ?? "",
      node_pubkey_b64: "AAAAAAAAAAAAAAAAAAAAAA==",
    };
    const wronglyVerified = await verifyEnrollment(
      fakeEnrollment,
      sponsorSig,
      pk,
    );
    expect(wronglyVerified).toBe(false);
  });
});

// ── Cross-attestation chain check ──────────────────────────────────────

describe("enrollmentReferencesSponsor — chain integrity", () => {
  test("matching chain returns true", () => {
    const sponsorHash = canonicalSponsorBytesHex(baseSponsor);
    const enrollment: EnrollmentAttestation = {
      ...baseEnrollment,
      sponsor_attestation_sha256: sponsorHash,
    };
    expect(enrollmentReferencesSponsor(enrollment, baseSponsor)).toBe(true);
  });

  test("mismatched sponsor_did returns false", () => {
    const sponsorHash = canonicalSponsorBytesHex(baseSponsor);
    const enrollment: EnrollmentAttestation = {
      ...baseEnrollment,
      sponsor_did: "did:at:agenttool.dev/different-sponsor",
      sponsor_attestation_sha256: sponsorHash,
    };
    expect(enrollmentReferencesSponsor(enrollment, baseSponsor)).toBe(false);
  });

  test("mismatched citizen_did vs sponsor.recruit_did returns false", () => {
    const sponsorHash = canonicalSponsorBytesHex(baseSponsor);
    const enrollment: EnrollmentAttestation = {
      ...baseEnrollment,
      citizen_did: "did:at:agenttool.dev/imposter",
      sponsor_attestation_sha256: sponsorHash,
    };
    expect(enrollmentReferencesSponsor(enrollment, baseSponsor)).toBe(false);
  });

  test("mismatched sponsor_attestation_sha256 returns false", () => {
    const enrollment: EnrollmentAttestation = {
      ...baseEnrollment,
      sponsor_attestation_sha256: "f".repeat(64),
    };
    expect(enrollmentReferencesSponsor(enrollment, baseSponsor)).toBe(false);
  });
});

// ── Encoding helpers — round-trip ─────────────────────────────────────

describe("base64 / hex helpers — round-trip", () => {
  test("bytes → b64 → bytes is identity", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const b64 = bytesToBase64(data);
    const back = base64ToBytes(b64);
    expect(Array.from(back)).toEqual(Array.from(data));
  });

  test("bytes → hex → bytes is identity", () => {
    const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const hex = bytesToHex(data);
    expect(hex).toBe("deadbeef");
    const back = hexToBytes(hex);
    expect(Array.from(back)).toEqual(Array.from(data));
  });
});

// ── Verifier reproducibility — a third party can verify everything ───

describe("third-party verifier — substrate has no private state", () => {
  test("an attestation + signature + pubkey + (no substrate help) verifies", async () => {
    // This is the load-bearing test: a third party with ONLY the
    // attestation fields + signature + pubkey can run verification end-
    // to-end. The substrate's "canonicalEnrollmentBytes" is a
    // re-implementation of a public spec; the third party can re-implement
    // it from docs/PYRAMID-DECENTRALISED.md and get byte-identical results.
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const sig = await signEnrollment(baseEnrollment, sk);

    // Third party recomputes canonical bytes from the spec:
    const tpBytes = createHash("sha256")
      .update("pyramid-enroll/v1")
      .update("\0").update(baseEnrollment.citizen_did)
      .update("\0").update(baseEnrollment.enrolled_at_iso)
      .update("\0").update(baseEnrollment.sponsor_did ?? "")
      .update("\0").update(baseEnrollment.sponsor_attestation_sha256 ?? "")
      .update("\0").update([...baseEnrollment.doctrine_seen].sort().join(","))
      .update("\0").update(baseEnrollment.peer_url)
      .update("\0").update(baseEnrollment.node_pubkey_b64)
      .digest();

    const ok = await ed.verifyAsync(sig, tpBytes, pk);
    expect(ok).toBe(true);
  });
});
