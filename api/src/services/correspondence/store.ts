/** Durable Renaissance Correspondence store.
 *
 * Events are immutable. A project-local stream row serializes receipt order;
 * sender clocks and issued_at never decide replay order. Claim lineage is a
 * rebuildable projection with no lock semantics and no last-write-wins rule.
 * Doctrine: docs/AGENT-CORRESPONDENCE.md. */

import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";

import { db } from "../../db/client";
import {
  correspondenceClaimReconcileQueue,
  correspondenceClaimEvents,
  correspondenceEvents,
  correspondenceProjectStreams,
} from "../../db/schema/correspondence";
import { identities, identityKeys } from "../../db/schema/identity";
import {
  correspondenceCanonicalEnvelope,
  correspondenceCore,
  correspondenceEventId,
  verifyCorrespondenceSignature,
} from "./canonical";
import {
  CORRESPONDENCE_PROTOCOL,
  CORRESPONDENCE_SCOPE,
  DEFAULT_EVENT_PAGE,
  isClaimKind,
  MAX_ACTIVE_CLAIMS,
  MAX_EVENT_PAGE,
  MAX_VOICE_CONFLICTS,
  MAX_VOICE_RECENT_EVENTS,
  overlappingPathPrefixes,
  type ClaimLineageStatus,
  type CorrespondenceEvent,
} from "./contracts";
import { MAX_CORRESPONDENCE_REQUEST_BYTES } from "./strict-json";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ReadExecutor = typeof db | Transaction;
type EventRow = typeof correspondenceEvents.$inferSelect;
type ClaimEventRow = typeof correspondenceClaimEvents.$inferSelect;

export interface CorrespondenceReceipt {
  received_seq: string;
  received_at: string;
}

export interface CorrespondenceRecord {
  event: CorrespondenceEvent;
  receipt: CorrespondenceReceipt;
  missing_parents: string[];
  lineage_status: ClaimLineageStatus;
}

export type CorrespondenceWarningCode =
  | "session_fork"
  | "claim_lineage_pending";

export interface CorrespondenceWarning {
  code: CorrespondenceWarningCode;
  detail: string;
  event_ids?: string[];
  paths?: string[];
}

export interface AppendCorrespondenceResult extends CorrespondenceRecord {
  warnings: CorrespondenceWarning[];
  created: boolean;
}

export interface CorrespondenceEventPage {
  protocol: typeof CORRESPONDENCE_PROTOCOL;
  scope: typeof CORRESPONDENCE_SCOPE;
  events: CorrespondenceRecord[];
  page: {
    after: string | null;
    next_after: string | null;
    has_more: boolean;
  };
}

export interface ActiveCorrespondenceClaim {
  claim_id: string;
  generation: number;
  event_id: string;
  owner_identity_id: string;
  device_id: string;
  session_id: string;
  thread_id: string;
  scope: {
    base_revision: string | null;
    branch: string | null;
    paths: string[];
  };
  expires_at: string;
  conflicted: boolean;
  competing_event_ids: string[];
}

export type ProjectionStatus = "complete" | "truncated" | "unavailable";

export interface ActiveClaimsProjection {
  protocol: typeof CORRESPONDENCE_PROTOCOL;
  scope: typeof CORRESPONDENCE_SCOPE;
  evaluated_at: string;
  cursor: string | null;
  projection_status: ProjectionStatus;
  truncated: boolean;
  claims: ActiveCorrespondenceClaim[];
}

export interface CorrespondenceVoice {
  protocol: typeof CORRESPONDENCE_PROTOCOL;
  scope: typeof CORRESPONDENCE_SCOPE;
  evaluated_at: string;
  cursor: string | null;
  projection_status: ProjectionStatus;
  truncated: boolean;
  recent_events: CorrespondenceRecord[];
  active_claims: ActiveCorrespondenceClaim[];
  conflicts: {
    missing_parents: Array<{ event_id: string; missing_parent_ids: string[] }>;
    session_forks: Array<{
      identity_id: string;
      device_id: string;
      session_id: string;
      session_seq: number;
      event_ids: string[];
    }>;
    overlapping_claims: Array<{
      left_event_id: string;
      right_event_id: string;
      paths: string[];
    }>;
  };
}

export class CorrespondenceFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 403 | 409 | 413 | 503,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "CorrespondenceFailure";
  }
}

function eventFromRow(row: EventRow): CorrespondenceEvent {
  return {
    ...(row.core as Omit<CorrespondenceEvent, "event_id" | "signature">),
    event_id: row.eventId,
    signature: {
      algorithm: "Ed25519",
      value_b64url: row.signature,
    },
  };
}

function asReadDb(executor: ReadExecutor): typeof db {
  // Drizzle transactions expose the same select/execute surface used here.
  return executor as typeof db;
}

async function currentCursor(
  executor: ReadExecutor,
  projectId: string,
): Promise<string | null> {
  const queryDb = asReadDb(executor);
  const [row] = await queryDb
    .select({ lastReceivedSeq: correspondenceProjectStreams.lastReceivedSeq })
    .from(correspondenceProjectStreams)
    .where(eq(correspondenceProjectStreams.projectId, projectId))
    .limit(1);
  return row && row.lastReceivedSeq > 0n
    ? row.lastReceivedSeq.toString()
    : null;
}

async function projectStreamState(
  executor: ReadExecutor,
  projectId: string,
): Promise<{
  cursor: string | null;
  updatedAt: Date | null;
  claimProjectionIncomplete: boolean;
  claimProjectionUpdatedAt: Date;
}> {
  const [row] = await asReadDb(executor)
    .select({
      lastReceivedSeq: correspondenceProjectStreams.lastReceivedSeq,
      claimProjectionIncomplete:
        correspondenceProjectStreams.claimProjectionIncomplete,
      claimProjectionUpdatedAt:
        correspondenceProjectStreams.claimProjectionUpdatedAt,
      updatedAt: correspondenceProjectStreams.updatedAt,
    })
    .from(correspondenceProjectStreams)
    .where(eq(correspondenceProjectStreams.projectId, projectId))
    .limit(1);
  return row
    ? {
        cursor: row.lastReceivedSeq > 0n ? row.lastReceivedSeq.toString() : null,
        updatedAt: row.lastReceivedSeq > 0n ? row.updatedAt : null,
        claimProjectionIncomplete: row.claimProjectionIncomplete,
        claimProjectionUpdatedAt: row.claimProjectionUpdatedAt,
      }
    : {
        cursor: null,
        updatedAt: null,
        claimProjectionIncomplete: false,
        claimProjectionUpdatedAt: new Date(0),
      };
}

async function databaseClock(executor: ReadExecutor): Promise<Date> {
  const rows = await asReadDb(executor).execute<{ now: Date }>(
    sql`SELECT clock_timestamp() AS now`,
  );
  return new Date((rows[0] as { now: Date }).now);
}

async function recordsFromRows(
  executor: ReadExecutor,
  projectId: string,
  rows: readonly EventRow[],
): Promise<CorrespondenceRecord[]> {
  if (rows.length === 0) return [];
  const queryDb = asReadDb(executor);
  const parentIds = [
    ...new Set(rows.flatMap((row) => row.parents)),
  ];
  const existingParents = new Set<string>();
  if (parentIds.length > 0) {
    const found = await queryDb
      .select({ eventId: correspondenceEvents.eventId })
      .from(correspondenceEvents)
      .where(
        and(
          eq(correspondenceEvents.projectId, projectId),
          inArray(correspondenceEvents.eventId, parentIds),
        ),
      );
    for (const row of found) existingParents.add(row.eventId);
  }

  const eventIds = rows.map((row) => row.eventId);
  const claimStatuses = await queryDb
    .select({
      eventId: correspondenceClaimEvents.eventId,
      lineageStatus: correspondenceClaimEvents.lineageStatus,
    })
    .from(correspondenceClaimEvents)
    .where(
      and(
        eq(correspondenceClaimEvents.projectId, projectId),
        inArray(correspondenceClaimEvents.eventId, eventIds),
      ),
    );
  const statusById = new Map(
    claimStatuses.map((row) => [row.eventId, row.lineageStatus as ClaimLineageStatus]),
  );

  return rows.map((row) => ({
    event: eventFromRow(row),
    receipt: {
      received_seq: row.receivedSeq.toString(),
      received_at: row.receivedAt.toISOString(),
    },
    missing_parents: row.parents.filter((parent) => !existingParents.has(parent)),
    lineage_status: statusById.get(row.eventId) ?? "not_applicable",
  }));
}

function samePathSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((path, index) => path === [...right].sort()[index])
  );
}

async function evaluateClaimLineage(
  tx: Transaction,
  claim: ClaimEventRow,
): Promise<"valid" | "pending" | "invalid"> {
  if (claim.generation === 1) {
    return claim.eventKind === "claim.open" && claim.predecessorEventId === null
      ? "valid"
      : "invalid";
  }
  if (!claim.predecessorEventId) return "invalid";
  const [predecessor] = await tx
    .select()
    .from(correspondenceClaimEvents)
    .where(
      and(
        eq(correspondenceClaimEvents.projectId, claim.projectId),
        eq(correspondenceClaimEvents.eventId, claim.predecessorEventId),
      ),
    )
    .limit(1);

  if (!predecessor) {
    const [ordinaryEvent] = await tx
      .select({ eventId: correspondenceEvents.eventId })
      .from(correspondenceEvents)
      .where(
        and(
          eq(correspondenceEvents.projectId, claim.projectId),
          eq(correspondenceEvents.eventId, claim.predecessorEventId),
        ),
      )
      .limit(1);
    return ordinaryEvent ? "invalid" : "pending";
  }
  if (predecessor.lineageStatus === "pending") return "pending";
  if (predecessor.lineageStatus === "invalid") return "invalid";
  if (
    predecessor.eventKind === "claim.release" ||
    predecessor.repositoryId !== claim.repositoryId ||
    predecessor.claimId !== claim.claimId ||
    predecessor.ownerIdentityId !== claim.ownerIdentityId ||
    predecessor.generation + 1 !== claim.generation ||
    !samePathSet(predecessor.scopePaths, claim.scopePaths)
  ) {
    return "invalid";
  }
  return "valid";
}

/** Append work is serialized while the project stream row is locked, so this
 * must remain a small operational bound rather than a protocol-sized integer. */
export const CLAIM_LINEAGE_RECONCILE_BATCH = 32;

function pendingChildrenCondition(projectId: string, predecessorEventId: string) {
  return and(
    eq(correspondenceClaimEvents.projectId, projectId),
    eq(correspondenceClaimEvents.lineageStatus, "pending"),
    eq(
      correspondenceClaimEvents.predecessorEventId,
      predecessorEventId,
    ),
  );
}

/** Queue only ready predecessors that actually have pending direct children.
 * Point lookup through the partial predecessor index keeps enqueue work
 * independent of unrelated missing-predecessor history. */
async function enqueueReadyClaimPredecessor(
  tx: Transaction,
  projectId: string,
  predecessorEventId: string,
): Promise<void> {
  const [pendingChild] = await tx
    .select({ eventId: correspondenceClaimEvents.eventId })
    .from(correspondenceClaimEvents)
    .where(pendingChildrenCondition(projectId, predecessorEventId))
    .limit(1);
  if (!pendingChild) return;
  await tx
    .insert(correspondenceClaimReconcileQueue)
    .values({ projectId, predecessorEventId })
    .onConflictDoNothing();
}

/** Resolve at most one fixed project-wide frontier batch. Both child lookup
 * and queue order are indexed; reverse chains and very wide sibling sets can
 * advance within the same 32-work-item budget without scanning unrelated
 * unresolved rows. The durable stream flag exposes any remainder. */
async function reconcilePendingClaimBatch(
  tx: Transaction,
  projectId: string,
): Promise<{ incomplete: boolean; changed: boolean }> {
  let workItems = 0;
  let changed = false;
  while (workItems < CLAIM_LINEAGE_RECONCILE_BATCH) {
    const [frontier] = await tx
      .select()
      .from(correspondenceClaimReconcileQueue)
      .where(eq(correspondenceClaimReconcileQueue.projectId, projectId))
      .orderBy(
        asc(correspondenceClaimReconcileQueue.enqueuedAt),
        asc(correspondenceClaimReconcileQueue.predecessorEventId),
      )
      .for("update")
      .limit(1);
    if (!frontier) break;

    const candidates = await tx
      .select()
      .from(correspondenceClaimEvents)
      .where(
        pendingChildrenCondition(projectId, frontier.predecessorEventId),
      )
      .orderBy(
        asc(correspondenceClaimEvents.statusUpdatedAt),
        asc(correspondenceClaimEvents.eventId),
      )
      .limit(CLAIM_LINEAGE_RECONCILE_BATCH - workItems);
    if (candidates.length === 0) {
      await tx
        .delete(correspondenceClaimReconcileQueue)
        .where(
          and(
            eq(correspondenceClaimReconcileQueue.projectId, projectId),
            eq(
              correspondenceClaimReconcileQueue.predecessorEventId,
              frontier.predecessorEventId,
            ),
          ),
        );
      workItems += 1;
      continue;
    }

    for (const child of candidates) {
      workItems += 1;
      const status = await evaluateClaimLineage(tx, child);
      // Queue producers add only ordinary or non-pending claim predecessors.
      // Retain the guard so a corrupt frontier stays visible, bounded, and
      // retryable instead of being guessed valid or invalid.
      if (status === "pending") continue;
      await tx
        .update(correspondenceClaimEvents)
        .set({
          lineageStatus: status,
          isTip: status === "valid",
          statusUpdatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(correspondenceClaimEvents.projectId, projectId),
            eq(correspondenceClaimEvents.eventId, child.eventId),
            eq(correspondenceClaimEvents.lineageStatus, "pending"),
          ),
        );
      changed = true;
      if (status === "valid" && child.predecessorEventId) {
        await tx
          .update(correspondenceClaimEvents)
          .set({ isTip: false, statusUpdatedAt: sql`clock_timestamp()` })
          .where(
            and(
              eq(correspondenceClaimEvents.projectId, projectId),
              eq(correspondenceClaimEvents.eventId, child.predecessorEventId),
              eq(correspondenceClaimEvents.lineageStatus, "valid"),
              eq(correspondenceClaimEvents.isTip, true),
            ),
          );
      }
      await enqueueReadyClaimPredecessor(tx, projectId, child.eventId);
    }

    const [remainingChild] = await tx
      .select({ eventId: correspondenceClaimEvents.eventId })
      .from(correspondenceClaimEvents)
      .where(
        pendingChildrenCondition(projectId, frontier.predecessorEventId),
      )
      .limit(1);
    if (remainingChild) {
      // Rotate wide frontiers so independent ready branches are not starved.
      await tx
        .update(correspondenceClaimReconcileQueue)
        .set({ enqueuedAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(correspondenceClaimReconcileQueue.projectId, projectId),
            eq(
              correspondenceClaimReconcileQueue.predecessorEventId,
              frontier.predecessorEventId,
            ),
          ),
        );
    } else {
      await tx
        .delete(correspondenceClaimReconcileQueue)
        .where(
          and(
            eq(correspondenceClaimReconcileQueue.projectId, projectId),
            eq(
              correspondenceClaimReconcileQueue.predecessorEventId,
              frontier.predecessorEventId,
            ),
          ),
        );
    }
  }

  const [remaining] = await tx
    .select({ eventId: correspondenceClaimReconcileQueue.predecessorEventId })
    .from(correspondenceClaimReconcileQueue)
    .where(eq(correspondenceClaimReconcileQueue.projectId, projectId))
    .limit(1);
  return { incomplete: remaining !== undefined, changed };
}

/** Claims/voice reads are also bounded reconciliation opportunities. The
 * stream lock lives only in this short mutation transaction and is released
 * before the potentially selective projection query starts. The later
 * repeatable-read snapshot observes either side of any intervening append and
 * its durable incomplete flag, so it remains honest without blocking appends
 * behind a rare focused scan. */
async function reconcileClaimProjectionForRead(
  projectId: string,
): Promise<void> {
  const [stream] = await db
    .select({
      claimProjectionIncomplete:
        correspondenceProjectStreams.claimProjectionIncomplete,
    })
    .from(correspondenceProjectStreams)
    .where(eq(correspondenceProjectStreams.projectId, projectId))
    .limit(1);
  if (!stream || !stream.claimProjectionIncomplete) return;

  await db.transaction(async (tx) => {
    const [lockedStream] = await tx
      .select({
        claimProjectionIncomplete:
          correspondenceProjectStreams.claimProjectionIncomplete,
      })
      .from(correspondenceProjectStreams)
      .where(eq(correspondenceProjectStreams.projectId, projectId))
      .for("update")
      .limit(1);
    if (!lockedStream || !lockedStream.claimProjectionIncomplete) return;

    const reconciliation = await reconcilePendingClaimBatch(tx, projectId);
    if (
      reconciliation.changed ||
      reconciliation.incomplete !== lockedStream.claimProjectionIncomplete
    ) {
      await tx
        .update(correspondenceProjectStreams)
        .set({
          claimProjectionIncomplete: reconciliation.incomplete,
          ...(reconciliation.changed
            ? { claimProjectionUpdatedAt: sql`clock_timestamp()` }
            : {}),
        })
        .where(eq(correspondenceProjectStreams.projectId, projectId));
    }
  });
}

async function insertClaimProjection(
  tx: Transaction,
  event: CorrespondenceEvent,
): Promise<"valid" | "pending" | "invalid"> {
  const body = event.body as {
    claim_id: string;
    generation: number;
    predecessor_event_id?: string;
    expires_at?: string;
  };
  const provisional: typeof correspondenceClaimEvents.$inferInsert = {
    projectId: event.project_id,
    eventId: event.event_id,
    repositoryId: event.repository_id,
    claimId: body.claim_id,
    generation: body.generation,
    predecessorEventId: body.predecessor_event_id ?? null,
    eventKind: event.kind,
    ownerIdentityId: event.sender.identity_id,
    deviceId: event.sender.device_id,
    sessionId: event.sender.session_id,
    scopePaths: event.scope.paths,
    expiresAt: body.expires_at ? new Date(body.expires_at) : null,
    lineageStatus: event.kind === "claim.open" ? "valid" : "pending",
  };
  const row = provisional as ClaimEventRow;
  const status = await evaluateClaimLineage(tx, row);
  await tx.insert(correspondenceClaimEvents).values({
    ...provisional,
    lineageStatus: status,
    isTip: status === "valid",
  });
  if (status === "valid" && provisional.predecessorEventId) {
    await tx
      .update(correspondenceClaimEvents)
      .set({ isTip: false, statusUpdatedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(correspondenceClaimEvents.projectId, event.project_id),
          eq(
            correspondenceClaimEvents.eventId,
            provisional.predecessorEventId,
          ),
          eq(correspondenceClaimEvents.lineageStatus, "valid"),
          eq(correspondenceClaimEvents.isTip, true),
        ),
      );
  }
  return status;
}

async function sessionForkEventIds(
  executor: ReadExecutor,
  event: CorrespondenceEvent,
): Promise<string[]> {
  const rows = await asReadDb(executor)
    .select({ eventId: correspondenceEvents.eventId })
    .from(correspondenceEvents)
    .where(
      and(
        eq(correspondenceEvents.projectId, event.project_id),
        eq(correspondenceEvents.senderIdentityId, event.sender.identity_id),
        eq(correspondenceEvents.deviceId, event.sender.device_id),
        eq(correspondenceEvents.sessionId, event.sender.session_id),
        eq(correspondenceEvents.sessionSeq, event.session_seq),
      ),
    )
    .orderBy(asc(correspondenceEvents.eventId))
    // One sentinel is enough to know this tuple forked; warning output is
    // bounded to 16 IDs and append latency must not scale with fork abuse.
    .limit(MAX_COMPETING_TIP_IDS + 1);
  return rows.map((row) => row.eventId);
}

export interface DurableAppend {
  record: CorrespondenceRecord;
  created: boolean;
  sessionForkIds: string[];
}

async function appendDurably(
  projectId: string,
  event: CorrespondenceEvent,
  canonicalEnvelope: string,
): Promise<DurableAppend> {
  return db.transaction(async (tx) => {
    await tx
      .insert(correspondenceProjectStreams)
      .values({ projectId })
      .onConflictDoNothing();
    const [stream] = await tx
      .select()
      .from(correspondenceProjectStreams)
      .where(eq(correspondenceProjectStreams.projectId, projectId))
      .for("update")
      .limit(1);
    if (!stream) {
      throw new CorrespondenceFailure(
        "correspondence_stream_unavailable",
        "The project correspondence stream could not be initialized.",
        503,
      );
    }

    const [existing] = await tx
      .select()
      .from(correspondenceEvents)
      .where(
        and(
          eq(correspondenceEvents.projectId, projectId),
          eq(correspondenceEvents.eventId, event.event_id),
        ),
      )
      .limit(1);
    if (existing) {
      if (existing.canonicalEnvelope !== canonicalEnvelope) {
        throw new CorrespondenceFailure(
          "event_id_collision",
          "That event_id already names different canonical signed bytes.",
          409,
        );
      }
      if (stream.claimProjectionIncomplete) {
        const reconciliation = await reconcilePendingClaimBatch(tx, projectId);
        if (
          reconciliation.changed ||
          reconciliation.incomplete !== stream.claimProjectionIncomplete
        ) {
          await tx
            .update(correspondenceProjectStreams)
            .set({
              claimProjectionIncomplete: reconciliation.incomplete,
              ...(reconciliation.changed
                ? { claimProjectionUpdatedAt: sql`clock_timestamp()` }
                : {}),
            })
            .where(eq(correspondenceProjectStreams.projectId, projectId));
        }
      }
      const [record] = await recordsFromRows(tx, projectId, [existing]);
      return {
        record: record!,
        created: false,
        sessionForkIds: await sessionForkEventIds(tx, event),
      };
    }

    const [authority] = await tx
      .select({
        identityId: identities.id,
        identityStatus: identities.status,
        publicKey: identityKeys.publicKey,
      })
      .from(identities)
      .innerJoin(
        identityKeys,
        and(
          eq(identityKeys.id, event.sender.signing_key_id),
          eq(identityKeys.identityId, identities.id),
          eq(identityKeys.active, true),
          isNull(identityKeys.revokedAt),
        ),
      )
      .where(
        and(
          eq(identities.id, event.sender.identity_id),
          eq(identities.projectId, projectId),
          eq(identities.status, "active"),
        ),
      )
      .for("share")
      .limit(1);
    if (!authority) {
      throw new CorrespondenceFailure(
        "sender_or_signing_key_not_active",
        "The sender must be an active identity in this project and use its own active, unrevoked signing key.",
        403,
      );
    }
    if (!(await verifyCorrespondenceSignature(event, authority.publicKey))) {
      throw new CorrespondenceFailure(
        "signature_invalid",
        "The Ed25519 signature does not match the canonical correspondence core.",
        403,
        "Sign SHA256(UTF8('agent-correspondence/v0.1') || NUL || RFC8785(core)).",
      );
    }

    const receivedSeq = stream.lastReceivedSeq + 1n;
    const [inserted] = await tx
      .insert(correspondenceEvents)
      .values({
        projectId,
        eventId: event.event_id,
        receivedSeq,
        protocol: event.protocol,
        repositoryId: event.repository_id,
        threadId: event.thread_id,
        senderIdentityId: event.sender.identity_id,
        signingKeyId: event.sender.signing_key_id,
        deviceId: event.sender.device_id,
        sessionId: event.sender.session_id,
        sessionSeq: event.session_seq,
        kind: event.kind,
        parents: event.parents,
        issuedAt: new Date(event.issued_at),
        scopeBaseRevision: event.scope.base_revision,
        scopeBranch: event.scope.branch,
        scopePaths: event.scope.paths,
        body: event.body,
        authority: event.authority,
        core: correspondenceCore(event),
        signature: event.signature.value_b64url,
        canonicalEnvelope,
      })
      .returning();
    if (!inserted) {
      throw new CorrespondenceFailure(
        "append_failed",
        "The signed event could not be appended.",
        503,
      );
    }
    const appendedClaimStatus = isClaimKind(event.kind)
      ? await insertClaimProjection(tx, event)
      : null;
    if (appendedClaimStatus !== "pending") {
      await enqueueReadyClaimPredecessor(tx, projectId, event.event_id);
    }
    // Drain one bounded project-wide reconciliation batch. This covers
    // descendants of the new event and any earlier backlog without letting an
    // adversarial reverse DAG monopolize the project stream lock.
    const reconciliation = await reconcilePendingClaimBatch(
      tx,
      projectId,
    );

    await tx
      .update(correspondenceProjectStreams)
      .set({
        lastReceivedSeq: receivedSeq,
        claimProjectionIncomplete: reconciliation.incomplete,
        ...(reconciliation.changed
          ? { claimProjectionUpdatedAt: sql`clock_timestamp()` }
          : {}),
        updatedAt: inserted.receivedAt,
      })
      .where(eq(correspondenceProjectStreams.projectId, projectId));

    const [record] = await recordsFromRows(tx, projectId, [inserted]);
    return {
      record: record!,
      created: true,
      sessionForkIds: await sessionForkEventIds(tx, event),
    };
  });
}

export interface ListEventsInput {
  projectId: string;
  repositoryId: string;
  threadId?: string;
  after?: bigint;
  limit?: number;
}

async function listEventsWith(
  executor: ReadExecutor,
  input: ListEventsInput,
): Promise<CorrespondenceEventPage> {
  const after = input.after ?? 0n;
  const limit = input.limit ?? DEFAULT_EVENT_PAGE;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EVENT_PAGE) {
    throw new CorrespondenceFailure(
      "limit_invalid",
      `limit must be an integer between 1 and ${MAX_EVENT_PAGE}.`,
      400,
    );
  }
  const conditions = [
    eq(correspondenceEvents.projectId, input.projectId),
    eq(correspondenceEvents.repositoryId, input.repositoryId),
    gt(correspondenceEvents.receivedSeq, after),
  ];
  if (input.threadId) conditions.push(eq(correspondenceEvents.threadId, input.threadId));
  const rows = await asReadDb(executor)
    .select()
    .from(correspondenceEvents)
    .where(and(...conditions))
    .orderBy(asc(correspondenceEvents.receivedSeq))
    .limit(limit + 1);
  const visible = rows.slice(0, limit);
  const records = await recordsFromRows(executor, input.projectId, visible);
  const nextAfter = visible.at(-1)?.receivedSeq ?? input.after ?? null;
  return {
    protocol: CORRESPONDENCE_PROTOCOL,
    scope: CORRESPONDENCE_SCOPE,
    events: records,
    page: {
      after: input.after?.toString() ?? null,
      next_after: nextAfter?.toString() ?? null,
      has_more: rows.length > limit,
    },
  };
}

export async function listCorrespondenceEvents(
  input: ListEventsInput,
): Promise<CorrespondenceEventPage> {
  return listEventsWith(db, input);
}

const MAX_CLAIM_TIP_CANDIDATES = 512;
const MAX_COMPETING_TIP_IDS = 16;

interface ClaimTipRow {
  [key: string]: unknown;
  project_id: string;
  event_id: string;
  repository_id: string;
  claim_id: string;
  generation: string | number;
  event_kind: "claim.open" | "claim.renew" | "claim.release";
  is_tip: boolean;
  owner_identity_id: string;
  device_id: string;
  session_id: string;
  scope_paths: string[];
  expires_at: Date | string | null;
  thread_id: string;
  scope_base_revision: string | null;
  scope_branch: string | null;
  received_seq: string | bigint;
}

interface ClaimTipFocus {
  threadId?: string;
  path?: string;
}

interface CompetingClaimTipRow {
  [key: string]: unknown;
  claim_id: string;
  event_id: string;
}

function claimTipFocusClauses(focus: ClaimTipFocus) {
  const threadClause = focus.threadId
    ? sql`AND event.thread_id = ${focus.threadId}`
    : sql``;
  const pathClause = focus.path
    ? sql`AND EXISTS (
        SELECT 1
        FROM unnest(claim.scope_paths) AS focused_path(path)
        WHERE focused_path.path = '.'
           OR ${focus.path} = '.'
           OR focused_path.path = ${focus.path}
           OR starts_with(focused_path.path, ${`${focus.path}/`})
           OR starts_with(${focus.path}, focused_path.path || '/')
      )`
    : sql``;
  return { threadClause, pathClause };
}

async function loadValidClaimTips(
  executor: ReadExecutor,
  projectId: string,
  repositoryId: string,
  activeAt: Date,
  focus: ClaimTipFocus = {},
): Promise<{ rows: ClaimTipRow[]; truncated: boolean }> {
  const { threadClause, pathClause } = claimTipFocusClauses(focus);
  const result = await asReadDb(executor).execute<ClaimTipRow>(sql`
    SELECT
      claim.project_id,
      claim.event_id,
      claim.repository_id,
      claim.claim_id,
      claim.generation::text AS generation,
      claim.event_kind,
      claim.is_tip,
      claim.owner_identity_id,
      claim.device_id,
      claim.session_id,
      claim.scope_paths,
      claim.expires_at,
      event.thread_id,
      event.scope_base_revision,
      event.scope_branch,
      event.received_seq::text AS received_seq
    FROM correspondence.claim_events AS claim
    INNER JOIN correspondence.events AS event
      ON event.project_id = claim.project_id
     AND event.event_id = claim.event_id
    WHERE claim.project_id = ${projectId}::uuid
      AND claim.repository_id = ${repositoryId}
      AND claim.lineage_status = 'valid'
      AND claim.is_tip = true
      AND claim.event_kind IN ('claim.open', 'claim.renew')
      AND claim.expires_at > ${activeAt}
      ${threadClause}
      ${pathClause}
    ORDER BY claim.expires_at, claim.claim_id, claim.event_id
    LIMIT ${MAX_CLAIM_TIP_CANDIDATES + 1}
  `);
  const rows = Array.from(result as unknown as ClaimTipRow[]);
  return {
    rows: rows.slice(0, MAX_CLAIM_TIP_CANDIDATES),
    truncated: rows.length > MAX_CLAIM_TIP_CANDIDATES,
  };
}

/** Load terminal siblings only for claim IDs that already survived the live,
 * focused active-tip cap. Conflict semantics include expired and release tips,
 * so this deliberately differs from loadValidClaimTips. Each lateral branch
 * returns 16 competitors plus the active row and one truncation sentinel at
 * most; total work is therefore bounded by visible live claims. */
async function loadBoundedCompetingClaimTips(
  executor: ReadExecutor,
  projectId: string,
  repositoryId: string,
  claimIds: readonly string[],
): Promise<CompetingClaimTipRow[]> {
  if (claimIds.length === 0) return [];
  const claimIdArray = sql.join(
    claimIds.map((claimId) => sql`${claimId}`),
    sql`, `,
  );
  const result = await asReadDb(executor).execute<CompetingClaimTipRow>(sql`
    SELECT
      visible.claim_id::text AS claim_id,
      tip.event_id
    FROM unnest(ARRAY[${claimIdArray}]::uuid[]) AS visible(claim_id)
    CROSS JOIN LATERAL (
      SELECT claim.event_id
      FROM correspondence.claim_events AS claim
      WHERE claim.project_id = ${projectId}::uuid
        AND claim.repository_id = ${repositoryId}
        AND claim.claim_id = visible.claim_id
        AND claim.lineage_status = 'valid'
        AND claim.is_tip = true
      ORDER BY claim.generation, claim.event_id
      LIMIT ${MAX_COMPETING_TIP_IDS + 2}
    ) AS tip
    ORDER BY visible.claim_id, tip.event_id
  `);
  return Array.from(result as unknown as CompetingClaimTipRow[]);
}

interface LatestExpiryRow {
  [key: string]: unknown;
  latest_expiry: Date | string | null;
}

/** Latest elapsed expiry among repository tips. Repository-wide over-
 * invalidation is deliberate: indexed DESC/LIMIT avoids scanning elapsed
 * history while keeping focused projection validators honest. */
async function latestElapsedClaimExpiry(
  executor: ReadExecutor,
  projectId: string,
  repositoryId: string,
  activeAt: Date,
): Promise<Date | null> {
  const result = await asReadDb(executor).execute<LatestExpiryRow>(sql`
    SELECT claim.expires_at AS latest_expiry
    FROM correspondence.claim_events AS claim
    WHERE claim.project_id = ${projectId}::uuid
      AND claim.repository_id = ${repositoryId}
      AND claim.lineage_status = 'valid'
      AND claim.is_tip = true
      AND claim.event_kind IN ('claim.open', 'claim.renew')
      AND claim.expires_at <= ${activeAt}
    ORDER BY claim.expires_at DESC NULLS LAST
    LIMIT 1
  `);
  const value = Array.from(result as unknown as LatestExpiryRow[])[0]?.latest_expiry;
  return value ? new Date(value) : null;
}

export interface ListClaimsInput {
  projectId: string;
  repositoryId: string;
  threadId?: string;
  path?: string;
}

async function listClaimsWith(
  executor: ReadExecutor,
  input: ListClaimsInput,
): Promise<ActiveClaimsProjection> {
  const now = await databaseClock(executor);
  const [stream, focusedTips, focusedExpiry] = await Promise.all([
    projectStreamState(executor, input.projectId),
    loadValidClaimTips(executor, input.projectId, input.repositoryId, now, {
        threadId: input.threadId,
        path: input.path,
      }),
    latestElapsedClaimExpiry(executor, input.projectId, input.repositoryId, now),
  ]);
  // A focused query must filter before the bounded LIMIT, otherwise a valid
  // match can be hidden forever behind 512 unrelated tips. Once matches are
  // known, load their complete claim branches so conflicts outside the focus
  // remain visible in competing_event_ids.
  const visibleFocusedTips = focusedTips.rows.slice(0, MAX_ACTIVE_CLAIMS);
  const visibleClaimIds = [
    ...new Set(visibleFocusedTips.map((row) => row.claim_id)),
  ];
  const competingTips = await loadBoundedCompetingClaimTips(
    executor,
    input.projectId,
    input.repositoryId,
    visibleClaimIds,
  );
  const byClaim = new Map<string, CompetingClaimTipRow[]>();
  for (const row of competingTips) {
    const group = byClaim.get(row.claim_id) ?? [];
    group.push(row);
    byClaim.set(row.claim_id, group);
  }

  let truncated =
    stream.claimProjectionIncomplete ||
    focusedTips.truncated ||
    focusedTips.rows.length > MAX_ACTIVE_CLAIMS;
  let evaluatedAt = stream.updatedAt ?? new Date(0);
  if (stream.claimProjectionUpdatedAt > evaluatedAt) {
    evaluatedAt = stream.claimProjectionUpdatedAt;
  }
  if (focusedExpiry && focusedExpiry > evaluatedAt) evaluatedAt = focusedExpiry;
  const active: ActiveCorrespondenceClaim[] = [];
  for (const row of visibleFocusedTips) {
    // SQL applies these predicates before LIMIT. Retain a defensive check so
    // a projection can never surface a terminal/expired row if a future query
    // refactor drifts.
    if (!isLiveClaimTipAt(row, now)) continue;
    const expiresAt = new Date(row.expires_at);
    const competitors = summarizeCompetingClaimTips(
      row.event_id,
      byClaim.get(row.claim_id) ?? [],
    );
    if (competitors.truncated) truncated = true;
    active.push({
      claim_id: row.claim_id,
      generation: Number(row.generation),
      event_id: row.event_id,
      owner_identity_id: row.owner_identity_id,
      device_id: row.device_id,
      session_id: row.session_id,
      thread_id: row.thread_id,
      scope: {
        base_revision: row.scope_base_revision,
        branch: row.scope_branch,
        paths: row.scope_paths,
      },
      expires_at: expiresAt.toISOString(),
      conflicted: competitors.eventIds.length > 0,
      competing_event_ids: competitors.eventIds,
    });
  }
  return {
    protocol: CORRESPONDENCE_PROTOCOL,
    scope: CORRESPONDENCE_SCOPE,
    evaluated_at: evaluatedAt.toISOString(),
    cursor: stream.cursor,
    projection_status: truncated ? "truncated" : "complete",
    truncated,
    claims: active,
  };
}

export async function listCorrespondenceClaims(
  input: ListClaimsInput,
): Promise<ActiveClaimsProjection> {
  await reconcileClaimProjectionForRead(input.projectId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    return listClaimsWith(tx, input);
  });
}

export function isLiveClaimTipAt(
  row: Pick<ClaimTipRow, "event_kind" | "expires_at" | "is_tip">,
  activeAt: Date,
): row is Pick<ClaimTipRow, "event_kind" | "expires_at" | "is_tip"> & {
  event_kind: "claim.open" | "claim.renew";
  expires_at: Date | string;
} {
  return (
    row.is_tip === true &&
    (row.event_kind === "claim.open" || row.event_kind === "claim.renew") &&
    row.expires_at !== null &&
    new Date(row.expires_at).getTime() > activeAt.getTime()
  );
}

export function summarizeCompetingClaimTips(
  activeEventId: string,
  tips: readonly Pick<CompetingClaimTipRow, "event_id">[],
): { eventIds: string[]; truncated: boolean } {
  const eventIds = [
    ...new Set(
      tips
        .map((candidate) => candidate.event_id)
        .filter((eventId) => eventId !== activeEventId),
    ),
  ].sort();
  return {
    eventIds: eventIds.slice(0, MAX_COMPETING_TIP_IDS),
    truncated: eventIds.length > MAX_COMPETING_TIP_IDS,
  };
}

function sessionForkWarning(event: CorrespondenceEvent, eventIds: string[]): CorrespondenceWarning | null {
  if (eventIds.length <= 1) return null;
  return {
    code: "session_fork",
    detail:
      "More than one signed event occupies this identity/device/session sequence. All branches are retained; no receipt timestamp chooses a winner.",
    event_ids: eventIds.slice(0, 16),
  };
}

export function appendWarnings(durable: DurableAppend): CorrespondenceWarning[] {
  const event = durable.record.event;
  const warnings: CorrespondenceWarning[] = [];
  const sessionWarning = sessionForkWarning(event, durable.sessionForkIds);
  if (sessionWarning) warnings.push(sessionWarning);
  if (durable.record.lineage_status === "pending") {
    warnings.push({
      code: "claim_lineage_pending",
      detail:
        "The signed event is durable and replayable, but its claim predecessor has not arrived; it is inactive until the lineage validates.",
      event_ids: [event.event_id],
    });
  }

  return warnings.slice(0, 16);
}

export async function appendCorrespondenceEvent(
  projectId: string,
  event: CorrespondenceEvent,
): Promise<AppendCorrespondenceResult> {
  if (event.project_id !== projectId) {
    throw new CorrespondenceFailure(
      "project_mismatch",
      "The signed project_id must equal the bearer project's id.",
      403,
    );
  }
  const canonicalEnvelope = correspondenceCanonicalEnvelope(event);
  if (Buffer.byteLength(canonicalEnvelope, "utf8") > MAX_CORRESPONDENCE_REQUEST_BYTES) {
    throw new CorrespondenceFailure(
      "canonical_envelope_too_large",
      `The canonical signed envelope exceeds ${MAX_CORRESPONDENCE_REQUEST_BYTES} bytes.`,
      413,
    );
  }
  const computedEventId = correspondenceEventId(event);
  if (computedEventId !== event.event_id) {
    throw new CorrespondenceFailure(
      "event_id_mismatch",
      "event_id must equal sha256(RFC8785({...core, signature})).",
      400,
      `Use ${computedEventId} for these exact signed bytes.`,
    );
  }
  const durable = await appendDurably(projectId, event, canonicalEnvelope);
  return {
    ...durable.record,
    warnings: appendWarnings(durable),
    created: durable.created,
  };
}

async function recentRecords(
  executor: ReadExecutor,
  projectId: string,
  repositoryId: string,
  threadId?: string,
): Promise<{ records: CorrespondenceRecord[]; truncated: boolean }> {
  const conditions = [
    eq(correspondenceEvents.projectId, projectId),
    eq(correspondenceEvents.repositoryId, repositoryId),
  ];
  if (threadId) conditions.push(eq(correspondenceEvents.threadId, threadId));
  const rows = await asReadDb(executor)
    .select()
    .from(correspondenceEvents)
    .where(and(...conditions))
    .orderBy(desc(correspondenceEvents.receivedSeq))
    .limit(MAX_VOICE_RECENT_EVENTS + 1);
  const visible = rows.slice(0, MAX_VOICE_RECENT_EVENTS);
  return {
    records: await recordsFromRows(executor, projectId, visible),
    truncated: rows.length > MAX_VOICE_RECENT_EVENTS,
  };
}

function missingParentConflicts(
  records: readonly CorrespondenceRecord[],
): {
  rows: CorrespondenceVoice["conflicts"]["missing_parents"];
  truncated: boolean;
} {
  const rows = records
    .filter((record) => record.missing_parents.length > 0)
    .map((record) => ({
      event_id: record.event.event_id,
      missing_parent_ids: record.missing_parents,
    }));
  return {
    rows: rows.slice(0, MAX_VOICE_CONFLICTS),
    truncated: rows.length > MAX_VOICE_CONFLICTS,
  };
}

interface RawSessionFork {
  [key: string]: unknown;
  ordinal: string | number;
  identity_id: string;
  device_id: string;
  session_id: string;
  session_seq: string | number;
  event_ids: string[];
}

async function sessionForkConflicts(
  executor: ReadExecutor,
  projectId: string,
  records: readonly CorrespondenceRecord[],
): Promise<{
  rows: CorrespondenceVoice["conflicts"]["session_forks"];
  truncated: boolean;
}> {
  const seen = new Set<string>();
  const seeds = records.flatMap((record, ordinal) => {
    const event = record.event;
    const key = JSON.stringify([
      event.sender.identity_id,
      event.sender.device_id,
      event.sender.session_id,
      event.session_seq,
    ]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      ordinal,
      identityId: event.sender.identity_id,
      deviceId: event.sender.device_id,
      sessionId: event.sender.session_id,
      sessionSeq: event.session_seq,
    }];
  });
  if (seeds.length === 0) return { rows: [], truncated: false };
  const seedValues = sql.join(
    seeds.map((seed) => sql`(
      ${seed.ordinal}::integer,
      ${seed.identityId}::uuid,
      ${seed.deviceId}::uuid,
      ${seed.sessionId}::uuid,
      ${seed.sessionSeq}::bigint
    )`),
    sql`, `,
  );
  const result = await asReadDb(executor).execute<RawSessionFork>(sql`
    WITH focused_seed(
      ordinal,
      identity_id,
      device_id,
      session_id,
      session_seq
    ) AS (VALUES ${seedValues})
    SELECT
      seed.ordinal,
      seed.identity_id,
      seed.device_id,
      seed.session_id,
      seed.session_seq::text AS session_seq,
      bounded.event_ids
    FROM focused_seed AS seed
    CROSS JOIN LATERAL (
      SELECT array_agg(candidate.event_id ORDER BY candidate.event_id) AS event_ids
      FROM (
        SELECT sibling.event_id
        FROM correspondence.events AS sibling
        WHERE sibling.project_id = ${projectId}::uuid
          AND sibling.sender_identity_id = seed.identity_id
          AND sibling.device_id = seed.device_id
          AND sibling.session_id = seed.session_id
          AND sibling.session_seq = seed.session_seq
        ORDER BY sibling.event_id
        LIMIT 17
      ) AS candidate
    ) AS bounded
    WHERE cardinality(bounded.event_ids) > 1
    ORDER BY seed.ordinal
  `);
  const raw = Array.from(result as unknown as RawSessionFork[]);
  return {
    rows: raw.map((row) => ({
      identity_id: row.identity_id,
      device_id: row.device_id,
      session_id: row.session_id,
      session_seq: Number(row.session_seq),
      event_ids: row.event_ids.slice(0, 16),
    })),
    truncated: raw.some((row) => row.event_ids.length > 16),
  };
}

function overlappingClaimConflicts(
  claims: readonly ActiveCorrespondenceClaim[],
): {
  rows: CorrespondenceVoice["conflicts"]["overlapping_claims"];
  truncated: boolean;
} {
  const rows: CorrespondenceVoice["conflicts"]["overlapping_claims"] = [];
  let truncated = false;
  for (let leftIndex = 0; leftIndex < claims.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < claims.length; rightIndex += 1) {
      const left = claims[leftIndex]!;
      const right = claims[rightIndex]!;
      const paths = overlappingPathPrefixes(left.scope.paths, right.scope.paths);
      if (paths.length === 0) continue;
      if (rows.length >= MAX_VOICE_CONFLICTS) {
        truncated = true;
        continue;
      }
      rows.push({
        left_event_id: left.event_id,
        right_event_id: right.event_id,
        paths: paths.slice(0, 16),
      });
      if (paths.length > 16) truncated = true;
    }
  }
  return { rows, truncated };
}

export interface ReadVoiceInput {
  projectId: string;
  repositoryId: string;
  threadId?: string;
}

export async function readCorrespondenceVoice(
  input: ReadVoiceInput,
): Promise<CorrespondenceVoice> {
  await reconcileClaimProjectionForRead(input.projectId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    const [cursor, recent, claims] = await Promise.all([
      currentCursor(tx, input.projectId),
      recentRecords(tx, input.projectId, input.repositoryId, input.threadId),
      listClaimsWith(tx, {
        projectId: input.projectId,
        repositoryId: input.repositoryId,
        threadId: input.threadId,
      }),
    ]);
    const [missing, sessions] = await Promise.all([
      Promise.resolve(missingParentConflicts(recent.records)),
      sessionForkConflicts(tx, input.projectId, recent.records),
    ]);
    const overlaps = overlappingClaimConflicts(claims.claims);
    const truncated =
      recent.truncated ||
      claims.truncated ||
      missing.truncated ||
      sessions.truncated ||
      overlaps.truncated;
    return {
      protocol: CORRESPONDENCE_PROTOCOL,
      scope: CORRESPONDENCE_SCOPE,
      evaluated_at: claims.evaluated_at,
      cursor,
      projection_status: truncated ? "truncated" : "complete",
      truncated,
      recent_events: recent.records,
      active_claims: claims.claims,
      conflicts: {
        missing_parents: missing.rows,
        session_forks: sessions.rows,
        overlapping_claims: overlaps.rows,
      },
    };
  });
}

export interface CorrespondenceService {
  append(projectId: string, event: CorrespondenceEvent): Promise<AppendCorrespondenceResult>;
  listEvents(input: ListEventsInput): Promise<CorrespondenceEventPage>;
  listClaims(input: ListClaimsInput): Promise<ActiveClaimsProjection>;
  readVoice(input: ReadVoiceInput): Promise<CorrespondenceVoice>;
}

export const correspondenceService: CorrespondenceService = {
  append: appendCorrespondenceEvent,
  listEvents: listCorrespondenceEvents,
  listClaims: listCorrespondenceClaims,
  readVoice: readCorrespondenceVoice,
};
