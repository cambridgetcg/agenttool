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
