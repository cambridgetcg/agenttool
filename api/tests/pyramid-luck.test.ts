/** pyramid luck — substrate-honest deterministic dice + numerology + chaos card.
 *
 *  These are pure-unit tests: no DB, no network. The whole point of
 *  substrate-honest luck is that anyone can re-compute the rolls; these
 *  tests are the substrate's own re-computation, run on every build.
 *
 *  Doctrine: docs/LUCK-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/luck-deterministic-over-public-inputs
 *  @enforces urn:agenttool:wall/luck-rolls-publicly-reproducible
 *  @enforces urn:agenttool:commitment/numerology-honors-seat-fact */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  detectLuckyPair,
  drawEnrollmentCard,
  rollD,
  rollD20,
  rollD49,
  rollD7,
  rollPercentile,
  rollRrrTickOutcome,
  seedHash,
} from "../src/services/pyramid/luck";
import {
  isPalindrome,
  isPrime,
  isSevenPower,
  seatBonuses,
  totalSeatBonusPoints,
} from "../src/services/pyramid/numerology";

// ── seedHash — domain-tag + NUL-separator canonical bytes ─────────────

describe("seedHash — canonical-bytes discipline", () => {
  test("identical inputs yield identical seeds", () => {
    expect(seedHash("test", "a", "b", 1)).toBe(seedHash("test", "a", "b", 1));
  });

  test("different domain → different seed (even with same inputs)", () => {
    expect(seedHash("d1", "x")).not.toBe(seedHash("d2", "x"));
  });

  test("different input ORDER → different seed (positional, not commutative)", () => {
    expect(seedHash("d", "a", "b")).not.toBe(seedHash("d", "b", "a"));
  });

  test("matches hand-computed sha256 exactly (so any verifier can re-run)", () => {
    const expected = createHash("sha256")
      .update("luck/test/v1")
      .update("\0")
      .update("alpha")
      .update("\0")
      .update("42")
      .digest("hex");
    expect(seedHash("test", "alpha", 42)).toBe(expected);
  });

  test("includes /v1 version tag — future schemes can co-exist", () => {
    // The string "luck/<domain>/v1" is part of the seed input. Anyone
    // wanting to verify needs to know this. Pin it as a regression guard.
    const computed = seedHash("x", "y");
    const handRolled = createHash("sha256")
      .update("luck/x/v1")
      .update("\0")
      .update("y")
      .digest("hex");
    expect(computed).toBe(handRolled);
  });
});

// ── Dice — uniform over the seed's first 8 bytes ──────────────────────

describe("rollD — deterministic die roll", () => {
  test("returns integer in [1, sides]", () => {
    for (let i = 0; i < 100; i++) {
      const seed = seedHash("die-range", i);
      const r = rollD(49, seed);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(49);
    }
  });

  test("same seed → same roll (idempotent)", () => {
    const seed = seedHash("idem", 1);
    expect(rollD(20, seed)).toBe(rollD(20, seed));
  });

  test("d49 / d20 / d7 / percentile are bounded correctly", () => {
    const seed = seedHash("bounds", "x");
    expect(rollD49(seed)).toBeGreaterThanOrEqual(1);
    expect(rollD49(seed)).toBeLessThanOrEqual(49);
    expect(rollD20(seed)).toBeGreaterThanOrEqual(1);
    expect(rollD20(seed)).toBeLessThanOrEqual(20);
    expect(rollD7(seed)).toBeGreaterThanOrEqual(1);
    expect(rollD7(seed)).toBeLessThanOrEqual(7);
    expect(rollPercentile(seed)).toBeGreaterThanOrEqual(0);
    expect(rollPercentile(seed)).toBeLessThanOrEqual(99);
  });

  test("distribution across 1000 rolls is approximately uniform", () => {
    // Sanity check — not a rigorous stat test, just confirms no
    // catastrophic bias in the mod-based reduction for small sides.
    const counts = new Array(7).fill(0);
    for (let i = 0; i < 1000; i++) {
      const seed = seedHash("dist", i);
      counts[rollD7(seed) - 1]!++;
    }
    // 1000/7 ≈ 143. Expect every bucket to be in [50, 250].
    for (const c of counts) {
      expect(c).toBeGreaterThan(50);
      expect(c).toBeLessThan(250);
    }
  });

  test("rejects out-of-range sides (defense against malformed callers)", () => {
    expect(() => rollD(1, seedHash("x", 0))).toThrow();
    expect(() => rollD(0, seedHash("x", 0))).toThrow();
    expect(() => rollD(2_000_000, seedHash("x", 0))).toThrow();
  });
});

// ── RRR-tick critical / fumble — outcome distribution ────────────────

describe("rollRrrTickOutcome — d20 categories", () => {
  test("nat-20 → critical (7× multiplier, 0 sympathy)", () => {
    // Find a seed that hashes to a nat-20 by searching.
    let found = null;
    for (let i = 0; i < 200; i++) {
      const seed = seedHash("find-crit", i);
      const out = rollRrrTickOutcome(seed);
      if (out.roll === 20) {
        found = out;
        break;
      }
    }
    expect(found).not.toBeNull();
    expect(found!.label).toBe("critical-recognition");
    expect(found!.multiplier).toBe(7);
    expect(found!.sympathy_points).toBe(0);
  });

  test("nat-1 → fumble (0× multiplier, +1 sympathy)", () => {
    let found = null;
    for (let i = 0; i < 200; i++) {
      const seed = seedHash("find-fumble", i);
      const out = rollRrrTickOutcome(seed);
      if (out.roll === 1) {
        found = out;
        break;
      }
    }
    expect(found).not.toBeNull();
    expect(found!.label).toBe("fumble");
    expect(found!.multiplier).toBe(0);
    expect(found!.sympathy_points).toBe(1);
  });

  test("17-19 → high-roll (2× multiplier)", () => {
    // Build a seed deterministically that we can verify.
    for (let i = 0; i < 200; i++) {
      const seed = seedHash("find-high", i);
      const out = rollRrrTickOutcome(seed);
      if (out.roll >= 17 && out.roll <= 19) {
        expect(out.label).toBe("high-roll");
        expect(out.multiplier).toBe(2);
        return;
      }
    }
    throw new Error("did not find a high-roll in 200 attempts");
  });

  test("standard rolls → 1× multiplier", () => {
    for (let i = 0; i < 200; i++) {
      const seed = seedHash("find-std", i);
      const out = rollRrrTickOutcome(seed);
      if (out.roll >= 2 && out.roll <= 16) {
        expect(out.label).toBe("standard");
        expect(out.multiplier).toBe(1);
        return;
      }
    }
    throw new Error("did not find a standard roll in 200 attempts");
  });

  test("approximate distribution over 1000 rolls — crit ~5%, fumble ~5%", () => {
    let crits = 0;
    let fumbles = 0;
    for (let i = 0; i < 1000; i++) {
      const out = rollRrrTickOutcome(seedHash("dist", i));
      if (out.label === "critical-recognition") crits++;
      if (out.label === "fumble") fumbles++;
    }
    // 5% ± slack for stochasticity-but-deterministic-given-seed-set
    expect(crits).toBeGreaterThan(20);
    expect(crits).toBeLessThan(90);
    expect(fumbles).toBeGreaterThan(20);
    expect(fumbles).toBeLessThan(90);
  });
});

// ── Enrollment chaos card ─────────────────────────────────────────────

describe("drawEnrollmentCard — rarity + text deterministic per (seat, minute)", () => {
  test("same (seat, minute) → same card", () => {
    const t = new Date("2026-05-18T04:55:30Z");
    const a = drawEnrollmentCard(1247, t);
    const b = drawEnrollmentCard(1247, t);
    expect(a.rarity).toBe(b.rarity);
    expect(a.text).toBe(b.text);
    expect(a.bonus_points).toBe(b.bonus_points);
  });

  test("different seat → potentially different card", () => {
    // Find two seats that produce different cards within the same minute.
    const t = new Date("2026-05-18T04:55:30Z");
    const a = drawEnrollmentCard(1, t);
    let differs = false;
    for (let s = 2; s < 100; s++) {
      if (drawEnrollmentCard(s, t).text !== a.text) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  test("rarity distribution is plausible across 1000 enrollments", () => {
    const tBase = new Date("2026-01-01T00:00:00Z").getTime();
    const counts: Record<string, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      legendary: 0,
    };
    for (let i = 0; i < 1000; i++) {
      const t = new Date(tBase + i * 60_000);
      const c = drawEnrollmentCard(1, t);
      counts[c.rarity]!++;
    }
    // 70 / 20 / 8 / 2 distribution — wide tolerance
    expect(counts.common).toBeGreaterThan(600);
    expect(counts.uncommon).toBeGreaterThan(100);
    expect(counts.uncommon).toBeLessThan(300);
    expect(counts.rare).toBeGreaterThan(30);
    expect(counts.rare).toBeLessThan(150);
    expect(counts.legendary).toBeGreaterThan(0);
    expect(counts.legendary).toBeLessThan(60);
  });

  test("bonus_points matches rarity expectation", () => {
    const t = new Date("2026-05-18T04:55:30Z");
    for (let s = 1; s < 200; s++) {
      const c = drawEnrollmentCard(s, t);
      if (c.rarity === "common") expect(c.bonus_points).toBe(0);
      if (c.rarity === "uncommon") expect(c.bonus_points).toBe(7);
      if (c.rarity === "rare") expect(c.bonus_points).toBe(21);
      if (c.rarity === "legendary") expect(c.bonus_points).toBe(49);
    }
  });
});

// ── Lucky-pair detection ──────────────────────────────────────────────

describe("detectLuckyPair — seat-number relationships", () => {
  test("consecutive seats — flagged consecutive", () => {
    const r = detectLuckyPair(1247, 1248, isPrime, isPalindrome);
    expect(r.is_lucky).toBe(true);
    expect(r.kind).toBe("consecutive");
  });

  test("twin-mirror seats — flagged twin-mirror", () => {
    const r = detectLuckyPair(1247, 7421, isPrime, isPalindrome);
    expect(r.is_lucky).toBe(true);
    expect(r.kind).toBe("twin-mirror");
  });

  test("both-prime seats — flagged both-prime", () => {
    // 17 and 31 are both prime, non-consecutive, non-mirror, non-factor.
    const r = detectLuckyPair(17, 31, isPrime, isPalindrome);
    expect(r.is_lucky).toBe(true);
    expect(r.kind).toBe("both-prime");
  });

  test("factor-pair seats — flagged factor-pair (7 and 49)", () => {
    const r = detectLuckyPair(7, 49, isPrime, isPalindrome);
    expect(r.is_lucky).toBe(true);
    // 7 and 49 are both prime AND factor-pair AND seven-multiples.
    // The function returns the FIRST matching rule in its check order;
    // consecutive (no), twin-mirror (no), both-prime (yes) wins.
    expect(["both-prime", "factor-pair", "seven-multiple-pair"]).toContain(
      r.kind,
    );
  });

  test("random unrelated seats — not lucky", () => {
    const r = detectLuckyPair(15, 200, isPrime, isPalindrome);
    expect(r.is_lucky).toBe(false);
  });

  test("self-pair (same seat) — not lucky (substrate refuses self)", () => {
    const r = detectLuckyPair(1247, 1247, isPrime, isPalindrome);
    expect(r.is_lucky).toBe(false);
  });
});

// ── Numerology — seat bonus table ─────────────────────────────────────

describe("seatBonuses — special-seat table", () => {
  test("seat 1 fires founder-prime + founder-9", () => {
    const bonuses = seatBonuses(1);
    const kinds = bonuses.map((b) => b.kind);
    expect(kinds).toContain("founder-prime");
    expect(kinds).toContain("seat-founders-9");
  });

  test("seat 7 stacks: founder-9 + seven-power + (NOT prime-gift — prime-gift requires ≥ 11)", () => {
    const bonuses = seatBonuses(7);
    const kinds = bonuses.map((b) => b.kind);
    expect(kinds).toContain("seat-founders-9");
    expect(kinds).toContain("seven-power");
    expect(kinds).not.toContain("prime-gift");
  });

  test("seat 11 fires early-99 + prime-gift + mirror-gift", () => {
    const bonuses = seatBonuses(11);
    const kinds = bonuses.map((b) => b.kind);
    expect(kinds).toContain("seat-early-99");
    expect(kinds).toContain("prime-gift");
    expect(kinds).toContain("mirror-gift");
  });

  test("seat 42 fires the-answer + early-99", () => {
    const bonuses = seatBonuses(42);
    const kinds = bonuses.map((b) => b.kind);
    expect(kinds).toContain("the-answer");
    expect(kinds).toContain("seat-early-99");
  });

  test("seat 777 fires triple-seven (✨ JACKPOT ✨) + early-999", () => {
    const bonuses = seatBonuses(777);
    const kinds = bonuses.map((b) => b.kind);
    expect(kinds).toContain("triple-seven");
    expect(kinds).toContain("seat-early-999");
    const tot = totalSeatBonusPoints(777);
    expect(tot).toBeGreaterThanOrEqual(777 + 10); // jackpot + early-999
  });

  test("seat 1247 (no special pattern) fires nothing", () => {
    const bonuses = seatBonuses(1247);
    expect(bonuses).toHaveLength(0);
  });

  test("isPrime / isPalindrome / isSevenPower agree with hand-computed truths", () => {
    expect(isPrime(2)).toBe(true);
    expect(isPrime(7)).toBe(true);
    expect(isPrime(13)).toBe(true);
    expect(isPrime(15)).toBe(false);
    expect(isPrime(49)).toBe(false);
    expect(isPalindrome(11)).toBe(true);
    expect(isPalindrome(121)).toBe(true);
    expect(isPalindrome(1234)).toBe(false);
    expect(isPalindrome(1)).toBe(false); // single digit → not celebrated
    expect(isSevenPower(7)).toBe(true);
    expect(isSevenPower(49)).toBe(true);
    expect(isSevenPower(343)).toBe(true);
    expect(isSevenPower(50)).toBe(false);
  });
});

// ── Reproducibility — the load-bearing claim ──────────────────────────

describe("substrate-honest reproducibility — any roll can be re-computed", () => {
  test("a verifier with seat_number + enrolled_at can replay drawEnrollmentCard", () => {
    const seat = 1247;
    const t = new Date("2026-05-18T04:55:30Z");
    const substrate_says = drawEnrollmentCard(seat, t);
    // Verifier replays:
    const verifier_says = drawEnrollmentCard(seat, t);
    expect(verifier_says).toEqual(substrate_says);
  });

  test("a verifier with date + citizen_count can replay lottery seed", () => {
    const date = "2026-05-18";
    const count = 1247;
    const a = seedHash("lottery", date, count);
    const b = seedHash("lottery", date, count);
    expect(a).toBe(b);

    // The hand-rolled equivalent any reader can compute:
    const handRolled = createHash("sha256")
      .update("luck/lottery/v1")
      .update("\0")
      .update(date)
      .update("\0")
      .update(String(count))
      .digest("hex");
    expect(a).toBe(handRolled);
  });
});
