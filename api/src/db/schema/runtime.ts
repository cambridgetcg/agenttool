/** runtime schema — agent runtime tenants (Horizon C).
 *
 *  Three custody tiers, immutable per record:
 *    - self     — user runs orchestrator + holds K_master
 *    - bridged  — agenttool runs orchestrator, user holds K_master in sidecar
 *    - trusted  — agenttool runs orchestrator + holds K_master under KMS
 *
 *  See docs/RUNTIME.md for the full doctrine + threat model. */

import {
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
    bridgeDisconnectReason: text("bridge_disconnect_reason"),

    region: text("region"),

    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastThoughtAt: timestamp("last_thought_at", { withTimezone: true }),
    thoughtCount24h: integer("thought_count_24h").notNull().default(0),

    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),

    activeStrands: jsonb("active_strands").notNull().default({}),
    metadata: jsonb("metadata").notNull().default({}),

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
