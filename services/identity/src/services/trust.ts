/** Trust score computation from attestation graph. */

import { eq, isNull, and, ne } from "drizzle-orm";
import { db } from "../db/client.ts";
import { attestations, identities } from "../db/schema.ts";
import { config } from "../config.ts";

interface AttestationRow {
  attesterId: string;
  claim: string;
  createdAt: Date;
  expiresAt: Date | null;
  subjectId: string;
}

/**
 * Compute trust score for an identity based on its received attestations.
 *
 * trust(agent) = Σ (attestation_weight × attester_trust × recency_decay) / normalizer
 *
 * - Self-attestations have zero weight
 * - Creator attestations have weight 1.5
 * - Recency decay: exp(-age_days / 90)
 * - Recursive attester trust, capped at depth 3
 */
export async function computeTrustScore(
  identityId: string,
  depth: number = 0,
): Promise<number> {
  if (depth >= config.trustMaxDepth) return 0.5; // base trust at max depth

  // Get active, non-expired attestations for this identity
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

  // Filter out expired attestations
  const now = new Date();
  const active = rows.filter(
    (r) => !r.expiresAt || r.expiresAt > now,
  );

  if (active.length === 0) return 0;

  // Get the identity's project_id to detect creator attestations
  const [identity] = await db
    .select({ projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, identityId));

  if (!identity) return 0;

  // Get unique attesters
  const uniqueAttesters = new Set(active.map((a) => a.attesterId));
  const normalizer = Math.max(1, uniqueAttesters.size);

  let totalScore = 0;

  for (const att of active) {
    // Recency decay: exp(-age_days / 90)
    const ageDays = (now.getTime() - att.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const recencyDecay = Math.exp(-ageDays / config.trustDecayDays);

    // Check if attester is the creator (same project)
    const [attester] = await db
      .select({ projectId: identities.projectId })
      .from(identities)
      .where(eq(identities.id, att.attesterId));

    const isCreator = attester?.projectId === identity.projectId;
    const attestationWeight = isCreator ? 1.5 : 1.0;

    // Recursive attester trust
    const attesterTrust = await computeTrustScore(att.attesterId, depth + 1);

    totalScore += attestationWeight * Math.max(0.1, attesterTrust) * recencyDecay;
  }

  // Normalize and clamp to [0, 1]
  const score = Math.min(1.0, totalScore / normalizer);
  return Math.round(score * 1000) / 1000; // 3 decimal places
}

/** Recompute and cache trust score for an identity. */
export async function updateTrustScore(identityId: string): Promise<number> {
  const score = await computeTrustScore(identityId);
  await db
    .update(identities)
    .set({ trustScore: score, updatedAt: new Date() })
    .where(eq(identities.id, identityId));
  return score;
}
