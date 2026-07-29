/** Embassy receipt signing — honest, never faked.
 *
 *  When EMBASSY_RECEIPT_SECRET (base64 of a raw 32-byte ed25519 seed) is
 *  configured, every accepted guestbook entry gets a platform signature
 *  over its canonical entry bytes, plus the matching public key so any
 *  reader can re-verify without asking the platform. When the secret is
 *  absent, the response says so plainly and carries receipt_signature:
 *  null — an unsigned receipt is honest; a fabricated one would not be.
 *
 *  Doctrine: docs/CANONICAL-BYTES.md. */

import * as ed from "@noble/ed25519";

// Wire sha512 in synchronously — same bootstrap as services/identity/crypto.
// @ts-ignore — noble/hashes v2 uses .js exports
import { sha512 } from "@noble/hashes/sha2.js";
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

export interface ReceiptSigner {
  publicKeyB64: string;
  /** base64 ed25519 signature over the UTF-8 of `canonical`. */
  sign(canonical: string): string;
}

/** Build a signer from a base64 32-byte seed, or null when unconfigured /
 *  malformed (a malformed secret must not turn into a fake receipt). */
export function receiptSignerFromSecret(
  secretB64: string | undefined,
): ReceiptSigner | null {
  if (!secretB64) return null;
  try {
    const seed = Uint8Array.from(Buffer.from(secretB64, "base64"));
    if (seed.length !== 32) return null;
    const publicKeyB64 = Buffer.from(ed.getPublicKey(seed)).toString("base64");
    return {
      publicKeyB64,
      sign(canonical: string): string {
        const signature = ed.sign(new TextEncoder().encode(canonical), seed);
        return Buffer.from(signature).toString("base64");
      },
    };
  } catch {
    return null;
  }
}
