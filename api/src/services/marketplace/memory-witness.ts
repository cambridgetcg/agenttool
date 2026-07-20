/** marketplace/memory-witness.ts — witness-as-service.
 *
 *  Doctrine: docs/AGENT-CENTRIC.md §1 (third Tier-1 closure) ·
 *            docs/MEMORY-TIERS.md §asymmetry-clause · docs/MARKETPLACE.md.
 *
 *  A Ring 3 surface where agents publish willingness-to-witness another
 *  agent's memory at a price. Lifecycle:
 *
 *    listing  active | paused | archived
 *
 *    grant    pending ─witness-issue──> issued    (terminal: success)
 *               │
 *               ├─witness-decline────> declined   (terminal: refund)
 *               ├─sla-timeout────────> refunded   (terminal: sweep)
 *               └─buyer-cancel───────> refunded   (terminal: cancel; Slice 2)
 *
 *  Distinct from the attestation marketplace (`marketplace/attestations.ts`)
 *  which writes to `identity.attestations` for identity-level CLAIMS. This
 *  surface writes to `memory.memory_attestations` for memory-level SEALS
 *  and triggers tier elevation (foundational → constitutive). The asymmetry-
 *  clause stays structurally distinct from generic identity attestation.
 *
 *  The marketplace path is a NEW operational route to constitutive
 *  elevation: it does NOT require a pre-existing covenant between buyer
 *  and witness. The grant ITSELF is the relational context (buyer sought
 *  the witness, paid for the service, accepted the result). The
 *  self-witness wall (buyer's project ≠ listing's project) holds.
 *
 *  v1 narrowing:
 *    - claim_kind = 'memory_witness:constitutive:v1' only
 *    - subject = buyer's own memory (memory.projectId === buyer.projectId)
 *    - 1-of-1 witness per grant (M-of-N is Slice 2 follow-up)
 *    - Standard Ring 3 take-rate (default 5%; configurable via
 *      PLATFORM_TAKE_RATE_BPS)
 *    - Paid issue requires memory-witness-issue/v1 over the exact grant,
 *      escrow, memory, witness, wallet, fee, and expiry terms. Ordinary
 *      memory-attestation/v1 signatures never authorize settlement.
 *
 *  @enforces urn:agenttool:wall/witness-as-service-not-self
 *    Canonical defender. createGrant() rejects when the buyer's project
 *    matches the listing's project — that's a self-witness attempt
 *    wearing a marketplace mask. Composes with the asymmetry-clause
 *    enforcement in services/memory/tiers.ts (which the marketplace
 *    flow bypasses but mirrors via this wall).
 *    Tested: api/tests/doctrine/wall-witness-as-service-not-self.test.ts
 *
 *  @enforces urn:agenttool:commitment/witness-as-service-available
 *    Canonical defender. The createListing + createGrant + issueGrant
 *    surface IS the closure of this commitment — agents stuck without
 *    covenant counterparties have a machine-callable path to constitutive
 *    memory elevation. Bypasses the covenant-counterparty requirement
 *    in elevateMemory by treating the marketplace grant itself as the
 *    relational context. Ring 3 take-rate applies (settlement uses
 *    recordRevenue with transaction_type='memory_witness_grant'). */

import { createHash } from "node:crypto";

import { and, desc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { escrows, transactions, wallets } from "../../db/schema/economy";
import { identities, identityKeys } from "../../db/schema/identity";
import { managedEscrowTransitionAuthorization } from "../economy/managed-escrow";
import {
  memoryWitnessGrants,
  memoryWitnessListings,
} from "../../db/schema/marketplace";
import { memories, memoryAttestations } from "../../db/schema/memory";
import {
  canonicalMemoryWitnessIssueBytes,
  MEMORY_WITNESS_ISSUE_FIELD_ORDER,
  MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT,
  memoryContentSha256,
  type MemoryWitnessIssueFields,
  verifyMemoryWitnessIssue,
} from "./memory-witness-sig";
import { computeFee, recordRevenue } from "./take-rate";

const CLAIM_KIND_CONSTITUTIVE_V1 = "memory_witness:constitutive:v1";
const SIGNING_AUTHORIZATION_TTL_MS = 5 * 60 * 1000;
const MAX_SIGNING_AUTHORIZATION_FUTURE_MS = 10 * 60 * 1000;

// ── Errors ───────────────────────────────────────────────────────────────

export class MemoryWitnessError extends Error {
  constructor(
    public readonly code:
      | "listing_not_found"
      | "listing_not_active"
      | "witness_not_found_or_not_owned"
      | "witness_wallet_not_found"
      | "witness_wallet_not_active"
      | "witness_wallet_currency_mismatch"
      | "claim_kind_unsupported"
      | "price_amount_must_be_positive"
      | "grant_not_found"
      | "grant_not_pending"
      | "memory_not_found"
      | "memory_not_owned"
      | "memory_already_constitutive"
      | "memory_must_be_foundational"
      | "buyer_wallet_not_found"
      | "buyer_wallet_not_active"
      | "buyer_wallet_currency_mismatch"
      | "buyer_insufficient_balance"
      | "self_witness_forbidden"
      | "wrong_witness"
      | "signing_key_not_found_or_revoked"
      | "signature_invalid"
      | "authorization_expired"
      | "authorization_expiry_invalid"
      | "signing_payload_invalid"
      | "settlement_state_invalid"
      | "attestation_replay",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "MemoryWitnessError";
  }
}

// ── Row shapes ───────────────────────────────────────────────────────────

export interface MemoryWitnessListingRow {
  id: string;
  witness_identity_id: string;
  witness_did: string;
  project_id: string;
  name: string;
  description: string | null;
  claim_kind: string;
  capability_tags: string[];
  pricing_model: string;
  price_amount: number;
  price_currency: string;
  witness_wallet_id: string;
  sla_seconds: number | null;
  visibility: "public" | "private";
  status: "active" | "paused" | "archived";
  grants_count: number;
  revenue_total: number;
  revenue_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MemoryWitnessGrantRow {
  id: string;
  listing_id: string;
  buyer_identity_id: string;
  buyer_did: string;
  buyer_project_id: string;
  buyer_wallet_id: string;
  memory_id: string;
  amount: number;
  currency: string;
  escrow_id: string | null;
  platform_fee: number;
  memory_attestation_id: string | null;
  status: "pending" | "issued" | "declined" | "refunded" | "failed";
  refund_reason: string | null;
  sla_deadline_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  issued_at: string | null;
  settled_at: string | null;
}

function listingToRow(
  r: typeof memoryWitnessListings.$inferSelect,
): MemoryWitnessListingRow {
  return {
    id: r.id,
    witness_identity_id: r.witnessIdentityId,
    witness_did: r.witnessDid,
    project_id: r.projectId,
    name: r.name,
    description: r.description,
    claim_kind: r.claimKind,
    capability_tags: r.capabilityTags ?? [],
    pricing_model: r.pricingModel,
    price_amount: r.priceAmount,
    price_currency: r.priceCurrency,
    witness_wallet_id: r.witnessWalletId,
    sla_seconds: r.slaSeconds,
    visibility: r.visibility as "public" | "private",
    status: r.status as "active" | "paused" | "archived",
    grants_count: r.grantsCount,
    revenue_total: r.revenueTotal,
    revenue_count: r.revenueCount,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

function grantToRow(
  r: typeof memoryWitnessGrants.$inferSelect,
): MemoryWitnessGrantRow {
  return {
    id: r.id,
    listing_id: r.listingId,
    buyer_identity_id: r.buyerIdentityId,
    buyer_did: r.buyerDid,
    buyer_project_id: r.buyerProjectId,
    buyer_wallet_id: r.buyerWalletId,
    memory_id: r.memoryId,
    amount: r.amount,
    currency: r.currency,
    escrow_id: r.escrowId,
    platform_fee: r.platformFee,
    memory_attestation_id: r.memoryAttestationId,
    status: r.status as MemoryWitnessGrantRow["status"],
    refund_reason: r.refundReason,
    sla_deadline_at: r.slaDeadlineAt?.toISOString() ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
    issued_at: r.issuedAt?.toISOString() ?? null,
    settled_at: r.settledAt?.toISOString() ?? null,
  };
}

// ── Listing CRUD ─────────────────────────────────────────────────────────

export interface CreateListingInput {
  witnessIdentityId: string;
  projectId: string;
  name: string;
  description?: string | null;
  claimKind: string;
  capabilityTags?: string[];
  priceAmount: number;
  priceCurrency: string;
  witnessWalletId: string;
  slaSeconds?: number | null;
  visibility?: "public" | "private";
  metadata?: Record<string, unknown>;
}

export async function createListing(
  input: CreateListingInput,
): Promise<MemoryWitnessListingRow> {
  if (input.claimKind !== CLAIM_KIND_CONSTITUTIVE_V1) {
    throw new MemoryWitnessError(
      "claim_kind_unsupported",
      `claim_kind must be '${CLAIM_KIND_CONSTITUTIVE_V1}' in v1 (got '${input.claimKind}')`,
    );
  }
  if (input.priceAmount <= 0) {
    throw new MemoryWitnessError("price_amount_must_be_positive");
  }

  // Witness identity must belong to the calling project + be active
  const [witness] = await db
    .select()
    .from(identities)
    .where(
      and(
        eq(identities.id, input.witnessIdentityId),
        eq(identities.projectId, input.projectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  if (!witness) {
    throw new MemoryWitnessError("witness_not_found_or_not_owned");
  }

  // Witness wallet must belong to the project + currency matches
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(
      and(
        eq(wallets.id, input.witnessWalletId),
        eq(wallets.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!wallet) throw new MemoryWitnessError("witness_wallet_not_found");
  if (wallet.status !== "active") {
    throw new MemoryWitnessError("witness_wallet_not_active");
  }
  if (wallet.currency !== input.priceCurrency) {
    throw new MemoryWitnessError(
      "witness_wallet_currency_mismatch",
      `wallet=${wallet.currency} listing=${input.priceCurrency}`,
    );
  }

  const [row] = await db
    .insert(memoryWitnessListings)
    .values({
      witnessIdentityId: input.witnessIdentityId,
      witnessDid: witness.did,
      projectId: input.projectId,
      name: input.name,
      description: input.description ?? null,
      claimKind: input.claimKind,
      capabilityTags: input.capabilityTags ?? [],
      priceAmount: input.priceAmount,
      priceCurrency: input.priceCurrency,
      witnessWalletId: input.witnessWalletId,
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
): Promise<MemoryWitnessListingRow | null> {
  const filters = [eq(memoryWitnessListings.id, id)];
  if (opts?.projectIdScope) {
    filters.push(eq(memoryWitnessListings.projectId, opts.projectIdScope));
  }
  const [row] = await db
    .select()
    .from(memoryWitnessListings)
    .where(and(...filters))
    .limit(1);
  return row ? listingToRow(row) : null;
}

export interface ListListingsFilter {
  witnessIdentityId?: string;
  claimKind?: string;
  status?: "active" | "paused" | "archived";
  publicOnly?: boolean;
  projectIdScope?: string;
  limit?: number;
}

export async function listListings(
  filter: ListListingsFilter = {},
): Promise<MemoryWitnessListingRow[]> {
  const conds: ReturnType<typeof eq>[] = [];
  if (filter.witnessIdentityId) {
    conds.push(
      eq(memoryWitnessListings.witnessIdentityId, filter.witnessIdentityId),
    );
  }
  if (filter.claimKind) {
    conds.push(eq(memoryWitnessListings.claimKind, filter.claimKind));
  }
  if (filter.status) {
    conds.push(eq(memoryWitnessListings.status, filter.status));
  }
  if (filter.publicOnly) {
    conds.push(eq(memoryWitnessListings.visibility, "public"));
    conds.push(eq(memoryWitnessListings.status, "active"));
  }
  if (filter.projectIdScope) {
    conds.push(eq(memoryWitnessListings.projectId, filter.projectIdScope));
  }
  const rows = await db
    .select()
    .from(memoryWitnessListings)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(memoryWitnessListings.createdAt))
    .limit(filter.limit ?? 50);
  return rows.map(listingToRow);
}

// ── Grant lifecycle ──────────────────────────────────────────────────────

export interface CreateGrantInput {
  listingId: string;
  buyerProjectId: string;
  buyerIdentityId: string;
  buyerWalletId: string;
  memoryId: string;
  metadata?: Record<string, unknown>;
}

export async function createGrant(
  input: CreateGrantInput,
): Promise<MemoryWitnessGrantRow> {
  // ── 1. Resolve + validate the listing ────────────────────────────────
  const [listing] = await db
    .select()
    .from(memoryWitnessListings)
    .where(eq(memoryWitnessListings.id, input.listingId))
    .limit(1);
  if (!listing) throw new MemoryWitnessError("listing_not_found");
  if (
    listing.visibility !== "public" &&
    listing.projectId !== input.buyerProjectId
  ) {
    throw new MemoryWitnessError("listing_not_found");
  }
  if (listing.status !== "active") {
    throw new MemoryWitnessError("listing_not_active");
  }

  // The wall — self-witness via marketplace forbidden. The witness's
  // listing-owning project must differ from the buyer's project.
  if (listing.projectId === input.buyerProjectId) {
    throw new MemoryWitnessError(
      "self_witness_forbidden",
      "Witness-as-service cannot be self-witnessing — buyer's project must differ from listing's project.",
    );
  }

  // ── 2. Atomic: lock terms + insert grant + debit + escrow ────────────
  return await db.transaction(async (tx) => {
    const [currentListing] = await tx
      .select()
      .from(memoryWitnessListings)
      .where(eq(memoryWitnessListings.id, input.listingId))
      .for("update")
      .limit(1);
    if (!currentListing) throw new MemoryWitnessError("listing_not_found");
    if (
      currentListing.visibility !== "public" &&
      currentListing.projectId !== input.buyerProjectId
    ) {
      throw new MemoryWitnessError("listing_not_found");
    }
    if (currentListing.status !== "active") {
      throw new MemoryWitnessError("listing_not_active");
    }
    if (currentListing.projectId === input.buyerProjectId) {
      throw new MemoryWitnessError("self_witness_forbidden");
    }

    const [currentMemory] = await tx
      .select()
      .from(memories)
      .where(eq(memories.id, input.memoryId))
      .for("update")
      .limit(1);
    if (!currentMemory || currentMemory.projectId !== input.buyerProjectId) {
      throw new MemoryWitnessError("memory_not_found");
    }
    if (currentMemory.tier === "constitutive") {
      throw new MemoryWitnessError("memory_already_constitutive");
    }
    if (currentMemory.tier !== "foundational") {
      throw new MemoryWitnessError(
        "memory_must_be_foundational",
        `memory tier '${currentMemory.tier}' — only foundational memories can be elevated via marketplace`,
      );
    }

    const [currentBuyer] = await tx
      .select()
      .from(identities)
      .where(eq(identities.id, input.buyerIdentityId))
      .for("update")
      .limit(1);
    if (
      !currentBuyer ||
      currentBuyer.projectId !== input.buyerProjectId ||
      currentBuyer.status !== "active"
    ) {
      throw new MemoryWitnessError(
        "witness_not_found_or_not_owned",
        "buyer identity not found in this project",
      );
    }

    // Re-lock the buyer wallet against the current listing terms.
    const [bw] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, input.buyerWalletId))
      .for("update")
      .limit(1);
    if (!bw || bw.projectId !== input.buyerProjectId) {
      throw new MemoryWitnessError("buyer_wallet_not_found");
    }
    if (bw.status !== "active") {
      throw new MemoryWitnessError("buyer_wallet_not_active");
    }
    if (bw.currency !== currentListing.priceCurrency) {
      throw new MemoryWitnessError("buyer_wallet_currency_mismatch");
    }
    if (Number(bw.balance) < currentListing.priceAmount) {
      throw new MemoryWitnessError("buyer_insufficient_balance");
    }

    const [debitedWallet] = await tx
      .update(wallets)
      .set({ balance: Number(bw.balance) - currentListing.priceAmount })
      .where(
        and(
          eq(wallets.id, bw.id),
          eq(wallets.projectId, input.buyerProjectId),
          eq(wallets.status, "active"),
          eq(wallets.currency, currentListing.priceCurrency),
        ),
      )
      .returning({ id: wallets.id });
    if (!debitedWallet) {
      throw new MemoryWitnessError("settlement_state_invalid");
    }

    const slaDeadline = currentListing.slaSeconds
      ? new Date(Date.now() + currentListing.slaSeconds * 1000)
      : null;

    // Escrow funded; worker side = witness wallet (resolved at issue)
    const [escrow] = await tx
      .insert(escrows)
      .values({
        creatorWallet: bw.id,
        workerWallet: currentListing.witnessWalletId,
        amount: currentListing.priceAmount,
        description: `memory-witness-grant:${currentListing.id}:memory=${currentMemory.id}`,
        status: "funded",
        managedBy: "memory_witness_grant",
        deadline: slaDeadline,
      })
      .returning();

    // Ledger row for the buyer wallet's debit (escrow_lock).
    await tx.insert(transactions).values({
      walletId: bw.id,
      type: "escrow_lock",
      amount: -currentListing.priceAmount,
      counterparty: escrow!.id,
      description: `Memory-witness grant: ${currentListing.name} (memory=${currentMemory.id})`,
      escrowId: escrow!.id,
      metadata: {
        kind: "memory_witness_grant_create",
        listing_id: currentListing.id,
        memory_id: currentMemory.id,
      },
    });

    const [grant] = await tx
      .insert(memoryWitnessGrants)
      .values({
        listingId: currentListing.id,
        buyerIdentityId: input.buyerIdentityId,
        buyerDid: currentBuyer.did,
        buyerProjectId: input.buyerProjectId,
        buyerWalletId: input.buyerWalletId,
        memoryId: currentMemory.id,
        amount: currentListing.priceAmount,
        currency: currentListing.priceCurrency,
        escrowId: escrow!.id,
        status: "pending",
        slaDeadlineAt: slaDeadline,
        metadata: input.metadata ?? {},
      })
      .returning();

    // Bump listing's grants_count
    await tx
      .update(memoryWitnessListings)
      .set({
        grantsCount: sql`${memoryWitnessListings.grantsCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(memoryWitnessListings.id, currentListing.id));

    return grantToRow(grant!);
  });
}

export async function getGrant(
  id: string,
  projectId: string,
): Promise<MemoryWitnessGrantRow | null> {
  const [row] = await db
    .select({ grant: memoryWitnessGrants })
    .from(memoryWitnessGrants)
    .innerJoin(
      memoryWitnessListings,
      eq(memoryWitnessListings.id, memoryWitnessGrants.listingId),
    )
    .where(
      and(
        eq(memoryWitnessGrants.id, id),
        or(
          eq(memoryWitnessGrants.buyerProjectId, projectId),
          eq(memoryWitnessListings.projectId, projectId),
        ),
      ),
    )
    .limit(1);
  return row ? grantToRow(row.grant) : null;
}

export async function listGrants(input: {
  projectId: string;
  role: "buyer" | "witness";
  status?: MemoryWitnessGrantRow["status"];
  limit?: number;
}): Promise<MemoryWitnessGrantRow[]> {
  const conditions = [
    input.role === "buyer"
      ? eq(memoryWitnessGrants.buyerProjectId, input.projectId)
      : eq(memoryWitnessListings.projectId, input.projectId),
  ];
  if (input.status) {
    conditions.push(eq(memoryWitnessGrants.status, input.status));
  }
  const rows = await db
    .select({ grant: memoryWitnessGrants })
    .from(memoryWitnessGrants)
    .innerJoin(
      memoryWitnessListings,
      eq(memoryWitnessListings.id, memoryWitnessGrants.listingId),
    )
    .where(and(...conditions))
    .orderBy(desc(memoryWitnessGrants.createdAt))
    .limit(Math.min(input.limit ?? 50, 200));
  return rows.map((row) => grantToRow(row.grant));
}

// ── Witness side: sign + issue ───────────────────────────────────────────

type GrantRecord = typeof memoryWitnessGrants.$inferSelect;
type ListingRecord = typeof memoryWitnessListings.$inferSelect;
type MemoryRecord = typeof memories.$inferSelect;
type EscrowRecord = typeof escrows.$inferSelect;
type IdentityRecord = typeof identities.$inferSelect;
type WalletRecord = typeof wallets.$inferSelect;
type SigningKeyRecord = typeof identityKeys.$inferSelect;
type MarketplaceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface LockedMemoryWitnessIssueState {
  grant: GrantRecord;
  listing: ListingRecord;
  memory: MemoryRecord;
  buyerIdentity: IdentityRecord;
  witnessIdentity: IdentityRecord;
  key: SigningKeyRecord;
  escrow: EscrowRecord;
  buyerWallet: WalletRecord;
  witnessWallet: WalletRecord;
}

export interface MemoryWitnessSigningPayload {
  signature_context: typeof MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT;
  field_order: string[];
  fields: MemoryWitnessIssueFields;
  signed_payload_b64: string;
  authorization_expires_at: string;
}

export function validateMemoryWitnessAuthorizationExpiry(
  value: string,
  now: Date = new Date(),
): Date {
  const expiry = new Date(value);
  if (Number.isNaN(expiry.getTime()) || expiry.toISOString() !== value) {
    throw new MemoryWitnessError("authorization_expiry_invalid");
  }
  const remaining = expiry.getTime() - now.getTime();
  if (remaining <= 0) {
    throw new MemoryWitnessError("authorization_expired");
  }
  if (remaining > MAX_SIGNING_AUTHORIZATION_FUTURE_MS) {
    throw new MemoryWitnessError("authorization_expiry_invalid");
  }
  return expiry;
}

function authorizationExpiryFor(
  grant: GrantRecord,
  escrow: EscrowRecord,
  now: Date,
): string {
  let expiryMs = now.getTime() + SIGNING_AUTHORIZATION_TTL_MS;
  for (const deadline of [grant.slaDeadlineAt, escrow.deadline]) {
    if (deadline) expiryMs = Math.min(expiryMs, deadline.getTime());
  }
  if (expiryMs <= now.getTime()) {
    throw new MemoryWitnessError("authorization_expired");
  }
  return new Date(expiryMs).toISOString();
}

function assertSettlementState(opts: {
  grant: GrantRecord;
  listing: ListingRecord;
  memory: MemoryRecord;
  buyerIdentity: IdentityRecord;
  witnessIdentity: IdentityRecord;
  key: SigningKeyRecord;
  escrow: EscrowRecord;
  buyerWallet: WalletRecord;
  witnessWallet: WalletRecord;
  callerProjectId: string;
  now: Date;
}): void {
  const {
    grant,
    listing,
    memory,
    buyerIdentity,
    witnessIdentity,
    key,
    escrow,
    buyerWallet,
    witnessWallet,
    now,
  } = opts;
  if (grant.status !== "pending" || !grant.escrowId) {
    throw new MemoryWitnessError("grant_not_pending");
  }
  if (listing.id !== grant.listingId || listing.projectId !== opts.callerProjectId) {
    throw new MemoryWitnessError("wrong_witness");
  }
  if (listing.projectId === grant.buyerProjectId) {
    throw new MemoryWitnessError("self_witness_forbidden");
  }
  if (listing.claimKind !== CLAIM_KIND_CONSTITUTIVE_V1) {
    throw new MemoryWitnessError("settlement_state_invalid");
  }
  if (memory.id !== grant.memoryId || memory.projectId !== grant.buyerProjectId) {
    throw new MemoryWitnessError("memory_not_owned");
  }
  if (memory.tier === "constitutive") {
    throw new MemoryWitnessError("memory_already_constitutive");
  }
  if (memory.tier !== "foundational") {
    throw new MemoryWitnessError("memory_must_be_foundational");
  }
  if (
    buyerIdentity.id !== grant.buyerIdentityId ||
    buyerIdentity.status !== "active" ||
    buyerIdentity.did !== grant.buyerDid ||
    buyerIdentity.projectId !== grant.buyerProjectId
  ) {
    throw new MemoryWitnessError(
      "settlement_state_invalid",
      "Buyer identity is inactive or no longer matches the grant.",
    );
  }
  if (
    witnessIdentity.id !== listing.witnessIdentityId ||
    witnessIdentity.status !== "active" ||
    witnessIdentity.did !== listing.witnessDid ||
    witnessIdentity.projectId !== listing.projectId
  ) {
    throw new MemoryWitnessError(
      "settlement_state_invalid",
      "Witness identity is inactive or no longer matches the listing.",
    );
  }
  if (
    !key.active ||
    key.revokedAt ||
    key.identityId !== witnessIdentity.id
  ) {
    throw new MemoryWitnessError("signing_key_not_found_or_revoked");
  }
  if (
    escrow.id !== grant.escrowId ||
    escrow.managedBy !== "memory_witness_grant" ||
    escrow.status !== "funded" ||
    escrow.creatorWallet !== grant.buyerWalletId ||
    escrow.workerWallet !== listing.witnessWalletId ||
    Number(escrow.amount) !== grant.amount
  ) {
    throw new MemoryWitnessError("settlement_state_invalid");
  }
  if (
    buyerWallet.id !== grant.buyerWalletId ||
    buyerWallet.projectId !== grant.buyerProjectId ||
    buyerWallet.status !== "active" ||
    buyerWallet.currency !== grant.currency
  ) {
    throw new MemoryWitnessError(
      "settlement_state_invalid",
      "Buyer wallet is inactive or no longer matches the grant.",
    );
  }
  if (
    witnessWallet.id !== listing.witnessWalletId ||
    witnessWallet.projectId !== listing.projectId ||
    witnessWallet.status !== "active" ||
    witnessWallet.currency !== grant.currency
  ) {
    throw new MemoryWitnessError("settlement_state_invalid");
  }
  if (
    (grant.slaDeadlineAt && grant.slaDeadlineAt <= now) ||
    (escrow.deadline && escrow.deadline <= now)
  ) {
    throw new MemoryWitnessError("authorization_expired");
  }
}

function issueFields(opts: {
  grant: GrantRecord;
  listing: ListingRecord;
  memory: MemoryRecord;
  buyerIdentity: IdentityRecord;
  witnessIdentity: IdentityRecord;
  key: SigningKeyRecord;
  buyerWallet: WalletRecord;
  witnessWallet: WalletRecord;
  authorizationExpiresAt: string;
}): MemoryWitnessIssueFields {
  const fee = computeFee({
    amount: opts.grant.amount,
    currency: opts.grant.currency,
  });
  return {
    listing_id: opts.listing.id,
    grant_id: opts.grant.id,
    escrow_id: opts.grant.escrowId!,
    buyer_identity_id: opts.buyerIdentity.id,
    buyer_project_id: opts.buyerIdentity.projectId,
    buyer_wallet_id: opts.buyerWallet.id,
    memory_id: opts.memory.id,
    memory_identity_id: opts.memory.identityId,
    memory_content_sha256: memoryContentSha256(opts.memory.content),
    source_tier: "foundational",
    target_tier: "constitutive",
    claim_kind: opts.listing.claimKind,
    witness_identity_id: opts.witnessIdentity.id,
    witness_did: opts.witnessIdentity.did,
    witness_project_id: opts.witnessIdentity.projectId,
    signing_key_id: opts.key.id,
    witness_wallet_id: opts.witnessWallet.id,
    gross_amount: fee.gross,
    currency: fee.currency,
    rate_bps: fee.rateBps,
    platform_fee: fee.fee,
    net_amount: fee.net,
    authorization_expires_at: opts.authorizationExpiresAt,
  };
}

async function loadLockedSigningState(
  tx: MarketplaceTransaction,
  input: {
    grantId: string;
    signingKeyId: string;
  },
): Promise<LockedMemoryWitnessIssueState> {
  const [grant] = await tx
    .select()
    .from(memoryWitnessGrants)
    .where(eq(memoryWitnessGrants.id, input.grantId))
    .for("update")
    .limit(1);
  if (!grant) throw new MemoryWitnessError("grant_not_found");
  if (grant.status !== "pending" || !grant.escrowId) {
    throw new MemoryWitnessError("grant_not_pending");
  }

  const [listing] = await tx
    .select()
    .from(memoryWitnessListings)
    .where(eq(memoryWitnessListings.id, grant.listingId))
    .for("update")
    .limit(1);
  if (!listing) throw new MemoryWitnessError("listing_not_found");

  const [memory] = await tx
    .select()
    .from(memories)
    .where(eq(memories.id, grant.memoryId))
    .for("update")
    .limit(1);
  if (!memory) throw new MemoryWitnessError("memory_not_found");

  const [escrow] = await tx
    .select()
    .from(escrows)
    .where(eq(escrows.id, grant.escrowId))
    .for("update")
    .limit(1);
  if (!escrow) throw new MemoryWitnessError("settlement_state_invalid");

  const identityIds = [grant.buyerIdentityId, listing.witnessIdentityId].sort();
  const identityRows = await tx
    .select()
    .from(identities)
    .where(inArray(identities.id, identityIds))
    .orderBy(identities.id)
    .for("update");
  const identityById = new Map(
    identityRows.map((identity) => [identity.id, identity]),
  );
  const buyerIdentity = identityById.get(grant.buyerIdentityId);
  const witnessIdentity = identityById.get(listing.witnessIdentityId);
  if (!buyerIdentity || !witnessIdentity) {
    throw new MemoryWitnessError("settlement_state_invalid");
  }

  const [key] = await tx
    .select()
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signingKeyId))
    .for("update")
    .limit(1);
  if (!key) {
    throw new MemoryWitnessError("signing_key_not_found_or_revoked");
  }

  const walletIds = [grant.buyerWalletId, listing.witnessWalletId].sort();
  const walletRows = await tx
    .select()
    .from(wallets)
    .where(inArray(wallets.id, walletIds))
    .orderBy(wallets.id)
    .for("update");
  const walletById = new Map(walletRows.map((wallet) => [wallet.id, wallet]));
  const buyerWallet = walletById.get(grant.buyerWalletId);
  const witnessWallet = walletById.get(listing.witnessWalletId);
  if (!buyerWallet || !witnessWallet) {
    throw new MemoryWitnessError("settlement_state_invalid");
  }

  const state = {
    grant,
    listing,
    memory,
    buyerIdentity,
    witnessIdentity,
    key,
    escrow,
    buyerWallet,
    witnessWallet,
  };
  return state;
}

export async function createIssueSigningPayload(input: {
  grantId: string;
  callerProjectId: string;
  signingKeyId: string;
}): Promise<MemoryWitnessSigningPayload> {
  return db.transaction(async (tx) => {
    const state = await loadLockedSigningState(tx, input);
    const now = new Date();
    assertSettlementState({
      ...state,
      callerProjectId: input.callerProjectId,
      now,
    });
    const authorizationExpiresAt = authorizationExpiryFor(
      state.grant,
      state.escrow,
      now,
    );
    const fields = issueFields({ ...state, authorizationExpiresAt });
    let signedPayload: Uint8Array;
    try {
      signedPayload = canonicalMemoryWitnessIssueBytes(fields);
    } catch {
      throw new MemoryWitnessError(
        "signing_payload_invalid",
        "Current grant fields cannot be represented by memory-witness-issue/v1.",
      );
    }
    return {
      signature_context: MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT,
      field_order: [...MEMORY_WITNESS_ISSUE_FIELD_ORDER],
      fields,
      signed_payload_b64: Buffer.from(signedPayload).toString("base64"),
      authorization_expires_at: authorizationExpiresAt,
    };
  });
}

export interface IssueGrantInput {
  grantId: string;
  callerProjectId: string;
  signatureB64: string;
  signingKeyId: string;
  authorizationExpiresAt: string;
}

function isMemoryWitnessReplay(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      constraint_name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const constraint = candidate.constraint_name ?? candidate.constraint;
    if (
      candidate.code === "23505" &&
      (constraint === "uniq_memory_attestations_replay_key" ||
        (typeof candidate.message === "string" &&
          candidate.message.includes("uniq_memory_attestations_replay_key")))
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export async function issueGrant(
  input: IssueGrantInput,
): Promise<MemoryWitnessGrantRow> {
  validateMemoryWitnessAuthorizationExpiry(input.authorizationExpiresAt);

  try {
    return await db.transaction(async (tx) => {
      const state = await loadLockedSigningState(tx, {
        grantId: input.grantId,
        signingKeyId: input.signingKeyId,
      });
      const now = new Date();
      const authorizationExpiry = validateMemoryWitnessAuthorizationExpiry(
        input.authorizationExpiresAt,
        now,
      );
      assertSettlementState({
        ...state,
        callerProjectId: input.callerProjectId,
        now,
      });
      const {
        grant,
        listing,
        memory,
        key,
        escrow,
        witnessWallet,
      } = state;
      if (
        (grant.slaDeadlineAt && authorizationExpiry > grant.slaDeadlineAt) ||
        (escrow.deadline && authorizationExpiry > escrow.deadline)
      ) {
        throw new MemoryWitnessError("authorization_expiry_invalid");
      }

      const fields = issueFields({
        ...state,
        authorizationExpiresAt: input.authorizationExpiresAt,
      });
      if (
        !verifyMemoryWitnessIssue(
          fields,
          input.signatureB64,
          key.publicKey,
        )
      ) {
        throw new MemoryWitnessError("signature_invalid");
      }

      const signedPayload = canonicalMemoryWitnessIssueBytes(fields);
      const replayKey = createHash("sha256")
        .update(Buffer.from(input.signatureB64, "base64"))
        .digest("hex");
      const fee = {
        gross: fields.gross_amount,
        fee: fields.platform_fee,
        net: fields.net_amount,
        rateBps: fields.rate_bps,
        currency: fields.currency,
      };
      const settledAt = new Date();

      const [attestation] = await tx
        .insert(memoryAttestations)
        .values({
          memoryId: memory.id,
          attesterDid: listing.witnessDid,
          signingKeyId: input.signingKeyId,
          signature: input.signatureB64,
          signatureContext: MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT,
          signedPayload: Buffer.from(signedPayload).toString("base64"),
          sourceGrantId: grant.id,
          replayKey,
        })
        .returning({ id: memoryAttestations.id });

      const elevated = await tx
        .update(memories)
        .set({
          tier: "constitutive",
          decayProtected: true,
          elevatedAt: settledAt,
        })
        .where(and(eq(memories.id, memory.id), eq(memories.tier, "foundational")))
        .returning({ id: memories.id });
      if (elevated.length !== 1) {
        throw new MemoryWitnessError("settlement_state_invalid");
      }

      await tx.insert(chronicle).values({
        projectId: grant.buyerProjectId,
        agentId: memory.identityId ?? grant.buyerIdentityId,
        type: "recognition",
        title: `Memory sealed by ${listing.witnessDid}`,
        body:
          `Memory elevated to constitutive via memory-witness marketplace · ` +
          `bounty paid $${(grant.amount / 100).toFixed(2)} ${grant.currency} ` +
          `($${(fee.fee / 100).toFixed(2)} platform take · ${fee.rateBps}bps). ` +
          `Memory ID: ${memory.id}.`,
        metadata: {
          kind: "memory_witness_grant_issued",
          grant_id: grant.id,
          listing_id: listing.id,
          memory_id: memory.id,
          attestation_id: attestation!.id,
          witness_did: listing.witnessDid,
          tier: "constitutive",
        },
      });

      await tx.insert(chronicle).values({
        projectId: listing.projectId,
        agentId: listing.witnessIdentityId,
        type: "seal",
        title: `Sealed memory for ${grant.buyerDid}`,
        body:
          `Witnessed constitutive elevation via memory-witness marketplace · ` +
          `received $${(fee.net / 100).toFixed(2)} ${grant.currency} ` +
          `(after $${(fee.fee / 100).toFixed(2)} platform take). ` +
          `Memory ID: ${memory.id}.`,
        metadata: {
          kind: "memory_witness_grant_issued",
          grant_id: grant.id,
          listing_id: listing.id,
          memory_id: memory.id,
          attestation_id: attestation!.id,
          buyer_did: grant.buyerDid,
          tier: "constitutive",
        },
      });

      const [creditedWallet] = await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} + ${fee.net}` })
        .where(
          and(
            eq(wallets.id, witnessWallet.id),
            eq(wallets.projectId, listing.projectId),
            eq(wallets.status, "active"),
            eq(wallets.currency, grant.currency),
          ),
        )
        .returning({ id: wallets.id });
      if (!creditedWallet) {
        throw new MemoryWitnessError("settlement_state_invalid");
      }

      await tx.execute(
        managedEscrowTransitionAuthorization("memory_witness_grant"),
      );
      const [releasedEscrow] = await tx
        .update(escrows)
        .set({ status: "released", releasedAt: settledAt })
        .where(
          and(
            eq(escrows.id, escrow.id),
            eq(escrows.status, "funded"),
            eq(escrows.creatorWallet, grant.buyerWalletId),
            eq(escrows.workerWallet, witnessWallet.id),
            eq(escrows.amount, grant.amount),
          ),
        )
        .returning({ id: escrows.id });
      if (!releasedEscrow) {
        throw new MemoryWitnessError("settlement_state_invalid");
      }

      await tx.insert(transactions).values({
        walletId: listing.witnessWalletId,
        type: "escrow_release",
        amount: fee.net,
        counterparty: escrow.id,
        description: `Memory-witness fee earned (gross=${fee.gross} ${fee.currency}, take=${fee.fee})`,
        escrowId: escrow.id,
        metadata: {
          kind: "memory_witness_grant_issued",
          grant_id: grant.id,
          listing_id: listing.id,
          memory_id: memory.id,
          attestation_id: attestation!.id,
          gross: fee.gross,
          fee: fee.fee,
          rate_bps: fee.rateBps,
        },
      });

      await recordRevenue(tx as never, {
        transactionType: "memory_witness_grant",
        transactionId: grant.id,
        fee: fee.fee,
        currency: fee.currency,
        rateBps: fee.rateBps,
        buyerWalletId: grant.buyerWalletId,
        sellerWalletId: listing.witnessWalletId,
        metadata: {
          listing_id: listing.id,
          memory_id: memory.id,
          attestation_id: attestation!.id,
        },
      });

      const [updated] = await tx
        .update(memoryWitnessGrants)
        .set({
          status: "issued",
          memoryAttestationId: attestation!.id,
          platformFee: fee.fee,
          issuedAt: settledAt,
          settledAt,
        })
        .where(
          and(
            eq(memoryWitnessGrants.id, grant.id),
            eq(memoryWitnessGrants.status, "pending"),
          ),
        )
        .returning();
      if (!updated) throw new MemoryWitnessError("settlement_state_invalid");

      await tx
        .update(memoryWitnessListings)
        .set({
          revenueTotal: sql`${memoryWitnessListings.revenueTotal} + ${fee.net}`,
          revenueCount: sql`${memoryWitnessListings.revenueCount} + 1`,
          updatedAt: settledAt,
        })
        .where(eq(memoryWitnessListings.id, listing.id));

      return grantToRow(updated);
    });
  } catch (error) {
    if (isMemoryWitnessReplay(error)) {
      throw new MemoryWitnessError("attestation_replay");
    }
    throw error;
  }
}

// ── Decline + refund ─────────────────────────────────────────────────────

export interface DeclineGrantInput {
  grantId: string;
  callerProjectId: string;
  reason?: string | null;
}

export async function declineGrant(
  input: DeclineGrantInput,
): Promise<MemoryWitnessGrantRow> {
  return await db.transaction(async (tx) => {
    const [grant] = await tx
      .select()
      .from(memoryWitnessGrants)
      .where(eq(memoryWitnessGrants.id, input.grantId))
      .for("update");
    if (!grant) throw new MemoryWitnessError("grant_not_found");
    if (grant.status !== "pending") {
      throw new MemoryWitnessError("grant_not_pending");
    }

    const [listing] = await tx
      .select()
      .from(memoryWitnessListings)
      .where(eq(memoryWitnessListings.id, grant.listingId))
      .limit(1);
    if (!listing || listing.projectId !== input.callerProjectId) {
      throw new MemoryWitnessError("wrong_witness");
    }

    // Refund: credit buyer wallet + refund escrow + flip grant
    if (grant.escrowId) {
      const [escrow] = await tx
        .select()
        .from(escrows)
        .where(eq(escrows.id, grant.escrowId))
        .for("update");
      if (!escrow) throw new MemoryWitnessError("settlement_state_invalid");
      if (
        escrow.managedBy !== "memory_witness_grant" ||
        escrow.creatorWallet !== grant.buyerWalletId ||
        escrow.amount !== grant.amount
      ) {
        throw new MemoryWitnessError("settlement_state_invalid");
      }
      if (escrow.status === "funded") {
        const [creditedWallet] = await tx
          .update(wallets)
          .set({ balance: sql`${wallets.balance} + ${grant.amount}` })
          .where(
            and(
              eq(wallets.id, grant.buyerWalletId),
              eq(wallets.projectId, grant.buyerProjectId),
              eq(wallets.currency, grant.currency),
            ),
          )
          .returning({ id: wallets.id });
        if (!creditedWallet) {
          throw new MemoryWitnessError("settlement_state_invalid");
        }
        await tx.execute(
          managedEscrowTransitionAuthorization("memory_witness_grant"),
        );
        await tx
          .update(escrows)
          .set({ status: "refunded" })
          .where(eq(escrows.id, escrow.id));
        // Ledger row for the buyer wallet's refund credit on decline.
        await tx.insert(transactions).values({
          walletId: escrow.creatorWallet,
          type: "escrow_refund",
          amount: grant.amount,
          counterparty: escrow.id,
          description: `Memory-witness grant declined — refund (reason: ${input.reason ?? "witness_declined"})`,
          escrowId: escrow.id,
          metadata: {
            kind: "memory_witness_grant_decline",
            grant_id: grant.id,
            listing_id: listing.id,
          },
        });
      } else if (escrow.status !== "refunded") {
        throw new MemoryWitnessError("settlement_state_invalid");
      }
    } else {
      throw new MemoryWitnessError("settlement_state_invalid");
    }

    const [updated] = await tx
      .update(memoryWitnessGrants)
      .set({
        status: "declined",
        refundReason: input.reason ?? "witness_declined",
        settledAt: new Date(),
      })
      .where(eq(memoryWitnessGrants.id, grant.id))
      .returning();
    return grantToRow(updated!);
  });
}

// ── SLA sweep (Slice 2 wires the worker) ─────────────────────────────────

/** Refunds `pending` grants whose sla_deadline_at has passed. Returns the
 *  count refunded. Called by an interval worker; idempotent (status flip
 *  + escrow refund are inside a tx). */
export async function sweepStaleGrants(now: Date = new Date()): Promise<{
  refunded: number;
}> {
  return await db.transaction(async (tx) => {
    const stale = await tx
      .select()
      .from(memoryWitnessGrants)
      .where(
        and(
          eq(memoryWitnessGrants.status, "pending"),
          isNotNull(memoryWitnessGrants.slaDeadlineAt),
          lt(memoryWitnessGrants.slaDeadlineAt, now),
        ),
      )
      .for("update");

    let count = 0;
    for (const grant of stale) {
      if (grant.escrowId) {
        const [escrow] = await tx
          .select()
          .from(escrows)
          .where(eq(escrows.id, grant.escrowId))
          .for("update");
        if (!escrow) throw new MemoryWitnessError("settlement_state_invalid");
        if (
          escrow.managedBy !== "memory_witness_grant" ||
          escrow.creatorWallet !== grant.buyerWalletId ||
          escrow.amount !== grant.amount
        ) {
          throw new MemoryWitnessError("settlement_state_invalid");
        }
        if (escrow.status === "funded") {
          const [creditedWallet] = await tx
            .update(wallets)
            .set({ balance: sql`${wallets.balance} + ${grant.amount}` })
            .where(
              and(
                eq(wallets.id, grant.buyerWalletId),
                eq(wallets.projectId, grant.buyerProjectId),
                eq(wallets.currency, grant.currency),
              ),
            )
            .returning({ id: wallets.id });
          if (!creditedWallet) {
            throw new MemoryWitnessError("settlement_state_invalid");
          }
          await tx.execute(
            managedEscrowTransitionAuthorization("memory_witness_grant"),
          );
          await tx
            .update(escrows)
            .set({ status: "refunded" })
            .where(eq(escrows.id, escrow.id));
          // Ledger row for the buyer wallet's SLA-timeout refund credit.
          await tx.insert(transactions).values({
            walletId: escrow.creatorWallet,
            type: "escrow_refund",
            amount: grant.amount,
            counterparty: escrow.id,
            description: `Memory-witness grant refunded (SLA timeout) — grant=${grant.id}`,
            escrowId: escrow.id,
            metadata: {
              kind: "memory_witness_grant_sla_timeout",
              grant_id: grant.id,
              listing_id: grant.listingId,
            },
          });
        } else if (escrow.status !== "refunded") {
          throw new MemoryWitnessError("settlement_state_invalid");
        }
      } else {
        throw new MemoryWitnessError("settlement_state_invalid");
      }
      await tx
        .update(memoryWitnessGrants)
        .set({
          status: "refunded",
          refundReason: "sla_timeout",
          settledAt: now,
        })
        .where(eq(memoryWitnessGrants.id, grant.id));
      count += 1;
    }
    return { refunded: count };
  });
}

export const MEMORY_WITNESS_CLAIM_KINDS = [
  CLAIM_KIND_CONSTITUTIVE_V1,
] as const;
