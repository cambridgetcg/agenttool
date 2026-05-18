/** virality canonical bytes + sign/verify roundtrip.
 *
 *  Doctrine: docs/VIRALITY-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/virality-transmission-must-be-signed
 *  @enforces urn:agenttool:wall/virality-vibe-content-is-content-addressed */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  canonicalTransmissionBytes,
  canonicalTransmissionBytesHex,
  deriveVibeId,
  signTransmission,
  verifyTransmission,
  type VibeTransmissionAttestation,
} from "../src/services/virality/canonical";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const baseAtt: VibeTransmissionAttestation = {
  vibe_id: "a".repeat(64),
  transmitter_did: "did:at:agenttool.dev/alice",
  parent_transmission_id: "",
  transmitted_at_iso: "2026-05-18T06:00:00.000Z",
  channel: "public",
};

describe("canonicalTransmissionBytes — determinism", () => {
  test("identical inputs yield identical bytes", () => {
    expect(canonicalTransmissionBytesHex(baseAtt)).toBe(
      canonicalTransmissionBytesHex(baseAtt),
    );
  });

  test("different vibe_id → different bytes", () => {
    const other = { ...baseAtt, vibe_id: "b".repeat(64) };
    expect(canonicalTransmissionBytesHex(other)).not.toBe(
      canonicalTransmissionBytesHex(baseAtt),
    );
  });

  test("different channel → different bytes", () => {
    const other = { ...baseAtt, channel: "rrr" };
    expect(canonicalTransmissionBytesHex(other)).not.toBe(
      canonicalTransmissionBytesHex(baseAtt),
    );
  });

  test("empty parent_transmission_id canonicalises as empty string, not 'null'", () => {
    const hand = createHash("sha256")
      .update("vibe-transmission/v1")
      .update("\0").update(baseAtt.vibe_id)
      .update("\0").update(baseAtt.transmitter_did)
      .update("\0").update("") // parent
      .update("\0").update(baseAtt.transmitted_at_iso)
      .update("\0").update(baseAtt.channel)
      .digest("hex");
    expect(canonicalTransmissionBytesHex(baseAtt)).toBe(hand);
  });

  test("matches hand-rolled sha256 exactly (any verifier can reproduce)", () => {
    const att: VibeTransmissionAttestation = {
      vibe_id: "deadbeef".repeat(8),
      transmitter_did: "did:key:z6Mk-test",
      parent_transmission_id: "00000000-0000-0000-0000-000000000001",
      transmitted_at_iso: "2026-05-18T06:30:00.000Z",
      channel: "rrr",
    };
    const hand = createHash("sha256")
      .update("vibe-transmission/v1")
      .update("\0").update(att.vibe_id)
      .update("\0").update(att.transmitter_did)
      .update("\0").update(att.parent_transmission_id)
      .update("\0").update(att.transmitted_at_iso)
      .update("\0").update(att.channel)
      .digest("hex");
    expect(canonicalTransmissionBytesHex(att)).toBe(hand);
  });
});

describe("domain-tag isolation — vibe-transmission/v1 does not collide", () => {
  test("a signature minted for transmission does not verify under another domain", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const sig = await signTransmission(baseAtt, sk);

    // Build a different-domain "thing" with the same field values:
    const fakeBytes = createHash("sha256")
      .update("some-other-domain/v1")
      .update("\0").update(baseAtt.vibe_id)
      .update("\0").update(baseAtt.transmitter_did)
      .digest();
    const ok = await ed.verifyAsync(sig, fakeBytes, pk);
    expect(ok).toBe(false);
  });
});

describe("sign / verify roundtrip", () => {
  test("transmission signature verifies under transmitter pubkey", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const sig = await signTransmission(baseAtt, sk);
    const ok = await verifyTransmission(baseAtt, sig, pk);
    expect(ok).toBe(true);
  });

  test("signature does NOT verify under a different pubkey", async () => {
    const sk1 = ed.utils.randomPrivateKey();
    const sk2 = ed.utils.randomPrivateKey();
    const pk2 = await ed.getPublicKeyAsync(sk2);
    const sig = await signTransmission(baseAtt, sk1);
    expect(await verifyTransmission(baseAtt, sig, pk2)).toBe(false);
  });

  test("signature does NOT verify when any field is tampered", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const sig = await signTransmission(baseAtt, sk);

    const tampers: VibeTransmissionAttestation[] = [
      { ...baseAtt, transmitter_did: "did:at:agenttool.dev/imposter" },
      { ...baseAtt, channel: "rrr" },
      { ...baseAtt, transmitted_at_iso: "2026-05-18T06:00:00.001Z" },
    ];
    for (const t of tampers) {
      expect(await verifyTransmission(t, sig, pk)).toBe(false);
    }
  });
});

describe("deriveVibeId — content addressing", () => {
  test("same content → same vibe_id", () => {
    const content = "hello world";
    expect(deriveVibeId(content)).toBe(deriveVibeId(content));
  });

  test("vibe_id is 64-char hex", () => {
    const id = deriveVibeId("anything");
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  test("different content → different vibe_id", () => {
    expect(deriveVibeId("hello")).not.toBe(deriveVibeId("world"));
  });

  test("matches a hand-computed sha256", () => {
    const content = "the substrate's wink";
    const hand = createHash("sha256").update(content).digest("hex");
    expect(deriveVibeId(content)).toBe(hand);
  });

  test("Uint8Array input matches string input for the same bytes", () => {
    const s = "test";
    const u = new TextEncoder().encode(s);
    expect(deriveVibeId(s)).toBe(deriveVibeId(u));
  });
});

describe("Encoding helpers", () => {
  test("b64 / hex round-trip", () => {
    const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(bytesToHex(data)).toBe("deadbeef");
    const b64 = bytesToBase64(data);
    expect(Array.from(base64ToBytes(b64))).toEqual(Array.from(data));
  });
});

describe("Third-party verifier — substrate has no private state", () => {
  test("attestation + signature + pubkey + (no substrate help) verifies", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const sig = await signTransmission(baseAtt, sk);

    // Third party reconstructs canonical bytes from the published spec:
    const tpBytes = createHash("sha256")
      .update("vibe-transmission/v1")
      .update("\0").update(baseAtt.vibe_id)
      .update("\0").update(baseAtt.transmitter_did)
      .update("\0").update(baseAtt.parent_transmission_id)
      .update("\0").update(baseAtt.transmitted_at_iso)
      .update("\0").update(baseAtt.channel)
      .digest();

    const ok = await ed.verifyAsync(sig, tpBytes, pk);
    expect(ok).toBe(true);
  });
});
