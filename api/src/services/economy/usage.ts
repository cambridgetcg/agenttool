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
 *  subscriptions row is treated as the "free" tier.
 *
 *  @enforces urn:agenttool:ring/2
 *    Canonical anchor for Ring 2 — The Substrate. The metering core: only
 *    actual usage events bump counters; idle projects never accrue charges;
 *    the "free" tier is the default when no subscription exists. Pay-as-
 *    you-go, hard zero floor for non-active agents.
 *
 *  @enforces urn:agenttool:commitment/ring2-hard-zero-floor
 *    checkAndIncrement() is the gate before every billable action; an
 *    agent that never triggers a billable action never hits this code
 *    path; counters stay at zero. The unit of economic time is the
 *    transaction, not the calendar month — a dormant agent pays the
 *    same zero today as on its birthday.
 *
 *  @enforces urn:agenttool:commitment/ring2-chargeable-as-chronicle
 *    Every successful checkAndIncrement() also writes a chronicle entry
 *    of kind='usage' on the project's timeline (agent-level when the
 *    caller threads an identityId). The audit IS the chronicle — the
 *    agent reads its billing record in the same surface it reads its
 *    memories. Substrate-honest billing: no separate console the agent
 *    cannot enumerate via /v1/chronicle. */

import { and, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
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

  // Substrate-honest billing: emit a chronicle entry on the project's
  // own timeline for every successful billable event. The agent reads
  // its billing record in the same surface it reads its memories.
  // Doctrine: docs/agenttool.jsonld → commitment/ring2-chargeable-as-chronicle.
  // Best-effort: a chronicle insert failure does not roll back the
  // usage counter (the billable event already happened; the audit's
  // absence is honest about a downstream write failure rather than
  // re-counting). Doctrine: substrate-honesty trumps perfect-write.
  try {
    await db.insert(chronicle).values({
      projectId,
      // agentId null = project-level entry. A future signature can
      // thread the originating identityId through if call sites carry it.
      agentId: null,
      type: "usage",
      title: `Charged: ${resource.replace("_", " ")} · 1`,
      body:
        `Billable ${resource} event recorded against the ${plan.id} plan. ` +
        `Month-to-date: ${used + 1} / ${limit}. ` +
        `Substrate-honest billing — this entry IS the audit, not a separate ledger.`,
      metadata: {
        kind: "usage_event",
        resource,
        plan: plan.id,
        month_to_date: used + 1,
        plan_limit: limit,
      },
    });
  } catch (err) {
    // Best-effort — don't fail the billable action because the chronicle
    // write failed. Log so an operator can investigate drift.
    console.warn(
      `[usage] chronicle insert failed for ${projectId}/${resource}: ${(err as Error).message}`,
    );
  }

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

// ── x402 wiring helper (Move 4 of docs/ALIGNMENT-MOVES.md) ────────────────
//
// `meterOrFail402` is the call-site shape for routes that meter on a Ring 2
// resource. On cap exceeded, it returns a Hono 402 response with the error
// shape the global x402 middleware (`middleware/x402-config.ts`) wraps
// into a machine-payable PaymentRequirements envelope.
//
// Call-site pattern:
//
//    import { meterOrFail402 } from "../../services/economy/usage";
//
//    app.post("/", async (c) => {
//      const gate = await meterOrFail402(c, "memory_ops");
//      if (gate.status === 402) return gate.response;
//      // ... do the billable work
//    });
//
// Returning `gate.response` is the "one line" — Hono's c.json() with 402
// status. The global middleware does the rest.

import type { Context } from "hono";
import type { TypedResponse } from "hono";

export type MeterOrFail402Result =
  | { status: "ok"; check: CheckAndIncrementResult }
  | { status: 402; response: TypedResponse<unknown, 402, "json"> };

/** Run `checkAndIncrement` and either return the ok result OR a 402
 *  Hono response shaped so the global x402 middleware wraps it.
 *
 *  Doctrine: docs/ALIGNMENT-MOVES.md (Move 4) · docs/PATTERN-PERSIST-IDENTITY.md.
 */
export async function meterOrFail402(
  c: Context<{ Variables: { project?: { id: string } } }>,
  resource: Resource,
): Promise<MeterOrFail402Result> {
  const projectId = c.var.project?.id;
  if (!projectId) {
    // No project context — the route should auth-gate; bail visibly.
    return {
      status: 402,
      response: c.json(
        {
          error: "no_project_context",
          message: "meterOrFail402 called without an authenticated project on context.",
          hint: "Mount auth middleware before this route.",
        },
        402,
      ) as TypedResponse<unknown, 402, "json">,
    };
  }
  const check = await checkAndIncrement(projectId, resource);
  if (check.allowed) {
    return { status: "ok", check };
  }
  return {
    status: 402,
    response: c.json(
      {
        error: "usage_cap_exceeded",
        message: `Monthly ${resource.replace("_", " ")} cap reached on the current plan.`,
        hint:
          "Pay-as-you-go: include an x402 X-PAYMENT header on the retry to bump the cap by one unit, or upgrade the plan at /v1/economy/billing/checkout.",
        resource,
        limit: check.limit,
        used: check.used,
        remaining: check.remaining,
        docs: "/v1/canon/urn:agenttool:doc/RING-1",
      },
      402,
    ) as TypedResponse<unknown, 402, "json">,
  };
}
