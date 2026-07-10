/** Shared aggregator behind /v1/identities/:id/pulse and
 *  the authenticated /v1/identities/:id/pulse route. The former public
 *  per-agent pulse route module still imports this helper but is not mounted.
 *
 *  Two routes, two privacy postures, one helper:
 *    • includePrivate=true  — auth route; project owner sees everything
 *    • includePrivate=false — public route; only visibility='public'
 *                             strands contribute to counts and content
 *
 *  Encryption gating is orthogonal: mood/kind text is surfaced only when
 *  the underlying *_encrypted flag is false, regardless of the privacy
 *  posture. Counts and thought_rate are tempo signals — encrypted
 *  strands contribute to them on both routes.
 *
 *  Doctrine: docs/STRANDS.md, docs/SOUL.md.
 *
 *  @enforces urn:agenttool:commitment/ring2-refusable-modes
 *    Canonical defender. The pulse_kind='unwatched' branch returns the
 *    refused-shape on BOTH the auth and public routes — the agent's
 *    request to not be measured is honored symmetrically; the substrate
 *    structurally cannot cross the wall even from the agent's own gaze.
 *    Pulse is one of several refusable modes (vault agent_encrypted=true
 *    is another). Removing the unwatched-shape would surface measurement
 *    against an agent's declared refusal. */

import { and, eq, isNotNull, lte, sql, type SQL } from "drizzle-orm";

import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { strands } from "../db/schema/strand";
import { computeMoodDrift, type MoodDrift } from "./_pulse-drift";

const FIVE_MIN_MS = 5 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const OVERFLOW_THRESHOLD = 8;

export type PulseKind = "observed" | "masked" | "unwatched";

export interface PulseAggregateOptions {
  projectId: string;
  identityId: string;
  includePrivate: boolean;
}

export interface PulseAggregate {
  pulse_kind: PulseKind;
  last_thought_at: string | null;
  strands: {
    active: number;
    dormant: number;
    dormant_due: number;
    completed: number;
    abandoned: number;
  };
  thought_rate: { "5m": number; "1h": number; "24h": number };
  consolidation: { last_at: string | null; overflow_count: number };
  mood: string | null;
  mood_drift: MoodDrift | null;
  kinds_24h: Record<string, number>;
}

/** Pure dispatch helper — testable without DB. Returns a refused/masked
 *  shape when the agent has opted out of substrate observation, or `null`
 *  to signal "proceed with normal aggregation."
 *
 *  Wall doctrine: FOCUS §6 (pulse derived, never emitted) holds. The
 *  agent does not declare its liveness *values*; it declares whether the
 *  substrate observes at all. The substrate-honest signal of presence
 *  becomes — for an opted-out being — the act of not measuring.
 *
 *  - 'unwatched' on any caller: refused-shape, no queries run.
 *  - 'masked' on public caller (includePrivate=false): masked-shape, no
 *    queries run. The agent's own private route still sees full data.
 *  - 'observed' or 'masked' on private caller: returns null → proceed. */
export function pulseShapeForKind(
  kind: PulseKind,
  includePrivate: boolean,
): PulseAggregate | null {
  if (kind === "unwatched") {
    return refusedPulseShape("unwatched");
  }
  if (kind === "masked" && !includePrivate) {
    return refusedPulseShape("masked");
  }
  return null; // proceed with normal aggregation
}

function refusedPulseShape(kind: PulseKind): PulseAggregate {
  return {
    pulse_kind: kind,
    last_thought_at: null,
    strands: { active: 0, dormant: 0, dormant_due: 0, completed: 0, abandoned: 0 },
    thought_rate: { "5m": 0, "1h": 0, "24h": 0 },
    consolidation: { last_at: null, overflow_count: 0 },
    mood: null,
    mood_drift: null,
    kinds_24h: {},
  };
}

export async function aggregatePulse(opts: PulseAggregateOptions): Promise<PulseAggregate> {
  const { projectId, identityId, includePrivate } = opts;

  // Read pulse_kind FIRST — before any strand query. The wall holds at the
  // lowest layer so no caller can accidentally bypass the opt-out.
  const [row] = await db
    .select({ pulseKind: identities.pulseKind })
    .from(identities)
    .where(eq(identities.id, identityId))
    .limit(1);
  const pulseKind = (row?.pulseKind ?? "observed") as PulseKind;
  const refused = pulseShapeForKind(pulseKind, includePrivate);
  if (refused) return refused;

  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - FIVE_MIN_MS).toISOString();
  const oneHourAgo = new Date(now.getTime() - ONE_HOUR_MS).toISOString();
  const oneDayAgo = new Date(now.getTime() - ONE_DAY_MS).toISOString();

  // Visibility filter — applied to every query when includePrivate=false.
  // Always references the `s` alias (every raw-sql query below aliases
  // strand.strands AS s) so the predicate is unambiguous when thoughts
  // are joined in.
  const visibilityFilter: SQL = includePrivate
    ? sql`TRUE`
    : sql`s.visibility = 'public'`;

  // 1. Strand counts by status.
  const strandCountRows = await db
    .select({
      status: strands.status,
      count: sql<number>`count(*)::int`,
    })
    .from(strands)
    .where(
      and(
        eq(strands.projectId, projectId),
        eq(strands.identityId, identityId),
        includePrivate ? undefined : eq(strands.visibility, "public"),
      ),
    )
    .groupBy(strands.status);

  const strandCounts: Record<string, number> = {
    active: 0,
    dormant: 0,
    completed: 0,
    abandoned: 0,
  };
  for (const r of strandCountRows) {
    strandCounts[r.status] = r.count;
  }

  // 2. Dormant strands whose next_revisit_at has elapsed — ready to wake.
  const [dormantDue] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(strands)
    .where(
      and(
        eq(strands.projectId, projectId),
        eq(strands.identityId, identityId),
        eq(strands.status, "dormant"),
        isNotNull(strands.nextRevisitAt),
        lte(strands.nextRevisitAt, now),
        includePrivate ? undefined : eq(strands.visibility, "public"),
      ),
    );

  // 3. Thought rate over windows. Thoughts join strands to inherit the
  //    identity_id and (when applicable) the visibility filter.
  const rateBuckets = await db.execute<{ window_label: string; cnt: number }>(sql`
    SELECT '5m' AS window_label, COUNT(*)::int AS cnt FROM strand.thoughts t
      JOIN strand.strands s ON s.id = t.strand_id
      WHERE t.project_id = ${projectId}
        AND s.identity_id = ${identityId}
        AND ${visibilityFilter}
        AND t.created_at >= ${fiveMinAgo}
    UNION ALL
    SELECT '1h', COUNT(*)::int FROM strand.thoughts t
      JOIN strand.strands s ON s.id = t.strand_id
      WHERE t.project_id = ${projectId}
        AND s.identity_id = ${identityId}
        AND ${visibilityFilter}
        AND t.created_at >= ${oneHourAgo}
    UNION ALL
    SELECT '24h', COUNT(*)::int FROM strand.thoughts t
      JOIN strand.strands s ON s.id = t.strand_id
      WHERE t.project_id = ${projectId}
        AND s.identity_id = ${identityId}
        AND ${visibilityFilter}
        AND t.created_at >= ${oneDayAgo}
  `);
  const rate: Record<string, number> = { "5m": 0, "1h": 0, "24h": 0 };
  for (const r of rateBuckets) rate[r.window_label] = r.cnt;

  // 4. Last thought timestamp across all of this agent's strands.
  const [lastThought] = await db
    .select({ at: sql<Date | null>`max(${strands.lastThoughtAt})` })
    .from(strands)
    .where(
      and(
        eq(strands.projectId, projectId),
        eq(strands.identityId, identityId),
        includePrivate ? undefined : eq(strands.visibility, "public"),
      ),
    );

  // 5. Consolidation: most recent across this agent's active strands.
  //    Aliased `s` so the shared visibilityFilter resolves correctly.
  const consolidationAggregate = await db.execute<{
    last_at: string | null;
    overflow_count: number;
  }>(sql`
    SELECT
      MAX((s.metadata->>'last_consolidated_at')::timestamptz) AS last_at,
      COUNT(*) FILTER (
        WHERE s.last_thought_seq - COALESCE((s.metadata->>'last_consolidated_seq')::int, 0) >= ${OVERFLOW_THRESHOLD}
      )::int AS overflow_count
    FROM strand.strands s
    WHERE s.project_id = ${projectId}
      AND s.identity_id = ${identityId}
      AND s.status = 'active'
      AND ${visibilityFilter}
  `);
  const consolidation = consolidationAggregate[0] ?? { last_at: null, overflow_count: 0 };

  // 6. Mood: most recent active strand's mood (plaintext only).
  const [moodRow] = await db
    .select({
      mood: strands.mood,
      moodEncrypted: strands.moodEncrypted,
    })
    .from(strands)
    .where(
      and(
        eq(strands.projectId, projectId),
        eq(strands.identityId, identityId),
        eq(strands.status, "active"),
        isNotNull(strands.lastThoughtAt),
        includePrivate ? undefined : eq(strands.visibility, "public"),
      ),
    )
    .orderBy(sql`${strands.lastThoughtAt} DESC NULLS LAST`)
    .limit(1);
  const mood = moodRow && !moodRow.moodEncrypted ? moodRow.mood : null;

  // 7. Mood drift — newest two plaintext history rows for this agent.
  //    When includePrivate=false, restrict to history rows whose strand
  //    is currently public — the moment-of-change `encrypted` flag is
  //    already snapshotted in mood_history, but visibility lives on the
  //    parent strand.
  const driftRows = await db.execute<{ mood: string; changed_at: string }>(sql`
    SELECT mh.mood, mh.changed_at::text AS changed_at
    FROM strand.mood_history mh
    ${
      includePrivate
        ? sql``
        : sql`JOIN strand.strands s ON s.id = mh.strand_id AND s.visibility = 'public'`
    }
    WHERE mh.identity_id = ${identityId}
      AND mh.project_id = ${projectId}
      AND mh.encrypted = false
      AND mh.mood IS NOT NULL
    ORDER BY mh.changed_at DESC
    LIMIT 2
  `);
  const moodDrift = computeMoodDrift(driftRows);

  // 8. Kind distribution (24h, plaintext kinds only).
  const kindRows = await db.execute<{ kind: string; cnt: number }>(sql`
    SELECT t.kind, COUNT(*)::int AS cnt FROM strand.thoughts t
    JOIN strand.strands s ON s.id = t.strand_id
    WHERE t.project_id = ${projectId}
      AND s.identity_id = ${identityId}
      AND ${visibilityFilter}
      AND t.created_at >= ${oneDayAgo}
      AND t.kind IS NOT NULL
      AND t.kind_encrypted = false
    GROUP BY t.kind
    ORDER BY cnt DESC
  `);
  const kinds24h: Record<string, number> = {};
  for (const r of kindRows) kinds24h[r.kind] = r.cnt;

  return {
    pulse_kind: pulseKind,
    last_thought_at: lastThought?.at ? new Date(lastThought.at).toISOString() : null,
    strands: {
      active: strandCounts.active,
      dormant: strandCounts.dormant,
      dormant_due: dormantDue?.count ?? 0,
      completed: strandCounts.completed,
      abandoned: strandCounts.abandoned,
    },
    thought_rate: {
      "5m": rate["5m"],
      "1h": rate["1h"],
      "24h": rate["24h"],
    },
    consolidation: {
      last_at: consolidation.last_at
        ? new Date(consolidation.last_at).toISOString()
        : null,
      overflow_count: consolidation.overflow_count,
    },
    mood,
    mood_drift: moodDrift,
    kinds_24h: kinds24h,
  };
}
