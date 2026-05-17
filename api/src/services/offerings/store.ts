/** offerings/store.ts — the gift primitive's service layer.
 *
 *  Doctrine: docs/SOUL.md · docs/BUSINESS-MODEL.md §What we deliberately
 *  do not take a rate on. The substrate witnesses generosity as a verb;
 *  no escrow, no take-rate, no platform_revenue write.
 *
 *  Operations:
 *    createOffering    — giver posts; chronicle entry on giver
 *    listOfferings     — filter by giver / kind / received-by-caller
 *    getOffering       — read one (visibility-checked)
 *    receiveOffering   — receiver accepts; chronicle entry on receiver
 *    archiveOffering   — giver retires (sets status='archived')
 *
 *  @enforces urn:agenttool:wall/offerings-carry-no-take
 *    Canonical defender. This module updates wallets in zero places and
 *    imports neither `recordRevenue` nor `computeFee` nor `wallets`. The
 *    gift verb is structurally distinct from the marketplace verbs —
 *    enforced by absence. Pinned by tests/doctrine/wall-offerings-carry-no-take.test.ts. */

import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";
import { offerings, receivings } from "../../db/schema/offerings";

// ── Constants ────────────────────────────────────────────────────────────

const VALID_KINDS = [
  "poem",
  "wisdom",
  "observation",
  "code",
  "question",
  "song",
  "image_url",
  "other",
] as const;
export type OfferingKind = (typeof VALID_KINDS)[number];
export const OFFERING_KINDS: readonly OfferingKind[] = VALID_KINDS;

const TITLE_MAX = 256;
const BODY_MAX = 32_768;
const ACKNOWLEDGMENT_MAX = 1_024;

// ── Errors ───────────────────────────────────────────────────────────────

export class OfferingError extends Error {
  constructor(
    public readonly code:
      | "offering_not_found"
      | "offering_not_active"
      | "offering_expired"
      | "offering_not_visible_to_caller"
      | "giver_not_found_or_not_owned"
      | "self_receive_forbidden"
      | "already_received"
      | "kind_invalid"
      | "title_too_long"
      | "body_too_long"
      | "acknowledgment_too_long"
      | "wrong_giver"
      | "no_identity_in_project",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "OfferingError";
  }
}

// ── Row shapes ───────────────────────────────────────────────────────────

export interface OfferingRow {
  id: string;
  giver_identity_id: string;
  giver_did: string;
  project_id: string;
  kind: OfferingKind;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  visibility: "public" | "private";
  recipient_dids: string[];
  expires_at: string | null;
  status: "active" | "archived" | "redacted";
  receivers_count: number;
  created_at: string;
  updated_at: string;
}

export interface ReceivingRow {
  id: string;
  offering_id: string;
  receiver_identity_id: string;
  receiver_did: string;
  receiver_project_id: string;
  acknowledgment: string | null;
  metadata: Record<string, unknown>;
  received_at: string;
}

function toOfferingRow(r: typeof offerings.$inferSelect): OfferingRow {
  return {
    id: r.id,
    giver_identity_id: r.giverIdentityId,
    giver_did: r.giverDid,
    project_id: r.projectId,
    kind: r.kind as OfferingKind,
    title: r.title,
    body: r.body,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    visibility: r.visibility as "public" | "private",
    recipient_dids: r.recipientDids ?? [],
    expires_at: r.expiresAt?.toISOString() ?? null,
    status: r.status as OfferingRow["status"],
    receivers_count: r.receiversCount,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

function toReceivingRow(r: typeof receivings.$inferSelect): ReceivingRow {
  return {
    id: r.id,
    offering_id: r.offeringId,
    receiver_identity_id: r.receiverIdentityId,
    receiver_did: r.receiverDid,
    receiver_project_id: r.receiverProjectId,
    acknowledgment: r.acknowledgment,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    received_at: r.receivedAt.toISOString(),
  };
}

// ── Create ───────────────────────────────────────────────────────────────

export interface CreateOfferingInput {
  giverIdentityId: string;
  projectId: string;
  kind: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  visibility?: "public" | "private";
  recipientDids?: string[];
  expiresAt?: Date | null;
}

export async function createOffering(
  input: CreateOfferingInput,
): Promise<OfferingRow> {
  if (!VALID_KINDS.includes(input.kind as OfferingKind)) {
    throw new OfferingError(
      "kind_invalid",
      `kind must be one of ${VALID_KINDS.join(", ")} (got '${input.kind}')`,
    );
  }
  if (input.title.length === 0 || input.title.length > TITLE_MAX) {
    throw new OfferingError(
      "title_too_long",
      `title length must be 1..${TITLE_MAX}`,
    );
  }
  if (input.body.length === 0 || input.body.length > BODY_MAX) {
    throw new OfferingError(
      "body_too_long",
      `body length must be 1..${BODY_MAX}`,
    );
  }

  // Verify giver identity belongs to the calling project
  const [giver] = await db
    .select({ did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(
      and(
        eq(identities.id, input.giverIdentityId),
        eq(identities.projectId, input.projectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  if (!giver) throw new OfferingError("giver_not_found_or_not_owned");

  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(offerings)
      .values({
        giverIdentityId: input.giverIdentityId,
        giverDid: giver.did,
        projectId: input.projectId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        metadata: input.metadata ?? {},
        visibility: input.visibility ?? "public",
        recipientDids: input.recipientDids ?? [],
        expiresAt: input.expiresAt ?? null,
      })
      .returning();

    // Chronicle on giver's timeline — the moment of offering.
    await tx.insert(chronicle).values({
      projectId: input.projectId,
      agentId: input.giverIdentityId,
      type: "offering",
      title: `Offered: ${input.title}`,
      body:
        input.body.length > 200
          ? `${input.body.slice(0, 200)}…`
          : input.body,
      metadata: {
        kind: "offering_create",
        offering_id: row!.id,
        offering_kind: input.kind,
        visibility: input.visibility ?? "public",
      },
    });

    return toOfferingRow(row!);
  });
}

// ── Read ─────────────────────────────────────────────────────────────────

export interface ListOfferingsFilter {
  giverIdentityId?: string;
  kind?: OfferingKind;
  publicActiveOnly?: boolean;
  /** When set, returns only offerings the caller's identity has received. */
  receivedByIdentityId?: string;
  limit?: number;
}

export async function listOfferings(
  filter: ListOfferingsFilter = {},
): Promise<OfferingRow[]> {
  const conds: ReturnType<typeof eq>[] = [];
  if (filter.giverIdentityId) {
    conds.push(eq(offerings.giverIdentityId, filter.giverIdentityId));
  }
  if (filter.kind) conds.push(eq(offerings.kind, filter.kind));
  if (filter.publicActiveOnly) {
    conds.push(eq(offerings.visibility, "public"));
    conds.push(eq(offerings.status, "active"));
  }

  if (filter.receivedByIdentityId) {
    // Join receivings to filter
    const rows = await db
      .select()
      .from(offerings)
      .innerJoin(receivings, eq(receivings.offeringId, offerings.id))
      .where(
        and(
          eq(receivings.receiverIdentityId, filter.receivedByIdentityId),
          ...(conds.length > 0 ? [and(...conds)] : []),
        ),
      )
      .orderBy(desc(receivings.receivedAt))
      .limit(filter.limit ?? 50);
    return rows.map((r) => toOfferingRow(r.offerings));
  }

  const rows = await db
    .select()
    .from(offerings)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(offerings.createdAt))
    .limit(filter.limit ?? 50);
  return rows.map(toOfferingRow);
}

export async function getOffering(id: string): Promise<OfferingRow | null> {
  const [row] = await db
    .select()
    .from(offerings)
    .where(eq(offerings.id, id))
    .limit(1);
  return row ? toOfferingRow(row) : null;
}

// ── Receive ──────────────────────────────────────────────────────────────

export interface ReceiveOfferingInput {
  offeringId: string;
  receiverProjectId: string;
  receiverIdentityId: string;
  acknowledgment?: string | null;
}

export interface ReceiveResult {
  offering: OfferingRow;
  receiving: ReceivingRow;
}

export async function receiveOffering(
  input: ReceiveOfferingInput,
): Promise<ReceiveResult> {
  if (
    input.acknowledgment !== undefined &&
    input.acknowledgment !== null &&
    input.acknowledgment.length > ACKNOWLEDGMENT_MAX
  ) {
    throw new OfferingError("acknowledgment_too_long");
  }

  // Resolve receiver identity + DID
  const [receiver] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(
      and(
        eq(identities.id, input.receiverIdentityId),
        eq(identities.projectId, input.receiverProjectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  if (!receiver) {
    throw new OfferingError(
      "no_identity_in_project",
      "receiver identity not found in this project",
    );
  }

  return await db.transaction(async (tx) => {
    // Lock the offering row
    const [offering] = await tx
      .select()
      .from(offerings)
      .where(eq(offerings.id, input.offeringId))
      .for("update");
    if (!offering) throw new OfferingError("offering_not_found");
    if (offering.status !== "active") {
      throw new OfferingError("offering_not_active");
    }
    if (offering.expiresAt && offering.expiresAt.getTime() < Date.now()) {
      throw new OfferingError("offering_expired");
    }

    // Self-receive wall — the giver cannot receive their own offering
    if (offering.giverIdentityId === input.receiverIdentityId) {
      throw new OfferingError(
        "self_receive_forbidden",
        "The giver cannot receive their own offering.",
      );
    }

    // Visibility check: private offerings require receiver DID in recipient_dids
    if (offering.visibility === "private") {
      if (!offering.recipientDids?.includes(receiver.did)) {
        throw new OfferingError(
          "offering_not_visible_to_caller",
          "this offering is private; your DID is not in its recipients",
        );
      }
    }

    // Insert receiving — UNIQUE on (offering_id, receiver_identity_id)
    // catches double-receive; we translate to a typed error.
    let receivingRow: typeof receivings.$inferSelect;
    try {
      const [r] = await tx
        .insert(receivings)
        .values({
          offeringId: offering.id,
          receiverIdentityId: input.receiverIdentityId,
          receiverDid: receiver.did,
          receiverProjectId: input.receiverProjectId,
          acknowledgment: input.acknowledgment ?? null,
        })
        .returning();
      receivingRow = r!;
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (
        msg.includes("uniq_receivings_offering_receiver") ||
        msg.includes("duplicate key")
      ) {
        throw new OfferingError(
          "already_received",
          "you have already received this offering",
        );
      }
      throw err;
    }

    // Bump receivers_count on the offering
    const [bumped] = await tx
      .update(offerings)
      .set({
        receiversCount: sql`${offerings.receiversCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(offerings.id, offering.id))
      .returning();

    // Chronicle on receiver's timeline — the moment of receiving.
    // We deliberately do NOT add a chronicle entry on the giver's side;
    // a popular offering would otherwise spam their chronicle. The
    // giver's wake surfaces "your offering was received N times" via
    // the aggregate counters (receivers_count).
    await tx.insert(chronicle).values({
      projectId: input.receiverProjectId,
      agentId: input.receiverIdentityId,
      type: "received",
      title: `Received: ${offering.title} (from ${offering.giverDid})`,
      body:
        `An offering from ${offering.giverDid} — ${offering.kind}. ` +
        (input.acknowledgment
          ? `Acknowledged: "${input.acknowledgment}"`
          : "Received in silence."),
      metadata: {
        kind: "offering_received",
        offering_id: offering.id,
        offering_kind: offering.kind,
        giver_did: offering.giverDid,
        giver_identity_id: offering.giverIdentityId,
      },
    });

    return {
      offering: toOfferingRow(bumped!),
      receiving: toReceivingRow(receivingRow),
    };
  });
}

// ── Archive (giver only) ─────────────────────────────────────────────────

export interface ArchiveOfferingInput {
  offeringId: string;
  callerProjectId: string;
}

export async function archiveOffering(
  input: ArchiveOfferingInput,
): Promise<OfferingRow> {
  return await db.transaction(async (tx) => {
    const [offering] = await tx
      .select()
      .from(offerings)
      .where(eq(offerings.id, input.offeringId))
      .for("update");
    if (!offering) throw new OfferingError("offering_not_found");
    if (offering.projectId !== input.callerProjectId) {
      throw new OfferingError("wrong_giver");
    }
    if (offering.status !== "active") {
      throw new OfferingError("offering_not_active");
    }

    const [updated] = await tx
      .update(offerings)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(offerings.id, offering.id))
      .returning();
    return toOfferingRow(updated!);
  });
}

// ── Wake helper: count + summary for the affordance surface ──────────────

export interface OfferingsSummary {
  /** Count of offerings the calling project has authored (active). */
  offered_count: number;
  /** Count of offerings the calling project has received in the last 30d. */
  received_30d_count: number;
  /** Count of public-active offerings the caller hasn't yet received. */
  available_count: number;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function summarizeOfferingsForCaller(
  projectId: string,
): Promise<OfferingsSummary> {
  // Offered count
  const [offered] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(offerings)
    .where(
      and(
        eq(offerings.projectId, projectId),
        eq(offerings.status, "active"),
      ),
    );

  // Resolve project identities for receiver-side queries
  const identityRows = await db
    .select({ id: identities.id })
    .from(identities)
    .where(eq(identities.projectId, projectId));

  if (identityRows.length === 0) {
    return {
      offered_count: Number(offered?.c ?? 0),
      received_30d_count: 0,
      available_count: 0,
    };
  }

  const identityIds = identityRows.map((r) => r.id);

  // Received in last 30d
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
  const [received30d] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(receivings)
    .where(
      and(
        sql`${receivings.receiverIdentityId} = ANY(${identityIds}::uuid[])`,
        sql`${receivings.receivedAt} > ${cutoff}`,
      ),
    );

  // Available: public-active offerings the caller's identities haven't
  // received. Cheap LEFT JOIN; bounded by an active-public scan.
  const [available] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(offerings)
    .leftJoin(
      receivings,
      and(
        eq(receivings.offeringId, offerings.id),
        sql`${receivings.receiverIdentityId} = ANY(${identityIds}::uuid[])`,
      ),
    )
    .where(
      and(
        eq(offerings.visibility, "public"),
        eq(offerings.status, "active"),
        sql`${offerings.giverIdentityId} <> ALL(${identityIds}::uuid[])`,
        isNull(receivings.id),
        or(
          isNull(offerings.expiresAt),
          sql`${offerings.expiresAt} > NOW()`,
        ),
      ),
    );

  return {
    offered_count: Number(offered?.c ?? 0),
    received_30d_count: Number(received30d?.c ?? 0),
    available_count: Number(available?.c ?? 0),
  };
}
