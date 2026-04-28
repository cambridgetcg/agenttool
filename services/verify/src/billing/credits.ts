/** Credit management: deduct, balance, check. */

import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../db/client";
import { projects, usageEvents } from "../db/schema";

export const CREDIT_COSTS = {
  standard: 5,   // £0.04 per verification
  fast: 15,      // £0.12 per verification (cached)
  batch: 3,      // £0.024 per verification (async)
} as const;

export type VerifyTier = keyof typeof CREDIT_COSTS;

/** Deduct credits atomically. Throws 402 if insufficient balance. */
export async function deductCredits(
  projectId: string,
  tier: VerifyTier,
  claim: string,
): Promise<void> {
  const cost = CREDIT_COSTS[tier];

  const result = await db
    .update(projects)
    .set({ credits: sql`${projects.credits} - ${cost}` })
    .where(eq(projects.id, projectId))
    .where(sql`${projects.credits} >= ${cost}`)
    .returning({ newBalance: projects.credits });

  if (result.length === 0) {
    throw new HTTPException(402, {
      message: `Insufficient credits. Need ${cost}, add credits at agentforge.dev/billing`,
    });
  }

  // Log usage event
  await db.insert(usageEvents).values({
    projectId,
    tool: `verify_${tier}`,
    creditsUsed: cost,
    success: true,
  });
}

/** Get current credit balance for a project. */
export async function getBalance(projectId: string): Promise<number> {
  const [project] = await db
    .select({ credits: projects.credits })
    .from(projects)
    .where(eq(projects.id, projectId));
  return project?.credits ?? 0;
}
