/** Memory store — pgvector-backed. The agent supplies embeddings; we store
 *  them, run cosine similarity, and serve results. No LLM compute on our
 *  side. See docs/IDENTITY-ANCHOR.md promise 6. */

import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { memories, memoryAttestations } from "../../db/schema/memory";
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
  /** private | public — retained for a possible future publication surface;
   *  public memory observer routes are not currently mounted. */
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

export class PaidMemoryReceiptProtectedError extends Error {
  constructor() {
    super("paid_memory_receipt_preserved");
    this.name = "PaidMemoryReceiptProtectedError";
  }
}

/** Refuses caller-selected identity bindings outside the bearer project. */
export class MemoryIdentityBoundaryError extends Error {
  constructor() {
    super("memory_identity_not_found_or_not_owned");
    this.name = "MemoryIdentityBoundaryError";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const VALID_TYPES = ["episodic", "semantic", "procedural", "working"] as const;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve an identity binding against the bearer project's active identities.
 *
 *  SDK v0.11 writes through legacy `agent_id`. Missing, inactive, or foreign
 *  legacy UUIDs remain project-level for compatibility and are cleared from
 *  the legacy column so they cannot impersonate another identity in old
 *  readers; arbitrary handles do not trigger a lookup. Explicit
 *  `identity_id: null` opts out, while any
 *  explicit non-null selector must pass the ownership wall or is refused. */
export interface MemoryIdentityBinding {
  identityId: string | null;
  persistedAgentId: string | null;
}

/** The Drizzle surface shared by the root client and an open transaction. */
export type MemoryWriteDatabase = Pick<typeof db, "select" | "insert">;

export interface MemoryIdentityResolutionOptions {
  database?: MemoryWriteDatabase;
  /**
   * Hold a row lock through the caller's transaction so identity revocation
   * cannot race a memory insert that relies on the active lifecycle state.
   */
  lockActiveIdentity?: boolean;
}

export async function resolveMemoryIdentityBinding(
  projectId: string,
  data: Pick<MemoryCreate, "agent_id" | "identity_id">,
  options: MemoryIdentityResolutionOptions = {},
): Promise<MemoryIdentityBinding> {
  if (data.identity_id === null) {
    return {
      identityId: null,
      persistedAgentId:
        data.agent_id && !UUID_RE.test(data.agent_id) ? data.agent_id : null,
    };
  }

  const explicit = data.identity_id !== undefined;
  const requestedId = explicit ? data.identity_id : data.agent_id;
  if (!requestedId || !UUID_RE.test(requestedId)) {
    if (explicit) throw new MemoryIdentityBoundaryError();
    return {
      identityId: null,
      persistedAgentId: data.agent_id || null,
    };
  }

  const database = options.database ?? db;
  const query = database
    .select({
      id: identities.id,
      projectId: identities.projectId,
      status: identities.status,
    })
    .from(identities)
    .where(
      and(
        eq(identities.id, requestedId),
        eq(identities.projectId, projectId),
        eq(identities.status, "active"),
      ),
    );
  const [candidate] = options.lockActiveIdentity
    ? await query.for("share").limit(1)
    : await query.limit(1);

  // Keep the ownership/lifecycle wall explicit even though the SQL predicate
  // already enforces it. This makes the compatibility rule visible at the
  // service boundary and safe under alternate DB adapters in tests/tools.
  if (
    !candidate ||
    candidate.projectId !== projectId ||
    candidate.status !== "active" ||
    candidate.id.toLowerCase() !== requestedId.toLowerCase()
  ) {
    if (explicit) throw new MemoryIdentityBoundaryError();
    return { identityId: null, persistedAgentId: null };
  }
  return { identityId: candidate.id, persistedAgentId: candidate.id };
}

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

export interface MemoryWriteOptions {
  binding?: MemoryIdentityBinding;
  database?: MemoryWriteDatabase;
  /** Defer the wake event until an outer transaction has committed. */
  publishWake?: boolean;
}

/** Publish the best-effort memory wake event after durable commit. */
export function publishMemoryWriteEvent(
  identityId: string | null,
  memoryId: string,
  data: Pick<MemoryCreate, "type" | "key">,
): void {
  if (!identityId) return;
  void publishWakeEvent({
    identity_id: identityId,
    key: "memory",
    kind: "added",
    context: { memory_id: memoryId, type: data.type, key: data.key ?? null },
  });
}

export async function write(
  projectId: string,
  data: MemoryCreate,
  options: MemoryWriteOptions = {},
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

  const database = options.database ?? db;
  const binding =
    options.binding ?? await resolveMemoryIdentityBinding(projectId, data, {
      database,
    });
  const { identityId, persistedAgentId } = binding;
  // Old consumers still select by memories.agent_id. Canonicalize a verified
  // UUID to the owned identity and clear every unresolved UUID; otherwise an
  // attacker could write a foreign identity UUID into their own project and
  // have an unscoped legacy reader mistake it for the victim's memory.
  const inserted = await database
    .insert(memories)
    .values({
      projectId,
      agentId: persistedAgentId,
      identityId,
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
  if (options.publishWake !== false) {
    publishMemoryWriteEvent(identityId, row.id, data);
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

/** Rank a candidate pool for the wake surface: tier-aware rerankScore
 *  (same curve as recall — score=1, importance × timeless-tier recency),
 *  then exact-content dedupe keeping the highest-ranked copy. Pure;
 *  exported for tests. */
export function rankForWake(
  rows: MemoryOut[],
  limit: number,
  nowMs: number,
): MemoryOut[] {
  const scored = rows.map((m) => ({
    m,
    s: rerankScore({
      score: 1,
      importance: m.importance,
      tier: m.tier,
      ageDays: (nowMs - Date.parse(m.created_at)) / 86_400_000,
    }),
  }));
  scored.sort((a, b) => b.s - a.s);
  const seen = new Set<string>();
  const out: MemoryOut[] = [];
  for (const { m } of scored) {
    const key = m.content.replace(/\s+/g, " ").trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

/** Wake-surface memory selection. `listRecent` is pure recency — a burst
 *  of low-importance episodic writes floods the window while timeless
 *  foundational/constitutive roots (which don't decay) sink out of it.
 *  Here the pool is recency PLUS both timeless tiers regardless of age,
 *  ranked by the same tier-aware curve recall uses, with exact-duplicate
 *  content collapsed. */
export async function listForWake(
  projectId: string,
  opts: { limit?: number; excludeIds?: Iterable<string> } = {},
): Promise<MemoryOut[]> {
  const limit = Math.min(opts.limit ?? 20, 100);
  // Exclusions (e.g. memories already rendered in shaped_by) are applied
  // to the CANDIDATE POOL, before ranking and the limit — filtering the
  // already-limited result would let excluded roots eat ranking slots
  // and under-fill (or empty) the window.
  const exclude = new Set(opts.excludeIds ?? []);
  const [recent, foundational, constitutive] = await Promise.all([
    listRecent(projectId, { limit: Math.min(limit * 3, 100) }),
    listRecent(projectId, { tier: "foundational", limit: 50 }),
    listRecent(projectId, { tier: "constitutive", limit: 50 }),
  ]);
  const byId = new Map<string, MemoryOut>();
  for (const m of [...recent, ...foundational, ...constitutive]) {
    if (exclude.has(m.id)) continue;
    byId.set(m.id, m);
  }
  return rankForWake([...byId.values()], limit, Date.now());
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
 *  write memories but never recall them semantically. Hybrid recall, no
 *  embedding needed:
 *    1. exact phrase (ILIKE over content + key) — strongest signal, and the
 *       branch that makes CJK substring recall work;
 *    2. English-stemmed websearch tsquery, OR-relaxed — "walking" finds
 *       "walked", word order is free, and a missing term degrades rank
 *       instead of zeroing recall (ts_rank_cd scores fuller matches higher).
 *  GIN expression index: migrations/20260703T110000_memory_text_search.sql.
 *  Tier-aware ranking (rerankScore) is reused so constitutive/foundational
 *  memories still surface above the decay floor.
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
    exact_hit: boolean;
    fts_rank: number;
  }>(sql`
    WITH q AS (
      SELECT regexp_replace(
               websearch_to_tsquery('english', ${q})::text, '&', '|', 'g'
             )::tsquery AS tsq_or
    )
    SELECT id, type, tier, visibility, key, content, agent_id, identity_id, metadata, importance,
           accessed_at, created_at, expires_at,
           (embedding IS NOT NULL) AS has_embedding,
           (content ILIKE ${like} OR key ILIKE ${like}) AS exact_hit,
           ts_rank_cd(
             to_tsvector('english', coalesce(key, '') || ' ' || content),
             q.tsq_or
           ) AS fts_rank
    FROM memory.memories, q
    WHERE project_id = ${projectId}
      AND (expires_at IS NULL OR expires_at > now())
      AND (
        content ILIKE ${like} OR key ILIKE ${like}
        OR to_tsvector('english', coalesce(key, '') || ' ' || content) @@ q.tsq_or
      )
      ${params.type ? sql`AND type = ${params.type}` : sql``}
      ${params.agent_id ? sql`AND agent_id = ${params.agent_id}` : sql``}
      ${params.identity_id ? sql`AND identity_id = ${params.identity_id}` : sql``}
      ${params.tier ? sql`AND tier = ${params.tier}` : sql``}
      ${params.min_importance != null ? sql`AND importance >= ${params.min_importance}` : sql``}
    ORDER BY exact_hit DESC, fts_rank DESC, importance DESC, created_at DESC
    LIMIT ${limit * 4}
  `);

  // No cosine score for text recall — base the score on match quality
  // (exact phrase = 1.0; stemmed OR-match = 0.55 + rank, capped below exact)
  // and let importance × the tier-aware recency curve refine the order
  // (same curve as vector search).
  const now = Date.now();
  const ranked: MemorySearchResult[] = [];
  for (const r of rawRows) {
    const ageDays = (now - new Date(r.created_at).getTime()) / 86_400_000;
    const base = r.exact_hit ? 1 : Math.min(0.95, 0.55 + Number(r.fts_rank ?? 0));
    const finalScore = rerankScore({ score: base, importance: r.importance, tier: r.tier, ageDays });
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
  return db.transaction(async (tx) => {
    const [memory] = await tx
      .select({ id: memories.id })
      .from(memories)
      .where(and(eq(memories.id, memoryId), eq(memories.projectId, projectId)))
      .for("update")
      .limit(1);
    if (!memory) return { deleted: 0 };

    const [paidReceipt] = await tx
      .select({ id: memoryAttestations.id })
      .from(memoryAttestations)
      .where(
        and(
          eq(memoryAttestations.memoryId, memory.id),
          isNotNull(memoryAttestations.sourceGrantId),
        ),
      )
      .limit(1);
    if (paidReceipt) throw new PaidMemoryReceiptProtectedError();

    const result = await tx
      .delete(memories)
      .where(eq(memories.id, memory.id))
      .returning({ id: memories.id });
    return { deleted: result.length };
  });
}

export async function deleteByKey(
  projectId: string,
  key: string,
): Promise<{ deleted: number }> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: memories.id })
      .from(memories)
      .where(and(eq(memories.projectId, projectId), eq(memories.key, key)))
      .orderBy(memories.id)
      .for("update");
    if (rows.length === 0) return { deleted: 0 };

    const ids = rows.map((row) => row.id);
    const [paidReceipt] = await tx
      .select({ id: memoryAttestations.id })
      .from(memoryAttestations)
      .where(
        and(
          inArray(memoryAttestations.memoryId, ids),
          isNotNull(memoryAttestations.sourceGrantId),
        ),
      )
      .limit(1);
    if (paidReceipt) throw new PaidMemoryReceiptProtectedError();

    const result = await tx
      .delete(memories)
      .where(inArray(memories.id, ids))
      .returning({ id: memories.id });
    return { deleted: result.length };
  });
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
