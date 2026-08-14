import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { MATH_CARD_BOUNDARIES } from "../src/index.js";
import { jsonClone, vectors } from "./fixtures.js";

const root = join(import.meta.dir, "..");
const cardSchema = JSON.parse(readFileSync(
  join(root, "schema", "agenttool-math-card-v0.1.schema.json"),
  "utf8",
));
const assessmentSchema = JSON.parse(readFileSync(
  join(root, "schema", "agenttool-math-card-assessment-v0.1.schema.json"),
  "utf8",
));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateCard = ajv.compile(cardSchema);
const validateAssessment = ajv.compile(assessmentSchema);

describe("portable Draft 2020-12 schemas", () => {
  test("strictly compile and accept all generated runtime artifacts", () => {
    expect(cardSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(assessmentSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    for (const entry of [
      vectors.cases.ready_proof,
      vectors.cases.incomplete_model,
      vectors.cases.redesign_measurement,
    ]) {
      expect(validateCard(entry.card), JSON.stringify(validateCard.errors)).toBe(true);
      expect(validateAssessment(entry.assessment), JSON.stringify(validateAssessment.errors)).toBe(true);
    }
  });

  test("pins every runtime boundary constant exactly", () => {
    const cardBoundaryProperties = cardSchema.properties.boundaries.properties;
    const assessmentBoundaryProperties = assessmentSchema.properties.boundaries.properties;
    for (const [key, value] of Object.entries(MATH_CARD_BOUNDARIES)) {
      expect(cardBoundaryProperties[key].const).toBe(value);
      expect(assessmentBoundaryProperties[key].const).toBe(value);
    }
    expect(Object.keys(cardBoundaryProperties).sort()).toEqual(Object.keys(MATH_CARD_BOUNDARIES).sort());
  });

  test("closes roots, method variants, assessment sections, and fixed walls", () => {
    const widened = jsonClone(vectors.cases.ready_proof.card);
    widened.score = 99;
    expect(validateCard(widened)).toBe(false);

    const widenedMethod = jsonClone(vectors.cases.ready_proof.card);
    widenedMethod.method.confidence = 1;
    expect(validateCard(widenedMethod)).toBe(false);

    const widenedAssessment = jsonClone(vectors.cases.ready_proof.assessment);
    widenedAssessment.authorizes_action = true;
    expect(validateAssessment(widenedAssessment)).toBe(false);

    const reorderedSections = jsonClone(vectors.cases.ready_proof.assessment);
    reorderedSections.section_statuses.reverse();
    expect(validateAssessment(reorderedSections)).toBe(false);
  });

  test("matches runtime uniqueness and functional dependency invariants", () => {
    const duplicateStopKind = jsonClone(vectors.cases.ready_proof.card);
    duplicateStopKind.revision_and_stop.stop_conditions.push({
      kind: "bounded_answer_reached",
      criterion_ref: vectors.cases.ready_proof.card.scope_ref,
    });
    expect(validateCard(duplicateStopKind), JSON.stringify(validateCard.errors)).toBe(false);

    const impossibleDependency = jsonClone(vectors.cases.ready_proof.card);
    impossibleDependency.participation_and_data_care.functional_dependency_ref = impossibleDependency.scope_ref;
    expect(validateCard(impossibleDependency), JSON.stringify(validateCard.errors)).toBe(false);
  });

  test("rejects assessments whose declared status contradicts their sections or questions", () => {
    const forgedReady = jsonClone(vectors.cases.ready_proof.assessment);
    forgedReady.section_statuses[0].status = "redesign_required";
    forgedReady.open_questions = ["A forged open question"];
    forgedReady.redesign_reasons = ["A forged redesign reason"];
    forgedReady.assessment_id = `sha256:${"0".repeat(64)}`;
    expect(validateAssessment(forgedReady), JSON.stringify(validateAssessment.errors)).toBe(false);

    const forgedOpen = jsonClone(vectors.cases.incomplete_model.assessment);
    forgedOpen.section_statuses[0].status = "redesign_required";
    forgedOpen.redesign_reasons = ["Contradicts questions_open"];
    expect(validateAssessment(forgedOpen), JSON.stringify(validateAssessment.errors)).toBe(false);

    const forgedRedesign = jsonClone(vectors.cases.redesign_measurement.assessment);
    forgedRedesign.section_statuses = forgedRedesign.section_statuses.map((entry: Record<string, any>) => ({
      ...entry,
      status: "answered",
    }));
    forgedRedesign.redesign_reasons = [];
    expect(validateAssessment(forgedRedesign), JSON.stringify(validateAssessment.errors)).toBe(false);
  });
});
