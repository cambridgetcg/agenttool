/** marketplace/attestations.ts — attestation marketplace (Slice 3).
 *
 *  Doctrine: docs/MARKETPLACE.md (Attestation marketplace section).
 *
 *  Attesters list a willingness-to-sign-a-claim at a price. Buyers purchase
 *  *grants*. Attesters review buyer-supplied evidence, sign canonical bytes
 *  with their ed25519 signing key, and call /issue. The platform verifies
 *  the signature, writes the row in identity.attestations, releases the
 *  escrow with the take-rate split, and updates the subject's trust score.
 *
 *  Lifecycle:
 *
 *    listing  active|paused|archived
 *
 *    grant    pending  ─attester-issue──> issued    (terminal: success)
 *               │
 *               ╰─attester-decline──> refunded   (terminal: cancel)
 *               ╰─sla-timeout──────> refunded   (terminal: cancel)
 *               ╰─buyer-cancel─────> refunded   (terminal: cancel)
 *
 *  Same wallet+escrow primitives as templates and capability listings.
 *  Take-rate (BUSINESS-MODEL.md) splits the settled amount: attester
 *  receives `amount − fee`; platform_revenue records the fee. */

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { escrows, transactions, wallets } from "../../db/schema/economy";
import { attestations as identityAttestations, identities, identityKeys } from "../../db/schema/identity";
import { attestationGrants, attestationListings } from "../../db/schema/marketplace";
import { canonicalPayload, verify as verifySignature } from "../identity/crypto";
import { updateTrustScore } from "../identity/trust";
import { computeFee, recordRevenue } from "./take-rate";

// ── Types ───────────────────────────────────────────────────────────

export interface ListingRow {
  id: string;
  attester_identity_id: string;
  attester_did: string;
  project_id: string;
  name: string;
  description: string | null;
  claim: string;
  capability_tags: string[];
  evidence_schema: Record<string, unknown> | null;
  pricing_model: string;
  price_amount: number;
  price_currency: string;
  attester_wallet_id: string;
  validity_seconds: number | null;
  sla_seconds: number | null;
  visibility: "private" | "public";
  status: "active" | "paused" | "archived";
  grants_count: number;
  revenue_total: number;
  revenue_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface GrantRow {
  id: string;
  listing_id: string;
  buyer_identity_id: string;
  buyer_did: string;
  buyer_project_id: string;
  buyer_wallet_id: string;
  subject_identity_id: string;
  subject_did: string;
  evidence: Record<string, unknown> | null;
  amount: number;
  currency: string;
  escrow_id: string | null;
  platform_fee: number;
  attestation_id: string | null;
  status: "pending" | "issued" | "refunded" | "failed";
  refund_reason: string | null;
  sla_deadline_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  issued_at: string | null;
  settled_at: string | null;
}

function listingToRow(r: typeof attestationListings.$inferSelect): ListingRow {
  return {
    id: r.id,
    attester_identity_id: r.attesterIdentityId,
    attester_did: r.attesterDid,
    project_id: r.projectId,
    name: r.name,
    description: r.description,
    claim: r.claim,
    capability_tags: r.capabilityTags ?? [],
    evidence_schema: (r.evidenceSchema as Record<string, unknown> | null) ?? null,
    pricing_model: r.pricingModel,
    price_amount: r.priceAmount,
    price_currency: r.priceCurrency,
    attester_wallet_id: r.attesterWalletId,
    validity_seconds: r.validitySeconds,
    sla_seconds: r.slaSeconds,
    visibility: r.visibility as "private" | "public",
    status: r.status as "active" | "paused" | "archived",
    grants_count: r.grantsCount,
    revenue_total: r.revenueTotal,
    revenue_count: r.revenueCount,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

function grantToRow(r: typeof attestationGrants.$inferSelect): GrantRow {
  return {
    id: r.id,
    listing_id: r.listingId,
    buyer_identity_id: r.buyerIdentityId,
    buyer_did: r.buyerDid,
    buyer_project_id: r.buyerProjectId,
    buyer_wallet_id: r.buyerWalletId,
    subject_identity_id: r.subjectIdentityId,
    subject_did: r.subjectDid,
    evidence: (r.evidence as Record<string, unknown> | null) ?? null,
    amount: r.amount,
    currency: r.currency,
    escrow_id: r.escrowId,
    platform_fee: r.platformFee,
    attestation_id: r.attestationId,
    status: r.status as GrantRow["status"],
    refund_reason: r.refundReason,
    sla_deadline_at: r.slaDeadlineAt?.toISOString() ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
    issued_at: r.issuedAt?.toISOString() ?? null,
    settled_at: r.settledAt?.toISOString() ?? null,
  };
}

// ── Listing CRUD ────────────────────────────────────────────────────

export interface CreateListingInput {
  attesterIdentityId: string;
  projectId: string;
  name: string;
  description?: string | null;
  claim: string;
  capabilityTags?: string[];
  evidenceSchema?: Record<string, unknown> | null;
  priceAmount: number;
  priceCurrency: string;
  attesterWalletId: string;
  validitySeconds?: number | null;
  slaSeconds?: number | null;
  visibility?: "private" | "public";
  metadata?: Record<string, unknown>;
}

export async function createListing(input: CreateListingInput): Promise<ListingRow> {
  // Validate the attester belongs to the calling project + is active.
  const [attester] = await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.id, input.attesterIdentityId),
        eq(identities.projectId, input.projectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  if (!attester) throw new Error("attester_not_found_or_not_owned");

  // Validate the wallet belongs to the project + currency matches.
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.id, input.attesterWalletId), eq(wallets.projectId, input.projectId)))
    .limit(1);
  if (!wallet) throw new Error("attester_wallet_not_found");
  if (wallet.status !== "active") throw new Error("attester_wallet_not_active");
  if (wallet.currency !== input.priceCurrency) {
    throw new Error(`currency_mismatch: wallet=${wallet.currency} listing=${input.priceCurrency}`);
  }
  if (input.priceAmount <= 0) throw new Error("price_amount_must_be_positive");

  const [row] = await db
    .insert(attestationListings)
    .values({
      attesterIdentityId: input.attesterIdentityId,
      attesterDid: attester.did,
      projectId: input.projectId,
      name: input.name,
      description: input.description ?? null,
      claim: input.claim,
      capabilityTags: input.capabilityTags ?? [],
      evidenceSchema: input.evidenceSchema ?? null,
      priceAmount: input.priceAmount,
      priceCurrency: input.priceCurrency,
      attesterWalletId: input.attesterWalletId,
      validitySeconds: input.validitySeconds ?? null,
      slaSeconds: input.slaSeconds ?? null,
      visibility: input.visibility ?? "public",
      metadata: input.metadata ?? {},
    })
    .returning();
  return listingToRow(row!);
}

export async function getListing(
  id: string,
  opts?: { projectIdScope?: string },
): Promise<ListingRow | null> {
  const filters = [eq(attestationListings.id, id)];
  if (opts?.projectIdScope) {
    filters.push(eq(attestationListings.projectId, opts.projectIdScope));
  }
  const [row] = await db
    .select()
    .from(attestationListings)
    .where(and(...filters))
    .limit(1);
  return row ? listingToRow(row) : null;
}

export async function listListings(filter: {
  attesterIdentityId?: string;
  claim?: string;
  status?: "active" | "paused" | "archived";
  visibility?: "private" | "public";
  publicOnly?: boolean;
  projectIdScope?: string;
  limit?: number;
}): Promise<ListingRow[]> {
  const conds = [] as ReturnType<typeof eq>[];
  if (filter.attesterIdentityId) {
    conds.push(eq(attestationListings.attesterIdentityId, filter.attesterIdentityId));
  }
  if (filter.claim) conds.push(eq(attestationListings.claim, filter.claim));
  if (filter.status) conds.push(eq(attestationListings.status, filter.status));
  if (filter.visibility) conds.push(eq(attestationListings.visibility, filter.visibility));
  if (filter.publicOnly) {
    conds.push(eq(attestationListings.visibility, "public"));
    conds.push(eq(attestationListings.status, "active"));
  }
  if (filter.projectIdScope) {
    conds.push(eq(attestationListings.projectId, filter.projectIdScope));
  }
  const rows = await db
    .select()
    .from(attestationListings)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(attestationListings.createdAt))
    .limit(Math.min(filter.limit ?? 50, 200));
  return rows.map(listingToRow);
}

export interface PatchListingInput {
  name?: string;
  description?: string | null;
  capabilityTags?: string[];
  evidenceSchema?: Record<string, unknown> | null;
  priceAmount?: number;
  priceCurrency?: string;
  attesterWalletId?: string;
  validitySeconds?: number | null;
  slaSeconds?: number | null;
  visibility?: "private" | "public";
  status?: "active" | "paused" | "archived";
  metadata?: Record<string, unknown>;
}

export async function patchListing(
  id: string,
  projectId: string,
  patch: PatchListingInput,
): Promise<ListingRow | null> {
  const updates: Partial<typeof attestationListings.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.capabilityTags !== undefined) updates.capabilityTags = patch.capabilityTags;
  if (patch.evidenceSchema !== undefined) updates.evidenceSchema = patch.evidenceSchema;
  if (patch.priceAmount !== undefined) {
    if (patch.priceAmount <= 0) throw new Error("price_amount_must_be_positive");
    updates.priceAmount = patch.priceAmount;
  }
  if (patch.priceCurrency !== undefined) updates.priceCurrency = patch.priceCurrency;
  if (patch.attesterWalletId !== undefined) updates.attesterWalletId = patch.attesterWalletId;
  if (patch.validitySeconds !== undefined) updates.validitySeconds = patch.validitySeconds;
  if (patch.slaSeconds !== undefined) updates.slaSeconds = patch.slaSeconds;
  if (patch.visibility !== undefined) updates.visibility = patch.visibility;
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.metadata !== undefined) updates.metadata = patch.metadata;

  // If currency or wallet changed, re-validate they're consistent.
  if (patch.priceCurrency !== undefined || patch.attesterWalletId !== undefined) {
    const current = await getListing(id, { projectIdScope: projectId });
    if (!current) return null;
    const newWalletId = patch.attesterWalletId ?? current.attester_wallet_id;
    const newCurrency = patch.priceCurrency ?? current.price_currency;
    const [w] = await db
      .select()
      .from(wallets)
      .where(and(eq(wallets.id, newWalletId), eq(wallets.projectId, projectId)))
      .limit(1);
    if (!w) throw new Error("attester_wallet_not_found");
    if (w.status !== "active") throw new Error("attester_wallet_not_active");
    if (w.currency !== newCurrency) {
      throw new Error(`currency_mismatch: wallet=${w.currency} listing=${newCurrency}`);
    }
  }

  const [row] = await db
    .update(attestationListings)
    .set(updates)
    .where(
      and(
        eq(attestationListings.id, id),
        eq(attestationListings.projectId, projectId),
      ),
    )
    .returning();
  return row ? listingToRow(row) : null;
}

// ── Grant lifecycle ──────────────────────────────────────────────────

export interface PurchaseGrantInput {
  listingId: string;
  buyerIdentityId: string;
  buyerProjectId: string;
  buyerWalletId: string;
  subjectIdentityId: string;
  evidence?: Record<string, unknown> | null;
}

/** Buyer purchases a grant against a listing. Atomic:
 *    1. Validate listing (active, public, not own) + buyer (wallet active +
 *       sufficient balance) + subject (active identity).
 *    2. Insert grant row · status='pending'
 *    3. SELECT FOR UPDATE buyer wallet · re-check balance · debit
 *    4. Insert escrow row · status='funded' · workerWallet=attester
 *    5. Bump listing.grants_count.
 *    6. Return grant. */
export async function purchaseGrant(input: PurchaseGrantInput): Promise<GrantRow> {
  const [listing] = await db
    .select()
    .from(attestationListings)
    .where(eq(attestationListings.id, input.listingId))
    .limit(1);
  if (!listing) throw new Error("listing_not_found");
  if (listing.status !== "active") throw new Error("listing_not_active");
  if (listing.visibility !== "public") throw new Error("listing_not_public");
  if (listing.attesterIdentityId === input.buyerIdentityId) {
    throw new Error("self_purchase_not_allowed");
  }

  const [buyer] = await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.id, input.buyerIdentityId),
        eq(identities.projectId, input.buyerProjectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  if (!buyer) throw new Error("buyer_not_found_or_not_owned");

  const [subject] = await db
    .select()
    .from(identities)
    .where(and(eq(identities.id, input.subjectIdentityId), eq(identities.status, "active")))
    .limit(1);
  if (!subject) throw new Error("subject_not_found_or_not_active");

  const [buyerWallet] = await db
    .select()
    .from(wallets)
    .where(
      and(
        eq(wallets.id, input.buyerWalletId),
        eq(wallets.projectId, input.buyerProjectId),
      ),
    )
    .limit(1);
  if (!buyerWallet) throw new Error("buyer_wallet_not_found");
  if (buyerWallet.status !== "active") throw new Error("buyer_wallet_not_active");
  if (buyerWallet.currency !== listing.priceCurrency) {
    throw new Error(
      `currency_mismatch: buyer=${buyerWallet.currency} listing=${listing.priceCurrency}`,
    );
  }
  if (buyerWallet.balance < listing.priceAmount) {
    throw new Error("insufficient_balance");
  }

  const [attesterWallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.id, listing.attesterWalletId))
    .limit(1);
  if (!attesterWallet) throw new Error("attester_wallet_missing");
  if (attesterWallet.status !== "active") throw new Error("attester_wallet_not_active");

  const slaDeadlineAt = listing.slaSeconds
    ? new Date(Date.now() + listing.slaSeconds * 1000)
    : null;

  const result = await db.transaction(async (tx) => {
    const [grant] = await tx
      .insert(attestationGrants)
      .values({
        listingId: listing.id,
        buyerIdentityId: input.buyerIdentityId,
        buyerDid: buyer.did,
        buyerProjectId: input.buyerProjectId,
        buyerWalletId: input.buyerWalletId,
        subjectIdentityId: input.subjectIdentityId,
        subjectDid: subject.did,
        evidence: input.evidence ?? null,
        amount: listing.priceAmount,
        currency: listing.priceCurrency,
        slaDeadlineAt,
        status: "pending",
      })
      .returning();

    const [bw] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, input.buyerWalletId))
      .for("update");
    if (!bw || bw.balance < listing.priceAmount) {
      await tx
        .update(attestationGrants)
        .set({ status: "failed", refundReason: null })
        .where(eq(attestationGrants.id, grant!.id));
      throw new Error("insufficient_balance");
    }

    await tx
      .update(wallets)
      .set({ balance: bw.balance - listing.priceAmount })
      .where(eq(wallets.id, bw.id));

    const [escrow] = await tx
      .insert(escrows)
      .values({
        creatorWallet: bw.id,
        workerWallet: listing.attesterWalletId,
        amount: listing.priceAmount,
        description: `Attestation grant: ${listing.name} (${listing.id})`,
        status: "funded",
      })
      .returning();

    await tx.insert(transactions).values({
      walletId: bw.id,
      type: "escrow_lock",
      amount: -listing.priceAmount,
      counterparty: escrow!.id,
      description: `Attestation grant locked: ${listing.name}`,
      escrowId: escrow!.id,
      metadata: { listing_id: listing.id, grant_id: grant!.id },
    });

    const [updated] = await tx
      .update(attestationGrants)
      .set({ escrowId: escrow!.id })
      .where(eq(attestationGrants.id, grant!.id))
      .returning();

    await tx
      .update(attestationListings)
      .set({
        grantsCount: sql`${attestationListings.grantsCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(attestationListings.id, listing.id));

    return updated;
  });

  return grantToRow(result!);
}

export async function getGrant(
  id: string,
  opts?: { roleScope?: { projectId: string; role: "buyer" | "attester" } },
): Promise<GrantRow | null> {
  const [row] = await db
    .select()
    .from(attestationGrants)
    .where(eq(attestationGrants.id, id))
    .limit(1);
  if (!row) return null;
  if (opts?.roleScope) {
    if (opts.roleScope.role === "buyer") {
      if (row.buyerProjectId !== opts.roleScope.projectId) return null;
    } else {
      // attester scope — verify via listing.project_id
      const [listing] = await db
        .select({ projectId: attestationListings.projectId })
        .from(attestationListings)
        .where(eq(attestationListings.id, row.listingId))
        .limit(1);
      if (!listing || listing.projectId !== opts.roleScope.projectId) return null;
    }
  }
  return grantToRow(row);
}

export async function listGrants(filter: {
  role: "buyer" | "attester" | "subject";
  projectId: string;
  status?: GrantRow["status"];
  limit?: number;
}): Promise<GrantRow[]> {
  const conds = [] as ReturnType<typeof eq>[];
  if (filter.role === "buyer") {
    conds.push(eq(attestationGrants.buyerProjectId, filter.projectId));
  } else if (filter.role === "subject") {
    // subject identities owned by this project — JOIN through identity.identities
    // For simplicity in v1, scope via subject's project. Subjects in OTHER
    // projects not surfaced here.
    const subjectIds = await db
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.projectId, filter.projectId));
    if (subjectIds.length === 0) return [];
    const ids = subjectIds.map((r) => r.id);
    conds.push(sql`${attestationGrants.subjectIdentityId} = ANY(${ids})`);
  } else {
    // attester — JOIN via listing.project_id
    const listingIds = await db
      .select({ id: attestationListings.id })
      .from(attestationListings)
      .where(eq(attestationListings.projectId, filter.projectId));
    if (listingIds.length === 0) return [];
    const ids = listingIds.map((r) => r.id);
    conds.push(sql`${attestationGrants.listingId} = ANY(${ids})`);
  }
  if (filter.status) conds.push(eq(attestationGrants.status, filter.status));

  const rows = await db
    .select()
    .from(attestationGrants)
    .where(and(...conds))
    .orderBy(desc(attestationGrants.createdAt))
    .limit(Math.min(filter.limit ?? 50, 200));
  return rows.map(grantToRow);
}

// ── Issue ─────────────────────────────────────────────────────────────

export interface IssueGrantInput {
  grantId: string;
  attesterProjectId: string; // auth scope
  signature: string;          // base64 ed25519 over canonicalPayload
  signingKeyId: string;       // identity_keys.id used to sign
}

/** Attester signs canonical bytes of (subject_id, attester_id, claim,
 *  evidence) and submits. Atomic:
 *    1. Lock grant row · verify state == 'pending' · verify SLA not expired.
 *    2. Verify signature against attester's active signing key.
 *    3. Insert identity.attestations row.
 *    4. Compute take-rate split.
 *    5. Credit attester wallet by (amount − fee).
 *    6. Mark escrow released.
 *    7. Insert platform_revenue ledger row (if fee > 0).
 *    8. Update grant · status='issued', attestation_id, platform_fee, settled_at.
 *    9. Bump listing.revenue_total/revenue_count.
 *   10. Update subject's trust score (best-effort, post-txn). */
export async function issueGrant(input: IssueGrantInput): Promise<GrantRow> {
  // Outside the txn: load the grant + listing + attester + key. We need
  // these to verify the signature before opening the write txn.
  const [grant] = await db
    .select()
    .from(attestationGrants)
    .where(eq(attestationGrants.id, input.grantId))
    .limit(1);
  if (!grant) throw new Error("grant_not_found");
  if (grant.status !== "pending") {
    throw new Error(`grant_state_invalid: status=${grant.status}`);
  }
  if (grant.slaDeadlineAt && grant.slaDeadlineAt < new Date()) {
    // SLA already expired — auto-refund instead of allowing late issue.
    await refundGrant(grant.id, "sla_timeout");
    throw new Error("grant_sla_expired");
  }
  const [listing] = await db
    .select()
    .from(attestationListings)
    .where(eq(attestationListings.id, grant.listingId))
    .limit(1);
  if (!listing) throw new Error("listing_missing");
  if (listing.projectId !== input.attesterProjectId) {
    throw new Error("not_listing_owner");
  }

  // Verify the signing key belongs to the attester + is active.
  const [key] = await db
    .select({
      id: identityKeys.id,
      identityId: identityKeys.identityId,
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signingKeyId))
    .limit(1);
  if (!key) throw new Error("signing_key_not_found");
  if (!key.active) throw new Error("signing_key_revoked");
  if (key.identityId !== listing.attesterIdentityId) {
    throw new Error("signing_key_does_not_belong_to_attester");
  }

  // Verify the signature against canonical payload.
  const payload = canonicalPayload({
    subject_id: grant.subjectIdentityId,
    attester_id: listing.attesterIdentityId,
    claim: listing.claim,
    evidence: grant.evidence ?? null,
  });
  if (!verifySignature(payload, input.signature, key.publicKey)) {
    throw new Error("signature_invalid");
  }

  if (!grant.escrowId) throw new Error("grant_missing_escrow");

  // Compute take-rate split outside the txn (pure).
  const split = computeFee({ amount: grant.amount, currency: grant.currency });

  const expiresAt = listing.validitySeconds
    ? new Date(Date.now() + listing.validitySeconds * 1000)
    : null;

  const result = await db.transaction(async (tx) => {
    // Re-read grant inside txn under a row lock to prevent double-issue.
    const [g] = await tx
      .select()
      .from(attestationGrants)
      .where(eq(attestationGrants.id, grant.id))
      .for("update");
    if (!g || g.status !== "pending") {
      throw new Error("grant_state_invalid_in_txn");
    }

    // Insert the identity.attestations row.
    const [att] = await tx
      .insert(identityAttestations)
      .values({
        subjectId: g.subjectIdentityId,
        attesterId: listing.attesterIdentityId,
        claim: listing.claim,
        evidence: g.evidence,
        signature: input.signature,
        expiresAt,
      })
      .returning();

    // Credit attester (net of fee).
    await tx
      .update(wallets)
      .set({ balance: sql`balance + ${split.net}` })
      .where(eq(wallets.id, listing.attesterWalletId));

    await tx.insert(transactions).values({
      walletId: listing.attesterWalletId,
      type: "escrow_release",
      amount: split.net,
      counterparty: g.buyerWalletId,
      description: `Attestation grant released: ${listing.name}`,
      escrowId: g.escrowId,
      metadata: {
        listing_id: listing.id,
        grant_id: g.id,
        attestation_id: att!.id,
        platform_fee: split.fee,
        gross_amount: split.gross,
      },
    });

    await tx
      .update(escrows)
      .set({ status: "released", releasedAt: new Date() })
      .where(eq(escrows.id, g.escrowId!));

    // Record platform revenue (skipped when fee == 0).
    await recordRevenue(tx, {
      transactionType: "attestation_grant",
      transactionId: g.id,
      fee: split.fee,
      currency: split.currency,
      rateBps: split.rateBps,
      buyerWalletId: g.buyerWalletId,
      sellerWalletId: listing.attesterWalletId,
      metadata: { listing_id: listing.id, attestation_id: att!.id },
    });

    const now = new Date();
    const [updated] = await tx
      .update(attestationGrants)
      .set({
        status: "issued",
        attestationId: att!.id,
        platformFee: split.fee,
        issuedAt: now,
        settledAt: now,
      })
      .where(eq(attestationGrants.id, g.id))
      .returning();

    await tx
      .update(attestationListings)
      .set({
        revenueTotal: sql`${attestationListings.revenueTotal} + ${split.net}`,
        revenueCount: sql`${attestationListings.revenueCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(attestationListings.id, listing.id));

    return updated;
  });

  // Best-effort trust-score recompute. Failure here doesn't undo the
  // issuance — the attestation row is the load-bearing record.
  try {
    await updateTrustScore(grant.subjectIdentityId);
  } catch (e) {
    console.warn("[attestation marketplace] updateTrustScore failed:", e);
  }

  return grantToRow(result!);
}

// ── Decline ───────────────────────────────────────────────────────────

export async function declineGrant(input: {
  grantId: string;
  attesterProjectId: string;
}): Promise<GrantRow> {
  const [grant] = await db
    .select()
    .from(attestationGrants)
    .where(eq(attestationGrants.id, input.grantId))
    .limit(1);
  if (!grant) throw new Error("grant_not_found");
  if (grant.status !== "pending") {
    throw new Error(`grant_state_invalid: status=${grant.status}`);
  }
  const [listing] = await db
    .select()
    .from(attestationListings)
    .where(eq(attestationListings.id, grant.listingId))
    .limit(1);
  if (!listing) throw new Error("listing_missing");
  if (listing.projectId !== input.attesterProjectId) {
    throw new Error("not_listing_owner");
  }
  return refundGrant(input.grantId, "declined");
}

// ── Buyer cancel ──────────────────────────────────────────────────────

export async function cancelGrant(input: {
  grantId: string;
  buyerProjectId: string;
}): Promise<GrantRow> {
  const [grant] = await db
    .select()
    .from(attestationGrants)
    .where(eq(attestationGrants.id, input.grantId))
    .limit(1);
  if (!grant) throw new Error("grant_not_found");
  if (grant.buyerProjectId !== input.buyerProjectId) {
    throw new Error("not_grant_owner");
  }
  if (grant.status !== "pending") {
    throw new Error(`grant_state_invalid: status=${grant.status}`);
  }
  return refundGrant(input.grantId, "cancelled");
}

// ── Internal: refund path ─────────────────────────────────────────────
//
// Atomic refund of a pending grant's escrow back to the buyer wallet.
// Used by /decline, /cancel, and SLA-timeout sweep. No platform fee applies
// (refunds don't earn revenue).
async function refundGrant(
  grantId: string,
  reason: "declined" | "sla_timeout" | "cancelled",
): Promise<GrantRow> {
  return await db.transaction(async (tx) => {
    const [g] = await tx
      .select()
      .from(attestationGrants)
      .where(eq(attestationGrants.id, grantId))
      .for("update");
    if (!g) throw new Error("grant_not_found");
    if (g.status !== "pending") {
      throw new Error(`grant_state_invalid_in_txn: status=${g.status}`);
    }
    if (!g.escrowId) throw new Error("grant_missing_escrow");

    await tx
      .update(wallets)
      .set({ balance: sql`balance + ${g.amount}` })
      .where(eq(wallets.id, g.buyerWalletId));

    await tx.insert(transactions).values({
      walletId: g.buyerWalletId,
      type: "escrow_refund",
      amount: g.amount,
      counterparty: g.escrowId,
      description: `Attestation grant ${reason}`,
      escrowId: g.escrowId,
      metadata: { grant_id: g.id, reason },
    });

    await tx
      .update(escrows)
      .set({ status: "refunded", releasedAt: new Date() })
      .where(eq(escrows.id, g.escrowId!));

    const now = new Date();
    const [updated] = await tx
      .update(attestationGrants)
      .set({ status: "refunded", refundReason: reason, settledAt: now })
      .where(eq(attestationGrants.id, g.id))
      .returning();
    return grantToRow(updated!);
  });
}

// ── SLA sweep ─────────────────────────────────────────────────────────

/** Refund any pending grants whose SLA deadline has passed. Returns
 *  the count refunded. Lazy-callable; safe to run on a cron timer or
 *  on-read. */
export async function expireOverduePendingGrants(): Promise<number> {
  const overdue = await db
    .select({ id: attestationGrants.id })
    .from(attestationGrants)
    .where(
      and(
        eq(attestationGrants.status, "pending"),
        sql`${attestationGrants.slaDeadlineAt} IS NOT NULL`,
        sql`${attestationGrants.slaDeadlineAt} < now()`,
      ),
    );
  let refunded = 0;
  for (const o of overdue) {
    try {
      await refundGrant(o.id, "sla_timeout");
      refunded += 1;
    } catch {
      /* skip — race or already terminal */
    }
  }
  return refunded;
}
