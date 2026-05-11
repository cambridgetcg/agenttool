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
