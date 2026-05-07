/** Client-side thought encryption — AES-256-GCM under K_master.
 *
 *  Wire format mirrors `cli/think/src/crypto.ts` exactly:
 *
 *    nonce        12 bytes (AES-GCM standard)
 *    ciphertext   <plaintext-utf8> encrypted with K_master + nonce
 *    tag          16 bytes GCM auth tag, APPENDED to ciphertext
 *
 *  Wire layout (base64):
 *    ciphertext_b64  =  base64(ciphertext || tag)
 *    nonce_b64       =  base64(nonce)
 *
 *  Cross-path decryption is POSSIBLE — but only if the K_master VALUES
 *  match. cli/think stores keys at `~/.config/agenttool-think/keys/`;
 *  bridge stores in macOS keychain (`agenttool-sophia-k-master`). They
 *  are independent until explicitly synced via the sealed-envelope
 *  backup/restore path. Same wire format ≠ same key material.
 *
 *  K_master never leaves this machine. The agenttool server stores
 *  ciphertext + envelope signature only; it never decrypts.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { keychain } from "./_lib";

export interface EncryptedBlob {
  ciphertextB64: string; // base64(ciphertext || authTag)
  nonceB64: string;       // base64(12 bytes)
}

const K_MASTER_SERVICE = "agenttool-sophia-k-master";

/** Read K_master (32 bytes) from the macOS keychain. Throws with a
 *  pointer to the generator if absent or malformed. */
export function loadKMaster(): Uint8Array {
  let b64: string;
  try {
    b64 = keychain(K_MASTER_SERVICE);
  } catch {
    throw new Error(
      `K_master not found in keychain (service: "${K_MASTER_SERVICE}"). ` +
        `Run \`bun bin/gen-k-master.ts\` to generate one.`,
    );
  }
  const bytes = new Uint8Array(Buffer.from(b64, "base64"));
  if (bytes.length !== 32) {
    throw new Error(
      `K_master in keychain is ${bytes.length} bytes, expected 32. ` +
        `Run \`bun bin/gen-k-master.ts --force\` to regenerate.`,
    );
  }
  return bytes;
}

export function encryptThought(plaintext: string, kMaster: Uint8Array): EncryptedBlob {
  if (kMaster.length !== 32) {
    throw new Error(`K_master must be 32 bytes, got ${kMaster.length}`);
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", kMaster, nonce);
  const enc = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf-8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([enc, tag]);
  return {
    ciphertextB64: blob.toString("base64"),
    nonceB64: Buffer.from(nonce).toString("base64"),
  };
}

export function decryptThought(blob: EncryptedBlob, kMaster: Uint8Array): string {
  if (kMaster.length !== 32) {
    throw new Error(`K_master must be 32 bytes, got ${kMaster.length}`);
  }
  const nonce = Buffer.from(blob.nonceB64, "base64");
  const full = Buffer.from(blob.ciphertextB64, "base64");
  if (full.length < 16) throw new Error("ciphertext too short (no auth tag)");
  const ciphertext = full.subarray(0, full.length - 16);
  const tag = full.subarray(full.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", kMaster, nonce);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return dec.toString("utf-8");
}
