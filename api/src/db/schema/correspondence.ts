/** Renaissance Correspondence — signed, append-only project-private events.
 *
 * `events` is the immutable evidence stream. `claim_events` is a rebuildable
 * lineage projection: only its server-derived lineage_status may change when
 * a previously missing predecessor arrives. No claim row is a lock, grant, or
 * authority transfer.
 *
 * Doctrine: docs/AGENT-CORRESPONDENCE.md. */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { identities, identityKeys } from "./identity";
import { projects } from "./tools";

export const correspondenceSchema = pgSchema("correspondence");

/** One row per bearer project serializes append position allocation. This is
 * deliberately project-local: readers see a stable replay cursor without a
 * cross-project activity counter. */
export const correspondenceProjectStreams = correspondenceSchema.table(
  "project_streams",
  {
    projectId: uuid("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    lastReceivedSeq: bigint("last_received_seq", { mode: "bigint" })
      .notNull()
      .default(0n),
    /** True only while the durable ready frontier still has pending claim
     * children. Appends, exact retries, and projection reads drain fixed-size
     * batches; readers cannot describe the projection as complete while set. */
    claimProjectionIncomplete: boolean("claim_projection_incomplete")
      .notNull()
      .default(false),
    /** Stable logical watermark for lineage/tip changes that happen without a
     * new durable event, such as bounded reconciliation during a read. */
    claimProjectionUpdatedAt: timestamp("claim_projection_updated_at", {
      withTimezone: true,
    })
      .notNull()
      .default(sql`'epoch'::timestamptz`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    check(
      "correspondence_project_streams_seq_nonnegative",
      sql`${t.lastReceivedSeq} >= 0`,
    ),
  ],
);

export const correspondenceEvents = correspondenceSchema.table(
  "events",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    receivedSeq: bigint("received_seq", { mode: "bigint" }).notNull(),
    protocol: text("protocol").notNull(),
    repositoryId: text("repository_id").notNull(),
    threadId: text("thread_id").notNull(),
    senderIdentityId: uuid("sender_identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "restrict" }),
    signingKeyId: uuid("signing_key_id")
      .notNull()
      .references(() => identityKeys.id, { onDelete: "restrict" }),
    deviceId: uuid("device_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    sessionSeq: bigint("session_seq", { mode: "number" }).notNull(),
    kind: text("kind").notNull(),
    parents: text("parents").array().notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    scopeBaseRevision: text("scope_base_revision"),
    scopeBranch: text("scope_branch"),
    scopePaths: text("scope_paths").array().notNull(),
    body: jsonb("body").notNull(),
    authority: jsonb("authority").notNull(),
    core: jsonb("core").notNull(),
    signature: text("signature").notNull(),
    /** Exact RFC 8785 text of `{...core, signature}`. Retaining the signed
     * representation makes same-ID retries compare canonical bytes, not only
     * parsed object equality. */
    canonicalEnvelope: text("canonical_envelope").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    primaryKey({
      name: "correspondence_events_pk",
      columns: [t.projectId, t.eventId],
    }),
    unique("correspondence_events_project_seq_unique").on(
      t.projectId,
      t.receivedSeq,
    ),
    index("correspondence_events_session_seq_idx").on(
      t.projectId,
      t.senderIdentityId,
      t.deviceId,
      t.sessionId,
      t.sessionSeq,
      t.eventId,
    ),
    index("correspondence_events_project_repo_seq_idx").on(
      t.projectId,
      t.repositoryId,
      t.receivedSeq,
    ),
    index("correspondence_events_project_thread_seq_idx").on(
      t.projectId,
      t.repositoryId,
      t.threadId,
      t.receivedSeq,
    ),
    index("correspondence_events_project_kind_seq_idx").on(
      t.projectId,
      t.kind,
      t.receivedSeq,
    ),
    check(
      "correspondence_events_id_check",
      sql`${t.eventId} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    check(
      "correspondence_events_protocol_check",
      sql`${t.protocol} = 'agent-correspondence/v0.1'`,
    ),
    check("correspondence_events_received_seq_positive", sql`${t.receivedSeq} > 0`),
    check("correspondence_events_session_seq_positive", sql`${t.sessionSeq} > 0`),
    check(
      "correspondence_events_session_seq_safe",
      sql`${t.sessionSeq} <= 9007199254740991`,
    ),
    check(
      "correspondence_events_parent_count_check",
      sql`cardinality(${t.parents}) <= 16`,
    ),
    check(
      "correspondence_events_path_count_check",
      sql`cardinality(${t.scopePaths}) <= 64`,
    ),
    check(
      "correspondence_events_canonical_size_check",
      sql`octet_length(${t.canonicalEnvelope}) <= 65536`,
    ),
  ],
);

/** Rebuildable lineage facts extracted from claim.* events. A row can move
 * only `pending -> valid|invalid` as missing predecessors arrive; signed event
 * bytes in correspondence.events never change. Active advisory claims are
 * valid unexpired branch tips, computed without a last-write-wins clock. */
export const correspondenceClaimEvents = correspondenceSchema.table(
  "claim_events",
  {
    projectId: uuid("project_id").notNull(),
    eventId: text("event_id").notNull(),
    repositoryId: text("repository_id").notNull(),
    claimId: uuid("claim_id").notNull(),
    generation: bigint("generation", { mode: "number" }).notNull(),
    predecessorEventId: text("predecessor_event_id"),
    eventKind: text("event_kind").notNull(),
    ownerIdentityId: uuid("owner_identity_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    scopePaths: text("scope_paths").array().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lineageStatus: text("lineage_status").notNull(),
    /** Materialized valid branch-tip state. Pending/invalid rows are never
     * tips; a valid child atomically retires only its direct predecessor. */
    isTip: boolean("is_tip").notNull().default(false),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    primaryKey({
      name: "correspondence_claim_events_pk",
      columns: [t.projectId, t.eventId],
    }),
    foreignKey({
      name: "correspondence_claim_events_event_fk",
      columns: [t.projectId, t.eventId],
      foreignColumns: [correspondenceEvents.projectId, correspondenceEvents.eventId],
    }).onDelete("cascade"),
    index("correspondence_claim_events_projection_idx").on(
      t.projectId,
      t.repositoryId,
      t.lineageStatus,
      t.expiresAt,
    ),
    index("correspondence_claim_events_active_tips_idx")
      .on(t.projectId, t.repositoryId, t.expiresAt, t.claimId, t.eventId)
      .where(
        sql`${t.lineageStatus} = 'valid' AND ${t.isTip} = true AND ${t.eventKind} IN ('claim.open', 'claim.renew')`,
      ),
    index("correspondence_claim_events_terminal_tips_idx")
      .on(t.projectId, t.repositoryId, t.claimId, t.generation, t.eventId)
      .where(sql`${t.lineageStatus} = 'valid' AND ${t.isTip} = true`),
    index("correspondence_claim_events_claim_idx").on(
      t.projectId,
      t.repositoryId,
      t.claimId,
      t.generation,
    ),
    index("correspondence_claim_events_predecessor_idx").on(
      t.projectId,
      t.predecessorEventId,
    ),
    index("correspondence_claim_events_pending_reconcile_idx")
      .on(t.projectId, t.predecessorEventId, t.statusUpdatedAt, t.eventId)
      .where(sql`${t.lineageStatus} = 'pending'`),
    check(
      "correspondence_claim_events_kind_check",
      sql`${t.eventKind} IN ('claim.open', 'claim.renew', 'claim.release')`,
    ),
    check(
      "correspondence_claim_events_generation_check",
      sql`${t.generation} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "correspondence_claim_events_lineage_status_check",
      sql`${t.lineageStatus} IN ('pending', 'valid', 'invalid')`,
    ),
    check(
      "correspondence_claim_events_tip_status_check",
      sql`${t.lineageStatus} = 'valid' OR ${t.isTip} = false`,
    ),
    check(
      "correspondence_claim_events_expiry_check",
      sql`(${t.eventKind} = 'claim.release') = (${t.expiresAt} IS NULL)`,
    ),
    check(
      "correspondence_claim_events_predecessor_check",
      sql`(${t.generation} = 1) = (${t.predecessorEventId} IS NULL)`,
    ),
  ],
);

/** Durable bounded frontier. Rows exist only for arrived, non-pending
 * predecessors that still have pending direct children to reconcile. */
export const correspondenceClaimReconcileQueue = correspondenceSchema.table(
  "claim_reconcile_queue",
  {
    projectId: uuid("project_id").notNull(),
    predecessorEventId: text("predecessor_event_id").notNull(),
    enqueuedAt: timestamp("enqueued_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    primaryKey({
      name: "correspondence_claim_reconcile_queue_pk",
      columns: [t.projectId, t.predecessorEventId],
    }),
    foreignKey({
      name: "correspondence_claim_reconcile_queue_event_fk",
      columns: [t.projectId, t.predecessorEventId],
      foreignColumns: [correspondenceEvents.projectId, correspondenceEvents.eventId],
    }).onDelete("cascade"),
    index("correspondence_claim_reconcile_queue_order_idx").on(
      t.projectId,
      t.enqueuedAt,
      t.predecessorEventId,
    ),
  ],
);
