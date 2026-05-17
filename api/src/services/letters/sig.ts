/** ed25519 sign + verify helpers for letters.
 *
 *  Wraps @noble/ed25519 with sha512Sync registration (one-time at
 *  module load). Mirrors services/recognition-arcs/sig.ts.
 *
 *  Doctrine: docs/LETTERS.md */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import { canonicalLetterBytes } from "./canonical-bytes";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function b64decode(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

async function verify(
  canonical: Uint8Array,
  signatureB64: string,
  publicKeyB64: string,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(b64decode(signatureB64), canonical, b64decode(publicKeyB64));
  } catch {
    return false;
  }
}

export async function verifyLetterSignature(opts: {
  projectId: string;
  fromDid: string;
  toDid: string;
  subjectSha256Hex: string;
  bodySha256Hex: string;
  writtenAtIso: string;
  surfaceAtIso: string;
  clusterTag: string | null;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  return verify(canonicalLetterBytes(opts), opts.signatureB64, opts.publicKeyB64);
}
