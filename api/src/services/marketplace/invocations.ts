/** marketplace/invocations.ts — paid calls against a listing.
 *
 *  Doctrine: docs/MARKETPLACE.md (Capability marketplace section).
 *
 *  Lifecycle:
 *    escrowed     ── seller acks ──> acknowledged ── seller completes ──> released
 *        │                  │
 *        │                  ╰── seller declines ──> refunded
 *        │                  ╰── sla_timeout (lazy) ──> refunded
 *        │
 *        ╰── buyer cancels ──> refunded
 *        ╰── sla_timeout (lazy) ──> refunded
 *
 *  released and refunded are terminal. The 'completed' status value
 *  reserved in the schema is for v2 (buyer-review window); v1 collapses
 *  completion-and-release into one step in /complete.
 *
 *  All money moves are in single DB transactions, mirroring
 *  services/marketplace/purchases.ts. Escrow rows are written directly
 *  (not via the escrow service) so the listing-revenue counters can
 *  bump in the same txn — same pattern as template purchases. */

import { and, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { escrows, transactions, wallets } from "../../db/schema/economy";
import { identities, identityKeys } from "../../db/schema/identity";
import { invocations, listings } from "../../db/schema/marketplace";
import {
  validateSealedShape,
  verifyInvocationCompletion,
  type SealedBytes,
} from "./sig";
import { computeFee, recordRevenue } from "./take-rate";

// ── Types ───────────────────────────────────────────────────────────────

export interface InvocationOut {
  id: string;
  listing_id: string;
  buyer_did: string;
  buyer_identity_id: string;
  buyer_project_id: string;
  buyer_wallet_id: string;
  amount: number;
  currency: string;
  escrow_id: string | null;
  input_sealed: SealedBytes;
  output_sealed: SealedBytes | null;
  completion_sig: string | null;
  status: "escrowed" | "acknowledged" | "completed" | "released" | "refunded";
  refund_reason: "cancelled" | "declined" | "sla_timeout" | null;
  sla_deadline_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  acknowledged_at: string | null;
  completed_at: string | null;
  settled_at: string | null;
}

function rowToOut(r: typeof invocations.$inferSelect): InvocationOut {
  return {
    id: r.id,
    listing_id: r.listingId,
    buyer_did: r.buyerDid,
    buyer_identity_id: r.buyerIdentityId,
    buyer_project_id: r.buyerProjectId,
    buyer_wallet_id: r.buyerWalletId,
    amount: r.amount,
    currency: r.currency,
    escrow_id: r.escrowId,
    input_sealed: r.inputSealed as SealedBytes,
    output_sealed: (r.outputSealed as SealedBytes | null) ?? null,
    completion_sig: r.completionSig,
    status: r.status as InvocationOut["status"],
    refund_reason: r.refundReason as InvocationOut["refund_reason"],
    sla_deadline_at: r.slaDeadlineAt?.toISOString() ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
    acknowledged_at: r.acknowledgedAt?.toISOString() ?? null,
    completed_at: r.completedAt?.toISOString() ?? null,
    settled_at: r.settledAt?.toISOString() ?? null,
  };
}

// ── Invoke (buyer creates an invocation against a listing) ──────────────

export interface InvokeInput {
  listingId: string;
  buyerProjectId: string;
  buyerIdentityId: string;
  buyerWalletId: string;
  inputSealed: unknown;          // unvalidated; validateSealedShape inside
  metadata?: Record<string, unknown>;
}

export async function invokeListing(input: InvokeInput): Promise<InvocationOut> {
  // Shape-check the sealed input *before* opening a transaction. Bad shape
  // is a client error, not a partial-state hazard.
  validateSealedShape(input.inputSealed);

  // ── 1. Resolve listing ───────────────────────────────────────────────
  const [listing] = await db
    .select()
    .from(listings)
    .where(eq(listings.id, input.listingId))
    .limit(1);
  if (!listing) throw new Error("listing_not_found");
  if (listing.status !== "active") throw new Error("listing_not_active");
  if (listing.visibility !== "public" && listing.projectId !== input.buyerProjectId) {
    // Private listings can only be invoked from the seller's own project
    // (parity with private templates being adopted only by the author).
    throw new Error("listing_not_public");
  }

  // ── 2. Resolve buyer identity ────────────────────────────────────────
  const [buyer] = await db
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, input.buyerIdentityId))
    .limit(1);
  if (!buyer) throw new Error("buyer_identity_not_found");
  if (buyer.projectId !== input.buyerProjectId) {
    throw new Error("buyer_not_owned_by_caller");
  }

  // ── 3. Self-invocation wall (identity) ───────────────────────────────
  //  Check before any wallet lookup — clearer error and avoids spurious
  //  balance failures when the seller pokes their own listing.
  if (listing.sellerIdentityId === buyer.id) {
    throw new Error("self_invocation_not_allowed");
  }

  // ── 4. Validate buyer wallet ─────────────────────────────────────────
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
  if (buyerWallet.id === listing.sellerWalletId) {
    // Belt-and-suspenders: same wallet on both sides. Most cases are
    // already caught above (same identity); this catches cross-identity
    // shared-wallet quirks too.
    throw new Error("self_invocation_not_allowed");
  }
  if (buyerWallet.status !== "active") throw new Error("buyer_wallet_not_active");
  if (buyerWallet.currency !== listing.priceCurrency) {
    throw new Error(
      `currency_mismatch: listing=${listing.priceCurrency}, wallet=${buyerWallet.currency}`,
    );
  }
  if (buyerWallet.balance < listing.priceAmount) {
    throw new Error("insufficient_balance");
  }

  // SLA deadline: now + sla_seconds (or null = best-effort).
  const now = new Date();
  const slaDeadline = listing.slaSeconds
    ? new Date(now.getTime() + listing.slaSeconds * 1000)
    : null;

  // ── 5. Atomic txn: invocation + escrow + buyer wallet debit ──────────
  const result = await db.transaction(async (tx) => {
    // 5a. Insert invocation row (escrowed)
    const [inv] = await tx
      .insert(invocations)
      .values({
        listingId: listing.id,
        buyerIdentityId: buyer.id,
        buyerDid: buyer.did,
        buyerProjectId: input.buyerProjectId,
        buyerWalletId: buyerWallet.id,
        amount: listing.priceAmount,
        currency: listing.priceCurrency,
        inputSealed: input.inputSealed as unknown,
        slaDeadlineAt: slaDeadline,
        metadata: input.metadata ?? {},
      })
      .returning();

    // 5b. Lock buyer wallet, re-check balance (race protection)
    const [bw] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, buyerWallet.id))
      .for("update");
    if (!bw || bw.balance < listing.priceAmount) {
      throw new Error("insufficient_balance");
    }

    // 5c. Debit buyer wallet
    await tx
      .update(wallets)
      .set({ balance: bw.balance - listing.priceAmount })
      .where(eq(wallets.id, bw.id));

    // 5d. Create escrow row, worker = seller's wallet (assigned at invoke)
    const [escrow] = await tx
      .insert(escrows)
      .values({
        creatorWallet: bw.id,
        workerWallet: listing.sellerWalletId,
        amount: listing.priceAmount,
        description: `Invocation: ${listing.name} (${listing.id})`,
        status: "funded",
        deadline: slaDeadline,
      })
      .returning();

    // 5e. Transaction record
    await tx.insert(transactions).values({
      walletId: bw.id,
      type: "escrow_lock",
      amount: -listing.priceAmount,
      counterparty: escrow!.id,
      description: `Invocation locked: ${listing.name}`,
      escrowId: escrow!.id,
      metadata: { listing_id: listing.id, invocation_id: inv!.id },
    });

    // 5f. Link escrow id back to invocation; bump listing counter
    const [updatedInv] = await tx
      .update(invocations)
      .set({ escrowId: escrow!.id })
      .where(eq(invocations.id, inv!.id))
      .returning();

    await tx
      .update(listings)
      .set({
        invocationsCount: sql`${listings.invocationsCount} + 1`,
        updatedAt: now,
      })
      .where(eq(listings.id, listing.id));

    return updatedInv;
  });

  return rowToOut(result!);
}

// ── Acknowledge (seller commits) ────────────────────────────────────────

export async function acknowledgeInvocation(
  invocationId: string,
  sellerProjectId: string,
): Promise<InvocationOut> {
  return await db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, invocationId))
      .for("update");
    if (!inv) throw new Error("invocation_not_found");

    // Authorise: caller must own the listing's seller side.
    const [listing] = await tx
      .select({ id: listings.id, projectId: listings.projectId })
      .from(listings)
      .where(eq(listings.id, inv.listingId))
      .limit(1);
    if (!listing || listing.projectId !== sellerProjectId) {
      throw new Error("not_seller");
    }

    if (inv.status !== "escrowed") {
      throw new Error(`invocation_state_invalid: status=${inv.status}`);
    }

    // Lazy SLA sweep — if deadline passed before seller acked, we refund
    // here rather than letting the seller commit to work that's already
    // expired. This keeps the buyer's UX honest.
    if (inv.slaDeadlineAt && inv.slaDeadlineAt < new Date()) {
      await refundInTxn(tx, inv, "sla_timeout");
      const [reread] = await tx
        .select()
        .from(invocations)
        .where(eq(invocations.id, invocationId));
      throw new Error("sla_expired");
    }

    const now = new Date();
    const [updated] = await tx
      .update(invocations)
      .set({ status: "acknowledged", acknowledgedAt: now })
      .where(eq(invocations.id, invocationId))
      .returning();
    return rowToOut(updated!);
  });
}

// ── Complete (seller submits sealed output + ed25519 signature) ─────────
// Releases escrow atomically; bumps listing revenue counters; credits the
// seller's wallet. v1 collapses completed → released into a single step.

export interface CompleteInput {
  invocationId: string;
  sellerProjectId: string;
  outputSealed: unknown;     // unvalidated; validateSealedShape inside
  signatureB64: string;      // ed25519 over canonical bytes
}

export async function completeInvocation(input: CompleteInput): Promise<InvocationOut> {
  validateSealedShape(input.outputSealed);
  const output = input.outputSealed as SealedBytes;

  return await db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, input.invocationId))
      .for("update");
    if (!inv) throw new Error("invocation_not_found");

    // Authorise via listing → project ownership.
    const [listing] = await tx
      .select()
      .from(listings)
      .where(eq(listings.id, inv.listingId))
      .for("update");
    if (!listing || listing.projectId !== input.sellerProjectId) {
      throw new Error("not_seller");
    }

    if (inv.status !== "acknowledged") {
      // Seller must ack before completing — gives us a clean "I committed"
      // signal and keeps the SLA-sweep lazy-check honest.
      throw new Error(`invocation_state_invalid: status=${inv.status}`);
    }

    if (inv.slaDeadlineAt && inv.slaDeadlineAt < new Date()) {
      // SLA passed during work. Refund instead of release.
      await refundInTxn(tx, inv, "sla_timeout");
      throw new Error("sla_expired");
    }

    // Verify ed25519 sig with seller's active identity public key.
    const [sellerKey] = await tx
      .select({ publicKey: identityKeys.publicKey })
      .from(identityKeys)
      .where(
        and(
          eq(identityKeys.identityId, listing.sellerIdentityId),
          eq(identityKeys.active, true),
        ),
      )
      .limit(1);
    if (!sellerKey) throw new Error("seller_signing_key_missing");

    const ok = verifyInvocationCompletion({
      invocationId: inv.id,
      output,
      signatureB64: input.signatureB64,
      publicKeyB64: sellerKey.publicKey,
    });
    if (!ok) throw new Error("completion_signature_invalid");

    if (!inv.escrowId) throw new Error("escrow_missing");

    // Lock escrow row.
    const [escrow] = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, inv.escrowId))
      .for("update");
    if (!escrow) throw new Error("escrow_missing");
    if (escrow.status !== "funded") {
      throw new Error(`escrow_state_invalid: status=${escrow.status}`);
    }
    if (!escrow.workerWallet) throw new Error("escrow_worker_missing");

    // Take-rate split: seller receives gross − fee; the fee is recorded
    // in marketplace.platform_revenue (Ring 3 take-rate ledger).
    // Doctrine: docs/BUSINESS-MODEL.md.
    const split = computeFee({
      amount: escrow.amount,
      currency: inv.currency,
    });

    // Credit seller wallet (net of fee).
    await tx
      .update(wallets)
      .set({ balance: sql`balance + ${split.net}` })
      .where(eq(wallets.id, escrow.workerWallet));

    // Mark escrow released.
    await tx
      .update(escrows)
      .set({ status: "released", releasedAt: new Date() })
      .where(eq(escrows.id, escrow.id));

    await tx.insert(transactions).values({
      walletId: escrow.workerWallet,
      type: "escrow_release",
      amount: split.net,
      counterparty: escrow.creatorWallet,
      description: `Invocation released: ${listing.name}`,
      escrowId: escrow.id,
      metadata: {
        listing_id: listing.id,
        invocation_id: inv.id,
        platform_fee: split.fee,
        gross_amount: split.gross,
      },
    });

    await recordRevenue(tx, {
      transactionType: "capability_invocation",
      transactionId: inv.id,
      fee: split.fee,
      currency: split.currency,
      rateBps: split.rateBps,
      buyerWalletId: escrow.creatorWallet,
      sellerWalletId: escrow.workerWallet,
      metadata: { listing_id: listing.id },
    });

    // Update invocation: store sealed output + sig, mark released.
    const now = new Date();
    const [updated] = await tx
      .update(invocations)
      .set({
        status: "released",
        outputSealed: output as unknown,
        completionSig: input.signatureB64,
        completedAt: now,
        settledAt: now,
      })
      .where(eq(invocations.id, inv.id))
      .returning();

    // Revenue counter tracks NET (seller-received) revenue. Gross volume
    // can be reconstructed by joining to platform_revenue + summing.
    await tx
      .update(listings)
      .set({
        revenueTotal: sql`${listings.revenueTotal} + ${split.net}`,
        revenueCount: sql`${listings.revenueCount} + 1`,
        updatedAt: now,
      })
      .where(eq(listings.id, listing.id));

    return rowToOut(updated!);
  });
}

// ── Decline (seller refuses) ────────────────────────────────────────────

export async function declineInvocation(
  invocationId: string,
  sellerProjectId: string,
): Promise<InvocationOut> {
  return await db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, invocationId))
      .for("update");
    if (!inv) throw new Error("invocation_not_found");

    const [listing] = await tx
      .select({ id: listings.id, projectId: listings.projectId })
      .from(listings)
      .where(eq(listings.id, inv.listingId))
      .limit(1);
    if (!listing || listing.projectId !== sellerProjectId) {
      throw new Error("not_seller");
    }

    if (inv.status !== "escrowed" && inv.status !== "acknowledged") {
      throw new Error(`invocation_state_invalid: status=${inv.status}`);
    }

    await refundInTxn(tx, inv, "declined");
    const [reread] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, invocationId));
    return rowToOut(reread!);
  });
}

// ── Cancel (buyer aborts before seller engages) ─────────────────────────
// Only allowed while status='escrowed'. Once seller acks, the buyer can
// no longer cancel — the seller has committed to the work; only seller
// decline or SLA timeout refund from there. This protects sellers from
// buyers gaming the queue after seeing partial work.

export async function cancelInvocation(
  invocationId: string,
  buyerProjectId: string,
): Promise<InvocationOut> {
  return await db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, invocationId))
      .for("update");
    if (!inv) throw new Error("invocation_not_found");
    if (inv.buyerProjectId !== buyerProjectId) throw new Error("not_buyer");

    if (inv.status !== "escrowed") {
      throw new Error(`invocation_state_invalid: status=${inv.status}`);
    }

    // If past SLA, attribute the refund to sla_timeout; otherwise it's
    // a buyer-initiated cancel.
    const reason: "cancelled" | "sla_timeout" =
      inv.slaDeadlineAt && inv.slaDeadlineAt < new Date()
        ? "sla_timeout"
        : "cancelled";

    await refundInTxn(tx, inv, reason);
    const [reread] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, invocationId));
    return rowToOut(reread!);
  });
}

// ── Internal: refund inside an existing txn ─────────────────────────────

async function refundInTxn(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  inv: typeof invocations.$inferSelect,
  reason: "cancelled" | "declined" | "sla_timeout",
): Promise<void> {
  if (!inv.escrowId) throw new Error("escrow_missing");

  const [escrow] = await tx
    .select()
    .from(escrows)
    .where(eq(escrows.id, inv.escrowId))
    .for("update");
  if (!escrow) throw new Error("escrow_missing");
  if (escrow.status !== "funded") {
    throw new Error(`escrow_state_invalid: status=${escrow.status}`);
  }

  // Refund creator's wallet.
  await tx
    .update(wallets)
    .set({ balance: sql`balance + ${escrow.amount}` })
    .where(eq(wallets.id, escrow.creatorWallet));

  await tx
    .update(escrows)
    .set({ status: "refunded" })
    .where(eq(escrows.id, escrow.id));

  await tx.insert(transactions).values({
    walletId: escrow.creatorWallet,
    type: "escrow_refund",
    amount: escrow.amount,
    counterparty: escrow.id,
    description: `Invocation refunded (${reason}): ${inv.id}`,
    escrowId: escrow.id,
    metadata: { invocation_id: inv.id, reason },
  });

  await tx
    .update(invocations)
    .set({
      status: "refunded",
      refundReason: reason,
      settledAt: new Date(),
    })
    .where(eq(invocations.id, inv.id));
}

// ── Reads ───────────────────────────────────────────────────────────────

/** Get invocation with lazy SLA sweep. If status is escrowed/acknowledged
 *  AND past SLA deadline, sweep to refunded before returning. */
export async function getInvocation(
  invocationId: string,
  callerProjectId: string,
): Promise<InvocationOut | null> {
  // First, lazy sweep if needed (its own txn).
  await maybeExpireInvocation(invocationId);

  const [r] = await db
    .select()
    .from(invocations)
    .where(eq(invocations.id, invocationId))
    .limit(1);
  if (!r) return null;

  // Authorise: buyer or seller (via listing.projectId).
  if (r.buyerProjectId === callerProjectId) return rowToOut(r);

  const [listing] = await db
    .select({ projectId: listings.projectId })
    .from(listings)
    .where(eq(listings.id, r.listingId))
    .limit(1);
  if (listing?.projectId === callerProjectId) return rowToOut(r);

  // Not buyer, not seller — caller has no business reading this row.
  return null;
}

async function maybeExpireInvocation(invocationId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, invocationId))
      .for("update");
    if (!inv) return;
    if (inv.status !== "escrowed" && inv.status !== "acknowledged") return;
    if (!inv.slaDeadlineAt || inv.slaDeadlineAt >= new Date()) return;
    await refundInTxn(tx, inv, "sla_timeout");
  });
}

/** Background sweep — refund every overdue invocation. Exposed so a cron
 *  / e2e can flush the queue without per-row GETs. v1 doesn't run this on
 *  a timer; lazy GET-sweep covers most cases. */
export async function expireOverdueInvocations(): Promise<number> {
  const overdue = await db
    .select({ id: invocations.id })
    .from(invocations)
    .where(
      and(
        sql`${invocations.status} IN ('escrowed', 'acknowledged')`,
        sql`${invocations.slaDeadlineAt} < now()`,
      ),
    );
  for (const r of overdue) {
    try {
      await maybeExpireInvocation(r.id);
    } catch {
      // One row's failure shouldn't block the rest.
    }
  }
  return overdue.length;
}

export async function listInvocationsForListing(
  listingId: string,
  sellerProjectId: string,
): Promise<InvocationOut[]> {
  // Ownership check first.
  const [listing] = await db
    .select({ projectId: listings.projectId })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  if (!listing || listing.projectId !== sellerProjectId) return [];

  const rows = await db
    .select()
    .from(invocations)
    .where(eq(invocations.listingId, listingId))
    .orderBy(sql`${invocations.createdAt} DESC`);
  return rows.map(rowToOut);
}

export async function listInvocationsForProject(
  projectId: string,
  role: "buyer" | "seller",
): Promise<InvocationOut[]> {
  if (role === "buyer") {
    const rows = await db
      .select()
      .from(invocations)
      .where(eq(invocations.buyerProjectId, projectId))
      .orderBy(sql`${invocations.createdAt} DESC`);
    return rows.map(rowToOut);
  }
  // seller: join through listings.projectId
  const rows = await db
    .select({
      inv: invocations,
    })
    .from(invocations)
    .innerJoin(listings, eq(listings.id, invocations.listingId))
    .where(eq(listings.projectId, projectId))
    .orderBy(sql`${invocations.createdAt} DESC`);
  return rows.map((r) => rowToOut(r.inv));
}

/** Wake helper: aggregate counts for the seller's pending queue.
 *  Pending = escrowed (awaiting ack) + acknowledged (in flight).
 *  sla_breach_count = pending where deadline < now (lazy enforcement). */
export async function pendingSellerSummary(projectId: string): Promise<{
  pending_invocations_count: number;
  oldest_pending_at: string | null;
  sla_breach_count: number;
}> {
  const rows = await db
    .select({
      status: invocations.status,
      createdAt: invocations.createdAt,
      slaDeadlineAt: invocations.slaDeadlineAt,
    })
    .from(invocations)
    .innerJoin(listings, eq(listings.id, invocations.listingId))
    .where(
      and(
        eq(listings.projectId, projectId),
        sql`${invocations.status} IN ('escrowed', 'acknowledged')`,
      ),
    );

  const now = new Date();
  let pending = 0;
  let oldest: Date | null = null;
  let breaches = 0;
  for (const r of rows) {
    pending++;
    if (!oldest || r.createdAt < oldest) oldest = r.createdAt;
    if (r.slaDeadlineAt && r.slaDeadlineAt < now) breaches++;
  }
  return {
    pending_invocations_count: pending,
    oldest_pending_at: oldest?.toISOString() ?? null,
    sla_breach_count: breaches,
  };
}

/** Wake helper: buyer's in-flight + 30-day settlement summary. */
export async function buyerInvocationSummary(projectId: string): Promise<{
  in_flight_count: number;
  released_30d: number;
  refunded_30d: number;
}> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      status: invocations.status,
      settledAt: invocations.settledAt,
    })
    .from(invocations)
    .where(eq(invocations.buyerProjectId, projectId));

  let inFlight = 0;
  let released30d = 0;
  let refunded30d = 0;
  for (const r of rows) {
    if (r.status === "escrowed" || r.status === "acknowledged") inFlight++;
    if (r.status === "released" && r.settledAt && r.settledAt >= thirtyDaysAgo)
      released30d++;
    if (r.status === "refunded" && r.settledAt && r.settledAt >= thirtyDaysAgo)
      refunded30d++;
  }
  return {
    in_flight_count: inFlight,
    released_30d: released30d,
    refunded_30d: refunded30d,
  };
}
