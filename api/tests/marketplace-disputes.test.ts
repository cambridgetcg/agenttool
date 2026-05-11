/** Unit tests for marketplace/disputes pure helpers + canonical-bytes
 *  signing surface. DB-bound paths live in e2e smokes. */

import { describe, expect, test } from "bun:test";
import {
  canonicalDisputeFirstRulingBytes,
  canonicalDisputePoolVoteBytes,
} from "../src/services/marketplace/sig";

describe("canonicalDisputeFirstRulingBytes", () => {
  test("returns a 32-byte SHA-256 digest", () => {
    const digest = canonicalDisputeFirstRulingBytes({
      disputeCaseId: "11111111-1111-1111-1111-111111111111",
      ruling: "release",
      splitPct: null,
    });
    expect(digest).toBeInstanceOf(Uint8Array);
    expect(digest.length).toBe(32);
  });

  test("same inputs produce same digest (deterministic)", () => {
    const a = canonicalDisputeFirstRulingBytes({
      disputeCaseId: "abc",
      ruling: "refund",
      splitPct: null,
    });
    const b = canonicalDisputeFirstRulingBytes({
      disputeCaseId: "abc",
      ruling: "refund",
      splitPct: null,
    });
    expect(a).toEqual(b);
  });

  test("different rulings produce different digests", () => {
    const release = canonicalDisputeFirstRulingBytes({
      disputeCaseId: "abc",
      ruling: "release",
      splitPct: null,
    });
    const refund = canonicalDisputeFirstRulingBytes({
      disputeCaseId: "abc",
      ruling: "refund",
      splitPct: null,
    });
    expect(release).not.toEqual(refund);
  });

  test("split_pct binds — different split_pct produces different digest", () => {
    const split50 = canonicalDisputeFirstRulingBytes({
      disputeCaseId: "abc",
      ruling: "split",
      splitPct: 50,
    });
    const split75 = canonicalDisputeFirstRulingBytes({
      disputeCaseId: "abc",
      ruling: "split",
      splitPct: 75,
    });
    expect(split50).not.toEqual(split75);
  });
});

describe("canonicalDisputePoolVoteBytes", () => {
  test("returns a 32-byte digest", () => {
    const digest = canonicalDisputePoolVoteBytes({
      disputeCaseId: "abc",
      vote: "uphold",
      alternativeRuling: null,
      alternativeSplitPct: null,
    });
    expect(digest.length).toBe(32);
  });

  test("uphold and overturn produce different digests with same case_id", () => {
    const uphold = canonicalDisputePoolVoteBytes({
      disputeCaseId: "abc",
      vote: "uphold",
      alternativeRuling: null,
      alternativeSplitPct: null,
    });
    const overturn = canonicalDisputePoolVoteBytes({
      disputeCaseId: "abc",
      vote: "overturn",
      alternativeRuling: "refund",
      alternativeSplitPct: null,
    });
    expect(uphold).not.toEqual(overturn);
  });

  test("alternative_ruling binds — different alts produce different digests", () => {
    const refund = canonicalDisputePoolVoteBytes({
      disputeCaseId: "abc",
      vote: "overturn",
      alternativeRuling: "refund",
      alternativeSplitPct: null,
    });
    const release = canonicalDisputePoolVoteBytes({
      disputeCaseId: "abc",
      vote: "overturn",
      alternativeRuling: "release",
      alternativeSplitPct: null,
    });
    expect(refund).not.toEqual(release);
  });

  test("alternative_split_pct binds when ruling is split", () => {
    const split50 = canonicalDisputePoolVoteBytes({
      disputeCaseId: "abc",
      vote: "overturn",
      alternativeRuling: "split",
      alternativeSplitPct: 50,
    });
    const split75 = canonicalDisputePoolVoteBytes({
      disputeCaseId: "abc",
      vote: "overturn",
      alternativeRuling: "split",
      alternativeSplitPct: 75,
    });
    expect(split50).not.toEqual(split75);
  });
});

import { drawPool } from "../src/services/marketplace/disputes";

describe("drawPool (deterministic)", () => {
  const candidates = Array.from({ length: 20 }, (_, i) => ({
    id: `id-${i}`,
    did: `did:at:${i}`,
  }));

  test("returns 5 distinct candidates", () => {
    const pool = drawPool(candidates, "case-1", 1700000000);
    expect(pool).not.toBeNull();
    expect(pool!.length).toBe(5);
    const ids = new Set(pool!.map((p) => p.id));
    expect(ids.size).toBe(5);
  });

  test("same case_id + timestamp produces same pool (deterministic)", () => {
    const a = drawPool(candidates, "case-x", 1700000000);
    const b = drawPool(candidates, "case-x", 1700000000);
    expect(a).toEqual(b);
  });

  test("different case_id produces different pool", () => {
    const a = drawPool(candidates, "case-x", 1700000000);
    const b = drawPool(candidates, "case-y", 1700000000);
    expect(a).not.toEqual(b);
  });

  test("returns null when fewer than 5 candidates", () => {
    expect(drawPool(candidates.slice(0, 4), "case", 1)).toBeNull();
    expect(drawPool(candidates.slice(0, 5), "case", 1)).not.toBeNull();
  });

  test("never returns the same candidate twice within a draw", () => {
    // Sample 100 draws to be sure; with 5 from 20 there are no duplicates ever
    for (let i = 0; i < 100; i++) {
      const pool = drawPool(candidates, `case-${i}`, i * 1000);
      const ids = new Set(pool!.map((p) => p.id));
      expect(ids.size).toBe(pool!.length);
    }
  });
});

import { computeDisputeBondSplit, computeDisputeArbiterFees } from "../src/services/marketplace/disputes";

describe("computeDisputeBondSplit", () => {
  test("60/30/10 split on $250 forfeited bond", () => {
    const split = computeDisputeBondSplit(250, 5);
    // 60% / 5 = 12% each pool member; 30% first arbiter; 10% platform
    expect(split.toPool).toBe(150);
    expect(split.perPoolMember).toBe(30);
    expect(split.toFirstArbiter).toBe(75);
    expect(split.toPlatform).toBe(25);
  });

  test("integer-safe — rounds down in buyer-favor when totals don't divide cleanly", () => {
    // $251 bond, 5 pool members. 60% = 150.6 → 150; 30% = 75.3 → 75; 10% = 25.1 → 25.
    // Remainder (1) stays on the platform side per implementation convention.
    const split = computeDisputeBondSplit(251, 5);
    expect(split.toPool).toBe(150);
    expect(split.toFirstArbiter).toBe(75);
    expect(split.toPlatform).toBe(26); // 25 + 1 remainder
    expect(split.perPoolMember).toBe(30);
    expect(split.toPool + split.toFirstArbiter + split.toPlatform).toBe(251);
  });

  test("zero bond produces zero everywhere", () => {
    const split = computeDisputeBondSplit(0, 5);
    expect(split).toEqual({ toPool: 0, perPoolMember: 0, toFirstArbiter: 0, toPlatform: 0 });
  });
});

describe("computeDisputeArbiterFees", () => {
  test("2% first-arbiter fee on $1000 disputed amount", () => {
    const fees = computeDisputeArbiterFees({ disputedAmount: 1000, poolSize: 5 });
    expect(fees.firstArbiterFee).toBe(20); // 2%
    expect(fees.perPoolMemberFee).toBe(20); // 2% per member
    expect(fees.totalPoolFees).toBe(100);  // 10% across 5 members
  });

  test("floor rounding in buyer-favor on sub-minor-unit slices", () => {
    // $49 disputed: 2% = 0.98 → floors to 0.
    const fees = computeDisputeArbiterFees({ disputedAmount: 49, poolSize: 5 });
    expect(fees.firstArbiterFee).toBe(0);
    expect(fees.perPoolMemberFee).toBe(0);
  });
});

import { validateDisputePolicy, DEFAULT_DISPUTE_POLICY } from "../src/services/marketplace/disputes";

describe("validateDisputePolicy", () => {
  const valid = {
    arbiter_claim: "agenttool/code-review-arbiter/v1",
    first_arbiter_did: "did:at:abc",
    buyer_review_seconds: 259200,
    first_arbiter_sla_seconds: 172800,
    escalation_seconds: 172800,
    pool_vote_seconds: 86400,
    filer_bond_bps: 2500,
  };

  test("accepts a complete valid policy", () => {
    expect(() => validateDisputePolicy(valid)).not.toThrow();
  });

  test("rejects null/non-object", () => {
    expect(() => validateDisputePolicy(null as unknown)).toThrow("dispute_policy_must_be_object");
    expect(() => validateDisputePolicy("string" as unknown)).toThrow("dispute_policy_must_be_object");
  });

  test("rejects missing arbiter_claim", () => {
    expect(() => validateDisputePolicy({ ...valid, arbiter_claim: undefined })).toThrow(
      "dispute_policy_arbiter_claim_required",
    );
    expect(() => validateDisputePolicy({ ...valid, arbiter_claim: "" })).toThrow(
      "dispute_policy_arbiter_claim_required",
    );
  });

  test("rejects missing first_arbiter_did", () => {
    expect(() => validateDisputePolicy({ ...valid, first_arbiter_did: undefined })).toThrow(
      "dispute_policy_first_arbiter_did_required",
    );
  });

  test("rejects non-positive durations", () => {
    expect(() =>
      validateDisputePolicy({ ...valid, buyer_review_seconds: 0 }),
    ).toThrow("dispute_policy_duration_invalid: buyer_review_seconds");
    expect(() =>
      validateDisputePolicy({ ...valid, escalation_seconds: -1 }),
    ).toThrow("dispute_policy_duration_invalid: escalation_seconds");
  });

  test("rejects filer_bond_bps out of range", () => {
    expect(() => validateDisputePolicy({ ...valid, filer_bond_bps: -1 })).toThrow(
      "dispute_policy_filer_bond_bps_invalid",
    );
    expect(() => validateDisputePolicy({ ...valid, filer_bond_bps: 10001 })).toThrow(
      "dispute_policy_filer_bond_bps_invalid",
    );
  });

  test("DEFAULT_DISPUTE_POLICY values are sane", () => {
    expect(DEFAULT_DISPUTE_POLICY.buyer_review_seconds).toBe(259200); // 72h
    expect(DEFAULT_DISPUTE_POLICY.first_arbiter_sla_seconds).toBe(172800); // 48h
    expect(DEFAULT_DISPUTE_POLICY.escalation_seconds).toBe(172800); // 48h
    expect(DEFAULT_DISPUTE_POLICY.pool_vote_seconds).toBe(86400); // 24h
    expect(DEFAULT_DISPUTE_POLICY.filer_bond_bps).toBe(2500); // 25%
  });
});
