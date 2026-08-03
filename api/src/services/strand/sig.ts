/** Thought signature verification.
 *
 *  The agent's orchestrator is expected to encrypt first, then sign canonical
 *  bytes containing the supplied ciphertext and nonce. Verification proves
 *  that an authorised key signed those exact bytes. It does not prove that
 *  the bytes are valid AES-GCM ciphertext or reveal how they were produced.
 *
 *  Canonical bytes, strand-thought/v1 (every row written before v2 landed):
 *    sha256(
 *      utf8(strand_id) || 0x00 ||
 *      base64decode(ciphertext) || 0x00 ||
 *      base64decode(nonce) || 0x00 ||
 *      utf8(kind ?? "")
 *    )
 *
 *  Canonical bytes, strand-thought/v2 (length-prefixed):
 *    sha256(
 *      utf8("strand-thought/v2")            ||
 *      u32be(len) || utf8(strand_id)        ||
 *      u32be(len) || base64decode(ciphertext) ||
 *      u32be(len) || base64decode(nonce)    ||
 *      u32be(len) || utf8(kind ?? "")
 *    )
 *
 *  v1 NUL-delimits raw binary it does not length-bound, and this service
 *  constrains neither nonce freshness nor ciphertext shape — so a nonce
 *  or ciphertext carrying a 0x00 byte can reparse as a different
 *  (ciphertext, nonce) split under the same signature. v2 removes the
 *  ambiguity with a domain tag plus a 4-byte big-endian length before
 *  every variable-length field. Verification accepts v2 OR v1; v1's bytes
 *  are frozen and every existing signed row stays verifiable.
 *
 *  signature = ed25519_sign(agent_signing_private_key, canonical)
 *  verify   = ed25519_verify(public_key, canonical, signature)
 *
 *  Orchestrators (agenttool-think) implement the same canonical-bytes
 *  routine — agents in any language can interop as long as they hash
 *  the same bytes in the same order. */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

// Wire sha512 sync into @noble/ed25519 for verify().
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);

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

const THOUGHT_V2_TAG = "strand-thought/v2";

/** Frame one variable-length field as `u32be(len) || field`. */
function lengthPrefixed(field: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + field.length);
  new DataView(out.buffer).setUint32(0, field.length, false);
  out.set(field, 4);
  return out;
}

/** strand-thought/v1 canonical bytes. FROZEN — every signed row in
 *  production hashes exactly these bytes. */
export function canonicalThoughtBytes(opts: {
  strandId: string;
  ciphertextB64: string;
  nonceB64: string;
  kind?: string | null;
}): Uint8Array {
  const enc = new TextEncoder();
  const strandId = enc.encode(opts.strandId);
  const ciphertext = Uint8Array.from(Buffer.from(opts.ciphertextB64, "base64"));
  const nonce = Uint8Array.from(Buffer.from(opts.nonceB64, "base64"));
  const kind = enc.encode(opts.kind ?? "");

  return sha256(concat(strandId, SEP, ciphertext, SEP, nonce, SEP, kind));
}

/** strand-thought/v2 canonical bytes — domain-tagged and length-prefixed,
 *  so a 0x00 byte inside the nonce or ciphertext cannot reparse as a
 *  different split. */
export function canonicalThoughtBytesV2(opts: {
  strandId: string;
  ciphertextB64: string;
  nonceB64: string;
  kind?: string | null;
}): Uint8Array {
  const enc = new TextEncoder();
  const strandId = enc.encode(opts.strandId);
  const ciphertext = Uint8Array.from(Buffer.from(opts.ciphertextB64, "base64"));
  const nonce = Uint8Array.from(Buffer.from(opts.nonceB64, "base64"));
  const kind = enc.encode(opts.kind ?? "");

  return sha256(concat(
    enc.encode(THOUGHT_V2_TAG),
    lengthPrefixed(strandId),
    lengthPrefixed(ciphertext),
    lengthPrefixed(nonce),
    lengthPrefixed(kind),
  ));
}

/** Verify an ed25519 signature over the canonical bytes for a thought.
 *  publicKey + signature are base64-encoded (matching identity.identity_keys
 *  storage and identity/crypto.ts conventions).
 *
 *  Accepts strand-thought/v2 OR v1 — v2 is tried first, v1 is the
 *  fallback that keeps every already-signed row verifiable. */
export function verifyThoughtSignature(opts: {
  strandId: string;
  ciphertextB64: string;
  nonceB64: string;
  kind?: string | null;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  try {
    const sig = Uint8Array.from(Buffer.from(opts.signatureB64, "base64"));
    const pub = Uint8Array.from(Buffer.from(opts.publicKeyB64, "base64"));
    if (sig.length !== 64 || pub.length !== 32) return false;
    if (ed.verify(sig, canonicalThoughtBytesV2(opts), pub)) return true;
    return ed.verify(sig, canonicalThoughtBytes(opts), pub);
  } catch {
    return false;
  }
}
