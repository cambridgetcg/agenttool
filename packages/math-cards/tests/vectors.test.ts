import { describe, expect, test } from "bun:test";

import { MathCardError, assessMathCard, canonicalJson, createMathCard } from "../src/index.js";
import { jsonClone, vectors } from "./fixtures.js";

describe("deterministic vectors", () => {
  test("recomputes every valid case byte-for-byte", () => {
    expect(vectors.schema_version).toBe("agenttool.math-cards-vectors/0.1");
    for (const entry of [
      vectors.cases.ready_proof,
      vectors.cases.incomplete_model,
      vectors.cases.redesign_measurement,
    ]) {
      const card = createMathCard(jsonClone(entry.input));
      const assessment = assessMathCard(card);
      expect(canonicalJson(card)).toBe(canonicalJson(entry.card));
      expect(canonicalJson(assessment)).toBe(canonicalJson(entry.assessment));
    }
  });

  test("pins the malformed case to a typed stable failure", () => {
    try {
      createMathCard(jsonClone(vectors.cases.malformed.input));
      throw new Error("malformed vector unexpectedly succeeded");
    } catch (error) {
      expect(error).toBeInstanceOf(MathCardError);
      expect({
        name: (error as MathCardError).name,
        code: (error as MathCardError).code,
        message: (error as MathCardError).message,
      }).toEqual(vectors.cases.malformed.error);
    }
  });
});
