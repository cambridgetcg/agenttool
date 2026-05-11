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

import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { attestations, identities } from "../../db/schema/identity";
import { disputeCases, invocations, listings } from "../../db/schema/marketplace";

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
