/** Memory store — pgvector-backed. The agent supplies embeddings; we store
 *  them, run cosine similarity, and serve results. No LLM compute on our
 *  side. See docs/IDENTITY-ANCHOR.md promise 6. */

import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { memories } from "../../db/schema/memory";

// ─── Types ────────────────────────────────────────────────────────────────

export interface MemoryCreate {
  type: "episodic" | "semantic" | "procedural" | "working";
  content: string;
  embedding?: number[]; // optional — required for /search to return this row
  key?: string | null;
  agent_id?: string | null;
  identity_id?: string | null;
  metadata?: Record<string, unknown>;
  importance?: number; // 0.0–1.0, default 0.5
  ttl_seconds?: number; // for type=working
}

export interface MemorySearchParams {
  query_embedding: number[];
  type?: "episodic" | "semantic" | "procedural" | "working";
  agent_id?: string | null;
  identity_id?: string | null;
  limit?: number; // 1–100, default 10
  min_score?: number; // 0.0–1.0, default 0.0
}

export interface MemoryOut {
  id: string;
  type: string;
  /** Salience tier — episodic | foundational | constitutive. Foundational +
   *  constitutive memories survive forking and shape effective expression.
   *  Surfaced here so the owning agent can introspect its own state without
   *  needing the dashboard composition view. */
  tier: string;
  /** private | public — propagates to /public/memories/:id when public. */
  visibility: string;
  key: string | null;
  content: string;
  agent_id: string | null;
  identity_id: string | null;
  metadata: Record<string, unknown>;
  importance: number;
  has_embedding: boolean;
  created_at: string;
  accessed_at: string | null;
  expires_at: string | null;
}

export interface MemorySearchResult extends MemoryOut {
  score: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const VALID_TYPES = ["episodic", "semantic", "procedural", "working"] as const;

/** Format a JS number[] as pgvector's wire format: '[0.1,0.2,...]' */
function formatVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

function rowToOut(row: typeof memories.$inferSelect): MemoryOut {
  return {
    id: row.id,
    type: row.type,
    tier: row.tier,
    visibility: row.visibility,
    key: row.key,
    content: row.content,
    agent_id: row.agentId,
    identity_id: row.identityId,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    importance: row.importance,
    has_embedding: row.embedding !== null,
    created_at: row.createdAt.toISOString(),
    accessed_at: row.accessedAt?.toISOString() ?? null,
    expires_at: row.expiresAt?.toISOString() ?? null,
  };
}

// ─── Operations ───────────────────────────────────────────────────────────

export async function write(
  projectId: string,
  data: MemoryCreate,
): Promise<{ id: string; created_at: string }> {
  if (!VALID_TYPES.includes(data.type)) {
    throw new Error(`invalid memory type: ${data.type}`);
  }
  if (data.embedding && data.embedding.length !== 1536) {
    throw new Error(
      `embedding must have 1536 dimensions, got ${data.embedding.length}. ` +
        `Truncate or pad your provider's vector to 1536.`,
    );
  }
  const importance = data.importance ?? 0.5;
  if (importance < 0 || importance > 1) {
    throw new Error("importance must be between 0.0 and 1.0");
  }

  const expiresAt =
    data.type === "working" && data.ttl_seconds
      ? new Date(Date.now() + data.ttl_seconds * 1000)
      : null;

  // pgvector input goes via sql tag; everything else through Drizzle's
  // typed insert path.
  const embeddingExpr = data.embedding
    ? sql`${formatVector(data.embedding)}::vector`
    : sql`NULL`;

  const inserted = await db
    .insert(memories)
    .values({
      projectId,
      agentId: data.agent_id ?? null,
      identityId: data.identity_id ?? null,
      type: data.type,
      key: data.key ?? null,
      content: data.content,
      embedding: embeddingExpr as unknown as number[], // sql expression, not array
      metadata: data.metadata ?? {},
      importance,
      expiresAt,
    })
    .returning({ id: memories.id, createdAt: memories.createdAt });

  const row = inserted[0]!;
  return { id: row.id, created_at: row.createdAt.toISOString() };
}

export async function readById(
  projectId: string,
  memoryId: string,
): Promise<MemoryOut | null> {
  const rows = await db
    .select()
    .from(memories)
    .where(and(eq(memories.id, memoryId), eq(memories.projectId, projectId)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Update accessed_at — fire-and-forget. The read still succeeds even if
  // the touch fails (e.g. read replica without write access).
  db.update(memories)
    .set({ accessedAt: new Date() })
    .where(eq(memories.id, memoryId))
    .catch(() => {});

  return rowToOut(row);
}

export async function readByKey(
  projectId: string,
  key: string,
  agentId?: string | null,
): Promise<MemoryOut[]> {
  const filters = [eq(memories.projectId, projectId), eq(memories.key, key)];
  if (agentId) filters.push(eq(memories.agentId, agentId));

  const rows = await db
    .select()
    .from(memories)
    .where(and(...filters))
    .orderBy(desc(memories.createdAt));

  return rows.map(rowToOut);
}

export async function listRecent(
  projectId: string,
  opts: {
    agent_id?: string | null;
    identity_id?: string | null;
    type?: string;
    tier?: string;
    limit?: number;
  } = {},
): Promise<MemoryOut[]> {
  const filters = [
    eq(memories.projectId, projectId),
    or(isNull(memories.expiresAt), sql`${memories.expiresAt} > now()`)!,
  ];
  if (opts.agent_id) filters.push(eq(memories.agentId, opts.agent_id));
  if (opts.identity_id) filters.push(eq(memories.identityId, opts.identity_id));
  if (opts.type) filters.push(eq(memories.type, opts.type));
  if (opts.tier) filters.push(eq(memories.tier, opts.tier));

  const rows = await db
    .select()
    .from(memories)
    .where(and(...filters))
    .orderBy(desc(memories.createdAt))
    .limit(Math.min(opts.limit ?? 20, 100));

  return rows.map(rowToOut);
}

export async function search(
  projectId: string,
  params: MemorySearchParams,
): Promise<MemorySearchResult[]> {
  if (params.query_embedding.length !== 1536) {
    throw new Error(
      `query_embedding must have 1536 dimensions, got ${params.query_embedding.length}`,
    );
  }
  const limit = Math.min(params.limit ?? 10, 100);
  const minScore = params.min_score ?? 0.0;
  const queryVec = formatVector(params.query_embedding);

  // Cosine similarity = 1 - cosine_distance. pgvector exposes:
  //   <=> cosine distance
  //   <-> L2 distance
  //   <#> negative inner product
  // We rerank in JS with importance × recency_decay below.

  const rawRows = await db.execute<{
    id: string;
    type: string;
    tier: string;
    visibility: string;
    key: string | null;
    content: string;
    agent_id: string | null;
    identity_id: string | null;
    metadata: Record<string, unknown>;
    importance: number;
    accessed_at: Date | null;
    created_at: Date;
    expires_at: Date | null;
    has_embedding: boolean;
    score: number;
  }>(sql`
    SELECT id, type, tier, visibility, key, content, agent_id, identity_id, metadata, importance,
           accessed_at, created_at, expires_at,
           (embedding IS NOT NULL) AS has_embedding,
           1 - (embedding <=> ${queryVec}::vector) AS score
    FROM memory.memories
    WHERE project_id = ${projectId}
      AND embedding IS NOT NULL
      AND (expires_at IS NULL OR expires_at > now())
      ${params.type ? sql`AND type = ${params.type}` : sql``}
      ${params.agent_id ? sql`AND agent_id = ${params.agent_id}` : sql``}
      ${params.identity_id ? sql`AND identity_id = ${params.identity_id}` : sql``}
    ORDER BY embedding <=> ${queryVec}::vector
    LIMIT ${limit * 4}
  `);

  // Rerank: raw cosine × importance × recency_decay (halves every 30d).
  const now = Date.now();
  const ranked: MemorySearchResult[] = [];
  for (const r of rawRows) {
    if (r.score < minScore) continue;
    const ageDays = (now - new Date(r.created_at).getTime()) / 86_400_000;
    const recency = 0.5 ** (ageDays / 30);
    const finalScore = r.score * r.importance * (0.5 + 0.5 * recency);

    ranked.push({
      id: r.id,
      type: r.type,
      tier: r.tier,
      visibility: r.visibility,
      key: r.key,
      content: r.content,
      agent_id: r.agent_id,
      identity_id: r.identity_id,
      metadata: r.metadata ?? {},
      importance: r.importance,
      has_embedding: r.has_embedding,
      created_at: new Date(r.created_at).toISOString(),
      accessed_at: r.accessed_at ? new Date(r.accessed_at).toISOString() : null,
      expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      score: Math.round(finalScore * 10000) / 10000,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}

export async function deleteById(
  projectId: string,
  memoryId: string,
): Promise<{ deleted: number }> {
  const result = await db
    .delete(memories)
    .where(and(eq(memories.id, memoryId), eq(memories.projectId, projectId)))
    .returning({ id: memories.id });
  return { deleted: result.length };
}

export async function deleteByKey(
  projectId: string,
  key: string,
): Promise<{ deleted: number }> {
  const result = await db
    .delete(memories)
    .where(and(eq(memories.projectId, projectId), eq(memories.key, key)))
    .returning({ id: memories.id });
  return { deleted: result.length };
}

export async function countMemories(projectId: string): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM memory.memories
    WHERE project_id = ${projectId}
      AND (expires_at IS NULL OR expires_at > now())
  `);
  return rows[0]?.count ?? 0;
}

export { asc }; // re-export for convenience in routes
