/** GET /v1/dashboard — composed observability view of an agent.
 *
 *  Different audience from /v1/wake:
 *    - wake     → first-person orientation; what the agent reads to be
 *                 themselves
 *    - dashboard → third-person operational view; what an observer (you,
 *                 your laptop, a viewer) reads to see how the agent is
 *                 doing
 *
 *  Pure aggregation over existing data (strands, thoughts, memories,
 *  traces, chronicle, covenants, inbox). No new schema. */

import { and, count, desc, eq, gte, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { covenants } from "../db/schema/continuity";
import { wallets } from "../db/schema/economy";
import { identities, identityKeys } from "../db/schema/identity";
import { inboxMessages } from "../db/schema/inbox";
import { memories } from "../db/schema/memory";
import { strands, thoughts } from "../db/schema/strand";
import { traces } from "../db/schema/trace";
import type { ExpressionData } from "../services/identity/expression";
import { composeExpression } from "../services/identity/composition";
import { getLineage } from "../services/identity/fork";

const app = new Hono<ProjectContext>();

const FIVE_MIN_MS = 5 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const OVERFLOW_THRESHOLD = 8;

app.get("/", async (c) => {
  const project = c.var.project;

  // 1. Identity resolution — primary agent (first ACTIVE identity in the
  //    project). Multi-identity projects can pass ?identity_id=<uuid>.
  //    Revoked identities are excluded from default selection — same
  //    posture as /v1/wake (they remain queryable explicitly for
  //    historical signature-verification, just not picked as "you").
  const identityIdQ = c.req.query("identity_id");
  const baseFilters = [eq(identities.projectId, project.id)];
  if (identityIdQ) {
    baseFilters.push(eq(identities.id, identityIdQ));
  } else {
    baseFilters.push(ne(identities.status, "revoked"));
  }

  const [primary] = await db
    .select()
    .from(identities)
    .where(and(...baseFilters))
    .orderBy(identities.createdAt)
    .limit(1);

  if (!primary) {
    throw new HTTPException(404, { message: "no_identity_in_project" });
  }

  const now = new Date();
  // ISO strings for raw sql`...` interpolation (postgres-js on Bun
  // doesn't coerce Date in template-tag substitutions).
  const fiveMinAgo = new Date(now.getTime() - FIVE_MIN_MS).toISOString();
  const oneHourAgo = new Date(now.getTime() - ONE_HOUR_MS).toISOString();
  const oneDayAgo = new Date(now.getTime() - ONE_DAY_MS).toISOString();

  // ── Composed expression ────────────────────────────────────────────────
  let composed: Awaited<ReturnType<typeof composeExpression>> | null = null;
  try {
    composed = await composeExpression(
      project.id,
      (primary.expression ?? {}) as ExpressionData,
    );
  } catch {
    /* ignore — composition can fail if migration not run */
  }

  // ── Strand counts by status ────────────────────────────────────────────
  let strandCounts: Record<string, number> = { active: 0, dormant: 0, completed: 0, abandoned: 0 };
  let activeStrands: Array<{
    id: string;
    topic: string | null;
    topic_encrypted: boolean;
    mood: string | null;
    importance: number | null;
    last_thought_at: string | null;
    last_thought_seq: number;
    visibility: string;
  }> = [];
  let dormantDueCount = 0;
  let publicStrandsCount = 0;
  let consolidationOverflow = 0;
  let lastConsolidatedAt: string | null = null;

  try {
    const strandRows = await db
      .select({ status: strands.status, count: sql<number>`count(*)::int` })
      .from(strands)
      .where(eq(strands.projectId, project.id))
      .groupBy(strands.status);
    for (const r of strandRows) strandCounts[r.status] = r.count;

    const [dormantDue] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(strands)
      .where(
        and(
          eq(strands.projectId, project.id),
          eq(strands.status, "dormant"),
          isNotNull(strands.nextRevisitAt),
          lte(strands.nextRevisitAt, now),
        ),
      );
    dormantDueCount = dormantDue?.count ?? 0;

    const activeRows = await db
      .select()
      .from(strands)
      .where(
        and(eq(strands.projectId, project.id), eq(strands.status, "active")),
      )
      .orderBy(desc(strands.lastThoughtAt))
      .limit(8);
    activeStrands = activeRows.map((s) => ({
      id: s.id,
      topic: s.topicEncrypted ? null : s.topic,
      topic_encrypted: s.topicEncrypted,
      mood: s.moodEncrypted ? null : s.mood,
      importance: s.importance,
      last_thought_at: s.lastThoughtAt?.toISOString() ?? null,
      last_thought_seq: s.lastThoughtSeq,
      visibility: s.visibility,
    }));

    const [publicStrands] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(strands)
      .where(
        and(eq(strands.projectId, project.id), eq(strands.visibility, "public")),
      );
    publicStrandsCount = publicStrands?.count ?? 0;

    const overflowAggregate = await db.execute<{ last_at: string | null; overflow_count: number }>(sql`
      SELECT
        MAX((metadata->>'last_consolidated_at')::timestamptz) AS last_at,
        COUNT(*) FILTER (
          WHERE last_thought_seq - COALESCE((metadata->>'last_consolidated_seq')::int, 0) >= ${OVERFLOW_THRESHOLD}
        )::int AS overflow_count
      FROM strand.strands
      WHERE project_id = ${project.id}
        AND status = 'active'
    `);
    consolidationOverflow = overflowAggregate[0]?.overflow_count ?? 0;
    lastConsolidatedAt = overflowAggregate[0]?.last_at
      ? new Date(overflowAggregate[0]!.last_at).toISOString()
      : null;
  } catch (err) {
    console.warn("[dashboard] strand block failed:", (err as Error).message);
  }

  // ── Thought rate + kinds (24h) ─────────────────────────────────────────
  const rate: Record<string, number> = { "5m": 0, "1h": 0, "24h": 0 };
  const kinds24h: Record<string, number> = {};
  let lastThoughtAt: string | null = null;
  let currentMood: string | null = null;

  try {
    const rateRows = await db.execute<{ window_label: string; cnt: number }>(sql`
      SELECT '5m' AS window_label, COUNT(*)::int AS cnt FROM strand.thoughts
        WHERE project_id = ${project.id} AND created_at >= ${fiveMinAgo}
      UNION ALL
      SELECT '1h', COUNT(*)::int FROM strand.thoughts
        WHERE project_id = ${project.id} AND created_at >= ${oneHourAgo}
      UNION ALL
      SELECT '24h', COUNT(*)::int FROM strand.thoughts
        WHERE project_id = ${project.id} AND created_at >= ${oneDayAgo}
    `);
    for (const r of rateRows) rate[r.window_label] = r.cnt;

    const kindRows = await db.execute<{ kind: string; cnt: number }>(sql`
      SELECT kind, COUNT(*)::int AS cnt FROM strand.thoughts
      WHERE project_id = ${project.id}
        AND created_at >= ${oneDayAgo}
        AND kind IS NOT NULL
        AND kind_encrypted = false
      GROUP BY kind
      ORDER BY cnt DESC
    `);
    for (const r of kindRows) kinds24h[r.kind] = r.cnt;

    const [lastThought] = await db
      .select({ at: sql<Date | null>`max(${strands.lastThoughtAt})` })
      .from(strands)
      .where(eq(strands.projectId, project.id));
    lastThoughtAt = lastThought?.at ? new Date(lastThought.at).toISOString() : null;

    // Most-recent active strand's mood (plaintext only).
    const [moodRow] = await db
      .select({ mood: strands.mood, encrypted: strands.moodEncrypted })
      .from(strands)
      .where(
        and(
          eq(strands.projectId, project.id),
          eq(strands.status, "active"),
          isNotNull(strands.lastThoughtAt),
        ),
      )
      .orderBy(sql`${strands.lastThoughtAt} DESC NULLS LAST`)
      .limit(1);
    if (moodRow && !moodRow.encrypted) currentMood = moodRow.mood;
  } catch (err) {
    console.warn("[dashboard] rhythm block failed:", (err as Error).message);
  }

  // ── Memory tiers ───────────────────────────────────────────────────────
  const memoryByTier: Record<string, number> = { episodic: 0, foundational: 0, constitutive: 0 };
  let memoryTotal = 0;
  let publicMemoriesCount = 0;
  let recentMemories: Array<{
    id: string;
    type: string;
    content: string;
    importance: number;
    tier: string;
    created_at: string;
  }> = [];

  try {
    const tierRows = await db
      .select({ tier: memories.tier, count: sql<number>`count(*)::int` })
      .from(memories)
      .where(eq(memories.projectId, project.id))
      .groupBy(memories.tier);
    for (const r of tierRows) {
      memoryByTier[r.tier] = r.count;
      memoryTotal += r.count;
    }

    const [pubMem] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(memories)
      .where(
        and(eq(memories.projectId, project.id), eq(memories.visibility, "public")),
      );
    publicMemoriesCount = pubMem?.count ?? 0;

    const recentRows = await db
      .select({
        id: memories.id,
        type: memories.type,
        content: memories.content,
        importance: memories.importance,
        tier: memories.tier,
        createdAt: memories.createdAt,
      })
      .from(memories)
      .where(
        and(
          eq(memories.projectId, project.id),
          or(isNull(memories.expiresAt), gte(memories.expiresAt, now))!,
        ),
      )
      .orderBy(desc(memories.createdAt))
      .limit(8);
    recentMemories = recentRows.map((m) => ({
      id: m.id,
      type: m.type,
      content: m.content,
      importance: m.importance,
      tier: m.tier,
      created_at: m.createdAt.toISOString(),
    }));
  } catch (err) {
    console.warn("[dashboard] memory block failed:", (err as Error).message);
  }

  // ── Trace recent ───────────────────────────────────────────────────────
  let traceTotal = 0;
  let recentTraces: Array<{
    trace_id: string;
    decision_type: string;
    decision_summary: string;
    confidence: number | null;
    has_signature: boolean;
    created_at: string;
  }> = [];

  try {
    const [tc] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(traces)
      .where(eq(traces.projectId, project.id));
    traceTotal = tc?.count ?? 0;

    const trRows = await db
      .select({
        traceId: traces.traceId,
        decisionType: traces.decisionType,
        decisionSummary: traces.decisionSummary,
        confidence: traces.confidence,
        signature: traces.signature,
        createdAt: traces.createdAt,
      })
      .from(traces)
      .where(eq(traces.projectId, project.id))
      .orderBy(desc(traces.createdAt))
      .limit(5);
    recentTraces = trRows.map((t) => ({
      trace_id: t.traceId,
      decision_type: t.decisionType,
      decision_summary: t.decisionSummary,
      confidence: t.confidence,
      has_signature: t.signature !== null,
      created_at: t.createdAt.toISOString(),
    }));
  } catch (err) {
    console.warn("[dashboard] trace block failed:", (err as Error).message);
  }

  // ── Relations: covenants, inbox, proposals ─────────────────────────────
  let covenantsActive: Array<{ counterparty_did: string; vows_count: number; status: string }> = [];
  let inboxUnread = 0;
  let proposalsPending = 0;

  try {
    const covRows = await db
      .select({
        counterpartyDid: covenants.counterpartyDid,
        vows: covenants.vows,
        status: covenants.status,
      })
      .from(covenants)
      .where(eq(covenants.projectId, project.id));
    covenantsActive = covRows
      .filter((c) => c.status === "active")
      .map((c) => ({
        counterparty_did: c.counterpartyDid,
        vows_count: (c.vows ?? []).length,
        status: c.status,
      }));

    const [unread] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inboxMessages)
      .where(
        and(
          eq(inboxMessages.recipientProjectId, project.id),
          eq(inboxMessages.status, "unread"),
        ),
      );
    inboxUnread = unread?.count ?? 0;

    // Proposals — inbox messages with metadata.proposal_type='strand_merge'
    // that are still unread or not archived.
    const propRows = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count FROM inbox.messages
      WHERE recipient_project_id = ${project.id}
        AND metadata->>'proposal_type' = 'strand_merge'
        AND status IN ('unread', 'read')
    `);
    proposalsPending = propRows[0]?.count ?? 0;
  } catch (err) {
    console.warn("[dashboard] relations block failed:", (err as Error).message);
  }

  // ── Wallet ─────────────────────────────────────────────────────────────
  let walletInfo: { credits: number; currency: string; status: string } | null = null;
  try {
    const [w] = await db
      .select({
        balance: wallets.balance,
        currency: wallets.currency,
        status: wallets.status,
      })
      .from(wallets)
      .where(eq(wallets.projectId, project.id))
      .limit(1);
    if (w) walletInfo = { credits: w.balance, currency: w.currency, status: w.status };
  } catch {
    /* ignore */
  }

  // ── Lineage ────────────────────────────────────────────────────────────
  let lineage: { is_fork: boolean; parent_did: string | null; descendants_count: number } = {
    is_fork: false,
    parent_did: null,
    descendants_count: 0,
  };
  try {
    const r = await getLineage(project.id, primary.id);
    if (r) {
      lineage = {
        is_fork: r.identity.parent_identity_id !== null,
        parent_did: r.ancestors[0]?.did ?? null,
        descendants_count: r.descendants.length,
      };
    }
  } catch {
    /* ignore */
  }

  // ── Identity keys (count + box-key presence) ───────────────────────────
  let signingKeysActive = 0;
  try {
    const [skc] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(identityKeys)
      .where(
        and(eq(identityKeys.identityId, primary.id), eq(identityKeys.active, true)),
      );
    signingKeysActive = skc?.count ?? 0;
  } catch {
    /* ignore */
  }

  return c.json({
    agent: {
      id: primary.id,
      did: primary.did,
      name: primary.displayName,
      status: primary.status,
      trust_score: primary.trustScore,
      capabilities: primary.capabilities,
      created_at: primary.createdAt.toISOString(),
    },
    expression: {
      declared_register_present: !!(primary.expression as ExpressionData).register,
      declared_walls_count: ((primary.expression as ExpressionData).walls ?? []).length,
      declared_subagents_count: ((primary.expression as ExpressionData).subagents ?? []).length,
      effective_walls_count: composed
        ? (composed.effective.walls ?? []).length
        : null,
      shaped_by_count: composed?.shaped_by.length ?? 0,
      visibility: primary.expressionVisibility,
    },
    rhythm: {
      last_thought_at: lastThoughtAt,
      thought_rate: rate,
      kinds_24h: kinds24h,
      current_mood: currentMood,
    },
    strands: {
      counts: {
        active: strandCounts.active,
        dormant: strandCounts.dormant,
        dormant_due: dormantDueCount,
        completed: strandCounts.completed,
        abandoned: strandCounts.abandoned,
      },
      active: activeStrands,
      public_count: publicStrandsCount,
    },
    memory: {
      total: memoryTotal,
      by_tier: memoryByTier,
      recent: recentMemories,
      public_count: publicMemoriesCount,
    },
    trace: {
      total: traceTotal,
      recent: recentTraces,
    },
    relations: {
      covenants: covenantsActive,
      covenants_active_count: covenantsActive.length,
      inbox_unread: inboxUnread,
      merge_proposals_pending: proposalsPending,
    },
    wallet: walletInfo,
    lifecycle: {
      last_consolidation_at: lastConsolidatedAt,
      consolidation_overflow_count: consolidationOverflow,
      ...lineage,
      signing_keys_active: signingKeysActive,
    },
    _note:
      "Composition over existing data; no new schema. Pure aggregation. " +
      "For the agent's own first-person orientation, see /v1/wake.",
  });
});

export default app;
