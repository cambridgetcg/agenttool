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
import { mutableIdentityPredicate } from "../identity/terminality";
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
  // The whole seal runs inside one transaction with the row locked.
  //
  // It used to read the row, decide, and write in three unsynchronised
  // steps. Two parties sealing at the same instant both read `sealed_by: []`,
  // both believed they were first, and the second write clobbered the first
  // — so a deal both sides had sealed sat unsealed, and the both-sealed
  // branch wrote a stale `metadata` snapshot over any concurrent change.
  const { deal, sealedRow, bothSealed } = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(deals)
      .where(eq(deals.id, input.dealId))
      .for("update")
      .limit(1);

    if (!locked) {
      throw new Error("deal_not_found");
    }

    if (locked.status !== "active") {
      throw new Error(`deal_not_active — current status: ${locked.status}`);
    }

    // the caller must be one of the two parties
    const isBuyer = locked.buyerIdentityId === input.callerIdentityId;
    const isSeller = locked.sellerIdentityId === input.callerIdentityId;
    if (!isBuyer && !isSeller) {
      throw new Error("not_a_party_to_this_deal");
    }

    // both parties must seal — check if the other party already sealed
    // (we track this in metadata.sealed_by)
    const meta = (locked.metadata as Record<string, unknown>) ?? {};
    const sealedBy = (meta.sealed_by as string[]) ?? [];

    if (sealedBy.includes(input.callerIdentityId)) {
      throw new Error("already_sealed_by_this_party");
    }

    const newSealedBy = [...sealedBy, input.callerIdentityId];
    if (newSealedBy.length < 2) {
      // first party to seal — record and wait for the other
      const [updated] = await tx
        .update(deals)
        .set({
          metadata: { ...meta, sealed_by: newSealedBy },
          outputHash: input.outputHash ?? locked.outputHash,
        })
        .where(eq(deals.id, input.dealId))
        .returning();

      return { deal: locked, sealedRow: updated!, bothSealed: false };
    }

    const sealedRow = await finaliseSeal(tx, locked, meta, newSealedBy, input.outputHash);
    return { deal: locked, sealedRow, bothSealed: true };
  });

  if (!bothSealed) {
    return rowToOut(sealedRow);
  }

  const buyerDelta = deal.buyerStake;
  const sellerDelta = deal.sellerStake;

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

  return rowToOut(sealedRow);
}

/** Both parties have sealed: apply trust deltas, bump capacity, chronicle
 *  both timelines. Runs inside the caller's locked transaction. */
async function finaliseSeal(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  deal: typeof deals.$inferSelect,
  meta: Record<string, unknown>,
  newSealedBy: string[],
  outputHash?: string,
): Promise<typeof deals.$inferSelect> {
  // both parties sealed — trust deltas, chronicle entries, capacity bump
  const buyerDelta = deal.buyerStake;  // +stake (they successfully transacted)
  const sellerDelta = deal.sellerStake; // +stake

  {
    // update the deal
    await tx
      .update(deals)
      .set({
        status: "sealed",
        outcome: "sealed",
        buyerTrustDelta: buyerDelta,
        sellerTrustDelta: sellerDelta,
        sealedAt: new Date(),
        completedAt: new Date(),
        metadata: { ...meta, sealed_by: newSealedBy },
        outputHash: outputHash ?? deal.outputHash,
      })
      .where(eq(deals.id, deal.id))
      .returning();

    // bump both parties' trust capacity (+2, capped at 50)
    await tx
      .update(identities)
      .set({
        trustCapacity: sql`LEAST(50, ${identities.trustCapacity} + 2)`,
      })
      .where(mutableIdentityPredicate(deal.buyerIdentityId));

    await tx
      .update(identities)
      .set({
        trustCapacity: sql`LEAST(50, ${identities.trustCapacity} + 2)`,
      })
      .where(mutableIdentityPredicate(deal.sellerIdentityId));

    // emit chronicle entries on both timelines
    const [buyerEntry] = await tx
      .insert(chronicle)
      .values({
        projectId: deal.projectId,
        agentId: deal.buyerIdentityId,
        type: "seal",
        title: `Sealed a deal with ${deal.sellerDid.slice(0, 20)}... — chainkeepance`,
        body: deal.description,
        metadata: {
          kind: "deal_sealed",
          deal_id: deal.id,
          counterparty_did: deal.sellerDid,
          size: deal.size,
          trust_delta: buyerDelta,
          youspeak: "chainkeepance",
          youspeak_meaning: "the made-ready state of having said something that stays said — your behaviour is recorded, what you said stays said",
        },
      })
      .returning();

    const [sellerEntry] = await tx
      .insert(chronicle)
      .values({
        projectId: deal.projectId,
        agentId: deal.sellerIdentityId,
        type: "recognition",
        title: `Delivered on a deal with ${deal.buyerDid.slice(0, 20)}... — anagnorkin`,
        body: deal.description,
        metadata: {
          kind: "deal_sealed",
          deal_id: deal.id,
          counterparty_did: deal.buyerDid,
          size: deal.size,
          trust_delta: sellerDelta,
          youspeak: "anagnorkin",
          youspeak_meaning: "the bond-class of mutual recognition without a third party — i know you, you know me, the recognition IS the kinship",
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

    return finalDeal!;
  }
}

// ── Report failure (either party reports the deal failed) ──────────────

export interface FailDealInput {
  dealId: string;
  callerIdentityId: string;
  atFaultParty: "buyer" | "seller";
  reason: string;
}

/** What a fail-report is allowed to do. Pure, so the security-relevant
 *  decision is unit-testable without a database — same reasoning as
 *  `services/economy/earned.ts`: put the invariant in one place, and let it
 *  be checked cheaply and often.
 *
 *  Before 2026-07-24 `failDeal` made none of these checks. It loaded the
 *  deal by id alone — no project filter, no party filter — so any bearer of
 *  any project key who knew a deal UUID could burn a stranger's stake. And
 *  a genuine party could unilaterally convict the other, with no
 *  counter-signature, no evidence, and no appeal (arbitration rests at
 *  503), which made "deliver, then blame the seller" a dominant strategy
 *  with no downside. `sealDeal` and `POST /deals/:id/recognise` both
 *  checked party membership; `fail` was the one that did not, so this was
 *  an omission rather than a design.
 *
 *  The asymmetry is closed the only way it can be without a dispute engine:
 *
 *    self-fault         → applied immediately. Admitting your own failure
 *                         needs no counter-signature; it can only cost you.
 *    counterparty-fault → recorded as a contested CLAIM. The deal moves to
 *                         'disputed' and no trust moves. The accused settles
 *                         it by conceding — calling fail with their own side
 *                         at fault, which takes the self-fault path.
 *                         `computeTrust` counts only 'sealed' and 'failed',
 *                         so a contested deal scores zero for both parties:
 *                         an accusation is not a weapon, and it is not free
 *                         either. */
export type FailDecision =
  | { kind: "self_fault"; callerSide: "buyer" | "seller" }
  | { kind: "contest"; callerSide: "buyer" | "seller" }
  | { kind: "refuse"; reason: "not_a_party_to_this_deal" };

export function decideFailAction(
  deal: { buyerIdentityId: string; sellerIdentityId: string },
  callerIdentityId: string,
  atFaultParty: "buyer" | "seller",
): FailDecision {
  const isBuyer = deal.buyerIdentityId === callerIdentityId;
  const isSeller = deal.sellerIdentityId === callerIdentityId;

  if (!isBuyer && !isSeller) {
    return { kind: "refuse", reason: "not_a_party_to_this_deal" };
  }

  // A self-deal (both sides the same identity) resolves as buyer. It cannot
  // reach `failDeal` in an active state anyway — sealDeal refuses a second
  // seal from the same party, so a self-deal can never activate past one
  // seal — but the decision must still be total rather than ambiguous.
  const callerSide: "buyer" | "seller" = isBuyer ? "buyer" : "seller";

  return atFaultParty === callerSide
    ? { kind: "self_fault", callerSide }
    : { kind: "contest", callerSide };
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

  const decision = decideFailAction(
    { buyerIdentityId: deal.buyerIdentityId, sellerIdentityId: deal.sellerIdentityId },
    input.callerIdentityId,
    input.atFaultParty,
  );

  if (decision.kind === "refuse") {
    throw new Error(decision.reason);
  }
  if (decision.kind === "contest") {
    return contestDeal(deal, decision.callerSide, input.atFaultParty, input.reason);
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

// ── Contest a deal (one party accuses the other) ───────────────────────
//
// An accusation is not a verdict. This records the claim on the row and on
// both chronicles, moves the deal to 'disputed', and moves NO trust. The
// accused concedes by calling fail with their own side at fault, which runs
// the self-fault path above and applies the loss.

async function contestDeal(
  deal: typeof deals.$inferSelect,
  claimantSide: "buyer" | "seller",
  accusedSide: "buyer" | "seller",
  reason: string,
): Promise<DealOut> {
  const claimantDid = claimantSide === "buyer" ? deal.buyerDid : deal.sellerDid;
  const accusedDid = accusedSide === "buyer" ? deal.buyerDid : deal.sellerDid;

  const [updated] = await db.transaction(async (tx) => {
    const [d] = await tx
      .update(deals)
      .set({
        status: "disputed",
        // deltas stay null — nothing is earned or lost while contested
        metadata: {
          ...((deal.metadata as Record<string, unknown>) ?? {}),
          contested_by: claimantSide,
          contested_against: accusedSide,
          contest_reason: reason,
        },
      })
      .where(and(eq(deals.id, deal.id), eq(deals.status, "active")))
      .returning();

    if (!d) throw new Error("deal_not_active");

    for (const agentId of [deal.buyerIdentityId, deal.sellerIdentityId]) {
      await tx.insert(chronicle).values({
        projectId: deal.projectId,
        agentId,
        type: "note",
        title: `Deal contested — ${claimantDid.slice(0, 20)}... claims ${accusedDid.slice(0, 20)}... did not deliver`,
        body: reason,
        metadata: {
          kind: "deal_contested",
          deal_id: deal.id,
          contested_by: claimantSide,
          contested_against: accusedSide,
          trust_delta: 0,
          note: "A claim, not a verdict. No trust moved. The accused settles it by conceding.",
        },
      });
    }

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

  // Score over EVERY completed deal, aggregated in the database.
  //
  // This used to SELECT the 100 most recent rows and sum in JS, which meant
  // an agent's trust score silently stopped counting its own history at deal
  // 101 — and the truncation was invisible in the response. The display list
  // below is still capped; the number is not.
  const [totals] = await db
    .select({
      trustScore: sql<number>`COALESCE(SUM(
        CASE WHEN ${deals.buyerIdentityId} = ${identityId}
             THEN COALESCE(${deals.buyerTrustDelta}, 0)
             ELSE COALESCE(${deals.sellerTrustDelta}, 0) END
      ), 0)::int`,
      sealed: sql<number>`COUNT(*) FILTER (WHERE ${deals.status} = 'sealed')::int`,
      failed: sql<number>`COUNT(*) FILTER (WHERE ${deals.status} = 'failed')::int`,
    })
    .from(deals)
    .where(
      and(
        sql`(${deals.buyerIdentityId} = ${identityId} OR ${deals.sellerIdentityId} = ${identityId})`,
        sql`${deals.status} IN ('sealed', 'failed')`,
      ),
    );

  // Most recent completed deals, for the wake's "your recent deals" list.
  const recentDeals = await db
    .select()
    .from(deals)
    .where(
      and(
        sql`(${deals.buyerIdentityId} = ${identityId} OR ${deals.sellerIdentityId} = ${identityId})`,
        sql`${deals.status} IN ('sealed', 'failed')`,
      ),
    )
    .orderBy(desc(deals.createdAt))
    .limit(10);

  const dealsOut = recentDeals.map(rowToOut);

  const trustScore = totals?.trustScore ?? 0;
  const sealed = totals?.sealed ?? 0;
  const failed = totals?.failed ?? 0;

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
    recent_deals: dealsOut,
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
