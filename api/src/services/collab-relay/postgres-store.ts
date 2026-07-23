/** Postgres authority for the cross-device collaboration relay.
 *
 * Every repository mutation locks its repository_streams row. Postgres
 * clock_timestamp() owns lease time, the stream owns event order, and durable
 * mutation receipts own replay equivalence. Redis is deliberately absent.
 *
 * A relay lease coordinates intent only. Provider credentials and provider
 * authorization remain outside this service.
 * Doctrine: docs/CROSS-DEVICE-COLLABORATION.md. */

import { randomUUID, timingSafeEqual } from "node:crypto";

import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import { db } from "../../db/client";
import {
  collabDevices,
  collabEvents,
  collabMutationReceipts,
  collabOperationRuns,
  collabOperationSlots,
  collabProviderObservations,
  collabRepositories,
  collabRepositoryStreams,
} from "../../db/schema/collab";
import {
  collabEnrolmentIdempotencyKey,
  collabEventHash,
  collabSha256,
  providerObservationProjectionSha256,
  relayTokenSha256,
} from "./canonical";
import type {
  CollabEnrolmentInput,
  CollabEventPage,
  CollabEventRecord,
  CollabPrincipal,
  EnrolmentResult,
  ListOperationsInput,
  ListPageInput,
  MutationReceipt,
  OperationBeginInput,
  OperationClaimInput,
  OperationCompleteInput,
  OperationPage,
  OperationRecoverInput,
  OperationReleaseInput,
  OperationRenewInput,
  OperationResult,
  OperationRunRecord,
  OperationSlotRecord,
  ProviderObservationInput,
  ProviderObservationPage,
  ProviderObservationRecord,
  ProviderObservationResult,
} from "./contracts";
import { CollabRelayError } from "./errors";
import {
  actionableReplayDecision,
  type ActionableOperationKind,
} from "./replay";
import type { CollabRelayStore } from "./service";
import {
  enrollmentDeviceEvent,
  expiredLeaseTransition,
  SERVER_DERIVED_ATTRIBUTION,
} from "./state";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type StreamRow = typeof collabRepositoryStreams.$inferSelect;
type DeviceRow = typeof collabDevices.$inferSelect;
type RepositoryRow = typeof collabRepositories.$inferSelect;
type SlotRow = typeof collabOperationSlots.$inferSelect;
type RunRow = typeof collabOperationRuns.$inferSelect;
type ObservationRow = typeof collabProviderObservations.$inferSelect;
type EventRow = typeof collabEvents.$inferSelect;

interface LockedRepository {
  tx: Transaction;
  stream: StreamRow;
  now: Date;
}

interface DeferredFailure {
  error: CollabRelayError;
}

function isDeferredFailure(
  value: OperationResult | DeferredFailure,
): value is DeferredFailure {
  return "error" in value;
}

function iso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function safeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function slotRecord(row: SlotRow): OperationSlotRecord {
  return {
    sequence: row.sequence,
    repository_id: row.repositoryId,
    operation: row.operation,
    environment: row.environment,
    phase: row.phase as OperationSlotRecord["phase"],
    action_id: row.actionId,
    holder_device_id: row.holderDeviceId,
    session_id: row.sessionId,
    actor_label: row.actorLabel,
    lease_id: row.leaseId,
    lease_expires_at: row.leaseExpiresAt ? iso(row.leaseExpiresAt) : null,
    version: row.version,
    generation: row.generation,
    target: row.target,
    source_revision: row.sourceRevision,
    parameters_sha256: row.parametersSha256,
    updated_at: iso(row.updatedAt),
  };
}

function effectiveSlotRecord(
  row: SlotRow,
  now: Date,
): OperationSlotRecord {
  const record = slotRecord(row);
  const transition = expiredLeaseTransition(
    record.phase,
    row.leaseExpiresAt,
    now,
  );
  if (transition === "release_claim") {
    return {
      ...record,
      phase: "idle",
      action_id: null,
      holder_device_id: null,
      session_id: null,
      actor_label: null,
      lease_id: null,
      lease_expires_at: null,
      version: record.version + 1,
      target: null,
      source_revision: null,
      parameters_sha256: null,
    };
  }
  if (transition === "require_recovery") {
    return {
      ...record,
      phase: "recovery_required",
      version: record.version + 1,
    };
  }
  return record;
}

function runRecord(row: RunRow): OperationRunRecord {
  return {
    action_id: row.actionId,
    operation: row.operation,
    environment: row.environment,
    device_id: row.deviceId,
    session_id: row.sessionId,
    actor_label: row.actorLabel,
    status: row.status as OperationRunRecord["status"],
    lease_id: row.leaseId,
    generation: row.generation,
    target: row.target,
    source_revision: row.sourceRevision,
    parameters_sha256: row.parametersSha256,
    claimed_at: iso(row.claimedAt),
    began_at: row.beganAt ? iso(row.beganAt) : null,
    completed_at: row.completedAt ? iso(row.completedAt) : null,
    updated_at: iso(row.updatedAt),
  };
}

function observationRecord(row: ObservationRow): ProviderObservationRecord {
  return {
    sequence: row.sequence,
    observation_id: row.observationId,
    repository_id: row.repositoryId,
    provider: row.provider as ProviderObservationRecord["provider"],
    provider_event_id: row.providerEventId,
    action_id: row.actionId,
    provenance: "device_observed",
    observing_device_id: row.observingDeviceId,
    observing_session_id: row.observingSessionId,
    actor_label: row.actorLabel,
    observed_at: iso(row.observedAt),
    occurred_at: row.occurredAt ? iso(row.occurredAt) : null,
    normalized_state:
      row.normalizedState as ProviderObservationRecord["normalized_state"],
    source_revision: row.sourceRevision,
    environment: row.environment,
    resource_kind: row.resourceKind,
    resource_id: row.resourceId,
    native_state: row.nativeState,
    url: row.url,
    payload_sha256: row.payloadSha256,
    received_at: iso(row.receivedAt),
  };
}

function eventRecord(row: EventRow): CollabEventRecord {
  return {
    sequence: row.sequence,
    event_id: row.eventId,
    type: row.type,
    occurred_at: iso(row.occurredAt),
    device_id: row.deviceId,
    session_id: row.sessionId,
    actor_label: row.actorLabel,
    body: row.body as Record<string, unknown>,
    previous_hash: row.previousHash,
    event_hash: row.eventHash,
  };
}

async function postgresNow(tx: Transaction): Promise<Date> {
  const [row] = await tx.execute<{ now: Date | string }>(
    sql`SELECT clock_timestamp() AS now`,
  );
  if (!row) {
    throw new CollabRelayError(
      "collab_clock_unavailable",
      "The collaboration relay clock is temporarily unavailable.",
      503,
    );
  }
  return row.now instanceof Date ? row.now : new Date(row.now);
}

async function lockRepository(
  tx: Transaction,
  projectId: string,
  repositoryId: string,
): Promise<LockedRepository> {
  const [repository] = await tx
    .select({ id: collabRepositories.id })
    .from(collabRepositories)
    .where(
      and(
        eq(collabRepositories.projectId, projectId),
        eq(collabRepositories.id, repositoryId),
      ),
    )
    .limit(1);
  if (!repository) {
    throw new CollabRelayError(
      "repository_scope_mismatch",
      "The scoped bearer does not name an available repository.",
      403,
    );
  }
  await tx
    .insert(collabRepositoryStreams)
    .values({ projectId, repositoryId })
    .onConflictDoNothing();
  const [stream] = await tx
    .select()
    .from(collabRepositoryStreams)
    .where(
      and(
        eq(collabRepositoryStreams.projectId, projectId),
        eq(collabRepositoryStreams.repositoryId, repositoryId),
      ),
    )
    .for("update")
    .limit(1);
  if (!stream) {
    throw new CollabRelayError(
      "collab_stream_unavailable",
      "The repository coordination stream could not be initialized.",
      503,
    );
  }
  return { tx, stream, now: await postgresNow(tx) };
}

/** Recheck the credential after acquiring the repository mutation lock.
 *
 * Authentication can race a project-authorized token rotation. The stream
 * lock serializes this check with enrollment, so a request authenticated with
 * an older digest cannot mutate after the rotation commits. */
async function assertCurrentPrincipal(
  locked: LockedRepository,
  principal: CollabPrincipal,
): Promise<void> {
  const [device] = await locked.tx
    .select({
      active: collabDevices.active,
      revokedAt: collabDevices.revokedAt,
      tokenSha256: collabDevices.tokenSha256,
    })
    .from(collabDevices)
    .where(
      and(
        eq(collabDevices.projectId, principal.project_id),
        eq(collabDevices.repositoryId, principal.repository_id),
        eq(collabDevices.id, principal.device_id),
      ),
    )
    .limit(1);
  if (
    !device?.active
    || device.revokedAt !== null
    || !safeEqualHex(device.tokenSha256, principal.token_sha256)
  ) {
    throw new CollabRelayError(
      "collab_token_stale",
      "The scoped collaboration bearer changed before this mutation acquired its repository fence.",
      401,
    );
  }
}

async function appendEvent(
  locked: LockedRepository,
  input: {
    principal: CollabPrincipal;
    type: string;
    device_id?: string | null;
    session_id?: string | null;
    actor_label?: string | null;
    body: Record<string, unknown>;
  },
): Promise<EventRow> {
  const sequence = locked.stream.lastSequence + 1;
  const eventId = randomUUID();
  const occurredAt = locked.now;
  const previousHash = locked.stream.lastEventHash;
  const deviceId = input.device_id === undefined
    ? input.principal.device_id
    : input.device_id;
  const sessionId = input.session_id ?? null;
  const actorLabel = input.actor_label ?? null;
  const eventHash = collabEventHash({
    previous_hash: previousHash,
    sequence,
    event_id: eventId,
    type: input.type,
    occurred_at: occurredAt.toISOString(),
    device_id: deviceId,
    session_id: sessionId,
    actor_label: actorLabel,
    body: input.body,
  });
  const [row] = await locked.tx
    .insert(collabEvents)
    .values({
      projectId: input.principal.project_id,
      repositoryId: input.principal.repository_id,
      sequence,
      eventId,
      type: input.type,
      occurredAt,
      deviceId,
      sessionId,
      actorLabel,
      body: input.body,
      previousHash,
      eventHash,
    })
    .returning();
  if (!row) {
    throw new CollabRelayError(
      "collab_event_append_failed",
      "The durable collaboration event could not be appended.",
      503,
    );
  }
  await locked.tx
    .update(collabRepositoryStreams)
    .set({
      lastSequence: sequence,
      lastEventHash: eventHash,
      updatedAt: locked.now,
    })
    .where(
      and(
        eq(
          collabRepositoryStreams.projectId,
          input.principal.project_id,
        ),
        eq(
          collabRepositoryStreams.repositoryId,
          input.principal.repository_id,
        ),
      ),
    );
  locked.stream.lastSequence = sequence;
  locked.stream.lastEventHash = eventHash;
  locked.stream.updatedAt = locked.now;
  return row;
}

async function existingReceipt<
  T extends EnrolmentResult | OperationResult | ProviderObservationResult,
>(
  locked: LockedRepository,
  principal: CollabPrincipal,
  idempotencyKey: string,
  requestKind: string,
  requestSha256: string,
): Promise<T | null> {
  const [receipt] = await locked.tx
    .select()
    .from(collabMutationReceipts)
    .where(
      and(
        eq(collabMutationReceipts.projectId, principal.project_id),
        eq(collabMutationReceipts.repositoryId, principal.repository_id),
        eq(collabMutationReceipts.deviceId, principal.device_id),
        eq(collabMutationReceipts.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  if (!receipt) return null;
  if (
    receipt.requestKind !== requestKind
    || receipt.requestSha256 !== requestSha256
  ) {
    throw new CollabRelayError(
      "idempotency_mismatch",
      "That idempotency key is already bound to different canonical request bytes.",
      409,
      { idempotency_key: idempotencyKey },
    );
  }
  return {
    ...(receipt.response as T),
    replayed: true,
    receipt: {
      idempotency_key: receipt.idempotencyKey,
      request_sha256: receipt.requestSha256,
      recorded_at: iso(receipt.recordedAt),
    },
  };
}

async function storeReceipt<
  T extends EnrolmentResult | OperationResult | ProviderObservationResult,
>(
  locked: LockedRepository,
  principal: CollabPrincipal,
  idempotencyKey: string,
  requestKind: string,
  requestSha256: string,
  response: Omit<T, "receipt">,
  responseStatus = 200,
): Promise<T> {
  const receipt: MutationReceipt = {
    idempotency_key: idempotencyKey,
    request_sha256: requestSha256,
    recorded_at: locked.now.toISOString(),
  };
  const complete = { ...response, receipt } as T;
  await locked.tx.insert(collabMutationReceipts).values({
    projectId: principal.project_id,
    repositoryId: principal.repository_id,
    deviceId: principal.device_id,
    idempotencyKey,
    requestKind,
    requestSha256,
    responseStatus,
    response: complete,
    recordedAt: locked.now,
  });
  return complete;
}

function sameProviderPolicy(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((provider, index) => provider === right[index]);
}

function enrolmentResult(
  repository: RepositoryRow,
  device: DeviceRow,
  created: boolean,
): Omit<EnrolmentResult, "receipt"> {
  return {
    schema: "agenttool.collab-enrolment-result/1",
    replayed: false,
    repository: {
      id: repository.id,
      key: repository.key,
      provider:
        repository.provider as EnrolmentResult["repository"]["provider"],
      provider_repository_id: repository.providerRepositoryId,
      display_name: repository.displayName,
    },
    device: {
      id: device.id,
      label: device.label,
      token_prefix: device.tokenPrefix,
      active: device.active,
      version: device.version,
    },
    observation_policy: {
      profile_sha256: device.profileSha256,
      allowed_providers: device.allowedObservationProviders as
        EnrolmentResult["observation_policy"]["allowed_providers"],
    },
    created,
  };
}

function operationResult(
  slot: SlotRow,
  run: RunRow,
): Omit<OperationResult, "receipt"> {
  return {
    schema: "agenttool.collab-operation-result/1",
    replayed: false,
    slot: slotRecord(slot),
    run: runRecord(run),
    authority: {
      kind: "coordination_only",
      provider_authority_granted: false,
    },
  };
}

function idleSlotValues(now: Date, sequence: number, version: number) {
  return {
    sequence,
    phase: "idle",
    actionId: null,
    holderDeviceId: null,
    sessionId: null,
    actorLabel: null,
    leaseId: null,
    leaseExpiresAt: null,
    version,
    target: null,
    sourceRevision: null,
    parametersSha256: null,
    updatedAt: now,
  } as const;
}

function assertOperationBinding(
  principal: CollabPrincipal,
  slot: SlotRow,
  run: RunRow,
  input:
    | OperationRenewInput
    | OperationBeginInput
    | OperationCompleteInput
    | OperationReleaseInput,
): void {
  if (
    run.actionId !== input.action_id
    || slot.actionId !== input.action_id
    || run.operation !== input.operation
    || run.environment !== input.environment
    || run.target !== input.target
    || run.sourceRevision !== input.source_revision
    || run.parametersSha256 !== input.parameters_sha256
    || run.sessionId !== input.session_id
    || (run.actorLabel ?? undefined) !== input.actor_label
  ) {
    throw new CollabRelayError(
      "operation_binding_mismatch",
      "The action binding does not match the durable claimed operation.",
      409,
    );
  }
  if (
    slot.holderDeviceId !== principal.device_id
    || run.deviceId !== principal.device_id
  ) {
    throw new CollabRelayError(
      "operation_holder_mismatch",
      "Only the device and session that claimed this active lease may mutate it.",
      409,
    );
  }
  if (
    slot.leaseId !== input.lease_id
    || run.leaseId !== input.lease_id
  ) {
    throw new CollabRelayError(
      "stale_fence",
      "The lease identifier no longer matches the active operation fence.",
      409,
      { version: slot.version, generation: slot.generation },
    );
  }
  if (
    slot.version !== input.expected_version
    || slot.generation !== input.expected_generation
  ) {
    throw new CollabRelayError(
      "stale_fence",
      "The expected operation version or generation is stale.",
      409,
      { version: slot.version, generation: slot.generation },
    );
  }
}

function assertRecoveryBinding(
  slot: SlotRow,
  run: RunRow,
  input: OperationRecoverInput,
): void {
  if (
    run.actionId !== input.action_id
    || slot.actionId !== input.action_id
    || run.operation !== input.operation
    || run.environment !== input.environment
    || run.target !== input.target
    || run.sourceRevision !== input.source_revision
    || run.parametersSha256 !== input.parameters_sha256
  ) {
    throw new CollabRelayError(
      "operation_binding_mismatch",
      "The recovery binding does not match the durable operation.",
      409,
    );
  }
  if (
    slot.version !== input.expected_version
    || slot.generation !== input.expected_generation
  ) {
    throw new CollabRelayError(
      "stale_fence",
      "The expected recovery version or generation is stale.",
      409,
      { version: slot.version, generation: slot.generation },
    );
  }
}

async function readSlotAndRun(
  locked: LockedRepository,
  principal: CollabPrincipal,
  actionId: string,
): Promise<{ slot: SlotRow; run: RunRow }> {
  const [run] = await locked.tx
    .select()
    .from(collabOperationRuns)
    .where(
      and(
        eq(collabOperationRuns.projectId, principal.project_id),
        eq(collabOperationRuns.repositoryId, principal.repository_id),
        eq(collabOperationRuns.actionId, actionId),
      ),
    )
    .limit(1);
  if (!run) {
    throw new CollabRelayError(
      "operation_not_found",
      "The requested operation action does not exist in this repository.",
      404,
    );
  }
  const [slot] = await locked.tx
    .select()
    .from(collabOperationSlots)
    .where(
      and(
        eq(collabOperationSlots.projectId, principal.project_id),
        eq(collabOperationSlots.repositoryId, principal.repository_id),
        eq(collabOperationSlots.operation, run.operation),
        eq(collabOperationSlots.environment, run.environment),
      ),
    )
    .for("update")
    .limit(1);
  if (!slot || slot.actionId !== actionId) {
    throw new CollabRelayError(
      "invalid_transition",
      "The requested action is no longer the active operation slot.",
      409,
    );
  }
  return { slot, run };
}

async function assertEvidenceReferences(
  locked: LockedRepository,
  principal: CollabPrincipal,
  actionId: string,
  observationIds: string[] | undefined,
): Promise<void> {
  if (!observationIds || observationIds.length === 0) return;
  const rows = await locked.tx
    .select({
      id: collabProviderObservations.observationId,
      actionId: collabProviderObservations.actionId,
    })
    .from(collabProviderObservations)
    .where(
      and(
        eq(collabProviderObservations.projectId, principal.project_id),
        eq(collabProviderObservations.repositoryId, principal.repository_id),
        inArray(collabProviderObservations.observationId, observationIds),
      ),
    );
  if (
    rows.length !== observationIds.length
    || rows.some((row) => row.actionId !== actionId)
  ) {
    throw new CollabRelayError(
      "observation_binding_mismatch",
      "Every completion observation must exist in this repository and name the same action.",
      409,
    );
  }
}

async function transitionExpiredSlot(
  locked: LockedRepository,
  principal: CollabPrincipal,
  slot: SlotRow,
  run: RunRow,
): Promise<{ slot: SlotRow; run: RunRow }> {
  const transition = expiredLeaseTransition(
    slot.phase as OperationSlotRecord["phase"],
    slot.leaseExpiresAt,
    locked.now,
  );
  if (transition === "release_claim") {
    const event = await appendEvent(locked, {
      principal,
      type: "operation.claim_expired",
      ...SERVER_DERIVED_ATTRIBUTION,
      body: {
        action_id: run.actionId,
        operation: run.operation,
        environment: run.environment,
        generation: run.generation,
        reason: "lease_expired_before_begin",
        original_holder_device_id: run.deviceId,
        original_session_id: run.sessionId,
        original_actor_label: run.actorLabel,
      },
    });
    const [updatedRun] = await locked.tx
      .update(collabOperationRuns)
      .set({
        status: "released",
        completedAt: locked.now,
        updatedAt: locked.now,
      })
      .where(
        and(
          eq(collabOperationRuns.projectId, principal.project_id),
          eq(collabOperationRuns.repositoryId, principal.repository_id),
          eq(collabOperationRuns.actionId, run.actionId),
        ),
      )
      .returning();
    const [updatedSlot] = await locked.tx
      .update(collabOperationSlots)
      .set(idleSlotValues(locked.now, event.sequence, slot.version + 1))
      .where(
        and(
          eq(collabOperationSlots.projectId, principal.project_id),
          eq(collabOperationSlots.repositoryId, principal.repository_id),
          eq(collabOperationSlots.operation, slot.operation),
          eq(collabOperationSlots.environment, slot.environment),
        ),
      )
      .returning();
    return { slot: updatedSlot!, run: updatedRun! };
  }
  if (transition === "require_recovery") {
    const event = await appendEvent(locked, {
      principal,
      type: "operation.recovery_required",
      ...SERVER_DERIVED_ATTRIBUTION,
      body: {
        action_id: run.actionId,
        operation: run.operation,
        environment: run.environment,
        generation: run.generation,
        reason: "executing_lease_expired",
        original_holder_device_id: run.deviceId,
        original_session_id: run.sessionId,
        original_actor_label: run.actorLabel,
      },
    });
    const [updatedRun] = await locked.tx
      .update(collabOperationRuns)
      .set({ status: "recovery_required", updatedAt: locked.now })
      .where(
        and(
          eq(collabOperationRuns.projectId, principal.project_id),
          eq(collabOperationRuns.repositoryId, principal.repository_id),
          eq(collabOperationRuns.actionId, run.actionId),
        ),
      )
      .returning();
    const [updatedSlot] = await locked.tx
      .update(collabOperationSlots)
      .set({
        sequence: event.sequence,
        phase: "recovery_required",
        version: slot.version + 1,
        updatedAt: locked.now,
      })
      .where(
        and(
          eq(collabOperationSlots.projectId, principal.project_id),
          eq(collabOperationSlots.repositoryId, principal.repository_id),
          eq(collabOperationSlots.operation, slot.operation),
          eq(collabOperationSlots.environment, slot.environment),
        ),
      )
      .returning();
    return { slot: updatedSlot!, run: updatedRun! };
  }
  return { slot, run };
}

function replayFenceFailure(slot: SlotRow | undefined): DeferredFailure {
  return {
    error: new CollabRelayError(
      "stale_fence",
      "The idempotent operation result is historical and no longer matches the active slot fence.",
      409,
      slot
        ? {
            action_id: slot.actionId,
            version: slot.version,
            generation: slot.generation,
          }
        : undefined,
    ),
  };
}

async function validateActionableReplay(
  locked: LockedRepository,
  principal: CollabPrincipal,
  replay: OperationResult,
  kind: ActionableOperationKind,
): Promise<OperationResult | DeferredFailure> {
  const [currentSlot] = await locked.tx
    .select()
    .from(collabOperationSlots)
    .where(
      and(
        eq(collabOperationSlots.projectId, principal.project_id),
        eq(collabOperationSlots.repositoryId, principal.repository_id),
        eq(collabOperationSlots.operation, replay.slot.operation),
        eq(collabOperationSlots.environment, replay.slot.environment),
      ),
    )
    .for("update")
    .limit(1);
  if (!currentSlot) return replayFenceFailure(undefined);

  const decision = actionableReplayDecision(
    kind,
    replay.slot,
    slotRecord(currentSlot),
    locked.now,
  );
  if (decision === "current") return replay;
  if (decision === "stale") return replayFenceFailure(currentSlot);
  if (decision === "recovery_required") {
    return {
      error: new CollabRelayError(
        "recovery_required",
        "The historical operation result now requires provider-fact recovery.",
        409,
        {
          action_id: currentSlot.actionId,
          version: currentSlot.version,
          generation: currentSlot.generation,
        },
      ),
    };
  }

  if (!currentSlot.actionId) return replayFenceFailure(currentSlot);
  const [currentRun] = await locked.tx
    .select()
    .from(collabOperationRuns)
    .where(
      and(
        eq(collabOperationRuns.projectId, principal.project_id),
        eq(collabOperationRuns.repositoryId, principal.repository_id),
        eq(collabOperationRuns.actionId, currentSlot.actionId),
      ),
    )
    .limit(1);
  if (!currentRun) {
    return {
      error: new CollabRelayError(
        "collab_operation_state_invalid",
        "The active operation run needed for expiry recovery is unavailable.",
        503,
      ),
    };
  }
  const transitioned = await transitionExpiredSlot(
    locked,
    principal,
    currentSlot,
    currentRun,
  );
  return {
    error: new CollabRelayError(
      decision === "require_recovery"
        ? "recovery_required"
        : "lease_expired",
      decision === "require_recovery"
        ? "The executing lease expired and now requires provider-fact recovery."
        : "The claimed lease expired before this idempotent retry.",
      409,
      {
        action_id:
          transitioned.slot.actionId ?? replay.slot.action_id,
        version: transitioned.slot.version,
        generation: transitioned.slot.generation,
      },
    ),
  };
}

async function fencedMutation(
  principal: CollabPrincipal,
  input:
    | OperationRenewInput
    | OperationBeginInput
    | OperationCompleteInput
    | OperationReleaseInput,
  kind: "renew" | "begin" | "complete" | "release",
): Promise<OperationResult> {
  const requestSha256 = collabSha256(input);
  const transactionResult = await db.transaction<
    OperationResult | DeferredFailure
  >(async (tx) => {
    const locked = await lockRepository(
      tx,
      principal.project_id,
      principal.repository_id,
    );
    await assertCurrentPrincipal(locked, principal);
    const replay = await existingReceipt<OperationResult>(
      locked,
      principal,
      input.idempotency_key,
      `operation.${kind}`,
      requestSha256,
    );
    if (replay) {
      return kind === "renew" || kind === "begin"
        ? validateActionableReplay(locked, principal, replay, kind)
        : replay;
    }

    let { slot, run } = await readSlotAndRun(
      locked,
      principal,
      input.action_id,
    );
    if (slot.phase === "recovery_required") {
      return {
        error: new CollabRelayError(
          "recovery_required",
          "The executing lease expired; reconcile provider facts through the recovery operation.",
          409,
          { version: slot.version, generation: slot.generation },
        ),
      };
    }
    assertOperationBinding(principal, slot, run, input);
    if (
      slot.leaseExpiresAt
      && slot.leaseExpiresAt.getTime() <= locked.now.getTime()
    ) {
      ({ slot, run } = await transitionExpiredSlot(
        locked,
        principal,
        slot,
        run,
      ));
      return {
        error: new CollabRelayError(
          slot.phase === "recovery_required"
            ? "recovery_required"
            : "lease_expired",
          slot.phase === "recovery_required"
            ? "The executing lease expired and now requires provider-fact recovery."
            : "The claimed lease expired before this mutation.",
          409,
          { version: slot.version, generation: slot.generation },
        ),
      };
    }

    if (kind === "renew") {
      if (slot.phase !== "claimed" && slot.phase !== "executing") {
        throw new CollabRelayError(
          "invalid_transition",
          "Only a claimed or executing lease can be renewed.",
          409,
        );
      }
      const renew = input as OperationRenewInput;
      const leaseExpiresAt = new Date(
        locked.now.getTime() + renew.lease_seconds * 1_000,
      );
      const event = await appendEvent(locked, {
        principal,
        type: "operation.renewed",
        session_id: run.sessionId,
        actor_label: run.actorLabel,
        body: {
          action_id: run.actionId,
          operation: run.operation,
          environment: run.environment,
          generation: run.generation,
          lease_expires_at: leaseExpiresAt.toISOString(),
        },
      });
      const [updatedSlot] = await tx
        .update(collabOperationSlots)
        .set({
          sequence: event.sequence,
          leaseExpiresAt,
          version: slot.version + 1,
          updatedAt: locked.now,
        })
        .where(
          and(
            eq(collabOperationSlots.projectId, principal.project_id),
            eq(collabOperationSlots.repositoryId, principal.repository_id),
            eq(collabOperationSlots.operation, slot.operation),
            eq(collabOperationSlots.environment, slot.environment),
          ),
        )
        .returning();
      const [updatedRun] = await tx
        .update(collabOperationRuns)
        .set({ updatedAt: locked.now })
        .where(
          and(
            eq(collabOperationRuns.projectId, principal.project_id),
            eq(collabOperationRuns.repositoryId, principal.repository_id),
            eq(collabOperationRuns.actionId, run.actionId),
          ),
        )
        .returning();
      return storeReceipt(
        locked,
        principal,
        input.idempotency_key,
        "operation.renew",
        requestSha256,
        operationResult(updatedSlot!, updatedRun!),
      );
    }

    if (kind === "begin") {
      if (slot.phase !== "claimed") {
        throw new CollabRelayError(
          "invalid_transition",
          "Only a claimed lease can begin provider execution.",
          409,
        );
      }
      const event = await appendEvent(locked, {
        principal,
        type: "operation.began",
        session_id: run.sessionId,
        actor_label: run.actorLabel,
        body: {
          action_id: run.actionId,
          operation: run.operation,
          environment: run.environment,
          generation: run.generation,
        },
      });
      const [updatedSlot] = await tx
        .update(collabOperationSlots)
        .set({
          sequence: event.sequence,
          phase: "executing",
          version: slot.version + 1,
          updatedAt: locked.now,
        })
        .where(
          and(
            eq(collabOperationSlots.projectId, principal.project_id),
            eq(collabOperationSlots.repositoryId, principal.repository_id),
            eq(collabOperationSlots.operation, slot.operation),
            eq(collabOperationSlots.environment, slot.environment),
          ),
        )
        .returning();
      const [updatedRun] = await tx
        .update(collabOperationRuns)
        .set({
          status: "executing",
          beganAt: locked.now,
          updatedAt: locked.now,
        })
        .where(
          and(
            eq(collabOperationRuns.projectId, principal.project_id),
            eq(collabOperationRuns.repositoryId, principal.repository_id),
            eq(collabOperationRuns.actionId, run.actionId),
          ),
        )
        .returning();
      return storeReceipt(
        locked,
        principal,
        input.idempotency_key,
        "operation.begin",
        requestSha256,
        operationResult(updatedSlot!, updatedRun!),
      );
    }

    if (kind === "release") {
      if (slot.phase !== "claimed") {
        throw new CollabRelayError(
          "invalid_transition",
          "An executing operation must be completed or recovered, not released.",
          409,
        );
      }
      const release = input as OperationReleaseInput;
      const event = await appendEvent(locked, {
        principal,
        type: "operation.released",
        session_id: run.sessionId,
        actor_label: run.actorLabel,
        body: {
          action_id: run.actionId,
          operation: run.operation,
          environment: run.environment,
          generation: run.generation,
          ...(release.reason ? { reason: release.reason } : {}),
        },
      });
      const [updatedRun] = await tx
        .update(collabOperationRuns)
        .set({
          status: "released",
          completedAt: locked.now,
          updatedAt: locked.now,
        })
        .where(
          and(
            eq(collabOperationRuns.projectId, principal.project_id),
            eq(collabOperationRuns.repositoryId, principal.repository_id),
            eq(collabOperationRuns.actionId, run.actionId),
          ),
        )
        .returning();
      const [updatedSlot] = await tx
        .update(collabOperationSlots)
        .set(idleSlotValues(locked.now, event.sequence, slot.version + 1))
        .where(
          and(
            eq(collabOperationSlots.projectId, principal.project_id),
            eq(collabOperationSlots.repositoryId, principal.repository_id),
            eq(collabOperationSlots.operation, slot.operation),
            eq(collabOperationSlots.environment, slot.environment),
          ),
        )
        .returning();
      return storeReceipt(
        locked,
        principal,
        input.idempotency_key,
        "operation.release",
        requestSha256,
        operationResult(updatedSlot!, updatedRun!),
      );
    }

    const complete = input as OperationCompleteInput;
    if (slot.phase !== "executing") {
      throw new CollabRelayError(
        "invalid_transition",
        "Only an executing operation can be completed.",
        409,
      );
    }
    await assertEvidenceReferences(
      locked,
      principal,
      run.actionId,
      complete.observation_ids,
    );
    const event = await appendEvent(locked, {
      principal,
      type:
        complete.outcome === "uncertain"
          ? "operation.outcome_uncertain"
          : "operation.completed",
      session_id: run.sessionId,
      actor_label: run.actorLabel,
      body: {
        action_id: run.actionId,
        operation: run.operation,
        environment: run.environment,
        generation: run.generation,
        outcome: complete.outcome,
        ...(complete.receipt_ref
          ? { receipt_ref: complete.receipt_ref }
          : {}),
        ...(complete.observation_ids
          ? { observation_ids: complete.observation_ids }
          : {}),
      },
    });
    const uncertain = complete.outcome === "uncertain";
    const [updatedRun] = await tx
      .update(collabOperationRuns)
      .set({
        status: complete.outcome,
        completedAt: uncertain ? null : locked.now,
        updatedAt: locked.now,
      })
      .where(
        and(
          eq(collabOperationRuns.projectId, principal.project_id),
          eq(collabOperationRuns.repositoryId, principal.repository_id),
          eq(collabOperationRuns.actionId, run.actionId),
        ),
      )
      .returning();
    const [updatedSlot] = await tx
      .update(collabOperationSlots)
      .set(
        uncertain
          ? {
              sequence: event.sequence,
              phase: "recovery_required",
              version: slot.version + 1,
              updatedAt: locked.now,
            }
          : idleSlotValues(locked.now, event.sequence, slot.version + 1),
      )
      .where(
        and(
          eq(collabOperationSlots.projectId, principal.project_id),
          eq(collabOperationSlots.repositoryId, principal.repository_id),
          eq(collabOperationSlots.operation, slot.operation),
          eq(collabOperationSlots.environment, slot.environment),
        ),
      )
      .returning();
    return storeReceipt(
      locked,
      principal,
      input.idempotency_key,
      "operation.complete",
      requestSha256,
      operationResult(updatedSlot!, updatedRun!),
    );
  });
  if (isDeferredFailure(transactionResult)) throw transactionResult.error;
  return transactionResult;
}

export class PostgresCollabRelayStore implements CollabRelayStore {
  async enrol(
    projectId: string,
    input: CollabEnrolmentInput,
  ): Promise<EnrolmentResult> {
    const expectedIdempotencyKey =
      collabEnrolmentIdempotencyKey(input);
    if (input.idempotency_key !== expectedIdempotencyKey) {
      throw new CollabRelayError(
        "enrolment_idempotency_key_invalid",
        "Enrollment idempotency_key must be derived from the exact hash-only request intent.",
        400,
      );
    }
    const requestSha256 = collabSha256(input);

    return db.transaction(async (tx) => {
      await tx
        .insert(collabRepositories)
        .values({
          projectId,
          key: input.repository.key,
          provider: input.repository.provider,
          providerRepositoryId: input.repository.provider_repository_id,
          displayName: input.repository.display_name,
        })
        .onConflictDoNothing();
      const repositories = await tx
        .select()
        .from(collabRepositories)
        .where(
          and(
            eq(collabRepositories.projectId, projectId),
            or(
              eq(collabRepositories.key, input.repository.key),
              and(
                eq(collabRepositories.provider, input.repository.provider),
                eq(
                  collabRepositories.providerRepositoryId,
                  input.repository.provider_repository_id,
                ),
              ),
            ),
          ),
        )
        .for("update");
      let repository = repositories.find(
        (candidate) =>
          candidate.key === input.repository.key
          || (
            candidate.provider === input.repository.provider
            && candidate.providerRepositoryId
              === input.repository.provider_repository_id
          ),
      );
      if (
        repositories.length !== 1
        || !repository
        || repository.key !== input.repository.key
        || repository.provider !== input.repository.provider
        || repository.providerRepositoryId
          !== input.repository.provider_repository_id
      ) {
        throw new CollabRelayError(
          "enrolment_conflict",
          "The repository key or provider identity is already enrolled with different metadata.",
          409,
        );
      }
      const repositoryMetadataChanged =
        repository.displayName !== input.repository.display_name;

      await tx
        .insert(collabRepositoryStreams)
        .values({ projectId, repositoryId: repository.id })
        .onConflictDoNothing();
      const [stream] = await tx
        .select()
        .from(collabRepositoryStreams)
        .where(
          and(
            eq(collabRepositoryStreams.projectId, projectId),
            eq(collabRepositoryStreams.repositoryId, repository.id),
          ),
        )
        .for("update")
        .limit(1);
      if (!stream) {
        throw new CollabRelayError(
          "collab_stream_unavailable",
          "The repository coordination stream could not be initialized.",
          503,
        );
      }

      const [existingDevice] = await tx
        .select()
        .from(collabDevices)
        .where(
          and(
            eq(collabDevices.projectId, projectId),
            eq(collabDevices.repositoryId, repository.id),
            eq(collabDevices.id, input.device.id),
          ),
        )
        .for("update")
        .limit(1);
      const locked: LockedRepository = {
        tx,
        stream,
        now: await postgresNow(tx),
      };
      const receiptPrincipal: CollabPrincipal = {
        project_id: projectId,
        repository_id: repository.id,
        device_id: input.device.id,
        device_label: existingDevice?.label ?? input.device.label,
        token_prefix: existingDevice?.tokenPrefix ?? input.token.prefix,
        token_sha256: existingDevice?.tokenSha256 ?? input.token.sha256,
      };
      const replay = await existingReceipt<EnrolmentResult>(
        locked,
        receiptPrincipal,
        input.idempotency_key,
        "enrolment",
        requestSha256,
      );
      if (replay) {
        const stillCurrent =
          existingDevice !== undefined
          && existingDevice.active
          && existingDevice.revokedAt === null
          && existingDevice.version === replay.device.version
          && existingDevice.id === replay.device.id
          && existingDevice.id === input.device.id
          && existingDevice.label === input.device.label
          && existingDevice.tokenPrefix === input.token.prefix
          && existingDevice.tokenSha256 === input.token.sha256
          && existingDevice.profileSha256
            === input.observation_policy.profile_sha256
          && sameProviderPolicy(
            existingDevice.allowedObservationProviders,
            input.observation_policy.allowed_providers,
          )
          && repository.id === replay.repository.id
          && repository.key === input.repository.key
          && repository.provider === input.repository.provider
          && repository.providerRepositoryId
            === input.repository.provider_repository_id
          && repository.displayName === input.repository.display_name
          && replay.device.label === input.device.label
          && replay.device.token_prefix === input.token.prefix
          && replay.device.active
          && replay.observation_policy.profile_sha256
            === input.observation_policy.profile_sha256
          && sameProviderPolicy(
            replay.observation_policy.allowed_providers,
            input.observation_policy.allowed_providers,
          );
        if (!stillCurrent) {
          throw new CollabRelayError(
            "enrolment_replay_stale",
            "That enrollment receipt is historical and no longer matches the current device state.",
            409,
            {
              receipt_device_version: replay.device.version,
              current_device_version: existingDevice?.version ?? 0,
            },
          );
        }
        return replay;
      }

      const currentDeviceVersion = existingDevice?.version ?? 0;
      if (input.expected_device_version !== currentDeviceVersion) {
        throw new CollabRelayError(
          "device_version_conflict",
          "Enrollment expected_device_version does not match the current device version.",
          409,
          {
            expected_device_version: input.expected_device_version,
            current_device_version: currentDeviceVersion,
          },
        );
      }

      const [tokenOwner] = await tx
        .select({
          projectId: collabDevices.projectId,
          repositoryId: collabDevices.repositoryId,
          id: collabDevices.id,
        })
        .from(collabDevices)
        .where(eq(collabDevices.tokenSha256, input.token.sha256))
        .limit(1);
      if (
        tokenOwner
        && (
          tokenOwner.projectId !== projectId
          || tokenOwner.repositoryId !== repository.id
          || tokenOwner.id !== input.device.id
        )
      ) {
        throw new CollabRelayError(
          "enrolment_conflict",
          "That scoped token digest is already bound to another enrollment.",
          409,
        );
      }

      if (repositoryMetadataChanged) {
        const [updatedRepository] = await tx
          .update(collabRepositories)
          .set({
            displayName: input.repository.display_name,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(collabRepositories.projectId, projectId),
              eq(collabRepositories.id, repository.id),
            ),
          )
          .returning();
        repository = updatedRepository!;
      }

      let created = false;
      let device = existingDevice;
      let deviceEventType:
        | "device.enrolled"
        | "device.credential_rotated"
        | "device.metadata_updated"
        | null = null;
      if (existingDevice) {
        const credentialChanged =
          existingDevice.tokenPrefix !== input.token.prefix
          || existingDevice.tokenSha256 !== input.token.sha256;
        const observationPolicyChanged =
          existingDevice.profileSha256
            !== input.observation_policy.profile_sha256
          || !sameProviderPolicy(
            existingDevice.allowedObservationProviders,
            input.observation_policy.allowed_providers,
          );
        const metadataChanged =
          existingDevice.label !== input.device.label
          || !existingDevice.active
          || existingDevice.revokedAt !== null
          || observationPolicyChanged;
        if (
          credentialChanged
          || metadataChanged
          || repositoryMetadataChanged
        ) {
          [device] = await tx
            .update(collabDevices)
            .set({
              label: input.device.label,
              tokenPrefix: input.token.prefix,
              tokenSha256: input.token.sha256,
              profileSha256: input.observation_policy.profile_sha256,
              allowedObservationProviders:
                input.observation_policy.allowed_providers,
              active: true,
              version: existingDevice.version + 1,
              revokedAt: null,
            })
            .where(
              and(
                eq(collabDevices.projectId, projectId),
                eq(collabDevices.repositoryId, repository.id),
                eq(collabDevices.id, input.device.id),
              ),
            )
            .returning();
          deviceEventType = enrollmentDeviceEvent({
            exists: true,
            credential_changed: credentialChanged,
            metadata_changed: metadataChanged,
          });
        }
      } else {
        [device] = await tx
          .insert(collabDevices)
          .values({
            projectId,
            repositoryId: repository.id,
            id: input.device.id,
            label: input.device.label,
            tokenPrefix: input.token.prefix,
            tokenSha256: input.token.sha256,
            profileSha256: input.observation_policy.profile_sha256,
            allowedObservationProviders:
              input.observation_policy.allowed_providers,
            version: 1,
          })
          .returning();
        created = true;
        deviceEventType = enrollmentDeviceEvent({
          exists: false,
          credential_changed: false,
          metadata_changed: false,
        });
      }
      if (!device) {
        throw new CollabRelayError(
          "enrolment_failed",
          "The scoped collaboration device could not be enrolled.",
          503,
        );
      }

      if (deviceEventType || repositoryMetadataChanged) {
        await appendEvent(locked, {
          principal: {
            project_id: projectId,
            repository_id: repository.id,
            device_id: device.id,
            device_label: device.label,
            token_prefix: device.tokenPrefix,
            token_sha256: device.tokenSha256,
          },
          type: deviceEventType ?? "repository.metadata_updated",
          body: {
            device_id: device.id,
            device_label: device.label,
            token_prefix: device.tokenPrefix,
            device_version: device.version,
            profile_sha256: device.profileSha256,
            allowed_observation_providers:
              device.allowedObservationProviders,
            repository_display_name: repository.displayName,
            repository_metadata_changed: repositoryMetadataChanged,
          },
        });
      }

      const principal: CollabPrincipal = {
        project_id: projectId,
        repository_id: repository.id,
        device_id: device.id,
        device_label: device.label,
        token_prefix: device.tokenPrefix,
        token_sha256: device.tokenSha256,
      };
      return storeReceipt<EnrolmentResult>(
        locked,
        principal,
        input.idempotency_key,
        "enrolment",
        requestSha256,
        enrolmentResult(repository, device, created),
        created ? 201 : 200,
      );
    });
  }

  async authenticate(
    rawToken: string,
    options: { record_usage?: boolean } = {},
  ): Promise<CollabPrincipal | null> {
    if (!/^atc_[A-Za-z0-9_-]{43}$/.test(rawToken)) {
      return null;
    }
    const tokenPrefix = rawToken.slice(0, 12);
    const tokenSha256 = relayTokenSha256(rawToken);
    const candidates = await db
      .select()
      .from(collabDevices)
      .where(
        and(
          eq(collabDevices.tokenPrefix, tokenPrefix),
          eq(collabDevices.tokenSha256, tokenSha256),
          eq(collabDevices.active, true),
          isNull(collabDevices.revokedAt),
        ),
      );
    for (const candidate of candidates) {
      if (!safeEqualHex(candidate.tokenSha256, tokenSha256)) continue;
      if (options.record_usage !== false) {
        void db
          .update(collabDevices)
          .set({ lastUsedAt: sql`clock_timestamp()` })
          .where(
            and(
              eq(collabDevices.projectId, candidate.projectId),
              eq(collabDevices.repositoryId, candidate.repositoryId),
              eq(collabDevices.id, candidate.id),
            ),
          )
          .catch(() => {
            // Authentication succeeded. Usage time is best effort for writes.
          });
      }
      return {
        project_id: candidate.projectId,
        repository_id: candidate.repositoryId,
        device_id: candidate.id,
        device_label: candidate.label,
        token_prefix: candidate.tokenPrefix,
        token_sha256: candidate.tokenSha256,
      };
    }
    return null;
  }

  async listEvents(
    principal: CollabPrincipal,
    input: ListPageInput,
  ): Promise<CollabEventPage> {
    const rows = await db
      .select()
      .from(collabEvents)
      .where(
        and(
          eq(collabEvents.projectId, principal.project_id),
          eq(collabEvents.repositoryId, principal.repository_id),
          gt(collabEvents.sequence, input.after),
        ),
      )
      .orderBy(asc(collabEvents.sequence))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit).map(eventRecord);
    return {
      schema: "agenttool.collab-event-page/1",
      repository_id: principal.repository_id,
      events: page,
      next_after: page.at(-1)?.sequence ?? input.after,
      has_more: hasMore,
    };
  }

  async listOperations(
    principal: CollabPrincipal,
    input: ListOperationsInput,
  ): Promise<OperationPage> {
    return db.transaction(async (tx) => {
      const now = await postgresNow(tx);
      const conditions = [
        eq(collabOperationSlots.projectId, principal.project_id),
        eq(collabOperationSlots.repositoryId, principal.repository_id),
        gt(collabOperationSlots.sequence, input.after),
      ];
      if (input.operation) {
        conditions.push(eq(collabOperationSlots.operation, input.operation));
      }
      if (input.environment) {
        conditions.push(
          eq(collabOperationSlots.environment, input.environment),
        );
      }
      const rows = await tx
        .select()
        .from(collabOperationSlots)
        .where(and(...conditions))
        .orderBy(asc(collabOperationSlots.sequence))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const page = rows
        .slice(0, input.limit)
        .map((row) => effectiveSlotRecord(row, now));
      return {
        schema: "agenttool.collab-operation-page/1",
        repository_id: principal.repository_id,
        operations: page,
        next_after: hasMore
          ? page.at(-1)?.sequence ?? input.after
          : 0,
        has_more: hasMore,
      };
    });
  }

  async claim(
    principal: CollabPrincipal,
    input: OperationClaimInput,
  ): Promise<OperationResult> {
    const requestSha256 = collabSha256(input);
    const transactionResult = await db.transaction<
      OperationResult | DeferredFailure
    >(async (tx) => {
      const locked = await lockRepository(
        tx,
        principal.project_id,
        principal.repository_id,
      );
      await assertCurrentPrincipal(locked, principal);
      const replay = await existingReceipt<OperationResult>(
        locked,
        principal,
        input.idempotency_key,
        "operation.claim",
        requestSha256,
      );
      if (replay) {
        return validateActionableReplay(
          locked,
          principal,
          replay,
          "claim",
        );
      }

      const [existingAction] = await tx
        .select({ actionId: collabOperationRuns.actionId })
        .from(collabOperationRuns)
        .where(
          and(
            eq(collabOperationRuns.projectId, principal.project_id),
            eq(collabOperationRuns.repositoryId, principal.repository_id),
            eq(collabOperationRuns.actionId, input.action_id),
          ),
        )
        .limit(1);
      if (existingAction) {
        throw new CollabRelayError(
          "action_id_conflict",
          "That action ID already names a durable operation run.",
          409,
        );
      }

      let [slot] = await tx
        .select()
        .from(collabOperationSlots)
        .where(
          and(
            eq(collabOperationSlots.projectId, principal.project_id),
            eq(collabOperationSlots.repositoryId, principal.repository_id),
            eq(collabOperationSlots.operation, input.operation),
            eq(collabOperationSlots.environment, input.environment),
          ),
        )
        .for("update")
        .limit(1);
      if (
        slot
        && (slot.phase === "claimed" || slot.phase === "executing")
        && slot.leaseExpiresAt
        && slot.leaseExpiresAt.getTime() <= locked.now.getTime()
        && slot.actionId
      ) {
        const [expiredRun] = await tx
          .select()
          .from(collabOperationRuns)
          .where(
            and(
              eq(collabOperationRuns.projectId, principal.project_id),
              eq(collabOperationRuns.repositoryId, principal.repository_id),
              eq(collabOperationRuns.actionId, slot.actionId),
            ),
          )
          .limit(1);
        if (expiredRun) {
          ({ slot } = await transitionExpiredSlot(
            locked,
            principal,
            slot,
            expiredRun,
          ));
        }
      }
      if (slot && slot.phase === "recovery_required") {
        return {
          error: new CollabRelayError(
            "recovery_required",
            "A prior executing action has uncertain provider state and must be recovered before another claim.",
            409,
            {
              action_id: slot.actionId,
              version: slot.version,
              generation: slot.generation,
            },
          ),
        };
      }
      if (slot && slot.phase !== "idle") {
        throw new CollabRelayError(
          "operation_contended",
          "Another device or session currently holds this repository operation slot.",
          409,
          {
            action_id: slot.actionId,
            holder_device_id: slot.holderDeviceId,
            session_id: slot.sessionId,
            actor_label: slot.actorLabel,
            lease_expires_at: slot.leaseExpiresAt
              ? iso(slot.leaseExpiresAt)
              : null,
            version: slot.version,
            generation: slot.generation,
          },
        );
      }

      const generation = (slot?.generation ?? 0) + 1;
      const version = (slot?.version ?? 0) + 1;
      const leaseId = randomUUID();
      const leaseExpiresAt = new Date(
        locked.now.getTime() + input.lease_seconds * 1_000,
      );
      const event = await appendEvent(locked, {
        principal,
        type: "operation.claimed",
        session_id: input.session_id,
        actor_label: input.actor_label,
        body: {
          action_id: input.action_id,
          operation: input.operation,
          environment: input.environment,
          target: input.target,
          source_revision: input.source_revision,
          parameters_sha256: input.parameters_sha256,
          generation,
          lease_id: leaseId,
          lease_expires_at: leaseExpiresAt.toISOString(),
          authority: {
            kind: "coordination_only",
            provider_authority_granted: false,
          },
        },
      });
      const slotValues = {
        sequence: event.sequence,
        phase: "claimed",
        actionId: input.action_id,
        holderDeviceId: principal.device_id,
        sessionId: input.session_id,
        actorLabel: input.actor_label ?? null,
        leaseId,
        leaseExpiresAt,
        version,
        generation,
        target: input.target,
        sourceRevision: input.source_revision,
        parametersSha256: input.parameters_sha256,
        updatedAt: locked.now,
      } as const;
      let updatedSlot: SlotRow | undefined;
      if (slot) {
        [updatedSlot] = await tx
          .update(collabOperationSlots)
          .set(slotValues)
          .where(
            and(
              eq(collabOperationSlots.projectId, principal.project_id),
              eq(collabOperationSlots.repositoryId, principal.repository_id),
              eq(collabOperationSlots.operation, input.operation),
              eq(collabOperationSlots.environment, input.environment),
            ),
          )
          .returning();
      } else {
        [updatedSlot] = await tx
          .insert(collabOperationSlots)
          .values({
            projectId: principal.project_id,
            repositoryId: principal.repository_id,
            operation: input.operation,
            environment: input.environment,
            ...slotValues,
          })
          .returning();
      }
      const [run] = await tx
        .insert(collabOperationRuns)
        .values({
          projectId: principal.project_id,
          repositoryId: principal.repository_id,
          actionId: input.action_id,
          operation: input.operation,
          environment: input.environment,
          deviceId: principal.device_id,
          sessionId: input.session_id,
          actorLabel: input.actor_label ?? null,
          status: "claimed",
          leaseId,
          generation,
          target: input.target,
          sourceRevision: input.source_revision,
          parametersSha256: input.parameters_sha256,
          claimedAt: locked.now,
          updatedAt: locked.now,
        })
        .returning();
      return storeReceipt(
        locked,
        principal,
        input.idempotency_key,
        "operation.claim",
        requestSha256,
        operationResult(updatedSlot!, run!),
      );
    });
    if (isDeferredFailure(transactionResult)) throw transactionResult.error;
    return transactionResult;
  }

  renew(
    principal: CollabPrincipal,
    input: OperationRenewInput,
  ): Promise<OperationResult> {
    return fencedMutation(principal, input, "renew");
  }

  begin(
    principal: CollabPrincipal,
    input: OperationBeginInput,
  ): Promise<OperationResult> {
    return fencedMutation(principal, input, "begin");
  }

  complete(
    principal: CollabPrincipal,
    input: OperationCompleteInput,
  ): Promise<OperationResult> {
    return fencedMutation(principal, input, "complete");
  }

  release(
    principal: CollabPrincipal,
    input: OperationReleaseInput,
  ): Promise<OperationResult> {
    return fencedMutation(principal, input, "release");
  }

  async recover(
    principal: CollabPrincipal,
    input: OperationRecoverInput,
  ): Promise<OperationResult> {
    const requestSha256 = collabSha256(input);
    return db.transaction(async (tx) => {
      const locked = await lockRepository(
        tx,
        principal.project_id,
        principal.repository_id,
      );
      await assertCurrentPrincipal(locked, principal);
      const replay = await existingReceipt<OperationResult>(
        locked,
        principal,
        input.idempotency_key,
        "operation.recover",
        requestSha256,
      );
      if (replay) return replay;
      let { slot, run } = await readSlotAndRun(
        locked,
        principal,
        input.action_id,
      );
      if (
        (slot.phase === "claimed" || slot.phase === "executing")
        && slot.leaseExpiresAt
        && slot.leaseExpiresAt.getTime() <= locked.now.getTime()
      ) {
        ({ slot, run } = await transitionExpiredSlot(
          locked,
          principal,
          slot,
          run,
        ));
      }
      if (slot.phase !== "recovery_required") {
        throw new CollabRelayError(
          "invalid_transition",
          "Only a recovery-required operation can be reconciled.",
          409,
        );
      }
      assertRecoveryBinding(slot, run, input);
      await assertEvidenceReferences(
        locked,
        principal,
        run.actionId,
        input.observation_ids,
      );
      const event = await appendEvent(locked, {
        principal,
        type: "operation.recovered",
        session_id: input.session_id,
        actor_label: input.actor_label,
        body: {
          action_id: run.actionId,
          operation: run.operation,
          environment: run.environment,
          generation: run.generation,
          disposition: input.disposition,
          reason: input.reason,
          recovering_device_id: principal.device_id,
          recovering_session_id: input.session_id,
          ...(input.actor_label
            ? { recovering_actor_label: input.actor_label }
            : {}),
          ...(input.receipt_ref ? { receipt_ref: input.receipt_ref } : {}),
          ...(input.observation_ids
            ? { observation_ids: input.observation_ids }
            : {}),
        },
      });
      const remainsBlocked = input.disposition === "uncertain";
      const [updatedRun] = await tx
        .update(collabOperationRuns)
        .set({
          status: input.disposition,
          completedAt: remainsBlocked ? null : locked.now,
          updatedAt: locked.now,
        })
        .where(
          and(
            eq(collabOperationRuns.projectId, principal.project_id),
            eq(collabOperationRuns.repositoryId, principal.repository_id),
            eq(collabOperationRuns.actionId, run.actionId),
          ),
        )
        .returning();
      const [updatedSlot] = await tx
        .update(collabOperationSlots)
        .set(
          remainsBlocked
            ? {
                sequence: event.sequence,
                holderDeviceId: principal.device_id,
                sessionId: input.session_id,
                actorLabel: input.actor_label ?? null,
                version: slot.version + 1,
                updatedAt: locked.now,
              }
            : idleSlotValues(locked.now, event.sequence, slot.version + 1),
        )
        .where(
          and(
            eq(collabOperationSlots.projectId, principal.project_id),
            eq(collabOperationSlots.repositoryId, principal.repository_id),
            eq(collabOperationSlots.operation, slot.operation),
            eq(collabOperationSlots.environment, slot.environment),
          ),
        )
        .returning();
      return storeReceipt(
        locked,
        principal,
        input.idempotency_key,
        "operation.recover",
        requestSha256,
        operationResult(updatedSlot!, updatedRun!),
      );
    });
  }

  async importObservation(
    principal: CollabPrincipal,
    input: ProviderObservationInput,
  ): Promise<ProviderObservationResult> {
    const requestSha256 = collabSha256(input);
    const observationSha256 =
      providerObservationProjectionSha256(input);
    return db.transaction(async (tx) => {
      const locked = await lockRepository(
        tx,
        principal.project_id,
        principal.repository_id,
      );
      await assertCurrentPrincipal(locked, principal);
      const replay = await existingReceipt<ProviderObservationResult>(
        locked,
        principal,
        input.idempotency_key,
        "provider.observe",
        requestSha256,
      );
      if (replay) return replay;

      const [devicePolicy] = await tx
        .select({
          active: collabDevices.active,
          revokedAt: collabDevices.revokedAt,
          allowedProviders: collabDevices.allowedObservationProviders,
        })
        .from(collabDevices)
        .where(
          and(
            eq(collabDevices.projectId, principal.project_id),
            eq(collabDevices.repositoryId, principal.repository_id),
            eq(collabDevices.id, principal.device_id),
          ),
        )
        .limit(1);
      if (
        !devicePolicy?.active
        || devicePolicy.revokedAt !== null
        || !devicePolicy.allowedProviders.includes(input.provider)
      ) {
        throw new CollabRelayError(
          "provider_not_enabled",
          "This enrolled device profile does not enable observations for that provider.",
          403,
        );
      }

      if (input.provider_event_id) {
        const [existing] = await tx
          .select()
          .from(collabProviderObservations)
          .where(
            and(
              eq(
                collabProviderObservations.projectId,
                principal.project_id,
              ),
              eq(
                collabProviderObservations.repositoryId,
                principal.repository_id,
              ),
              eq(collabProviderObservations.provider, input.provider),
              eq(
                collabProviderObservations.providerEventId,
                input.provider_event_id,
              ),
            ),
          )
          .limit(1);
        if (existing) {
          if (existing.canonicalRequestSha256 !== observationSha256) {
            throw new CollabRelayError(
              "provider_event_mismatch",
              "That provider event ID already names different normalized observation bytes.",
              409,
            );
          }
          return storeReceipt(
            locked,
            principal,
            input.idempotency_key,
            "provider.observe",
            requestSha256,
            {
              schema: "agenttool.collab-provider-observation-result/1",
              replayed: false,
              deduplicated: true,
              observation: observationRecord(existing),
            },
          );
        }
      }

      if (input.action_id) {
        const [run] = await tx
          .select({ actionId: collabOperationRuns.actionId })
          .from(collabOperationRuns)
          .where(
            and(
              eq(collabOperationRuns.projectId, principal.project_id),
              eq(collabOperationRuns.repositoryId, principal.repository_id),
              eq(collabOperationRuns.actionId, input.action_id),
            ),
          )
          .limit(1);
        if (!run) {
          throw new CollabRelayError(
            "operation_not_found",
            "The observation action ID does not exist in this repository.",
            404,
          );
        }
      }
      const observationId = randomUUID();
      const event = await appendEvent(locked, {
        principal,
        type: "provider.observed",
        session_id: input.session_id,
        actor_label: input.actor_label,
        body: {
          observation_id: observationId,
          provider: input.provider,
          provider_event_id: input.provider_event_id ?? null,
          action_id: input.action_id ?? null,
          provenance: "device_observed",
          observed_at: input.observed_at,
          occurred_at: input.occurred_at ?? null,
          normalized_state: input.normalized_state,
          source_revision: input.source_revision ?? null,
          environment: input.environment ?? null,
          resource_kind: input.resource_kind,
          resource_id: input.resource_id,
          native_state: input.native_state,
          url: input.url ?? null,
          payload_sha256: input.payload_sha256,
        },
      });
      const [observation] = await tx
        .insert(collabProviderObservations)
        .values({
          projectId: principal.project_id,
          repositoryId: principal.repository_id,
          sequence: event.sequence,
          observationId,
          provider: input.provider,
          providerEventId: input.provider_event_id ?? null,
          actionId: input.action_id ?? null,
          observingDeviceId: principal.device_id,
          observingSessionId: input.session_id,
          actorLabel: input.actor_label ?? null,
          observedAt: new Date(input.observed_at),
          occurredAt: input.occurred_at
            ? new Date(input.occurred_at)
            : null,
          normalizedState: input.normalized_state,
          sourceRevision: input.source_revision ?? null,
          environment: input.environment ?? null,
          resourceKind: input.resource_kind,
          resourceId: input.resource_id,
          nativeState: input.native_state,
          url: input.url ?? null,
          payloadSha256: input.payload_sha256,
          canonicalRequestSha256: observationSha256,
          receivedAt: locked.now,
        })
        .returning();
      return storeReceipt(
        locked,
        principal,
        input.idempotency_key,
        "provider.observe",
        requestSha256,
        {
          schema: "agenttool.collab-provider-observation-result/1",
          replayed: false,
          deduplicated: false,
          observation: observationRecord(observation!),
        },
      );
    });
  }

  async listObservations(
    principal: CollabPrincipal,
    input: ListPageInput,
  ): Promise<ProviderObservationPage> {
    const rows = await db
      .select()
      .from(collabProviderObservations)
      .where(
        and(
          eq(
            collabProviderObservations.projectId,
            principal.project_id,
          ),
          eq(
            collabProviderObservations.repositoryId,
            principal.repository_id,
          ),
          gt(collabProviderObservations.sequence, input.after),
        ),
      )
      .orderBy(asc(collabProviderObservations.sequence))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit).map(observationRecord);
    return {
      schema: "agenttool.collab-provider-observation-page/1",
      repository_id: principal.repository_id,
      observations: page,
      next_after: page.at(-1)?.sequence ?? input.after,
      has_more: hasMore,
    };
  }
}

export const postgresCollabRelayStore = new PostgresCollabRelayStore();
