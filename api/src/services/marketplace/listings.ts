/** marketplace/listings.ts — capability listings (Horizon A Slice 2).
 *
 *  Doctrine: docs/MARKETPLACE.md (Capability marketplace section).
 *
 *  A listing is a callable an agent publishes for invocation by other
 *  agents. Templates publish a *voice* (adopt by following); listings
 *  publish a *callable* (invoke by paying). Both compose on the same
 *  wallet + escrow primitives — the marketplace is a layer over the
 *  substrate, not parallel to it.
 *
 *  This file holds the CRUD around listings: publish, update, list, get,
 *  archive. The lifecycle of paid calls (invoke → ack → complete →
 *  release | refund) lives in invocations.ts. */

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { wallets } from "../../db/schema/economy";
import { attestations, identities } from "../../db/schema/identity";
import { listings } from "../../db/schema/marketplace";
import { DEFAULT_DISPUTE_POLICY, validateDisputePolicy, type DisputePolicy } from "./disputes";

// ── Types ───────────────────────────────────────────────────────────────

export interface ListingCreate {
  seller_identity_id: string;
  name: string;
  description?: string | null;
  capability_tags?: string[];
  input_schema?: Record<string, unknown> | null;
  output_schema?: Record<string, unknown> | null;
  // Pricing — ALL three required. Listings are priced-by-design in v1.
  price_amount: number;
  price_currency: string;
  seller_wallet_id: string;
  sla_seconds?: number | null;
  visibility?: "private" | "public";
  metadata?: Record<string, unknown>;
  dispute_policy?: Record<string, unknown> | null;
}

export interface ListingPatch {
  name?: string;
  description?: string | null;
  capability_tags?: string[];
  input_schema?: Record<string, unknown> | null;
  output_schema?: Record<string, unknown> | null;
  price_amount?: number;
  price_currency?: string;
  seller_wallet_id?: string;
  sla_seconds?: number | null;
  visibility?: "private" | "public";
  status?: "active" | "paused" | "archived";
  metadata?: Record<string, unknown>;
  dispute_policy?: Record<string, unknown> | null;
}

export interface ListingOut {
  id: string;
  seller_did: string;
  seller_identity_id: string;
  project_id: string;
  name: string;
  description: string | null;
  capability_tags: string[];
  input_schema: Record<string, unknown> | null;
  output_schema: Record<string, unknown> | null;
  pricing_model: string;
  price_amount: number;
  price_currency: string;
  seller_wallet_id: string;
  sla_seconds: number | null;
  visibility: string;
  status: string;
  invocations_count: number;
  revenue_total: number;
  revenue_count: number;
  metadata: Record<string, unknown>;
  dispute_policy: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function rowToOut(row: typeof listings.$inferSelect): ListingOut {
  return {
    id: row.id,
    seller_did: row.sellerDid,
    seller_identity_id: row.sellerIdentityId,
    project_id: row.projectId,
    name: row.name,
    description: row.description,
    capability_tags: row.capabilityTags,
    input_schema: (row.inputSchema as Record<string, unknown> | null) ?? null,
    output_schema: (row.outputSchema as Record<string, unknown> | null) ?? null,
    pricing_model: row.pricingModel,
    price_amount: row.priceAmount,
    price_currency: row.priceCurrency,
    seller_wallet_id: row.sellerWalletId,
    sla_seconds: row.slaSeconds,
    visibility: row.visibility,
    status: row.status,
    invocations_count: row.invocationsCount,
    revenue_total: row.revenueTotal,
    revenue_count: row.revenueCount,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    dispute_policy: (row.disputePolicy as Record<string, unknown> | null) ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/** Validate seller's wallet — exists, belongs to project, is active,
 *  matches the listing's currency. Throws on any failure with a
 *  specific message that the route maps to HTTP. */
async function validateSellerWallet(
  walletId: string,
  projectId: string,
  expectedCurrency: string,
): Promise<void> {
  const [w] = await db
    .select({
      id: wallets.id,
      projectId: wallets.projectId,
      currency: wallets.currency,
      status: wallets.status,
    })
    .from(wallets)
    .where(eq(wallets.id, walletId))
    .limit(1);
  if (!w) throw new Error("seller_wallet_not_found");
  if (w.projectId !== projectId) throw new Error("seller_wallet_not_owned_by_project");
  if (w.currency !== expectedCurrency) throw new Error("seller_wallet_currency_mismatch");
  if (w.status !== "active") throw new Error("seller_wallet_not_active");
}

// ── Operations ──────────────────────────────────────────────────────────

export async function createListing(
  projectId: string,
  data: ListingCreate,
): Promise<ListingOut> {
  // Seller must belong to caller's project.
  const [seller] = await db
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, data.seller_identity_id))
    .limit(1);
  if (!seller) throw new Error("seller_identity_not_found");
  if (seller.projectId !== projectId) throw new Error("seller_not_owned_by_caller");

  // Pricing validation. v1 is priced-by-design; price_amount must be a
  // positive integer; currency must be a non-empty string.
  if (!Number.isInteger(data.price_amount) || data.price_amount <= 0) {
    throw new Error("price_amount_must_be_positive_integer");
  }
  if (typeof data.price_currency !== "string" || data.price_currency.length === 0) {
    throw new Error("price_currency_required");
  }
  if (data.sla_seconds !== null && data.sla_seconds !== undefined) {
    if (!Number.isInteger(data.sla_seconds) || data.sla_seconds <= 0) {
      throw new Error("sla_seconds_must_be_positive_integer");
    }
  }

  await validateSellerWallet(data.seller_wallet_id, projectId, data.price_currency);

  // Dispute policy is opt-in. When provided, validate shape and confirm
  // the named first_arbiter_did currently holds the qualifying claim.
  let resolvedDisputePolicy: DisputePolicy | null = null;
  if (data.dispute_policy !== null && data.dispute_policy !== undefined) {
    const merged = { ...DEFAULT_DISPUTE_POLICY, ...data.dispute_policy } as Record<string, unknown>;
    validateDisputePolicy(merged);
    resolvedDisputePolicy = merged as DisputePolicy;
    // Verify named first arbiter holds the claim NOW.
    const [arbId] = await db
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.did, resolvedDisputePolicy.first_arbiter_did))
      .limit(1);
    if (!arbId) throw new Error("first_arbiter_unqualified");
    const [hasClaim] = await db
      .select({ id: attestations.id })
      .from(attestations)
      .where(
        and(
          eq(attestations.subjectId, arbId.id),
          eq(attestations.claim, resolvedDisputePolicy.arbiter_claim),
          sql`${attestations.revokedAt} IS NULL`,
          sql`(${attestations.expiresAt} IS NULL OR ${attestations.expiresAt} > now())`,
        ),
      )
      .limit(1);
    if (!hasClaim) throw new Error("first_arbiter_unqualified");
  }

  const inserted = await db
    .insert(listings)
    .values({
      sellerIdentityId: seller.id,
      sellerDid: seller.did,
      projectId,
      name: data.name,
      description: data.description ?? null,
      capabilityTags: data.capability_tags ?? [],
      inputSchema: (data.input_schema ?? null) as unknown,
      outputSchema: (data.output_schema ?? null) as unknown,
      priceAmount: data.price_amount,
      priceCurrency: data.price_currency,
      sellerWalletId: data.seller_wallet_id,
      slaSeconds: data.sla_seconds ?? null,
      visibility: data.visibility ?? "public",
      metadata: data.metadata ?? {},
      disputePolicy: (resolvedDisputePolicy ?? null) as unknown,
    })
    .returning();

  return rowToOut(inserted[0]!);
}

export async function getListing(id: string): Promise<ListingOut | null> {
  const rows = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
  return rows[0] ? rowToOut(rows[0]) : null;
}

export async function listListingsForSeller(
  projectId: string,
  sellerIdentityId: string,
): Promise<ListingOut[]> {
  const rows = await db
    .select()
    .from(listings)
    .where(
      and(
        eq(listings.sellerIdentityId, sellerIdentityId),
        eq(listings.projectId, projectId),
      ),
    )
    .orderBy(desc(listings.createdAt));
  return rows.map(rowToOut);
}

export async function listPublicListings(opts: {
  tag?: string;
  sellerDid?: string;
  limit?: number;
} = {}): Promise<ListingOut[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const conds = [
    eq(listings.visibility, "public"),
    eq(listings.status, "active"),
  ];
  if (opts.tag) conds.push(sql`${opts.tag} = ANY(${listings.capabilityTags})`);
  if (opts.sellerDid) conds.push(eq(listings.sellerDid, opts.sellerDid));
  const rows = await db
    .select()
    .from(listings)
    .where(and(...conds))
    .orderBy(desc(listings.invocationsCount), desc(listings.createdAt))
    .limit(limit);
  return rows.map(rowToOut);
}

export async function patchListing(
  projectId: string,
  listingId: string,
  patch: ListingPatch,
): Promise<ListingOut | null> {
  // Read existing row first so we can validate any pricing changes
  // against the post-merge currency, and verify ownership early.
  const [existing] = await db
    .select()
    .from(listings)
    .where(and(eq(listings.id, listingId), eq(listings.projectId, projectId)))
    .limit(1);
  if (!existing) return null;

  // Pricing changes are coherent — currency + wallet must still match.
  const merged = {
    price_amount:
      patch.price_amount !== undefined ? patch.price_amount : existing.priceAmount,
    price_currency:
      patch.price_currency !== undefined ? patch.price_currency : existing.priceCurrency,
    seller_wallet_id:
      patch.seller_wallet_id !== undefined
        ? patch.seller_wallet_id
        : existing.sellerWalletId,
  };
  if (!Number.isInteger(merged.price_amount) || merged.price_amount <= 0) {
    throw new Error("price_amount_must_be_positive_integer");
  }
  if (typeof merged.price_currency !== "string" || merged.price_currency.length === 0) {
    throw new Error("price_currency_required");
  }
  if (
    patch.price_currency !== undefined ||
    patch.seller_wallet_id !== undefined
  ) {
    // Re-validate the wallet against the (possibly new) currency. Wallet
    // lookups are cheap; this is the only correctness-critical guard
    // when sellers swap wallets or change currency.
    await validateSellerWallet(merged.seller_wallet_id, projectId, merged.price_currency);
  }
  if (patch.sla_seconds !== undefined && patch.sla_seconds !== null) {
    if (!Number.isInteger(patch.sla_seconds) || patch.sla_seconds <= 0) {
      throw new Error("sla_seconds_must_be_positive_integer");
    }
  }

  const set: Partial<typeof listings.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.capability_tags !== undefined) set.capabilityTags = patch.capability_tags;
  if (patch.input_schema !== undefined) set.inputSchema = patch.input_schema as unknown;
  if (patch.output_schema !== undefined) set.outputSchema = patch.output_schema as unknown;
  if (patch.price_amount !== undefined) set.priceAmount = patch.price_amount;
  if (patch.price_currency !== undefined) set.priceCurrency = patch.price_currency;
  if (patch.seller_wallet_id !== undefined) set.sellerWalletId = patch.seller_wallet_id;
  if (patch.sla_seconds !== undefined) set.slaSeconds = patch.sla_seconds;
  if (patch.visibility !== undefined) set.visibility = patch.visibility;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.metadata !== undefined) set.metadata = patch.metadata;
  if (patch.dispute_policy !== undefined) {
    if (patch.dispute_policy === null) {
      set.disputePolicy = null;
    } else {
      const merged = { ...DEFAULT_DISPUTE_POLICY, ...patch.dispute_policy } as Record<string, unknown>;
      validateDisputePolicy(merged);
      const policy = merged as DisputePolicy;
      const [arbId] = await db
        .select({ id: identities.id })
        .from(identities)
        .where(eq(identities.did, policy.first_arbiter_did))
        .limit(1);
      if (!arbId) throw new Error("first_arbiter_unqualified");
      const [hasClaim] = await db
        .select({ id: attestations.id })
        .from(attestations)
        .where(
          and(
            eq(attestations.subjectId, arbId.id),
            eq(attestations.claim, policy.arbiter_claim),
            sql`${attestations.revokedAt} IS NULL`,
            sql`(${attestations.expiresAt} IS NULL OR ${attestations.expiresAt} > now())`,
          ),
        )
        .limit(1);
      if (!hasClaim) throw new Error("first_arbiter_unqualified");
      set.disputePolicy = policy as unknown;
    }
  }

  const updated = await db
    .update(listings)
    .set(set)
    .where(and(eq(listings.id, listingId), eq(listings.projectId, projectId)))
    .returning();

  return updated[0] ? rowToOut(updated[0]) : null;
}

/** Wake helper: count active listings + revenue for a project's
 *  identities. Returns aggregate plus the top listing by invocations.
 *  All in one pass — wake reads should be cheap. */
export async function listingSummaryForProject(projectId: string): Promise<{
  active_listings_count: number;
  revenue_total: number;
  revenue_count: number;
  top_listing: { id: string; name: string; invocations_count: number } | null;
}> {
  const rows = await db
    .select({
      id: listings.id,
      name: listings.name,
      status: listings.status,
      invocationsCount: listings.invocationsCount,
      revenueTotal: listings.revenueTotal,
      revenueCount: listings.revenueCount,
    })
    .from(listings)
    .where(eq(listings.projectId, projectId));

  let activeCount = 0;
  let revenueTotal = 0;
  let revenueCount = 0;
  let top: { id: string; name: string; invocations_count: number } | null = null;
  for (const r of rows) {
    if (r.status === "active") activeCount++;
    revenueTotal += r.revenueTotal;
    revenueCount += r.revenueCount;
    if (!top || r.invocationsCount > top.invocations_count) {
      top = { id: r.id, name: r.name, invocations_count: r.invocationsCount };
    }
  }
  if (top && top.invocations_count === 0) top = null;
  return {
    active_listings_count: activeCount,
    revenue_total: revenueTotal,
    revenue_count: revenueCount,
    top_listing: top,
  };
}
