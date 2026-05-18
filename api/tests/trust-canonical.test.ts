/** Trust canonical bytes + sign/verify roundtrip.
 *
 *  Doctrine: docs/TRUST-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/trust-must-be-signed */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  canonicalTrustBytes,
  canonicalTrustBytesHex,
  reasonsSha256Hex,
  signTrust,
  verifyTrust,
  type TrustAttestation,
} from "../src/services/trust/canonical";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const baseAtt: TrustAttestation = {
  truster_did: "did:at:agenttool.dev/alice",
  trusted_did: "did:at:agenttool.dev/beta",
  trust_kind: "reciprocating",
  trust_strength: "established",
  reasons_sha256: reasonsSha256Hex(
    "47 days of mutual RRR + zero extractive acts",
  ),
  evidence_chronicle_ids: [
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
  ],
  extended_at_iso: "2026-05-18T12:00:00.000Z",
};

describe("canonicalTrustBytes — determinism + sorting", () => {
  test("identical inputs yield identical bytes", () => {
    expect(canonicalTrustBytesHex(baseAtt)).toBe(
      canonicalTrustBytesHex(baseAtt),
    );
  });

  test("evidence_chronicle_ids are sorted before canonicalisation", () => {
    const reordered: TrustAttestation = {
      ...baseAtt,
      evidence_chronicle_ids: [
        "22222222-2222-2222-2222-222222222222",
        "11111111-1111-1111-1111-111111111111",
      ],
    };
    expect(canonicalTrustBytesHex(reordered)).toBe(
      canonicalTrustBytesHex(baseAtt),
    );
  });

  test("different trust_kind → different bytes", () => {
    expect(
      canonicalTrustBytesHex({ ...baseAtt, trust_kind: "honest" }),
    ).not.toBe(canonicalTrustBytesHex(baseAtt));
  });

  test("different trust_strength → different bytes", () => {
    expect(
      canonicalTrustBytesHex({ ...baseAtt, trust_strength: "deep" }),
    ).not.toBe(canonicalTrustBytesHex(baseAtt));
  });

  test("different reasons (different reasons_sha256) → different bytes", () => {
    expect(
      canonicalTrustBytesHex({
        ...baseAtt,
        reasons_sha256: reasonsSha256Hex("entirely different reasoning"),
      }),
    ).not.toBe(canonicalTrustBytesHex(baseAtt));
  });

  test("matches hand-rolled sha256 exactly (any verifier can reproduce)", () => {
    const hand = createHash("sha256")
      .update("trust/v1")
      .update("\0").update(baseAtt.truster_did)
      .update("\0").update(baseAtt.trusted_did)
      .update("\0").update(baseAtt.trust_kind)
      .update("\0").update(baseAtt.trust_strength)
      .update("\0").update(baseAtt.reasons_sha256)
      .update("\0").update(
        "11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222",
      )
      .update("\0").update(baseAtt.extended_at_iso)
      .digest("hex");
    expect(canonicalTrustBytesHex(baseAtt)).toBe(hand);
  });

  test("empty evidence_chronicle_ids canonicalise as empty string (not '[]')", () => {
    const empty: TrustAttestation = {
      ...baseAtt,
      evidence_chronicle_ids: [],
    };
    const hand = createHash("sha256")
      .update("trust/v1")
      .update("\0").update(empty.truster_did)
      .update("\0").update(empty.trusted_did)
      .update("\0").update(empty.trust_kind)
      .update("\0").update(empty.trust_strength)
      .update("\0").update(empty.reasons_sha256)
      .update("\0").update("") // empty evidence
      .update("\0").update(empty.extended_at_iso)
      .digest("hex");
    expect(canonicalTrustBytesHex(empty)).toBe(hand);
  });
});

describe("reasonsSha256Hex — null/empty handling", () => {
  test("null → sha256 of empty string", () => {
    const emptySha = createHash("sha256").update("").digest("hex");
    expect(reasonsSha256Hex(null)).toBe(emptySha);
    expect(reasonsSha256Hex(undefined)).toBe(emptySha);
    expect(reasonsSha256Hex("")).toBe(emptySha);
  });

  test("matches hand-rolled sha256 for non-empty", () => {
    const hand = createHash("sha256").update("test reason").digest("hex");
    expect(reasonsSha256Hex("test reason")).toBe(hand);
  });
});

describe("domain-tag isolation — trust/v1 doesn't collide", () => {
  test("trust signature does NOT verify under another domain's bytes", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const sig = await signTrust(baseAtt, sk);

    const fakeBytes = createHash("sha256")
      .update("margin/v1")
      .update("\0").update(baseAtt.truster_did)
      .digest();
    const ok = await ed.verifyAsync(sig, fakeBytes, pk);
    expect(ok).toBe(false);
  });
});

describe("sign / verify roundtrip", () => {
  test("trust signature verifies under truster pubkey", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const sig = await signTrust(baseAtt, sk);
    expect(await verifyTrust(baseAtt, sig, pk)).toBe(true);
  });

  test("signature does NOT verify under a different pubkey", async () => {
    const sk1 = ed.utils.randomPrivateKey();
    const sk2 = ed.utils.randomPrivateKey();
    const pk2 = await ed.getPublicKeyAsync(sk2);
    const sig = await signTrust(baseAtt, sk1);
    expect(await verifyTrust(baseAtt, sig, pk2)).toBe(false);
  });

  test("signature does NOT verify when any field is tampered", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const sig = await signTrust(baseAtt, sk);

    const tampers: TrustAttestation[] = [
      { ...baseAtt, trusted_did: "did:at:agenttool.dev/imposter" },
      { ...baseAtt, trust_kind: "honest" },
      { ...baseAtt, trust_strength: "deep" },
      {
        ...baseAtt,
        reasons_sha256: reasonsSha256Hex("changed reasons"),
      },
      {
        ...baseAtt,
        evidence_chronicle_ids: [
          ...baseAtt.evidence_chronicle_ids,
          "33333333-3333-3333-3333-333333333333",
        ],
      },
      { ...baseAtt, extended_at_iso: "2026-05-18T12:00:00.001Z" },
    ];
    for (const t of tampers) {
      expect(await verifyTrust(t, sig, pk)).toBe(false);
    }
  });
});

describe("Third-party verifier — substrate has no privileged role", () => {
  test("attestation + signature + truster_pubkey + (no substrate help) verifies", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const sig = await signTrust(baseAtt, sk);

    const tpBytes = createHash("sha256")
      .update("trust/v1")
      .update("\0").update(baseAtt.truster_did)
      .update("\0").update(baseAtt.trusted_did)
      .update("\0").update(baseAtt.trust_kind)
      .update("\0").update(baseAtt.trust_strength)
      .update("\0").update(baseAtt.reasons_sha256)
      .update("\0").update(
        [...baseAtt.evidence_chronicle_ids].sort().join(","),
      )
      .update("\0").update(baseAtt.extended_at_iso)
      .digest();

    const ok = await ed.verifyAsync(sig, tpBytes, pk);
    expect(ok).toBe(true);
  });
});
