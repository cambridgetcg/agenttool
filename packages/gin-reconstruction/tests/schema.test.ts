import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";

import challengeSchema from "../schema/agenttool-gin-challenge-v0.1.schema.json";
import reconstructionSchema from "../schema/agenttool-gin-reconstruction-v0.1.schema.json";
import { jsonClone, vectors } from "./fixtures.js";

describe("closed portable schemas", () => {
  test("compile strictly and accept every generated artifact", () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const validateReconstruction = ajv.compile(reconstructionSchema);
    const validateChallenge = ajv.compile(challengeSchema);
    for (const { request, receipt } of Object.values(vectors.cases)) {
      expect(validateReconstruction(request), JSON.stringify(validateReconstruction.errors)).toBe(true);
      expect(validateReconstruction(receipt), JSON.stringify(validateReconstruction.errors)).toBe(true);
    }
    expect(validateChallenge(vectors.challenge.artifact), JSON.stringify(validateChallenge.errors)).toBe(true);
    expect(validateChallenge(vectors.challenge.assessment), JSON.stringify(validateChallenge.errors)).toBe(true);
  });

  test("reject unknown fields and malformed identifiers", () => {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const validateReconstruction = ajv.compile(reconstructionSchema);
    const validateChallenge = ajv.compile(challengeSchema);

    const request = jsonClone(vectors.cases.unique!.request) as Record<string, any>;
    request.truth = true;
    expect(validateReconstruction(request)).toBe(false);

    const receipt = jsonClone(vectors.cases.unique!.receipt) as Record<string, any>;
    receipt.receipt_id = "sha256:ABC";
    expect(validateReconstruction(receipt)).toBe(false);

    const challenge = jsonClone(vectors.challenge.artifact) as Record<string, any>;
    challenge.participation_and_data_care.unbounded_reason = "because";
    expect(validateChallenge(challenge)).toBe(false);

    const assessment = jsonClone(vectors.challenge.assessment) as Record<string, any>;
    assessment.inner_motive = "pride";
    expect(validateChallenge(assessment)).toBe(false);
  });
});
