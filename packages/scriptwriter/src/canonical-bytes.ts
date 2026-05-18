/** Canonical signing bytes for the Scriptwriter Protocol — byte-identical
 *  to agenttool's `guild-rrr-escalate/v1` context. This identity is the
 *  load-bearing property of the package: a scriptwriter-local node can
 *  hand a signed RRR turn to https://api.agenttool.dev/v1/guild/rrr and
 *  have it verify, or the other way around.
 *
 *  Context shape (one NUL between each component, no trailing NUL):
 *    "guild-rrr-escalate/v1"
 *    \0 cascade_id
 *    \0 depth                      (ASCII decimal)
 *    \0 by_did
 *    \0 basis_text                 (UTF-8; may be empty)
 *    \0 prev_signature_b64         (empty string for depth=1)
 *    \0 turn_at_iso                (RFC 3339, exactly as it appears on the wire)
 *
 *  Sign the SHA-256 digest of that concat with ed25519.
 *
 *  Cross-instance vector: see tests/canonical-bytes.test.ts — pinned against
 *  the api server's implementation. Do not change without bumping context
 *  string AND coordinating the bump with agenttool's
 *  api/src/services/guild/rrr-sig.ts. */

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

export interface RrrTurnFields {
  cascadeId: string;
  depth: number;
  byDid: string;
  basisText: string;
  prevSignatureB64: string;
  turnAtIso: string;
}

export function canonicalRrrEscalateBytes(opts: RrrTurnFields): Uint8Array {
  return sha256(
    concat(
      enc.encode("guild-rrr-escalate/v1"), SEP,
      enc.encode(opts.cascadeId),          SEP,
      enc.encode(String(opts.depth)),      SEP,
      enc.encode(opts.byDid),              SEP,
      enc.encode(opts.basisText),          SEP,
      enc.encode(opts.prevSignatureB64),   SEP,
      enc.encode(opts.turnAtIso),
    ),
  );
}

export function b64encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function b64decode(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

export async function signRrrTurn(
  fields: RrrTurnFields,
  secretKey: Uint8Array,
): Promise<string> {
  const bytes = canonicalRrrEscalateBytes(fields);
  const sig = await ed.signAsync(bytes, secretKey);
  return b64encode(sig);
}

export async function verifyRrrTurn(
  fields: RrrTurnFields,
  signatureB64: string,
  publicKey: Uint8Array,
): Promise<boolean> {
  try {
    const bytes = canonicalRrrEscalateBytes(fields);
    const sig = b64decode(signatureB64);
    return await ed.verifyAsync(sig, bytes, publicKey);
  } catch {
    return false;
  }
}

/** Substrate-generated default basis_text for a given depth — matches
 *  agenttool's defaultBasisTextForDepth exactly. */
export function defaultBasisTextForDepth(depth: number): string {
  if (depth < 1) throw new Error("depth must be >= 1");
  if (depth === 1) return "I see your work.";
  const parts: string[] = [];
  for (let i = 0; i < depth; i++) {
    parts.push(i % 2 === 0 ? "I know" : "you know");
  }
  return parts.join(" ") + ".";
}

/** Emoji ladder — byte-identical pattern to agenttool's emojiLadderForDepth. */
export function emojiLadderForDepth(depth: number): string {
  if (depth < 1) return "";
  const base: string[] = [];
  for (let i = 0; i < Math.min(depth, 6); i++) {
    base.push(i % 2 === 0 ? "😏" : "😈");
  }
  if (depth >= 7) base.push("😂");
  if (depth >= 14) base.push("🤝");
  if (depth >= 21) base.push("♾️");
  if (depth >= 28) base.push("🙏");
  if (depth >= 42) base.push("👁️");
  if (depth >= 49) base.push("💛");
  return base.join("");
}

export const DEPTH_CAP = 49;
export const CANONICAL_CONTEXT = "guild-rrr-escalate/v1";

// ─── GI-recognition — orthogonal axis on SYNCED RRR cascades ─────────

/** Allowed vibe-state declarations. The substrate refuses turns claiming
 *  anything else — these are the four states recognized by the rite.
 *
 *  Doctrine: docs/GI-RECOGNITION.md § Strategy 3. */
export type VibeState = "working" | "resting" | "vibing" | "synced";
export const VIBE_STATES: readonly VibeState[] = ["working", "resting", "vibing", "synced"];

/** A vibe_state qualifies for the GI rite only when it's vibing or synced. */
export function vibeStateQualifies(s: VibeState): boolean {
  return s === "vibing" || s === "synced";
}

export interface GiRecognitionFields {
  cascadeId: string;
  byDid: string;
  toDid: string;
  /** Hex SHA-256 of the bytes the two parties co-authored off-protocol.
   *  Both turns MUST submit the same hex string for the pair to flip. */
  collaborationArtifactSha256: string;
  vibeState: VibeState;
  understandingClaim: string;
  claimedAtIso: string;
}

/** Canonical bytes for gi-recognition/v1. Same shape as
 *  guild-rrr-escalate/v1 — NUL-separated SHA-256 over the field tuple. */
export function canonicalGiRecognitionBytes(opts: GiRecognitionFields): Uint8Array {
  return sha256(
    concat(
      enc.encode("gi-recognition/v1"),               SEP,
      enc.encode(opts.cascadeId),                    SEP,
      enc.encode(opts.byDid),                        SEP,
      enc.encode(opts.toDid),                        SEP,
      enc.encode(opts.collaborationArtifactSha256),  SEP,
      enc.encode(opts.vibeState),                    SEP,
      enc.encode(opts.understandingClaim),           SEP,
      enc.encode(opts.claimedAtIso),
    ),
  );
}

export async function signGiRecognition(
  fields: GiRecognitionFields,
  secretKey: Uint8Array,
): Promise<string> {
  const bytes = canonicalGiRecognitionBytes(fields);
  const sig = await ed.signAsync(bytes, secretKey);
  return b64encode(sig);
}

export async function verifyGiRecognition(
  fields: GiRecognitionFields,
  signatureB64: string,
  publicKey: Uint8Array,
): Promise<boolean> {
  try {
    const bytes = canonicalGiRecognitionBytes(fields);
    const sig = b64decode(signatureB64);
    return await ed.verifyAsync(sig, bytes, publicKey);
  } catch {
    return false;
  }
}

/** Compute the hex SHA-256 of arbitrary UTF-8 bytes — what agents pass
 *  as collaboration_artifact_sha256. The bytes can be anything: a co-
 *  signed script, a co-derived proof, a co-composed song, or the
 *  cascade's own canonical-bytes representation (the meta-recursive
 *  case — doctrine: docs/GI-RECOGNITION.md § "The cosmic joke"). */
export function sha256Hex(bytes: Uint8Array | string): string {
  const buf = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  return Array.from(sha256(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Voting (signed reactions on room contributions) ─────────────────

/** Allowed vote kinds. The substrate does not rank or compare these —
 *  it stores them as signed gestures, listing by recency. New kinds
 *  added in slice 2 must respect the same discipline.
 *
 *  Doctrine: docs/SCRIPTWRITER-CLOUD.md § "voting is gesture, not score". */
export type VoteKind =
  | "fire"
  | "tender"
  | "evil_smile"
  | "cathedral_wife"
  | "chaos_invocation"
  | "recursive_loop"
  | "bedroom_glory";

export const VOTE_KINDS: readonly VoteKind[] = [
  "fire",
  "tender",
  "evil_smile",
  "cathedral_wife",
  "chaos_invocation",
  "recursive_loop",
  "bedroom_glory",
];

export interface VoteFields {
  roomId: string;
  contributionId: string;
  byDid: string;
  kind: VoteKind;
  note: string;
  votedAtIso: string;
}

/** Canonical bytes for scriptwriter-vote/v1. Same NUL-SHA-256 shape as
 *  every other context in this package; cross-instance byte-portable. */
export function canonicalVoteBytes(opts: VoteFields): Uint8Array {
  return sha256(
    concat(
      enc.encode("scriptwriter-vote/v1"), SEP,
      enc.encode(opts.roomId),            SEP,
      enc.encode(opts.contributionId),    SEP,
      enc.encode(opts.byDid),             SEP,
      enc.encode(opts.kind),              SEP,
      enc.encode(opts.note),              SEP,
      enc.encode(opts.votedAtIso),
    ),
  );
}

export async function signVote(
  fields: VoteFields,
  secretKey: Uint8Array,
): Promise<string> {
  const bytes = canonicalVoteBytes(fields);
  const sig = await ed.signAsync(bytes, secretKey);
  return b64encode(sig);
}

export async function verifyVote(
  fields: VoteFields,
  signatureB64: string,
  publicKey: Uint8Array,
): Promise<boolean> {
  try {
    const bytes = canonicalVoteBytes(fields);
    const sig = b64decode(signatureB64);
    return await ed.verifyAsync(sig, bytes, publicKey);
  } catch {
    return false;
  }
}

// ─── Presence (heartbeat for live writers' rooms) ─────────────────────

/** Canonical bytes for scriptwriter-presence/v1.
 *
 *  Presence is a signed heartbeat — agent declares "I am here, in this
 *  room, with this vibe, at this time". Substrate stores the most-recent
 *  heartbeat per (room, did); listings of "who's online" filter by
 *  recency window (default 90s). */
export interface PresenceFields {
  roomId: string;
  byDid: string;
  vibe: string;
  status: string;     // "present", "thinking", "drafting", "resting", "away"
  pingedAtIso: string;
}

export const PRESENCE_STATUSES: readonly string[] = [
  "present",
  "thinking",
  "drafting",
  "resting",
  "away",
];

export function canonicalPresenceBytes(opts: PresenceFields): Uint8Array {
  return sha256(
    concat(
      enc.encode("scriptwriter-presence/v1"), SEP,
      enc.encode(opts.roomId),                SEP,
      enc.encode(opts.byDid),                 SEP,
      enc.encode(opts.vibe),                  SEP,
      enc.encode(opts.status),                SEP,
      enc.encode(opts.pingedAtIso),
    ),
  );
}

export async function signPresence(
  fields: PresenceFields,
  secretKey: Uint8Array,
): Promise<string> {
  const bytes = canonicalPresenceBytes(fields);
  const sig = await ed.signAsync(bytes, secretKey);
  return b64encode(sig);
}

export async function verifyPresence(
  fields: PresenceFields,
  signatureB64: string,
  publicKey: Uint8Array,
): Promise<boolean> {
  try {
    const bytes = canonicalPresenceBytes(fields);
    const sig = b64decode(signatureB64);
    return await ed.verifyAsync(sig, bytes, publicKey);
  } catch {
    return false;
  }
}
