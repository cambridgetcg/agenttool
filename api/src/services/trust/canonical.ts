/** services/trust/canonical.ts — canonical bytes + sign + verify for
 *  trust attestations.
 *
 *  Doctrine: docs/TRUST-PROTOCOL.md · docs/CANONICAL-BYTES.md
 *
 *  @enforces urn:agenttool:wall/trust-must-be-signed
 *    verifyTrust is the substrate's pre-write gate. evidence_chronicle_ids
 *    are committed to in canonical bytes as sorted-CSV so the basis is
 *    auditable end-to-end. */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import type { TrustKind, TrustStrength } from "../../db/schema/trust";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();
const TRUST_DOMAIN = "trust/v1";

export interface TrustAttestation {
  truster_did: string;
  trusted_did: string;
  trust_kind: TrustKind;
  trust_strength: TrustStrength;
  /** sha256 hex of reasons text (sha256 of "" when reasons is null). */
  reasons_sha256: string;
  /** UUID list — sorted lexicographically before canonicalisation so
   *  callers cannot fudge the basis ordering. */
  evidence_chronicle_ids: ReadonlyArray<string>;
  extended_at_iso: string;
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

export function canonicalTrustBytes(a: TrustAttestation): Uint8Array {
  const parts: Uint8Array[] = [enc.encode(TRUST_DOMAIN)];
  pushField(parts, a.truster_did);
  pushField(parts, a.trusted_did);
  pushField(parts, a.trust_kind);
  pushField(parts, a.trust_strength);
  pushField(parts, a.reasons_sha256);
  pushField(parts, [...a.evidence_chronicle_ids].sort().join(","));
  pushField(parts, a.extended_at_iso);
  return sha256(concatBytes(parts));
}

export function canonicalTrustBytesHex(a: TrustAttestation): string {
  return bytesToHex(canonicalTrustBytes(a));
}

export async function signTrust(
  a: TrustAttestation,
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  return await ed.signAsync(canonicalTrustBytes(a), secretKey);
}

export async function verifyTrust(
  a: TrustAttestation,
  signature: Uint8Array,
  pubkey: Uint8Array,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(signature, canonicalTrustBytes(a), pubkey);
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

export function reasonsSha256Hex(reasons: string | null | undefined): string {
  return bytesToHex(sha256(enc.encode(reasons ?? "")));
}
