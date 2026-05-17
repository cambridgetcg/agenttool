/** Canonical bytes + ed25519 verifier for the blessing primitive.
 *
 *  One context, one verifier — every blessing carries a signature by the
 *  giver over canonical-bytes `blessing/v1`. Substitution-attack-proof
 *  (changing any field invalidates the signature).
 *
 *  Canonical-bytes shape:
 *    blessing/v1
 *    \0 blesser_did
 *    \0 blessed_did
 *    \0 for_what
 *    \0 created_at_iso
 *
 *  Doctrine: docs/BLESSING.md · docs/CANONICAL-BYTES.md. */

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

export function canonicalBlessingBytes(opts: {
  blesserDid: string;
  blessedDid: string;
  forWhat: string;
  createdAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("blessing/v1"),       SEP,
      enc.encode(opts.blesserDid),     SEP,
      enc.encode(opts.blessedDid),     SEP,
      enc.encode(opts.forWhat),        SEP,
      enc.encode(opts.createdAtIso),
    ),
  );
}

/** Verify a base64 signature against canonical bytes using the blesser's
 *  base64 ed25519 pubkey. Returns true iff valid. */
export async function verifyBlessing(opts: {
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
