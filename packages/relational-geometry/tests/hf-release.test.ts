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

import {
  domainSeparatedId,
  validateRelationalComplex,
  validateRelationalLensAgainstComplex,
} from "../src/index.js";

const root = new URL("../hf/dataset/", import.meta.url);
const packageRoot = new URL("../", import.meta.url);
const generator = fileURLToPath(new URL("../scripts/build-hf-release.mjs", import.meta.url));

function read(path: string): Buffer {
  return readFileSync(new URL(path, root));
}

function readJson(path: string): any {
  return JSON.parse(read(path).toString("utf8"));
}

function readJsonl(path: string): any[] {
  return read(path).toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
}

function walk(path: URL | string, relative = ""): string[] {
  const current = typeof path === "string"
    ? join(path, relative)
    : new URL(relative || ".", path);
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(path, child) : [child];
  });
}

function assertClosedObjects(schema: any): void {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object" || schema.properties) {
    expect(schema.additionalProperties).toBe(false);
  }
  for (const value of Object.values(schema)) assertClosedObjects(value);
}

function objectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) objectKeys(entry, keys);
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      keys.push(key);
      objectKeys(entry, keys);
    }
  }
  return keys;
}

describe("deterministic public-safe Hugging Face relational geometry companion", () => {
  test("validates exact structural examples against both the schema and the core", () => {
    const rows = readJsonl("data/structural-examples.jsonl");
    expect(rows).toHaveLength(8);
    const schema = readJson("schema/relational-geometry-structural-v0.1.schema.json");
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    const scenarios = new Set<string>();
    const dispositions = new Set<string>();

    for (const row of rows) {
      expect(validate(row), JSON.stringify(validate.errors)).toBe(true);
      const { example_id: exampleId, ...body } = row;
      expect(exampleId).toBe(domainSeparatedId(
        "agenttool.relational-geometry-structural-example/0.1",
        body,
      ));
      const complex = validateRelationalComplex(row.complex);
      expect(complex.principalities).toHaveLength(row.expected_principality_count);
      expect(row.origin).toBe("synthetic");
      scenarios.add(row.scenario);

      if (row.lens === null) {
        expect(row.expected_lens_selection_count).toBe(0);
      } else {
        const lens = validateRelationalLensAgainstComplex(row.lens, complex);
        expect(lens.selections).toHaveLength(row.expected_lens_selection_count);
        for (const selection of lens.selections) dispositions.add(selection.disposition);
      }

      for (const kind of row.boundary_focus) {
        expect(complex.witnesses.some((witness) => witness.kind === kind)).toBe(true);
      }
    }

    expect(scenarios).toEqual(new Set([
      "empty_is_complete",
      "understanding_only_is_complete",
      "recognition_only_is_complete",
      "boundary_only_remains_visible",
      "reversed_poles_do_not_compose",
      "same_pair_derives_and_carries_boundaries",
      "park_one_leave_one_unprojected",
      "reverse_pairs_remain_distinct",
    ]));
    expect(dispositions).toEqual(new Set(["carry", "park", "release", "withdraw"]));

    const reversed = rows.find((row) => row.scenario === "reversed_poles_do_not_compose");
    expect(reversed.complex.principalities).toEqual([]);
    const distinct = rows.find((row) => row.scenario === "reverse_pairs_remain_distinct");
    expect(new Set(distinct.complex.principalities.map(
      (cell: any) => `${cell.from_ref}->${cell.to_ref}`,
    )).size).toBe(2);
  });

  test("keeps SFT rows conversational, synthetic, and preference-free", () => {
    const rows = readJsonl("data/sft-train.jsonl");
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
      readJson("schema/relational-geometry-sft-v0.1.schema.json"),
    );
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(validate(row), JSON.stringify(validate.errors)).toBe(true);
      expect(Object.keys(row).sort()).toEqual(["completion", "prompt"]);
      expect(row.prompt).toHaveLength(1);
      expect(row.prompt[0].role).toBe("user");
      expect(Object.keys(row.prompt[0]).sort()).toEqual(["content", "role"]);
      expect(row.completion).toHaveLength(1);
      expect(row.completion[0].role).toBe("assistant");
      expect(Object.keys(row.completion[0]).sort()).toEqual(["content", "role"]);
    }
    const keys = objectKeys(rows).map((key) => key.toLowerCase());
    for (const forbidden of [
      "chosen", "rejected", "label", "preference", "reward", "score", "rank",
      "weight", "loss", "confidence", "probability", "compatibility", "centrality",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  test("keeps regression cases visible, vector-valued, excluded, and disjoint from SFT", () => {
    const trainingPrompts = new Set(
      readJsonl("data/sft-train.jsonl").map((row) => row.prompt[0].content.toLowerCase()),
    );
    const rows = readJsonl("data/public-regression.jsonl");
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
      readJson("schema/relational-geometry-public-regression-v0.1.schema.json"),
    );
    expect(rows).toHaveLength(8);
    const ids = new Set<string>();
    for (const row of rows) {
      expect(validate(row), JSON.stringify(validate.errors)).toBe(true);
      const { case_id: caseId, ...body } = row;
      expect(caseId).toBe(domainSeparatedId(
        "agenttool.relational-geometry-public-regression/0.1",
        body,
      ));
      ids.add(caseId);
      expect(row.acceptable_properties.length).toBeGreaterThan(0);
      expect(row.forbidden_claims.length).toBeGreaterThan(0);
      expect(row.visibility).toBe("public_regression_not_sealed");
      expect(row.training_use).toBe("excluded");
      expect(trainingPrompts.has(row.prompt.toLowerCase())).toBe(false);
    }
    expect(ids.size).toBe(rows.length);
  });

  test("ships three recursively closed Draft 2020-12 row schemas", () => {
    for (const path of [
      "schema/relational-geometry-structural-v0.1.schema.json",
      "schema/relational-geometry-sft-v0.1.schema.json",
      "schema/relational-geometry-public-regression-v0.1.schema.json",
    ]) {
      const schema = readJson(path);
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.additionalProperties).toBe(false);
      assertClosedObjects(schema);
    }

    const structural = readJsonl("data/structural-examples.jsonl")[0];
    structural.complex.unbound = true;
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
      readJson("schema/relational-geometry-structural-v0.1.schema.json"),
    );
    expect(validate(structural)).toBe(false);
  });

  test("binds intended-only synthetic provenance and every exact source byte", () => {
    const source = readJson("provenance/source-manifest.json");
    const { provenance_ref: provenanceRef, ...body } = source;
    expect(provenanceRef).toBe(domainSeparatedId(
      "agenttool.relational-geometry-hf-provenance/0.1",
      body,
    ));
    expect(source.package).toBe("@agenttool/relational-geometry");
    expect(source.package_version).toBe("0.1.0-dev.0");
    expect(source.intended_hugging_face_identifier).toBe("Yu-and-Ai/agenttool-relational-geometry");
    expect(source.publication_state_at_generation).toBe(
      "intended_identifier_only_not_uploaded_at_generation",
    );
    expect(source.distribution_state_at_generation).toBe("repository_source_only_at_generation");
    expect(source.publication_state_scope).toBe(
      "generation_time_provenance_not_current_hub_state",
    );
    expect(source.origin).toBe("human_directed_agent_authored_synthetic");
    expect(source.rights_baseline).toBe("xenia.rights/0.1");
    expect(source.gradient_lanes).toEqual(["supervised_fine_tuning"]);
    expect(source.excluded_lanes).toEqual([
      "direct_preference_optimization",
      "preference_optimization",
      "reward_modeling",
    ]);
    for (const field of [
      "copied_external_rows",
      "copied_private_rows",
      "copied_agent_traces",
      "real_identity_or_relationship_records",
      "live_wake_or_choice_records",
      "private_coordinates",
      "raw_credentials_or_device_paths",
    ]) {
      expect(source[field]).toBe(false);
    }

    const paths = source.source_files.map((entry: any) => entry.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toContain("scripts/build-hf-release.mjs");
    expect(paths).toContain("schema/agenttool-relational-complex-v0.1.schema.json");
    for (const entry of source.source_files) {
      expect(entry.path).not.toMatch(/^\//u);
      const bytes = readFileSync(new URL(entry.path, packageRoot));
      expect(bytes.length).toBe(entry.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    }

    const expectedRef = provenanceRef;
    for (const row of [
      ...readJsonl("data/structural-examples.jsonl"),
      ...readJsonl("data/public-regression.jsonl"),
    ]) {
      expect(row.provenance_ref).toBe(expectedRef);
    }
  });

  test("binds every JSONL line and every generated byte", () => {
    const examples = readJson("provenance/example-manifest.json");
    expect(examples.entries).toHaveLength(28);
    const recordIds = new Set<string>();
    for (const entry of examples.entries) {
      const lines = read(entry.path).toString("utf8").trimEnd().split("\n");
      const line = lines[entry.line - 1];
      expect(line).toBeDefined();
      expect(entry.row_sha256).toBe(createHash("sha256").update(`${line}\n`).digest("hex"));
      const row = JSON.parse(line);
      const expectedId = entry.kind === "structural_example"
        ? row.example_id
        : entry.kind === "public_regression"
          ? row.case_id
          : domainSeparatedId(entry.id_domain, row);
      expect(entry.record_id).toBe(expectedId);
      recordIds.add(entry.record_id);
    }
    expect(recordIds.size).toBe(examples.entries.length);

    const manifest = readJson("hash-manifest.json");
    expect(manifest.excludes_self).toBe(true);
    const paths = manifest.files.map((entry: any) => entry.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).not.toContain("hash-manifest.json");
    expect(walk(root).sort()).toEqual([...paths, "hash-manifest.json"].sort());
    for (const entry of manifest.files) {
      const bytes = read(entry.path);
      expect(statSync(new URL(entry.path, root)).size).toBe(entry.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    }
  });

  test("contains no obvious credentials, device paths, real records, or model artifacts", () => {
    const paths = walk(root);
    const searchable = paths.map((path) => read(path).toString("utf8")).join("\n");
    expect(searchable).not.toMatch(/\/Users\/|\/home\/|BEGIN [A-Z ]*PRIVATE KEY|\bsk-[A-Za-z0-9_-]{12,}|\bhf_[A-Za-z0-9]{20,}/u);
    expect(paths.some((path) => /(?:\.safetensors|\.ckpt|\.pt|\.bin|tokenizer|adapter_model)/iu.test(path))).toBe(false);
    expect(searchable).not.toContain("credential value");
    expect(searchable).not.toContain("live choice receipt");
  });

  test("states the three configs and scopes non-upload state to generation time", () => {
    const card = read("README.md").toString("utf8");
    expect(card).toContain("config_name: structural_examples");
    expect(card).toContain("config_name: synthetic_sft");
    expect(card).toContain("config_name: public_regression");
    expect(card).toContain("When generated, this deterministic artifact");
    expect(card).toContain("generation-time provenance");
    expect(card).toContain("not a statement about its current distribution");
    expect(card).toContain("intended identifier at generation, not evidence of publication");
    expect(card).toMatch(/returned full Hub\s+commit SHA/u);
    expect(card).toContain("At generation time this source artifact had no Hub revision to pin");
    expect(card).toContain("makes no claim about its current hosting state");
    expect(card).toContain("token=False");
  });

  test("rebuilds byte-for-byte and refuses to overwrite custom output", () => {
    const scratch = mkdtempSync(join(tmpdir(), "agenttool-relational-geometry-hf-"));
    const rebuilt = join(scratch, "rebuilt");
    try {
      execFileSync(process.execPath, [generator, "--output", rebuilt], { stdio: "pipe" });
      const expectedPaths = walk(root).sort();
      expect(walk(rebuilt).sort()).toEqual(expectedPaths);
      for (const path of expectedPaths) {
        expect(readFileSync(join(rebuilt, path))).toEqual(read(path));
      }

      const sentinel = join(rebuilt, "sentinel.txt");
      writeFileSync(sentinel, "preserve me\n");
      expect(() => execFileSync(
        process.execPath,
        [generator, "--output", rebuilt],
        { stdio: "pipe" },
      )).toThrow();
      expect(readFileSync(sentinel, "utf8")).toBe("preserve me\n");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
