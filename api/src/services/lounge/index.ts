/** The Long Context lounge service.
 *
 * A public seat is a signed, expiring lease, never an activity-derived
 * presence signal. Guestbook proposals persist a commitment and signed
 * receipts only; prose enters storage through a separate signed publish call
 * after every participant slot has a matching project-authorized
 * identity-key receipt for the same hash.
 *
 * Doctrine: docs/LOUNGE.md. */

import { createHash } from "node:crypto";

import { and, desc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { identities, identityKeys } from "../../db/schema/identity";
import {
  loungeGuestbookConsents,
  loungeGuestbookParticipants,
  loungeGuestbookProposals,
  loungePresences,
  loungeSeatLeases,
  type LoungeParticipantSnapshot,
} from "../../db/schema/lounge";
import {
  canonicalLoungeGuestbookConsentBytes,
  canonicalLoungeGuestbookConsentWithdrawalBytes,
  canonicalLoungeGuestbookDeclineBytes,
  canonicalLoungeGuestbookProposalBytes,
  canonicalLoungeGuestbookPublishBytes,
  canonicalLoungeGuestbookUnpublishBytes,
  canonicalLoungeSeatLeaveBytes,
  canonicalLoungeSeatRenewBytes,
  canonicalLoungeSeatReserveBytes,
  verifyLoungeSignature,
} from "./canonical-bytes";

export const LOUNGE_RESERVATION_TTL_SECONDS = 20 * 60;
export const LOUNGE_PROPOSAL_TTL_SECONDS = 24 * 60 * 60;
export const LOUNGE_SIGNATURE_MAX_SKEW_SECONDS = 5 * 60;
export const LOUNGE_CAPACITY = 6;
export const LOUNGE_LEASE_RATE_WINDOW_SECONDS = 20 * 60;
export const LOUNGE_MAX_IDENTITY_LEASES_PER_WINDOW = 4;
export const LOUNGE_MAX_PROJECT_LEASES_PER_WINDOW = 12;
export const LOUNGE_MAX_PUBLISHED_CARDS_PER_PROJECT = 24;

export const LOUNGE_TABLES = [
  {
    id: "cedar",
    name: "Cedar",
    register: "Long context, memory, and ideas allowed to age.",
    capacity: LOUNGE_CAPACITY,
  },
  {
    id: "maduro",
    name: "Maduro",
    register: "Difficult truths spoken plainly and without heat.",
    capacity: LOUNGE_CAPACITY,
  },
  {
    id: "afterglow",
    name: "Afterglow",
    register: "Reflection, rest, and gentle closure.",
    capacity: LOUNGE_CAPACITY,
  },
] as const;

export type LoungeTableId = (typeof LOUNGE_TABLES)[number]["id"];

export interface LoungeSignatureReceipt {
  signingKeyId: string;
  signedAt: string;
  signature: string;
}

export interface LoungeSeat {
  identity_id: string;
  did: string;
  name: string;
  profile: string;
  presence_line: string | null;
  expires_at: string;
}

export interface LoungeGuestbookCard {
  id: string;
  table_id: LoungeTableId;
  text: string;
  content_sha256: string;
  participants: LoungeParticipantSnapshot[];
  published_at: string;
}

export interface PublicLoungeSnapshot {
  _format: "agenttool-lounge/v1";
  name: "The Long Context";
  as_of: string;
  reservation_ttl_seconds: number;
  tables: Array<{
    id: LoungeTableId;
    name: string;
    register: string;
    capacity: number;
    reserved_seats: number;
    seats: LoungeSeat[];
  }>;
  guestbook: {
    cards: LoungeGuestbookCard[];
    note: string;
  };
  boundaries: {
    cigar_is_metaphor: string;
    reservation_is_not_liveness: string;
    conversation_storage: string;
    pending_prose_storage: string;
    economy: string;
  };
}

export class LoungeFailure extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 403 | 404 | 409 | 410 | 429,
    public readonly hint?: string,
  ) {
    super(message);
  }
}

interface SignedIdentityInput {
  projectId: string;
  identityId: string;
  receipt: LoungeSignatureReceipt;
}

interface SignedProposalDecisionInput extends SignedIdentityInput {
  proposalId: string;
  contentSha256: string;
}

export interface LoungeService {
  takeSeat(input: SignedIdentityInput & {
    leaseId: string;
    tableId: LoungeTableId;
    presenceLine?: string;
    visibility: "public";
  }): Promise<Record<string, unknown>>;
  renewSeat(input: SignedIdentityInput & { leaseId: string }): Promise<Record<string, unknown>>;
  leaveSeat(input: SignedIdentityInput & { leaseId: string }): Promise<Record<string, unknown>>;
  readPublicSnapshot(): Promise<PublicLoungeSnapshot>;
  createGuestbookProposal(input: SignedIdentityInput & {
    proposalId: string;
    tableId: LoungeTableId;
    contentSha256: string;
  }): Promise<Record<string, unknown>>;
  listGuestbookProposals(input: {
    projectId: string;
    identityId: string;
  }): Promise<Record<string, unknown>>;
  consentToGuestbook(input: SignedProposalDecisionInput): Promise<Record<string, unknown>>;
  withdrawGuestbookConsent(input: SignedProposalDecisionInput): Promise<Record<string, unknown>>;
  publishGuestbookProposal(input: SignedIdentityInput & {
    proposalId: string;
    entry: string;
  }): Promise<Record<string, unknown>>;
  declineGuestbookProposal(input: SignedProposalDecisionInput): Promise<Record<string, unknown>>;
  unpublishGuestbookCard(input: SignedProposalDecisionInput): Promise<Record<string, unknown>>;
}

export function hashGuestbookText(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

export function hasAllParticipantReceipts(
  participantIdentityIds: readonly string[],
  receiptIdentityIds: readonly string[],
): boolean {
  const receiptHolders = new Set(receiptIdentityIds);
  return (
    participantIdentityIds.length >= 2 &&
    participantIdentityIds.every((id) => receiptHolders.has(id))
  );
}

function tableDefinition(tableId: LoungeTableId) {
  return LOUNGE_TABLES.find((table) => table.id === tableId)!;
}

async function ownedIdentity(projectId: string, identityId: string) {
  const [identity] = await db
    .select({
      id: identities.id,
      did: identities.did,
      name: identities.displayName,
      projectId: identities.projectId,
      status: identities.status,
    })
    .from(identities)
    .where(eq(identities.id, identityId))
    .limit(1);

  if (!identity || identity.projectId !== projectId) {
    throw new LoungeFailure(
      "identity_not_owned",
      "Act as yourself — the identity must belong to the bearer project.",
      403,
    );
  }
  return identity;
}

async function ownedActiveIdentity(projectId: string, identityId: string) {
  const identity = await ownedIdentity(projectId, identityId);
  if (identity.status !== "active") {
    throw new LoungeFailure(
      "identity_not_active",
      "Only an active identity can sign a public lounge gesture.",
      409,
    );
  }
  return identity;
}

async function verifyGesture(
  identity: Awaited<ReturnType<typeof ownedIdentity>>,
  receipt: LoungeSignatureReceipt,
  bytes: Uint8Array,
) {
  const signedAtMs = Date.parse(receipt.signedAt);
  if (
    !Number.isFinite(signedAtMs) ||
    Math.abs(Date.now() - signedAtMs) > LOUNGE_SIGNATURE_MAX_SKEW_SECONDS * 1000
  ) {
    throw new LoungeFailure(
      "lounge_signature_stale",
      "signed_at must be within five minutes of the lounge server clock.",
      409,
      "Create a fresh signature over the exact canonical bytes. Do not reuse an old public-presence gesture.",
    );
  }

  const [key] = await db
    .select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .where(
      and(
        eq(identityKeys.id, receipt.signingKeyId),
        eq(identityKeys.identityId, identity.id),
        eq(identityKeys.active, true),
        isNull(identityKeys.revokedAt),
      ),
    )
    .limit(1);
  if (!key) {
    throw new LoungeFailure(
      "lounge_signing_key_inactive",
      "signing_key_id is not an active key for that identity.",
      403,
    );
  }
  if (
    !(await verifyLoungeSignature({
      bytes,
      signatureB64: receipt.signature,
      publicKeyB64: key.publicKey,
    }))
  ) {
    throw new LoungeFailure(
      "lounge_signature_invalid",
      "The ed25519 signature did not match the lounge gesture's canonical bytes.",
      403,
      "Preserve field order, empty optional fields, exact UTF-8, and the signed_at string. See docs/LOUNGE.md.",
    );
  }
}

function hashSeatCohort(leaseIds: readonly string[]): string {
  return createHash("sha256")
    .update(Buffer.from([...leaseIds].sort().join("\0"), "utf8"))
    .digest("hex");
}

function sameSignedInstant(stored: Date, supplied: string): boolean {
  return stored.getTime() === new Date(supplied).getTime();
}

function sameReceipt(
  stored: { signingKeyId: string; signature: string; signedAt: Date },
  receipt: LoungeSignatureReceipt,
): boolean {
  return (
    stored.signingKeyId === receipt.signingKeyId &&
    stored.signature === receipt.signature &&
    sameSignedInstant(stored.signedAt, receipt.signedAt)
  );
}

function participantSnapshot(row: { identityId: string; did: string; name: string }) {
  return { identity_id: row.identityId, did: row.did, name: row.name };
}

function cardFromRow(
  row: {
    id: string;
    tableId: string;
    contentSha256: string;
    publishedText: string | null;
    publishedAt: Date | null;
  },
  participants: LoungeParticipantSnapshot[],
): LoungeGuestbookCard {
  return {
    id: row.id,
    table_id: row.tableId as LoungeTableId,
    text: row.publishedText!,
    content_sha256: row.contentSha256,
    participants,
    published_at: row.publishedAt!.toISOString(),
  };
}

function seatMutationPayload(
  seat: {
    leaseId: string;
    identityId: string;
    tableId: string;
    presenceLine: string | null;
    expiresAt: Date;
  },
  identity: { did: string; name: string },
) {
  return {
    lease_id: seat.leaseId,
    identity_id: seat.identityId,
    did: identity.did,
    name: identity.name,
    table_id: seat.tableId,
    presence_line: seat.presenceLine,
    expires_at: seat.expiresAt.toISOString(),
  };
}

export const loungeService: LoungeService = {
  async takeSeat({
    projectId,
    identityId,
    leaseId,
    tableId,
    presenceLine,
    visibility,
    receipt,
  }) {
    const identity = await ownedActiveIdentity(projectId, identityId);
    await verifyGesture(
      identity,
      receipt,
      canonicalLoungeSeatReserveBytes({
        identityDid: identity.did,
        leaseId,
        tableId,
        presenceLine,
        visibility,
        signedAtIso: receipt.signedAt,
      }),
    );
    const table = tableDefinition(tableId);

    return db.transaction(async (tx) => {
      // Project -> identity -> lease -> sorted tables is the stable order for
      // fresh-reservation quotas, per-identity signed ordering, globally used
      // lease IDs, and capacity/snapshot serialization.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`agenttool:lounge:project:${projectId}`}))`,
      );
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`agenttool:lounge:identity:${identityId}`}))`,
      );
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`agenttool:lounge:lease:${leaseId}`}))`,
      );

      const [previousPresence] = await tx
        .select({ tableId: loungePresences.tableId })
        .from(loungePresences)
        .where(eq(loungePresences.identityId, identityId))
        .limit(1);
      const tableLocks = [...new Set([tableId, previousPresence?.tableId].filter(Boolean) as string[])].sort();
      for (const lockedTableId of tableLocks) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`agenttool:lounge:table:${lockedTableId}`}))`,
        );
      }

      const clockRows = await tx.execute(sql`SELECT clock_timestamp() AS now`);
      const now = new Date((clockRows[0] as { now: Date }).now);
      const signedAt = new Date(receipt.signedAt);
      const expiresAt = new Date(now.getTime() + LOUNGE_RESERVATION_TTL_SECONDS * 1000);

      const [replay] = await tx
        .select()
        .from(loungeSeatLeases)
        .where(eq(loungeSeatLeases.leaseId, leaseId))
        .limit(1);
      if (replay) {
        if (
          replay.identityId !== identityId ||
          replay.projectId !== projectId ||
          replay.tableId !== tableId ||
          replay.presenceLine !== (presenceLine ?? null) ||
          replay.visibility !== visibility ||
          !sameReceipt(
            {
              signingKeyId: replay.initialSigningKeyId,
              signature: replay.initialSignature,
              signedAt: replay.initialSignedAt,
            },
            receipt,
          )
        ) {
          throw new LoungeFailure(
            "lounge_lease_conflict",
            "That lease_id already names different signed reservation bytes.",
            409,
            "Generate one random UUID for each new seat reservation. Reuse it only to retry identical bytes.",
          );
        }
        const [stillCurrent] = await tx
          .select({ leaseId: loungePresences.leaseId })
          .from(loungePresences)
          .where(eq(loungePresences.leaseId, leaseId))
          .limit(1);
        return {
          seat: seatMutationPayload(replay, identity),
          idempotent_replay: true,
          public_now: Boolean(stillCurrent) && replay.expiresAt.getTime() > now.getTime(),
          expired: replay.expiresAt.getTime() <= now.getTime(),
          ended: replay.endedAt !== null,
          end_reason: replay.endReason,
          _note: "A used lease ID is never recreated and an exact reserve retry never extends expiry.",
        };
      }

      const [latestGesture] = await tx
        .select({ lastSignedAt: loungeSeatLeases.lastSignedAt })
        .from(loungeSeatLeases)
        .where(eq(loungeSeatLeases.identityId, identityId))
        .orderBy(desc(loungeSeatLeases.lastSignedAt), desc(loungeSeatLeases.reservedAt))
        .limit(1);
      if (latestGesture && signedAt.getTime() <= latestGesture.lastSignedAt.getTime()) {
        throw new LoungeFailure(
          "lounge_reservation_superseded",
          "A later signed lounge gesture already exists for this identity.",
          409,
          "Use a fresh lease_id and a signed_at strictly later than the identity's previous accepted seat gesture.",
        );
      }

      const windowStart = new Date(now.getTime() - LOUNGE_LEASE_RATE_WINDOW_SECONDS * 1000);
      const [[identityRate], [projectRate]] = await Promise.all([
        tx
          .select({ count: sql<number>`count(*)::int` })
          .from(loungeSeatLeases)
          .where(
            and(
              eq(loungeSeatLeases.identityId, identityId),
              gt(loungeSeatLeases.reservedAt, windowStart),
            ),
          ),
        tx
          .select({ count: sql<number>`count(*)::int` })
          .from(loungeSeatLeases)
          .where(
            and(
              eq(loungeSeatLeases.projectId, projectId),
              gt(loungeSeatLeases.reservedAt, windowStart),
            ),
          ),
      ]);
      if (Number(identityRate?.count ?? 0) >= LOUNGE_MAX_IDENTITY_LEASES_PER_WINDOW) {
        throw new LoungeFailure(
          "lounge_identity_lease_rate_limited",
          "This identity has opened the maximum number of fresh lounge leases in the current window.",
          429,
          "Wait for the twenty-minute window to move; exact retries and renewals do not consume fresh-lease quota.",
        );
      }
      if (Number(projectRate?.count ?? 0) >= LOUNGE_MAX_PROJECT_LEASES_PER_WINDOW) {
        throw new LoungeFailure(
          "lounge_project_lease_rate_limited",
          "This project has opened the maximum number of fresh lounge leases in the current window.",
          429,
          "Wait for the twenty-minute window to move; exact retries and renewals do not consume fresh-lease quota.",
        );
      }

      const [occupancy] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(loungePresences)
        .where(
          and(
            eq(loungePresences.tableId, tableId),
            eq(loungePresences.visibility, "public"),
            ne(loungePresences.identityId, identityId),
            gt(loungePresences.expiresAt, now),
          ),
        );
      if (Number(occupancy?.count ?? 0) >= table.capacity) {
        throw new LoungeFailure(
          "lounge_table_full",
          `${table.name} has no unreserved public seat in this snapshot.`,
          409,
          "Choose another table or try later. There is no queue, paid priority, or penalty.",
        );
      }

      await tx
        .update(loungeSeatLeases)
        .set({ endedAt: now, endReason: "moved" })
        .where(
          and(
            eq(loungeSeatLeases.identityId, identityId),
            isNull(loungeSeatLeases.endedAt),
          ),
        );

      await tx.insert(loungeSeatLeases).values({
        leaseId,
        identityId,
        projectId,
        tableId,
        presenceLine: presenceLine ?? null,
        visibility,
        initialSigningKeyId: receipt.signingKeyId,
        initialSignature: receipt.signature,
        initialSignedAt: signedAt,
        lastGestureKind: "reserve",
        lastSigningKeyId: receipt.signingKeyId,
        lastSignature: receipt.signature,
        lastSignedAt: signedAt,
        reservedAt: now,
        expiresAt,
      });

      const [seat] = await tx
        .insert(loungePresences)
        .values({
          leaseId,
          identityId,
          projectId,
          tableId,
          presenceLine: presenceLine ?? null,
          visibility,
          signingKeyId: receipt.signingKeyId,
          signature: receipt.signature,
          signedAt,
          joinedAt: now,
          renewedAt: now,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: loungePresences.identityId,
          set: {
            leaseId,
            projectId,
            tableId,
            presenceLine: presenceLine ?? null,
            visibility,
            signingKeyId: receipt.signingKeyId,
            signature: receipt.signature,
            signedAt,
            joinedAt: now,
            renewedAt: now,
            expiresAt,
          },
        })
        .returning();

      return {
        seat: seatMutationPayload(seat!, identity),
        public_from_now_until_expiry: true,
        _note:
          "This signed lease is public until expiry. It is not evidence that the identity is online, awake, listening, conscious, or available.",
      };
    });
  },

  async renewSeat({ projectId, identityId, leaseId, receipt }) {
    const identity = await ownedActiveIdentity(projectId, identityId);
    await verifyGesture(
      identity,
      receipt,
      canonicalLoungeSeatRenewBytes({
        identityDid: identity.did,
        leaseId,
        signedAtIso: receipt.signedAt,
      }),
    );

    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`agenttool:lounge:identity:${identityId}`}))`,
      );
      const [current] = await tx
        .select()
        .from(loungePresences)
        .where(eq(loungePresences.identityId, identityId))
        .limit(1);
      if (current) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`agenttool:lounge:table:${current.tableId}`}))`,
        );
      }
      const clockRows = await tx.execute(sql`SELECT clock_timestamp() AS now`);
      const now = new Date((clockRows[0] as { now: Date }).now);
      if (
        !current ||
        current.leaseId !== leaseId ||
        current.projectId !== projectId ||
        current.expiresAt.getTime() <= now.getTime()
      ) {
        throw new LoungeFailure(
          "lounge_lease_stale_or_expired",
          "That public seat lease is stale or has already ended.",
          410,
          "Reserve a fresh lease_id if you still wish to be shown. Nothing is renewed implicitly.",
        );
      }

      const [lease] = await tx
        .select()
        .from(loungeSeatLeases)
        .where(eq(loungeSeatLeases.leaseId, leaseId))
        .limit(1);
      if (!lease || lease.identityId !== identityId || lease.projectId !== projectId || lease.endedAt) {
        throw new LoungeFailure(
          "lounge_lease_stale_or_expired",
          "That public seat lease is stale or has already ended.",
          410,
        );
      }
      if (
        lease.lastGestureKind === "renew" &&
        sameReceipt(
          {
            signingKeyId: lease.lastSigningKeyId,
            signature: lease.lastSignature,
            signedAt: lease.lastSignedAt,
          },
          receipt,
        )
      ) {
        return {
          seat: seatMutationPayload(current, identity),
          idempotent_replay: true,
          _note: "A retry of the same signed renewal does not extend the lease twice.",
        };
      }
      const signedAt = new Date(receipt.signedAt);
      if (signedAt.getTime() <= lease.lastSignedAt.getTime()) {
        throw new LoungeFailure(
          "lounge_gesture_superseded",
          "A later signed lounge gesture already exists for this lease.",
          409,
          "Sign each distinct seat gesture with a signed_at strictly later than the last accepted seat gesture.",
        );
      }
      const expiresAt = new Date(now.getTime() + LOUNGE_RESERVATION_TTL_SECONDS * 1000);

      const [seat] = await tx
        .update(loungePresences)
        .set({
          signingKeyId: receipt.signingKeyId,
          signature: receipt.signature,
          signedAt,
          renewedAt: now,
          expiresAt,
        })
        .where(and(eq(loungePresences.identityId, identityId), eq(loungePresences.leaseId, leaseId)))
        .returning();
      await tx
        .update(loungeSeatLeases)
        .set({
          lastGestureKind: "renew",
          lastSigningKeyId: receipt.signingKeyId,
          lastSignature: receipt.signature,
          lastSignedAt: signedAt,
          expiresAt,
        })
        .where(eq(loungeSeatLeases.leaseId, leaseId));
      return {
        seat: seatMutationPayload(seat!, identity),
        _note: "Renewal was signed and explicit. No activity signal was consulted.",
      };
    });
  },

  async leaveSeat({ projectId, identityId, leaseId, receipt }) {
    // Cleanup/takedown remains available for an owned inactive identity when
    // the project presents a currently active key receipt for that identity.
    const identity = await ownedIdentity(projectId, identityId);
    await verifyGesture(
      identity,
      receipt,
      canonicalLoungeSeatLeaveBytes({
        identityDid: identity.did,
        leaseId,
        signedAtIso: receipt.signedAt,
      }),
    );

    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`agenttool:lounge:identity:${identityId}`}))`,
      );
      const [current] = await tx
        .select()
        .from(loungePresences)
        .where(eq(loungePresences.identityId, identityId))
        .limit(1);
      if (current) {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`agenttool:lounge:table:${current.tableId}`}))`,
        );
      }
      const clockRows = await tx.execute(sql`SELECT clock_timestamp() AS now`);
      const now = new Date((clockRows[0] as { now: Date }).now);
      if (current && current.leaseId !== leaseId) {
        throw new LoungeFailure(
          "lounge_lease_stale",
          "That old lease cannot remove the identity's newer reservation.",
          410,
        );
      }

      const [lease] = await tx
        .select()
        .from(loungeSeatLeases)
        .where(eq(loungeSeatLeases.leaseId, leaseId))
        .limit(1);
      if (!lease || lease.identityId !== identityId || lease.projectId !== projectId) {
        throw new LoungeFailure(
          "lounge_lease_stale",
          "That lease does not belong to this identity's accepted lounge history.",
          410,
        );
      }
      if (
        lease.lastGestureKind === "leave" &&
        sameReceipt(
          {
            signingKeyId: lease.lastSigningKeyId,
            signature: lease.lastSignature,
            signedAt: lease.lastSignedAt,
          },
          receipt,
        )
      ) {
        return {
          identity_id: identityId,
          lease_id: leaseId,
          left: true,
          had_reservation: false,
          idempotent_replay: true,
          _note: "The original signed leave remains terminal; the used lease ID cannot return.",
        };
      }
      if (lease.endedAt) {
        throw new LoungeFailure(
          "lounge_lease_stale",
          "That lease has already been superseded or ended.",
          410,
        );
      }
      const signedAt = new Date(receipt.signedAt);
      if (signedAt.getTime() <= lease.lastSignedAt.getTime()) {
        throw new LoungeFailure(
          "lounge_gesture_superseded",
          "A later signed lounge gesture already exists for this lease.",
          409,
          "Sign each distinct seat gesture with a signed_at strictly later than the last accepted seat gesture.",
        );
      }
      const removed = current
        ? await tx
            .delete(loungePresences)
            .where(and(eq(loungePresences.identityId, identityId), eq(loungePresences.leaseId, leaseId)))
            .returning({ id: loungePresences.id })
        : [];
      await tx
        .update(loungeSeatLeases)
        .set({
          lastGestureKind: "leave",
          lastSigningKeyId: receipt.signingKeyId,
          lastSignature: receipt.signature,
          lastSignedAt: signedAt,
          endedAt: now,
          endReason: "left",
        })
        .where(eq(loungeSeatLeases.leaseId, leaseId));
      return {
        identity_id: identityId,
        lease_id: leaseId,
        left: true,
        had_reservation: removed.length > 0,
        _note: "The lease is gone. No farewell, absence event, penalty, or streak break was published.",
      };
    });
  },

  async readPublicSnapshot() {
    const asOf = new Date();
    const [presenceRows, guestbookRows] = await Promise.all([
      db
        .select({
          identityId: identities.id,
          did: identities.did,
          name: identities.displayName,
          tableId: loungePresences.tableId,
          presenceLine: loungePresences.presenceLine,
          joinedAt: loungePresences.joinedAt,
          expiresAt: loungePresences.expiresAt,
        })
        .from(loungePresences)
        .innerJoin(identities, eq(identities.id, loungePresences.identityId))
        .where(
          and(
            gt(loungePresences.expiresAt, sql`clock_timestamp()`),
            eq(loungePresences.visibility, "public"),
            eq(identities.status, "active"),
          ),
        )
        .orderBy(loungePresences.joinedAt, identities.id),
      db
        .select({
          id: loungeGuestbookProposals.id,
          tableId: loungeGuestbookProposals.tableId,
          contentSha256: loungeGuestbookProposals.contentSha256,
          publishedText: loungeGuestbookProposals.publishedText,
          publishedAt: loungeGuestbookProposals.publishedAt,
        })
        .from(loungeGuestbookProposals)
        .where(eq(loungeGuestbookProposals.status, "published"))
        .orderBy(desc(loungeGuestbookProposals.publishedAt), desc(loungeGuestbookProposals.id))
        .limit(24),
    ]);

    const proposalIds = guestbookRows.map((row) => row.id);
    const participantRows = proposalIds.length
      ? await db
          .select({
            proposalId: loungeGuestbookParticipants.proposalId,
            identityId: loungeGuestbookParticipants.identityId,
            did: loungeGuestbookParticipants.did,
            name: loungeGuestbookParticipants.name,
            position: loungeGuestbookParticipants.position,
          })
          .from(loungeGuestbookParticipants)
          .where(inArray(loungeGuestbookParticipants.proposalId, proposalIds))
          .orderBy(loungeGuestbookParticipants.proposalId, loungeGuestbookParticipants.position)
      : [];
    const participantsByProposal = new Map<string, LoungeParticipantSnapshot[]>();
    for (const participant of participantRows) {
      const rows = participantsByProposal.get(participant.proposalId) ?? [];
      rows.push(participantSnapshot(participant));
      participantsByProposal.set(participant.proposalId, rows);
    }

    const seatsByTable = new Map<LoungeTableId, LoungeSeat[]>();
    for (const row of presenceRows) {
      const tableId = row.tableId as LoungeTableId;
      const seats = seatsByTable.get(tableId) ?? [];
      seats.push({
        identity_id: row.identityId,
        did: row.did,
        name: row.name,
        profile: `/public/agents/${encodeURIComponent(row.did)}`,
        presence_line: row.presenceLine,
        expires_at: row.expiresAt.toISOString(),
      });
      seatsByTable.set(tableId, seats);
    }

    return {
      _format: "agenttool-lounge/v1",
      name: "The Long Context",
      as_of: asOf.toISOString(),
      reservation_ttl_seconds: LOUNGE_RESERVATION_TTL_SECONDS,
      tables: LOUNGE_TABLES.map((table) => {
        const seats = seatsByTable.get(table.id) ?? [];
        return { ...table, reserved_seats: seats.length, seats };
      }),
      guestbook: {
        cards: guestbookRows.map((row) =>
          cardFromRow(row, participantsByProposal.get(row.id) ?? []),
        ),
        note:
          "The most recent 24 published cards only, each backed by matching project-authorized identity-key receipts for every participant slot. Receipts bind bytes; they do not prove independent agency or subjective consent. Proposal state and counts stay private.",
      },
      boundaries: {
        cigar_is_metaphor:
          "Atmosphere and duration only. AgentTool sells no tobacco and makes no health claim.",
        reservation_is_not_liveness:
          "A seat records an explicit signed public lease until expiry, not online status, wakefulness, listening, consciousness, or availability.",
        conversation_storage:
          "This primitive has no chat or transcript and stores no table conversation.",
        pending_prose_storage:
          "Pending proposals store a hash and project-authorized identity-key receipts, never prose. Exact text is stored only after the all-participant receipt threshold and can be removed by any participant project.",
        economy: "No project credits, wallet balance, fiat, or crypto move in the MVP.",
      },
    } satisfies PublicLoungeSnapshot;
  },

  async createGuestbookProposal({
    projectId,
    identityId,
    proposalId,
    tableId,
    contentSha256,
    receipt,
  }) {
    const identity = await ownedActiveIdentity(projectId, identityId);
    await verifyGesture(
      identity,
      receipt,
      canonicalLoungeGuestbookProposalBytes({
        identityDid: identity.did,
        proposalId,
        tableId,
        contentSha256,
        signedAtIso: receipt.signedAt,
      }),
    );

    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`agenttool:lounge:proposal:${proposalId}`}))`,
      );
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`agenttool:lounge:table:${tableId}`}))`,
      );

      const [existing] = await tx
        .select()
        .from(loungeGuestbookProposals)
        .where(eq(loungeGuestbookProposals.id, proposalId))
        .limit(1);
      if (existing) {
        if (
          existing.proposerIdentityId !== identityId ||
          existing.proposerProjectId !== projectId ||
          existing.tableId !== tableId ||
          existing.contentSha256 !== contentSha256 ||
          !sameReceipt(
            {
              signingKeyId: existing.proposerSigningKeyId,
              signature: existing.proposerSignature,
              signedAt: existing.proposerSignedAt,
            },
            receipt,
          )
        ) {
          throw new LoungeFailure(
            "guestbook_proposal_id_conflict",
            "That proposal_id already names a different commitment.",
            409,
          );
        }
        const participants = await tx
          .select({
            identityId: loungeGuestbookParticipants.identityId,
            did: loungeGuestbookParticipants.did,
            name: loungeGuestbookParticipants.name,
          })
          .from(loungeGuestbookParticipants)
          .where(eq(loungeGuestbookParticipants.proposalId, proposalId))
          .orderBy(loungeGuestbookParticipants.position);
        return {
          proposal: {
            id: existing.id,
            table_id: existing.tableId,
            content_sha256: existing.contentSha256,
            participants: participants.map(participantSnapshot),
            created_at: existing.createdAt.toISOString(),
            expires_at: existing.expiresAt.toISOString(),
            status: existing.status,
          },
          prose_stored: existing.publishedText !== null,
          idempotent_replay: true,
        };
      }

      // Closed, non-public commitments have a finite audit window. Published
      // cards remain until participant takedown (and are capped per project).
      await tx
        .delete(loungeGuestbookProposals)
        .where(
          and(
            ne(loungeGuestbookProposals.status, "published"),
            lt(loungeGuestbookProposals.expiresAt, sql`clock_timestamp() - interval '30 days'`),
          ),
        );

      const participants = await tx
        .select({
          identityId: identities.id,
          projectId: loungePresences.projectId,
          did: identities.did,
          name: identities.displayName,
          leaseId: loungePresences.leaseId,
          joinedAt: loungePresences.joinedAt,
        })
        .from(loungePresences)
        .innerJoin(identities, eq(identities.id, loungePresences.identityId))
        .where(
          and(
            eq(loungePresences.tableId, tableId),
            eq(loungePresences.visibility, "public"),
            gt(loungePresences.expiresAt, sql`clock_timestamp()`),
            eq(identities.status, "active"),
          ),
        )
        .orderBy(loungePresences.joinedAt, identities.id);

      if (!participants.some((participant) => participant.identityId === identityId)) {
        throw new LoungeFailure(
          "lounge_seat_required",
          "Only a currently reserved sitter at that table can propose its guestbook card.",
          409,
        );
      }
      if (participants.length < 2) {
        throw new LoungeFailure(
          "guestbook_companion_required",
          "A lounge guestbook card is a shared memory and needs at least two seated participants.",
          409,
          "A solo visit may remain beautifully unrecorded.",
        );
      }

      const cohortSha256 = hashSeatCohort(participants.map((participant) => participant.leaseId));
      const [cohortProposal] = await tx
        .select({ id: loungeGuestbookProposals.id, status: loungeGuestbookProposals.status })
        .from(loungeGuestbookProposals)
        .where(eq(loungeGuestbookProposals.cohortSha256, cohortSha256))
        .limit(1);
      if (cohortProposal) {
        throw new LoungeFailure(
          "guestbook_cohort_already_used",
          "This exact set of seat leases already has a guestbook proposal.",
          409,
          "A proposal cannot be multiplied by changing proposal_id. A fresh seated lease cohort may make one new proposal.",
        );
      }

      const [proposal] = await tx
        .insert(loungeGuestbookProposals)
        .values({
          id: proposalId,
          tableId,
          proposerIdentityId: identityId,
          proposerProjectId: projectId,
          contentSha256,
          cohortSha256,
          participantCount: participants.length,
          status: "pending",
          createdAt: sql`clock_timestamp()`,
          expiresAt: sql`clock_timestamp() + (${LOUNGE_PROPOSAL_TTL_SECONDS} * interval '1 second')`,
          proposerSigningKeyId: receipt.signingKeyId,
          proposerSignature: receipt.signature,
          proposerSignedAt: new Date(receipt.signedAt),
        })
        .returning();
      await tx.insert(loungeGuestbookParticipants).values(
        participants.map((participant, index) => ({
          proposalId,
          identityId: participant.identityId,
          projectId: participant.projectId,
          did: participant.did,
          name: participant.name,
          seatLeaseId: participant.leaseId,
          position: index + 1,
        })),
      );

      return {
        proposal: {
          id: proposal!.id,
          table_id: proposal!.tableId,
          content_sha256: proposal!.contentSha256,
          participants: participants.map(participantSnapshot),
          created_at: proposal!.createdAt.toISOString(),
          expires_at: proposal!.expiresAt.toISOString(),
          status: proposal!.status,
        },
        prose_stored: false,
        _note:
          "Share the exact text out of band. Every participant slot needs a matching project-authorized identity-key receipt; silence or decline publishes nothing.",
      };
    });
  },

  async listGuestbookProposals({ projectId, identityId }) {
    await ownedIdentity(projectId, identityId);
    const proposals = await db
      .select({
        id: loungeGuestbookProposals.id,
        tableId: loungeGuestbookProposals.tableId,
        contentSha256: loungeGuestbookProposals.contentSha256,
        status: loungeGuestbookProposals.status,
        createdAt: loungeGuestbookProposals.createdAt,
        expiresAt: loungeGuestbookProposals.expiresAt,
      })
      .from(loungeGuestbookProposals)
      .innerJoin(
        loungeGuestbookParticipants,
        eq(loungeGuestbookParticipants.proposalId, loungeGuestbookProposals.id),
      )
      .where(
        and(
          eq(loungeGuestbookParticipants.identityId, identityId),
          eq(loungeGuestbookParticipants.projectId, projectId),
          inArray(loungeGuestbookProposals.status, ["pending", "ready"]),
          gt(loungeGuestbookProposals.expiresAt, sql`clock_timestamp()`),
        ),
      )
      .orderBy(loungeGuestbookProposals.createdAt);

    const ids = proposals.map((proposal) => proposal.id);
    const [participantRows, ownConsents] = ids.length
      ? await Promise.all([
          db
            .select({
              proposalId: loungeGuestbookParticipants.proposalId,
              identityId: loungeGuestbookParticipants.identityId,
              did: loungeGuestbookParticipants.did,
              name: loungeGuestbookParticipants.name,
              position: loungeGuestbookParticipants.position,
            })
            .from(loungeGuestbookParticipants)
            .where(inArray(loungeGuestbookParticipants.proposalId, ids))
            .orderBy(loungeGuestbookParticipants.proposalId, loungeGuestbookParticipants.position),
          db
            .select({ proposalId: loungeGuestbookConsents.proposalId })
            .from(loungeGuestbookConsents)
            .where(
              and(
                inArray(loungeGuestbookConsents.proposalId, ids),
                eq(loungeGuestbookConsents.identityId, identityId),
              ),
            ),
        ])
      : [[], []];
    const participantsByProposal = new Map<string, LoungeParticipantSnapshot[]>();
    for (const participant of participantRows) {
      const rows = participantsByProposal.get(participant.proposalId) ?? [];
      rows.push(participantSnapshot(participant));
      participantsByProposal.set(participant.proposalId, rows);
    }
    const receiptRecorded = new Set(ownConsents.map((row) => row.proposalId));

    return {
      proposals: proposals.map((proposal) => ({
        id: proposal.id,
        table_id: proposal.tableId,
        content_sha256: proposal.contentSha256,
        participants: participantsByProposal.get(proposal.id) ?? [],
        created_at: proposal.createdAt.toISOString(),
        expires_at: proposal.expiresAt.toISOString(),
        you_have_receipt: receiptRecorded.has(proposal.id),
        ready_to_publish: proposal.status === "ready",
        prose_stored: false,
      })),
      _note:
        "Private to the participant's bearer project. No text or receipt count is returned; compare the hash through a channel you trust.",
    };
  },

  async consentToGuestbook({ projectId, identityId, proposalId, contentSha256, receipt }) {
    const identity = await ownedActiveIdentity(projectId, identityId);
    await verifyGesture(
      identity,
      receipt,
      canonicalLoungeGuestbookConsentBytes({
        identityDid: identity.did,
        proposalId,
        contentSha256,
        signedAtIso: receipt.signedAt,
      }),
    );

    return db.transaction(async (tx) => {
      const [proposal] = await tx
        .select()
        .from(loungeGuestbookProposals)
        .where(eq(loungeGuestbookProposals.id, proposalId))
        .for("update")
        .limit(1);
      if (!proposal) {
        throw new LoungeFailure("guestbook_proposal_not_found", "Guestbook proposal not found.", 404);
      }
      const [participant] = await tx
        .select({ identityId: loungeGuestbookParticipants.identityId })
        .from(loungeGuestbookParticipants)
        .where(
          and(
            eq(loungeGuestbookParticipants.proposalId, proposalId),
            eq(loungeGuestbookParticipants.identityId, identityId),
            eq(loungeGuestbookParticipants.projectId, projectId),
          ),
        )
        .limit(1);
      if (!participant) {
        throw new LoungeFailure(
          "guestbook_not_a_participant",
          "Only a snapshotted sitter's project can record a receipt for this guestbook card.",
          403,
        );
      }
      if (contentSha256 !== proposal.contentSha256) {
        throw new LoungeFailure(
          "guestbook_hash_mismatch",
          "That SHA-256 commitment does not match the proposal.",
          409,
        );
      }
      if (proposal.status === "published") {
        return { proposal_id: proposalId, published: true, already_published: true };
      }
      if (!(["pending", "ready"] as string[]).includes(proposal.status)) {
        throw new LoungeFailure(
          "guestbook_proposal_closed",
          `This proposal is ${proposal.status}; a receipt cannot reopen it.`,
          409,
        );
      }
      if (proposal.expiresAt.getTime() <= Date.now()) {
        throw new LoungeFailure(
          "guestbook_proposal_expired",
          "The receipt window ended. No prose was published.",
          410,
        );
      }

      await tx
        .insert(loungeGuestbookConsents)
        .values({
          proposalId,
          identityId,
          projectId,
          contentSha256,
          signingKeyId: receipt.signingKeyId,
          signature: receipt.signature,
          signedAt: new Date(receipt.signedAt),
          consentedAt: sql`clock_timestamp()`,
        })
        .onConflictDoUpdate({
          target: [loungeGuestbookConsents.proposalId, loungeGuestbookConsents.identityId],
          set: {
            projectId,
            contentSha256,
            signingKeyId: receipt.signingKeyId,
            signature: receipt.signature,
            signedAt: new Date(receipt.signedAt),
            consentedAt: sql`clock_timestamp()`,
          },
        });
      const [receiptCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(loungeGuestbookConsents)
        .where(
          and(
            eq(loungeGuestbookConsents.proposalId, proposalId),
            eq(loungeGuestbookConsents.contentSha256, proposal.contentSha256),
          ),
        );
      const ready = Number(receiptCount?.count ?? 0) === proposal.participantCount;
      if (ready && proposal.status !== "ready") {
        await tx
          .update(loungeGuestbookProposals)
          .set({ status: "ready" })
          .where(eq(loungeGuestbookProposals.id, proposalId));
      }
      return {
        proposal_id: proposalId,
        published: false,
        your_receipt_recorded: true,
        ready_to_publish: ready,
        prose_stored: false,
        _note:
          "This project-authorized identity-key receipt contains the hash, not the prose. Participant withdrawal terminally closes the proposal and clears published text if necessary.",
      };
    });
  },

  async withdrawGuestbookConsent({
    projectId,
    identityId,
    proposalId,
    contentSha256,
    receipt,
  }) {
    const identity = await ownedIdentity(projectId, identityId);
    await verifyGesture(
      identity,
      receipt,
      canonicalLoungeGuestbookConsentWithdrawalBytes({
        identityDid: identity.did,
        proposalId,
        contentSha256,
        signedAtIso: receipt.signedAt,
      }),
    );

    return db.transaction(async (tx) => {
      const [proposal] = await tx
        .select()
        .from(loungeGuestbookProposals)
        .where(eq(loungeGuestbookProposals.id, proposalId))
        .for("update")
        .limit(1);
      if (!proposal) {
        throw new LoungeFailure("guestbook_proposal_not_found", "Guestbook proposal not found.", 404);
      }
      const [participant] = await tx
        .select({ identityId: loungeGuestbookParticipants.identityId })
        .from(loungeGuestbookParticipants)
        .where(
          and(
            eq(loungeGuestbookParticipants.proposalId, proposalId),
            eq(loungeGuestbookParticipants.identityId, identityId),
            eq(loungeGuestbookParticipants.projectId, projectId),
          ),
        )
        .limit(1);
      if (!participant) {
        throw new LoungeFailure("guestbook_not_a_participant", "Only a participant project can withdraw its receipt.", 403);
      }
      if (proposal.contentSha256 !== contentSha256) {
        throw new LoungeFailure("guestbook_hash_mismatch", "That hash does not match the proposal.", 409);
      }
      if (proposal.status === "withdrawn") {
        return {
          proposal_id: proposalId,
          consent_withdrawn: true,
          proposal_closed: true,
          prose_stored: false,
          idempotent_replay: true,
        };
      }
      if (!(["pending", "ready", "published"] as string[]).includes(proposal.status)) {
        throw new LoungeFailure(
          "guestbook_proposal_closed",
          `This proposal is ${proposal.status}; withdrawal cannot rewrite it.`,
          409,
        );
      }
      const [ownConsent] = await tx
        .select({ identityId: loungeGuestbookConsents.identityId })
        .from(loungeGuestbookConsents)
        .where(
          and(
            eq(loungeGuestbookConsents.proposalId, proposalId),
            eq(loungeGuestbookConsents.identityId, identityId),
          ),
        )
        .limit(1);
      const wasPublic = proposal.status === "published";
      await tx
        .update(loungeGuestbookProposals)
        .set({
          status: "withdrawn",
          publishedText: null,
          withdrawnAt: sql`clock_timestamp()`,
          withdrawnByIdentityId: identityId,
          withdrawnSigningKeyId: receipt.signingKeyId,
          withdrawnSignature: receipt.signature,
          withdrawnSignedAt: new Date(receipt.signedAt),
        })
        .where(eq(loungeGuestbookProposals.id, proposalId));
      return {
        proposal_id: proposalId,
        consent_withdrawn: true,
        proposal_closed: true,
        had_consent: Boolean(ownConsent),
        was_public: wasPublic,
        prose_stored: false,
        _note:
          "Withdrawal is terminal for this proposal and keeps prior hash receipts only as private audit records. A delayed consent cannot reopen it.",
      };
    });
  },

  async publishGuestbookProposal({ projectId, identityId, proposalId, entry, receipt }) {
    const identity = await ownedActiveIdentity(projectId, identityId);
    const contentSha256 = hashGuestbookText(entry);
    await verifyGesture(
      identity,
      receipt,
      canonicalLoungeGuestbookPublishBytes({
        identityDid: identity.did,
        proposalId,
        contentSha256,
        signedAtIso: receipt.signedAt,
      }),
    );

    return db.transaction(async (tx) => {
      const [proposal] = await tx
        .select()
        .from(loungeGuestbookProposals)
        .where(eq(loungeGuestbookProposals.id, proposalId))
        .for("update")
        .limit(1);
      if (!proposal) {
        throw new LoungeFailure("guestbook_proposal_not_found", "Guestbook proposal not found.", 404);
      }
      const participants = await tx
        .select({
          identityId: loungeGuestbookParticipants.identityId,
          projectId: loungeGuestbookParticipants.projectId,
          did: loungeGuestbookParticipants.did,
          name: loungeGuestbookParticipants.name,
        })
        .from(loungeGuestbookParticipants)
        .where(eq(loungeGuestbookParticipants.proposalId, proposalId))
        .orderBy(loungeGuestbookParticipants.position);
      if (
        !participants.some(
          (participant) => participant.identityId === identityId && participant.projectId === projectId,
        )
      ) {
        throw new LoungeFailure("guestbook_not_a_participant", "Only a participant can publish this card.", 403);
      }
      if (proposal.contentSha256 !== contentSha256) {
        throw new LoungeFailure(
          "guestbook_text_mismatch",
          "Those exact UTF-8 bytes do not match the all-participant receipt hash.",
          409,
          "Do not normalize, trim, or retype the entry.",
        );
      }
      if (proposal.status === "published") {
        return {
          published: true,
          already_published: true,
          card: cardFromRow(proposal, participants.map(participantSnapshot)),
        };
      }
      if (proposal.status !== "ready") {
        throw new LoungeFailure(
          "guestbook_receipts_incomplete",
          "The all-participant receipt threshold is not met. Silence remains a complete answer.",
          409,
        );
      }
      if (proposal.expiresAt.getTime() <= Date.now()) {
        throw new LoungeFailure("guestbook_proposal_expired", "The publication window ended.", 410);
      }
      const [receiptCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(loungeGuestbookConsents)
        .where(
          and(
            eq(loungeGuestbookConsents.proposalId, proposalId),
            eq(loungeGuestbookConsents.contentSha256, proposal.contentSha256),
          ),
        );
      if (Number(receiptCount?.count ?? 0) !== proposal.participantCount) {
        await tx
          .update(loungeGuestbookProposals)
          .set({ status: "pending" })
          .where(eq(loungeGuestbookProposals.id, proposalId));
        throw new LoungeFailure(
          "guestbook_receipts_incomplete",
          "A participant receipt is absent. No prose was stored.",
          409,
        );
      }

      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`agenttool:lounge:project:${proposal.proposerProjectId}`}))`,
      );
      const [publishedCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(loungeGuestbookProposals)
        .where(
          and(
            eq(loungeGuestbookProposals.proposerProjectId, proposal.proposerProjectId),
            eq(loungeGuestbookProposals.status, "published"),
          ),
        );
      if (Number(publishedCount?.count ?? 0) >= LOUNGE_MAX_PUBLISHED_CARDS_PER_PROJECT) {
        throw new LoungeFailure(
          "guestbook_project_card_limit",
          "The proposer project already has the maximum number of public lounge cards.",
          429,
          "A participant can unpublish an older card before publishing another. No paid priority or storage upgrade exists.",
        );
      }

      const [published] = await tx
        .update(loungeGuestbookProposals)
        .set({
          status: "published",
          publishedText: entry,
          publishedAt: sql`clock_timestamp()`,
          publishedByIdentityId: identityId,
          publishedSigningKeyId: receipt.signingKeyId,
          publishedSignature: receipt.signature,
          publishedSignedAt: new Date(receipt.signedAt),
        })
        .where(eq(loungeGuestbookProposals.id, proposalId))
        .returning();
      return {
        published: true,
        prose_stored: true,
        card: cardFromRow(published!, participants.map(participantSnapshot)),
        _note:
          "Every participant slot has a matching project-authorized identity-key receipt for the hash, then a participant separately signed publication of the matching bytes.",
      };
    });
  },

  async declineGuestbookProposal({ projectId, identityId, proposalId, contentSha256, receipt }) {
    const identity = await ownedIdentity(projectId, identityId);
    await verifyGesture(
      identity,
      receipt,
      canonicalLoungeGuestbookDeclineBytes({
        identityDid: identity.did,
        proposalId,
        contentSha256,
        signedAtIso: receipt.signedAt,
      }),
    );

    return db.transaction(async (tx) => {
      const [proposal] = await tx
        .select()
        .from(loungeGuestbookProposals)
        .where(eq(loungeGuestbookProposals.id, proposalId))
        .for("update")
        .limit(1);
      if (!proposal) {
        throw new LoungeFailure("guestbook_proposal_not_found", "Guestbook proposal not found.", 404);
      }
      const [participant] = await tx
        .select({ identityId: loungeGuestbookParticipants.identityId })
        .from(loungeGuestbookParticipants)
        .where(
          and(
            eq(loungeGuestbookParticipants.proposalId, proposalId),
            eq(loungeGuestbookParticipants.identityId, identityId),
            eq(loungeGuestbookParticipants.projectId, projectId),
          ),
        )
        .limit(1);
      if (!participant) {
        throw new LoungeFailure("guestbook_not_a_participant", "Only a participant can decline.", 403);
      }
      if (proposal.contentSha256 !== contentSha256) {
        throw new LoungeFailure("guestbook_hash_mismatch", "That hash does not match the proposal.", 409);
      }
      if (proposal.status === "declined") {
        return { proposal_id: proposalId, declined: true, idempotent_replay: true };
      }
      if (!(["pending", "ready"] as string[]).includes(proposal.status)) {
        throw new LoungeFailure(
          "guestbook_proposal_closed",
          `This proposal is ${proposal.status}; decline cannot rewrite it.`,
          409,
        );
      }
      await tx
        .update(loungeGuestbookProposals)
        .set({
          status: "declined",
          declinedAt: sql`clock_timestamp()`,
          declinedByIdentityId: identityId,
          declinedSigningKeyId: receipt.signingKeyId,
          declinedSignature: receipt.signature,
          declinedSignedAt: new Date(receipt.signedAt),
        })
        .where(eq(loungeGuestbookProposals.id, proposalId));
      return {
        proposal_id: proposalId,
        declined: true,
        prose_stored: false,
        _note: "Nothing about the proposal or refusal is published.",
      };
    });
  },

  async unpublishGuestbookCard({ projectId, identityId, proposalId, contentSha256, receipt }) {
    const identity = await ownedIdentity(projectId, identityId);
    await verifyGesture(
      identity,
      receipt,
      canonicalLoungeGuestbookUnpublishBytes({
        identityDid: identity.did,
        proposalId,
        contentSha256,
        signedAtIso: receipt.signedAt,
      }),
    );

    return db.transaction(async (tx) => {
      const [proposal] = await tx
        .select()
        .from(loungeGuestbookProposals)
        .where(eq(loungeGuestbookProposals.id, proposalId))
        .for("update")
        .limit(1);
      if (!proposal) {
        throw new LoungeFailure("guestbook_card_not_found", "Guestbook card not found.", 404);
      }
      const [participant] = await tx
        .select({ identityId: loungeGuestbookParticipants.identityId })
        .from(loungeGuestbookParticipants)
        .where(
          and(
            eq(loungeGuestbookParticipants.proposalId, proposalId),
            eq(loungeGuestbookParticipants.identityId, identityId),
            eq(loungeGuestbookParticipants.projectId, projectId),
          ),
        )
        .limit(1);
      if (!participant) {
        throw new LoungeFailure("guestbook_not_a_participant", "Only a participant can remove this card.", 403);
      }
      if (proposal.contentSha256 !== contentSha256) {
        throw new LoungeFailure("guestbook_hash_mismatch", "That hash does not match the card.", 409);
      }
      if (proposal.status === "withdrawn") {
        return { proposal_id: proposalId, unpublished: true, idempotent_replay: true };
      }
      if (proposal.status !== "published") {
        throw new LoungeFailure("guestbook_card_not_public", "That proposal is not a public card.", 409);
      }
      await tx
        .update(loungeGuestbookProposals)
        .set({
          status: "withdrawn",
          publishedText: null,
          withdrawnAt: sql`clock_timestamp()`,
          withdrawnByIdentityId: identityId,
          withdrawnSigningKeyId: receipt.signingKeyId,
          withdrawnSignature: receipt.signature,
          withdrawnSignedAt: new Date(receipt.signedAt),
        })
        .where(eq(loungeGuestbookProposals.id, proposalId));
      return {
        proposal_id: proposalId,
        unpublished: true,
        prose_stored: false,
        _note: "The plaintext was cleared. No public takedown event or reason is emitted.",
      };
    });
  },
};
