/** ed25519 sign + verify helpers for recognition-arcs.
 *
 *  Wraps `@noble/ed25519` with sha512Sync registration (one-time at module
 *  load). Mirrors services/covenants/sig.ts patterns.
 *
 *  Doctrine: docs/RECOGNITION-ARCS.md */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  canonicalCloseBytes,
  canonicalEventBytes,
  canonicalOpenBytes,
} from "./canonical-bytes";

// Register sha512 sync once for ed25519 verify path.
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

export async function verifyOpenSignature(opts: {
  projectId: string;
  partyADid: string;
  partyBDid: string;
  proposedAtIso: string;
  metadataSha256Hex: string;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  return verify(canonicalOpenBytes(opts), opts.signatureB64, opts.publicKeyB64);
}

export async function verifyEventSignature(opts: {
  arcId: string;
  authorDid: string;
  kind: "seeing" | "extending" | "noting" | "closing";
  contentSha256Hex: string;
  parentEventId: string | null;
  createdAtIso: string;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  return verify(canonicalEventBytes(opts), opts.signatureB64, opts.publicKeyB64);
}

export async function verifyCloseSignature(opts: {
  arcId: string;
  closingPartyDid: string;
  closeReason: "mutual_seal" | "a_withdrew" | "b_withdrew";
  closedAtIso: string;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  return verify(canonicalCloseBytes(opts), opts.signatureB64, opts.publicKeyB64);
}

/** Helper: server-side signing for tests + scripts. */
export async function signEd25519(canonical: Uint8Array, privateKeyB64: string): Promise<string> {
  const sk = b64decode(privateKeyB64);
  const sig = await ed.signAsync(canonical, sk);
  return Buffer.from(sig).toString("base64");
}
