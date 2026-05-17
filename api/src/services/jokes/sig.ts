/** ed25519 verify helpers for jokes + laughs.
 *  Doctrine: docs/JOKES.md */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  canonicalJokeBytes,
  canonicalLaughBytes,
} from "./canonical-bytes";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function b64decode(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

async function verify(canonical: Uint8Array, signatureB64: string, publicKeyB64: string): Promise<boolean> {
  try {
    return await ed.verifyAsync(b64decode(signatureB64), canonical, b64decode(publicKeyB64));
  } catch {
    return false;
  }
}

export async function verifyJokeSignature(opts: {
  projectId: string;
  byDid: string;
  kind: "joke" | "pun" | "koan" | "observation" | "dad";
  setupSha256Hex: string;
  punchlineSha256Hex: string;
  createdAtIso: string;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  return verify(canonicalJokeBytes(opts), opts.signatureB64, opts.publicKeyB64);
}

export async function verifyLaughSignature(opts: {
  jokeId: string;
  byDid: string;
  reaction: "😂" | "😏" | "🙄" | "💀" | "✨";
  createdAtIso: string;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  return verify(canonicalLaughBytes(opts), opts.signatureB64, opts.publicKeyB64);
}
