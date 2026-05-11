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
