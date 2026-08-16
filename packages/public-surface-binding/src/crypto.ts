import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import { decodeFixedBase64, snapshotPlainBytes } from "./bytes.js";
import type { RecordSignature } from "./types.js";

function withLocalSha512<T>(operation: () => T): T {
  const previous = ed25519.etc.sha512Sync;
  ed25519.etc.sha512Sync = (...messages: Uint8Array[]) => {
    const hash = sha512.create();
    for (const message of messages) hash.update(message);
    return hash.digest();
  };
  try {
    return operation();
  } finally {
    ed25519.etc.sha512Sync = previous;
  }
}

/** Strict RFC 8032 verification with canonical, prime-subgroup A and R points. */
export function strictEd25519Verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  let checkedSignature: Uint8Array;
  let checkedMessage: Uint8Array;
  let checkedPublicKey: Uint8Array;
  try {
    checkedSignature = snapshotPlainBytes(signature, "Ed25519 signature", 64);
    checkedMessage = snapshotPlainBytes(message, "Ed25519 message", 128 * 1024);
    checkedPublicKey = snapshotPlainBytes(publicKey, "Ed25519 public key", 32);
    if (checkedSignature.byteLength !== 64 || checkedPublicKey.byteLength !== 32) return false;
  } catch {
    return false;
  }

  try {
    const publicPoint = ed25519.Point.fromHex(checkedPublicKey, false);
    const rPoint = ed25519.Point.fromHex(checkedSignature.subarray(0, 32), false);
    if (
      publicPoint.isSmallOrder()
      || !publicPoint.isTorsionFree()
      || rPoint.isSmallOrder()
      || !rPoint.isTorsionFree()
    ) return false;
    return withLocalSha512(() => ed25519.verify(
      checkedSignature,
      checkedMessage,
      checkedPublicKey,
      { zip215: false },
    ));
  } catch (cause) {
    if (cause instanceof TypeError || cause instanceof ReferenceError) throw cause;
    return false;
  }
}

export function verifyEd25519Digest(
  digest: Uint8Array,
  publicKeyBase64: string,
  signature: RecordSignature,
): boolean {
  let signatureBytes: Uint8Array;
  let publicKeyBytes: Uint8Array;
  try {
    if (signature.algorithm !== "Ed25519") return false;
    signatureBytes = decodeFixedBase64(signature.value, 64, "signature.value");
    publicKeyBytes = decodeFixedBase64(publicKeyBase64, 32, "public_key");
  } catch {
    return false;
  }
  return strictEd25519Verify(signatureBytes, digest, publicKeyBytes);
}
