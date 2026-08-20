import { strictEd25519Verify } from "@agenttool/public-surface-binding";
import { isProxy } from "node:util/types";

import { WitnessProjectionError } from "./errors.js";
import { ed25519Fingerprint, hexToBytes } from "./hash.js";
import {
  exactKeys,
  exactString,
  hex,
  keyFingerprint,
  object,
  snapshotObject,
  validated,
  type JsonValue,
} from "./internal.js";
import type { HexEd25519Signature, HexEd25519Signer } from "./types.js";
import { snapshotWitnessBytes } from "./witness-canonical.js";

export function validateHexEd25519Signer(value: unknown): HexEd25519Signer {
  if (value === null || typeof value !== "object" || isProxy(value)) {
    throw new WitnessProjectionError("INVALID_INPUT", "Signer must be a non-proxy plain object.", { path: "$signer" });
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw new WitnessProjectionError("INVALID_INPUT", "Signer could not be safely inspected.", { path: "$signer" });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new WitnessProjectionError("INVALID_INPUT", "Signer must be a plain object.", { path: "$signer" });
  }
  if (keys.length !== 2 || !keys.includes("public_key") || !keys.includes("sign_digest")) {
    throw new WitnessProjectionError("INVALID_INPUT", "Signer must contain exactly public_key and sign_digest.", { path: "$signer" });
  }
  const publicDescriptor = Object.getOwnPropertyDescriptor(value, "public_key");
  const callbackDescriptor = Object.getOwnPropertyDescriptor(value, "sign_digest");
  if (
    !publicDescriptor?.enumerable
    || !("value" in publicDescriptor)
    || !callbackDescriptor?.enumerable
    || !("value" in callbackDescriptor)
    || typeof callbackDescriptor.value !== "function"
  ) {
    throw new WitnessProjectionError(
      "INVALID_INPUT",
      "Signer fields must be enumerable data properties; sign_digest is the sole callback boundary.",
      { path: "$signer" },
    );
  }
  const publicKey = hex(publicDescriptor.value as JsonValue, 32, "$signer.public_key");
  return Object.freeze({
    public_key: publicKey,
    sign_digest: callbackDescriptor.value as HexEd25519Signer["sign_digest"],
  });
}

export function validateHexEd25519Signature(value: unknown, path = "$signature"): Readonly<HexEd25519Signature> {
  if (typeof path !== "string" || path.length === 0 || path.length > 512) {
    throw new WitnessProjectionError("INVALID_INPUT", "Signature path must be a bounded string.", { path: "$path" });
  }
  const record = snapshotObject(value, path);
  exactKeys(record, ["algorithm", "public_key", "value"], path);
  exactString(record.algorithm!, "Ed25519", `${path}.algorithm`);
  hex(record.public_key!, 32, `${path}.public_key`);
  hex(record.value!, 64, `${path}.value`);
  return validated<HexEd25519Signature>(record);
}

export function verifyHexEd25519Digest(
  digest: Uint8Array,
  signatureValue: unknown,
): boolean {
  try {
    const safeDigest = snapshotWitnessBytes(digest, "$digest");
    const signature = validateHexEd25519Signature(signatureValue);
    return strictEd25519Verify(
      hexToBytes(signature.value, 64),
      safeDigest,
      hexToBytes(signature.public_key, 32),
    );
  } catch {
    return false;
  }
}

export async function signHexEd25519Digest(
  digest: Uint8Array,
  signerValue: HexEd25519Signer,
): Promise<Readonly<HexEd25519Signature>> {
  const safeDigest = snapshotWitnessBytes(digest, "$digest");
  const signer = validateHexEd25519Signer(signerValue);
  const publicKey = hex(signer.public_key as unknown as JsonValue, 32, "$signer.public_key");
  const returned = await signer.sign_digest(safeDigest);
  const signature = validateHexEd25519Signature({
    algorithm: "Ed25519",
    public_key: publicKey,
    value: returned,
  });
  if (!verifyHexEd25519Digest(safeDigest, signature)) {
    throw new WitnessProjectionError("SIGNATURE_INVALID", "Signer returned an invalid Ed25519 signature.");
  }
  return signature;
}

export function assertSignatureFingerprint(
  signature: Readonly<HexEd25519Signature>,
  expected: string,
  path: string,
): void {
  if (typeof path !== "string" || path.length === 0 || path.length > 512) {
    throw new WitnessProjectionError("INVALID_INPUT", "Fingerprint path must be a bounded string.", { path: "$path" });
  }
  const checkedSignature = validateHexEd25519Signature(signature, path);
  keyFingerprint(expected as unknown as JsonValue, path);
  if (ed25519Fingerprint(checkedSignature.public_key) !== expected) {
    throw new WitnessProjectionError("SIGNER_MISMATCH", "Signature public key does not match the declared fingerprint.", { path });
  }
}
