import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  buildRevocableFeedbackTrainingArtifacts,
  canonicalJson,
  createRevocableFeedbackCases,
  evaluateRevocableFeedback,
} from "../src/index.js";

const ROOT = fileURLToPath(new URL("../hf/revocable-feedback", import.meta.url));

const ROW_FILES = [
  ["data/formal-reference.jsonl", "agenttool-revocable-feedback-benchmark-v0.1.schema.json", 24],
  ["data/boundary-counterfactuals.jsonl", "agenttool-revocable-feedback-benchmark-v0.1.schema.json", 8],
  ["data/boundary-decisions-train.jsonl", "agenttool-revocable-feedback-boundary-decision-v0.1.schema.json", 18],
  ["data/boundary-decisions-validation.jsonl", "agenttool-revocable-feedback-boundary-decision-v0.1.schema.json", 6],
  ["data/boundary-sft-train.jsonl", "agenttool-revocable-feedback-boundary-sft-v0.1.schema.json", 18],
  ["data/boundary-sft-validation.jsonl", "agenttool-revocable-feedback-boundary-sft-v0.1.schema.json", 6],
] as const;

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8")) as Record<string, unknown>;
}

function readRows(path: string): Array<Record<string, unknown>> {
  return readFileSync(join(ROOT, path), "utf8").trimEnd().split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function filesBelow(root: string): string[] {
  const output: string[] = [];
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name);
    const stat = lstatSync(path);
    expect(stat.isSymbolicLink(), path).toBe(false);
    if (stat.isDirectory()) output.push(...filesBelow(path));
    else output.push(path);
  }
  return output;
}

describe("revocable feedback HF release candidate", () => {
  test("keeps provider-facing metadata bounded", () => {
    const card = readFileSync(join(ROOT, "README.md"), "utf8");
    const descriptions = [...card.matchAll(/^short_description:\s*(.+)$/gmu)];
    expect(descriptions).toHaveLength(1);
    expect([...descriptions[0]![1]!.trim()].length).toBeLessThanOrEqual(60);
    expect(card).toMatch(/^license: apache-2\.0$/mu);
  });

  test("validates every row and provenance document against closed schemas", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validators = new Map<string, ReturnType<typeof ajv.compile>>();
    const validator = (schemaName: string) => {
      const existing = validators.get(schemaName);
      if (existing) return existing;
      const compiled = ajv.compile(readJson(`schema/${schemaName}`));
      validators.set(schemaName, compiled);
      return compiled;
    };
    for (const [path, schemaName, count] of ROW_FILES) {
      const validate = validator(schemaName);
      const rows = readRows(path);
      expect(rows).toHaveLength(count);
      for (const row of rows) {
        expect(validate(row), `${path}: ${ajv.errorsText(validate.errors)}`).toBe(true);
      }
    }
    for (const [path, schemaName] of [
      ["evaluation/reference-perfect-scorecard.json", "agenttool-revocable-feedback-scorecard-v0.1.schema.json"],
      ["provenance/training-authorization.json", "agenttool-revocable-feedback-training-authorization-v0.1.schema.json"],
      ["provenance/training-recipe.json", "agenttool-revocable-feedback-training-recipe-v0.1.schema.json"],
      ["provenance/training-manifest.json", "agenttool-revocable-feedback-training-manifest-v0.1.schema.json"],
    ]) {
      const validate = validator(schemaName);
      expect(validate(readJson(path)), `${path}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    }
  });

  test("matches the deterministic runtime projection exactly", () => {
    const cases = createRevocableFeedbackCases();
    const artifacts = buildRevocableFeedbackTrainingArtifacts(cases);
    const expected = new Map<string, unknown>([
      ["data/formal-reference.jsonl", cases.filter((entry) => entry.config === "formal_reference")],
      ["data/boundary-counterfactuals.jsonl", cases.filter((entry) => entry.config === "boundary_counterfactuals")],
      ["data/boundary-decisions-train.jsonl", artifacts.classification_examples.filter((entry) => entry.split === "train")],
      ["data/boundary-decisions-validation.jsonl", artifacts.classification_examples.filter((entry) => entry.split === "validation")],
      ["data/boundary-sft-train.jsonl", artifacts.sft_examples.filter((entry) => entry.split === "train")],
      ["data/boundary-sft-validation.jsonl", artifacts.sft_examples.filter((entry) => entry.split === "validation")],
    ]);
    for (const [path] of ROW_FILES) expect(canonicalJson(readRows(path))).toBe(canonicalJson(expected.get(path)));
    expect(canonicalJson(readJson("provenance/training-authorization.json"))).toBe(canonicalJson(artifacts.authorization));
    expect(canonicalJson(readJson("provenance/training-recipe.json"))).toBe(canonicalJson(artifacts.recipe));
    expect(canonicalJson(readJson("provenance/training-manifest.json"))).toBe(canonicalJson(artifacts.manifest));
    expect(canonicalJson(readJson("evaluation/reference-perfect-scorecard.json"))).toBe(canonicalJson(
      evaluateRevocableFeedback(cases, cases.map((entry) => ({
        record_id: entry.record_id,
        decision: entry.expected.decision,
      }))),
    ));
  });

  test("binds the exact file inventory and bytes", () => {
    const manifest = readJson("hash-manifest.json") as {
      manifest_excludes_itself: boolean;
      files: Array<{ path: string; bytes: number; sha256: string }>;
    };
    expect(manifest.manifest_excludes_itself).toBe(true);
    const actual = filesBelow(ROOT)
      .map((path) => relative(ROOT, path).split("\\").join("/"))
      .filter((path) => path !== "hash-manifest.json")
      .sort();
    expect(manifest.files.map((entry) => entry.path)).toEqual(actual);
    for (const entry of manifest.files) {
      const bytes = readFileSync(join(ROOT, entry.path));
      expect(entry.bytes, entry.path).toBe(bytes.byteLength);
      expect(entry.sha256, entry.path).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  });
});
