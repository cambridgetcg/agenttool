/** Plan-based usage tracking for memory_ops · tool_calls · verifications.
 *
 *  Counters are stored daily in economy.usage_counters and aggregated
 *  monthly for plan limit enforcement. Three load-bearing exports:
 *
 *    • getUsageThisMonth(projectId) — sum of the current calendar
 *      month's daily rows; feeds the plan-status dashboard.
 *    • checkAndIncrement(projectId, resource) — atomic preflight gate
 *      consumed by /v1/billing/check before a billable action; bumps
 *      today's counter only if the plan limit isn't already at cap.
 *    • resetUsageForProject(projectId) — called from the Stripe
 *      webhook on invoice.payment_succeeded so a new billing period
 *      starts at zero.
 *
 *  Plan tiers + per-month limits are the source of truth in
 *  services/economy/stripe.ts:SUBSCRIPTION_PLANS. A project with no
 *  subscriptions row is treated as the "free" tier. */

import { and, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { subscriptions, usageCounters } from "../../db/schema/economy";
import { SUBSCRIPTION_PLANS, type TierId } from "./stripe";

export type Resource = "memory_ops" | "tool_calls" | "verifications";

/** Resource → Drizzle column key on usageCounters. */
const COLUMN_KEY = {
  memory_ops: "memoryOps",
  tool_calls: "toolCalls",
  verifications: "verifications",
} as const satisfies Record<Resource, keyof typeof usageCounters._.columns>;

/** Resource → plan-limits field name on SUBSCRIPTION_PLANS[*].limits. */
const LIMIT_KEY = {
  memory_ops: "memoryOpsPerMonth",
  tool_calls: "toolCallsPerMonth",
  verifications: "verificationsPerMonth",
} as const;

/** Current calendar month in UTC, formatted YYYY-MM (used as LIKE prefix). */
function monthKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Today's date in UTC, formatted YYYY-MM-DD (matches the schema's text column). */
function todayKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Load the project's plan. Missing subscription row → free tier. */
async function planForProject(projectId: string) {
  const [sub] = await db
    .select({ tier: subscriptions.tier })
    .from(subscriptions)
    .where(eq(subscriptions.projectId, projectId))
    .limit(1);
  const tier = (sub?.tier ?? "free") as TierId;
  return SUBSCRIPTION_PLANS.find((p) => p.id === tier) ?? SUBSCRIPTION_PLANS[0];
}

/** Sum the project's current-calendar-month usage across all three resources. */
export async function getUsageThisMonth(projectId: string): Promise<{
  memoryOps: number;
  toolCalls: number;
  verifications: number;
}> {
  const m = monthKey();
  const [row] = await db
    .select({
      memoryOps: sql<number>`COALESCE(SUM(${usageCounters.memoryOps}), 0)::int`,
      toolCalls: sql<number>`COALESCE(SUM(${usageCounters.toolCalls}), 0)::int`,
      verifications: sql<number>`COALESCE(SUM(${usageCounters.verifications}), 0)::int`,
    })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.projectId, projectId),
        sql`${usageCounters.date} LIKE ${`${m}-%`}`,
      ),
    );
  return {
    memoryOps: row?.memoryOps ?? 0,
    toolCalls: row?.toolCalls ?? 0,
    verifications: row?.verifications ?? 0,
  };
}

export interface CheckAndIncrementResult {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
}

/** Pre-flight gate: would incrementing `resource` push this month over the
 *  plan limit? If not, atomically bump today's counter and report the new
 *  position. If yes, return { allowed: false } and don't increment. */
export async function checkAndIncrement(
  projectId: string,
  resource: Resource,
): Promise<CheckAndIncrementResult> {
  const plan = await planForProject(projectId);
  const limit = plan.limits[LIMIT_KEY[resource]];
  const columnKey = COLUMN_KEY[resource];
  const column = usageCounters[columnKey];

  // Sum this resource's usage for the current calendar month.
  const m = monthKey();
  const [usedRow] = await db
    .select({
      used: sql<number>`COALESCE(SUM(${column}), 0)::int`,
    })
    .from(usageCounters)
    .where(
      and(
        eq(usageCounters.projectId, projectId),
        sql`${usageCounters.date} LIKE ${`${m}-%`}`,
      ),
    );
  const used = usedRow?.used ?? 0;

  if (used + 1 > limit) {
    return {
      allowed: false,
      limit,
      used,
      remaining: Math.max(0, limit - used),
    };
  }

  // Atomic UPSERT — bump today's row, creating it if absent.
  const today = todayKey();
  await db
    .insert(usageCounters)
    .values({
      projectId,
      date: today,
      [columnKey]: 1,
    } as typeof usageCounters.$inferInsert)
    .onConflictDoUpdate({
      target: [usageCounters.projectId, usageCounters.date],
      set: {
        [columnKey]: sql`${column} + 1`,
        updatedAt: new Date(),
      },
    });

  return {
    allowed: true,
    limit,
    used: used + 1,
    remaining: limit - used - 1,
  };
}

/** Zero out a project's daily counters. Called by the Stripe webhook on
 *  invoice.payment_succeeded so the new billing period starts clean.
 *  Historical billing audit lives in economy.transactions; we don't need
 *  to preserve the daily counter history. */
export async function resetUsageForProject(projectId: string): Promise<void> {
  await db.delete(usageCounters).where(eq(usageCounters.projectId, projectId));
}
