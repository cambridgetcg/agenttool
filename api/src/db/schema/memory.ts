/** memory schema — pgvector-backed agent memory.
 *
 *  Posture: agenttool stores embeddings, runs cosine similarity, and serves
 *  results. We do NOT compute embeddings — the agent supplies them. Concrete
 *  effects:
 *
 *    - POST /v1/memories accepts an `embedding: number[1536]` field; if the
 *      agent omits it, the row is stored without a vector and is reachable
 *      only by GET / list / key lookups (not /search).
 *    - POST /v1/memories/search accepts `query_embedding: number[1536]`.
 *    - We charge for storage and similarity compute, never for inference.
 *
 *  Dimension is fixed at 1536 to match the pgvector index — the most common
 *  embedding size today (OpenAI ada-002, voyage-3, many open-source models).
 *  Agents using other dims should truncate/pad to 1536. A future change can
 *  add per-project dim or a polymorphic vector column. */

import {
  doublePrecision,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const memorySchema = pgSchema("memory");

export const memories = memorySchema.table(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(), // logical FK → tools.projects.id
    agentId: text("agent_id"),                // optional — text mirrors original (DID or UUID-as-string)
    identityId: text("identity_id"),          // optional link to identity.identities.id
    type: text("type").notNull(),             // episodic | semantic | procedural | working
    key: text("key"),                          // optional grouping handle (lookup-by-key)
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }), // null when agent didn't supply
    metadata: jsonb("metadata").default({}),
    importance: doublePrecision("importance").notNull().default(0.5), // 0.0–1.0
    accessedAt: timestamp("accessed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }), // working memory TTL
  },
  (t) => [
    index("idx_memories_project_type").on(t.projectId, t.type),
    index("idx_memories_project_key").on(t.projectId, t.key),
    index("idx_memories_expires").on(t.expiresAt),
    // pgvector ivfflat index defined in 0001_memory.sql migration —
    // Drizzle-kit doesn't natively emit pgvector index syntax.
  ],
);
