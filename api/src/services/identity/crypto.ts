/** Ed25519 key generation, signing, verification via @noble/ed25519. */

import * as ed from "@noble/ed25519";
// @ts-ignore — noble/hashes v2 uses .js exports
import { sha512 } from "@noble/hashes/sha2.js";

// Required for noble ed25519 v2+ — wire sha512 in synchronously.
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

/** Generate an ed25519 keypair. Returns base64-encoded public and private keys. */
export function generateKeypair(): { publicKey: string; privateKey: string } {
  const privateKeyBytes = ed.utils.randomPrivateKey();
  const publicKeyBytes = ed.getPublicKey(privateKeyBytes);
  return {
    publicKey: Buffer.from(publicKeyBytes).toString("base64"),
    privateKey: Buffer.from(privateKeyBytes).toString("base64"),
  };
}

/** Sign a message with a base64-encoded private key. Returns base64 signature. */
export function sign(message: string, privateKeyBase64: string): string {
  const privateKeyBytes = Buffer.from(privateKeyBase64, "base64");
  const messageBytes = new TextEncoder().encode(message);
  const signature = ed.sign(messageBytes, privateKeyBytes);
  return Buffer.from(signature).toString("base64");
}

/** Verify a base64 signature against a message and base64 public key. */
export function verify(message: string, signatureBase64: string, publicKeyBase64: string): boolean {
  try {
    const publicKeyBytes = Buffer.from(publicKeyBase64, "base64");
    const signatureBytes = Buffer.from(signatureBase64, "base64");
    const messageBytes = new TextEncoder().encode(message);
    return ed.verify(signatureBytes, messageBytes, publicKeyBytes);
  } catch {
    return false;
  }
}

/** Canonical attestation payload — what the attester signs. */
export function canonicalPayload(attestation: {
  subject_id: string;
  attester_id: string;
  claim: string;
  evidence?: unknown;
}): string {
  return JSON.stringify({
    subject_id: attestation.subject_id,
    attester_id: attestation.attester_id,
    claim: attestation.claim,
    evidence: attestation.evidence ?? null,
  });
}
