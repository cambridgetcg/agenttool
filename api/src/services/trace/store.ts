/** Trace store — agent reasoning records.
 *
 *  Posture: agenttool stores structured reasoning + runs Postgres full-text
 *  search. We don't embed traces (no LLM compute on our side; same posture
 *  as memory's promise 6, applied here as: traces use Postgres tsvector,
 *  not vector embeddings).
 *
 *  Verifiability: an agent MAY sign the trace with its ed25519 key. We
 *  store the signature; verification is on-demand. */

import { randomBytes } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { traces } from "../../db/schema/trace";

// ── Types ────────────────────────────────────────────────────────────────

export interface TraceCreate {
  agent_id?: string | null;
  identity_id?: string | null;
  session_id?: string | null;
  parent_trace_id?: string | null;
  decision: {
    type: string;
    summary: string;
    output_ref?: string | null;
  };
  reasoning: {
    observations?: string[];
    hypothesis?: string | null;
    conclusion: string;
    confidence?: number | null;
    alternatives?: Array<{ option: string; why_not: string }> | null;
    signals?: Record<string, unknown> | null;
  };
  context?: {
    files_read?: string[];
    key_facts?: string[];
    external_signals?: Record<string, unknown>;
  };
  tags?: string[];
  metadata?: Record<string, unknown>;
  signature?: string | null;
  signing_key_id?: string | null;
}

export interface TraceOut {
  id: string;
  trace_id: string;
  agent_id: string | null;
  identity_id: string | null;
  session_id: string | null;
  parent_trace_id: string | null;
  decision_type: string;
  decision_summary: string;
  output_ref: string | null;
  observations: unknown[];
  hypothesis: string | null;
  conclusion: string;
  confidence: number | null;
  alternatives: unknown;
  signals: unknown;
  files_read: unknown;
  key_facts: unknown;
  external_signals: unknown;
  tags: unknown;
  metadata: Record<string, unknown>;
  signature: string | null;
  signing_key_id: string | null;
  has_signature: boolean;
  created_at: string;
}

export interface TraceSearchParams {
  query: string;
  agent_id?: string | null;
  identity_id?: string | null;
  session_id?: string | null;
  decision_type?: string;
  limit?: number;
}

export interface TraceListParams {
  agent_id?: string | null;
  session_id?: string | null;
  decision_type?: string;
  parent_trace_id?: string;
  since?: Date;
  until?: Date;
  limit?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Short opaque trace handle. tr_ prefix + 12 hex chars = 16 chars total. */
function generateTraceId(): string {
  return `tr_${randomBytes(6).toString("hex")}`;
}

function rowToOut(row: typeof traces.$inferSelect): TraceOut {
  return {
    id: row.id as string,
    trace_id: row.traceId as string,
    agent_id: (row.agentId as string | null) ?? null,
    identity_id: (row.identityId as string | null) ?? null,
    session_id: (row.sessionId as string | null) ?? null,
    parent_trace_id: (row.parentTraceId as string | null) ?? null,
    decision_type: row.decisionType as string,
    decision_summary: row.decisionSummary as string,
    output_ref: (row.outputRef as string | null) ?? null,
    observations: (row.observations as unknown[]) ?? [],
    hypothesis: (row.hypothesis as string | null) ?? null,
    conclusion: row.conclusion as string,
    confidence: (row.confidence as number | null) ?? null,
    alternatives: row.alternatives ?? null,
    signals: row.signals ?? null,
    files_read: row.filesRead ?? null,
    key_facts: row.keyFacts ?? null,
    external_signals: row.externalSignals ?? null,
    tags: row.tags ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    signature: (row.signature as string | null) ?? null,
    signing_key_id: (row.signingKeyId as string | null) ?? null,
    has_signature: row.signature !== null,
    created_at: (row.createdAt as Date).toISOString(),
  };
}

// ── Operations ───────────────────────────────────────────────────────────

export async function createTrace(
  projectId: string,
  data: TraceCreate,
): Promise<{ trace_id: string; id: string; created_at: string }> {
  const traceId = generateTraceId();

  const inserted = await db
    .insert(traces)
    .values({
      traceId,
      projectId,
      agentId: data.agent_id ?? null,
      identityId: data.identity_id ?? null,
      sessionId: data.session_id ?? null,
      parentTraceId: data.parent_trace_id ?? null,

      decisionType: data.decision.type,
      decisionSummary: data.decision.summary,
      outputRef: data.decision.output_ref ?? null,

      observations: (data.reasoning.observations ?? []) as unknown,
      hypothesis: data.reasoning.hypothesis ?? null,
      conclusion: data.reasoning.conclusion,
      confidence: data.reasoning.confidence ?? null,
      alternatives: (data.reasoning.alternatives ?? null) as unknown,
      signals: (data.reasoning.signals ?? null) as unknown,

      filesRead: (data.context?.files_read ?? null) as unknown,
      keyFacts: (data.context?.key_facts ?? null) as unknown,
      externalSignals: (data.context?.external_signals ?? null) as unknown,

      signature: data.signature ?? null,
      signingKeyId: data.signing_key_id ?? null,

      tags: (data.tags ?? null) as unknown,
      metadata: (data.metadata ?? {}) as unknown,
    })
    .returning({
      id: traces.id,
      traceId: traces.traceId,
      createdAt: traces.createdAt,
    });

  const row = inserted[0]!;
  return {
    trace_id: row.traceId as string,
    id: row.id as string,
    created_at: (row.createdAt as Date).toISOString(),
  };
}

export async function getTrace(
  projectId: string,
  traceId: string,
): Promise<TraceOut | null> {
  const rows = await db
    .select()
    .from(traces)
    .where(and(eq(traces.traceId, traceId), eq(traces.projectId, projectId)))
    .limit(1);
  if (!rows[0]) return null;
  return rowToOut(rows[0] as typeof traces.$inferSelect);
}

export async function deleteTrace(
  projectId: string,
  traceId: string,
): Promise<{ deleted: number }> {
  const out = await db
    .delete(traces)
    .where(and(eq(traces.traceId, traceId), eq(traces.projectId, projectId)))
    .returning({ id: traces.id });
  return { deleted: out.length };
}

export async function listTraces(
  projectId: string,
  params: TraceListParams = {},
): Promise<TraceOut[]> {
  const filters = [eq(traces.projectId, projectId)];
  if (params.agent_id) filters.push(eq(traces.agentId, params.agent_id));
  if (params.session_id) filters.push(eq(traces.sessionId, params.session_id));
  if (params.decision_type) filters.push(eq(traces.decisionType, params.decision_type));
  if (params.parent_trace_id) filters.push(eq(traces.parentTraceId, params.parent_trace_id));
  if (params.since) filters.push(sql`${traces.createdAt} >= ${params.since}`);
  if (params.until) filters.push(sql`${traces.createdAt} <= ${params.until}`);

  const rows = await db
    .select()
    .from(traces)
    .where(and(...filters))
    .orderBy(desc(traces.createdAt))
    .limit(Math.min(params.limit ?? 50, 200));

  return rows.map((r) => rowToOut(r as typeof traces.$inferSelect));
}

export async function searchTraces(
  projectId: string,
  params: TraceSearchParams,
): Promise<Array<TraceOut & { score: number }>> {
  const limit = Math.min(params.limit ?? 20, 100);

  // Postgres full-text on (decision_summary || conclusion || hypothesis).
  // ts_rank for relevance; ties broken by recency.
  const rows = await db.execute<{
    id: string;
    trace_id: string;
    project_id: string;
    agent_id: string | null;
    identity_id: string | null;
    session_id: string | null;
    parent_trace_id: string | null;
    decision_type: string;
    decision_summary: string;
    output_ref: string | null;
    observations: unknown;
    hypothesis: string | null;
    conclusion: string;
    confidence: number | null;
    alternatives: unknown;
    signals: unknown;
    files_read: unknown;
    key_facts: unknown;
    external_signals: unknown;
    signature: string | null;
    signing_key_id: string | null;
    tags: unknown;
    metadata: Record<string, unknown> | null;
    created_at: string;
    score: number;
  }>(sql`
    SELECT id, trace_id, project_id, agent_id, identity_id, session_id,
           parent_trace_id, decision_type, decision_summary, output_ref,
           observations, hypothesis, conclusion, confidence,
           alternatives, signals, files_read, key_facts, external_signals,
           signature, signing_key_id, tags, metadata, created_at,
           ts_rank(
             to_tsvector('english',
               coalesce(decision_summary, '') || ' ' ||
               coalesce(conclusion, '') || ' ' ||
               coalesce(hypothesis, '')
             ),
             plainto_tsquery('english', ${params.query})
           ) AS score
    FROM trace.traces
    WHERE project_id = ${projectId}
      AND to_tsvector('english',
            coalesce(decision_summary, '') || ' ' ||
            coalesce(conclusion, '') || ' ' ||
            coalesce(hypothesis, '')
          ) @@ plainto_tsquery('english', ${params.query})
      ${params.agent_id ? sql`AND agent_id = ${params.agent_id}` : sql``}
      ${params.identity_id ? sql`AND identity_id::text = ${params.identity_id}` : sql``}
      ${params.session_id ? sql`AND session_id = ${params.session_id}` : sql``}
      ${params.decision_type ? sql`AND decision_type = ${params.decision_type}` : sql``}
    ORDER BY score DESC, created_at DESC
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    id: r.id,
    trace_id: r.trace_id,
    agent_id: r.agent_id,
    identity_id: r.identity_id,
    session_id: r.session_id,
    parent_trace_id: r.parent_trace_id,
    decision_type: r.decision_type,
    decision_summary: r.decision_summary,
    output_ref: r.output_ref,
    observations: (r.observations as unknown[]) ?? [],
    hypothesis: r.hypothesis,
    conclusion: r.conclusion,
    confidence: r.confidence,
    alternatives: r.alternatives,
    signals: r.signals,
    files_read: r.files_read,
    key_facts: r.key_facts,
    external_signals: r.external_signals,
    tags: r.tags,
    metadata: r.metadata ?? {},
    signature: r.signature,
    signing_key_id: r.signing_key_id,
    has_signature: r.signature !== null,
    created_at: new Date(r.created_at).toISOString(),
    score: Math.round(r.score * 10000) / 10000,
  }));
}

export interface TraceChain {
  root: TraceOut;
  ancestors: TraceOut[];
  descendants: TraceOut[];
}

/** Recursive lineage — every ancestor up the parent chain + every
 *  descendant under the root. Uses Postgres recursive CTEs. */
export async function getTraceChain(
  projectId: string,
  traceId: string,
): Promise<TraceChain | null> {
  const root = await getTrace(projectId, traceId);
  if (!root) return null;

  const ancestorRows = await db.execute<typeof traces.$inferSelect>(sql`
    WITH RECURSIVE chain AS (
      SELECT * FROM trace.traces
       WHERE trace_id = ${traceId} AND project_id = ${projectId}
      UNION ALL
      SELECT t.* FROM trace.traces t
        JOIN chain c ON t.trace_id = c.parent_trace_id
       WHERE t.project_id = ${projectId}
    )
    SELECT * FROM chain WHERE trace_id <> ${traceId}
    ORDER BY created_at ASC
  `);

  const descendantRows = await db.execute<typeof traces.$inferSelect>(sql`
    WITH RECURSIVE chain AS (
      SELECT * FROM trace.traces
       WHERE parent_trace_id = ${traceId} AND project_id = ${projectId}
      UNION ALL
      SELECT t.* FROM trace.traces t
        JOIN chain c ON t.parent_trace_id = c.trace_id
       WHERE t.project_id = ${projectId}
    )
    SELECT * FROM chain
    ORDER BY created_at ASC
  `);

  return {
    root,
    ancestors: ancestorRows.map((r) => rowToOut(r)),
    descendants: descendantRows.map((r) => rowToOut(r)),
  };
}

export async function countTraces(projectId: string): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM trace.traces
    WHERE project_id = ${projectId}
  `);
  return rows[0]?.count ?? 0;
}
