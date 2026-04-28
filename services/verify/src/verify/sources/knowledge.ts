/**
 * Internal knowledge source: queries the verified_facts table.
 * This is the compounding moat — every verified claim enriches future lookups.
 * As usage grows, more claims resolve instantly from cache at near-zero cost.
 */

import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { verifiedFacts } from "../../db/schema";
import type { SourceEvidence } from "../types";

const MIN_CONFIDENCE = 0.75; // Only use well-established facts
const MAX_AGE_DAYS = 30;     // Facts older than 30 days need re-verification

export async function queryKnowledgeBase(
  entities: string[],
  domain: string,
): Promise<SourceEvidence[]> {
  if (entities.length === 0) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_AGE_DAYS);

  const evidence: SourceEvidence[] = [];

  for (const entity of entities.slice(0, 5)) {
    // Fuzzy match against claim text using PostgreSQL similarity
    const rows = await db
      .select()
      .from(verifiedFacts)
      .where(
        and(
          gt(verifiedFacts.confidence, MIN_CONFIDENCE),
          gt(verifiedFacts.createdAt, cutoff),
          // Domain match (or general facts)
          sql`(${verifiedFacts.domain} = ${domain} OR ${verifiedFacts.domain} = 'general')`,
          // Simple entity mention check
          sql`${verifiedFacts.claim} ILIKE ${"%" + entity + "%"}`,
        ),
      )
      .limit(3);

    for (const row of rows) {
      evidence.push({
        source: "knowledge",
        url: `internal://facts/${row.id}`,
        title: `Verified fact (${row.domain})`,
        excerpt: row.claim,
        reliability: row.confidence, // Our own confidence score
        fetchedAt: row.createdAt.toISOString(),
        metadata: {
          verificationCount: row.verificationCount,
          lastVerified: row.lastVerified?.toISOString(),
        },
      });
    }
  }

  return evidence;
}

/** After a successful verification, persist to verified_facts for future lookups. */
export async function persistVerifiedFact(
  claim: string,
  domain: string,
  verdict: string,
  confidence: number,
  sources: string[],
): Promise<void> {
  if (confidence < MIN_CONFIDENCE) return; // Don't persist uncertain facts

  // Upsert: increment verification count if claim already exists
  await db
    .insert(verifiedFacts)
    .values({
      claim,
      domain,
      verdict,
      confidence,
      sources: JSON.stringify(sources),
      verificationCount: 1,
    })
    .onConflictDoUpdate({
      target: verifiedFacts.claim,
      set: {
        confidence: sql`(${verifiedFacts.confidence} + ${confidence}) / 2`, // rolling avg
        verificationCount: sql`${verifiedFacts.verificationCount} + 1`,
        lastVerified: new Date(),
      },
    });
}
