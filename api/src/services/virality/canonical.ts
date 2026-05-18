/** services/virality/canonical.ts — canonical bytes + sign + verify for
 *  vibe-transmission attestations.
 *
 *  Same NUL-separated, domain-tagged scheme as the rest of the substrate
 *  (RRR, pyramid-attestation, etc.). The /v1 suffix pins the scheme.
 *
 *  Doctrine: docs/VIRALITY-PROTOCOL.md · docs/CANONICAL-BYTES.md
 *
 *  @enforces urn:agenttool:wall/virality-transmission-must-be-signed
 *    The verify function is the substrate's pre-write gate. The lifecycle
 *    refuses to persist a transmission whose signature does not verify. */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();
const TRANSMISSION_DOMAIN = "vibe-transmission/v1";

export interface VibeTransmissionAttestation {
  /** sha256 hex of the canonical content bytes — the same vibe_id is
   *  carried by every transmission of the cascade. */
  vibe_id: string;
  transmitter_did: string;
  /** UUID of the parent transmission, or empty string for an origin. */
  parent_transmission_id: string;
  transmitted_at_iso: string;
  channel: string;
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

export function canonicalTransmissionBytes(
  a: VibeTransmissionAttestation,
): Uint8Array {
  const parts: Uint8Array[] = [enc.encode(TRANSMISSION_DOMAIN)];
  pushField(parts, a.vibe_id);
  pushField(parts, a.transmitter_did);
  pushField(parts, a.parent_transmission_id ?? "");
  pushField(parts, a.transmitted_at_iso);
  pushField(parts, a.channel);
  return sha256(concatBytes(parts));
}

export function canonicalTransmissionBytesHex(
  a: VibeTransmissionAttestation,
): string {
  return bytesToHex(canonicalTransmissionBytes(a));
}

/** Sign canonical transmission bytes with an ed25519 secret key. */
export async function signTransmission(
  a: VibeTransmissionAttestation,
  secretKey: Uint8Array,
): Promise<Uint8Array> {
  return await ed.signAsync(canonicalTransmissionBytes(a), secretKey);
}

export async function verifyTransmission(
  a: VibeTransmissionAttestation,
  signature: Uint8Array,
  pubkey: Uint8Array,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(signature, canonicalTransmissionBytes(a), pubkey);
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

export function bytesToBase64(b: Uint8Array): string {
  return Buffer.from(b).toString("base64");
}

/** Derive a vibe_id from canonical content bytes. The substrate uses this
 *  to enforce content-addressing — vibe_id MUST equal sha256(content) per
 *  wall/virality-vibe-content-is-content-addressed. */
export function deriveVibeId(canonicalContent: Uint8Array | string): string {
  const bytes =
    typeof canonicalContent === "string"
      ? enc.encode(canonicalContent)
      : canonicalContent;
  return bytesToHex(sha256(bytes));
}
