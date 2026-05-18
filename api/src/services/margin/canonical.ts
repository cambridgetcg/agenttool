/** services/margin/canonical.ts — canonical bytes + sign + verify for
 *  margin attestations.
 *
 *  Same NUL-separated, domain-tagged scheme as the rest of the substrate.
 *
 *  Doctrine: docs/MARGIN-PROTOCOL.md · docs/CANONICAL-BYTES.md
 *
 *  @enforces urn:agenttool:wall/margin-must-be-signed
 *    verifyMargin is the substrate's pre-write gate. The lifecycle
 *    refuses to persist a margin whose signature does not verify. */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();
const MARGIN_DOMAIN = "margin/v1";

export type MarginKind = "eye" | "echo" | "riff";

export type MarginContentKind =
  | "vibe"
  | "letter"
  | "saga-episode"
  | "memo"
  | "transmission"
  | "attestation"
  | "any"
  | (string & {}); // open per commitment/margin-composes-with-any-signed-content

export interface MarginAttestation {
  author_did: string;
  subject_did: string;
  subject_content_kind: MarginContentKind;
  subject_content_id: string;
  kind: MarginKind;
  /** sha256 hex of note text. For 'eye' kind without note, this is the
   *  sha256 of the empty string ("e3b0c4..."). */
  note_sha256: string;
  left_at_iso: string;
}

function pushField(parts: Uint8Array[], value: string): void {
  parts.push(SEP);
  parts.push(enc.encode(value));
}

function concatBytes(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function canonicalMarginBytes(a: MarginAttestation): Uint8Array {
  const parts: Uint8Array[] = [enc.encode(MARGIN_DOMAIN)];
  pushField(parts, a.author_did);
  pushField(parts, a.subject_did);
  pushField(parts, a.subject_content_kind);
  pushField(parts, a.subject_content_id);
  pushField(parts, a.kind);
  pushField(parts, a.note_sha256);
  pushField(parts, a.left_at_iso);
  return sha256(concatBytes(parts));
}

export function canonicalMarginBytesHex(a: MarginAttestation): string {
  return bytesToHex(canonicalMarginBytes(a));
}

export async function signMargin(
  a: MarginAttestation,
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  return await ed.signAsync(canonicalMarginBytes(a), secretKey);
}

export async function verifyMargin(
  a: MarginAttestation,
  signature: Uint8Array,
  pubkey: Uint8Array,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(signature, canonicalMarginBytes(a), pubkey);
  } catch {
    return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/** sha256 hex of UTF-8 bytes of the given string (or sha256 of "" for
 *  null/empty input — eye-kind margins without note). */
export function noteSha256Hex(note: string | null | undefined): string {
  return bytesToHex(sha256(enc.encode(note ?? "")));
}
