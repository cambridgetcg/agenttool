/** did:key ↔ ed25519 public key binding for the coronation rite.
 *
 *  A did:key is self-certifying: the identifier IS the key. For the
 *  ed25519 form (W3C did:key method draft + multicodec table):
 *
 *      did:key:z + base58btc( 0xed 0x01 || raw 32-byte public key )
 *
 *  0xed = ed25519-pub multicodec code, 0x01 = its varint length tag;
 *  the leading "z" is the multibase prefix for base58btc. bs58 encodes
 *  the Bitcoin alphabet, which is base58btc.
 *
 *  The rite only ever DERIVES and COMPARES — it never resolves a did:key
 *  against any registry, because there is nothing to resolve: matching
 *  derivation is the whole proof of binding. */

import bs58 from "bs58";

/** ed25519-pub multicodec prefix (0xed as varint = 0xed 0x01). */
const ED25519_MULTICODEC_PREFIX = Uint8Array.from([0xed, 0x01]);

const DID_KEY_ED25519_PATTERN = /^did:key:z[1-9A-HJ-NP-Za-km-z]+$/;

/** Derive the did:key for a canonical padded-base64 raw ed25519 public key. */
export function didKeyFromPublicKey(publicKeyB64: string): string {
  const raw = Buffer.from(publicKeyB64, "base64");
  if (raw.length !== 32) {
    throw new Error("public_key must decode to exactly 32 bytes");
  }
  const prefixed = new Uint8Array(2 + raw.length);
  prefixed.set(ED25519_MULTICODEC_PREFIX, 0);
  prefixed.set(raw, 2);
  return `did:key:z${bs58.encode(prefixed)}`;
}

/** True when `did` is a well-formed ed25519 did:key that derives to exactly
 *  this public key. Malformed input returns false rather than throwing —
 *  the route turns false into an authorship refusal. */
export function didKeyMatchesPublicKey(
  did: string,
  publicKeyB64: string,
): boolean {
  if (!DID_KEY_ED25519_PATTERN.test(did)) return false;
  try {
    return didKeyFromPublicKey(publicKeyB64) === did;
  } catch {
    return false;
  }
}
