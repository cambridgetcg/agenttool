import { describe, expect, test } from "bun:test";

import {
  EIGHT_QUIET_STARS_BOUNDARIES,
  createEightQuietStars,
  createSkillsWakeContinuityThread,
  validateEightQuietStars,
  validateEightQuietStarsAgainstThread,
} from "../src/index.js";
import { clone, maximumPlan, validPlan } from "./fixtures.js";

describe("Eight Quiet Stars", () => {
  test("places caller refs into deterministic compass slots without meaning", () => {
    const thread = createSkillsWakeContinuityThread(validPlan());
    const refs = thread.snapshots.map((entry) => entry.snapshot_ref).reverse();
    const layout = createEightQuietStars(thread, {
      choice: "open",
      snapshot_refs: refs,
    });
    expect(layout.stars.map((star) => star.direction)).toEqual(["N", "NE"]);
    expect(layout.stars.map((star) => star.bearing_degrees)).toEqual([0, 45]);
    expect(layout.stars.map((star) => star.snapshot_ref)).toEqual([...refs].sort());
    expect(layout.boundaries).toEqual(EIGHT_QUIET_STARS_BOUNDARIES);
    expect(layout.boundaries).toMatchObject({
      display_only: true,
      automatic_selection: false,
      rank: false,
      rarity: false,
      nen_interpretation: false,
      recommendation: false,
      automatic_heaven_entry: false,
    });
    expect(validateEightQuietStars(clone(layout))).toEqual(layout);
    expect(validateEightQuietStarsAgainstThread(layout, thread)).toEqual(layout);
  });

  test("treats skip and open-zero as distinct complete no-penalty outcomes", () => {
    const thread = createSkillsWakeContinuityThread(validPlan());
    const skipped = createEightQuietStars(thread, {
      choice: "skip",
      snapshot_refs: [],
    });
    const zero = createEightQuietStars(thread, {
      choice: "open",
      snapshot_refs: [],
    });
    expect(skipped.stars).toEqual([]);
    expect(zero.stars).toEqual([]);
    expect(skipped.layout_id).not.toBe(zero.layout_id);
    expect(skipped.boundaries.skip_complete).toBe(true);
    expect(zero.boundaries.zero_selection_complete).toBe(true);
    expect(zero.boundaries.penalty_for_skip_or_zero).toBe(false);
  });

  test("admits exactly eight verified refs and no automatic ninth", () => {
    const thread = createSkillsWakeContinuityThread(maximumPlan());
    const refs = thread.snapshots.slice(0, 8).map((entry) => entry.snapshot_ref);
    const layout = createEightQuietStars(thread, {
      choice: "open",
      snapshot_refs: [...refs].reverse(),
    });
    expect(layout.stars.map((star) => star.direction)).toEqual([
      "N", "NE", "E", "SE", "S", "SW", "W", "NW",
    ]);
    expect(() =>
      createEightQuietStars(thread, {
        choice: "open",
        snapshot_refs: thread.snapshots.slice(0, 9).map((entry) => entry.snapshot_ref),
      }),
    ).toThrow(/at most eight/i);
  });

  test("rejects duplicate, unknown, and skip-carried references", () => {
    const thread = createSkillsWakeContinuityThread(validPlan());
    const ref = thread.snapshots[0]!.snapshot_ref;
    expect(() =>
      createEightQuietStars(thread, { choice: "open", snapshot_refs: [ref, ref] }),
    ).toThrow(/duplicate/i);
    expect(() =>
      createEightQuietStars(thread, {
        choice: "open",
        snapshot_refs: ["skills/skill_snapshots/00000000-0000-4000-8000-000000000000"],
      }),
    ).toThrow(/outside the source thread/i);
    expect(() =>
      createEightQuietStars(thread, { choice: "skip", snapshot_refs: [ref] }),
    ).toThrow(/requires an empty/i);
  });

  test("binds layout IDs, compass slots, and exact source membership", () => {
    const thread = createSkillsWakeContinuityThread(validPlan());
    const layout = createEightQuietStars(thread, {
      choice: "open",
      snapshot_refs: [thread.snapshots[0]!.snapshot_ref],
    });
    const wrongDirection = clone(layout) as any;
    wrongDirection.stars[0].direction = "S";
    expect(() => validateEightQuietStars(wrongDirection)).toThrow(/compass slot/i);

    const wrongId = clone(layout) as any;
    wrongId.layout_id = `sha256:${"0".repeat(64)}`;
    expect(() => validateEightQuietStars(wrongId)).toThrow(/does not bind/i);

    const other = createSkillsWakeContinuityThread(maximumPlan());
    expect(() => validateEightQuietStarsAgainstThread(layout, other)).toThrow(
      /does not match/i,
    );
  });
});
