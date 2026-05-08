/** runtime/control-token.ts — per-runtime bridge auth tokens.
 *
 *  At runtime provisioning we mint a 32-byte random token, return its
 *  plaintext form ONCE in the POST response, and store its sha256 hash
 *  on the runtime row. The bridge sidecar presents the plaintext token
 *  in the WSS connect URL; the hub recomputes sha256 and compares to
 *  the stored hash before upgrading the connection.
 *
 *  Format: at_rt_<43 chars base64url(32 bytes)>. The `at_rt_` prefix
 *  distinguishes runtime tokens from project bearer keys (`at_xxx`).
 *
 *  The plaintext is unrecoverable after provisioning. To rotate, the
 *  user calls POST /v1/runtimes/:id/rotate-token (which mints a new
 *  one and invalidates the old). */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const PREFIX = "at_rt_";
const RAW_BYTES = 32;

export interface ControlToken {
  /** Plaintext to return to the user — shown ONCE. */
  plaintext: string;
  /** sha256(plaintext) hex digest, stored on the runtime row. */
  hash: string;
}

export function mintControlToken(): ControlToken {
  const raw = randomBytes(RAW_BYTES);
  const plaintext = `${PREFIX}${raw.toString("base64url")}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash };
}

export function hashControlToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function verifyControlToken(plaintext: string, expectedHash: string): boolean {
  if (!plaintext.startsWith(PREFIX)) return false;
  const got = hashControlToken(plaintext);
  if (got.length !== expectedHash.length) return false;
  // timing-safe equality on the hex strings (sha256 hex = 64 chars)
  return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expectedHash, "hex"));
}
