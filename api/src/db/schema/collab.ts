/** Cross-device collaboration relay.
 *
 * The relay is a repository-scoped coordination plane. Operation leases
 * serialize declarations of intent; they do not grant authority at GitHub,
 * npm, Fly, Cloudflare, Vercel, or any other provider.
 *
 * Migration: 20260723T210000_collab_relay.sql.
 * Doctrine: docs/CROSS-DEVICE-COLLABORATION.md.
 * Spec: docs/specs/AGENTTOOL-COLLAB-RELEASE-ROOM-0.4.md. */

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
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { projects } from "./tools";

export const collabSchema = pgSchema("collab");

export const collabRepositories = collabSchema.table(
  "repositories",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    id: uuid("id").notNull().defaultRandom(),
    key: text("key").notNull(),
    provider: text("provider").notNull(),
    providerRepositoryId: text("provider_repository_id").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    primaryKey({
      name: "collab_repositories_pk",
      columns: [t.projectId, t.id],
    }),
    unique("collab_repositories_project_key_unique").on(t.projectId, t.key),
    unique("collab_repositories_provider_id_unique").on(
      t.projectId,
      t.provider,
      t.providerRepositoryId,
    ),
    check(
      "collab_repositories_provider_check",
      sql`${t.provider} IN ('github', 'git', 'other')`,
    ),
    check(
      "collab_repositories_key_check",
      sql`char_length(${t.key}) BETWEEN 1 AND 256 AND ${t.key} !~ '[[:cntrl:]]'`,
    ),
    check(
      "collab_repositories_provider_id_check",
      sql`char_length(${t.providerRepositoryId}) BETWEEN 1 AND 256 AND ${t.providerRepositoryId} !~ '[[:cntrl:]]'`,
    ),
    check(
      "collab_repositories_display_name_check",
      sql`char_length(${t.displayName}) BETWEEN 1 AND 256 AND ${t.displayName} !~ '[[:cntrl:]]'`,
    ),
  ],
);

export const collabDevices = collabSchema.table(
  "devices",
  {
    projectId: uuid("project_id").notNull(),
    repositoryId: uuid("repository_id").notNull(),
    id: uuid("id").notNull(),
    label: text("label").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    tokenSha256: text("token_sha256").notNull(),
    profileSha256: text("profile_sha256").notNull(),
    allowedObservationProviders: text("allowed_observation_providers")
      .array()
      .notNull(),
    active: boolean("active").notNull().default(true),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({
      name: "collab_devices_pk",
      columns: [t.projectId, t.repositoryId, t.id],
    }),
    foreignKey({
      name: "collab_devices_repository_fk",
      columns: [t.projectId, t.repositoryId],
      foreignColumns: [collabRepositories.projectId, collabRepositories.id],
    }).onDelete("cascade"),
    uniqueIndex("collab_devices_token_sha256_unique").on(t.tokenSha256),
    index("collab_devices_token_prefix_idx").on(t.tokenPrefix),
    check(
      "collab_devices_label_check",
      sql`char_length(${t.label}) BETWEEN 1 AND 128 AND ${t.label} !~ '[[:cntrl:]]'`,
    ),
    check(
      "collab_devices_token_prefix_check",
      sql`${t.tokenPrefix} ~ '^atc_[A-Za-z0-9_-]{8}$'`,
    ),
    check(
      "collab_devices_token_sha256_check",
      sql`${t.tokenSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "collab_devices_profile_sha256_check",
      sql`${t.profileSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "collab_devices_version_check",
      sql`${t.version} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "collab_devices_observation_providers_check",
      sql`
        cardinality(${t.allowedObservationProviders}) BETWEEN 0 AND 5
        AND ${t.allowedObservationProviders} <@
          ARRAY['github', 'npm', 'fly', 'cloudflare-pages', 'vercel']::text[]
        AND cardinality(${t.allowedObservationProviders}) = (
          CASE WHEN ${t.allowedObservationProviders} @> ARRAY['github']::text[] THEN 1 ELSE 0 END
          + CASE WHEN ${t.allowedObservationProviders} @> ARRAY['npm']::text[] THEN 1 ELSE 0 END
          + CASE WHEN ${t.allowedObservationProviders} @> ARRAY['fly']::text[] THEN 1 ELSE 0 END
          + CASE WHEN ${t.allowedObservationProviders} @> ARRAY['cloudflare-pages']::text[] THEN 1 ELSE 0 END
          + CASE WHEN ${t.allowedObservationProviders} @> ARRAY['vercel']::text[] THEN 1 ELSE 0 END
        )
      `,
    ),
    check(
      "collab_devices_revocation_check",
      sql`(${t.active} = true AND ${t.revokedAt} IS NULL) OR (${t.active} = false)`,
    ),
  ],
);

/** One row per repository serializes all relay mutations and allocates the
 * durable event/observation receipt sequence. */
export const collabRepositoryStreams = collabSchema.table(
  "repository_streams",
  {
    projectId: uuid("project_id").notNull(),
    repositoryId: uuid("repository_id").notNull(),
    lastSequence: bigint("last_sequence", { mode: "number" })
      .notNull()
      .default(0),
    lastEventHash: text("last_event_hash"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    primaryKey({
      name: "collab_repository_streams_pk",
      columns: [t.projectId, t.repositoryId],
    }),
    foreignKey({
      name: "collab_repository_streams_repository_fk",
      columns: [t.projectId, t.repositoryId],
      foreignColumns: [collabRepositories.projectId, collabRepositories.id],
    }).onDelete("cascade"),
    check(
      "collab_repository_streams_sequence_check",
      sql`${t.lastSequence} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "collab_repository_streams_hash_check",
      sql`${t.lastEventHash} IS NULL OR ${t.lastEventHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const collabEvents = collabSchema.table(
  "events",
  {
    projectId: uuid("project_id").notNull(),
    repositoryId: uuid("repository_id").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    eventId: uuid("event_id").notNull().defaultRandom(),
    type: text("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    deviceId: uuid("device_id"),
    sessionId: uuid("session_id"),
    actorLabel: text("actor_label"),
    body: jsonb("body").notNull(),
    previousHash: text("previous_hash"),
    eventHash: text("event_hash").notNull(),
  },
  (t) => [
    primaryKey({
      name: "collab_events_pk",
      columns: [t.projectId, t.repositoryId, t.sequence],
    }),
    unique("collab_events_id_unique").on(t.projectId, t.repositoryId, t.eventId),
    foreignKey({
      name: "collab_events_repository_fk",
      columns: [t.projectId, t.repositoryId],
      foreignColumns: [collabRepositories.projectId, collabRepositories.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "collab_events_device_fk",
      columns: [t.projectId, t.repositoryId, t.deviceId],
      foreignColumns: [
        collabDevices.projectId,
        collabDevices.repositoryId,
        collabDevices.id,
      ],
    }).onDelete("restrict"),
    index("collab_events_repository_sequence_idx").on(
      t.projectId,
      t.repositoryId,
      t.sequence,
    ),
    check(
      "collab_events_sequence_check",
      sql`${t.sequence} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "collab_events_type_check",
      sql`char_length(${t.type}) BETWEEN 1 AND 100 AND ${t.type} ~ '^[a-z][a-z0-9._-]*$'`,
    ),
    check(
      "collab_events_actor_label_check",
      sql`${t.actorLabel} IS NULL OR (char_length(${t.actorLabel}) BETWEEN 1 AND 128 AND ${t.actorLabel} !~ '[[:cntrl:]]')`,
    ),
    check(
      "collab_events_previous_hash_check",
      sql`${t.previousHash} IS NULL OR ${t.previousHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "collab_events_hash_check",
      sql`${t.eventHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

/** Durable mutation replay receipts. `request_sha256` binds the idempotency
 * key to canonical request bytes; the stored response is safe metadata only. */
export const collabMutationReceipts = collabSchema.table(
  "mutation_receipts",
  {
    projectId: uuid("project_id").notNull(),
    repositoryId: uuid("repository_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestKind: text("request_kind").notNull(),
    requestSha256: text("request_sha256").notNull(),
    responseStatus: smallint("response_status").notNull(),
    response: jsonb("response").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    primaryKey({
      name: "collab_mutation_receipts_pk",
      columns: [t.projectId, t.repositoryId, t.deviceId, t.idempotencyKey],
    }),
    foreignKey({
      name: "collab_mutation_receipts_device_fk",
      columns: [t.projectId, t.repositoryId, t.deviceId],
      foreignColumns: [
        collabDevices.projectId,
        collabDevices.repositoryId,
        collabDevices.id,
      ],
    }).onDelete("restrict"),
    check(
      "collab_mutation_receipts_key_check",
      sql`char_length(${t.idempotencyKey}) BETWEEN 1 AND 128 AND ${t.idempotencyKey} ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'`,
    ),
    check(
      "collab_mutation_receipts_kind_check",
      sql`char_length(${t.requestKind}) BETWEEN 1 AND 128 AND ${t.requestKind} !~ '[[:cntrl:]]'`,
    ),
    check(
      "collab_mutation_receipts_hash_check",
      sql`${t.requestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "collab_mutation_receipts_status_check",
      sql`${t.responseStatus} BETWEEN 200 AND 299`,
    ),
  ],
);

export const collabOperationSlots = collabSchema.table(
  "operation_slots",
  {
    projectId: uuid("project_id").notNull(),
    repositoryId: uuid("repository_id").notNull(),
    operation: text("operation").notNull(),
    environment: text("environment").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    phase: text("phase").notNull().default("idle"),
    actionId: uuid("action_id"),
    holderDeviceId: uuid("holder_device_id"),
    sessionId: uuid("session_id"),
    actorLabel: text("actor_label"),
    leaseId: uuid("lease_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    version: bigint("version", { mode: "number" }).notNull().default(0),
    generation: bigint("generation", { mode: "number" }).notNull().default(0),
    target: text("target"),
    sourceRevision: text("source_revision"),
    parametersSha256: text("parameters_sha256"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    primaryKey({
      name: "collab_operation_slots_pk",
      columns: [t.projectId, t.repositoryId, t.operation, t.environment],
    }),
    unique("collab_operation_slots_sequence_unique").on(
      t.projectId,
      t.repositoryId,
      t.sequence,
    ),
    foreignKey({
      name: "collab_operation_slots_repository_fk",
      columns: [t.projectId, t.repositoryId],
      foreignColumns: [collabRepositories.projectId, collabRepositories.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "collab_operation_slots_holder_fk",
      columns: [t.projectId, t.repositoryId, t.holderDeviceId],
      foreignColumns: [
        collabDevices.projectId,
        collabDevices.repositoryId,
        collabDevices.id,
      ],
    }).onDelete("restrict"),
    index("collab_operation_slots_action_idx").on(
      t.projectId,
      t.repositoryId,
      t.actionId,
    ),
    check(
      "collab_operation_slots_operation_check",
      sql`char_length(${t.operation}) BETWEEN 1 AND 96 AND ${t.operation} ~ '^[a-z0-9][a-z0-9._:-]*$'`,
    ),
    check(
      "collab_operation_slots_environment_check",
      sql`char_length(${t.environment}) BETWEEN 1 AND 128 AND ${t.environment} ~ '^[a-z0-9][a-z0-9._:-]*$'`,
    ),
    check(
      "collab_operation_slots_phase_check",
      sql`${t.phase} IN ('idle', 'claimed', 'executing', 'recovery_required')`,
    ),
    check(
      "collab_operation_slots_sequence_check",
      sql`${t.sequence} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "collab_operation_slots_fence_check",
      sql`${t.version} BETWEEN 0 AND 9007199254740991 AND ${t.generation} BETWEEN 0 AND 9007199254740991`,
    ),
    check(
      "collab_operation_slots_active_shape_check",
      sql`(
        ${t.phase} = 'idle'
        AND ${t.actionId} IS NULL
        AND ${t.holderDeviceId} IS NULL
        AND ${t.sessionId} IS NULL
        AND ${t.actorLabel} IS NULL
        AND ${t.leaseId} IS NULL
        AND ${t.leaseExpiresAt} IS NULL
        AND ${t.target} IS NULL
        AND ${t.sourceRevision} IS NULL
        AND ${t.parametersSha256} IS NULL
      ) OR (
        ${t.phase} IN ('claimed', 'executing', 'recovery_required')
        AND ${t.actionId} IS NOT NULL
        AND ${t.holderDeviceId} IS NOT NULL
        AND ${t.sessionId} IS NOT NULL
        AND ${t.leaseId} IS NOT NULL
        AND ${t.leaseExpiresAt} IS NOT NULL
        AND ${t.target} IS NOT NULL
        AND ${t.sourceRevision} IS NOT NULL
        AND ${t.parametersSha256} IS NOT NULL
      )`,
    ),
    check(
      "collab_operation_slots_parameters_hash_check",
      sql`${t.parametersSha256} IS NULL OR ${t.parametersSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "collab_operation_slots_target_check",
      sql`${t.target} IS NULL OR (char_length(${t.target}) BETWEEN 1 AND 512 AND ${t.target} !~ '[[:cntrl:]]')`,
    ),
    check(
      "collab_operation_slots_source_revision_check",
      sql`${t.sourceRevision} IS NULL OR ${t.sourceRevision} ~ '^[0-9a-f]{40,64}$'`,
    ),
    check(
      "collab_operation_slots_actor_label_check",
      sql`${t.actorLabel} IS NULL OR (char_length(${t.actorLabel}) BETWEEN 1 AND 128 AND ${t.actorLabel} !~ '[[:cntrl:]]')`,
    ),
  ],
);

export const collabOperationRuns = collabSchema.table(
  "operation_runs",
  {
    projectId: uuid("project_id").notNull(),
    repositoryId: uuid("repository_id").notNull(),
    actionId: uuid("action_id").notNull(),
    operation: text("operation").notNull(),
    environment: text("environment").notNull(),
    deviceId: uuid("device_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    actorLabel: text("actor_label"),
    status: text("status").notNull(),
    leaseId: uuid("lease_id").notNull(),
    generation: bigint("generation", { mode: "number" }).notNull(),
    target: text("target").notNull(),
    sourceRevision: text("source_revision").notNull(),
    parametersSha256: text("parameters_sha256").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull(),
    beganAt: timestamp("began_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    primaryKey({
      name: "collab_operation_runs_pk",
      columns: [t.projectId, t.repositoryId, t.actionId],
    }),
    foreignKey({
      name: "collab_operation_runs_device_fk",
      columns: [t.projectId, t.repositoryId, t.deviceId],
      foreignColumns: [
        collabDevices.projectId,
        collabDevices.repositoryId,
        collabDevices.id,
      ],
    }).onDelete("restrict"),
    index("collab_operation_runs_slot_idx").on(
      t.projectId,
      t.repositoryId,
      t.operation,
      t.environment,
      t.claimedAt,
    ),
    check(
      "collab_operation_runs_status_check",
      sql`${t.status} IN ('claimed', 'executing', 'succeeded', 'failed', 'cancelled', 'uncertain', 'released', 'recovery_required')`,
    ),
    check(
      "collab_operation_runs_generation_check",
      sql`${t.generation} BETWEEN 1 AND 9007199254740991`,
    ),
    check(
      "collab_operation_runs_operation_check",
      sql`char_length(${t.operation}) BETWEEN 1 AND 96 AND ${t.operation} ~ '^[a-z0-9][a-z0-9._:-]*$'`,
    ),
    check(
      "collab_operation_runs_environment_check",
      sql`char_length(${t.environment}) BETWEEN 1 AND 128 AND ${t.environment} ~ '^[a-z0-9][a-z0-9._:-]*$'`,
    ),
    check(
      "collab_operation_runs_target_check",
      sql`char_length(${t.target}) BETWEEN 1 AND 512 AND ${t.target} !~ '[[:cntrl:]]'`,
    ),
    check(
      "collab_operation_runs_source_revision_check",
      sql`${t.sourceRevision} ~ '^[0-9a-f]{40,64}$'`,
    ),
    check(
      "collab_operation_runs_parameters_hash_check",
      sql`${t.parametersSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "collab_operation_runs_actor_label_check",
      sql`${t.actorLabel} IS NULL OR (char_length(${t.actorLabel}) BETWEEN 1 AND 128 AND ${t.actorLabel} !~ '[[:cntrl:]]')`,
    ),
  ],
);

/** Provider state imported by a device. These are bounded, append-only
 * observations, not webhooks and not proof that the provider authorized an
 * action. Receipt sequence follows the repository stream, not provider time. */
export const collabProviderObservations = collabSchema.table(
  "provider_observations",
  {
    projectId: uuid("project_id").notNull(),
    repositoryId: uuid("repository_id").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    observationId: uuid("observation_id").notNull().defaultRandom(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id"),
    actionId: uuid("action_id"),
    provenance: text("provenance").notNull().default("device_observed"),
    observingDeviceId: uuid("observing_device_id").notNull(),
    observingSessionId: uuid("observing_session_id").notNull(),
    actorLabel: text("actor_label"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    normalizedState: text("normalized_state").notNull(),
    sourceRevision: text("source_revision"),
    environment: text("environment"),
    resourceKind: text("resource_kind").notNull(),
    resourceId: text("resource_id").notNull(),
    nativeState: text("native_state").notNull(),
    url: text("url"),
    payloadSha256: text("payload_sha256").notNull(),
    canonicalRequestSha256: text("canonical_request_sha256").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    primaryKey({
      name: "collab_provider_observations_pk",
      columns: [t.projectId, t.repositoryId, t.sequence],
    }),
    unique("collab_provider_observations_id_unique").on(
      t.projectId,
      t.repositoryId,
      t.observationId,
    ),
    uniqueIndex("collab_provider_observations_event_unique")
      .on(t.projectId, t.repositoryId, t.provider, t.providerEventId)
      .where(sql`${t.providerEventId} IS NOT NULL`),
    foreignKey({
      name: "collab_provider_observations_device_fk",
      columns: [t.projectId, t.repositoryId, t.observingDeviceId],
      foreignColumns: [
        collabDevices.projectId,
        collabDevices.repositoryId,
        collabDevices.id,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "collab_provider_observations_action_fk",
      columns: [t.projectId, t.repositoryId, t.actionId],
      foreignColumns: [
        collabOperationRuns.projectId,
        collabOperationRuns.repositoryId,
        collabOperationRuns.actionId,
      ],
    }).onDelete("restrict"),
    index("collab_provider_observations_received_idx").on(
      t.projectId,
      t.repositoryId,
      t.sequence,
    ),
    index("collab_provider_observations_provider_clock_idx").on(
      t.projectId,
      t.repositoryId,
      t.provider,
      t.occurredAt,
    ),
    check(
      "collab_provider_observations_provider_check",
      sql`${t.provider} IN ('github', 'npm', 'fly', 'cloudflare-pages', 'vercel')`,
    ),
    check(
      "collab_provider_observations_provenance_check",
      sql`${t.provenance} = 'device_observed'`,
    ),
    check(
      "collab_provider_observations_event_id_check",
      sql`${t.providerEventId} IS NULL OR (char_length(${t.providerEventId}) BETWEEN 1 AND 256 AND ${t.providerEventId} !~ '[[:cntrl:]]')`,
    ),
    check(
      "collab_provider_observations_state_check",
      sql`${t.normalizedState} IN ('pending', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled', 'uncertain')`,
    ),
    check(
      "collab_provider_observations_resource_kind_check",
      sql`char_length(${t.resourceKind}) BETWEEN 1 AND 128 AND ${t.resourceKind} !~ '[[:cntrl:]]'`,
    ),
    check(
      "collab_provider_observations_resource_id_check",
      sql`char_length(${t.resourceId}) BETWEEN 1 AND 512 AND ${t.resourceId} !~ '[[:cntrl:]]'`,
    ),
    check(
      "collab_provider_observations_native_state_check",
      sql`char_length(${t.nativeState}) BETWEEN 1 AND 256 AND ${t.nativeState} !~ '[[:cntrl:]]'`,
    ),
    check(
      "collab_provider_observations_environment_check",
      sql`${t.environment} IS NULL OR (char_length(${t.environment}) BETWEEN 1 AND 128 AND ${t.environment} ~ '^[a-z0-9][a-z0-9._:-]*$')`,
    ),
    check(
      "collab_provider_observations_source_revision_check",
      sql`${t.sourceRevision} IS NULL OR ${t.sourceRevision} ~ '^[0-9a-f]{40,64}$'`,
    ),
    check(
      "collab_provider_observations_actor_label_check",
      sql`${t.actorLabel} IS NULL OR (char_length(${t.actorLabel}) BETWEEN 1 AND 128 AND ${t.actorLabel} !~ '[[:cntrl:]]')`,
    ),
    check(
      "collab_provider_observations_payload_hash_check",
      sql`${t.payloadSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "collab_provider_observations_request_hash_check",
      sql`${t.canonicalRequestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export type CollabRepository = typeof collabRepositories.$inferSelect;
export type CollabDevice = typeof collabDevices.$inferSelect;
export type CollabEvent = typeof collabEvents.$inferSelect;
export type CollabOperationSlot = typeof collabOperationSlots.$inferSelect;
export type CollabOperationRun = typeof collabOperationRuns.$inferSelect;
export type CollabProviderObservation =
  typeof collabProviderObservations.$inferSelect;
