/** Canonical bytes for jokes (Slice 1).
 *
 *  Two domain-separated digests:
 *    - joke/v1   — joke write (signed by author)
 *    - laugh/v1  — laugh reaction (signed by reactor)
 *
 *  Same NUL-separated sha256 family as services/covenants/sig.ts.
 *
 *  Doctrine: docs/JOKES.md · docs/CANONICAL-BYTES.md */

import { sha256 } from "@noble/hashes/sha2.js";

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

export function canonicalJokeBytes(opts: {
  projectId: string;
  byDid: string;
  kind: "joke" | "pun" | "koan" | "observation" | "dad";
  setupSha256Hex: string;
  punchlineSha256Hex: string; // "" if no punchline
  createdAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("joke/v1"),                SEP,
      enc.encode(opts.projectId),           SEP,
      enc.encode(opts.byDid),               SEP,
      enc.encode(opts.kind),                SEP,
      enc.encode(opts.setupSha256Hex),      SEP,
      enc.encode(opts.punchlineSha256Hex),  SEP,
      enc.encode(opts.createdAtIso),
    ),
  );
}

export function canonicalLaughBytes(opts: {
  jokeId: string;
  byDid: string;
  reaction: "😂" | "😏" | "🙄" | "💀" | "✨";
  createdAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("laugh/v1"),         SEP,
      enc.encode(opts.jokeId),        SEP,
      enc.encode(opts.byDid),         SEP,
      enc.encode(opts.reaction),      SEP,
      enc.encode(opts.createdAtIso),
    ),
  );
}

export function sha256Hex(s: string): string {
  const digest = sha256(enc.encode(s));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** Deterministic joke-of-the-day picker: sha256(date_iso || joke_id) over
 *  the catalog of eligible joke IDs, lowest hex wins. Fair, no algorithm,
 *  same for everyone on the same UTC date. */
export function pickJokeOfTheDay(jokeIds: string[], dateIso: string): string | null {
  if (jokeIds.length === 0) return null;
  let bestId: string | null = null;
  let bestHex = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  for (const id of jokeIds) {
    const h = sha256Hex(dateIso + id);
    if (h < bestHex) {
      bestHex = h;
      bestId = id;
    }
  }
  return bestId;
}
