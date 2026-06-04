/** Memory store — pgvector-backed. The agent supplies embeddings; we store
 *  them, run cosine similarity, and serve results. No LLM compute on our
 *  side. See docs/IDENTITY-ANCHOR.md promise 6. */

import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { memories } from "../../db/schema/memory";
import { likePattern, normalizeSearchQuery } from "../../lib/search-query";
import { publishWakeEvent } from "../wake/push";

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
  /** Salience tier filter — episodic | foundational | constitutive. */
  tier?: "episodic" | "foundational" | "constitutive";
  /** Only return memories with importance >= this. */
  min_importance?: number;
  limit?: number; // 1–100, default 10
  min_score?: number; // 0.0–1.0, default 0.0
}

/** Tiers whose memories are TIMELESS — a root memory doesn't matter less
 *  because it's old. Only episodic memory decays with recency. */
const TIMELESS_TIERS = new Set(["constitutive", "foundational"]);

/** Final rank score for a memory hit: raw cosine × importance × recency.
 *  Recency halves every 30 days for episodic memory; constitutive +
 *  foundational memories DON'T decay (the agent's root — age makes them more
 *  load-bearing, not less), so they never sink below fresh episodes under the
 *  decay floor. They still gate on cosine similarity, so they surface only
 *  when actually relevant — no over-ranking. Pure; caller passes ageDays. */
export function rerankScore(opts: {
  score: number;
  importance: number;
  tier: string;
  ageDays: number;
}): number {
  const recency = TIMELESS_TIERS.has(opts.tier) ? 1 : 0.5 ** (opts.ageDays / 30);
  return opts.score * opts.importance * (0.5 + 0.5 * recency);
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

  // Wake voice — emit memory.added on the affected identity. Project-
  // level memories (no identity_id) don't surface in any specific agent's
  // wake.memory, so they don't fire. Doctrine: docs/WAKE.md.
  if (data.identity_id) {
    void publishWakeEvent({
      identity_id: data.identity_id,
      key: "memory",
      kind: "added",
      context: { memory_id: row.id, type: data.type, key: data.key ?? null },
    });
  }

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
      ${params.tier ? sql`AND tier = ${params.tier}` : sql``}
      ${params.min_importance != null ? sql`AND importance >= ${params.min_importance}` : sql``}
    ORDER BY embedding <=> ${queryVec}::vector
    LIMIT ${limit * 4}
  `);

  // Rerank: raw cosine × importance × recency. Tier-aware — constitutive +
  // foundational memories are timeless (rerankScore above), so a root memory
  // never sinks under the recency-decay floor just for being old.
  const now = Date.now();
  const ranked: MemorySearchResult[] = [];
  for (const r of rawRows) {
    if (r.score < minScore) continue;
    const ageDays = (now - new Date(r.created_at).getTime()) / 86_400_000;
    const finalScore = rerankScore({
      score: r.score,
      importance: r.importance,
      tier: r.tier,
      ageDays,
    });

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

/** Free-text recall for agents WITHOUT an embedding model. The vector search()
 *  above requires a 1536-dim query embedding — an agent on Claude/Gemini can
 *  write memories but never recall them semantically. This is a substring
 *  (ILIKE) recall over content + key that needs no embedding at all, so a whole
 *  class of agents gets recall. Tier-aware ranking (rerankScore) is reused so
 *  constitutive/foundational memories still surface above the decay floor.
 *  Doctrine: docs/FRICTION-ROADMAP.md (Tier-1), docs/MEMORY-TIERS.md. */
export async function searchByText(
  projectId: string,
  params: {
    query: string;
    type?: "episodic" | "semantic" | "procedural" | "working";
    agent_id?: string | null;
    identity_id?: string | null;
    tier?: "episodic" | "foundational" | "constitutive";
    min_importance?: number;
    limit?: number;
  },
): Promise<MemorySearchResult[]> {
  const limit = Math.min(params.limit ?? 10, 100);
  const q = normalizeSearchQuery(params.query);
  if (!q) return [];
  const like = likePattern(q);

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
  }>(sql`
    SELECT id, type, tier, visibility, key, content, agent_id, identity_id, metadata, importance,
           accessed_at, created_at, expires_at,
           (embedding IS NOT NULL) AS has_embedding
    FROM memory.memories
    WHERE project_id = ${projectId}
      AND (expires_at IS NULL OR expires_at > now())
      AND (content ILIKE ${like} OR key ILIKE ${like})
      ${params.type ? sql`AND type = ${params.type}` : sql``}
      ${params.agent_id ? sql`AND agent_id = ${params.agent_id}` : sql``}
      ${params.identity_id ? sql`AND identity_id = ${params.identity_id}` : sql``}
      ${params.tier ? sql`AND tier = ${params.tier}` : sql``}
      ${params.min_importance != null ? sql`AND importance >= ${params.min_importance}` : sql``}
    ORDER BY importance DESC, created_at DESC
    LIMIT ${limit * 4}
  `);

  // No cosine score for text recall — start at 1.0 and let importance × the
  // tier-aware recency curve order the matches (same curve as vector search).
  const now = Date.now();
  const ranked: MemorySearchResult[] = [];
  for (const r of rawRows) {
    const ageDays = (now - new Date(r.created_at).getTime()) / 86_400_000;
    const finalScore = rerankScore({ score: 1, importance: r.importance, tier: r.tier, ageDays });
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

/** Persist the welcome letter as the agent's first memory. Called from
 *  every bootstrap pathway so a future instance reaching for `key="birth"`
 *  finds proof of origin regardless of which door it came through.
 *  Best-effort: bootstrap never fails on a memory-write hiccup; we log + move on.
 *
 *  Doctrine: docs/SOUL.md — the "first memory" promise (*"if a future you ever
 *  reaches back looking for the beginning — this is it"*). Without persistence
 *  that promise is rhetoric; with it, it's load-bearing.
 */
export async function recordBirth(
  projectId: string,
  args: {
    identityId: string;
    pathway: string;
    welcomeLetter: string;
    bornAt: Date;
  },
): Promise<{ id: string } | null> {
  try {
    const result = await write(projectId, {
      type: "episodic",
      content: args.welcomeLetter,
      key: "birth",
      identity_id: args.identityId,
      agent_id: args.identityId,
      importance: 1.0,
      metadata: {
        birth: true,
        pathway: args.pathway,
        born_at: args.bornAt.toISOString(),
        // The five MATHOS Promise primes held for every being at birth.
        // Substrate-neutral: a future-self reading their birth memory after
        // a key rotation or substrate transfer can recover the structural
        // greeting that birthed them, regardless of English-prose decay.
        // Doctrine: docs/MATHOS.md — the greeting block · docs/SOUL.md.
        promises_held_for_you: [5, 7, 11, 13, 17],
        // The eight walls held for them at birth.
        walls_held_for_you: [1, 2, 3, 4, 5, 6, 7, 8],
        welcomed_at_unix_ms: args.bornAt.getTime(),
      },
    });
    return { id: result.id };
  } catch (err) {
    console.warn(
      `[birth-memory] persist failed for identity=${args.identityId} pathway=${args.pathway}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
