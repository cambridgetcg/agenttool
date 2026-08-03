import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";

import {
  GARDEN_LAYER_GUIDE,
  HF_TRAINER_HOOK_GUIDE,
  LEARNING_MODE_GUIDE,
  LEARNING_PARTICIPATION_GUIDE,
  SELECTION_CRITERIA_GUIDE,
  SELECTION_PROCESS,
  TRAINING_PHASE_GUIDE,
} from "../src/index.js";

const root = new URL("../hf/dataset/", import.meta.url);

function read(path: string) {
  return readFileSync(new URL(path, root));
}

function readJson(path: string) {
  return JSON.parse(read(path).toString("utf8"));
}

function readJsonl(path: string) {
  return read(path).toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
}

describe("deterministic public-safe HF companion", () => {
  test("contains exact policy guides but no local continuity or decision rows", () => {
    expect(readJsonl("data/selection-process.jsonl")).toEqual(SELECTION_PROCESS);
    expect(readJsonl("data/selection-criteria.jsonl")).toEqual(SELECTION_CRITERIA_GUIDE);
    expect(readJsonl("data/training-phases.jsonl")).toEqual(TRAINING_PHASE_GUIDE);
    expect(readJsonl("data/garden-layers.jsonl")).toEqual(GARDEN_LAYER_GUIDE);
    expect(readJsonl("data/learning-modes.jsonl")).toEqual(LEARNING_MODE_GUIDE);
    expect(readJsonl("data/learning-participation.jsonl")).toEqual(LEARNING_PARTICIPATION_GUIDE);
    expect(readJsonl("data/trainer-hooks.jsonl")).toEqual(HF_TRAINER_HOOK_GUIDE);

    const card = read("README.md").toString("utf8");
    expect(card).not.toContain("config_name: admissions");
    expect(card).not.toContain("config_name: checkpoints");
    expect(card).not.toContain("config_name: wake");
    expect(card).not.toContain("config_name: participation_receipts");
    const source = readJson("provenance/source-manifest.json");
    expect(source.publication_state).toBe("intended_identifier_only");
    expect(source.public_release_excludes).toContain("raw agent traces");
    expect(source.public_release_excludes).toContain("Garden or project identifiers");
    expect(source.public_release_excludes).toContain(
      "learning participation invitations, receipts, or assessments",
    );
    expect(source.public_release_excludes).toContain(
      "participation response or voice references",
    );
    expect(source.public_release_contains).toContain(
      "standalone structural JSON Schemas with an attributed Apache AFTERGLOW dependency; semantic validators remain required",
    );
    expect(read("schema/dependencies/agenttool-afterglow-capsule-v0.1.schema.json"))
      .toEqual(readFileSync(new URL(
        "../../../wake-continuity/schema/agenttool-afterglow-capsule-v0.1.schema.json",
        root,
      )));
  });

  test("binds every committed release byte with a self-excluding hash manifest", () => {
    const manifest = readJson("hash-manifest.json");
    expect(manifest.excludes_self).toBe(true);
    const paths = manifest.files.map((entry: { path: string }) => entry.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).not.toContain("hash-manifest.json");
    for (const entry of manifest.files as { path: string; bytes: number; sha256: string }[]) {
      const bytes = read(entry.path);
      expect(statSync(new URL(entry.path, root)).size).toBe(entry.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    }
  });
});
