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
