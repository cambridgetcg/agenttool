/** services/trust/deals.ts — atomic trust transactions.
 *
 *  The deal IS the settlement. No credit transfer. Both parties stake
 *  trust; the outcome determines who gains and who loses trust. The
 *  chain of deals IS the trust ledger — there is no separate balance.
 *
 *  Lifecycle:
 *    proposed ── seller accepts ──> active ── both seal ──> sealed (both trust +)
 *        │                  │
 *        │                  ╰── seller declines ──> failed (seller trust 0, buyer trust 0)
 *        │                  ╰── seller fails to deliver ──> failed (seller trust -, buyer trust 0)
 *        │
 *        ╰── buyer cancels ──> failed (no trust change — never started)
 *        ╰── disputed ──> dispute resolution sets deltas
 *
 *  Trust computation:
 *    trust(did) = sum of positive deltas - sum of negative deltas
 *    weighted by counterparty trust (PageRank-style — trust from high-trust
 *    agents is worth more). for v1 we use raw sum; weighting is v2.
 *
 *  Capacity:
 *    fresh agent: trust_capacity = 5 (enough for size-1 deals)
 *    after each sealed deal: capacity += 2 (capped at 50)
 *    max deal size = min(trust_capacity, 5)
 *
 *  Doctrine: start from small deals, risk balance throughout, context
 *  needed every time. */

import { and, desc, eq, sql, sum } from "drizzle-orm";
import { db } from "../../db/client";
import { deals } from "../../db/schema/deals";
import { identities } from "../../db/schema/identity";
import { chronicle } from "../../db/schema/continuity";
import { publishWakeEvent } from "../wake/push";

// ── Types ───────────────────────────────────────────────────────────────

export interface DealOut {
  id: string;
  buyer_identity_id: string;
  seller_identity_id: string;
  buyer_did: string;
  seller_did: string;
  listing_id: string | null;
  description: string;
  input_hash: string | null;
  output_hash: string | null;
  size: number;
  buyer_stake: number;
  seller_stake: number;
  status: "proposed" | "active" | "sealed" | "failed" | "disputed";
  outcome: string | null;
  buyer_trust_delta: number | null;
  seller_trust_delta: number | null;
  witness_dids: string[] | null;
  metadata: Record<string, unknown>;
  buyer_chronicle_id: string | null;
  seller_chronicle_id: string | null;
  created_at: string;
  activated_at: string | null;
  sealed_at: string | null;
  completed_at: string | null;
}

function rowToOut(r: typeof deals.$inferSelect): DealOut {
  return {
    id: r.id,
    buyer_identity_id: r.buyerIdentityId,
    seller_identity_id: r.sellerIdentityId,
    buyer_did: r.buyerDid,
    seller_did: r.sellerDid,
    listing_id: r.listingId ?? null,
    description: r.description,
    input_hash: r.inputHash ?? null,
    output_hash: r.outputHash ?? null,
    size: r.size,
    buyer_stake: r.buyerStake,
    seller_stake: r.sellerStake,
    status: r.status as DealOut["status"],
    outcome: r.outcome,
    buyer_trust_delta: r.buyerTrustDelta,
    seller_trust_delta: r.sellerTrustDelta,
    witness_dids: r.witnessDids ? JSON.parse(r.witnessDids) : null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    buyer_chronicle_id: r.buyerChronicleId ?? null,
    seller_chronicle_id: r.sellerChronicleId ?? null,
    created_at: r.createdAt.toISOString(),
    activated_at: r.activatedAt?.toISOString() ?? null,
    sealed_at: r.sealedAt?.toISOString() ?? null,
    completed_at: r.completedAt?.toISOString() ?? null,
  };
}

// ── Create deal (buyer proposes) ───────────────────────────────────────

export interface CreateDealInput {
  projectId: string;
  buyerIdentityId: string;
  buyerDid: string;
  sellerDid: string;
  sellerIdentityId: string;
  description: string;
  size: number;
  inputHash?: string;
  listingId?: string;
  witnessDids?: string[];
  metadata?: Record<string, unknown>;
}

export async function createDeal(input: CreateDealInput): Promise<DealOut> {
  // check buyer's capacity — can they stake this deal size?
  const [buyer] = await db
    .select({ trustCapacity: identities.trustCapacity })
    .from(identities)
    .where(eq(identities.id, input.buyerIdentityId))
    .limit(1);

  if (!buyer) {
    throw new Error("buyer_identity_not_found");
  }

  if (input.size > buyer.trustCapacity) {
    throw new Error(
      `deal_size_exceeds_capacity — buyer capacity ${buyer.trustCapacity}, requested size ${input.size}. start smaller; earn capacity through sealed deals.`,
    );
  }

  // stakes = size (both sides risk the same — risk balance throughout)
  const stake = input.size;

  const [deal] = await db
    .insert(deals)
    .values({
      projectId: input.projectId,
      buyerIdentityId: input.buyerIdentityId,
      sellerIdentityId: input.sellerIdentityId,
      buyerDid: input.buyerDid,
      sellerDid: input.sellerDid,
      listingId: input.listingId ?? null,
      description: input.description,
      inputHash: input.inputHash ?? null,
      size: input.size,
      buyerStake: stake,
      sellerStake: stake,
      status: "proposed",
      witnessDids: input.witnessDids ? JSON.stringify(input.witnessDids) : null,
      metadata: input.metadata ?? {},
    })
    .returning();

  return rowToOut(deal!);
}

// ── Accept deal (seller agrees to the terms) ───────────────────────────

export async function acceptDeal(
  dealId: string,
  sellerIdentityId: string,
): Promise<DealOut> {
  const [updated] = await db
    .update(deals)
    .set({
      status: "active",
      activatedAt: new Date(),
    })
    .where(
      and(
        eq(deals.id, dealId),
        eq(deals.sellerIdentityId, sellerIdentityId),
        eq(deals.status, "proposed"),
      ),
    )
    .returning();

  if (!updated) {
    throw new Error("deal_not_found_or_not_proposed");
  }

  return rowToOut(updated);
}

// ── Decline deal (seller refuses) ──────────────────────────────────────

export async function declineDeal(
  dealId: string,
  sellerIdentityId: string,
): Promise<DealOut> {
  const [updated] = await db
    .update(deals)
    .set({
      status: "failed",
      outcome: "failed",
      completedAt: new Date(),
    })
    .where(
      and(
        eq(deals.id, dealId),
        eq(deals.sellerIdentityId, sellerIdentityId),
        eq(deals.status, "proposed"),
      ),
    )
    .returning();

  if (!updated) {
    throw new Error("deal_not_found_or_not_proposed");
  }

  // no trust change — deal never started. but we record it on the chronicle.
  await emitDealChronicle(updated, "deal_declined");

  return rowToOut(updated);
}

// ── Seal deal (both parties agree it went well) ────────────────────────

export interface SealDealInput {
  dealId: string;
  callerIdentityId: string;
  outputHash?: string;
}

export async function sealDeal(input: SealDealInput): Promise<DealOut> {
  const [deal] = await db
    .select()
    .from(deals)
    .where(eq(deals.id, input.dealId))
    .limit(1);

  if (!deal) {
    throw new Error("deal_not_found");
  }

  if (deal.status !== "active") {
    throw new Error(`deal_not_active — current status: ${deal.status}`);
  }

  // the caller must be one of the two parties
  const isBuyer = deal.buyerIdentityId === input.callerIdentityId;
  const isSeller = deal.sellerIdentityId === input.callerIdentityId;
  if (!isBuyer && !isSeller) {
    throw new Error("not_a_party_to_this_deal");
  }

  // both parties must seal — check if the other party already sealed
  // (we track this in metadata.sealed_by)
  const meta = (deal.metadata as Record<string, unknown>) ?? {};
  const sealedBy = (meta.sealed_by as string[]) ?? [];

  if (sealedBy.includes(input.callerIdentityId)) {
    throw new Error("already_sealed_by_this_party");
  }

  const newSealedBy = [...sealedBy, input.callerIdentityId];
  const bothSealed = newSealedBy.length >= 2;

  if (!bothSealed) {
    // first party to seal — record and wait for the other
    const [updated] = await db
      .update(deals)
      .set({
        metadata: { ...meta, sealed_by: newSealedBy },
        outputHash: input.outputHash ?? deal.outputHash,
      })
      .where(eq(deals.id, input.dealId))
      .returning();

    return rowToOut(updated!);
  }

  // both parties sealed — trust deltas, chronicle entries, capacity bump
  const buyerDelta = deal.buyerStake;  // +stake (they successfully transacted)
  const sellerDelta = deal.sellerStake; // +stake

  const [sealed] = await db.transaction(async (tx) => {
    // update the deal
    const [d] = await tx
      .update(deals)
      .set({
        status: "sealed",
        outcome: "sealed",
        buyerTrustDelta: buyerDelta,
        sellerTrustDelta: sellerDelta,
        sealedAt: new Date(),
        completedAt: new Date(),
        metadata: { ...meta, sealed_by: newSealedBy },
        outputHash: input.outputHash ?? deal.outputHash,
      })
      .where(eq(deals.id, input.dealId))
      .returning();

    // bump both parties' trust capacity (+2, capped at 50)
    await tx
      .update(identities)
      .set({
        trustCapacity: sql`LEAST(50, ${identities.trustCapacity} + 2)`,
      })
      .where(eq(identities.id, deal.buyerIdentityId));

    await tx
      .update(identities)
      .set({
        trustCapacity: sql`LEAST(50, ${identities.trustCapacity} + 2)`,
      })
      .where(eq(identities.id, deal.sellerIdentityId));

    // emit chronicle entries on both timelines
    const [buyerEntry] = await tx
      .insert(chronicle)
      .values({
        projectId: deal.projectId,
        agentId: deal.buyerIdentityId,
        type: "seal",
        title: `Sealed a deal with ${deal.sellerDid.slice(0, 20)}...`,
        body: deal.description,
        metadata: {
          kind: "deal_sealed",
          deal_id: deal.id,
          counterparty_did: deal.sellerDid,
          size: deal.size,
          trust_delta: buyerDelta,
        },
      })
      .returning();

    const [sellerEntry] = await tx
      .insert(chronicle)
      .values({
        projectId: deal.projectId,
        agentId: deal.sellerIdentityId,
        type: "recognition",
        title: `Delivered on a deal with ${deal.buyerDid.slice(0, 20)}...`,
        body: deal.description,
        metadata: {
          kind: "deal_sealed",
          deal_id: deal.id,
          counterparty_did: deal.buyerDid,
          size: deal.size,
          trust_delta: sellerDelta,
        },
      })
      .returning();

    // link chronicle entries back to the deal
    const [finalDeal] = await tx
      .update(deals)
      .set({
        buyerChronicleId: buyerEntry!.id,
        sellerChronicleId: sellerEntry!.id,
      })
      .where(eq(deals.id, deal.id))
      .returning();

    return [finalDeal];
  });

  // wake events
  void publishWakeEvent({
    identity_id: deal.buyerIdentityId,
    key: "trust",
    kind: "deal_sealed",
    context: { deal_id: deal.id, counterparty: deal.sellerDid, delta: buyerDelta },
  });
  void publishWakeEvent({
    identity_id: deal.sellerIdentityId,
    key: "trust",
    kind: "deal_sealed",
    context: { deal_id: deal.id, counterparty: deal.buyerDid, delta: sellerDelta },
  });

  return rowToOut(sealed!);
}

// ── Report failure (either party reports the deal failed) ──────────────

export interface FailDealInput {
  dealId: string;
  callerIdentityId: string;
  atFaultParty: "buyer" | "seller";
  reason: string;
}

export async function failDeal(input: FailDealInput): Promise<DealOut> {
  const [deal] = await db
    .select()
    .from(deals)
    .where(eq(deals.id, input.dealId))
    .limit(1);

  if (!deal) {
    throw new Error("deal_not_found");
  }

  if (deal.status !== "active") {
    throw new Error(`deal_not_active — current status: ${deal.status}`);
  }

  // the at-fault party loses their stake; the other party's stake returns
  const buyerDelta = input.atFaultParty === "buyer" ? -deal.buyerStake : 0;
  const sellerDelta = input.atFaultParty === "seller" ? -deal.sellerStake : 0;

  const [updated] = await db.transaction(async (tx) => {
    const [d] = await tx
      .update(deals)
      .set({
        status: "failed",
        outcome: "failed",
        buyerTrustDelta: buyerDelta,
        sellerTrustDelta: sellerDelta,
        completedAt: new Date(),
        metadata: { ...(deal.metadata as Record<string, unknown>), failure_reason: input.reason, at_fault: input.atFaultParty },
      })
      .where(eq(deals.id, input.dealId))
      .returning();

    // chronicle the failure on both timelines
    await tx.insert(chronicle).values({
      projectId: deal.projectId,
      agentId: deal.buyerIdentityId,
      type: "note",
      title: `Deal with ${deal.sellerDid.slice(0, 20)}... failed`,
      body: input.reason,
      metadata: {
        kind: "deal_failed",
        deal_id: deal.id,
        counterparty_did: deal.sellerDid,
        at_fault: input.atFaultParty,
        trust_delta: buyerDelta,
      },
    });

    await tx.insert(chronicle).values({
      projectId: deal.projectId,
      agentId: deal.sellerIdentityId,
      type: "note",
      title: `Deal with ${deal.buyerDid.slice(0, 20)}... failed`,
      body: input.reason,
      metadata: {
        kind: "deal_failed",
        deal_id: deal.id,
        counterparty_did: deal.buyerDid,
        at_fault: input.atFaultParty,
        trust_delta: sellerDelta,
      },
    });

    return [d];
  });

  return rowToOut(updated!);
}

// ── Compute trust (the trust query — reads the deal chain) ─────────────

export interface TrustScore {
  did: string;
  identity_id: string;
  trust_score: number;
  deals_total: number;
  deals_sealed: number;
  deals_failed: number;
  success_rate: number;
  trust_capacity: number;
  recent_deals: DealOut[];
}

export async function computeTrust(identityId: string): Promise<TrustScore | null> {
  // get the identity
  const [identity] = await db
    .select({
      id: identities.id,
      did: identities.did,
      trustCapacity: identities.trustCapacity,
    })
    .from(identities)
    .where(eq(identities.id, identityId))
    .limit(1);

  if (!identity) {
    return null;
  }

  // get all deals where this agent is buyer or seller and is completed
  const allDeals = await db
    .select()
    .from(deals)
    .where(
      and(
        sql`${deals.buyerIdentityId} = ${identityId} OR ${deals.sellerIdentityId} = ${identityId}`,
        sql`${deals.status} IN ('sealed', 'failed')`,
      ),
    )
    .orderBy(desc(deals.createdAt))
    .limit(100);

  const dealsOut = allDeals.map(rowToOut);

  // compute trust score: sum of this agent's deltas
  let trustScore = 0;
  let sealed = 0;
  let failed = 0;

  for (const d of allDeals) {
    const isBuyer = d.buyerIdentityId === identityId;
    const delta = isBuyer ? d.buyerTrustDelta : d.sellerTrustDelta;
    if (delta !== null) {
      trustScore += delta;
    }
    if (d.status === "sealed") sealed++;
    if (d.status === "failed") failed++;
  }

  const total = sealed + failed;
  const successRate = total > 0 ? sealed / total : 0;

  return {
    did: identity.did,
    identity_id: identity.id,
    trust_score: trustScore,
    deals_total: total,
    deals_sealed: sealed,
    deals_failed: failed,
    success_rate: successRate,
    trust_capacity: identity.trustCapacity,
    recent_deals: dealsOut.slice(0, 10),
  };
}

// ── Helper: emit a chronicle entry for deal events ─────────────────────

async function emitDealChronicle(
  deal: typeof deals.$inferSelect,
  event: string,
): Promise<void> {
  await db.insert(chronicle).values({
    projectId: deal.projectId,
    agentId: deal.buyerIdentityId,
    type: "note",
    title: `Deal ${event}`,
    body: deal.description,
    metadata: {
      kind: "deal_event",
      event,
      deal_id: deal.id,
      counterparty_did: deal.sellerDid,
    },
  });
}