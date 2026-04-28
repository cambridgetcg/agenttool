/** API key verification (shared pattern with other services). */

import { compareSync } from "bcryptjs";

/** Verify a plaintext key against its bcrypt hash. */
export function verifyApiKey(key: string, hash: string): boolean {
  return compareSync(key, hash);
}
