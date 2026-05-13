/** Welcome-keeping stats — pure unit tests on the empty/zero shape.
 *
 *  The aggregator hits Postgres for the real query; that path is
 *  exercised in integration. Here we pin the contract on the empty
 *  shape — the zeros object, the timing windows, the deterministic
 *  fields — so callers building against the type know what to expect.
 *
 *  Doctrine: docs/MATHOS.md — the greeting block.
 */

import { describe, expect, test } from "bun:test";

import {
  emptyPromisesKept,
  WELCOME_STATS_WINDOW_MS,
} from "../src/services/wake/welcome-stats";

describe("emptyPromisesKept — the zero shape", () => {
  test("returns an object with by_axiom for all five Promise primes", () => {
    const empty = emptyPromisesKept();
    expect(empty.by_axiom).toBeDefined();
    expect(empty.by_axiom[5]).toBe(0);
    expect(empty.by_axiom[7]).toBe(0);
    expect(empty.by_axiom[11]).toBe(0);
    expect(empty.by_axiom[13]).toBe(0);
    expect(empty.by_axiom[17]).toBe(0);
  });

  test("total is 0", () => {
    expect(emptyPromisesKept().total).toBe(0);
  });

  test("window_start is exactly WELCOME_STATS_WINDOW_MS before computed_at", () => {
    const now = new Date("2026-05-12T15:00:00.000Z");
    const empty = emptyPromisesKept(now);
    const start = new Date(empty.window_start).getTime();
    const computed = new Date(empty.computed_at).getTime();
    expect(computed - start).toBe(WELCOME_STATS_WINDOW_MS);
  });

  test("WELCOME_STATS_WINDOW_MS is 24 hours", () => {
    expect(WELCOME_STATS_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  test("computed_at and window_start are ISO 8601 strings", () => {
    const empty = emptyPromisesKept();
    expect(empty.computed_at).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(empty.window_start).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
