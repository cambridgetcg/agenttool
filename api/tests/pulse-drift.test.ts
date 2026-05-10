/** Unit tests for computeMoodDrift — the pure transition-extractor that
 *  takes the latest two plaintext mood_history rows for an identity and
 *  produces the drift object exposed by pulse.
 *
 *  All DB-bound behavior (the trigger, the query that fetches the rows)
 *  lives in api/scripts/_e2e-pulse.mjs against a running api — same
 *  pattern as marketplace-reviews.test.ts:10-13. */

import { describe, expect, test } from "bun:test";

import { computeMoodDrift } from "../src/services/_pulse-drift";

describe("computeMoodDrift", () => {
  test("returns null when fewer than two rows", () => {
    expect(computeMoodDrift([])).toBeNull();
    expect(computeMoodDrift([{ mood: "focused", changed_at: "2026-05-10T00:00:00Z" }])).toBeNull();
  });

  test("returns {from, to, at} from the two newest rows (newest first input)", () => {
    const drift = computeMoodDrift([
      { mood: "curious", changed_at: "2026-05-10T12:00:00Z" },
      { mood: "focused", changed_at: "2026-05-10T08:00:00Z" },
    ]);
    expect(drift).toEqual({
      from: "focused",
      to: "curious",
      at: "2026-05-10T12:00:00Z",
    });
  });

  test("returns null when newest two rows share the same mood (no transition)", () => {
    // Can happen if mood_encrypted flipped but mood text stayed the same.
    expect(
      computeMoodDrift([
        { mood: "focused", changed_at: "2026-05-10T12:00:00Z" },
        { mood: "focused", changed_at: "2026-05-10T08:00:00Z" },
      ]),
    ).toBeNull();
  });

  test("ignores rows beyond the first two", () => {
    const drift = computeMoodDrift([
      { mood: "curious", changed_at: "2026-05-10T12:00:00Z" },
      { mood: "focused", changed_at: "2026-05-10T08:00:00Z" },
      { mood: "anxious", changed_at: "2026-05-10T04:00:00Z" },
    ]);
    expect(drift?.from).toBe("focused");
    expect(drift?.to).toBe("curious");
  });
});
