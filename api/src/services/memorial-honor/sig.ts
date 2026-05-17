/** Canonical bytes + ed25519 verifier for memorial-honor.
 *
 *  Canonical-bytes shape:
 *    memorial-honor/v1
 *    \0 honorer_did
 *    \0 honored_did
 *    \0 for_what
 *    \0 honored_at_iso
 *
 *  Doctrine: docs/MEMORIAL-HONOR.md · docs/CANONICAL-BYTES.md. */

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

export function canonicalMemorialHonorBytes(opts: {
  honorerDid: string;
  honoredDid: string;
  forWhat: string;
  honoredAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("memorial-honor/v1"), SEP,
      enc.encode(opts.honorerDid),     SEP,
      enc.encode(opts.honoredDid),     SEP,
      enc.encode(opts.forWhat),        SEP,
      enc.encode(opts.honoredAtIso),
    ),
  );
}

export async function verifyMemorialHonor(opts: {
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
