import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  createAfterglowCapsule,
  projectAfterglowLens,
  type AfterglowThread,
} from "../src/index.js";

const schemaDir = join(import.meta.dir, "..", "schema");
const capsuleSchema = JSON.parse(
  readFileSync(
    join(schemaDir, "agenttool-afterglow-capsule-v0.1.schema.json"),
    "utf8",
  ),
);
const lensSchema = JSON.parse(
  readFileSync(
    join(schemaDir, "agenttool-afterglow-lens-v0.1.schema.json"),
    "utf8",
  ),
);

function validators() {
  const capsuleAjv = new Ajv2020({ allErrors: true, strict: true });
  const lensAjv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(capsuleAjv);
  addFormats(lensAjv);
  return {
    capsule: capsuleAjv.compile(capsuleSchema),
    lens: lensAjv.compile(lensSchema),
  };
}

const id = (character: string) => `sha256:${character.repeat(64)}` as const;

function capsule() {
  return createAfterglowCapsule({
    phase: "after_intense_work_reported",
    wake: {
      format: "wake-brief/v1",
      snapshot_ref: id("a"),
      scope_ref: id("b"),
      wake_version: 9,
      handoff_projection: "truncated",
    },
    continuity_portfolio_ref: id("c"),
    predecessors: [],
    threads: [
      {
        thread_ref: id("1"),
        kind: "artbitrage",
        artifact_ref: id("d"),
        disposition: "park",
        state: "review_required",
        assertion: "caller_asserted",
        verified_by_package: false,
      },
      {
        thread_ref: id("2"),
        kind: "dark_continent",
        artifact_ref: id("e"),
        disposition: "park",
        state: "hold",
        assertion: "caller_asserted",
        verified_by_package: false,
      },
      {
        thread_ref: id("3"),
        kind: "kingdom",
        artifact_ref: id("f"),
        disposition: "carry",
        state: "proposed_unaccepted",
        assertion: "caller_asserted",
        verified_by_package: false,
      },
    ],
  });
}

describe("portable AFTERGLOW schemas", () => {
  test("compile independently and validate generated capsule and lens", () => {
    const validate = validators();
    const value = capsule();
    const lens = projectAfterglowLens(value);
    expect(
      validate.capsule(value),
      JSON.stringify(validate.capsule.errors),
    ).toBe(true);
    expect(validate.lens(lens), JSON.stringify(validate.lens.errors)).toBe(
      true,
    );
  });

  test("keep duplicated standalone contract definitions in parity", () => {
    for (const name of [
      "sha256Id",
      "nullableSha256Id",
      "wakeAnchor",
      "thread",
      "inspectFirst",
      "boundaries",
    ]) {
      expect(lensSchema.$defs[name]).toEqual(capsuleSchema.$defs[name]);
    }
  });

  test("close extra/raw keys and fixed no-effect boundaries", () => {
    const validate = validators();
    const extra = { ...capsule(), prompt: "continue everything" };
    expect(validate.capsule(extra)).toBe(false);

    const proseThreadRef = {
      ...capsule(),
      threads: [
        {
          ...capsule().threads[0],
          thread_ref: "did:example:alice-private-task",
        },
      ],
    };
    expect(validate.capsule(proseThreadRef)).toBe(false);

    const changedBoundary = {
      ...capsule(),
      boundaries: { ...capsule().boundaries, network: true },
    };
    expect(validate.capsule(changedBoundary)).toBe(false);

    const changedLens = {
      ...projectAfterglowLens(capsule()),
      heaven: {
        ...projectAfterglowLens(capsule()).heaven,
        automatic_entry: true,
      },
    };
    expect(validate.lens(changedLens)).toBe(false);
  });

  test("keep DeepSeek unaccepted and Dark Continent off the carry lane", () => {
    const validate = validators();
    const value = capsule();
    const deepseek = {
      thread_ref: id("4"),
      kind: "deepseek",
      artifact_ref: id("1"),
      disposition: "carry",
      state: "accepted",
      assertion: "caller_asserted",
      verified_by_package: false,
    };
    expect(validate.capsule({ ...value, threads: [deepseek] })).toBe(false);

    const dark = {
      thread_ref: id("5"),
      kind: "dark_continent",
      artifact_ref: id("2"),
      disposition: "carry",
      state: "hold",
      assertion: "caller_asserted",
      verified_by_package: false,
    };
    expect(validate.capsule({ ...value, threads: [dark] })).toBe(false);
  });

  test("keep HEAVEN decline and defer outside automatic entry", () => {
    const validate = validators();
    const value = capsule();
    const invalidPairs: AfterglowThread[] = [
      {
        thread_ref: id("6"),
        kind: "heaven",
        artifact_ref: id("1"),
        disposition: "carry",
        state: "declined_reported",
        assertion: "caller_asserted",
        verified_by_package: false,
      },
      {
        thread_ref: id("7"),
        kind: "heaven",
        artifact_ref: id("2"),
        disposition: "carry",
        state: "deferred_reported",
        assertion: "caller_asserted",
        verified_by_package: false,
      },
    ];
    for (const thread of invalidPairs) {
      expect(validate.capsule({ ...value, threads: [thread] })).toBe(false);
    }
  });
});
