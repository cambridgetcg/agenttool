/** Thought signature verification.
 *
 *  The agent's orchestrator signs over canonical bytes BEFORE encrypting.
 *  We verify on write; this proves the thought came from the agent's
 *  authorised key, even though we cannot read the content.
 *
 *  Canonical bytes:
 *    sha256(
 *      utf8(strand_id) || 0x00 ||
 *      base64decode(ciphertext) || 0x00 ||
 *      base64decode(nonce) || 0x00 ||
 *      utf8(kind ?? "")
 *    )
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

/** Verify an ed25519 signature over the canonical bytes for a thought.
 *  publicKey + signature are base64-encoded (matching identity.identity_keys
 *  storage and identity/crypto.ts conventions). */
export function verifyThoughtSignature(opts: {
  strandId: string;
  ciphertextB64: string;
  nonceB64: string;
  kind?: string | null;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  try {
    const canonical = canonicalThoughtBytes(opts);
    const sig = Uint8Array.from(Buffer.from(opts.signatureB64, "base64"));
    const pub = Uint8Array.from(Buffer.from(opts.publicKeyB64, "base64"));
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed.verify(sig, canonical, pub);
  } catch {
    return false;
  }
}
