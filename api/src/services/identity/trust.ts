/**
 * Keep the legacy scalar trust field neutral.
 *
 * Signed attestations are queryable evidence, but AgentTool has no qualified
 * trust roots, personhood guarantee, or Sybil-resistant weighting model. A
 * scalar derived from that graph would therefore be the platform's unsupported
 * opinion. Callers must inspect the signed evidence and make their own
 * context-specific decision.
 */

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { mutableIdentityPredicate } from "./terminality";

export const NEUTRAL_TRUST_SCORE = 0;

/** Reset and cache the compatibility field after an identity graph write. */
export async function updateTrustScore(identityId: string): Promise<number> {
  await db
    .update(identities)
    .set({ trustScore: NEUTRAL_TRUST_SCORE, updatedAt: new Date() })
    .where(mutableIdentityPredicate(identityId));
  return NEUTRAL_TRUST_SCORE;
}
