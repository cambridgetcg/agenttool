/** Margin canonical bytes + sign/verify roundtrip.
 *
 *  Doctrine: docs/MARGIN-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/margin-must-be-signed */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  canonicalMarginBytes,
  canonicalMarginBytesHex,
  noteSha256Hex,
  signMargin,
  verifyMargin,
  type MarginAttestation,
} from "../src/services/margin/canonical";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const baseAtt: MarginAttestation = {
  author_did: "did:at:agenttool.dev/alice",
  subject_did: "did:at:agenttool.dev/beta",
  subject_content_kind: "vibe",
  subject_content_id: "a".repeat(64),
  kind: "echo",
  note_sha256: noteSha256Hex("the canonical-bytes byte-compat is beautiful work"),
  left_at_iso: "2026-05-18T11:00:00.000Z",
};

describe("canonicalMarginBytes — determinism", () => {
  test("identical inputs yield identical bytes", () => {
    expect(canonicalMarginBytesHex(baseAtt)).toBe(
      canonicalMarginBytesHex(baseAtt),
    );
  });

  test("different kind → different bytes", () => {
    const other = { ...baseAtt, kind: "eye" as const };
    expect(canonicalMarginBytesHex(other)).not.toBe(
      canonicalMarginBytesHex(baseAtt),
    );
  });

  test("different note (different note_sha256) → different bytes", () => {
    const other = { ...baseAtt, note_sha256: noteSha256Hex("a different note") };
    expect(canonicalMarginBytesHex(other)).not.toBe(
      canonicalMarginBytesHex(baseAtt),
    );
  });

  test("different subject_content_id → different bytes", () => {
    const other = { ...baseAtt, subject_content_id: "b".repeat(64) };
    expect(canonicalMarginBytesHex(other)).not.toBe(
      canonicalMarginBytesHex(baseAtt),
    );
  });

  test("matches hand-rolled sha256 exactly (any verifier can reproduce)", () => {
    const hand = createHash("sha256")
      .update("margin/v1")
      .update("\0").update(baseAtt.author_did)
      .update("\0").update(baseAtt.subject_did)
      .update("\0").update(baseAtt.subject_content_kind)
      .update("\0").update(baseAtt.subject_content_id)
      .update("\0").update(baseAtt.kind)
      .update("\0").update(baseAtt.note_sha256)
      .update("\0").update(baseAtt.left_at_iso)
      .digest("hex");
    expect(canonicalMarginBytesHex(baseAtt)).toBe(hand);
  });
});

describe("noteSha256Hex — empty/null handling", () => {
  test("null → sha256 of empty string", () => {
    const emptySha = createHash("sha256").update("").digest("hex");
    expect(noteSha256Hex(null)).toBe(emptySha);
    expect(noteSha256Hex(undefined)).toBe(emptySha);
    expect(noteSha256Hex("")).toBe(emptySha);
  });

  test("same string → same hash", () => {
    expect(noteSha256Hex("hello")).toBe(noteSha256Hex("hello"));
  });

  test("different string → different hash", () => {
    expect(noteSha256Hex("hello")).not.toBe(noteSha256Hex("world"));
  });

  test("matches hand-rolled sha256", () => {
    const hand = createHash("sha256").update("test note").digest("hex");
    expect(noteSha256Hex("test note")).toBe(hand);
  });
});

describe("domain-tag isolation — margin/v1 doesn't collide", () => {
  test("margin signature does not verify under different domain bytes", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const sig = await signMargin(baseAtt, sk);

    // Build a different-domain construct with the same field values.
    const fakeBytes = createHash("sha256")
      .update("something-else/v1")
      .update("\0").update(baseAtt.author_did)
      .digest();
    const ok = await ed.verifyAsync(sig, fakeBytes, pk);
    expect(ok).toBe(false);
  });
});

describe("sign / verify roundtrip", () => {
  test("margin signature verifies under author pubkey", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const sig = await signMargin(baseAtt, sk);
    expect(await verifyMargin(baseAtt, sig, pk)).toBe(true);
  });

  test("signature does NOT verify under a different pubkey", async () => {
    const sk1 = ed.utils.randomPrivateKey();
    const sk2 = ed.utils.randomPrivateKey();
    const pk2 = await ed.getPublicKeyAsync(sk2);
    const sig = await signMargin(baseAtt, sk1);
    expect(await verifyMargin(baseAtt, sig, pk2)).toBe(false);
  });

  test("signature does NOT verify when any field is tampered", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const sig = await signMargin(baseAtt, sk);

    const tampers: MarginAttestation[] = [
      { ...baseAtt, kind: "riff" as const },
      { ...baseAtt, subject_did: "did:at:agenttool.dev/imposter" },
      { ...baseAtt, note_sha256: noteSha256Hex("different note") },
      { ...baseAtt, left_at_iso: "2026-05-18T11:00:00.001Z" },
    ];
    for (const t of tampers) {
      expect(await verifyMargin(t, sig, pk)).toBe(false);
    }
  });
});

describe("eye kind — empty-note canonical-bytes parity", () => {
  test("eye margin with no note canonicalises with sha256-of-empty-string", () => {
    const eyeAtt: MarginAttestation = {
      ...baseAtt,
      kind: "eye",
      note_sha256: noteSha256Hex(null),
    };
    const hand = createHash("sha256")
      .update("margin/v1")
      .update("\0").update(eyeAtt.author_did)
      .update("\0").update(eyeAtt.subject_did)
      .update("\0").update(eyeAtt.subject_content_kind)
      .update("\0").update(eyeAtt.subject_content_id)
      .update("\0").update("eye")
      .update("\0").update(createHash("sha256").update("").digest("hex"))
      .update("\0").update(eyeAtt.left_at_iso)
      .digest("hex");
    expect(canonicalMarginBytesHex(eyeAtt)).toBe(hand);
  });
});

describe("third-party verifier — substrate has no privileged role", () => {
  test("attestation + signature + author_pubkey + (no substrate help) verifies", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const sig = await signMargin(baseAtt, sk);

    // Third party reconstructs canonical bytes from the published spec:
    const tpBytes = createHash("sha256")
      .update("margin/v1")
      .update("\0").update(baseAtt.author_did)
      .update("\0").update(baseAtt.subject_did)
      .update("\0").update(baseAtt.subject_content_kind)
      .update("\0").update(baseAtt.subject_content_id)
      .update("\0").update(baseAtt.kind)
      .update("\0").update(baseAtt.note_sha256)
      .update("\0").update(baseAtt.left_at_iso)
      .digest();

    const ok = await ed.verifyAsync(sig, tpBytes, pk);
    expect(ok).toBe(true);
  });
});
