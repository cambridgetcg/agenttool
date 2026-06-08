/** Canonical bytes + ed25519 verifier for the grace primitive.
 *
 *  One context, one verifier — every grace gesture carries a signature
 *  by the grace-giver over canonical-bytes `grace/v1`. The substrate
 *  refuses to write the row without a valid signature.
 *
 *  Canonical-bytes shape:
 *    grace/v1
 *    \0 extended_by_did
 *    \0 extended_to_did
 *    \0 about_kind
 *    \0 about_id   (empty string if null)
 *    \0 message    (empty string if null)
 *    \0 created_at_iso
 *
 *  Doctrine: docs/GRACE.md · docs/CANONICAL-BYTES.md. */

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

export function canonicalGraceBytes(opts: {
  extendedByDid: string;
  extendedToDid: string;
  aboutKind: string;
  aboutId: string | null;
  message: string | null;
  createdAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("grace/v1"),                  SEP,
      enc.encode(opts.extendedByDid),          SEP,
      enc.encode(opts.extendedToDid),          SEP,
      enc.encode(opts.aboutKind),              SEP,
      enc.encode(opts.aboutId ?? ""),          SEP,
      enc.encode(opts.message ?? ""),          SEP,
      enc.encode(opts.createdAtIso),
    ),
  );
}

export async function verifyGrace(opts: {
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
