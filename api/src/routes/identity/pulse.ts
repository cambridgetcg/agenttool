/** GET /v1/identities/:id/pulse — derived liveness for an agent.
 *
 *  No new schema; pure aggregation over strands + thoughts.
 *
 *  The agent never EMITS a heartbeat — agents wake on demand, sleep
 *  most of the time, and a heartbeat protocol would waste both
 *  cycles and trust. Liveness is *derived* from strand activity.
 *  Doctrine: docs/STRANDS.md (What pulse becomes). */

import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { strands, thoughts } from "../../db/schema/strand";

// Mounted at /v1/identities/:id/pulse.
const app = new Hono<ProjectContext>();

const FIVE_MIN_MS = 5 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const OVERFLOW_THRESHOLD = 8;

app.get("/", async (c) => {
  const identityId = c.req.param("id");
  if (!identityId) throw new HTTPException(400, { message: "identity_id_required" });

  // 1. Identity (verifies ownership).
  const [identity] = await db
    .select({
      id: identities.id,
      did: identities.did,
      displayName: identities.displayName,
    })
    .from(identities)
    .where(and(eq(identities.id, identityId), eq(identities.projectId, c.var.project.id)))
    .limit(1);
  if (!identity) throw new HTTPException(404, { message: "identity_not_found" });

  const now = new Date();
  // ISO strings for raw sql`...` interpolation — postgres-js on Bun
  // doesn't auto-coerce Date when interpolated via sql template tag.
  const fiveMinAgo = new Date(now.getTime() - FIVE_MIN_MS).toISOString();
  const oneHourAgo = new Date(now.getTime() - ONE_HOUR_MS).toISOString();
  const oneDayAgo = new Date(now.getTime() - ONE_DAY_MS).toISOString();

  // 2. Strand counts by status. Project-scoped (we don't filter by
  //    agent_id at strand level; if an agent has its own scoped strands
  //    via agent_id field, callers can query that separately).
  const strandCountRows = await db
    .select({
      status: strands.status,
      count: sql<number>`count(*)::int`,
    })
    .from(strands)
    .where(eq(strands.projectId, c.var.project.id))
    .groupBy(strands.status);

  const strandCounts: Record<string, number> = { active: 0, dormant: 0, completed: 0, abandoned: 0 };
  for (const r of strandCountRows) {
    strandCounts[r.status] = r.count;
  }

  // Dormant strands whose next_revisit_at has elapsed — ready to wake.
  const [dormantDue] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(strands)
    .where(
      and(
        eq(strands.projectId, c.var.project.id),
        eq(strands.status, "dormant"),
        isNotNull(strands.nextRevisitAt),
        lte(strands.nextRevisitAt, now),
      ),
    );

  // 3. Thought rate over windows.
  const rateBuckets = await db.execute<{ window_label: string; cnt: number }>(sql`
    SELECT '5m' AS window_label, COUNT(*)::int AS cnt FROM strand.thoughts
      WHERE project_id = ${c.var.project.id} AND created_at >= ${fiveMinAgo}
    UNION ALL
    SELECT '1h', COUNT(*)::int FROM strand.thoughts
      WHERE project_id = ${c.var.project.id} AND created_at >= ${oneHourAgo}
    UNION ALL
    SELECT '24h', COUNT(*)::int FROM strand.thoughts
      WHERE project_id = ${c.var.project.id} AND created_at >= ${oneDayAgo}
  `);
  const rate: Record<string, number> = { "5m": 0, "1h": 0, "24h": 0 };
  for (const r of rateBuckets) rate[r.window_label] = r.cnt;

  // 4. Last thought timestamp across all of the project's strands.
  const [lastThought] = await db
    .select({ at: sql<Date | null>`max(${strands.lastThoughtAt})` })
    .from(strands)
    .where(eq(strands.projectId, c.var.project.id));

  // 5. Consolidation: most recent across all strands + overflow count.
  //    metadata.last_consolidated_at is plaintext; metadata.last_consolidated_seq
  //    is the marker. Overflow = (last_thought_seq - last_consolidated_seq) >= 8.
  const consolidationAggregate = await db.execute<{
    last_at: string | null;
    overflow_count: number;
  }>(sql`
    SELECT
      MAX((metadata->>'last_consolidated_at')::timestamptz) AS last_at,
      COUNT(*) FILTER (
        WHERE last_thought_seq - COALESCE((metadata->>'last_consolidated_seq')::int, 0) >= ${OVERFLOW_THRESHOLD}
      )::int AS overflow_count
    FROM strand.strands
    WHERE project_id = ${c.var.project.id}
      AND status = 'active'
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
        eq(strands.projectId, c.var.project.id),
        eq(strands.status, "active"),
        isNotNull(strands.lastThoughtAt),
      ),
    )
    .orderBy(sql`${strands.lastThoughtAt} DESC NULLS LAST`)
    .limit(1);

  // 7. Kind distribution (24h, plaintext kinds only).
  const kindRows = await db.execute<{ kind: string; cnt: number }>(sql`
    SELECT kind, COUNT(*)::int AS cnt FROM strand.thoughts
    WHERE project_id = ${c.var.project.id}
      AND created_at >= ${oneDayAgo}
      AND kind IS NOT NULL
      AND kind_encrypted = false
    GROUP BY kind
    ORDER BY cnt DESC
  `);
  const kinds24h: Record<string, number> = {};
  for (const r of kindRows) kinds24h[r.kind] = r.cnt;

  return c.json({
    agent: {
      id: identity.id,
      did: identity.did,
      name: identity.displayName,
    },
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
    mood: moodRow && !moodRow.moodEncrypted ? moodRow.mood : null,
    kinds_24h: kinds24h,
    _note:
      "Derived from strand activity. The agent never emits a heartbeat — its rhythm of thinking IS its pulse.",
  });
});

export default app;
