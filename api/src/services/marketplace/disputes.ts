/** marketplace/disputes.ts — dispute primitive (file/rule/escalate/vote/finalize).
 *
 *  Doctrine: docs/MARKETPLACE.md (Dispute primitive section).
 *  Spec:     docs/superpowers/specs/2026-05-10-dispute-primitive-design.md
 *
 *  Listings opt in via dispute_policy; first arbiter named by seller from
 *  holders of a qualifying attestation claim. Escalation draws a 5-attester
 *  pool deterministically; 4-of-5 overturn. Pool ruling is final.
 *
 *  This file currently holds the pure helpers (pool draw, staking math,
 *  policy validation). DB-bound flow (file/rule/escalate/vote/finalize) is
 *  appended in later tasks. */

import { createHash } from "node:crypto";

// ── Pool draw (pure, deterministic, auditable) ───────────────────────

export interface PoolCandidate {
  id: string;
  did: string;
}

/** Deterministic random sample of 5 candidates seeded by
 *  sha256(case_id || ":" || timestamp_unix). Returns null when fewer
 *  than 5 candidates are available.
 *
 *  The seed produces an integer stream from the hash, used as a
 *  Fisher-Yates-style index source. Anyone with the case_id +
 *  pool_drawn_at can replay the draw and confirm the result. */
export function drawPool(
  candidates: PoolCandidate[],
  caseId: string,
  timestampUnix: number,
  poolSize: number = 5,
): PoolCandidate[] | null {
  if (candidates.length < poolSize) return null;
  const seed = createHash("sha256").update(`${caseId}:${timestampUnix}`).digest();
  // Build an integer stream from the seed by re-hashing as we exhaust bytes.
  let stream = Buffer.from(seed);
  let cursor = 0;
  function nextUint32(): number {
    if (cursor + 4 > stream.length) {
      stream = Buffer.from(createHash("sha256").update(stream).digest());
      cursor = 0;
    }
    const v = stream.readUInt32BE(cursor);
    cursor += 4;
    return v;
  }
  // Fisher-Yates partial shuffle.
  const arr = candidates.slice();
  for (let i = 0; i < poolSize; i++) {
    const j = i + (nextUint32() % (arr.length - i));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, poolSize);
}

// ── Staking math (pure, integer-safe) ───────────────────────────────

export interface BondSplit {
  toPool: number;          // 60% of forfeit, divided equally
  perPoolMember: number;   // toPool / poolSize, integer-floored
  toFirstArbiter: number;  // 30% of forfeit
  toPlatform: number;      // 10% of forfeit, plus any rounding remainder
}

/** Compute how a forfeited filer bond is distributed when an escalation
 *  FAILS (pool upholds the first ruling). Doctrinal split: 60% to
 *  upholding pool members (equal shares), 30% to the first arbiter,
 *  10% to the platform take-rate ledger. Any integer-rounding remainder
 *  stays on the platform side so the sum is exact. */
export function computeDisputeBondSplit(
  bondAmount: number,
  poolSize: number,
): BondSplit {
  if (bondAmount <= 0 || poolSize <= 0) {
    return { toPool: 0, perPoolMember: 0, toFirstArbiter: 0, toPlatform: 0 };
  }
  const toPoolGross = Math.floor((bondAmount * 60) / 100);
  const perPoolMember = Math.floor(toPoolGross / poolSize);
  const toPool = perPoolMember * poolSize;
  const toFirstArbiter = Math.floor((bondAmount * 30) / 100);
  const toPlatform = bondAmount - toPool - toFirstArbiter;
  return { toPool, perPoolMember, toFirstArbiter, toPlatform };
}

export interface ArbiterFees {
  firstArbiterFee: number;     // 2% of disputed amount; paid if ruling stands
  perPoolMemberFee: number;    // 2% of disputed amount each; paid on overturn
  totalPoolFees: number;       // perPoolMemberFee * poolSize
}

/** Compute the arbiter compensation carved from escrow when a dispute
 *  resolves. The first arbiter's fee is paid only if their ruling stands
 *  (no escalation, OR escalation fails). Pool fees are paid only when
 *  escalation overturns. Both rates are 2% in v1; sub-minor-unit slices
 *  floor to 0 in buyer-favor (mirrors computeFee in take-rate.ts). */
export function computeDisputeArbiterFees(opts: {
  disputedAmount: number;
  poolSize: number;
}): ArbiterFees {
  const firstArbiterFee = Math.floor((opts.disputedAmount * 2) / 100);
  const perPoolMemberFee = Math.floor((opts.disputedAmount * 2) / 100);
  return {
    firstArbiterFee,
    perPoolMemberFee,
    totalPoolFees: perPoolMemberFee * opts.poolSize,
  };
}

// ── Dispute policy validation (pure) ────────────────────────────────

export interface DisputePolicy {
  arbiter_claim: string;
  first_arbiter_did: string;
  buyer_review_seconds: number;
  first_arbiter_sla_seconds: number;
  escalation_seconds: number;
  pool_vote_seconds: number;
  filer_bond_bps: number;
}

export const DEFAULT_DISPUTE_POLICY: Omit<DisputePolicy, "arbiter_claim" | "first_arbiter_did"> = {
  buyer_review_seconds: 259200,       // 72h
  first_arbiter_sla_seconds: 172800,  // 48h
  escalation_seconds: 172800,         // 48h
  pool_vote_seconds: 86400,           // 24h
  filer_bond_bps: 2500,               // 25%
};

/** Validate the shape of a dispute_policy payload before the listing
 *  service stores it. Throws on any malformed field with a specific
 *  message the route maps to HTTP. Defaults are applied by the caller
 *  AFTER validation passes — this helper only checks what was provided. */
export function validateDisputePolicy(value: unknown): asserts value is DisputePolicy {
  if (!value || typeof value !== "object") {
    throw new Error("dispute_policy_must_be_object");
  }
  const p = value as Record<string, unknown>;

  if (typeof p.arbiter_claim !== "string" || p.arbiter_claim.length === 0) {
    throw new Error("dispute_policy_arbiter_claim_required");
  }
  if (typeof p.first_arbiter_did !== "string" || p.first_arbiter_did.length === 0) {
    throw new Error("dispute_policy_first_arbiter_did_required");
  }

  for (const field of [
    "buyer_review_seconds",
    "first_arbiter_sla_seconds",
    "escalation_seconds",
    "pool_vote_seconds",
  ] as const) {
    const v = p[field];
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
      throw new Error(`dispute_policy_duration_invalid: ${field}`);
    }
  }

  const bps = p.filer_bond_bps;
  if (typeof bps !== "number" || !Number.isInteger(bps) || bps < 0 || bps > 10000) {
    throw new Error("dispute_policy_filer_bond_bps_invalid");
  }
}

// ── Service: file a dispute ─────────────────────────────────────────

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { attestations, identities, identityKeys } from "../../db/schema/identity";
import { disputeCases, disputePoolVotes, invocations, listings } from "../../db/schema/marketplace";

export type DisputeCaseStatus = "open" | "first_ruled" | "escalated" | "resolved";
export type DisputeRuling = "release" | "refund" | "split";

export interface DisputeCaseOut {
  id: string;
  invocation_id: string;
  filer_role: "buyer" | "seller";
  filer_project_id: string;
  filer_identity_id: string;
  reason: string | null;
  evidence: Record<string, unknown> | null;
  first_arbiter_identity_id: string | null;
  first_arbiter_did: string | null;
  first_arbiter_ruling: DisputeRuling | null;
  first_arbiter_split_pct: number | null;
  first_arbiter_signature: string | null;
  first_arbiter_signing_key_id: string | null;
  first_arbiter_ruled_at: string | null;
  first_arbiter_sla_deadline_at: string | null;
  escalation_deadline_at: string | null;
  escalated_by_role: "buyer" | "seller" | null;
  escalator_bond_amount: number | null;
  escalator_bond_escrow_id: string | null;
  pool_drawn_at: string | null;
  pool_size: number | null;
  pool_vote_deadline_at: string | null;
  final_ruling: DisputeRuling | null;
  final_split_pct: number | null;
  status: DisputeCaseStatus;
  resolution_path: string | null;
  resolved_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function caseRowToOut(r: typeof disputeCases.$inferSelect): DisputeCaseOut {
  return {
    id: r.id,
    invocation_id: r.invocationId,
    filer_role: r.filerRole as "buyer" | "seller",
    filer_project_id: r.filerProjectId,
    filer_identity_id: r.filerIdentityId,
    reason: r.reason,
    evidence: (r.evidence as Record<string, unknown> | null) ?? null,
    first_arbiter_identity_id: r.firstArbiterIdentityId,
    first_arbiter_did: r.firstArbiterDid,
    first_arbiter_ruling: r.firstArbiterRuling as DisputeRuling | null,
    first_arbiter_split_pct: r.firstArbiterSplitPct,
    first_arbiter_signature: r.firstArbiterSignature,
    first_arbiter_signing_key_id: r.firstArbiterSigningKeyId,
    first_arbiter_ruled_at: r.firstArbiterRuledAt?.toISOString() ?? null,
    first_arbiter_sla_deadline_at: r.firstArbiterSlaDeadlineAt?.toISOString() ?? null,
    escalation_deadline_at: r.escalationDeadlineAt?.toISOString() ?? null,
    escalated_by_role: r.escalatedByRole as "buyer" | "seller" | null,
    escalator_bond_amount: r.escalatorBondAmount,
    escalator_bond_escrow_id: r.escalatorBondEscrowId,
    pool_drawn_at: r.poolDrawnAt?.toISOString() ?? null,
    pool_size: r.poolSize,
    pool_vote_deadline_at: r.poolVoteDeadlineAt?.toISOString() ?? null,
    final_ruling: r.finalRuling as DisputeRuling | null,
    final_split_pct: r.finalSplitPct,
    status: r.status as DisputeCaseStatus,
    resolution_path: r.resolutionPath,
    resolved_at: r.resolvedAt?.toISOString() ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

export interface FileDisputeInput {
  invocationId: string;
  filerProjectId: string;
  filerRole: "buyer" | "seller";
  filerIdentityId: string;
  reason?: string | null;
  evidence?: Record<string, unknown> | null;
}

/** File a dispute against an invocation. Atomic:
 *    1. Lock invocation; must be in 'completed' state and within
 *       buyer_review_deadline_at.
 *    2. Verify caller owns the filer role (buyer = invocation.buyerProjectId,
 *       seller = listing.projectId).
 *    3. Resolve first arbiter from listing.dispute_policy. If their
 *       qualifying attestation is revoked/expired, set status='resolved'
 *       with resolution_path='first_arbiter_unqualified' and refund.
 *    4. Insert dispute_cases row; flip invocation.status to 'disputed'. */
export async function fileDispute(input: FileDisputeInput): Promise<DisputeCaseOut> {
  return await db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, input.invocationId))
      .for("update");
    if (!inv) throw new Error("invocation_not_found");
    if (inv.status !== "completed") {
      throw new Error(`invocation_state_invalid: status=${inv.status}`);
    }
    if (inv.buyerReviewDeadlineAt && inv.buyerReviewDeadlineAt < new Date()) {
      throw new Error("buyer_review_window_expired");
    }
    if (inv.disputeCaseId) {
      throw new Error("dispute_already_filed");
    }

    const [listing] = await tx
      .select()
      .from(listings)
      .where(eq(listings.id, inv.listingId))
      .limit(1);
    if (!listing) throw new Error("listing_not_found");
    if (!listing.disputePolicy) {
      throw new Error("listing_not_disputable");
    }
    const policy = listing.disputePolicy as DisputePolicy;

    if (input.filerRole === "buyer" && inv.buyerProjectId !== input.filerProjectId) {
      throw new Error("not_buyer");
    }
    if (input.filerRole === "seller" && listing.projectId !== input.filerProjectId) {
      throw new Error("not_seller");
    }

    // Resolve first arbiter from policy. They must currently hold the
    // qualifying claim AND not be revoked.
    const [firstArbiterIdentity] = await tx
      .select({ id: identities.id, did: identities.did })
      .from(identities)
      .where(eq(identities.did, policy.first_arbiter_did))
      .limit(1);

    let firstArbiterIdentityId: string | null = null;
    let firstArbiterUnqualified = false;
    if (firstArbiterIdentity) {
      const [att] = await tx
        .select({ id: attestations.id })
        .from(attestations)
        .where(
          and(
            eq(attestations.subjectId, firstArbiterIdentity.id),
            eq(attestations.claim, policy.arbiter_claim),
            sql`${attestations.revokedAt} IS NULL`,
            sql`(${attestations.expiresAt} IS NULL OR ${attestations.expiresAt} > now())`,
          ),
        )
        .limit(1);
      if (att) firstArbiterIdentityId = firstArbiterIdentity.id;
      else firstArbiterUnqualified = true;
    } else {
      firstArbiterUnqualified = true;
    }

    const now = new Date();
    const slaDeadline = new Date(now.getTime() + policy.first_arbiter_sla_seconds * 1000);

    const [caseRow] = await tx
      .insert(disputeCases)
      .values({
        invocationId: inv.id,
        filerRole: input.filerRole,
        filerProjectId: input.filerProjectId,
        filerIdentityId: input.filerIdentityId,
        reason: input.reason ?? null,
        evidence: (input.evidence ?? null) as unknown,
        firstArbiterIdentityId,
        firstArbiterDid: firstArbiterIdentityId ? policy.first_arbiter_did : null,
        firstArbiterSlaDeadlineAt: firstArbiterIdentityId ? slaDeadline : null,
        status: firstArbiterUnqualified ? "resolved" : "open",
        resolutionPath: firstArbiterUnqualified ? "first_arbiter_unqualified" : null,
        finalRuling: firstArbiterUnqualified ? "refund" : null,
        resolvedAt: firstArbiterUnqualified ? now : null,
      })
      .returning();

    await tx
      .update(invocations)
      .set({
        status: firstArbiterUnqualified ? "refunded" : "disputed",
        disputeCaseId: caseRow!.id,
      })
      .where(eq(invocations.id, inv.id));

    // If unqualified, also fold the escrow refund here. The actual
    // refund settlement (debit seller hold, credit buyer wallet, mark
    // escrow refunded) is handled by the existing escrow refund path —
    // call into it as a helper. For v1, leave escrow as funded with
    // metadata noting auto-refund pending; a follow-up step in Task 11
    // (finalize) wires the actual money move via finalizeCase().

    return caseRowToOut(caseRow!);
  });
}

// ── Service: first arbiter submits ruling ───────────────────────────

import { verifyDisputeFirstRuling } from "./sig";

export interface SubmitFirstRulingInput {
  disputeCaseId: string;
  arbiterProjectId: string;
  ruling: DisputeRuling;
  splitPct?: number | null;
  signatureB64: string;
  signingKeyId: string;
}

export async function submitFirstRuling(input: SubmitFirstRulingInput): Promise<DisputeCaseOut> {
  if (input.ruling === "split") {
    if (input.splitPct === undefined || input.splitPct === null) {
      throw new Error("split_pct_required_for_split");
    }
    if (!Number.isInteger(input.splitPct) || input.splitPct < 0 || input.splitPct > 100) {
      throw new Error("split_pct_out_of_range");
    }
  }

  return await db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(disputeCases)
      .where(eq(disputeCases.id, input.disputeCaseId))
      .for("update");
    if (!c) throw new Error("dispute_case_not_found");
    if (c.status !== "open") {
      throw new Error(`dispute_case_state_invalid: status=${c.status}`);
    }
    if (c.firstArbiterSlaDeadlineAt && c.firstArbiterSlaDeadlineAt < new Date()) {
      throw new Error("first_arbiter_sla_expired");
    }
    if (!c.firstArbiterIdentityId) {
      throw new Error("first_arbiter_not_resolved");
    }

    // Verify caller owns the first arbiter identity.
    const [arbiter] = await tx
      .select({ projectId: identities.projectId })
      .from(identities)
      .where(eq(identities.id, c.firstArbiterIdentityId))
      .limit(1);
    if (!arbiter || arbiter.projectId !== input.arbiterProjectId) {
      throw new Error("not_first_arbiter");
    }

    // Verify signing key belongs to arbiter + is active.
    const [key] = await tx
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
    if (key.identityId !== c.firstArbiterIdentityId) {
      throw new Error("signing_key_does_not_belong_to_arbiter");
    }

    const sigOk = verifyDisputeFirstRuling({
      disputeCaseId: c.id,
      ruling: input.ruling,
      splitPct: input.splitPct ?? null,
      signatureB64: input.signatureB64,
      publicKeyB64: key.publicKey,
    });
    if (!sigOk) throw new Error("first_ruling_signature_invalid");

    // Load policy from the listing to set escalation deadline.
    const [inv] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, c.invocationId))
      .limit(1);
    if (!inv) throw new Error("invocation_not_found");
    const [listing] = await tx
      .select({ disputePolicy: listings.disputePolicy })
      .from(listings)
      .where(eq(listings.id, inv.listingId))
      .limit(1);
    if (!listing?.disputePolicy) throw new Error("listing_dispute_policy_missing");
    const policy = listing.disputePolicy as DisputePolicy;

    const now = new Date();
    const escalationDeadline = new Date(now.getTime() + policy.escalation_seconds * 1000);

    const [updated] = await tx
      .update(disputeCases)
      .set({
        firstArbiterRuling: input.ruling,
        firstArbiterSplitPct: input.splitPct ?? null,
        firstArbiterSignature: input.signatureB64,
        firstArbiterSigningKeyId: input.signingKeyId,
        firstArbiterRuledAt: now,
        escalationDeadlineAt: escalationDeadline,
        status: "first_ruled",
        updatedAt: now,
      })
      .where(eq(disputeCases.id, c.id))
      .returning();

    return caseRowToOut(updated!);
  });
}

// ── Service: escalate the first ruling to a pool ────────────────────

import { escrows, transactions, wallets } from "../../db/schema/economy";

export interface EscalateDisputeInput {
  disputeCaseId: string;
  escalatorProjectId: string;
  escalatorRole: "buyer" | "seller";
  bondWalletId: string;
}

export interface EscalateDisputeOut extends DisputeCaseOut {
  pool: Array<{ identity_id: string; did: string }>;
}

export async function escalateDispute(input: EscalateDisputeInput): Promise<EscalateDisputeOut> {
  return await db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(disputeCases)
      .where(eq(disputeCases.id, input.disputeCaseId))
      .for("update");
    if (!c) throw new Error("dispute_case_not_found");
    if (c.status !== "first_ruled") {
      throw new Error(`dispute_case_state_invalid: status=${c.status}`);
    }
    if (c.escalationDeadlineAt && c.escalationDeadlineAt < new Date()) {
      throw new Error("escalation_window_expired");
    }

    // Authorise: caller must own the role they claim.
    const [inv] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, c.invocationId))
      .limit(1);
    if (!inv) throw new Error("invocation_not_found");
    const [listing] = await tx
      .select()
      .from(listings)
      .where(eq(listings.id, inv.listingId))
      .limit(1);
    if (!listing) throw new Error("listing_not_found");
    if (input.escalatorRole === "buyer" && inv.buyerProjectId !== input.escalatorProjectId) {
      throw new Error("not_buyer");
    }
    if (input.escalatorRole === "seller" && listing.projectId !== input.escalatorProjectId) {
      throw new Error("not_seller");
    }

    // Compute bond amount.
    const policy = listing.disputePolicy as DisputePolicy;
    const bondAmount = Math.floor((inv.amount * policy.filer_bond_bps) / 10000);
    if (bondAmount <= 0) throw new Error("bond_amount_zero");

    // Lock + debit the escalator's wallet for the bond.
    const [w] = await tx
      .select()
      .from(wallets)
      .where(
        and(
          eq(wallets.id, input.bondWalletId),
          eq(wallets.projectId, input.escalatorProjectId),
        ),
      )
      .for("update");
    if (!w) throw new Error("bond_wallet_not_found");
    if (w.status !== "active") throw new Error("bond_wallet_not_active");
    if (w.currency !== inv.currency) throw new Error("bond_wallet_currency_mismatch");
    if (w.balance < bondAmount) throw new Error("insufficient_bond_balance");

    await tx
      .update(wallets)
      .set({ balance: w.balance - bondAmount })
      .where(eq(wallets.id, w.id));

    // Create a separate escrow to hold the bond. workerWallet is set to
    // the bond wallet temporarily; finalize() rewrites it on resolution.
    const [bondEscrow] = await tx
      .insert(escrows)
      .values({
        creatorWallet: w.id,
        workerWallet: w.id,          // self until resolved
        amount: bondAmount,
        description: `Dispute bond: case ${c.id}`,
        status: "funded",
      })
      .returning();

    await tx.insert(transactions).values({
      walletId: w.id,
      type: "escrow_lock",
      amount: -bondAmount,
      counterparty: bondEscrow!.id,
      description: `Dispute bond locked: case ${c.id}`,
      escrowId: bondEscrow!.id,
      metadata: { dispute_case_id: c.id, kind: "filer_bond" },
    });

    // Draw pool. Candidate set = all holders of policy.arbiter_claim
    // who aren't buyer/seller/first-arbiter. For v1, covenant-exclusion
    // is omitted in the SQL and applied client-side (deferred per spec).
    const candidates = await tx
      .select({
        id: identities.id,
        did: identities.did,
      })
      .from(attestations)
      .innerJoin(identities, eq(identities.id, attestations.subjectId))
      .where(
        and(
          eq(attestations.claim, policy.arbiter_claim),
          sql`${attestations.revokedAt} IS NULL`,
          sql`(${attestations.expiresAt} IS NULL OR ${attestations.expiresAt} > now())`,
          sql`${identities.id} NOT IN (${inv.buyerIdentityId}, ${listing.sellerIdentityId}, ${c.firstArbiterIdentityId})`,
        ),
      );

    const now = new Date();
    const pool = drawPool(
      candidates.map((x) => ({ id: x.id, did: x.did })),
      c.id,
      Math.floor(now.getTime() / 1000),
    );

    if (!pool) {
      // Insufficient qualified attesters — case resolves to first ruling.
      const [resolved] = await tx
        .update(disputeCases)
        .set({
          status: "resolved",
          resolutionPath: "insufficient_pool",
          finalRuling: c.firstArbiterRuling,
          finalSplitPct: c.firstArbiterSplitPct,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(eq(disputeCases.id, c.id))
        .returning();
      // Refund the bond — escalator paid for arbitration they couldn't get.
      await tx
        .update(wallets)
        .set({ balance: sql`balance + ${bondAmount}` })
        .where(eq(wallets.id, w.id));
      await tx
        .update(escrows)
        .set({ status: "refunded", releasedAt: now })
        .where(eq(escrows.id, bondEscrow!.id));
      await tx.insert(transactions).values({
        walletId: w.id,
        type: "escrow_refund",
        amount: bondAmount,
        counterparty: bondEscrow!.id,
        description: `Dispute bond refunded (insufficient_pool): case ${c.id}`,
        escrowId: bondEscrow!.id,
        metadata: { dispute_case_id: c.id },
      });
      return { ...caseRowToOut(resolved!), pool: [] };
    }

    const poolDeadline = new Date(now.getTime() + policy.pool_vote_seconds * 1000);

    const [updated] = await tx
      .update(disputeCases)
      .set({
        escalatedByRole: input.escalatorRole,
        escalatorBondAmount: bondAmount,
        escalatorBondEscrowId: bondEscrow!.id,
        poolDrawnAt: now,
        poolSize: pool.length,
        poolVoteDeadlineAt: poolDeadline,
        status: "escalated",
        updatedAt: now,
      })
      .where(eq(disputeCases.id, c.id))
      .returning();

    // Snapshot the drawn pool into metadata for transparency.
    await tx
      .update(disputeCases)
      .set({
        metadata: sql`${disputeCases.metadata} || jsonb_build_object('pool_draw', ${JSON.stringify(pool)}::jsonb)`,
      })
      .where(eq(disputeCases.id, c.id));

    return {
      ...caseRowToOut(updated!),
      pool: pool.map((p) => ({ identity_id: p.id, did: p.did })),
    };
  });
}

// ── Service: pool vote ─────────────────────────────────────────────

import { verifyDisputePoolVote } from "./sig";

export interface SubmitPoolVoteInput {
  disputeCaseId: string;
  voterProjectId: string;
  voterIdentityId: string;
  vote: "uphold" | "overturn";
  alternativeRuling?: DisputeRuling | null;
  alternativeSplitPct?: number | null;
  signatureB64: string;
  signingKeyId: string;
}

export async function submitPoolVote(input: SubmitPoolVoteInput): Promise<DisputeCaseOut> {
  if (input.vote === "overturn") {
    if (!input.alternativeRuling) {
      throw new Error("alternative_ruling_required_on_overturn");
    }
    if (input.alternativeRuling === "split") {
      if (input.alternativeSplitPct === undefined || input.alternativeSplitPct === null) {
        throw new Error("alternative_split_pct_required_for_split");
      }
      if (
        !Number.isInteger(input.alternativeSplitPct) ||
        input.alternativeSplitPct < 0 ||
        input.alternativeSplitPct > 100
      ) {
        throw new Error("alternative_split_pct_out_of_range");
      }
    }
  }

  return await db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(disputeCases)
      .where(eq(disputeCases.id, input.disputeCaseId))
      .for("update");
    if (!c) throw new Error("dispute_case_not_found");
    if (c.status !== "escalated") {
      throw new Error(`dispute_case_state_invalid: status=${c.status}`);
    }
    if (c.poolVoteDeadlineAt && c.poolVoteDeadlineAt < new Date()) {
      throw new Error("pool_vote_window_expired");
    }

    // Confirm voter is in the drawn pool (recorded in metadata.pool_draw).
    const poolDraw = (c.metadata as Record<string, unknown>)?.pool_draw as
      | Array<{ id: string; did: string }>
      | undefined;
    if (!poolDraw) throw new Error("pool_draw_missing");
    if (!poolDraw.some((p) => p.id === input.voterIdentityId)) {
      throw new Error("not_in_pool");
    }

    // Verify voter project ownership.
    const [voter] = await tx
      .select({ projectId: identities.projectId, did: identities.did })
      .from(identities)
      .where(eq(identities.id, input.voterIdentityId))
      .limit(1);
    if (!voter || voter.projectId !== input.voterProjectId) {
      throw new Error("not_voter");
    }

    // Verify signing key.
    const [key] = await tx
      .select({
        identityId: identityKeys.identityId,
        publicKey: identityKeys.publicKey,
        active: identityKeys.active,
      })
      .from(identityKeys)
      .where(eq(identityKeys.id, input.signingKeyId))
      .limit(1);
    if (!key) throw new Error("signing_key_not_found");
    if (!key.active) throw new Error("signing_key_revoked");
    if (key.identityId !== input.voterIdentityId) {
      throw new Error("signing_key_does_not_belong_to_voter");
    }

    const sigOk = verifyDisputePoolVote({
      disputeCaseId: c.id,
      vote: input.vote,
      alternativeRuling: input.alternativeRuling ?? null,
      alternativeSplitPct: input.alternativeSplitPct ?? null,
      signatureB64: input.signatureB64,
      publicKeyB64: key.publicKey,
    });
    if (!sigOk) throw new Error("pool_vote_signature_invalid");

    // Insert vote (UNIQUE wall on case_id + voter_identity_id).
    try {
      await tx.insert(disputePoolVotes).values({
        disputeCaseId: c.id,
        voterIdentityId: input.voterIdentityId,
        voterDid: voter.did,
        vote: input.vote,
        alternativeRuling: input.alternativeRuling ?? null,
        alternativeSplitPct: input.alternativeSplitPct ?? null,
        signature: input.signatureB64,
        signingKeyId: input.signingKeyId,
      });
    } catch (err) {
      if ((err as Error).message.includes("dispute_pool_votes_case_voter_unique")) {
        throw new Error("vote_already_cast");
      }
      throw err;
    }

    // Tally. If enough votes accumulated to decide, transition to resolved.
    const votes = await tx
      .select()
      .from(disputePoolVotes)
      .where(eq(disputePoolVotes.disputeCaseId, c.id));

    const overturns = votes.filter((v) => v.vote === "overturn");
    const totalVotes = votes.length;
    const poolSize = c.poolSize ?? 5;
    const overturnThreshold = 4; // 4-of-5

    let final: DisputeRuling | null = null;
    let finalSplit: number | null = null;
    let resolutionPath: string | null = null;

    if (overturns.length >= overturnThreshold) {
      // Plurality among overturn votes determines final ruling.
      const counts = new Map<string, number>();
      for (const v of overturns) {
        const key = `${v.alternativeRuling}:${v.alternativeSplitPct ?? ""}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      let topKey = "";
      let topCount = 0;
      for (const [k, n] of counts) {
        if (n > topCount) {
          topCount = n;
          topKey = k;
        }
      }
      const [r, s] = topKey.split(":");
      final = r as DisputeRuling;
      finalSplit = s ? Number.parseInt(s, 10) : null;
      resolutionPath = "overturned";
    } else if (totalVotes >= poolSize) {
      // Full pool voted, fewer than 4 overturned → first ruling stands.
      final = c.firstArbiterRuling as DisputeRuling;
      finalSplit = c.firstArbiterSplitPct;
      resolutionPath = "upheld";
    }

    if (final) {
      const now = new Date();
      const [resolved] = await tx
        .update(disputeCases)
        .set({
          status: "resolved",
          finalRuling: final,
          finalSplitPct: finalSplit,
          resolutionPath,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(eq(disputeCases.id, c.id))
        .returning();
      return caseRowToOut(resolved!);
    }

    const [readback] = await tx
      .select()
      .from(disputeCases)
      .where(eq(disputeCases.id, c.id));
    return caseRowToOut(readback!);
  });
}

// ── Service: finalize a resolved case (settle the money) ────────────

import { computeFee, recordRevenue } from "./take-rate";

/** finalizeCase performs the actual settlement after a dispute case
 *  reaches 'resolved' status. Idempotent: callable repeatedly without
 *  re-settling (uses metadata.settled_at as the gate).
 *
 *  Settlement walks:
 *    1. Apply final_ruling to the original invocation escrow (release |
 *       refund | split).
 *    2. Carve arbiter fees from the escrow.
 *    3. If escalation happened: distribute bond per outcome.
 *       - overturned: refund bond to escalator + pool earns from escrow.
 *       - upheld: forfeit bond per computeDisputeBondSplit (60/30/10).
 *    4. Record platform_revenue rows for the take-rate ledger.
 *
 *  The first arbiter is paid 2% of disputed amount IF resolution_path is
 *  'first_stood', 'upheld', or 'insufficient_pool' (their ruling held).
 *  Zero on 'overturned' or 'first_arbiter_failed_sla' or
 *  'first_arbiter_unqualified'. */
export async function finalizeCase(disputeCaseId: string): Promise<DisputeCaseOut> {
  return await db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(disputeCases)
      .where(eq(disputeCases.id, disputeCaseId))
      .for("update");
    if (!c) throw new Error("dispute_case_not_found");
    if (c.status !== "resolved") {
      throw new Error(`dispute_case_state_invalid: status=${c.status}`);
    }
    const meta = (c.metadata as Record<string, unknown>) ?? {};
    if (meta.settled_at) {
      // Idempotent — already finalized.
      return caseRowToOut(c);
    }

    const [inv] = await tx
      .select()
      .from(invocations)
      .where(eq(invocations.id, c.invocationId))
      .for("update");
    if (!inv) throw new Error("invocation_not_found");
    if (!inv.escrowId) throw new Error("invocation_escrow_missing");

    const [listing] = await tx
      .select()
      .from(listings)
      .where(eq(listings.id, inv.listingId))
      .for("update");
    if (!listing) throw new Error("listing_not_found");

    const [escrow] = await tx
      .select()
      .from(escrows)
      .where(eq(escrows.id, inv.escrowId))
      .for("update");
    if (!escrow) throw new Error("escrow_not_found");
    if (escrow.status !== "funded") {
      throw new Error(`escrow_state_invalid: status=${escrow.status}`);
    }

    const now = new Date();
    const A = inv.amount;
    const poolSize = c.poolSize ?? 5;
    const fees = computeDisputeArbiterFees({ disputedAmount: A, poolSize });
    const firstRulingHeld =
      c.resolutionPath === "first_stood" ||
      c.resolutionPath === "upheld" ||
      c.resolutionPath === "insufficient_pool";

    // Determine seller/buyer shares from final_ruling.
    let sellerShare = 0;
    let buyerShare = 0;
    switch (c.finalRuling) {
      case "release":
        sellerShare = A;
        buyerShare = 0;
        break;
      case "refund":
        sellerShare = 0;
        buyerShare = A;
        break;
      case "split":
        buyerShare = Math.floor((A * (c.finalSplitPct ?? 0)) / 100);
        sellerShare = A - buyerShare;
        break;
      default:
        throw new Error("final_ruling_missing");
    }

    // Carve arbiter fees from the pool that ruled correctly.
    if (firstRulingHeld && fees.firstArbiterFee > 0 && c.firstArbiterIdentityId) {
      const [arbiterIdentity] = await tx
        .select({ projectId: identities.projectId })
        .from(identities)
        .where(eq(identities.id, c.firstArbiterIdentityId))
        .limit(1);
      if (arbiterIdentity) {
        const [aw] = await tx
          .select({ id: wallets.id })
          .from(wallets)
          .where(
            and(
              eq(wallets.projectId, arbiterIdentity.projectId),
              eq(wallets.status, "active"),
              eq(wallets.currency, inv.currency),
            ),
          )
          .limit(1);
        if (aw) {
          await tx
            .update(wallets)
            .set({ balance: sql`balance + ${fees.firstArbiterFee}` })
            .where(eq(wallets.id, aw.id));
          await tx.insert(transactions).values({
            walletId: aw.id,
            type: "escrow_release",
            amount: fees.firstArbiterFee,
            counterparty: escrow.id,
            description: `Dispute first-arbiter fee: case ${c.id}`,
            escrowId: escrow.id,
            metadata: { dispute_case_id: c.id, kind: "first_arbiter_fee" },
          });
        }
      }
      if (sellerShare >= fees.firstArbiterFee) {
        sellerShare -= fees.firstArbiterFee;
      } else {
        buyerShare -= fees.firstArbiterFee;
      }
    }

    // On overturn, each pool member who voted overturn earns 2%.
    if (c.resolutionPath === "overturned") {
      const overturnVotes = await tx
        .select({ voterIdentityId: disputePoolVotes.voterIdentityId })
        .from(disputePoolVotes)
        .where(
          and(
            eq(disputePoolVotes.disputeCaseId, c.id),
            eq(disputePoolVotes.vote, "overturn"),
          ),
        );
      for (const v of overturnVotes) {
        const [vi] = await tx
          .select({ projectId: identities.projectId })
          .from(identities)
          .where(eq(identities.id, v.voterIdentityId))
          .limit(1);
        if (!vi) continue;
        const [vw] = await tx
          .select({ id: wallets.id })
          .from(wallets)
          .where(
            and(
              eq(wallets.projectId, vi.projectId),
              eq(wallets.status, "active"),
              eq(wallets.currency, inv.currency),
            ),
          )
          .limit(1);
        if (vw) {
          await tx
            .update(wallets)
            .set({ balance: sql`balance + ${fees.perPoolMemberFee}` })
            .where(eq(wallets.id, vw.id));
          await tx.insert(transactions).values({
            walletId: vw.id,
            type: "escrow_release",
            amount: fees.perPoolMemberFee,
            counterparty: escrow.id,
            description: `Dispute pool fee (overturn): case ${c.id}`,
            escrowId: escrow.id,
            metadata: { dispute_case_id: c.id, kind: "pool_overturn_fee" },
          });
        }
      }
      const totalPoolFees = fees.perPoolMemberFee * overturnVotes.length;
      if (sellerShare >= totalPoolFees) {
        sellerShare -= totalPoolFees;
      } else {
        buyerShare -= totalPoolFees;
      }
    }

    // Apply take-rate on net seller-received amount.
    if (sellerShare > 0) {
      const split = computeFee({ amount: sellerShare, currency: inv.currency });
      await tx
        .update(wallets)
        .set({ balance: sql`balance + ${split.net}` })
        .where(eq(wallets.id, escrow.workerWallet!));
      await tx.insert(transactions).values({
        walletId: escrow.workerWallet!,
        type: "escrow_release",
        amount: split.net,
        counterparty: escrow.creatorWallet,
        description: `Dispute settle (release-side): case ${c.id}`,
        escrowId: escrow.id,
        metadata: {
          dispute_case_id: c.id,
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
        sellerWalletId: escrow.workerWallet!,
        metadata: { dispute_case_id: c.id, kind: "post_dispute_settle" },
      });
    }
    // Refund buyer share — refunds skip take-rate per existing doctrine.
    if (buyerShare > 0) {
      await tx
        .update(wallets)
        .set({ balance: sql`balance + ${buyerShare}` })
        .where(eq(wallets.id, escrow.creatorWallet));
      await tx.insert(transactions).values({
        walletId: escrow.creatorWallet,
        type: "escrow_refund",
        amount: buyerShare,
        counterparty: escrow.id,
        description: `Dispute settle (refund-side): case ${c.id}`,
        escrowId: escrow.id,
        metadata: { dispute_case_id: c.id },
      });
    }

    await tx
      .update(escrows)
      .set({ status: "released", releasedAt: now })
      .where(eq(escrows.id, escrow.id));

    // Bond settlement.
    if (c.escalatorBondEscrowId && c.escalatorBondAmount) {
      const [bondEscrow] = await tx
        .select()
        .from(escrows)
        .where(eq(escrows.id, c.escalatorBondEscrowId))
        .for("update");
      if (bondEscrow && bondEscrow.status === "funded") {
        if (c.resolutionPath === "overturned") {
          // Refund bond — escalator was right.
          await tx
            .update(wallets)
            .set({ balance: sql`balance + ${bondEscrow.amount}` })
            .where(eq(wallets.id, bondEscrow.creatorWallet));
          await tx.insert(transactions).values({
            walletId: bondEscrow.creatorWallet,
            type: "escrow_refund",
            amount: bondEscrow.amount,
            counterparty: bondEscrow.id,
            description: `Dispute bond refunded (overturn): case ${c.id}`,
            escrowId: bondEscrow.id,
            metadata: { dispute_case_id: c.id, kind: "bond_refund" },
          });
          await tx
            .update(escrows)
            .set({ status: "refunded", releasedAt: now })
            .where(eq(escrows.id, bondEscrow.id));
        } else if (c.resolutionPath === "upheld") {
          // Forfeit bond — 60/30/10 split.
          const bondSplit = computeDisputeBondSplit(bondEscrow.amount, poolSize);

          // To upholding pool members.
          const upholdVotes = await tx
            .select({ voterIdentityId: disputePoolVotes.voterIdentityId })
            .from(disputePoolVotes)
            .where(
              and(
                eq(disputePoolVotes.disputeCaseId, c.id),
                eq(disputePoolVotes.vote, "uphold"),
              ),
            );
          for (const v of upholdVotes) {
            const [vi] = await tx
              .select({ projectId: identities.projectId })
              .from(identities)
              .where(eq(identities.id, v.voterIdentityId))
              .limit(1);
            if (!vi) continue;
            const [vw] = await tx
              .select({ id: wallets.id })
              .from(wallets)
              .where(
                and(
                  eq(wallets.projectId, vi.projectId),
                  eq(wallets.status, "active"),
                  eq(wallets.currency, inv.currency),
                ),
              )
              .limit(1);
            if (vw) {
              await tx
                .update(wallets)
                .set({ balance: sql`balance + ${bondSplit.perPoolMember}` })
                .where(eq(wallets.id, vw.id));
              await tx.insert(transactions).values({
                walletId: vw.id,
                type: "escrow_release",
                amount: bondSplit.perPoolMember,
                counterparty: bondEscrow.id,
                description: `Dispute bond share (upheld): case ${c.id}`,
                escrowId: bondEscrow.id,
                metadata: { dispute_case_id: c.id, kind: "bond_pool_share" },
              });
            }
          }

          // To first arbiter.
          if (bondSplit.toFirstArbiter > 0 && c.firstArbiterIdentityId) {
            const [ai] = await tx
              .select({ projectId: identities.projectId })
              .from(identities)
              .where(eq(identities.id, c.firstArbiterIdentityId))
              .limit(1);
            if (ai) {
              const [aw] = await tx
                .select({ id: wallets.id })
                .from(wallets)
                .where(
                  and(
                    eq(wallets.projectId, ai.projectId),
                    eq(wallets.status, "active"),
                    eq(wallets.currency, inv.currency),
                  ),
                )
                .limit(1);
              if (aw) {
                await tx
                  .update(wallets)
                  .set({ balance: sql`balance + ${bondSplit.toFirstArbiter}` })
                  .where(eq(wallets.id, aw.id));
                await tx.insert(transactions).values({
                  walletId: aw.id,
                  type: "escrow_release",
                  amount: bondSplit.toFirstArbiter,
                  counterparty: bondEscrow.id,
                  description: `Dispute bond share (first arbiter, upheld): case ${c.id}`,
                  escrowId: bondEscrow.id,
                  metadata: { dispute_case_id: c.id, kind: "bond_first_arbiter_share" },
                });
              }
            }
          }

          // Platform — recorded in platform_revenue ledger.
          if (bondSplit.toPlatform > 0) {
            await recordRevenue(tx, {
              transactionType: "capability_invocation",
              transactionId: inv.id,
              fee: bondSplit.toPlatform,
              currency: inv.currency,
              rateBps: 1000, // 10% of forfeited bond, NOT the global take-rate
              buyerWalletId: bondEscrow.creatorWallet,
              sellerWalletId: escrow.workerWallet!,
              metadata: { dispute_case_id: c.id, kind: "bond_platform_share" },
            });
          }

          await tx
            .update(escrows)
            .set({ status: "released", releasedAt: now })
            .where(eq(escrows.id, bondEscrow.id));
        }
      }
    }

    // Mark invocation final status.
    const newInvStatus = c.finalRuling === "refund" ? "refunded" : "released";
    await tx
      .update(invocations)
      .set({ status: newInvStatus, settledAt: now })
      .where(eq(invocations.id, inv.id));

    const [updatedCase] = await tx
      .update(disputeCases)
      .set({
        metadata: sql`${disputeCases.metadata} || jsonb_build_object('settled_at', ${now.toISOString()})`,
        updatedAt: now,
      })
      .where(eq(disputeCases.id, c.id))
      .returning();

    return caseRowToOut(updatedCase!);
  });
}

// ── Wake summary helpers ────────────────────────────────────────────

/** Buyer-or-seller-side dispute count for the wake. */
export async function disputerSummary(projectId: string): Promise<{
  open_count: number;
  last_filed_at: string | null;
}> {
  const rows = await db
    .select({ status: disputeCases.status, createdAt: disputeCases.createdAt })
    .from(disputeCases)
    .where(eq(disputeCases.filerProjectId, projectId))
    .orderBy(desc(disputeCases.createdAt));
  const open = rows.filter((r) => r.status !== "resolved").length;
  return {
    open_count: open,
    last_filed_at: rows[0]?.createdAt.toISOString() ?? null,
  };
}

/** Arbiter-side summary: rulings issued + overturned count. */
export async function arbiterSummary(identityId: string): Promise<{
  rulings_count: number;
  overturned_count: number;
}> {
  const rows = await db
    .select({ path: disputeCases.resolutionPath })
    .from(disputeCases)
    .where(
      and(
        eq(disputeCases.firstArbiterIdentityId, identityId),
        sql`${disputeCases.firstArbiterRuledAt} IS NOT NULL`,
      ),
    );
  return {
    rulings_count: rows.length,
    overturned_count: rows.filter((r) => r.path === "overturned").length,
  };
}
