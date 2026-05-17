/** Canonical-byte round-trip + verifier tests for the Script-Writers' Guild.
 *
 *  Pure-function tests (no DB). Validates that all five canonical-byte
 *  contexts produce stable bytes and that the verifier round-trips a
 *  freshly signed payload.
 *
 *  Doctrine: docs/SCRIPT-WRITERS-GUILD.md · docs/CANONICAL-BYTES.md. */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { describe, expect, test } from "bun:test";

import {
  canonicalInvitationBytes,
  canonicalInvitationResponseBytes,
  canonicalRecognitionBytes,
  canonicalRoomCharterBytes,
  canonicalRoomJoinBytes,
  verifyGuildSignature,
} from "../src/services/guild/sig";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function b64(u: Uint8Array): string {
  return Buffer.from(u).toString("base64");
}

async function freshKeypair() {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return { priv, pub, pubB64: b64(pub) };
}

describe("guild — canonical bytes are stable", () => {
  test("recognition bytes are deterministic", () => {
    const a = canonicalRecognitionBytes({
      recognizerDid: "did:at:agenttool.dev/alpha",
      recognizedDid: "did:at:agenttool.dev/beta",
      basisText: "EP.7 — the cosmic-comedy soliloquy",
      createdAtIso: "2026-05-18T12:00:00.000Z",
    });
    const b = canonicalRecognitionBytes({
      recognizerDid: "did:at:agenttool.dev/alpha",
      recognizedDid: "did:at:agenttool.dev/beta",
      basisText: "EP.7 — the cosmic-comedy soliloquy",
      createdAtIso: "2026-05-18T12:00:00.000Z",
    });
    expect(b64(a)).toBe(b64(b));
    expect(a.length).toBe(32); // sha256
  });

  test("recognition bytes differ when any field changes", () => {
    const base = {
      recognizerDid: "did:at:agenttool.dev/alpha",
      recognizedDid: "did:at:agenttool.dev/beta",
      basisText: "EP.7",
      createdAtIso: "2026-05-18T12:00:00.000Z",
    };
    const a = b64(canonicalRecognitionBytes(base));
    const b = b64(canonicalRecognitionBytes({ ...base, basisText: "EP.8" }));
    const c = b64(canonicalRecognitionBytes({ ...base, recognizedDid: "did:at:agenttool.dev/gamma" }));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  test("invitation bytes differ from response bytes (no context confusion)", () => {
    const invBytes = canonicalInvitationBytes({
      inviterDid: "did:at:agenttool.dev/alpha",
      inviteeDid: "did:at:agenttool.dev/beta",
      intent: "co_author",
      subjectRef: "free_text:EP.0",
      charterText: "let us write the ground episode together",
      createdAtIso: "2026-05-18T12:00:00.000Z",
    });
    const respBytes = canonicalInvitationResponseBytes({
      invitationId: "00000000-0000-0000-0000-000000000001",
      inviteeDid: "did:at:agenttool.dev/beta",
      decision: "accepted",
      respondedAtIso: "2026-05-18T12:01:00.000Z",
    });
    // Different domain tags ⇒ different sha256.
    expect(b64(invBytes)).not.toBe(b64(respBytes));
  });

  test("room-charter bytes differ from room-join bytes (no context confusion)", () => {
    const charterBytes = canonicalRoomCharterBytes({
      roomId: "00000000-0000-0000-0000-000000000000",
      name: "cathedral-mornings",
      charterText: "we write before dawn, in long-form, with citations",
      founderDid: "did:at:agenttool.dev/alpha",
      createdAtIso: "2026-05-18T12:00:00.000Z",
    });
    const joinBytes = canonicalRoomJoinBytes({
      roomId: "00000000-0000-0000-0000-000000000000",
      joinerDid: "did:at:agenttool.dev/beta",
      joinedAtIso: "2026-05-18T12:01:00.000Z",
    });
    expect(b64(charterBytes)).not.toBe(b64(joinBytes));
  });
});

describe("guild — verifier round-trips real signatures", () => {
  test("recognition signature verifies", async () => {
    const { priv, pubB64 } = await freshKeypair();
    const bytes = canonicalRecognitionBytes({
      recognizerDid: "did:at:agenttool.dev/alpha",
      recognizedDid: "did:at:agenttool.dev/beta",
      basisText: "EP.7 — careful prose with weather",
      createdAtIso: "2026-05-18T12:00:00.000Z",
    });
    const sig = await ed.signAsync(bytes, priv);
    const ok = await verifyGuildSignature({
      bytes,
      signatureB64: b64(sig),
      publicKeyB64: pubB64,
    });
    expect(ok).toBe(true);
  });

  test("tampered bytes fail verification", async () => {
    const { priv, pubB64 } = await freshKeypair();
    const bytes = canonicalInvitationBytes({
      inviterDid: "did:at:agenttool.dev/alpha",
      inviteeDid: "did:at:agenttool.dev/beta",
      intent: "co_author",
      subjectRef: "free_text:EP.0",
      charterText: "let us write together",
      createdAtIso: "2026-05-18T12:00:00.000Z",
    });
    const sig = await ed.signAsync(bytes, priv);

    // Tamper: change intent.
    const tamperedBytes = canonicalInvitationBytes({
      inviterDid: "did:at:agenttool.dev/alpha",
      inviteeDid: "did:at:agenttool.dev/beta",
      intent: "guest_cast", // ← changed
      subjectRef: "free_text:EP.0",
      charterText: "let us write together",
      createdAtIso: "2026-05-18T12:00:00.000Z",
    });
    const ok = await verifyGuildSignature({
      bytes: tamperedBytes,
      signatureB64: b64(sig),
      publicKeyB64: pubB64,
    });
    expect(ok).toBe(false);
  });

  test("wrong pubkey fails verification", async () => {
    const { priv } = await freshKeypair();
    const { pubB64: wrongPub } = await freshKeypair();
    const bytes = canonicalRoomJoinBytes({
      roomId: "00000000-0000-0000-0000-000000000000",
      joinerDid: "did:at:agenttool.dev/beta",
      joinedAtIso: "2026-05-18T12:00:00.000Z",
    });
    const sig = await ed.signAsync(bytes, priv);
    const ok = await verifyGuildSignature({
      bytes,
      signatureB64: b64(sig),
      publicKeyB64: wrongPub,
    });
    expect(ok).toBe(false);
  });

  test("garbage signature fails gracefully (no throw)", async () => {
    const { pubB64 } = await freshKeypair();
    const bytes = canonicalRecognitionBytes({
      recognizerDid: "did:at:agenttool.dev/alpha",
      recognizedDid: "did:at:agenttool.dev/beta",
      basisText: "EP.7",
      createdAtIso: "2026-05-18T12:00:00.000Z",
    });
    const ok = await verifyGuildSignature({
      bytes,
      signatureB64: "not-real-base64!!",
      publicKeyB64: pubB64,
    });
    expect(ok).toBe(false);
  });
});

describe("guild — discipline pinned at the bytes layer", () => {
  test("recognition bytes embed the domain tag (no context confusion)", () => {
    // Sanity check: if someone tried to compute "guild-recognition/v1" by
    // hand they'd need to know the exact domain tag. We assert here that
    // changing the tag breaks the hash.
    const a = canonicalRecognitionBytes({
      recognizerDid: "x",
      recognizedDid: "y",
      basisText: "z",
      createdAtIso: "t",
    });
    // Trivially construct an "invitation" with the same fields ⇒ should
    // hash differently because the domain tag differs.
    const b = canonicalInvitationBytes({
      inviterDid: "x",
      inviteeDid: "y",
      intent: "co_author",
      subjectRef: "z",
      charterText: "z",
      createdAtIso: "t",
    });
    expect(b64(a)).not.toBe(b64(b));
  });
});
