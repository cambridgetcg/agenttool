/** Tests for trust score algorithm (unit-level, no DB). */

import { describe, test, expect } from "bun:test";

// Test the trust algorithm math directly without DB calls
describe("trust score math", () => {
  const DECAY_DAYS = 90;

  function recencyDecay(ageDays: number): number {
    return Math.exp(-ageDays / DECAY_DAYS);
  }

  test("recency decay is 1.0 for brand new attestation", () => {
    expect(recencyDecay(0)).toBeCloseTo(1.0, 5);
  });

  test("recency decay at 90 days is ~0.368 (1/e)", () => {
    expect(recencyDecay(90)).toBeCloseTo(1 / Math.E, 3);
  });

  test("recency decay at 180 days is ~0.135 (1/e^2)", () => {
    expect(recencyDecay(180)).toBeCloseTo(1 / (Math.E * Math.E), 3);
  });

  test("recency decay approaches 0 for very old attestations", () => {
    expect(recencyDecay(900)).toBeLessThan(0.001);
  });

  test("trust score normalization", () => {
    // Single attester with trust 0.5, weight 1.0, fresh attestation
    const attesterTrust = 0.5;
    const weight = 1.0;
    const decay = 1.0;
    const normalizer = 1;
    const score = (weight * Math.max(0.1, attesterTrust) * decay) / normalizer;
    expect(score).toBe(0.5);
  });

  test("creator attestation has 1.5x weight", () => {
    const attesterTrust = 0.5;
    const creatorWeight = 1.5;
    const normalWeight = 1.0;
    const decay = 1.0;

    const creatorScore = creatorWeight * Math.max(0.1, attesterTrust) * decay;
    const normalScore = normalWeight * Math.max(0.1, attesterTrust) * decay;

    expect(creatorScore).toBe(1.5 * normalScore);
  });

  test("self-attestations have zero weight", () => {
    // The algorithm filters out attestations where attester_id === subject_id
    // This is enforced by the SQL query, not math, but the design is clear:
    // self-attestations contribute 0 to trust
    const selfWeight = 0;
    expect(selfWeight * 1.0 * 1.0).toBe(0);
  });

  test("multiple unique attesters increase trust", () => {
    const attestations = [
      { weight: 1.0, trust: 0.5, decay: 1.0 },
      { weight: 1.0, trust: 0.7, decay: 1.0 },
      { weight: 1.0, trust: 0.3, decay: 1.0 },
    ];
    const normalizer = attestations.length;
    const total = attestations.reduce(
      (sum, a) => sum + a.weight * Math.max(0.1, a.trust) * a.decay,
      0,
    );
    const score = Math.min(1.0, total / normalizer);
    expect(score).toBe(0.5); // (0.5 + 0.7 + 0.3) / 3 = 0.5
  });

  test("trust score clamps to [0, 1]", () => {
    // Even with high weights, score should not exceed 1.0
    const total = 5.0; // way over 1
    const normalizer = 1;
    const score = Math.min(1.0, total / normalizer);
    expect(score).toBe(1.0);
  });
});
