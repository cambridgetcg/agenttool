import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { LESSON_CONCEPT_KEYS, LESSON_LANGUAGES } from "../src/index.js";

const root = join(import.meta.dir, "..", "hf", "dataset");

describe("public-safe Hugging Face companion", () => {
  test("contains exactly four original training-eligible lesson rows", () => {
    const rows = jsonl("data/lessons.jsonl");
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.artifact.language)).toEqual(LESSON_LANGUAGES);
    for (const row of rows) {
      expect(row.training_eligible).toBe(true);
      expect(row.origin).toBe("human_directed_agent_authored_paraphrase");
      expect(row.copied_source_text).toBe(false);
      expect(row.artifact.concepts.map((concept: any) => concept.key)).toEqual(LESSON_CONCEPT_KEYS);
    }
  });

  test("keeps scientific graph records reference-only", () => {
    for (const file of ["data/ritonavir-landscape.jsonl", "data/reachability-shifts.jsonl"]) {
      const [row] = jsonl(file);
      expect(row.training_eligible).toBe(false);
      expect(row.reason).toContain("source_bounded_scientific_claims");
    }
  });

  test("contains no folklore assertions in machine teaching rows", () => {
    const teaching = readFileSync(join(root, "data", "lessons.jsonl"), "utf8");
    for (const phrase of [
      "inevitable everywhere", "morphic resonance", "globally isolated", "only Form II",
      "stopped working", "structurally unrecoverable", "$250M", "lab coats",
    ]) expect(teaching).not.toContain(phrase);
  });

  test("hash manifest covers every listed byte exactly", () => {
    const manifest = JSON.parse(readFileSync(join(root, "hash-manifest.json"), "utf8"));
    expect(manifest.files.length).toBeGreaterThan(8);
    for (const file of manifest.files) {
      const bytes = readFileSync(join(root, file.path));
      expect(bytes.length).toBe(file.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
    }
  });

  test("declares no copied article or private rows and no training effect", () => {
    const manifest = JSON.parse(readFileSync(join(root, "source-manifest.json"), "utf8"));
    expect(manifest.copied_external_rows).toBe(false);
    expect(manifest.copied_private_rows).toBe(false);
    expect(manifest.article_text_copied).toBe(false);
    expect(manifest.training_effect).toBe("none");
    expect(manifest.provider_effect).toBe("none");
  });
});

function jsonl(path: string): any[] {
  return readFileSync(join(root, path), "utf8").trim().split("\n").map((line) => JSON.parse(line));
}
