import { createHash } from "node:crypto";

const PROOF_KEY_DOMAIN = "identity-recover-proof/v1\0";

/** The exact end of the proof's acceptance window. A caller timestamp may be
 * ahead of server time by the allowed skew, so expiry is anchored to that
 * signed timestamp rather than to insertion time. */
export function recoveryProofExpiresAt(
  proofTimestampMs: number,
  windowMs: number,
): Date {
  return new Date(proofTimestampMs + windowMs);
}

/** Stable, secret-free digest for one verified recovery proof. */
export function recoveryProofDigest(
  canonical: Uint8Array,
): string {
  return createHash("sha256")
    .update(PROOF_KEY_DOMAIN, "utf8")
    .update(canonical)
    .digest("hex");
}
