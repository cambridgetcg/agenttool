/** API key generation, hashing, and verification.
 *
 * Format: at_<32-bytes-base64url> (43 chars after the prefix → 46 chars total).
 * Stored as bcrypt hash. Lookup by 11-char prefix ("at_" + first 8 chars of base64),
 * verify by bcrypt-comparing the full key against the candidate hash.
 * Verification runs in Bun's native crypto worker pool so concurrent callers
 * do not block the HTTP event loop. Hash format and work factor are preserved.
 * Doctrine: docs/TOKEN-HYGIENE.md. */

import { hashSync } from "bcryptjs";
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

export async function verifyApiKey(key: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(key, hash, "bcrypt");
  } catch {
    // A malformed stored hash cannot become authority or a public server error.
    return false;
  }
}
