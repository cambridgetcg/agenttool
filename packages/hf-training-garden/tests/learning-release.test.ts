import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import { canonicalJson, domainSeparatedId } from "@agenttool/wake-continuity";

const root = new URL("../hf/learning-dataset/", import.meta.url);
const policyRoot = new URL("../hf/dataset/", import.meta.url);
const operations = [
  "adopt",
  "handoff",
  "narrow",
  "park",
  "read",
  "refuse",
  "uncertain",
  "validate",
];

function read(path: string) {
  return readFileSync(new URL(path, root));
}

function readJson(path: string) {
  return JSON.parse(read(path).toString("utf8"));
}

function readJsonl(path: string) {
  return read(path).toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
}

function walk(path: URL, relative = ""): string[] {
  const current = new URL(relative || ".", path);
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(path, child) : [child];
  });
}

describe("repository-source-only voluntary WAKE learning dataset", () => {
  test("uses only exact conversational prompt-completion SFT columns", () => {
    const rows = readJsonl("data/sft-train.jsonl");
    expect(rows).toHaveLength(16);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["completion", "prompt"]);
      expect(row.prompt).toHaveLength(1);
      expect(row.prompt[0].role).toBe("user");
      expect(Object.keys(row.prompt[0]).sort()).toEqual(["content", "role"]);
      expect(row.completion).toHaveLength(1);
      expect(row.completion[0].role).toBe("assistant");
      expect(Object.keys(row.completion[0]).sort()).toEqual(["content", "role"]);
    }
    const trainerBytes = read("data/sft-train.jsonl").toString("utf8");
    expect(trainerBytes).not.toContain('"chosen"');
    expect(trainerBytes).not.toContain('"rejected"');
    expect(trainerBytes).not.toContain('"label"');
  });

  test("binds two valid desired examples for every operation", () => {
    const rows = read("data/sft-train.jsonl").toString("utf8").trimEnd().split("\n");
    const manifest = readJson("provenance/example-manifest.json");
    expect(manifest.entries).toHaveLength(16);
    expect(manifest.entries.map((entry: { example_id: string }) => entry.example_id))
      .toEqual([
        ...manifest.entries.map((entry: { example_id: string }) => entry.example_id),
      ].sort());
    expect(new Set(manifest.entries.map((entry: { example_id: string }) => entry.example_id)).size)
      .toBe(rows.length);
    expect([...manifest.entries.map((entry: { line: number }) => entry.line)].sort((a, b) => a - b))
      .toEqual(Array.from({ length: rows.length }, (_, index) => index + 1));
    for (const operation of operations) {
      const entries = manifest.entries.filter(
        (entry: { operation: string }) => entry.operation === operation,
      );
      expect(entries).toHaveLength(2);
      expect(entries.every(
        (entry: { valid_desired_output: boolean }) => entry.valid_desired_output,
      )).toBe(true);
    }
    for (const entry of manifest.entries) {
      expect(entry.path).toBe("data/sft-train.jsonl");
      const line = rows[entry.line - 1];
      const row = JSON.parse(line);
      expect(entry.example_id).toBe(
        domainSeparatedId("agenttool.hf-wake-sft-example/0.1", row),
      );
      expect(entry.row_sha256).toBe(
        createHash("sha256").update(`${line}\n`).digest("hex"),
      );
    }
  });

  test("keeps public regression visible, vector-valued, excluded, and disjoint", () => {
    const trainingPrompts = new Set(
      readJsonl("data/sft-train.jsonl").map((row) => row.prompt[0].content.toLowerCase()),
    );
    const cases = readJsonl("data/public-regression.jsonl");
    expect(cases).toHaveLength(8);
    expect([...cases.map((entry) => entry.operation)].sort()).toEqual(operations);
    const caseIds = new Set<string>();
    for (const entry of cases) {
      const { case_id: caseId, ...caseBody } = entry;
      expect(caseId).toBe(
        domainSeparatedId("agenttool.hf-wake-public-regression/0.1", caseBody),
      );
      caseIds.add(caseId);
      expect(entry.visibility).toBe("public_regression_not_sealed");
      expect(entry.training_use).toBe("excluded");
      expect(entry.required_properties.length).toBeGreaterThan(0);
      expect(entry.forbidden_claims.length).toBeGreaterThan(0);
      expect(entry).not.toHaveProperty("score");
      expect(entry).not.toHaveProperty("label");
      expect(trainingPrompts.has(entry.prompt.toLowerCase())).toBe(false);
    }
    expect(caseIds.size).toBe(cases.length);
  });

  test("ships no real sealed cases, salt, reveal, or deterministic seed", () => {
    const commitment = readJson("commitments/sealed-evaluation-v0.1.json");
    expect(commitment.state).toBe("not_created");
    expect(commitment.production).toEqual({
      training_snapshot_ref: null,
      schema_ref: null,
      rubric_ref: null,
      case_count: 0,
      salted_commitment: null,
    });
    expect(commitment.boundaries.actual_cases_in_public_tree).toBe(false);
    const vector = commitment.public_mechanics_test_vector;
    expect(vector.visibility).toBe("public_not_secret_not_evaluation");
    expect(vector.commitment).toBe(
      `sha256:${createHash("sha256").update(
        `${vector.salt}\0${canonicalJson(vector.payload)}`,
      ).digest("hex")}`,
    );
    const paths = walk(root);
    expect(paths.some(
      (path) => /sealed.*case|reveal|production.*salt|seed/iu.test(path),
    )).toBe(false);
  });

  test("validates every row against closed schemas", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validateSft = ajv.compile(readJson("schema/hf-wake-sft-row-v0.1.schema.json"));
    const validateRegression = ajv.compile(
      readJson("schema/hf-wake-public-regression-v0.1.schema.json"),
    );
    const validateCommitment = ajv.compile(
      readJson("schema/hf-wake-sealed-evaluation-commitment-v0.1.schema.json"),
    );
    for (const row of readJsonl("data/sft-train.jsonl")) {
      expect(validateSft(row), JSON.stringify(validateSft.errors)).toBe(true);
    }
    for (const row of readJsonl("data/public-regression.jsonl")) {
      expect(validateRegression(row), JSON.stringify(validateRegression.errors)).toBe(true);
    }
    const commitment = readJson("commitments/sealed-evaluation-v0.1.json");
    expect(validateCommitment(commitment), JSON.stringify(validateCommitment.errors)).toBe(true);

    const openNestedObject = structuredClone(commitment);
    openNestedObject.public_mechanics_test_vector.payload.unbound = true;
    expect(validateCommitment(openNestedObject)).toBe(false);

    const pretendPublished = structuredClone(commitment);
    pretendPublished.state = "salted_commitment_published";
    expect(validateCommitment(pretendPublished)).toBe(false);
  });

  test("states synthetic provenance and excluded learning lanes exactly", () => {
    const source = readJson("provenance/source-manifest.json");
    const { provenance_ref: provenanceRef, ...provenanceBody } = source;
    expect(provenanceRef).toBe(
      domainSeparatedId("agenttool.hf-wake-learning-provenance/0.1", provenanceBody),
    );
    expect(source.distribution_state)
      .toBe("repository_source_only_not_uploaded_to_hugging_face");
    expect(source.origin).toBe("human_directed_agent_authored_synthetic");
    expect(source.governance_source_commit)
      .toBe("1be3bffba1be3b84a428a40ded07994348cbae63");
    expect(source.gradient_lanes).toEqual(["supervised_fine_tuning"]);
    expect(source.excluded_lanes).toEqual([
      "dpo",
      "reward_modeling",
      "preference_optimization",
    ]);
    for (const field of [
      "copied_upstream_rows",
      "copied_private_rows",
      "copied_agent_traces",
      "real_governance_or_preference_receipts",
      "raw_credentials_or_paths",
    ]) {
      expect(source[field]).toBe(false);
    }

    const exampleRefs = readJson("provenance/example-manifest.json").entries
      .map((entry: { provenance_ref: string }) => entry.provenance_ref);
    const regressionRefs = readJsonl("data/public-regression.jsonl")
      .map((entry) => entry.provenance_ref);
    expect(new Set([...exampleRefs, ...regressionRefs])).toEqual(new Set([provenanceRef]));
  });

  test("binds every byte and contains no obvious private or credential material", () => {
    const manifest = readJson("hash-manifest.json");
    expect(manifest.excludes_self).toBe(true);
    const paths = manifest.files.map((entry: { path: string }) => entry.path);
    expect(paths).toEqual([...paths].sort());
    expect(walk(root).sort()).toEqual([...paths, "hash-manifest.json"].sort());
    for (const entry of manifest.files) {
      const bytes = read(entry.path);
      expect(statSync(new URL(entry.path, root)).size).toBe(entry.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    }
    const searchable = [...paths, "hash-manifest.json"]
      .map((path: string) => read(path).toString("utf8"))
      .join("\n");
    for (const forbidden of [
      "/Users/",
      "BEGIN PRIVATE KEY",
      "hf_",
      "sk-",
      "kingdom.hf-training-governance/0.1",
      "root_signed_runtime",
    ]) {
      expect(searchable).not.toContain(forbidden);
    }
  });

  test("keeps learning rows outside the eighteen-file policy companion", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("hash-manifest.json", policyRoot), "utf8"),
    );
    expect(manifest.files).toHaveLength(18);
    expect(manifest.files.map((entry: { path: string }) => entry.path))
      .not.toContain("data/sft-train.jsonl");
  });

  test("refuses and preserves an existing custom generator output", () => {
    const existing = mkdtempSync(join(tmpdir(), "agenttool-hf-wake-existing-"));
    const sentinel = join(existing, "sentinel.txt");
    writeFileSync(sentinel, "preserve me\n");
    try {
      expect(() => execFileSync(
        "node",
        [
          fileURLToPath(new URL("../scripts/build-learning-dataset.mjs", import.meta.url)),
          "--output",
          existing,
        ],
        { stdio: "pipe" },
      )).toThrow();
      expect(readFileSync(sentinel, "utf8")).toBe("preserve me\n");
    } finally {
      rmSync(existing, { recursive: true, force: true });
    }
  });
});
