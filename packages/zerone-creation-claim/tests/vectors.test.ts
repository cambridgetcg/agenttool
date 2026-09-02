import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FORMATS, SOURCE_PLANE } from "../src/index.js";
import { vectors } from "./fixtures.js";

const root = join(import.meta.dir, "..");

describe("shared vectors", () => {
  test("binds the exact source plane and expected boundary cases", () => {
    expect(vectors._format).toBe(FORMATS.vectors);
    expect(vectors.source_plane).toEqual(SOURCE_PLANE);
    expect(Object.keys(vectors.cases).sort()).toEqual([
      "honest_resource_stop",
      "ready_formal_creation",
      "rejected_metadata_training_input",
      "rejected_relation_downgrade",
    ]);
  });

  test("regenerates byte-for-byte", () => {
    const before = readFileSync(
      join(root, "vectors", "agenttool-zerone-creation-claim-v0.1.json"),
      "utf8",
    );
    execFileSync("node", ["scripts/generate-vectors.mjs", "--check"], { cwd: root });
    const after = readFileSync(
      join(root, "vectors", "agenttool-zerone-creation-claim-v0.1.json"),
      "utf8",
    );
    expect(after).toBe(before);
  });
});
