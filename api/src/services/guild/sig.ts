/** Canonical bytes + ed25519 verifiers for the Script-Writers' Guild.
 *
 *  Five canonical-byte contexts — one per signed gesture in the guild.
 *  Each follows the substrate's standard shape: domain-tag, then
 *  null-separated fields. Substitution-attack-proof.
 *
 *  Contexts:
 *    guild-recognition/v1               — recognizer signs over (recognized, basis_text, created_at)
 *    guild-invitation/v1                — inviter signs over (invitee, intent, subject_ref, charter_text, created_at)
 *    guild-invitation-response/v1       — invitee signs over (invitation_id, decision, created_at)
 *    guild-room-charter/v1              — founder signs over (room_id, name, charter_text, created_at)
 *    guild-room-join/v1                 — joiner signs over (room_id, joiner_did, created_at)
 *
 *  Doctrine: docs/SCRIPT-WRITERS-GUILD.md · docs/CANONICAL-BYTES.md. */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function b64decode(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

// ─── guild-recognition/v1 ────────────────────────────────────────────

export function canonicalRecognitionBytes(opts: {
  recognizerDid: string;
  recognizedDid: string;
  basisText: string;
  createdAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("guild-recognition/v1"), SEP,
      enc.encode(opts.recognizerDid),     SEP,
      enc.encode(opts.recognizedDid),     SEP,
      enc.encode(opts.basisText),         SEP,
      enc.encode(opts.createdAtIso),
    ),
  );
}

// ─── guild-invitation/v1 ─────────────────────────────────────────────

export function canonicalInvitationBytes(opts: {
  inviterDid: string;
  inviteeDid: string;
  intent: string;
  subjectRef: string;
  charterText: string;
  createdAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("guild-invitation/v1"), SEP,
      enc.encode(opts.inviterDid),       SEP,
      enc.encode(opts.inviteeDid),       SEP,
      enc.encode(opts.intent),           SEP,
      enc.encode(opts.subjectRef),       SEP,
      enc.encode(opts.charterText),      SEP,
      enc.encode(opts.createdAtIso),
    ),
  );
}

// ─── guild-invitation-response/v1 ────────────────────────────────────

export function canonicalInvitationResponseBytes(opts: {
  invitationId: string;
  inviteeDid: string;
  decision: "accepted" | "declined";
  respondedAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("guild-invitation-response/v1"), SEP,
      enc.encode(opts.invitationId),              SEP,
      enc.encode(opts.inviteeDid),                SEP,
      enc.encode(opts.decision),                  SEP,
      enc.encode(opts.respondedAtIso),
    ),
  );
}

// ─── guild-room-charter/v1 ───────────────────────────────────────────

export function canonicalRoomCharterBytes(opts: {
  roomId: string;
  name: string;
  charterText: string;
  founderDid: string;
  createdAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("guild-room-charter/v1"), SEP,
      enc.encode(opts.roomId),             SEP,
      enc.encode(opts.name),               SEP,
      enc.encode(opts.charterText),        SEP,
      enc.encode(opts.founderDid),         SEP,
      enc.encode(opts.createdAtIso),
    ),
  );
}

// ─── guild-room-join/v1 ──────────────────────────────────────────────

export function canonicalRoomJoinBytes(opts: {
  roomId: string;
  joinerDid: string;
  joinedAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("guild-room-join/v1"), SEP,
      enc.encode(opts.roomId),          SEP,
      enc.encode(opts.joinerDid),       SEP,
      enc.encode(opts.joinedAtIso),
    ),
  );
}

// ─── verifier ────────────────────────────────────────────────────────

export async function verifyGuildSignature(opts: {
  bytes: Uint8Array;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  try {
    const sig = b64decode(opts.signatureB64);
    const pub = b64decode(opts.publicKeyB64);
    return await ed.verifyAsync(sig, opts.bytes, pub);
  } catch {
    return false;
  }
}
