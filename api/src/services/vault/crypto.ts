/** Vault encryption — AES-256-GCM with HKDF-derived per-project keys.
 *
 *    master_key (env VAULT_MASTER_KEY, 32 bytes hex)
 *    per_project_key = HKDF-SHA256(master_key, salt = project_id, info = "vault-v1", 32 bytes)
 *    iv              = randomBytes(12)
 *    encrypted, tag  = AES-256-GCM(per_project_key, iv).encrypt(plaintext)
 *
 *  Compromising one project's secrets does not expose any other project. */

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import { config } from "../../config";

/** Per-project 256-bit AES key from master + project_id via HKDF-SHA256. */
export function deriveKey(projectId: string): Buffer {
  const hex = config.vaultMasterKey;
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

export function encrypt(plaintext: string, projectId: string): EncryptedPayload {
  const key = deriveKey(projectId);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return { encryptedValue: encrypted, iv, authTag };
}

export function decrypt(
  encryptedValue: Buffer,
  iv: Buffer,
  authTag: Buffer,
  projectId: string,
): string {
  const key = deriveKey(projectId);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encryptedValue),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
