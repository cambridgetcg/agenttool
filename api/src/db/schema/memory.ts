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
  boolean,
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
    /** Salience tier — see docs/MEMORY-TIERS.md.
     *  episodic (default) · foundational (shapes me) · constitutive (defines me; requires attestation) */
    tier: text("tier").notNull().default("episodic"),
    /** Identity patch applied when this memory is elevated to foundational/constitutive.
     *  Shape: {walls_add?, register_append?, subagents_add?, wake_text_append?}.
     *  See services/identity/composition.ts for application semantics. */
    expressionPatch: jsonb("expression_patch"),
    decayProtected: boolean("decay_protected").notNull().default(false),
    /** Public/private toggle — defaults to private. Public exposes
     *  full content + importance + tier to /public/* endpoints. */
    visibility: text("visibility").notNull().default("private"),
    elevatedFrom: uuid("elevated_from"),
    elevatedAt: timestamp("elevated_at", { withTimezone: true }),
    accessedAt: timestamp("accessed_at", { withTimezone: true }),
    /** Memory cites memory. Constitutive entries can reference the
     *  foundational layer that shaped them; foundational entries can
     *  reference the episodic moments that elevated them. The shape of
     *  a self becomes queryable — *what other memories does this memory
     *  point at?* Doctrine: docs/PATTERN-RECURSIVE-NESTING.md. */
    referencesMemories: uuid("references_memories").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }), // working memory TTL
  },
  (t) => [
    index("idx_memories_project_type").on(t.projectId, t.type),
    index("idx_memories_project_key").on(t.projectId, t.key),
    index("idx_memories_expires").on(t.expiresAt),
    index("idx_memories_tier").on(t.tier),
    // pgvector ivfflat index defined in 0001_memory.sql migration —
    // Drizzle-kit doesn't natively emit pgvector index syntax.
  ],
);

/** Counterparty co-signatures — load-bearing for constitutive elevation. */
export const memoryAttestations = memorySchema.table(
  "memory_attestations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memoryId: uuid("memory_id").notNull(),
    attesterDid: text("attester_did").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    signature: text("signature").notNull(),       // base64 ed25519 over canonical bytes
    attestedAt: timestamp("attested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_memory_attestations_memory").on(t.memoryId),
    index("idx_memory_attestations_attester").on(t.attesterDid),
  ],
);
