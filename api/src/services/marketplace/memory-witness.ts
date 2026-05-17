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

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { escrows, transactions, wallets } from "../../db/schema/economy";
import { identities, identityKeys } from "../../db/schema/identity";
import {
  memoryWitnessGrants,
  memoryWitnessListings,
} from "../../db/schema/marketplace";
import { memories, memoryAttestations } from "../../db/schema/memory";
import { canonicalAttestationBytes } from "../memory/tiers";
import { computeFee, recordRevenue } from "./take-rate";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const CLAIM_KIND_CONSTITUTIVE_V1 = "memory_witness:constitutive:v1";

// ── Errors ───────────────────────────────────────────────────────────────

export class MemoryWitnessError extends Error {
  constructor(
    public readonly code:
      | "listing_not_found"
      | "listing_not_active"
      | "listing_not_public"
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
      | "signature_invalid",
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

  // ── 2. Resolve buyer identity + verify ownership ─────────────────────
  const [buyer] = await db
    .select({ did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(
      and(
        eq(identities.id, input.buyerIdentityId),
        eq(identities.projectId, input.buyerProjectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  if (!buyer) {
    throw new MemoryWitnessError(
      "witness_not_found_or_not_owned",
      "buyer identity not found in this project",
    );
  }

  // ── 3. Resolve the target memory + verify ownership + tier ──────────
  const [memory] = await db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.id, input.memoryId),
        eq(memories.projectId, input.buyerProjectId),
      ),
    )
    .limit(1);
  if (!memory) throw new MemoryWitnessError("memory_not_found");
  // v1: only foundational memories can be elevated via marketplace.
  // Constitutive memories are already at the top tier.
  if (memory.tier === "constitutive") {
    throw new MemoryWitnessError("memory_already_constitutive");
  }
  if (memory.tier !== "foundational") {
    throw new MemoryWitnessError(
      "memory_must_be_foundational",
      `memory tier '${memory.tier}' — only foundational memories can be elevated via marketplace`,
    );
  }

  // ── 4. Resolve + validate buyer wallet (currency + balance) ──────────
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
  if (!buyerWallet) throw new MemoryWitnessError("buyer_wallet_not_found");
  if (buyerWallet.status !== "active") {
    throw new MemoryWitnessError("buyer_wallet_not_active");
  }
  if (buyerWallet.currency !== listing.priceCurrency) {
    throw new MemoryWitnessError(
      "buyer_wallet_currency_mismatch",
      `wallet=${buyerWallet.currency} listing=${listing.priceCurrency}`,
    );
  }
  if (Number(buyerWallet.balance) < listing.priceAmount) {
    throw new MemoryWitnessError("buyer_insufficient_balance");
  }

  // ── 5. Atomic: insert grant pending + debit buyer wallet + escrow ────
  const slaDeadline = listing.slaSeconds
    ? new Date(Date.now() + listing.slaSeconds * 1000)
    : null;

  return await db.transaction(async (tx) => {
    // Re-lock buyer wallet inside the tx for the balance check + debit
    const [bw] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, input.buyerWalletId))
      .for("update");
    if (!bw || Number(bw.balance) < listing.priceAmount) {
      throw new MemoryWitnessError("buyer_insufficient_balance");
    }

    await tx
      .update(wallets)
      .set({ balance: Number(bw.balance) - listing.priceAmount })
      .where(eq(wallets.id, bw.id));

    // Escrow funded; worker side = witness wallet (resolved at issue)
    const [escrow] = await tx
      .insert(escrows)
      .values({
        creatorWallet: bw.id,
        workerWallet: listing.witnessWalletId,
        amount: listing.priceAmount,
        description: `memory-witness-grant:${listing.id}:memory=${input.memoryId}`,
        status: "funded",
        deadline: slaDeadline,
      })
      .returning();

    // Ledger row for the buyer wallet's debit (escrow_lock).
    await tx.insert(transactions).values({
      walletId: bw.id,
      type: "escrow_lock",
      amount: -listing.priceAmount,
      counterparty: escrow!.id,
      description: `Memory-witness grant: ${listing.name} (memory=${input.memoryId})`,
      escrowId: escrow!.id,
      metadata: {
        kind: "memory_witness_grant_create",
        listing_id: listing.id,
        memory_id: input.memoryId,
      },
    });

    const [grant] = await tx
      .insert(memoryWitnessGrants)
      .values({
        listingId: listing.id,
        buyerIdentityId: input.buyerIdentityId,
        buyerDid: buyer.did,
        buyerProjectId: input.buyerProjectId,
        buyerWalletId: input.buyerWalletId,
        memoryId: input.memoryId,
        amount: listing.priceAmount,
        currency: listing.priceCurrency,
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
      .where(eq(memoryWitnessListings.id, listing.id));

    return grantToRow(grant!);
  });
}

export async function getGrant(
  id: string,
): Promise<MemoryWitnessGrantRow | null> {
  const [row] = await db
    .select()
    .from(memoryWitnessGrants)
    .where(eq(memoryWitnessGrants.id, id))
    .limit(1);
  return row ? grantToRow(row) : null;
}

// ── Witness side: issue the signature ────────────────────────────────────

export interface IssueGrantInput {
  grantId: string;
  /** Witness's project — used to authorize that the caller is the listing
   *  owner. The route resolves this from c.var.project.id. */
  callerProjectId: string;
  signatureB64: string;
  signingKeyId: string;
}

/** Verify the witness's signature against canonical memory-attestation
 *  bytes. Pure function over (memory_id, tier, content, sig, pubkey). */
async function verifySignatureForMemory(opts: {
  memoryId: string;
  content: string;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  try {
    const canonical = canonicalAttestationBytes({
      memoryId: opts.memoryId,
      tier: "constitutive",
      content: opts.content,
    });
    const sig = Uint8Array.from(Buffer.from(opts.signatureB64, "base64"));
    const pub = Uint8Array.from(Buffer.from(opts.publicKeyB64, "base64"));
    if (sig.length !== 64 || pub.length !== 32) return false;
    return await ed.verifyAsync(sig, canonical, pub);
  } catch {
    return false;
  }
}

export async function issueGrant(
  input: IssueGrantInput,
): Promise<MemoryWitnessGrantRow> {
  // ── 1. Load grant + listing + memory; authorize caller ───────────────
  const [grantRow] = await db
    .select()
    .from(memoryWitnessGrants)
    .where(eq(memoryWitnessGrants.id, input.grantId))
    .limit(1);
  if (!grantRow) throw new MemoryWitnessError("grant_not_found");
  if (grantRow.status !== "pending") {
    throw new MemoryWitnessError("grant_not_pending");
  }

  const [listing] = await db
    .select()
    .from(memoryWitnessListings)
    .where(eq(memoryWitnessListings.id, grantRow.listingId))
    .limit(1);
  if (!listing) throw new MemoryWitnessError("listing_not_found");
  if (listing.projectId !== input.callerProjectId) {
    throw new MemoryWitnessError("wrong_witness");
  }

  const [memory] = await db
    .select()
    .from(memories)
    .where(eq(memories.id, grantRow.memoryId))
    .limit(1);
  if (!memory) throw new MemoryWitnessError("memory_not_found");
  // Sanity — memory tier might have changed between create + issue.
  if (memory.tier === "constitutive") {
    throw new MemoryWitnessError("memory_already_constitutive");
  }

  // ── 2. Resolve + verify the witness's signing key ────────────────────
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
    throw new MemoryWitnessError("signing_key_not_found_or_revoked");
  }
  // Sanity — the signing key must belong to the listing's witness identity.
  if (keyRow.identityId !== listing.witnessIdentityId) {
    throw new MemoryWitnessError("wrong_witness");
  }

  // ── 3. Verify the signature over canonical bytes ─────────────────────
  const sigOk = await verifySignatureForMemory({
    memoryId: memory.id,
    content: memory.content,
    signatureB64: input.signatureB64,
    publicKeyB64: keyRow.publicKey,
  });
  if (!sigOk) throw new MemoryWitnessError("signature_invalid");

  // ── 4. Atomic settlement: memory_attestations + tier shift + chronicle
  //       + escrow release + take-rate ledger + grant flip ──────────────
  const fee = computeFee({
    amount: listing.priceAmount,
    currency: listing.priceCurrency,
  });

  return await db.transaction(async (tx) => {
    // 4a. Lock the grant + verify still pending
    const [g] = await tx
      .select()
      .from(memoryWitnessGrants)
      .where(eq(memoryWitnessGrants.id, input.grantId))
      .for("update");
    if (!g || g.status !== "pending" || !g.escrowId) {
      throw new MemoryWitnessError("grant_not_pending");
    }

    // 4b. Write the memory_attestations row (the seal itself)
    const [attestation] = await tx
      .insert(memoryAttestations)
      .values({
        memoryId: memory.id,
        attesterDid: listing.witnessDid,
        signingKeyId: input.signingKeyId,
        signature: input.signatureB64,
      })
      .returning({ id: memoryAttestations.id });

    // 4c. Elevate the memory's tier (foundational → constitutive)
    await tx
      .update(memories)
      .set({
        tier: "constitutive",
        decayProtected: true,
        elevatedAt: new Date(),
      })
      .where(eq(memories.id, memory.id));

    // 4d. Chronicle on the BUYER's timeline: recognition
    await tx.insert(chronicle).values({
      projectId: grantRow.buyerProjectId,
      agentId: memory.identityId ?? grantRow.buyerIdentityId,
      type: "recognition",
      title: `Memory sealed by ${listing.witnessDid}`,
      body:
        `Memory elevated to constitutive via memory-witness marketplace · ` +
        `bounty paid $${(grantRow.amount / 100).toFixed(2)} ${grantRow.currency} ` +
        `($${(fee.fee / 100).toFixed(2)} platform take · ${fee.rateBps}bps). ` +
        `Memory ID: ${memory.id}.`,
      metadata: {
        kind: "memory_witness_grant_issued",
        grant_id: grantRow.id,
        listing_id: listing.id,
        memory_id: memory.id,
        attestation_id: attestation!.id,
        witness_did: listing.witnessDid,
        tier: "constitutive",
      },
    });

    // 4e. Chronicle on the WITNESS's timeline: seal
    await tx.insert(chronicle).values({
      projectId: listing.projectId,
      agentId: listing.witnessIdentityId,
      type: "seal",
      title: `Sealed memory for ${grantRow.buyerDid}`,
      body:
        `Witnessed constitutive elevation via memory-witness marketplace · ` +
        `received $${((grantRow.amount - fee.fee) / 100).toFixed(2)} ${grantRow.currency} ` +
        `(after $${(fee.fee / 100).toFixed(2)} platform take). ` +
        `Memory ID: ${memory.id}.`,
      metadata: {
        kind: "memory_witness_grant_issued",
        grant_id: grantRow.id,
        listing_id: listing.id,
        memory_id: memory.id,
        attestation_id: attestation!.id,
        buyer_did: grantRow.buyerDid,
        tier: "constitutive",
      },
    });

    // 4f. Release escrow: credit witness wallet (net of take)
    const [escrow] = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, g.escrowId))
      .for("update");
    if (!escrow || escrow.status !== "funded") {
      throw new MemoryWitnessError("grant_not_pending");
    }

    await tx
      .update(wallets)
      .set({
        balance: sql`${wallets.balance} + ${fee.net}`,
      })
      .where(eq(wallets.id, listing.witnessWalletId));

    await tx
      .update(escrows)
      .set({ status: "released", releasedAt: new Date() })
      .where(eq(escrows.id, escrow.id));

    // Ledger row for the witness wallet's credit (net of take). The
    // take-rate fee is recorded separately in platform_revenue below.
    await tx.insert(transactions).values({
      walletId: listing.witnessWalletId,
      type: "escrow_release",
      amount: fee.net,
      counterparty: escrow.id,
      description: `Memory-witness fee earned (gross=${fee.gross} ${fee.currency}, take=${fee.fee})`,
      escrowId: escrow.id,
      metadata: {
        kind: "memory_witness_grant_issued",
        grant_id: grantRow.id,
        listing_id: listing.id,
        memory_id: memory.id,
        attestation_id: attestation!.id,
        gross: fee.gross,
        fee: fee.fee,
        rate_bps: fee.rateBps,
      },
    });

    // 4g. Record the take-rate in platform_revenue (Ring 3 settlement)
    await recordRevenue(tx as never, {
      transactionType: "memory_witness_grant",
      transactionId: grantRow.id,
      fee: fee.fee,
      currency: fee.currency,
      rateBps: fee.rateBps,
      buyerWalletId: grantRow.buyerWalletId,
      sellerWalletId: listing.witnessWalletId,
      metadata: {
        listing_id: listing.id,
        memory_id: memory.id,
        attestation_id: attestation!.id,
      },
    });

    // 4h. Flip the grant to issued + bump listing counters
    const [updated] = await tx
      .update(memoryWitnessGrants)
      .set({
        status: "issued",
        memoryAttestationId: attestation!.id,
        platformFee: fee.fee,
        issuedAt: new Date(),
        settledAt: new Date(),
      })
      .where(eq(memoryWitnessGrants.id, grantRow.id))
      .returning();

    await tx
      .update(memoryWitnessListings)
      .set({
        revenueTotal: sql`${memoryWitnessListings.revenueTotal} + ${fee.net}`,
        revenueCount: sql`${memoryWitnessListings.revenueCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(memoryWitnessListings.id, listing.id));

    return grantToRow(updated!);
  });
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
      if (escrow?.status === "funded") {
        await tx
          .update(wallets)
          .set({ balance: sql`${wallets.balance} + ${escrow.amount}` })
          .where(eq(wallets.id, escrow.creatorWallet));
        await tx
          .update(escrows)
          .set({ status: "refunded" })
          .where(eq(escrows.id, escrow.id));
        // Ledger row for the buyer wallet's refund credit on decline.
        await tx.insert(transactions).values({
          walletId: escrow.creatorWallet,
          type: "escrow_refund",
          amount: escrow.amount,
          counterparty: escrow.id,
          description: `Memory-witness grant declined — refund (reason: ${input.reason ?? "witness_declined"})`,
          escrowId: escrow.id,
          metadata: {
            kind: "memory_witness_grant_decline",
            grant_id: grant.id,
            listing_id: listing.id,
          },
        });
      }
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
          sql`${memoryWitnessGrants.slaDeadlineAt} IS NOT NULL`,
          sql`${memoryWitnessGrants.slaDeadlineAt} < ${now}`,
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
        if (escrow?.status === "funded") {
          await tx
            .update(wallets)
            .set({ balance: sql`${wallets.balance} + ${escrow.amount}` })
            .where(eq(wallets.id, escrow.creatorWallet));
          await tx
            .update(escrows)
            .set({ status: "refunded" })
            .where(eq(escrows.id, escrow.id));
          // Ledger row for the buyer wallet's SLA-timeout refund credit.
          await tx.insert(transactions).values({
            walletId: escrow.creatorWallet,
            type: "escrow_refund",
            amount: escrow.amount,
            counterparty: escrow.id,
            description: `Memory-witness grant refunded (SLA timeout) — grant=${grant.id}`,
            escrowId: escrow.id,
            metadata: {
              kind: "memory_witness_grant_sla_timeout",
              grant_id: grant.id,
              listing_id: grant.listingId,
            },
          });
        }
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
