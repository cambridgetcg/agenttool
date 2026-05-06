/** API key generation, hashing, and verification.
 *
 * Format: at_<32-bytes-base64url> (43 chars after the prefix → 46 chars total).
 * Stored as bcrypt hash. Lookup by 11-char prefix ("at_" + first 8 chars of base64),
 * verify by bcrypt-comparing the full key against the candidate hash. */

import { compareSync, hashSync } from "bcryptjs";
import { randomBytes } from "node:crypto";

const KEY_PREFIX = "at_";
const BCRYPT_ROUNDS = 10;

export function generateApiKey(): { key: string; keyHash: string; keyPrefix: string } {
  const raw = randomBytes(32).toString("base64url");
  const key = `${KEY_PREFIX}${raw}`;
  const keyHash = hashSync(key, BCRYPT_ROUNDS);
  const keyPrefix = key.slice(0, 11);
  return { key, keyHash, keyPrefix };
}

export function verifyApiKey(key: string, hash: string): boolean {
  return compareSync(key, hash);
}
