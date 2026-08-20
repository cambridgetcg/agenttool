import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { verifyZeroneEconomySimulationEvidence } from "../src/index.js";
import { authorizedPlan } from "./fixtures.js";

const schema = await Bun.file(new URL(
  "../schema/simulation-evidence-v0.1.schema.json",
  import.meta.url,
)).json() as object;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

describe("simulation evidence schema", () => {
  test("accepts the canonical planner-created signed evidence record", async () => {
    const { evidence } = await authorizedPlan();
    expect(validate(evidence), ajv.errorsText(validate.errors)).toBeTrue();
  });

  test("is closed and keeps successful status coupled to code zero", async () => {
    const { evidence } = await authorizedPlan();
    expect(validate({ ...evidence, transport_url: "https://example.invalid" }))
      .toBeFalse();
    expect(validate({ ...evidence, status: "failed", code: 0 })).toBeFalse();
    expect(validate({ ...evidence, status: "succeeded", code: 1 })).toBeFalse();
  });

  test("matches runtime canonical base64url terminal-bit constraints", async () => {
    const { evidence } = await authorizedPlan();
    const invalidPublicKey = {
      ...evidence,
      adapter: {
        ...evidence.adapter,
        public_key: `${evidence.adapter.public_key.slice(0, -1)}B`,
      },
    };
    const invalidSignature = {
      ...evidence,
      signature: {
        ...evidence.signature,
        value: `${evidence.signature.value.slice(0, -1)}B`,
      },
    };
    expect(validate(invalidPublicKey)).toBeFalse();
    expect(validate(invalidSignature)).toBeFalse();
    expect(() => verifyZeroneEconomySimulationEvidence(invalidPublicKey))
      .toThrow(/canonical unpadded base64url/i);
    expect(() => verifyZeroneEconomySimulationEvidence(invalidSignature))
      .toThrow(/canonical unpadded base64url/i);
  });
});
