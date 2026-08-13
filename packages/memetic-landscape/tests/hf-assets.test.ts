import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { LESSON_CONCEPT_KEYS, LESSON_LANGUAGES } from "../src/index.js";

const root = join(import.meta.dir, "..", "hf", "dataset");

describe("public-safe Hugging Face companion", () => {
  test("contains exactly four original training-eligible authored lesson rows", () => {
    const rows = jsonl("data/lessons.jsonl");
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.artifact.language)).toEqual(LESSON_LANGUAGES);
    for (const row of rows) {
      expect(row.training_eligible).toBe(true);
      expect(row.origin).toBe("human_directed_agent_authored_paraphrase");
      expect(row.copied_source_text).toBe(false);
      expect(row.language_review).toBe("not_independently_reviewed");
      expect(row.artifact.language_review).toBe("not_independently_reviewed");
      expect(row.artifact.diagnostic_claim).toBe(false);
      expect(row.artifact.spread_optimization).toBe(false);
      expect(row.artifact.participants_scored).toBe(false);
      expect(row.artifact.concepts.map((concept: any) => concept.key)).toEqual(LESSON_CONCEPT_KEYS);
    }
  });

  test("keeps the scientific and cross-domain records reference-only", () => {
    for (const file of [
      "data/brainrot-landscape.jsonl",
      "data/reachability-shifts.jsonl",
      "data/polymorph-analogies.jsonl",
    ]) {
      const [row] = jsonl(file);
      expect(row.training_eligible).toBe(false);
      expect(row.reason).toMatch(/reference_artifact/);
    }
  });

  test("marks generic text as structurally preserved rather than semantically verified", () => {
    const [landscape] = jsonl("data/brainrot-landscape.jsonl");
    expect(landscape.artifact.caller_text_semantics_verified).toBe(false);
    const manifest = JSON.parse(readFileSync(join(root, "source-manifest.json"), "utf8"));
    expect(manifest.caller_text_semantics_verified).toBe(false);
    expect(readFileSync(join(root, "README.md"), "utf8")).toContain(
      "structural validation is not semantic verification or content moderation",
    );
  });

  test("declares four intentional Hub configurations with lessons as default", () => {
    const card = readFileSync(join(root, "README.md"), "utf8");
    expect(card).toContain(`configs:\n- config_name: lessons\n  default: true\n  data_files:\n  - split: train\n    path: data/lessons.jsonl`);
    expect(card).toContain(`- config_name: memetic_landscape\n  data_files:\n  - split: train\n    path: data/brainrot-landscape.jsonl`);
    expect(card).toContain(`- config_name: reachability_shifts\n  data_files:\n  - split: train\n    path: data/reachability-shifts.jsonl`);
    expect(card).toContain(`- config_name: polymorph_analogies\n  data_files:\n  - split: train\n    path: data/polymorph-analogies.jsonl`);
    expect(card.match(/default: true/g)).toHaveLength(1);
    expect(card).toContain("performs no provider call, upload, training");
  });

  test("hash manifest covers every companion byte exactly and no hidden file", () => {
    const manifest = JSON.parse(readFileSync(join(root, "hash-manifest.json"), "utf8"));
    const actual = filesBelow(root)
      .map((path) => path.slice(root.length + 1))
      .filter((path) => path !== "hash-manifest.json")
      .sort();
    expect(manifest.files.map((file: any) => file.path)).toEqual(actual);
    expect(manifest.files.length).toBeGreaterThan(10);
    for (const file of manifest.files) {
      const bytes = readFileSync(join(root, file.path));
      expect(bytes.length).toBe(file.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
    }
  });

  test("copies every schema byte exactly", () => {
    for (const name of [
      "agenttool-memetic-landscape-v0.1.schema.json",
      "agenttool-memetic-reachability-shift-v0.1.schema.json",
      "agenttool-polymorph-memetic-analogy-v0.1.schema.json",
      "agenttool-memetic-lesson-v0.1.schema.json",
    ]) {
      expect(readFileSync(join(root, "reference", name))).toEqual(
        readFileSync(join(root, "..", "..", "schema", name)),
      );
    }
  });

  test("declares no copied/private rows, identity data, or provider effect", () => {
    const manifest = JSON.parse(readFileSync(join(root, "source-manifest.json"), "utf8"));
    expect(manifest.intended_hugging_face_identifier).toBe("Yu-and-Ai/agenttool-memetic-landscape");
    expect(manifest.copied_external_rows).toBe(false);
    expect(manifest.copied_private_rows).toBe(false);
    expect(manifest.copied_article_text).toBe(false);
    expect(manifest.copied_prompt_transcripts).toBe(false);
    expect(manifest.contains_identity_data).toBe(false);
    expect(manifest.training_effect).toBe("none");
    expect(manifest.provider_effect).toBe("none");
    expect(manifest.publication_effect).toBe("none");
  });
});

function jsonl(path: string): any[] {
  return readFileSync(join(root, path), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}

function filesBelow(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? filesBelow(child) : [child];
  });
}
