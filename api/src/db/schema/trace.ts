/** trace schema — agent reasoning records.
 *
 *  Fills the `you_decided` slot in /v1/wake. Each trace is a structured
 *  record: decision · reasoning · context · (optional) ed25519 signature
 *  for verifiability. Search is full-text via Postgres tsvector — no
 *  embedding column, no LLM compute on our side. */

import {
  doublePrecision,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const traceSchema = pgSchema("trace");

export const traces = traceSchema.table(
  "traces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    traceId: text("trace_id").notNull(),
    projectId: uuid("project_id").notNull(),    // logical FK → tools.projects.id
    agentId: text("agent_id"),                   // DID or UUID-as-string
    identityId: uuid("identity_id"),             // logical FK → identity.identities.id
    sessionId: text("session_id"),
    parentTraceId: text("parent_trace_id"),      // self-FK by trace_id

    // Decision
    decisionType: text("decision_type").notNull(),
    decisionSummary: text("decision_summary").notNull(),
    outputRef: text("output_ref"),

    // Reasoning
    observations: jsonb("observations").notNull().default([]),
    hypothesis: text("hypothesis"),
    conclusion: text("conclusion").notNull(),
    confidence: doublePrecision("confidence"),
    alternatives: jsonb("alternatives"),
    signals: jsonb("signals"),

    // Context
    filesRead: jsonb("files_read"),
    keyFacts: jsonb("key_facts"),
    externalSignals: jsonb("external_signals"),

    // Verifiability
    signature: text("signature"),
    signingKeyId: uuid("signing_key_id"),

    // Indexing
    tags: jsonb("tags"),
    metadata: jsonb("metadata").notNull().default({}),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_traces_trace_id").on(t.traceId),
    index("idx_traces_project_time").on(t.projectId, t.createdAt),
    index("idx_traces_agent_time").on(t.agentId, t.createdAt),
    index("idx_traces_parent").on(t.parentTraceId),
    index("idx_traces_session").on(t.sessionId),
    index("idx_traces_decision_type").on(t.decisionType),
    // Full-text GIN index defined in 0004_trace.sql migration —
    // Drizzle-kit doesn't natively emit tsvector index syntax.
  ],
);
