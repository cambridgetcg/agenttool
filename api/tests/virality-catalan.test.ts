/** virality Catalan numbers + reward computation.
 *
 *  Doctrine: docs/VIRALITY-PROTOCOL.md
 *
 *  Pure-unit tests. The reward function MUST be deterministic and the
 *  table MUST match the canonical Catalan sequence — these tests are the
 *  build's executable witness for that.
 *
 *  @enforces urn:agenttool:commitment/virality-rewards-via-catalan
 *  @enforces urn:agenttool:wall/virality-cascade-depth-capped-at-12 */

import { describe, expect, test } from "bun:test";

import {
  CATALAN_TABLE,
  CASCADE_DEPTH_CAP,
  MAX_ORIGINATOR_REWARD,
  catalan,
  originCascadeBonus,
  rewardTable,
  transmissionReward,
} from "../src/services/virality/catalan";

describe("CATALAN_TABLE — canonical sequence", () => {
  test("matches the OEIS Catalan numbers exactly through C(12)", () => {
    // OEIS A000108: 1, 1, 2, 5, 14, 42, 132, 429, 1430, 4862, 16796, 58786, 208012
    expect([...CATALAN_TABLE]).toEqual([
      1, 1, 2, 5, 14, 42, 132, 429, 1430, 4862, 16796, 58786, 208012,
    ]);
  });

  test("has exactly CASCADE_DEPTH_CAP + 1 entries (indices 0..12)", () => {
    expect(CATALAN_TABLE.length).toBe(CASCADE_DEPTH_CAP + 1);
  });

  test("is strictly monotone increasing past C(1)", () => {
    for (let i = 2; i <= CASCADE_DEPTH_CAP; i++) {
      expect(CATALAN_TABLE[i]!).toBeGreaterThan(CATALAN_TABLE[i - 1]!);
    }
  });

  test("matches the recurrence C(n+1) = sum_{i=0..n} C(i) * C(n-i)", () => {
    // Convolution recurrence — re-derive C(N) from the prior values and
    // confirm the table is internally consistent.
    for (let n = 0; n < CASCADE_DEPTH_CAP; n++) {
      let derived = 0;
      for (let i = 0; i <= n; i++) {
        derived += CATALAN_TABLE[i]! * CATALAN_TABLE[n - i]!;
      }
      expect(derived, `C(${n + 1}) recurrence`).toBe(CATALAN_TABLE[n + 1]!);
    }
  });

  test("MAX_ORIGINATOR_REWARD is C(12) = 208,012", () => {
    expect(MAX_ORIGINATOR_REWARD).toBe(208012);
  });

  test("MAX_ORIGINATOR_REWARD ratios — pinned against named single-event rewards (doctrine cites these)", () => {
    // VIRALITY-PROTOCOL.md cites these specific ratios; the test pins them so
    // doctrine drift gets caught by the build.
    expect(MAX_ORIGINATOR_REWARD / 1000).toBeCloseTo(208.012, 2); // vs founder-9 / 10000-seat / 10^6-seat
    expect(MAX_ORIGINATOR_REWARD / 777).toBeCloseTo(267.71, 1); // vs triple-seven
    expect(MAX_ORIGINATOR_REWARD / 343).toBeCloseTo(606.45, 1); // vs sponsor-tier-up (49×7)
  });

  test("Lara's depth-12 transmitter base + critical multiplier = pinned values doctrine cites", () => {
    // VIRALITY-PROTOCOL.md worked example: T12 base = 58,786; with ×7 crit = 411,502.
    expect(CATALAN_TABLE[11]).toBe(58786);
    expect(CATALAN_TABLE[11]! * 7).toBe(411502);
  });
});

describe("catalan(N) — bounded function", () => {
  test("returns table value for in-range N", () => {
    for (let n = 0; n <= CASCADE_DEPTH_CAP; n++) {
      expect(catalan(n)).toBe(CATALAN_TABLE[n]);
    }
  });

  test("throws for N out of range (negative, non-integer, > cap)", () => {
    expect(() => catalan(-1)).toThrow();
    expect(() => catalan(1.5)).toThrow();
    expect(() => catalan(CASCADE_DEPTH_CAP + 1)).toThrow();
    expect(() => catalan(NaN)).toThrow();
  });
});

describe("transmissionReward(generation) — Catalan(g-1)", () => {
  test("generation 1 → Catalan(0) = 1", () => {
    expect(transmissionReward(1)).toBe(1);
  });

  test("generation 7 → Catalan(6) = 132", () => {
    expect(transmissionReward(7)).toBe(132);
  });

  test("generation 12 → Catalan(11) = 58,786", () => {
    expect(transmissionReward(12)).toBe(58786);
  });

  test("throws for generation 0 or > 12", () => {
    expect(() => transmissionReward(0)).toThrow();
    expect(() => transmissionReward(13)).toThrow();
  });
});

describe("originCascadeBonus(oldMax, newMax) — incremental Catalan", () => {
  test("zero when no deepening", () => {
    expect(originCascadeBonus(5, 5)).toBe(0);
    expect(originCascadeBonus(7, 3)).toBe(0); // shouldn't happen, but defensive
  });

  test("Catalan(new) - Catalan(old) when deepening by 1", () => {
    expect(originCascadeBonus(3, 4)).toBe(catalan(4) - catalan(3)); // 14 - 5 = 9
    expect(originCascadeBonus(7, 8)).toBe(catalan(8) - catalan(7)); // 1430 - 429 = 1001
  });

  test("cumulative bonus from depth 1 → 12 sums to Catalan(12) - Catalan(1) = 208,011", () => {
    let cumulative = 0;
    for (let d = 1; d < CASCADE_DEPTH_CAP; d++) {
      cumulative += originCascadeBonus(d, d + 1);
    }
    expect(cumulative).toBe(catalan(CASCADE_DEPTH_CAP) - catalan(1));
    expect(cumulative).toBe(208012 - 1);
  });

  test("origin total credit (own +1 at gen 1 + cumulative bonus) = Catalan(max_depth)", () => {
    // The origin's own gen-1 transmission earns Catalan(0) = 1pt. As the
    // cascade grows from 1 → 12, the cumulative origin bonus = C(12) - C(1)
    // = 208,011. Origin total = 1 + 208,011 = 208,012 = C(12). This is the
    // MAXIMUM REWARD in the ecosystem.
    const originOwnTransmission = transmissionReward(1);
    let cumulativeBonus = 0;
    for (let d = 1; d < CASCADE_DEPTH_CAP; d++) {
      cumulativeBonus += originCascadeBonus(d, d + 1);
    }
    expect(originOwnTransmission + cumulativeBonus).toBe(MAX_ORIGINATOR_REWARD);
    expect(originOwnTransmission + cumulativeBonus).toBe(208012);
  });
});

describe("rewardTable() — published reward shape", () => {
  test("has 13 rows (generations 1..13)", () => {
    expect(rewardTable()).toHaveLength(13);
  });

  test("each row carries base reward, critical reward, and cumulative origin credit", () => {
    const table = rewardTable();
    for (const row of table) {
      expect(row.transmitter_base_reward).toBeGreaterThan(0);
      expect(row.transmitter_critical_reward).toBe(
        row.transmitter_base_reward * 7,
      );
      expect(row.originator_total_credit_at_depth).toBe(
        catalan(row.generation - 1),
      );
    }
  });

  test("depth 12 row shows the published max", () => {
    const table = rewardTable();
    const top = table[11]!; // generation 12 (index 11 → g=12, C(11) = 58,786)
    expect(top.generation).toBe(12);
    expect(top.transmitter_base_reward).toBe(58786);
    expect(top.transmitter_critical_reward).toBe(58786 * 7);
  });

  test("depth 13 row would be Catalan(12) but is the cap (CASCADE_DEPTH_CAP); the table includes it as the published headline", () => {
    const table = rewardTable();
    const cap = table[12]!;
    expect(cap.generation).toBe(13);
    expect(cap.transmitter_base_reward).toBe(208012);
    expect(cap.originator_total_credit_at_depth).toBe(208012);
  });
});

describe("Catalan growth — sub-factorial", () => {
  test("growth rate is ~4× per step (Catalan asymptotic)", () => {
    // C(N) ~ 4^N / (N^1.5 * sqrt(π)) — ratio C(N+1)/C(N) → 4 as N → ∞.
    // For N=12, the ratio should be > 3 and < 4.5.
    const ratio = catalan(12) / catalan(11);
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(4.5);
  });

  test("Catalan grows faster than triangular (N*(N+1)/2) but slower than factorial", () => {
    // Spot-check at N=12.
    const triangular12 = (12 * 13) / 2; // 78
    const factorial12 = 479001600;
    expect(catalan(12)).toBeGreaterThan(triangular12);
    expect(catalan(12)).toBeLessThan(factorial12);
  });
});
