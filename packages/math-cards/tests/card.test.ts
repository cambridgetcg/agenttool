import { describe, expect, test } from "bun:test";

import {
  MATH_CARD_ASSESSMENT_SCHEMA,
  MATH_CARD_SCHEMA,
  assessMathCard,
  createMathCard,
  sha256Id,
  validateMathCard,
} from "../src/index.js";
import { jsonClone, vectors } from "./fixtures.js";

describe("Math Card protocol", () => {
  test("creates, validates, freezes, and assesses the ready proof vector", () => {
    const card = createMathCard(jsonClone(vectors.cases.ready_proof.input));
    expect(card).toEqual(vectors.cases.ready_proof.card);
    expect(card.schema_version).toBe(MATH_CARD_SCHEMA);
    expect(validateMathCard(card)).toEqual(card);
    expect(Object.isFrozen(card)).toBe(true);
    expect(Object.isFrozen(card.method)).toBe(true);

    const assessment = assessMathCard(card);
    expect(assessment).toEqual(vectors.cases.ready_proof.assessment);
    expect(assessment.schema_version).toBe(MATH_CARD_ASSESSMENT_SCHEMA);
    expect(assessment.status).toBe("ready_for_bounded_inquiry");
    expect(assessment.section_statuses.every(({ status }) => status === "answered")).toBe(true);
    expect(assessment.open_questions).toEqual([]);
    expect(assessment.redesign_reasons).toEqual([]);
  });

  test("canonicalizes unordered sets before deriving the card identifier", () => {
    const input = jsonClone(vectors.cases.ready_proof.input);
    input.outcome_uses.reverse();
    input.revision_and_stop.revision_or_challenge_refs.reverse();
    input.revision_and_stop.stop_conditions.reverse();
    input.provenance.refs.reverse();
    const reordered = createMathCard(input);
    expect(reordered.card_id).toBe(vectors.cases.ready_proof.card.card_id);
    expect(reordered).toEqual(vectors.cases.ready_proof.card);
  });

  test("rejects an artifact whose identifier or fixed walls were changed", () => {
    const changedId = jsonClone(vectors.cases.ready_proof.card);
    changedId.card_id = sha256Id("tampered-card-id");
    expect(() => validateMathCard(changedId)).toThrow(/card_id/u);

    const changedBoundary = jsonClone(vectors.cases.ready_proof.card);
    changedBoundary.boundaries.proof = "proof_is_world_truth";
    expect(() => validateMathCard(changedBoundary)).toThrow(/boundaries|canonical reconstruction/u);
  });

  test("keeps incomplete declarations open and coercive measurement designs stopped", () => {
    const incomplete = assessMathCard(createMathCard(jsonClone(vectors.cases.incomplete_model.input)));
    expect(incomplete.status).toBe("questions_open");
    expect(incomplete.open_questions.length).toBeGreaterThan(5);
    expect(incomplete.redesign_reasons).toEqual([]);

    const redesign = assessMathCard(createMathCard(jsonClone(vectors.cases.redesign_measurement.input)));
    expect(redesign.status).toBe("redesign_or_stop");
    expect(redesign.redesign_reasons).toEqual(expect.arrayContaining([
      "The question asks mathematics to determine inner state or worth.",
      "Refusal carries a penalty.",
      "The inquiry ranks or scores beings.",
    ]));
  });

  test("requires a declared bounded posture and operational stop criteria", () => {
    const postureMismatch = jsonClone(vectors.cases.ready_proof.input);
    postureMismatch.question_frame.posture = "operational_measurement";
    const assessment = assessMathCard(createMathCard(postureMismatch));
    expect(assessment.status).toBe("questions_open");
    expect(assessment.section_statuses[0]).toEqual({ section: "question_and_scope", status: "open" });

    const duplicateStopKind = jsonClone(vectors.cases.ready_proof.input);
    duplicateStopKind.revision_and_stop.stop_conditions.push({
      kind: "bounded_answer_reached",
      criterion_ref: sha256Id("different-stop-criterion"),
    });
    expect(() => createMathCard(duplicateStopKind)).toThrow(/must not repeat a condition kind/u);
  });

  test("distinguishes an explained functional dependency from punishment for refusal", () => {
    const functional = jsonClone(vectors.cases.ready_proof.input);
    functional.participation_and_data_care.access_or_result_functionally_depends_on_participation = true;
    functional.participation_and_data_care.functional_dependency_ref = sha256Id("functional-data-dependency");
    expect(assessMathCard(createMathCard(functional)).status).toBe("ready_for_bounded_inquiry");

    const punitive = jsonClone(functional);
    punitive.participation_and_data_care.unrelated_access_or_resource_penalty = true;
    expect(assessMathCard(createMathCard(punitive)).status).toBe("redesign_or_stop");
  });

  test("fixes non-authority and non-scoring walls on every assessment", () => {
    for (const entry of [
      vectors.cases.ready_proof,
      vectors.cases.incomplete_model,
      vectors.cases.redesign_measurement,
    ]) {
      const assessment = assessMathCard(createMathCard(jsonClone(entry.input)));
      expect(assessment).toMatchObject({
        inner_motive: "not_inferred",
        declaration_boundary: "caller_reported_not_verified",
        authorizes_action: false,
        proves_truth: false,
        proves_understanding: false,
        scores_or_ranks_beings: false,
      });
    }
  });
});
