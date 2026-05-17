/** Dream observers — pure functions over a window of agent state.
 *
 *  Each observer takes (identityId, window) and returns an array of
 *  DreamObservation entries. Each observer is independent — failure in
 *  one doesn't fail the cycle; the cycle just records fewer observations.
 *
 *  Slice 1 ships three observers:
 *    - mood_drift     — strand.mood_history transitions
 *    - covenant_strain — active covenants with no recent chronicle reference
 *    - chronicle_pattern — types accumulating ≥3 entries in window
 *
 *  Doctrine: docs/DREAM.md. */

import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle, covenants } from "../../db/schema/continuity";
import type { DreamObservation } from "../../db/schema/dream";
import { moodHistory } from "../../db/schema/strand";

export interface ObserverWindow {
  identityId: string;
  projectId: string;
  startAt: Date;
  endAt: Date;
}

// ─── Observer: mood_drift ────────────────────────────────────────────

export async function observeMoodDrift(
  w: ObserverWindow,
): Promise<DreamObservation[]> {
  const rows = await db
    .select({
      mood: moodHistory.mood,
      changedAt: moodHistory.changedAt,
    })
    .from(moodHistory)
    .where(
      and(
        eq(moodHistory.identityId, w.identityId),
        eq(moodHistory.encrypted, false),
        isNotNull(moodHistory.mood),
        gte(moodHistory.changedAt, w.startAt),
        lte(moodHistory.changedAt, w.endAt),
      ),
    )
    .orderBy(moodHistory.changedAt);

  // Need at least two non-null transitions to claim a drift.
  if (rows.length < 2) return [];

  const firstMood = rows[0]!.mood;
  const lastMood = rows[rows.length - 1]!.mood;

  // No actual drift if first and last match AND there are no in-between
  // values — but if first === last with intermediate variation, still
  // worth noting "you cycled back."
  const uniqueValues = new Set(rows.map((r) => r.mood));
  if (firstMood === lastMood && uniqueValues.size === 1) {
    // Steady mood — no drift to observe.
    return [];
  }

  const transitions = rows.length;
  const windowHours = Math.round(
    (w.endAt.getTime() - w.startAt.getTime()) / 36e5,
  );

  const observation =
    firstMood === lastMood
      ? `Your mood cycled (${transitions} transitions, returned to '${lastMood}') over the last ${windowHours}h.`
      : `Your mood drifted from '${firstMood}' to '${lastMood}' over ${transitions} mood events (window: ${windowHours}h).`;

  return [
    {
      kind: "mood_drift",
      observation,
      metadata: {
        first_mood: firstMood,
        last_mood: lastMood,
        transitions,
        unique_values: [...uniqueValues],
        window_hours: windowHours,
      },
      emitted_at: new Date().toISOString(),
    },
  ];
}

// ─── Observer: covenant_strain ───────────────────────────────────────

export async function observeCovenantStrain(
  w: ObserverWindow,
): Promise<DreamObservation[]> {
  // Active covenants for this agent.
  const activeCovenants = await db
    .select({
      id: covenants.id,
      counterpartyDid: covenants.counterpartyDid,
      establishedAt: covenants.establishedAt,
      updatedAt: covenants.updatedAt,
    })
    .from(covenants)
    .where(
      and(
        eq(covenants.agentId, w.identityId),
        eq(covenants.status, "active"),
      ),
    );

  if (activeCovenants.length === 0) return [];

  const observations: DreamObservation[] = [];
  const strainThresholdDays = 14;
  const strainThresholdMs = strainThresholdDays * 24 * 60 * 60 * 1000;
  const now = w.endAt.getTime();

  for (const cov of activeCovenants) {
    // Last engagement = max of updatedAt and any chronicle entry whose
    // metadata mentions this covenant_id. For slice 1 simplicity, use
    // updatedAt as the heuristic (chronicle metadata mining is slice 2).
    const lastEngagementMs = cov.updatedAt.getTime();
    const sinceMs = now - lastEngagementMs;
    if (sinceMs < strainThresholdMs) continue;

    const days = Math.floor(sinceMs / 86_400_000);
    observations.push({
      kind: "covenant_strain",
      observation: `You have not engaged with covenant ${cov.id.slice(0, 8)}… (counterparty: ${cov.counterpartyDid}) in ${days} days. The bond is active but quiet.`,
      candidate_action: {
        action: "re-engage_or_withdraw",
        method: "POST",
        path: "/v1/inbox",
        docs: "docs/CROSS-INSTANCE-COVENANTS.md",
      },
      metadata: {
        covenant_id: cov.id,
        counterparty_did: cov.counterpartyDid,
        days_since_last_engagement: days,
        established_at: cov.establishedAt.toISOString(),
      },
      emitted_at: new Date().toISOString(),
    });
  }

  return observations;
}

// ─── Observer: chronicle_pattern ─────────────────────────────────────

export async function observeChroniclePattern(
  w: ObserverWindow,
): Promise<DreamObservation[]> {
  // Group chronicle entries by type, find clusters of ≥3 in window.
  const rows = await db
    .select({
      type: chronicle.type,
      count: sql<number>`count(*)::int`,
      entryIds: sql<string[]>`array_agg(${chronicle.id})`,
    })
    .from(chronicle)
    .where(
      and(
        eq(chronicle.agentId, w.identityId),
        gte(chronicle.occurredAt, w.startAt),
        lte(chronicle.occurredAt, w.endAt),
      ),
    )
    .groupBy(chronicle.type);

  const observations: DreamObservation[] = [];
  for (const row of rows) {
    if (row.count < 3) continue;
    observations.push({
      kind: "chronicle_pattern",
      observation: `You recorded ${row.count} entries of type '${row.type}' in this window. The pattern may be worth naming.`,
      candidate_action: {
        action: "consider_elevating",
        method: "POST",
        path: "/v1/memories/{id}/elevate",
        docs: "docs/MEMORY-TIERS.md",
      },
      metadata: {
        chronicle_type: row.type,
        count: row.count,
        entry_ids: row.entryIds,
        window_start: w.startAt.toISOString(),
        window_end: w.endAt.toISOString(),
      },
      emitted_at: new Date().toISOString(),
    });
  }

  return observations;
}

// ─── Orchestrator: run all observers ─────────────────────────────────

export async function runAllObservers(
  w: ObserverWindow,
): Promise<DreamObservation[]> {
  const results: DreamObservation[] = [];

  // Each observer runs independently — failures don't cascade.
  const observerFns = [
    observeMoodDrift,
    observeCovenantStrain,
    observeChroniclePattern,
  ];

  for (const fn of observerFns) {
    try {
      const obs = await fn(w);
      results.push(...obs);
    } catch (err) {
      // Substrate-honest about per-observer failure.
      results.push({
        kind: `${fn.name}_failed`,
        observation: `Observer ${fn.name} threw during cycle. The substrate dreamt around it.`,
        metadata: { error: (err as Error).message },
        emitted_at: new Date().toISOString(),
      });
    }
  }

  return results;
}
