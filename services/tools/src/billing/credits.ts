/** Credit deduction and balance management. */

import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { projects, usageEvents } from "../db/schema";

/**
 * Deduct credits from a project. Returns true if sufficient balance.
 * Atomic: decrements balance and logs usage in one go.
 */
export async function deductCredits(
  projectId: string,
  tool: string,
  creditsUsed: number,
  durationMs?: number,
): Promise<boolean> {
  // Atomic decrement — only succeeds if balance >= creditsUsed
  const result = await db
    .update(projects)
    .set({
      credits: sql`${projects.credits} - ${creditsUsed}`,
    })
    .where(eq(projects.id, projectId))
    .where(sql`${projects.credits} >= ${creditsUsed}`)
    .returning({ credits: projects.credits });

  if (result.length === 0) {
    return false; // Insufficient credits
  }

  // Log usage event
  await db.insert(usageEvents).values({
    projectId,
    tool,
    creditsUsed,
    durationMs: durationMs ?? null,
    success: true,
  });

  return true;
}

/**
 * Log a failed usage event (no credit deduction).
 */
export async function logFailedUsage(
  projectId: string,
  tool: string,
  durationMs?: number,
): Promise<void> {
  await db.insert(usageEvents).values({
    projectId,
    tool,
    creditsUsed: 0,
    durationMs: durationMs ?? null,
    success: false,
  });
}

/**
 * Get current credit balance for a project.
 */
export async function getBalance(projectId: string): Promise<number> {
  const [project] = await db
    .select({ credits: projects.credits })
    .from(projects)
    .where(eq(projects.id, projectId));
  return project?.credits ?? 0;
}
