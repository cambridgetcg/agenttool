import { describe, expect, test } from "bun:test";

import {
  assessGinChallenge,
  reconstructGin,
  validateGinChallenge,
  validateGinReconstructionReceipt,
} from "../src/index.js";
import { vectors } from "./fixtures.js";

describe("deterministic vectors", () => {
  test("recomputes every checked-in receipt and assessment exactly", () => {
    for (const { request, receipt } of Object.values(vectors.cases)) {
      expect(reconstructGin(request)).toEqual(receipt);
      expect(validateGinReconstructionReceipt(receipt, request)).toEqual(receipt);
    }
    const challenge = validateGinChallenge(vectors.challenge.artifact);
    expect(assessGinChallenge(challenge)).toEqual(vectors.challenge.assessment);
  });
});
