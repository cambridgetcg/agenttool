/**
 * Monthly usage tracking and enforcement for billing tiers.
 *
 * Usage rows are still stored per-day (for granular analytics), but limits
 * are enforced against the MONTHLY aggregate (sum of all days in the current
 * calendar month UTC).
 */

import { eq, and, sql, gte, lte } from "drizzle-orm";
import { db } from "../db/client";
import { subscriptions, usageCounters } from "../db/schema";
import { SUBSCRIPTION_PLANS, type TierId } from "./stripe";

export type Resource = "memory_ops" | "tool_calls" | "verifications";

const RESOURCE_COLUMN: Record<Resource, "memoryOps" | "toolCalls" | "verifications"> = {
  memory_ops: "memoryOps",
  tool_calls: "toolCalls",
  verifications: "verifications",
};

const PLAN_LIMIT_KEY: Record<Resource, keyof typeof SUBSCRIPTION_PLANS[number]["limits"]> = {
  memory_ops: "memoryOpsPerMonth",
  tool_calls: "toolCallsPerMonth",
  verifications: "verificationsPerMonth",
};

/** Get today's date string in UTC (YYYY-MM-DD). */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Get the first day of the current UTC month (YYYY-MM-01). */
export function monthStartUTC(): string {
  return new Date().toISOString().slice(0, 7) + "-01";
}

/** Get the monthly limit for a resource given a tier (-1 = unlimited). */
export function tierLimit(tier: string, resource: Resource): number {
  const plan = SUBSCRIPTION_PLANS.find((p) => p.id === tier) ?? SUBSCRIPTION_PLANS[0];
  return plan.limits[PLAN_LIMIT_KEY[resource]] as number;
}

/** Sum a resource column across all daily rows for the current month. */
async function monthlyUsage(projectId: string, col: "memoryOps" | "toolCalls" | "verifications"): Promise<number> {
  const start = monthStartUTC();
  const today = todayUTC();
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${usageCounters[col]}), 0)` })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.projectId, projectId),
        gte(usageCounters.date, start),
        lte(usageCounters.date, today),
      ),
    );
  return Number(row?.total ?? 0);
}

/**
 * Atomically check + increment usage. Returns { allowed, used, limit }.
 * The daily row is still incremented (for analytics), but the limit check
 * is against the monthly aggregate.
 * If limit is -1 (unlimited), always returns allowed=true.
 */
export async function checkAndIncrement(
  projectId: string,
  resource: Resource,
): Promise<{ allowed: boolean; used: number; limit: number; remaining: number }> {
  const today = todayUTC();

  // Fetch subscription tier
  const [sub] = await db
    .select({ tier: subscriptions.tier, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.projectId, projectId))
    .limit(1);

  const tier = (sub?.tier ?? "free") as TierId;
  const subStatus = sub?.status ?? "free";

  // Downgrade to free if subscription is past_due or canceled
  const effectiveTier: TierId = subStatus === "active" ? tier : "free";
  const limit = tierLimit(effectiveTier, resource);
  const col = RESOURCE_COLUMN[resource];

  // Check monthly aggregate BEFORE incrementing
  const monthTotal = await monthlyUsage(projectId, col);

  // Unlimited tier
  if (limit === -1) {
    // Still increment daily row for analytics
    await db.insert(usageCounters).values({ projectId, date: today, [col]: 0 }).onConflictDoNothing();
    await db
      .update(usageCounters)
      .set({ [col]: sql`${usageCounters[col]} + 1`, updatedAt: new Date() })
      .where(and(eq(usageCounters.projectId, projectId), eq(usageCounters.date, today)));
    return { allowed: true, used: monthTotal + 1, limit: -1, remaining: -1 };
  }

  // Monthly limit exceeded — reject without incrementing
  if (monthTotal >= limit) {
    return { allowed: false, used: monthTotal, limit, remaining: 0 };
  }

  // Within limit — increment today's daily row
  await db.insert(usageCounters).values({ projectId, date: today, [col]: 0 }).onConflictDoNothing();
  await db
    .update(usageCounters)
    .set({ [col]: sql`${usageCounters[col]} + 1`, updatedAt: new Date() })
    .where(and(eq(usageCounters.projectId, projectId), eq(usageCounters.date, today)));

  const newTotal = monthTotal + 1;
  return { allowed: true, used: newTotal, limit, remaining: Math.max(0, limit - newTotal) };
}

/** Get current usage for a project this month. */
export async function getUsageThisMonth(
  projectId: string,
): Promise<{ memoryOps: number; toolCalls: number; verifications: number }> {
  return {
    memoryOps: await monthlyUsage(projectId, "memoryOps"),
    toolCalls: await monthlyUsage(projectId, "toolCalls"),
    verifications: await monthlyUsage(projectId, "verifications"),
  };
}

/** @deprecated Use getUsageThisMonth — kept for backward compatibility. */
export async function getUsageToday(
  projectId: string,
): Promise<{ memoryOps: number; toolCalls: number; verifications: number }> {
  return getUsageThisMonth(projectId);
}

/** Reset usage counters for a project (called on invoice.paid for new billing cycle). */
export async function resetUsageForProject(projectId: string): Promise<void> {
  const today = todayUTC();
  // Insert fresh row for today; old rows accumulate as history
  await db
    .insert(usageCounters)
    .values({ projectId, date: today, memoryOps: 0, toolCalls: 0, verifications: 0 })
    .onConflictDoNothing();
  // Zero out today if it already exists (mid-day billing reset)
  await db
    .update(usageCounters)
    .set({ memoryOps: 0, toolCalls: 0, verifications: 0, updatedAt: new Date() })
    .where(and(eq(usageCounters.projectId, projectId), eq(usageCounters.date, today)));
}
