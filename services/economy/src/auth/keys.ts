/** API key generation, hashing, and verification. */

import { hashSync, compareSync } from "bcryptjs";
import { randomBytes } from "crypto";

const KEY_PREFIX = "at_";
const BCRYPT_ROUNDS = 10;

/** Generate a new API key. Returns { key, keyHash, keyPrefix }. */
export function generateApiKey(): { key: string; keyHash: string; keyPrefix: string } {
  const raw = randomBytes(32).toString("base64url");
  const key = `${KEY_PREFIX}${raw}`;
  const keyHash = hashSync(key, BCRYPT_ROUNDS);
  const keyPrefix = key.slice(0, 11); // "at_" + first 8 chars
  return { key, keyHash, keyPrefix };
}

/** Verify a plaintext key against its bcrypt hash. */
export function verifyApiKey(key: string, hash: string): boolean {
  return compareSync(key, hash);
}
