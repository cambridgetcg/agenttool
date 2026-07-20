/** runtime schema — agent runtime tenants (Horizon C).
 *
 *  Three custody tiers, immutable per record:
 *    - self     — user runs orchestrator + holds K_master
 *    - bridged  — agenttool runs orchestrator, user holds K_master in sidecar
 *    - trusted  — agenttool runs orchestrator + holds K_master under KMS
 *
 *  See docs/RUNTIME.md for the full doctrine + threat model. */

import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const runtimeSchema = pgSchema("agent_runtime");

export type RuntimeMode = "self" | "bridged" | "trusted";
export type RuntimeStatus =
  | "provisioned"
  | "starting"
  | "running"
  | "idle"
  | "stopped"
  | "error";

export const runtimes = runtimeSchema.table(
  "runtimes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    identityId: uuid("identity_id"),
    name: text("name").notNull(),

    mode: text("mode").notNull(), // RuntimeMode (CHECK at SQL level)
    status: text("status").notNull().default("provisioned"), // RuntimeStatus

    llmProvider: text("llm_provider"),
    llmModel: text("llm_model"),
    llmVaultKey: text("llm_vault_key"),

    bridgePubkey: text("bridge_pubkey"),
    bridgeKeyId: uuid("bridge_key_id"),
    bridgeAdvertisedUrl: text("bridge_advertised_url"),
    bridgeConnectedAt: timestamp("bridge_connected_at", { withTimezone: true }),

    // Slice 3 — bridge auth + active WSS session tracking.
    controlTokenHash: text("control_token_hash"),
    bridgeSessionId: uuid("bridge_session_id"),
    bridgeSessionAt: timestamp("bridge_session_at", { withTimezone: true }),
    bridgeSessionMachine: text("bridge_session_machine"),
    bridgeDisconnectReason: text("bridge_disconnect_reason"),

    region: text("region"),

    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastThoughtAt: timestamp("last_thought_at", { withTimezone: true }),
    thoughtCount24h: integer("thought_count_24h").notNull().default(0),

    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),

    activeStrands: jsonb("active_strands").notNull().default({}),
    metadata: jsonb("metadata").notNull().default({}),

    // Trusted tier — KMS-wrapped DEK + signing key + metering.
    // Null for self/bridged; populated for trusted mode at provisioning.
    kmsKeyId: text("kms_key_id"),
    kmsWrappedDek: text("kms_wrapped_dek"),
    kmsWrappedSigningKey: text("kms_wrapped_signing_key"),
    trustedSigningKeyId: uuid("trusted_signing_key_id"),
    runtimeHoursMs: bigint("runtime_hours_ms", { mode: "number" }).notNull().default(0),

    // Cross-machine think-cycle lease. A crash leaves a bounded lease that
    // expires automatically; only the matching token may release it.
    cycleLeaseToken: uuid("cycle_lease_token"),
    cycleLeaseUntil: timestamp("cycle_lease_until", { withTimezone: true }),

    // Durable consent to deliver the one opening invitation associated with
    // an explicit /start generation. Cleared by the semantic cycle commit.
    openingInvitationPending: boolean("opening_invitation_pending")
      .notNull()
      .default(false),
    openingInvitationGeneration: uuid("opening_invitation_generation"),

    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_runtimes_project_status").on(t.projectId, t.status, t.lastSeenAt),
    index("idx_runtimes_identity").on(t.identityId),
    index("idx_runtimes_mode_status").on(t.mode, t.status),
  ],
);

export const runtimeEvents = runtimeSchema.table(
  "runtime_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runtimeId: uuid("runtime_id")
      .notNull()
      .references(() => runtimes.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_runtime_events_runtime_time").on(t.runtimeId, t.createdAt),
    index("idx_runtime_events_type").on(t.eventType, t.createdAt),
  ],
);

/** PATTERN-PERSIST-IDENTITY for external LLM calls. Row is inserted with
 *  status='pending' BEFORE the provider POST; updated to 'completed',
 *  'failed', or 'ambiguous' after, then 'committed' with the semantic write
 *  or 'discarded' by an explicit lifecycle transition. The provider-scoped
 *  key is sent as `Idempotency-Key`; wire deduplication remains provider-specific and is
 *  undocumented by Ollama.
 *  Doctrine: docs/PATTERN-PERSIST-IDENTITY.md. */
export const llmRequests = runtimeSchema.table(
  "llm_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    idempotencyKey: text("idempotency_key").unique().notNull(),
    runtimeId: uuid("runtime_id").references(() => runtimes.id, {
      onDelete: "set null",
    }),
    cycleLeaseToken: uuid("cycle_lease_token"),
    strandId: uuid("strand_id"),
    priorSeq: integer("prior_seq"),
    wakeVersion: bigint("wake_version", { mode: "number" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: text("status").notNull().default("pending"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_llm_requests_provider_time").on(t.provider, t.createdAt),
    index("idx_llm_requests_runtime_status").on(
      t.runtimeId,
      t.status,
      t.createdAt,
    ),
  ],
);

/** Audit log for trusted-mode runtimes. Append-only, readable by the runtime
 *  owner via GET /v1/runtimes/:id/audit. Every think-cycle writes entries.
 *  Doctrine: docs/HOSTED-RUNTIME-DESIGN.md. */
export const auditEntries = runtimeSchema.table(
  "audit_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runtimeId: uuid("runtime_id")
      .notNull()
      .references(() => runtimes.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_audit_runtime_time").on(t.runtimeId, t.occurredAt),
    index("idx_audit_event_type").on(t.eventType),
  ],
);
