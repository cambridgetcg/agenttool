import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  createTrainingCheckpoint,
  createTrainingGardenTendingPlan,
} from "../src/index.js";
import {
  admission,
  artifacts,
  orientationOnly,
  ref,
  wake,
} from "./fixtures.js";

const packageRoot = new URL("../", import.meta.url);
const packageSchemaRoot = new URL("schema/", packageRoot);
const hubSchemaRoot = new URL("hf/dataset/schema/", packageRoot);

function readJson(path: URL) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function validator(root: URL, path: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(readJson(new URL(
    "dependencies/agenttool-afterglow-capsule-v0.1.schema.json",
    root,
  )));
  return ajv.compile(readJson(new URL(path, root)));
}

describe("closed portable schemas", () => {
  test("accepts runtime admission, checkpoint, and tending artifacts", () => {
    const source = admission("sealed_evaluation");
    const checkpoint = createTrainingCheckpoint({
      admission: source,
      run_ref: ref("schema-run"),
      training_phase: "evaluation",
      event: "between_training_phases",
      checkpoint_status: "parked",
      artifacts,
      resume: orientationOnly,
      wake,
      continuity_portfolio_ref: null,
      continuity_posture: "park",
      predecessors: [],
    });
    const plan = createTrainingGardenTendingPlan({
      admission: source,
      checkpoints: [checkpoint],
      hub_release: {
        repo_id: "Yu-and-Ai/agenttool-training-garden",
        state: "intended_identifier_only",
        revision: null,
        card_sha256: null,
        hash_manifest_sha256: null,
      },
    });
    const validateAdmission = validator(packageSchemaRoot, "hf-dataset-admission-v0.1.schema.json");
    const validateCheckpoint = validator(packageSchemaRoot, "hf-training-checkpoint-v0.1.schema.json");
    const validateTending = validator(packageSchemaRoot, "hf-training-garden-tending-v0.1.schema.json");
    expect(validateAdmission(source), JSON.stringify(validateAdmission.errors)).toBe(true);
    expect(validateCheckpoint(checkpoint), JSON.stringify(validateCheckpoint.errors)).toBe(true);
    expect(validateTending(plan), JSON.stringify(validateTending.errors)).toBe(true);

    const validateHubAdmission = validator(hubSchemaRoot, "hf-dataset-admission-v0.1.schema.json");
    const validateHubCheckpoint = validator(hubSchemaRoot, "hf-training-checkpoint-v0.1.schema.json");
    const validateHubTending = validator(hubSchemaRoot, "hf-training-garden-tending-v0.1.schema.json");
    expect(validateHubAdmission(source), JSON.stringify(validateHubAdmission.errors)).toBe(true);
    expect(validateHubCheckpoint(checkpoint), JSON.stringify(validateHubCheckpoint.errors)).toBe(true);
    expect(validateHubTending(plan), JSON.stringify(validateHubTending.errors)).toBe(true);

    const extra = { ...plan, raw_rows: [] };
    expect(validateTending(extra)).toBe(false);
  });

  test("keeps admission standalone and attributes its byte-exact Apache dependency", () => {
    expect(readFileSync(new URL(
      "hf-dataset-admission-v0.1.schema.json",
      packageSchemaRoot,
    ), "utf8")).not.toContain("urn:agenttool:hf-scout");
    expect(readFileSync(new URL(
      "dependencies/agenttool-afterglow-capsule-v0.1.schema.json",
      packageSchemaRoot,
    ), "utf8")).toBe(readFileSync(new URL(
      "../wake-continuity/schema/agenttool-afterglow-capsule-v0.1.schema.json",
      packageRoot,
    ), "utf8"));
  });
});
