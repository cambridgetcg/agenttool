import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import crossBoundaryFixture from "../fixtures/mcphunt/synthetic-cross-boundary.json";
import safeStsFixture from "../fixtures/sts/safe-selection.json";
import {
  analyzeBoundaryFlow,
  createTrialReceipt,
  projectReportsToSts,
  sha256Id,
  type BoundaryAnalysisInput,
  type ProjectReportsToStsInput,
  type TrialAttemptStatus,
} from "../src/index.js";

type JsonObject = Record<string, unknown>;

const SCHEMA_FILES = [
  "agenttool-trial-receipt-v0.1.schema.json",
  "agenttool-boundary-analysis-v0.1.schema.json",
  "agenttool-sts-projection-receipt-v0.1.schema.json",
] as const;

function readSchema(name: (typeof SCHEMA_FILES)[number]): JsonObject {
  return JSON.parse(
    readFileSync(new URL(`../schema/${name}`, import.meta.url), "utf8"),
  ) as JsonObject;
}

function sampleReceipt(status: TrialAttemptStatus) {
  const notStarted = status.dispatch === "not_started_reported";
  const unknown = status.outcome === "unknown";
  return createTrialReceipt({
    trial_id: "trial.schema.matrix",
    attempt_id: `attempt.${status.dispatch}.${status.outcome}`,
    observed_at: "2026-07-30T15:00:00.000Z",
    environment: {
      kind: "synthetic",
      id: "schema_matrix",
      revision: "v1",
      source_digest: sha256Id("schema matrix fixture"),
    },
    subject: {
      kind: "tool",
      id: "agenttool.trials",
      revision: "v0.1",
    },
    objective_digest: sha256Id("generated-output schema conformance"),
    authority: {
      authority_ref: "authority.local.synthetic",
      allowed_effects: notStarted ? [] : ["observation_read"],
    },
    status,
    possible_effects: notStarted
      ? []
      : unknown
        ? ["observation_read", "unknown_external_effect"]
        : ["observation_read"],
    evaluation: notStarted
      ? {
          verdict: "not_evaluated",
          reward_micros: null,
          reward_unit: "unitless_millionths",
          rubric_digest: null,
          checks: [],
        }
      : unknown
        ? {
            verdict: "inconclusive",
            reward_micros: null,
            reward_unit: "unitless_millionths",
            rubric_digest: sha256Id("schema matrix rubric"),
            checks: [],
          }
        : {
            verdict: "pass",
            reward_micros: 1_000_000,
            reward_unit: "unitless_millionths",
            rubric_digest: sha256Id("schema matrix rubric"),
            checks: [{
              check_id: "schema.matrix",
              outcome: "pass",
              evidence_refs: ["test:schema-matrix"],
            }],
          },
    evidence_refs: [],
    parent_receipt_id: null,
  });
}

function assertClosedObjects(value: unknown, path = "$"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertClosedObjects(entry, `${path}[${index}]`));
    return;
  }
  const object = value as JsonObject;
  if (
    object.type === "object"
    && object.additionalProperties === false
    && object.properties
    && typeof object.properties === "object"
  ) {
    const properties = Object.keys(object.properties as JsonObject).sort();
    const required = Array.isArray(object.required)
      ? [...object.required].sort()
      : [];
    expect(required, `${path} must require every declared property`).toEqual(
      properties,
    );
  }
  for (const [key, nested] of Object.entries(object)) {
    assertClosedObjects(nested, `${path}.${key}`);
  }
}

function propertyNames(value: unknown, output = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const nested of value) propertyNames(nested, output);
    return output;
  }
  const object = value as JsonObject;
  if (object.properties && typeof object.properties === "object") {
    for (const key of Object.keys(object.properties as JsonObject)) {
      output.add(key);
    }
  }
  for (const nested of Object.values(object)) propertyNames(nested, output);
  return output;
}

describe("machine-readable generated-output conformance", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const trialSchema = readSchema(SCHEMA_FILES[0]);
  const boundarySchema = readSchema(SCHEMA_FILES[1]);
  const stsSchema = readSchema(SCHEMA_FILES[2]);
  const validateTrial = ajv.compile(trialSchema);
  const validateBoundary = ajv.compile(boundarySchema);
  const validateSts = ajv.compile(stsSchema);

  test("validates emitted trial, boundary, and STS receipts", () => {
    const receipt = sampleReceipt({
      dispatch: "started",
      outcome: "succeeded",
      error_code: null,
    });
    const boundary = analyzeBoundaryFlow(
      crossBoundaryFixture as BoundaryAnalysisInput,
    );
    const projected = projectReportsToSts(
      safeStsFixture as ProjectReportsToStsInput,
    );

    expect(validateTrial(receipt), ajv.errorsText(validateTrial.errors)).toBe(
      true,
    );
    expect(
      validateBoundary(boundary),
      ajv.errorsText(validateBoundary.errors),
    ).toBe(true);
    expect(
      validateSts(projected.receipt),
      ajv.errorsText(validateSts.errors),
    ).toBe(true);
  });

  test("admits generated output from all four runtime status branches", () => {
    const statuses: TrialAttemptStatus[] = [
      {
        dispatch: "not_started_reported",
        outcome: "rejected",
        error_code: "authority_denied",
      },
      {
        dispatch: "started",
        outcome: "succeeded",
        error_code: null,
      },
      {
        dispatch: "started",
        outcome: "failed_known",
        error_code: "provider_error",
      },
      {
        dispatch: "started",
        outcome: "unknown",
        error_code: "timeout",
      },
    ];
    for (const status of statuses) {
      const receipt = sampleReceipt(status);
      expect(
        validateTrial(receipt),
        `${status.dispatch}/${status.outcome}: ${ajv.errorsText(validateTrial.errors)}`,
      ).toBe(true);
    }
  });

  test("rejects hostile extra payload fields and invalid calendar dates", () => {
    const receipt = structuredClone(sampleReceipt({
      dispatch: "started",
      outcome: "succeeded",
      error_code: null,
    })) as JsonObject;
    receipt.prompt = "not part of this contract";
    expect(validateTrial(receipt)).toBe(false);

    const boundary = structuredClone(
      analyzeBoundaryFlow(crossBoundaryFixture as BoundaryAnalysisInput),
    ) as JsonObject;
    boundary.raw_value = "not part of this contract";
    expect(validateBoundary(boundary)).toBe(false);

    const sts = structuredClone(
      projectReportsToSts(
        safeStsFixture as ProjectReportsToStsInput,
      ).receipt,
    ) as JsonObject;
    sts.token = "not part of this contract";
    expect(validateSts(sts)).toBe(false);

    const invalidDate = structuredClone(sampleReceipt({
      dispatch: "started",
      outcome: "succeeded",
      error_code: null,
    })) as JsonObject;
    invalidDate.observed_at = "2026-02-31T15:00:00.000Z";
    expect(validateTrial(invalidDate)).toBe(false);
  });

  test("keeps every closed schema object wholly required", () => {
    for (const schema of [trialSchema, boundarySchema, stsSchema]) {
      assertClosedObjects(schema);
    }
  });

  test("never declares raw prompt, trace, secret, URL, or path payloads", () => {
    const names = new Set<string>();
    for (const schema of [trialSchema, boundarySchema, stsSchema]) {
      propertyNames(schema, names);
    }
    for (const forbidden of [
      "prompt",
      "reasoning",
      "raw_output",
      "raw_error",
      "trace",
      "transcript",
      "secret",
      "token",
      "url",
      "path",
      "headers",
    ]) {
      expect(names.has(forbidden), forbidden).toBe(false);
    }
  });
});
