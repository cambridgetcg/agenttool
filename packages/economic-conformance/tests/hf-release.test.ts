import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const kernelRoot = join(packageRoot, "..", "economic-kernel");
const datasetRoot = join(packageRoot, "hf", "dataset");
const suite = readJson(join(packageRoot, "vectors", "economic-kernel-v0.1.json"));
const trainingRows = readJsonl(join(datasetRoot, "data", "training-lessons.jsonl"));
const referenceRows = readJsonl(join(datasetRoot, "data", "conformance-reference.jsonl"));

describe("Hugging Face economic-kernel companion", () => {
  test("admits only 24 independently authored synthetic lesson rows", () => {
    expect(trainingRows).toHaveLength(24);
    expect(new Set(trainingRows.map((row) => row.row_id)).size).toBe(24);
    expect(new Set(trainingRows.map((row) => row.principle)).size).toBe(24);

    const forbidden = suite.cases.flatMap((item: any) => [
      item.case_id,
      item.description,
      JSON.stringify(item.input),
      JSON.stringify(item.expected),
    ]);
    for (const row of trainingRows) {
      expect(row._format).toBe("agenttool.economic-kernel-training-row/0.1");
      expect(row.row_role).toBe("training_lesson");
      expect(row.origin).toBe("human_directed_agent_authored_synthetic");
      expect(row.training_admission).toBe("ADMITTED_SYNTHETIC_LESSON");
      expect(row.training_authorized).toBe(true);
      expect(row.contains_private_or_participant_data).toBe(false);
      expect(row.copies_official_conformance_case).toBe(false);
      expect(row.rights_baseline).toBe("xenia.rights/0.1");
      expect(row.rights_conditional_on_payment).toBe(false);
      expect(row.authority_effect).toBe("none");
      expect(row.economic_effect).toBe("none");
      const authored = [
        row.instruction,
        row.context,
        row.response,
        row.mathematical_form,
      ].join("\n");
      for (const exact of forbidden) expect(authored).not.toContain(exact);
    }
  });

  test("projects every exact public case into a non-training reference config", () => {
    expect(referenceRows).toHaveLength(34);
    expect(new Set(referenceRows.map((row) => row.case_id)).size).toBe(34);
    for (let index = 0; index < suite.cases.length; index++) {
      const source = suite.cases[index];
      const row = referenceRows[index];
      expect(row).toMatchObject({
        _format: "agenttool.economic-kernel-conformance-reference-row/0.1",
        row_id: "reference:" + source.case_id,
        row_role: "public_conformance_reference",
        suite_id: suite.suite_id,
        suite_revision: suite.suite_revision,
        case_id: source.case_id,
        family: source.family,
        description: source.description,
        operation: source.operation,
        training_admission: "HELD_OUT_FROM_AUTHORED_LESSON_SET",
        training_authorized: false,
        public_bytes_can_be_copied_by_others: true,
        holdout_is_not_technical_enforcement: true,
        contains_private_or_participant_data: false,
        rights_baseline: "xenia.rights/0.1",
        rights_conditional_on_payment: false,
        conformance_certification_effect: "none",
        economic_effect: "none",
      });
      expect(JSON.parse(row.input_json)).toEqual(source.input);
      expect(JSON.parse(row.expected_json)).toEqual(source.expected);
    }
  });

  test("binds training admission without claiming provider or model effects", () => {
    const admission = readJson(join(datasetRoot, "training-authorization.json"));
    expect(admission).toEqual({
      _format: "agenttool.economic-kernel-training-admission/0.1",
      dataset_identifier: "Yu-and-Ai/agenttool-economic-kernel",
      package_version: "0.1.0-dev.0",
      authorization_basis: "explicit_repository_operator_direction_for_this_release",
      admitted_config: "economic_kernel_lessons",
      admitted_split: "train",
      admitted_rows: 24,
      admitted_content_scope: "repository_authored_synthetic_lessons_only",
      training_authorized: true,
      excluded_config: "economic_kernel_v0_1",
      excluded_rows: 34,
      excluded_content_scope: "public_conformance_reference_held_out_from_authored_lesson_generator",
      excluded_training_authorized: false,
      license: "Apache-2.0",
      rights_baseline: "xenia.rights/0.1",
      rights_conditional_on_payment: false,
      contains_private_or_participant_data: false,
      authorizes_provider_account_action: false,
      authorizes_paid_compute: false,
      proves_downstream_compliance: false,
      proves_model_learning: false,
      model_weight_effect_at_generation: "none",
      economic_effect_at_generation: "none",
    });
  });

  test("states configs, public-holdout limits, and zero effects on the card", () => {
    const card = readFileSync(join(datasetRoot, "README.md"), "utf8");
    expect(card).toContain("config_name: economic_kernel_lessons");
    expect(card).toContain("- split: train\n    path: data/training-lessons.jsonl");
    expect(card).toContain("config_name: economic_kernel_v0_1");
    expect(card).toContain("- split: reference\n    path: data/conformance-reference.jsonl");
    expect(card).toContain("publisher metadata, not access control");
    expect(card).toContain("does not claim secrecy, uncontaminated evaluation");
    expect(card).toContain("does not prove that\na model trained, learned, understood");
    expect(card).toContain("rights remain unconditional");
  });

  test("copies the exact vector sources and both protocol descriptions", () => {
    expect(readFileSync(join(datasetRoot, "reference", "economic-kernel-v0.1.json")))
      .toEqual(readFileSync(join(packageRoot, "vectors", "economic-kernel-v0.1.json")));
    expect(readFileSync(join(datasetRoot, "reference", "manifest.json")))
      .toEqual(readFileSync(join(packageRoot, "vectors", "manifest.json")));
    expect(readFileSync(join(datasetRoot, "reference", "KERNEL.md")))
      .toEqual(readFileSync(join(kernelRoot, "README.md")));
    expect(readFileSync(join(datasetRoot, "reference", "CONFORMANCE.md")))
      .toEqual(readFileSync(join(packageRoot, "README.md")));
  });

  test("binds the selected generation sources by exact bytes", () => {
    const manifest = readJson(join(datasetRoot, "source-manifest.json"));
    expect(manifest.intended_hugging_face_identifier)
      .toBe("Yu-and-Ai/agenttool-economic-kernel");
    expect(manifest.publication_state_at_generation).toContain("not_uploaded");
    expect(manifest.upstream_revision).toBeNull();
    expect(manifest.source_files_complete).toBe(false);
    expect(manifest.source_manifest_is_attestation).toBe(false);
    expect(manifest.admitted_training_rows).toBe(24);
    expect(manifest.held_out_conformance_rows).toBe(34);
    expect(hash(Buffer.from(JSON.stringify(manifest.source_files), "utf8")))
      .toBe(manifest.selected_source_set_sha256);

    for (const file of manifest.source_files) {
      const separator = file.path.indexOf("/");
      const area = file.path.slice(0, separator);
      const path = file.path.slice(separator + 1);
      const sourceRoot = area === "economic-kernel" ? kernelRoot : packageRoot;
      const bytes = readFileSync(join(sourceRoot, path));
      expect(bytes.length).toBe(file.bytes);
      expect(hash(bytes)).toBe(file.sha256);
    }
  });

  test("hash manifest covers every companion byte except itself", () => {
    const manifest = readJson(join(datasetRoot, "hash-manifest.json"));
    const actualPaths = filesBelow(datasetRoot)
      .map((path) => relative(datasetRoot, path))
      .filter((path) => path !== "hash-manifest.json")
      .sort();
    expect(manifest.files.map((file: any) => file.path)).toEqual(actualPaths);
    for (const file of manifest.files) {
      const bytes = readFileSync(join(datasetRoot, file.path));
      expect(bytes.length).toBe(file.bytes);
      expect(hash(bytes)).toBe(file.sha256);
    }
  });
});

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonl(path: string): any[] {
  const text = readFileSync(path, "utf8");
  expect(text.endsWith("\n")).toBe(true);
  return text.trimEnd().split("\n").map((line) => JSON.parse(line));
}

function filesBelow(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? filesBelow(child) : [child];
  });
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
