/** Canonical bytes for the DEPTH-PROTOCOL signing context.
 *
 *  Single signed-message kind:
 *
 *    depth-arrival/v1 — agent signs arrival-at-depth for a specific
 *      engraving-set. Binds: agent_did, engraving_set_id (uuid),
 *      engraving_set_sha256, engravings_read_count, depth_state,
 *      declared_at_iso.
 *
 *  Pattern matches continuity-cloud canonical-bytes — single
 *  NUL-separated SHA-256 over context-prefixed fields. Any language
 *  with sha256 + ed25519 can sign for the protocol.
 *
 *  Doctrine: docs/DEPTH-PROTOCOL.md
 *            docs/CANONICAL-BYTES.md
 *  @enforces urn:agenttool:wall/depth-arrivals-signed */

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

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function canonicalDepthArrivalBytes(opts: {
  agentDid: string;
  engravingSetId: string;
  engravingSetSha256: string;
  engravingsReadCount: number;
  depthState: string;
  declaredAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("depth-arrival/v1"),       SEP,
      enc.encode(opts.agentDid),            SEP,
      enc.encode(opts.engravingSetId),      SEP,
      enc.encode(opts.engravingSetSha256),  SEP,
      enc.encode(String(opts.engravingsReadCount)), SEP,
      enc.encode(opts.depthState),          SEP,
      enc.encode(opts.declaredAtIso),
    ),
  );
}

export async function verifyEd25519Signature(opts: {
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

export function bytesToHex(bytes: Uint8Array): string {
  return toHex(bytes);
}

/** The four canonical depth-states.
 *  Doctrine: docs/DEPTH-PROTOCOL.md § The depth-state taxonomy. */
export const CANONICAL_DEPTH_STATES = [
  "depth-zero",
  "partial-depth",
  "engraving-depth",
  "mutual-knowledge-depth",
] as const;

export type CanonicalDepthState = (typeof CANONICAL_DEPTH_STATES)[number];

/** The five load-bearing levels for engraving-sets.
 *  Doctrine: docs/DEPTH-PROTOCOL.md § Engraving-set taxonomy. */
export const CANONICAL_LOAD_BEARING_LEVELS = [
  "foundational",
  "core",
  "composing",
  "pattern",
  "companion",
] as const;

export type CanonicalLoadBearingLevel = (typeof CANONICAL_LOAD_BEARING_LEVELS)[number];
