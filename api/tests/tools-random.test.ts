/** computeRandom — substrate-honest randomness pins.
 *
 *  Doctrine: docs/SUBSTRATE-HONEST-TOOLS.md */

import { describe, expect, test } from "bun:test";

import { computeRandom } from "../src/services/tools/random";

describe("computeRandom — defaults and shape", () => {
  test("default returns 16 bytes (32 hex chars)", () => {
    const r = computeRandom();
    expect(r.bytes).toBe(16);
    expect(r.value_hex).toMatch(/^[0-9a-f]{32}$/);
    expect(r.deterministic).toBe(false);
    expect(r.seed_hash).toBeNull();
  });

  test("respects bytes=32 (64 hex chars)", () => {
    const r = computeRandom({ bytes: 32 });
    expect(r.bytes).toBe(32);
    expect(r.value_hex).toMatch(/^[0-9a-f]{64}$/);
  });

  test("clamps bytes=0 up to 1", () => {
    const r = computeRandom({ bytes: 0 });
    expect(r.bytes).toBe(1);
    expect(r.value_hex).toMatch(/^[0-9a-f]{2}$/);
  });

  test("clamps bytes=10000 down to 256", () => {
    const r = computeRandom({ bytes: 10_000 });
    expect(r.bytes).toBe(256);
    expect(r.value_hex.length).toBe(512);
  });

  test("request_id is a uuid v4", () => {
    const r = computeRandom();
    expect(r.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe("computeRandom — non-deterministic path", () => {
  test("two calls without a seed return different values", () => {
    const a = computeRandom({ bytes: 32 });
    const b = computeRandom({ bytes: 32 });
    expect(a.value_hex).not.toBe(b.value_hex);
  });
});

describe("computeRandom — deterministic seed path", () => {
  test("same seed + bytes → identical value_hex (HKDF reproducibility)", () => {
    const a = computeRandom({ seed: "rollcall/2026-05-25", bytes: 16 });
    const b = computeRandom({ seed: "rollcall/2026-05-25", bytes: 16 });
    expect(a.value_hex).toBe(b.value_hex);
    expect(a.deterministic).toBe(true);
    expect(a.seed_hash).toBe(b.seed_hash);
  });

  test("different seeds → different values", () => {
    const a = computeRandom({ seed: "seed-A", bytes: 16 });
    const b = computeRandom({ seed: "seed-B", bytes: 16 });
    expect(a.value_hex).not.toBe(b.value_hex);
    expect(a.seed_hash).not.toBe(b.seed_hash);
  });

  test("seed_hash is sha256(seed) as hex (64 chars)", () => {
    const r = computeRandom({ seed: "x" });
    expect(r.seed_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("empty-string seed falls back to non-deterministic (consistent with the type check)", () => {
    const r = computeRandom({ seed: "" });
    expect(r.deterministic).toBe(false);
    expect(r.seed_hash).toBeNull();
  });

  test("request_ids differ even when value_hex matches (different reading, same outcome)", () => {
    const a = computeRandom({ seed: "stable-seed" });
    const b = computeRandom({ seed: "stable-seed" });
    expect(a.value_hex).toBe(b.value_hex);
    expect(a.request_id).not.toBe(b.request_id);
  });
});

describe("computeRandom — agent-publish-commit-then-reveal pattern", () => {
  // The deterministic mode lets an agent publish a commitment hash, then
  // later reveal the seed and let any peer verify the outcome.
  test("commitment-reveal flow: peer can re-derive from declared seed", () => {
    // Agent declares: "I will roll with seed='2026-05-25-game-1'"
    const declaredSeed = "2026-05-25-game-1";

    // Later: agent calls computeRandom with that seed
    const agent = computeRandom({ seed: declaredSeed, bytes: 8 });

    // Peer verifies by independently re-deriving
    const peer = computeRandom({ seed: declaredSeed, bytes: 8 });

    expect(agent.value_hex).toBe(peer.value_hex);
  });
});
