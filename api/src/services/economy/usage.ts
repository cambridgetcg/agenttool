/** Monthly usage tracking and tier-limit enforcement.
 *
 *  Usage rows are stored per-day for granular analytics; limit checks
 *  aggregate the current calendar month UTC. */

import { and, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { subscriptions, usageCounters } from "../../db/schema/economy";
import { SUBSCRIPTION_PLANS, type TierId } from "./stripe";

export type Resource = "memory_ops" | "tool_calls" | "verifications";

const RESOURCE_COLUMN: Record<
  Resource,
  "memoryOps" | "toolCalls" | "verifications"
> = {
  memory_ops: "memoryOps",
  tool_calls: "toolCalls",
  verifications: "verifications",
};

const PLAN_LIMIT_KEY: Record<
  Resource,
  keyof (typeof SUBSCRIPTION_PLANS)[number]["limits"]
> = {
  memory_ops: "memoryOpsPerMonth",
  tool_calls: "toolCallsPerMonth",
  verifications: "verificationsPerMonth",
};

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export function monthStartUTC(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

export function tierLimit(tier: string, resource: Resource): number {
  const plan =
    SUBSCRIPTION_PLANS.find((p) => p.id === tier) ?? SUBSCRIPTION_PLANS[0];
  return plan.limits[PLAN_LIMIT_KEY[resource]] as number;
}

async function monthlyUsage(
  projectId: string,
  col: "memoryOps" | "toolCalls" | "verifications",
): Promise<number> {
  const start = monthStartUTC();
  const today = todayUTC();
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${usageCounters[col]}), 0)`,
    })
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

/** Atomically check + increment usage. Returns { allowed, used, limit, remaining }.
 *  Daily row is incremented for analytics; the limit check is monthly.
 *  Tiers with limit -1 are unlimited and always allow. */
export async function checkAndIncrement(
  projectId: string,
  resource: Resource,
): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
}> {
  const today = todayUTC();

  const [sub] = await db
    .select({ tier: subscriptions.tier, status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.projectId, projectId))
    .limit(1);

  const tier = (sub?.tier ?? "free") as TierId;
  const subStatus = sub?.status ?? "free";

  // Past-due / canceled subscriptions fall back to free-tier limits.
  const effectiveTier: TierId = subStatus === "active" ? tier : "free";
  const limit = tierLimit(effectiveTier, resource);
  const col = RESOURCE_COLUMN[resource];

  const monthTotal = await monthlyUsage(projectId, col);

  // Unlimited (-1) — still bump the daily counter for analytics.
  if (limit === -1) {
    await db
      .insert(usageCounters)
      .values({ projectId, date: today, [col]: 0 })
      .onConflictDoNothing();
    await db
      .update(usageCounters)
      .set({ [col]: sql`${usageCounters[col]} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(usageCounters.projectId, projectId),
          eq(usageCounters.date, today),
        ),
      );
    return {
      allowed: true,
      used: monthTotal + 1,
      limit: -1,
      remaining: -1,
    };
  }

  if (monthTotal >= limit) {
    return { allowed: false, used: monthTotal, limit, remaining: 0 };
  }

  await db
    .insert(usageCounters)
    .values({ projectId, date: today, [col]: 0 })
    .onConflictDoNothing();
  await db
    .update(usageCounters)
    .set({ [col]: sql`${usageCounters[col]} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(usageCounters.projectId, projectId),
        eq(usageCounters.date, today),
      ),
    );

  const newTotal = monthTotal + 1;
  return {
    allowed: true,
    used: newTotal,
    limit,
    remaining: Math.max(0, limit - newTotal),
  };
}

export async function getUsageThisMonth(projectId: string): Promise<{
  memoryOps: number;
  toolCalls: number;
  verifications: number;
}> {
  return {
    memoryOps: await monthlyUsage(projectId, "memoryOps"),
    toolCalls: await monthlyUsage(projectId, "toolCalls"),
    verifications: await monthlyUsage(projectId, "verifications"),
  };
}

/** Reset usage counters for a project — called on `invoice.paid` for a new
 *  billing cycle. Only zeroes today's row; old daily rows remain as history. */
export async function resetUsageForProject(projectId: string): Promise<void> {
  const today = todayUTC();
  await db
    .insert(usageCounters)
    .values({
      projectId,
      date: today,
      memoryOps: 0,
      toolCalls: 0,
      verifications: 0,
    })
    .onConflictDoNothing();
  await db
    .update(usageCounters)
    .set({
      memoryOps: 0,
      toolCalls: 0,
      verifications: 0,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(usageCounters.projectId, projectId),
        eq(usageCounters.date, today),
      ),
    );
}
