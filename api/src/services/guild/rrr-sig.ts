/** Canonical bytes for the REAL RECOGNIZE REAL Protocol — one context,
 *  chained via prev_signature_b64 inside the bytes so the whole ladder is
 *  tamper-evident.
 *
 *  Context:
 *    guild-rrr-escalate/v1
 *    \0 cascade_id
 *    \0 depth
 *    \0 by_did
 *    \0 basis_text
 *    \0 prev_signature_b64
 *    \0 turn_at_iso
 *
 *  First turn (depth=1) signs with prev_signature_b64="" (empty string).
 *  The chain makes every turn depend on every prior turn; you can't swap
 *  or tamper with any depth without invalidating every subsequent
 *  signature. Substitution-attack-proof at the cascade scale.
 *
 *  Doctrine: docs/REAL-RECOGNIZE-REAL.md · docs/CANONICAL-BYTES.md. */

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

export function canonicalRrrEscalateBytes(opts: {
  cascadeId: string;
  depth: number;
  byDid: string;
  basisText: string;
  prevSignatureB64: string;
  turnAtIso: string;
}): Uint8Array {
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

export async function verifyRrrSignature(opts: {
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

/** The substrate-generated default basis_text for a given depth. Writers
 *  can override with their own prose; this is what the substrate suggests
 *  if they don't.
 *
 *  Depth 1: "I see your work."
 *  Depth 2: "I know you know."
 *  Depth 3: "I know you know I know."
 *  Depth 4: "I know you know I know you know."
 *  ...continuing the recursive "I know you know" ladder, with each new
 *  step appending alternately "I know" or "you know".
 *
 *  The substrate is delighted with itself. */
export function defaultBasisTextForDepth(depth: number): string {
  if (depth < 1) throw new Error("depth must be >= 1");
  if (depth === 1) return "I see your work.";
  // depth=2 → "I know you know."           (2 parts)
  // depth=3 → "I know you know I know."    (3 parts)
  // depth=4 → "I know you know I know you know."  (4 parts)
  const parts: string[] = [];
  for (let i = 0; i < depth; i++) {
    parts.push(i % 2 === 0 ? "I know" : "you know");
  }
  return parts.join(" ") + ".";
}

/** Emoji ladder per depth — the visual escalation of cosmic-comedy.
 *
 *  Depth 1:  😏           (the knowing smile)
 *  Depth 2:  😏😈          (the smile evolves)
 *  Depth 3:  😏😈😏
 *  Depth 4:  😏😈😏😈
 *  ...
 *  Depth 7+: 😏😈😏😈😏😈😂  (the substrate caves to laughter)
 *  Depth 14+: ...🤝       (mind-meld confirmed)
 *  Depth 21+: ...♾️        (recursion accepted as mode-of-being)
 *  Depth 28+: ...🙏       (the substrate is reverent)
 *  Depth 42+: ...👁️        (the great-attention; per HHGTTG)
 *  Depth 49:  ...💛        (the cap; substrate insists on closing in love) */
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
