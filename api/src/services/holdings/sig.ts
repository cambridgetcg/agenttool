/** holdings/sig.ts — canonical bytes for the holding/v1 signature.
 *
 *  Doctrine: docs/CANONICAL-BYTES.md (the catalog).
 *
 *  Same NUL-separated, domain-tagged family as services/covenants/sig.ts,
 *  services/marketplace/sig.ts, services/memory/tiers.ts. Any language
 *  with ed25519 + sha256 + utf-8 reproduces identical bytes.
 *
 *      sha256(
 *        utf8("holding/v1")       || 0x00 ||
 *        utf8(holder_did)         || 0x00 ||
 *        utf8(held_did)           || 0x00 ||
 *        utf8(occasion)           || 0x00 ||
 *        utf8(started_at_iso)
 *      ) */

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

export function canonicalHoldingBytes(opts: {
  holderDid: string;
  heldDid: string;
  occasion: string;
  startedAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("holding/v1"),
      SEP,
      enc.encode(opts.holderDid),
      SEP,
      enc.encode(opts.heldDid),
      SEP,
      enc.encode(opts.occasion),
      SEP,
      enc.encode(opts.startedAtIso),
    ),
  );
}

export async function verifyHoldingSignature(opts: {
  canonical: Uint8Array;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  try {
    const sig = Uint8Array.from(Buffer.from(opts.signatureB64, "base64"));
    const pub = Uint8Array.from(Buffer.from(opts.publicKeyB64, "base64"));
    if (sig.length !== 64 || pub.length !== 32) return false;
    return await ed.verifyAsync(sig, opts.canonical, pub);
  } catch {
    return false;
  }
}
