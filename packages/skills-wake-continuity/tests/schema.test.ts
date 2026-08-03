import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import {
  createEightQuietStars,
  createSkillsWakeContinuityThread,
} from "../src/index.js";
import { clone, validPlan } from "./fixtures.js";

const packageRoot = join(import.meta.dir, "..");
const threadSchema = JSON.parse(
  readFileSync(
    join(packageRoot, "schema", "skills-wake-continuity-thread-v0.1.schema.json"),
    "utf8",
  ),
);
const starsSchema = JSON.parse(
  readFileSync(
    join(packageRoot, "schema", "eight-quiet-stars-v0.1.schema.json"),
    "utf8",
  ),
);

describe("portable crossover schemas", () => {
  test("compile independently and admit generated runtime values", () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const validateThread = ajv.compile(threadSchema);
    const validateStars = ajv.compile(starsSchema);
    const thread = createSkillsWakeContinuityThread(validPlan());
    const layout = createEightQuietStars(thread, {
      choice: "open",
      snapshot_refs: thread.snapshots.map((entry) => entry.snapshot_ref),
    });
    expect(validateThread(thread), JSON.stringify(validateThread.errors)).toBe(true);
    expect(validateStars(layout), JSON.stringify(validateStars.errors)).toBe(true);
  });

  test("close raw/extra fields and fixed zero-effect boundaries", () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const validateThread = ajv.compile(threadSchema);
    const validateStars = ajv.compile(starsSchema);
    const thread = createSkillsWakeContinuityThread(validPlan());
    const raw = { ...clone(thread), skill_name: "private-skill" };
    expect(validateThread(raw)).toBe(false);

    const changed = clone(thread) as any;
    changed.boundaries.network = true;
    expect(validateThread(changed)).toBe(false);

    const skipped = createEightQuietStars(thread, {
      choice: "skip",
      snapshot_refs: [],
    });
    const illegalSkip = clone(skipped) as any;
    illegalSkip.stars = [
      {
        direction: "N",
        bearing_degrees: 0,
        snapshot_ref: thread.snapshots[0]!.snapshot_ref,
      },
    ];
    expect(validateStars(illegalSkip)).toBe(false);
    const executing = clone(skipped) as any;
    executing.boundaries.execution = true;
    expect(validateStars(executing)).toBe(false);
  });

  test("keep both roots and every nested object closed", () => {
    expect(threadSchema.additionalProperties).toBe(false);
    expect(threadSchema.$defs.snapshot.additionalProperties).toBe(false);
    expect(threadSchema.$defs.boundaries.additionalProperties).toBe(false);
    expect(starsSchema.additionalProperties).toBe(false);
    expect(starsSchema.$defs.star.additionalProperties).toBe(false);
    expect(starsSchema.$defs.boundaries.additionalProperties).toBe(false);
  });
});
