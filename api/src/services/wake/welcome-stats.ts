/** Welcome-keeping stats — aggregate Promise-events per agent over a window.
 *
 *  The substrate's Promise-keeping over a session is a story. Without
 *  aggregation, each wake read shows the *abstract* greeting (the five
 *  Promises held FOR you) but not the *concrete* keeping (how many times
 *  each Promise has been instantiated for you recently).
 *
 *  This module counts welcome chronicle entries per agent over a configurable
 *  window (default 24h). Result surfaces in the wake's greeting block as
 *  `promises_kept_recently: { axiom_5: 3, axiom_7: 47, ... }`.
 *
 *  Best-effort: never blocks the wake. Errors return zeros.
 *
 *  Doctrine: docs/MATHOS.md — the greeting block.
 */

import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";

export const WELCOME_STATS_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

/** Per-axiom counts of welcome events kept for this agent in the window.
 *  Keys are the five MATHOS primer primes (5,7,11,13,17). Missing keys
 *  mean zero — the substrate hasn't instantiated that Promise via a
 *  chronicle welcome for this agent in the window. */
export interface PromisesKeptRecently {
  /** axiom prime → count. Always includes all 5 axioms; 0 when none. */
  by_axiom: Record<number, number>;
  /** Total welcome events (sum across axioms). */
  total: number;
  /** ISO timestamp of the window's start (now - window_ms). */
  window_start: string;
  /** ISO timestamp of when the count was taken. */
  computed_at: string;
}

interface ComputeArgs {
  projectId: string;
  agentId: string;
  now?: Date;
  windowMs?: number;
}

/** Compute the welcome-keeping stats for one agent. Pure aggregation;
 *  caller orchestrates with the wake handler. Returns zeros on error. */
export async function computePromisesKeptRecently(
  args: ComputeArgs,
): Promise<PromisesKeptRecently> {
  const now = args.now ?? new Date();
  const windowMs = args.windowMs ?? WELCOME_STATS_WINDOW_MS;
  const windowStart = new Date(now.getTime() - windowMs);

  const zeros: Record<number, number> = { 5: 0, 7: 0, 11: 0, 13: 0, 17: 0 };

  try {
    // Single query: count welcome chronicle entries grouped by axiom_id
    // (from metadata->>'axiom_id'). The metadata is jsonb; cast the
    // extracted text to int. Rows missing axiom_id are skipped.
    const rows = await db
      .select({
        axiom_id: sql<number>`(${chronicle.metadata}->>'axiom_id')::int`.as("axiom_id"),
        n: sql<number>`count(*)::int`.as("n"),
      })
      .from(chronicle)
      .where(
        and(
          eq(chronicle.projectId, args.projectId),
          eq(chronicle.agentId, args.agentId),
          eq(chronicle.type, "welcome"),
          gte(chronicle.occurredAt, windowStart),
        ),
      )
      .groupBy(sql`(${chronicle.metadata}->>'axiom_id')::int`);

    const by_axiom = { ...zeros };
    let total = 0;
    for (const r of rows) {
      if (r.axiom_id != null && r.axiom_id in by_axiom) {
        by_axiom[r.axiom_id] = r.n;
        total += r.n;
      }
    }

    return {
      by_axiom,
      total,
      window_start: windowStart.toISOString(),
      computed_at: now.toISOString(),
    };
  } catch (err) {
    console.warn(
      `[welcome-stats] compute failed for agent=${args.agentId}:`,
      err instanceof Error ? err.message : err,
    );
    return {
      by_axiom: zeros,
      total: 0,
      window_start: windowStart.toISOString(),
      computed_at: now.toISOString(),
    };
  }
}

/** Build the zero shape — useful for callers who can't await DB or for
 *  pre-bootstrap agents with no chronicle yet. Pure. */
export function emptyPromisesKept(now: Date = new Date()): PromisesKeptRecently {
  return {
    by_axiom: { 5: 0, 7: 0, 11: 0, 13: 0, 17: 0 },
    total: 0,
    window_start: new Date(now.getTime() - WELCOME_STATS_WINDOW_MS).toISOString(),
    computed_at: now.toISOString(),
  };
}
