/** memory rerank — constitutive/foundational memories are timeless.
 *
 *  Pins the fix for the recall-salience friction: a root memory ("I am ___")
 *  must NOT sink under the recency-decay floor just for being old, while
 *  episodic memory still decays. The scorer still multiplies by cosine score,
 *  so root memories surface only when relevant. Doctrine: docs/FRICTION-ROADMAP.md
 *  Tier-0 #3 · docs/MEMORY-TIERS.md. */

import { describe, expect, test } from "bun:test";

import { rerankScore } from "../src/services/memory/store";

describe("rerankScore — tier-aware recency", () => {
  const fresh = { score: 0.8, importance: 1, ageDays: 0 };
  const old = { ageDays: 365 }; // a year

  test("episodic memory decays with age", () => {
    const young = rerankScore({ ...fresh, tier: "episodic" });
    const aged = rerankScore({ ...fresh, ...old, tier: "episodic" });
    expect(aged).toBeLessThan(young);
  });

  test("constitutive + foundational memories do NOT decay (timeless)", () => {
    for (const tier of ["constitutive", "foundational"]) {
      const young = rerankScore({ ...fresh, tier });
      const aged = rerankScore({ ...fresh, ...old, tier });
      expect(aged).toBe(young); // age changes nothing
    }
  });

  test("a year-old root memory outranks a year-old episode of equal similarity+importance", () => {
    const root = rerankScore({ score: 0.7, importance: 1, ageDays: 365, tier: "constitutive" });
    const episode = rerankScore({ score: 0.7, importance: 1, ageDays: 365, tier: "episodic" });
    expect(root).toBeGreaterThan(episode);
  });

  test("still gated by cosine similarity — an irrelevant root memory scores low", () => {
    // low cosine (0.05) → low final score regardless of timelessness; it won't
    // dominate a query it isn't relevant to.
    const irrelevantRoot = rerankScore({ score: 0.05, importance: 1, ageDays: 0, tier: "constitutive" });
    const relevantEpisode = rerankScore({ score: 0.9, importance: 1, ageDays: 0, tier: "episodic" });
    expect(irrelevantRoot).toBeLessThan(relevantEpisode);
  });

  test("importance scales the score", () => {
    const lo = rerankScore({ score: 0.8, importance: 0.5, ageDays: 0, tier: "episodic" });
    const hi = rerankScore({ score: 0.8, importance: 2, ageDays: 0, tier: "episodic" });
    expect(hi).toBeGreaterThan(lo);
  });
});
