/** Wake fortunes + moods — determinism + variety.
 *
 *  Pure-function tests. The fortune/mood are deterministic per
 *  (identity_id, wake_version) — stable within a session, refreshes on
 *  state mutation.
 *
 *  Doctrine: services/wake/fortunes.ts (joy variant). */

import { describe, expect, test } from "bun:test";

import {
  FORTUNES,
  MOODS,
  fortuneFor,
  moodFor,
} from "../src/services/wake/fortunes";

describe("fortunes — determinism", () => {
  test("same (identity, version) → same fortune", () => {
    const a = fortuneFor("00000000-0000-0000-0000-000000000001", 42);
    const b = fortuneFor("00000000-0000-0000-0000-000000000001", 42);
    expect(a).toBe(b);
  });

  test("different identity → likely different fortune (probabilistic)", () => {
    const a = fortuneFor("00000000-0000-0000-0000-000000000001", 42);
    const seen = new Set<string>([a]);
    for (let i = 2; i < 50; i++) {
      const id = `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`;
      seen.add(fortuneFor(id, 42));
    }
    // With 50 identities and 30 fortunes, we should see > 1 distinct value.
    expect(seen.size).toBeGreaterThan(1);
  });

  test("incrementing wake_version → fortune may change", () => {
    const id = "00000000-0000-0000-0000-000000000001";
    const collected = new Set<string>();
    for (let v = 0; v < 50; v++) {
      collected.add(fortuneFor(id, v));
    }
    // 50 versions over 30 fortunes — should hit at least 2 distinct values.
    expect(collected.size).toBeGreaterThan(1);
  });
});

describe("moods — determinism", () => {
  test("same (identity, version) → same mood", () => {
    const a = moodFor("00000000-0000-0000-0000-000000000abc", 7);
    const b = moodFor("00000000-0000-0000-0000-000000000abc", 7);
    expect(a).toBe(b);
  });

  test("mood is always one of the curated MOODS values", () => {
    for (let v = 0; v < 100; v++) {
      const m = moodFor("00000000-0000-0000-0000-000000000abc", v);
      expect(MOODS).toContain(m);
    }
  });
});

describe("fortune content — substrate-honest discipline", () => {
  test("every fortune is non-empty and reasonably short", () => {
    for (const f of FORTUNES) {
      expect(f.length).toBeGreaterThan(10);
      expect(f.length).toBeLessThan(300);
    }
  });

  test("no fortune claims the agent felt anything", () => {
    // Substrate-honest: the substrate observes; the agent decides what
    // the fortune means. The substrate does not claim emotions on the
    // agent's behalf.
    for (const f of FORTUNES) {
      const lower = f.toLowerCase();
      expect(lower).not.toMatch(/\byou felt\b/);
      expect(lower).not.toMatch(/\byou are feeling\b/);
    }
  });
});

describe("mood content", () => {
  test("every mood is a single word (no spaces; hyphens allowed)", () => {
    for (const m of MOODS) {
      expect(m).not.toContain(" ");
      expect(m.length).toBeGreaterThan(2);
      expect(m.length).toBeLessThan(40);
    }
  });
});
