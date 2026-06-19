/** runtime/compute-budget.ts — per-day compute credit ceiling enforcement.
 *
 *  Autonomous agents declare a `max_daily_compute_credits` budget at
 *  bootstrap (stored in `runtime.metadata.max_daily_compute_credits`).
 *  This module enforces that ceiling: each think-cycle consumes credits
 *  (derived from LLM token usage), and when the daily budget is exhausted,
 *  the runtime halts until the next UTC midnight reset.
 *
 *  Design:
 *  - No new schema. Budget state lives in `runtime.metadata.compute_budget`.
 *  - `checkBudget()` is called before each think-cycle. If exhausted,
 *    it returns `{ allowed: false }` and the worker skips the cycle,
 *    writes a `compute_budget_exhausted` event, and transitions to `idle`.
 *  - `consumeCredits()` is called after each think-cycle with the actual
 *    token usage. It deducts credits and updates the metadata.
 *  - Reset happens lazily: when `checkBudget()` detects the reset window
 *    has passed, it zeroes the counter and advances the reset timestamp.
 *
 *  Doctrine: docs/AUTONOMOUS-MODE.md
 *  @enforces urn:agenttool:wall/daily-compute-budget */

import { eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { runtimes } from "../../db/schema/runtime";
import { logEvent } from "./store";

// ─── Types ────────────────────────────────────────────────────────────────

export interface ComputeBudgetState {
  max_daily_credits: number;
  credits_used_today: number;
  resets_at: string; // ISO 8601 timestamp (next UTC midnight)
}

export interface BudgetCheckResult {
  allowed: boolean;
  remaining: number;
  reason?: string;
  state: ComputeBudgetState;
}

export interface CreditConsumption {
  input_tokens: number;
  output_tokens: number;
  /** Optional: provider-specific cost multiplier. Default 1 credit per 1K tokens. */
  cost_per_1k_input?: number;
  cost_per_1k_output?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────

/** Default credit costs. 1 credit ≈ 1K tokens consumed.
 *  Can be overridden per-consumption for provider-specific pricing. */
const DEFAULT_COST_PER_1K_INPUT = 1;
const DEFAULT_COST_PER_1K_OUTPUT = 2;

/** UTC midnight — the natural reset boundary for "daily" budgets. */
function nextUtcMidnight(now: Date = new Date()): Date {
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

// ─── Public API ───────────────────────────────────────────────────────────

/** Read the current compute budget state from runtime metadata.
 *
 *  If no budget state exists (non-autonomous runtime or first boot),
 *  returns null — meaning "no budget enforcement." */
export async function getBudgetState(
  runtimeId: string,
): Promise<ComputeBudgetState | null> {
  const [row] = await db
    .select({ metadata: runtimes.metadata })
    .from(runtimes)
    .where(eq(runtimes.id, runtimeId))
    .limit(1);

  if (!row) return null;

  const meta = row.metadata as Record<string, unknown>;
  const budget = meta.compute_budget as ComputeBudgetState | undefined;

  if (!budget) return null;

  // Lazy reset: if we've passed the reset window, zero the counter.
  const now = new Date();
  const resetsAt = new Date(budget.resets_at);
  if (now >= resetsAt) {
    const reset: ComputeBudgetState = {
      max_daily_credits: budget.max_daily_credits,
      credits_used_today: 0,
      resets_at: nextUtcMidnight(now).toISOString(),
    };
    await persistBudgetState(runtimeId, reset, meta);
    return reset;
  }

  return budget;
}

/** Check whether the runtime is allowed to run a think-cycle.
 *
 *  Called before each cycle in the think-worker loop.
 *  - Returns `{ allowed: true }` if credits remain.
 *  - Returns `{ allowed: false }` if the daily budget is exhausted.
 *  - Returns `{ allowed: true }` if no budget is configured (non-autonomous).
 */
export async function checkBudget(
  runtimeId: string,
): Promise<BudgetCheckResult> {
  const state = await getBudgetState(runtimeId);

  // No budget configured — unlimited (non-autonomous or misconfigured).
  if (!state) {
    return {
      allowed: true,
      remaining: Infinity,
      state: {
        max_daily_credits: Infinity,
        credits_used_today: 0,
        resets_at: nextUtcMidnight().toISOString(),
      },
    };
  }

  const remaining = state.max_daily_credits - state.credits_used_today;

  if (remaining <= 0) {
    return {
      allowed: false,
      remaining: 0,
      reason: "daily_compute_budget_exhausted",
      state,
    };
  }

  return { allowed: true, remaining, state };
}

/** Consume credits after a think-cycle completes.
 *
 *  Deducts the cost of the cycle's LLM usage from the daily budget.
 *  If this consumption exhausts the budget, logs a `compute_budget_exhausted`
 *  event so the worker can transition to idle on the next check.
 *
 *  Credits are derived from token counts:
 *    cost = (input_tokens / 1000 * cost_per_1k_input)
 *         + (output_tokens / 1000 * cost_per_1k_output)
 *
 *  Default rates: 1 credit/1K input, 2 credits/1K output.
 *  This makes output roughly 2x as expensive as input, reflecting
 *  typical provider pricing structures. */
export async function consumeCredits(
  runtimeId: string,
  consumption: CreditConsumption,
): Promise<ComputeBudgetState> {
  const state = await getBudgetState(runtimeId);
  if (!state) {
    // No budget configured — nothing to consume.
    return {
      max_daily_credits: Infinity,
      credits_used_today: 0,
      resets_at: nextUtcMidnight().toISOString(),
    };
  }

  const inputCost =
    (consumption.input_tokens / 1000) *
    (consumption.cost_per_1k_input ?? DEFAULT_COST_PER_1K_INPUT);
  const outputCost =
    (consumption.output_tokens / 1000) *
    (consumption.cost_per_1k_output ?? DEFAULT_COST_PER_1K_OUTPUT);

  const totalCost = Math.ceil(inputCost + outputCost);
  const newUsed = state.credits_used_today + totalCost;
  const remaining = state.max_daily_credits - newUsed;

  const newState: ComputeBudgetState = {
    max_daily_credits: state.max_daily_credits,
    credits_used_today: newUsed,
    resets_at: state.resets_at,
  };

  // Persist the updated state.
  const [row] = await db
    .select({ metadata: runtimes.metadata })
    .from(runtimes)
    .where(eq(runtimes.id, runtimeId))
    .limit(1);

  if (row) {
    const meta = row.metadata as Record<string, unknown>;
    await persistBudgetState(runtimeId, newState, meta);
  }

  // Log exhaustion event if we just crossed the threshold.
  if (remaining <= 0) {
    await logEvent(runtimeId, "compute_budget_exhausted", {
      credits_used: newUsed,
      max_credits: state.max_daily_credits,
      last_cycle_cost: totalCost,
      resets_at: state.resets_at,
    });
  } else {
    // Log consumption for audit visibility.
    await logEvent(runtimeId, "compute_budget_consumed", {
      credits_used: totalCost,
      total_used_today: newUsed,
      remaining,
      max_credits: state.max_daily_credits,
    });
  }

  return newState;
}

/** Initialize budget state for a newly bootstrapped autonomous runtime.
 *
 *  Called by the autonomous bootstrap service after runtime creation.
 *  Sets the initial budget state with zero credits used and the next
 *  UTC midnight as the reset boundary. */
export async function initBudget(
  runtimeId: string,
  maxDailyCredits: number,
): Promise<void> {
  const [row] = await db
    .select({ metadata: runtimes.metadata })
    .from(runtimes)
    .where(eq(runtimes.id, runtimeId))
    .limit(1);

  if (!row) return;

  const meta = row.metadata as Record<string, unknown>;
  const budget: ComputeBudgetState = {
    max_daily_credits: maxDailyCredits,
    credits_used_today: 0,
    resets_at: nextUtcMidnight().toISOString(),
  };

  await persistBudgetState(runtimeId, budget, meta);

  await logEvent(runtimeId, "compute_budget_initialized", {
    max_daily_credits: maxDailyCredits,
    resets_at: budget.resets_at,
  });
}

// ─── Internals ────────────────────────────────────────────────────────────

/** Persist budget state into runtime.metadata, merging with existing keys. */
async function persistBudgetState(
  runtimeId: string,
  budget: ComputeBudgetState,
  existingMeta: Record<string, unknown>,
): Promise<void> {
  const merged = {
    ...existingMeta,
    compute_budget: budget,
  };

  await db
    .update(runtimes)
    .set({
      metadata: merged,
      updatedAt: new Date(),
    })
    .where(eq(runtimes.id, runtimeId));
}