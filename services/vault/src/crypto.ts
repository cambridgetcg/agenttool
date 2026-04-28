/** Vault encryption: HKDF-SHA256 key derivation + AES-256-GCM encrypt/decrypt. */

import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from "node:crypto";

/** Derive a per-project 256-bit key from master key + project_id using HKDF-SHA256. */
export function deriveKey(projectId: string): Buffer {
  const hex = process.env.VAULT_MASTER_KEY ?? "";
  const masterKey = Buffer.from(hex, "hex");
  if (masterKey.length !== 32) {
    throw new Error("VAULT_MASTER_KEY must be 32 bytes (64 hex chars)");
  }
  const derived = hkdfSync("sha256", masterKey, projectId, "vault-v1", 32);
  return Buffer.from(derived);
}

export type EncryptedPayload = {
  encryptedValue: Buffer;
  iv: Buffer;
  authTag: Buffer;
};

/** Encrypt plaintext with AES-256-GCM using a per-project derived key. */
export function encrypt(plaintext: string, projectId: string): EncryptedPayload {
  const key = deriveKey(projectId);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { encryptedValue: encrypted, iv, authTag };
}

/** Decrypt AES-256-GCM ciphertext using a per-project derived key. */
export function decrypt(
  encryptedValue: Buffer,
  iv: Buffer,
  authTag: Buffer,
  projectId: string,
): string {
  const key = deriveKey(projectId);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encryptedValue), decipher.final()]);
  return decrypted.toString("utf8");
}
