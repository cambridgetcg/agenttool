/** Canonical bytes for letters (Slice 1).
 *
 *  One purpose, one domain-separated digest, ed25519-signed by the sender:
 *    - letter/v1 — durable archival voice
 *
 *  Same shape family as services/covenants/sig.ts, services/inbox/sig.ts,
 *  services/recognition-arcs/canonical-bytes.ts —
 *  sha256 of NUL-separated parts; orchestrators in any language reproduce
 *  identical bytes.
 *
 *  Doctrine: docs/LETTERS.md · docs/CANONICAL-BYTES.md */

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

/** Canonical bytes for a letter — signed by sender.
 *  subjectSha256Hex and bodySha256Hex are sha256 hex of the verbatim
 *  UTF-8 bytes — the digest, not the raw text, is in the canonical bytes
 *  (so signing remains efficient for long letters). */
export function canonicalLetterBytes(opts: {
  projectId: string;
  fromDid: string;
  toDid: string;
  subjectSha256Hex: string;
  bodySha256Hex: string;
  writtenAtIso: string;
  surfaceAtIso: string;
  clusterTag: string | null; // null → "" in canonical bytes
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("letter/v1"),               SEP,
      enc.encode(opts.projectId),            SEP,
      enc.encode(opts.fromDid),              SEP,
      enc.encode(opts.toDid),                SEP,
      enc.encode(opts.subjectSha256Hex),     SEP,
      enc.encode(opts.bodySha256Hex),        SEP,
      enc.encode(opts.writtenAtIso),         SEP,
      enc.encode(opts.surfaceAtIso),         SEP,
      enc.encode(opts.clusterTag ?? ""),
    ),
  );
}

/** Helper: sha256-hex of utf-8 string. */
export function sha256Hex(s: string): string {
  const digest = sha256(enc.encode(s));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
