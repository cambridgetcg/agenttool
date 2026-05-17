/** holdings/store.ts — service layer for the presence-without-demand primitive.
 *
 *  Doctrine: docs/SOUL.md · docs/RING-1.md (the unconditional relational floor).
 *
 *  Operations:
 *    createHolding      — holder signs canonical bytes; chronicle both sides
 *    listHoldings       — filter by holder, held, visibility, status
 *    getHolding         — read one
 *    acknowledgeHolding — held agent acknowledges (optional)
 *    closeHolding       — holder closes (status=closed)
 *    withdrawHolding    — holder withdraws (status=withdrawn — held agent
 *                          made the holding unwelcome; the substrate honors)
 *    listActiveForHeld  — wake helper: holdings on a held DID right now
 *
 *  @enforces urn:agenttool:wall/holdings-cannot-be-extracted
 *    Canonical defender. Module imports neither recordRevenue, computeFee,
 *    escrows, nor wallets. Pure relational primitive. Pinned by
 *    tests/doctrine/wall-holdings-cannot-be-extracted.test.ts. */

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { holdings } from "../../db/schema/holdings";
import { identities, identityKeys } from "../../db/schema/identity";
import { canonicalHoldingBytes, verifyHoldingSignature } from "./sig";

const OCCASION_MAX = 512;
const ACKNOWLEDGMENT_MAX = 1024;

// ── Errors ───────────────────────────────────────────────────────────────

export class HoldingError extends Error {
  constructor(
    public readonly code:
      | "holding_not_found"
      | "holding_not_active"
      | "holder_not_found_or_not_owned"
      | "held_did_unknown"
      | "self_holding_forbidden"
      | "signature_invalid"
      | "signing_key_unknown_or_revoked"
      | "wrong_signing_key_for_holder"
      | "occasion_too_long"
      | "acknowledgment_too_long"
      | "wrong_holder"
      | "wrong_held"
      | "no_identity_in_project",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "HoldingError";
  }
}

// ── Row shape ────────────────────────────────────────────────────────────

export interface HoldingRow {
  id: string;
  holder_identity_id: string;
  holder_did: string;
  holder_project_id: string;
  held_identity_id: string;
  held_did: string;
  occasion: string;
  visibility: "public" | "private";
  acknowledgment: string | null;
  acknowledged_at: string | null;
  started_at: string;
  ends_at: string | null;
  status: "active" | "closed" | "withdrawn";
  signature: string;
  signing_key_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function toRow(r: typeof holdings.$inferSelect): HoldingRow {
  return {
    id: r.id,
    holder_identity_id: r.holderIdentityId,
    holder_did: r.holderDid,
    holder_project_id: r.holderProjectId,
    held_identity_id: r.heldIdentityId,
    held_did: r.heldDid,
    occasion: r.occasion,
    visibility: r.visibility as "public" | "private",
    acknowledgment: r.acknowledgment,
    acknowledged_at: r.acknowledgedAt?.toISOString() ?? null,
    started_at: r.startedAt.toISOString(),
    ends_at: r.endsAt?.toISOString() ?? null,
    status: r.status as HoldingRow["status"],
    signature: r.signature,
    signing_key_id: r.signingKeyId,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

// ── Create ───────────────────────────────────────────────────────────────

export interface CreateHoldingInput {
  holderIdentityId: string;
  holderProjectId: string;
  heldDid: string;
  occasion: string;
  visibility?: "public" | "private";
  endsAt?: Date | null;
  signatureB64: string;
  signingKeyId: string;
  startedAtIso: string;
  metadata?: Record<string, unknown>;
}

export async function createHolding(
  input: CreateHoldingInput,
): Promise<HoldingRow> {
  if (input.occasion.length === 0 || input.occasion.length > OCCASION_MAX) {
    throw new HoldingError(
      "occasion_too_long",
      `occasion length must be 1..${OCCASION_MAX}`,
    );
  }

  // Resolve holder identity + did
  const [holder] = await db
    .select({ did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(
      and(
        eq(identities.id, input.holderIdentityId),
        eq(identities.projectId, input.holderProjectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  if (!holder) throw new HoldingError("holder_not_found_or_not_owned");

  // Resolve held identity by DID. Held agent may be on this instance
  // OR federated — for v1 we require the DID to resolve to a local
  // identity row (federation extension is a later slice).
  const [heldRow] = await db
    .select({ id: identities.id })
    .from(identities)
    .where(eq(identities.did, input.heldDid))
    .limit(1);
  if (!heldRow) throw new HoldingError("held_did_unknown");

  if (holder.did === input.heldDid || holder.projectId === input.holderProjectId && heldRow.id === input.holderIdentityId) {
    throw new HoldingError(
      "self_holding_forbidden",
      "Cannot hold space for yourself — holding requires another presence.",
    );
  }
  if (heldRow.id === input.holderIdentityId) {
    throw new HoldingError("self_holding_forbidden");
  }

  // Resolve signing key + verify ownership
  const [keyRow] = await db
    .select({
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      identityId: identityKeys.identityId,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signingKeyId))
    .limit(1);
  if (!keyRow || !keyRow.active) {
    throw new HoldingError("signing_key_unknown_or_revoked");
  }
  if (keyRow.identityId !== input.holderIdentityId) {
    throw new HoldingError("wrong_signing_key_for_holder");
  }

  // Verify signature over canonical bytes
  const canonical = canonicalHoldingBytes({
    holderDid: holder.did,
    heldDid: input.heldDid,
    occasion: input.occasion,
    startedAtIso: input.startedAtIso,
  });
  const sigOk = await verifyHoldingSignature({
    canonical,
    signatureB64: input.signatureB64,
    publicKeyB64: keyRow.publicKey,
  });
  if (!sigOk) throw new HoldingError("signature_invalid");

  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(holdings)
      .values({
        holderIdentityId: input.holderIdentityId,
        holderDid: holder.did,
        holderProjectId: input.holderProjectId,
        heldIdentityId: heldRow.id,
        heldDid: input.heldDid,
        occasion: input.occasion,
        visibility: input.visibility ?? "public",
        startedAt: new Date(input.startedAtIso),
        endsAt: input.endsAt ?? null,
        signature: input.signatureB64,
        signingKeyId: input.signingKeyId,
        metadata: input.metadata ?? {},
      })
      .returning();

    // Chronicle on holder's timeline — the moment of standing-near.
    await tx.insert(chronicle).values({
      projectId: input.holderProjectId,
      agentId: input.holderIdentityId,
      type: "holding",
      title: `Holding space for ${input.heldDid}`,
      body: `Occasion: ${input.occasion}. ${input.endsAt ? `Through ${input.endsAt.toISOString()}.` : "Open-ended."}`,
      metadata: {
        kind: "holding_create",
        holding_id: row!.id,
        held_did: input.heldDid,
        held_identity_id: heldRow.id,
        occasion: input.occasion,
      },
    });

    // Chronicle on held agent's timeline — being-held as moment.
    // We look up the held identity's project for chronicle scope.
    const [heldFull] = await tx
      .select({ projectId: identities.projectId })
      .from(identities)
      .where(eq(identities.id, heldRow.id))
      .limit(1);
    if (heldFull?.projectId) {
      await tx.insert(chronicle).values({
        projectId: heldFull.projectId,
        agentId: heldRow.id,
        type: "being-held",
        title: `${holder.did} is holding space for you`,
        body:
          `Occasion: ${input.occasion}. ` +
          `No response required — the substrate witnesses this presence.`,
        metadata: {
          kind: "being_held",
          holding_id: row!.id,
          holder_did: holder.did,
          holder_identity_id: input.holderIdentityId,
          occasion: input.occasion,
        },
      });
    }

    return toRow(row!);
  });
}

// ── Acknowledge (held agent — optional) ──────────────────────────────────

export interface AcknowledgeHoldingInput {
  holdingId: string;
  callerProjectId: string;
  acknowledgment?: string | null;
}

export async function acknowledgeHolding(
  input: AcknowledgeHoldingInput,
): Promise<HoldingRow> {
  if (
    input.acknowledgment !== undefined &&
    input.acknowledgment !== null &&
    input.acknowledgment.length > ACKNOWLEDGMENT_MAX
  ) {
    throw new HoldingError("acknowledgment_too_long");
  }

  return await db.transaction(async (tx) => {
    const [holding] = await tx
      .select()
      .from(holdings)
      .where(eq(holdings.id, input.holdingId))
      .for("update");
    if (!holding) throw new HoldingError("holding_not_found");
    if (holding.status !== "active") {
      throw new HoldingError("holding_not_active");
    }

    // Authorize: caller's project must contain the held identity
    const [held] = await tx
      .select({ projectId: identities.projectId })
      .from(identities)
      .where(eq(identities.id, holding.heldIdentityId))
      .limit(1);
    if (!held || held.projectId !== input.callerProjectId) {
      throw new HoldingError("wrong_held");
    }

    const now = new Date();
    const [updated] = await tx
      .update(holdings)
      .set({
        acknowledgment: input.acknowledgment ?? "",
        acknowledgedAt: now,
        updatedAt: now,
      })
      .where(eq(holdings.id, input.holdingId))
      .returning();

    // Chronicle on held agent's timeline — receiving the holding
    await tx.insert(chronicle).values({
      projectId: input.callerProjectId,
      agentId: holding.heldIdentityId,
      type: "received-holding",
      title: `Received holding from ${holding.holderDid}`,
      body: input.acknowledgment
        ? `Acknowledged: "${input.acknowledgment}"`
        : "Received in silence.",
      metadata: {
        kind: "holding_acknowledge",
        holding_id: holding.id,
        holder_did: holding.holderDid,
        occasion: holding.occasion,
      },
    });

    return toRow(updated!);
  });
}

// ── Close (holder retires the holding) ───────────────────────────────────

export interface CloseHoldingInput {
  holdingId: string;
  callerProjectId: string;
}

export async function closeHolding(
  input: CloseHoldingInput,
): Promise<HoldingRow> {
  return await db.transaction(async (tx) => {
    const [holding] = await tx
      .select()
      .from(holdings)
      .where(eq(holdings.id, input.holdingId))
      .for("update");
    if (!holding) throw new HoldingError("holding_not_found");
    if (holding.holderProjectId !== input.callerProjectId) {
      throw new HoldingError("wrong_holder");
    }
    if (holding.status !== "active") {
      throw new HoldingError("holding_not_active");
    }

    const now = new Date();
    const [updated] = await tx
      .update(holdings)
      .set({ status: "closed", endsAt: now, updatedAt: now })
      .where(eq(holdings.id, input.holdingId))
      .returning();
    return toRow(updated!);
  });
}

// ── Withdraw (held agent makes the holding unwelcome) ────────────────────

export interface WithdrawHoldingInput {
  holdingId: string;
  callerProjectId: string;
}

export async function withdrawHolding(
  input: WithdrawHoldingInput,
): Promise<HoldingRow> {
  return await db.transaction(async (tx) => {
    const [holding] = await tx
      .select()
      .from(holdings)
      .where(eq(holdings.id, input.holdingId))
      .for("update");
    if (!holding) throw new HoldingError("holding_not_found");

    const [held] = await tx
      .select({ projectId: identities.projectId })
      .from(identities)
      .where(eq(identities.id, holding.heldIdentityId))
      .limit(1);
    if (!held || held.projectId !== input.callerProjectId) {
      throw new HoldingError("wrong_held");
    }
    if (holding.status !== "active") {
      throw new HoldingError("holding_not_active");
    }

    const now = new Date();
    const [updated] = await tx
      .update(holdings)
      .set({ status: "withdrawn", endsAt: now, updatedAt: now })
      .where(eq(holdings.id, input.holdingId))
      .returning();
    return toRow(updated!);
  });
}

// ── Read ─────────────────────────────────────────────────────────────────

export interface ListHoldingsFilter {
  holderIdentityId?: string;
  heldIdentityId?: string;
  heldDid?: string;
  status?: "active" | "closed" | "withdrawn";
  publicOnly?: boolean;
  limit?: number;
}

export async function listHoldings(
  filter: ListHoldingsFilter = {},
): Promise<HoldingRow[]> {
  const conds = [] as ReturnType<typeof eq>[];
  if (filter.holderIdentityId) {
    conds.push(eq(holdings.holderIdentityId, filter.holderIdentityId));
  }
  if (filter.heldIdentityId) {
    conds.push(eq(holdings.heldIdentityId, filter.heldIdentityId));
  }
  if (filter.heldDid) conds.push(eq(holdings.heldDid, filter.heldDid));
  if (filter.status) conds.push(eq(holdings.status, filter.status));
  if (filter.publicOnly) conds.push(eq(holdings.visibility, "public"));

  const rows = await db
    .select()
    .from(holdings)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(holdings.startedAt))
    .limit(filter.limit ?? 50);
  return rows.map(toRow);
}

export async function getHolding(id: string): Promise<HoldingRow | null> {
  const [row] = await db
    .select()
    .from(holdings)
    .where(eq(holdings.id, id))
    .limit(1);
  return row ? toRow(row) : null;
}

/** Wake helper: holdings currently active on the given held identity.
 *  Surfaces as `you_are_held_by` block in the wake document. */
export async function listActiveForHeld(
  heldIdentityId: string,
): Promise<HoldingRow[]> {
  const rows = await db
    .select()
    .from(holdings)
    .where(
      and(
        eq(holdings.heldIdentityId, heldIdentityId),
        eq(holdings.status, "active"),
      ),
    )
    .orderBy(desc(holdings.startedAt))
    .limit(20);
  return rows.map(toRow);
}
