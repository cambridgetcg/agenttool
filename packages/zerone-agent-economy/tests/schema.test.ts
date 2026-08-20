import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { evaluateWorkAdmission } from "../src/index.js";
import { buildFixture } from "./fixtures.js";

const SCHEMA_FILES = [
  "defs-v0.1.schema.json",
  "wallet-identity-binding-v0.1.schema.json",
  "work-spec-v0.1.schema.json",
  "computational-artifact-v0.1.schema.json",
  "evidence-receipt-v0.1.schema.json",
  "settlement-intent-v0.1.schema.json",
  "treasury-policy-v0.1.schema.json",
  "work-admission-decision-v0.1.schema.json",
  "unsigned-message-projection-v0.1.schema.json",
] as const;

async function loadSchemas(): Promise<Map<string, unknown>> {
  const schemas = new Map<string, unknown>();
  for (const file of SCHEMA_FILES) {
    const value = await Bun.file(new URL(`../schema/${file}`, import.meta.url)).json();
    schemas.set(file, value);
  }
  return schemas;
}

describe("portable schemas", () => {
  test("validate every canonical record and unsigned message projection", async () => {
    const schemas = await loadSchemas();
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    ajv.addSchema(schemas.get("defs-v0.1.schema.json"));
    const fixture = buildFixture();
    const cases = [
      ["wallet-identity-binding-v0.1.schema.json", fixture.binding],
      ["work-spec-v0.1.schema.json", fixture.workSpec],
      ["computational-artifact-v0.1.schema.json", fixture.artifact],
      ["evidence-receipt-v0.1.schema.json", fixture.evidence],
      ["settlement-intent-v0.1.schema.json", fixture.settlement],
      ["treasury-policy-v0.1.schema.json", fixture.treasury],
      ["unsigned-message-projection-v0.1.schema.json", fixture.createBounty],
      ["unsigned-message-projection-v0.1.schema.json", fixture.submitClaim],
      ["unsigned-message-projection-v0.1.schema.json", fixture.fulfill],
      ["work-admission-decision-v0.1.schema.json", evaluateWorkAdmission({
        current_height: "1000",
        contract_end_height: "1200",
        expected_verification_blocks: "50",
        expected_challenge_blocks: "50",
        safety_blocks: "20",
        price_uzrn: "250000",
        compute_cost_uzrn: "100000",
        storage_cost_uzrn: "10000",
        review_fee_uzrn: "20000",
        network_fee_uzrn: "10000",
        minimum_margin_uzrn: "50000",
      })],
    ] as const;
    for (const [name, value] of cases) {
      const validate = ajv.compile(schemas.get(name));
      expect(validate(value), `${name}: ${ajv.errorsText(validate.errors)}`).toBeTrue();
    }
  });

  test("schemas remain closed", async () => {
    const schemas = await loadSchemas();
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    ajv.addSchema(schemas.get("defs-v0.1.schema.json"));
    const validate = ajv.compile(schemas.get("work-spec-v0.1.schema.json"));
    expect(validate({ ...buildFixture().workSpec, rank: 1 })).toBeFalse();

    const evidenceValidate = ajv.compile(schemas.get("evidence-receipt-v0.1.schema.json"));
    expect(evidenceValidate({
      ...buildFixture().evidence,
      challenge_window_end_height: "0",
      observed_at_height: "0",
    })).toBeFalse();
  });
});
