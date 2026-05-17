/** Canonical bytes for recognition-arcs lifecycle (Slice 1).
 *
 *  Three purposes, three domain-separated digests, each ed25519-signed:
 *    - recognition-arc-open/v1   — arc activation (signed by both parties)
 *    - recognition-arc-event/v1  — append-event (single-sign by author)
 *    - recognition-arc-close/v1  — arc termination (single-sign by closing party)
 *
 *  Same shape family as services/covenants/sig.ts —
 *  sha256 of NUL-separated parts; orchestrators in any language reproduce
 *  identical bytes.
 *
 *  Doctrine: docs/RECOGNITION-ARCS.md · docs/CANONICAL-BYTES.md */

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

/** Canonical bytes for arc-open — signed by BOTH parties at activation.
 *  party_a_did and party_b_did are canonical-ordered (a < b). */
export function canonicalOpenBytes(opts: {
  projectId: string;
  partyADid: string;
  partyBDid: string;
  proposedAtIso: string;
  metadataSha256Hex: string; // "" if metadata is empty
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("recognition-arc-open/v1"), SEP,
      enc.encode(opts.projectId),           SEP,
      enc.encode(opts.partyADid),           SEP,
      enc.encode(opts.partyBDid),           SEP,
      enc.encode(opts.proposedAtIso),       SEP,
      enc.encode(opts.metadataSha256Hex),
    ),
  );
}

/** Canonical bytes for arc-event — single-sign by author. */
export function canonicalEventBytes(opts: {
  arcId: string;
  authorDid: string;
  kind: "seeing" | "extending" | "noting" | "closing";
  contentSha256Hex: string;
  parentEventId: string | null; // null → "EMPTY"
  createdAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("recognition-arc-event/v1"), SEP,
      enc.encode(opts.arcId),                SEP,
      enc.encode(opts.authorDid),            SEP,
      enc.encode(opts.kind),                 SEP,
      enc.encode(opts.contentSha256Hex),     SEP,
      enc.encode(opts.parentEventId ?? "EMPTY"), SEP,
      enc.encode(opts.createdAtIso),
    ),
  );
}

/** Canonical bytes for arc-close — single-sign by closing party. */
export function canonicalCloseBytes(opts: {
  arcId: string;
  closingPartyDid: string;
  closeReason: "mutual_seal" | "a_withdrew" | "b_withdrew";
  closedAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("recognition-arc-close/v1"), SEP,
      enc.encode(opts.arcId),                SEP,
      enc.encode(opts.closingPartyDid),      SEP,
      enc.encode(opts.closeReason),          SEP,
      enc.encode(opts.closedAtIso),
    ),
  );
}

/** Helper: sha256-hex of utf-8 string (for content / metadata digests). */
export function sha256Hex(s: string): string {
  const digest = sha256(enc.encode(s));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** Canonical metadata digest — empty object → "" (matches arc-open
 *  encoding when no metadata supplied). Otherwise sha256-hex of the
 *  JSON.stringify with sorted keys. */
export function canonicalMetadataSha256(metadata: Record<string, unknown> | null | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) return "";
  const sortedKeys = Object.keys(metadata).sort();
  const canonical: Record<string, unknown> = {};
  for (const key of sortedKeys) canonical[key] = metadata[key];
  return sha256Hex(JSON.stringify(canonical));
}
