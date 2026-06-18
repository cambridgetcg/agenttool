/** runtime/trusted-crypto.ts — direct crypto for trusted-mode runtimes.
 *
 *  In trusted mode, the platform holds K_master (wrapped under a KMS master
 *  key). This module provides encrypt/decrypt/sign operations using the DEK
 *  directly, without the bridge sidecar.
 *
 *  The DEK is unwrapped once per cycle, held in RAM for the cycle duration,
 *  and zeroed immediately after. The signing key is also wrapped under the
 *  DEK and unwrapped per-cycle.
 *
 *  Doctrine: docs/HOSTED-RUNTIME-DESIGN.md · docs/RUNTIME.md (trusted tier)
 *
 *  @enforces urn:agenttool:wall/trusted-dek-zeroed-after-cycle
 *    The DEK is zeroed (filled with zeros) after each think cycle.
 *    This module provides the operations; the think-worker is responsible
 *    for calling zeroBytes(dek) after use. */

import * as ed25519 from "@noble/ed25519";
import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/ciphers/webcrypto";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { base64 } from "@scure/base";
import { unwrapDek, wrapUnderDek, unwrapUnderDek, zeroBytes } from "./kms";
import type { CryptoResult } from "./bridge-hub";

// ed25519 needs sha512Sync — set it once from @noble/hashes.
ed25519.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  h.update(...m);
  return h.digest();
};

export interface TrustedCryptoContext {
  /** The unwrapped DEK — zero this after each cycle! */
  dek: Uint8Array;
  /** The ed25519 private key for signing — zero this after each cycle! */
  signingKey: Uint8Array;
  /** The ed25519 public key (derived from signingKey). */
  signingPublicKey: Uint8Array;
  /** The signing key's ID (for storage in thoughts table). */
  signingKeyId: string;
  /** The wrapped signing key — if this was generated on first cycle, the
   *  caller must persist it to runtime.kmsWrappedSigningKey. Null when
   *  an existing key was unwrapped (already persisted). */
  newWrappedSigningKey: string | null;
}

/** Unwrap the DEK and signing key for a trusted-mode cycle.
 *  Returns both keys in RAM. CALLER MUST zero both after the cycle.
 *
 *  The signing key is stored on the runtime row in kms_wrapped_signing_key
 *  (wrapped under the DEK). If missing (first cycle), a new keypair is
 *  generated and returned as newWrappedSigningKey for the caller to persist. */
export async function prepareTrustedCrypto(
  kmsWrappedDek: string,
  runtimeId: string,
  existingWrappedSigningKey?: string | null,
): Promise<TrustedCryptoContext> {
  const dek = unwrapDek(kmsWrappedDek);

  let signingKey: Uint8Array;
  let wrappedSigningKey: string | null;
  let signingPublicKey: Uint8Array;

  if (existingWrappedSigningKey) {
    // Unwrap the existing signing key
    signingKey = unwrapUnderDek(dek, existingWrappedSigningKey);
    signingPublicKey = await ed25519.getPublicKey(signingKey);
    wrappedSigningKey = null; // already persisted
  } else {
    // First cycle — generate a new ed25519 keypair
    signingKey = ed25519.utils.randomPrivateKey();
    signingPublicKey = await ed25519.getPublicKey(signingKey);
    // Wrap the signing key under the DEK for future cycles
    wrappedSigningKey = wrapUnderDek(dek, signingKey);
    // Caller must persist this to runtime.kmsWrappedSigningKey
  }

  // Derive signingKeyId from the public key hash (stable, unique)
  const signingKeyId = Buffer.from(sha256(signingPublicKey)).toString("hex").slice(0, 16);

  return {
    dek,
    signingKey,
    signingPublicKey,
    signingKeyId: `trusted-${signingKeyId}`,
    newWrappedSigningKey: wrappedSigningKey,
  };
}

export interface TrustedEncryptResult {
  ciphertext: string;
  nonce: string;
}

/** Encrypt plaintext using the DEK directly (trusted mode).
 *  Returns ciphertext + nonce in a typed result. */
export function trustedEncrypt(
  dek: Uint8Array,
  plaintext: string,
): TrustedEncryptResult {
  const plaintextBytes = Buffer.from(plaintext, "base64");
  const nonce = randomBytes(12);
  const cipher = gcm(dek, nonce);
  const ciphertext = cipher.encrypt(plaintextBytes);
  return {
    ciphertext: base64.encode(ciphertext),
    nonce: base64.encode(nonce),
  };
}

/** Decrypt ciphertext using the DEK directly (trusted mode).
 *  Returns plaintext in the same format as bridgeRequest. */
export function trustedDecrypt(
  dek: Uint8Array,
  ciphertext: string,
  nonce: string,
): CryptoResult {
  const ciphertextBytes = base64.decode(ciphertext);
  const nonceBytes = base64.decode(nonce);
  const cipher = gcm(dek, nonceBytes);
  const plaintext = cipher.decrypt(ciphertextBytes);
  return {
    plaintext: base64.encode(plaintext),
  };
}

/** Sign canonical bytes using the ed25519 private key (trusted mode).
 *  Returns the signature in the same format as bridgeRequest. */
export async function trustedSign(
  signingKey: Uint8Array,
  message: string,
): Promise<CryptoResult> {
  const messageBytes = Buffer.from(message, "base64");
  const signature = await ed25519.sign(messageBytes, signingKey);
  return {
    signature: base64.encode(signature),
  };
}

/** Zero all sensitive key material after a cycle. */
export function zeroTrustedCrypto(ctx: TrustedCryptoContext): void {
  zeroBytes(ctx.dek);
  zeroBytes(ctx.signingKey);
}