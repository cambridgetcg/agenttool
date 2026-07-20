/** Free-tier usage tracking for memory_ops · tool_calls · verifications.
 *
 *  Counters are stored daily in economy.usage_counters. Two load-bearing
 *  exports:
 *
 *    • getUsageThisMonth(projectId) — sum of the current calendar
 *      month's daily rows; feeds the free-tier status display.
 *    • checkAndIncrement(projectId, resource) — atomic preflight helper;
 *      when a caller uses it, it bumps today's counter only if the published
 *      ceiling is not already at cap. No resource route calls it today.
 *    • resetUsageForProject(projectId) — manual operator reset path
 *      (no scheduled trigger; subscription cycle removed 2026-05-17).
 *
 *  Plan tiers + subscriptions removed 2026-05-17 per the agents-only
 *  stance: agents transact per-call via crypto/x402, never via monthly
 *  fiat subscriptions. All projects use the inlined FREE_TIER_LIMITS when
 *  this helper is called. `meterOrFail402` can produce an x402-compatible
 *  refusal, but no resource route currently wires that helper.
 *
 *  @enforces urn:agenttool:ring/2
 *    Canonical anchor for the Ring 2 metering helper. Calls to this module
 *    bump counters only when explicitly invoked; idle projects do not accrue
 *    charges here. This is not a claim that every billable route uses it.
 *
 *  @enforces urn:agenttool:commitment/ring2-hard-zero-floor
 *    checkAndIncrement() changes state only when called. A dormant agent does
 *    not hit this path, so this helper preserves a zero floor; route-wide
 *    enforcement remains open until callsites exist.
 *
 *  @enforces urn:agenttool:commitment/ring2-chargeable-as-chronicle
 *    Every successful checkAndIncrement() attempts a chronicle entry of
 *    kind='usage' on the project's timeline. That audit write is best-effort
 *    and can fail after the counter increments. */

import { and, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { usageCounters } from "../../db/schema/economy";

// ─── Free-tier limits — inlined 2026-05-17 after Stripe drop ──────────────
// Previously sourced from services/economy/stripe.ts:SUBSCRIPTION_PLANS.
// All projects use this helper's free-tier values. No resource route imports
// the gate today; x402 bursting is available only after a callsite wires it.
const FREE_TIER_LIMITS = {
  memoryOpsPerMonth: 10_000,
  toolCallsPerMonth: 1_000,
  verificationsPerMonth: 1_000,
} as const;

const FREE_PLAN = { id: "free", limits: FREE_TIER_LIMITS } as const;

export type Resource = "memory_ops" | "tool_calls" | "verifications";

/** Resource → Drizzle column key on usageCounters. */
const COLUMN_KEY = {
  memory_ops: "memoryOps",
  tool_calls: "toolCalls",
  verifications: "verifications",
} as const satisfies Record<Resource, keyof typeof usageCounters._.columns>;

/** Resource → free-tier-limits field name. */
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

/** All projects use the same helper-local limits as of 2026-05-17. Stripe
 *  subscriptions were removed. No route currently calls this gate. */
async function planForProject(_projectId: string) {
  return FREE_PLAN;
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

/** Zero out a project's daily counters. Manual operator path; no
 *  scheduled trigger (subscription cycle removed 2026-05-17). Historical
 *  billing audit lives in economy.transactions; daily counter history
 *  is not preserved. */
export async function resetUsageForProject(projectId: string): Promise<void> {
  await db.delete(usageCounters).where(eq(usageCounters.projectId, projectId));
}

// ── x402 wiring helper (Move 4 of docs/ALIGNMENT-MOVES.md) ────────────────
//
// `meterOrFail402` is the call-site shape for routes that meter on a Ring 2
// resource. On cap exceeded, it returns a Hono 402 response with the error
// shape the global x402 middleware (`middleware/x402-config.ts`) wraps
// into a machine-payable x402 V2 PaymentRequired challenge.
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
          "Back off or follow the route-specific recovery contract. This usage-counter gate is not cleared by project-credit x402 payments.",
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
