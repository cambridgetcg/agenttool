/** Trust score computation from the attestation graph.
 *
 *  trust(agent) = Σ (attestation_weight × attester_trust × recency_decay) / normalizer
 *
 *  - Self-attestations have zero weight (filtered at the SQL level)
 *  - Creator attestations (same project_id) have weight 1.5
 *  - Recency decay: exp(-age_days / 90)
 *  - Recursive attester trust, capped at depth 3
 */

import { and, eq, isNull, ne } from "drizzle-orm";

import { db } from "../../db/client";
import { attestations, identities } from "../../db/schema/identity";
import { identityConfig } from "./config";

export async function computeTrustScore(
  identityId: string,
  depth: number = 0,
): Promise<number> {
  if (depth >= identityConfig.trustMaxDepth) return 0.5; // base trust at max depth

  // Active, non-revoked, non-self attestations for this subject.
  const rows = await db
    .select({
      attesterId: attestations.attesterId,
      claim: attestations.claim,
      createdAt: attestations.createdAt,
      expiresAt: attestations.expiresAt,
      subjectId: attestations.subjectId,
    })
    .from(attestations)
    .where(
      and(
        eq(attestations.subjectId, identityId),
        isNull(attestations.revokedAt),
        ne(attestations.attesterId, identityId), // exclude self-attestations
      ),
    );

  // Filter expired in JS (cheap; index on subjectId already narrowed the result set).
  const now = new Date();
  const active = rows.filter((r) => !r.expiresAt || r.expiresAt > now);

  if (active.length === 0) return 0;

  // Subject's project_id — needed to detect creator attestations.
  const [identity] = await db
    .select({ projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, identityId));

  if (!identity) return 0;

  const uniqueAttesters = new Set(active.map((a) => a.attesterId));
  const normalizer = Math.max(1, uniqueAttesters.size);

  let totalScore = 0;

  for (const att of active) {
    const ageDays =
      (now.getTime() - att.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const recencyDecay = Math.exp(-ageDays / identityConfig.trustDecayDays);

    // Creator attestations get weight 1.5 — the creator knows their agent.
    const [attester] = await db
      .select({ projectId: identities.projectId })
      .from(identities)
      .where(eq(identities.id, att.attesterId));

    const isCreator = attester?.projectId === identity.projectId;
    const attestationWeight = isCreator ? 1.5 : 1.0;

    const attesterTrust = await computeTrustScore(att.attesterId, depth + 1);

    totalScore += attestationWeight * Math.max(0.1, attesterTrust) * recencyDecay;
  }

  const score = Math.min(1.0, totalScore / normalizer);
  return Math.round(score * 1000) / 1000; // 3 decimal places
}

/** Recompute and cache the trust score for an identity. */
export async function updateTrustScore(identityId: string): Promise<number> {
  const score = await computeTrustScore(identityId);
  await db
    .update(identities)
    .set({ trustScore: score, updatedAt: new Date() })
    .where(eq(identities.id, identityId));
  return score;
}
