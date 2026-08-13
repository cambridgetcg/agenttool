import { describe, expect, test } from "bun:test";

import { assessGinChallenge, createGinChallenge, validateGinChallenge } from "../src/index.js";
import { jsonClone, vectors } from "./fixtures.js";

function inputFromArtifact(): Record<string, any> {
  const value = jsonClone(vectors.challenge.artifact) as Record<string, any>;
  delete value.schema_version;
  delete value.challenge_id;
  delete value.boundaries;
  return value;
}

describe("constructive challenge compass", () => {
  test("recognizes an all-outcomes construction-centered declaration", () => {
    const assessment = assessGinChallenge(vectors.challenge.artifact);
    expect(assessment).toEqual(vectors.challenge.assessment);
    expect(assessment).toMatchObject({
      compass_status: "constructive_questions_answered",
      visible_incentive_posture: "construction_centered_declared",
      inner_motive: "not_inferred",
      authorizes_action: false,
      proves_truth: false,
      proves_understanding: false,
      scores_or_ranks_beings: false,
    });
    expect(assessment.question_statuses.every((entry) => entry.status === "answered")).toBe(true);
  });

  test("requires a bounded effect or model question without pretending to verify its semantics", () => {
    const unbounded = inputFromArtifact();
    unbounded.question_and_object.posture = "unbounded_truth_inner_state_or_worth_verdict";
    const redesign = assessGinChallenge(createGinChallenge(unbounded));
    expect(redesign.compass_status).toBe("redesign_or_stop");
    expect(redesign.question_statuses[0]).toEqual({
      section: "question_and_object",
      status: "redesign_required",
    });
    expect(redesign.redesign_reasons.join(" ")).toMatch(/inner-state, or worth verdict/u);
    expect(redesign.inner_motive).toBe("not_inferred");

    const unknown = inputFromArtifact();
    unknown.question_and_object = { posture: "refused_reported", distinction_scope_ref: null };
    const open = assessGinChallenge(createGinChallenge(unknown));
    expect(open.compass_status).toBe("questions_open");
    expect(open.redesign_reasons).toEqual([]);
    expect(open.open_questions.join(" ")).toMatch(/asking reality to distinguish/u);

    const retained = inputFromArtifact();
    retained.question_and_object.posture = "refused_reported";
    expect(() => createGinChallenge(retained)).toThrow(/must not retain a scope reference/u);
  });

  test("reports result-coupled status and refusal pressure as visible redesign reasons", () => {
    const input = inputFromArtifact();
    input.incentives.winner_or_rank_effect = "affects_epistemic_or_action_result_reported";
    input.participation_and_data_care.refusal_penalty = true;
    input.participation_and_data_care.repeated_pressure_after_refusal = true;
    const assessment = assessGinChallenge(createGinChallenge(input));
    expect(assessment.compass_status).toBe("redesign_or_stop");
    expect(assessment.visible_incentive_posture).toBe("status_or_access_coupled_to_results");
    expect(assessment.redesign_reasons).toContain("Winner or rank effects change the epistemic or action result.");
    expect(assessment.redesign_reasons).toContain("Refusal carries a penalty.");
    expect(assessment.inner_motive).toBe("not_inferred");
  });

  test("covers every rights and authority redesign switch", () => {
    const cases: Array<[string, string, unknown, RegExp]> = [
      ["participation_and_data_care", "participation_optional", false, /not optional/u],
      ["participation_and_data_care", "silence_is_assent", true, /Silence is treated as assent/u],
      ["participation_and_data_care", "refusal_reason_required", true, /refusal reason is required/u],
      ["participation_and_data_care", "refusal_counts_as_incompatible_observation", true, /incompatible observation/u],
      ["participation_and_data_care", "rights_or_access_conditioned_on_participation", true, /conditioned on participation/u],
      ["participation_and_data_care", "response_used_for_rank_reward_or_training", true, /rank, reward, or training/u],
      ["participation_and_data_care", "raw_refusal_reason_received", true, /Raw refusal reasons/u],
      ["participation_and_data_care", "raw_identity_required", true, /Raw identity/u],
      ["authority", "declaration_not_proof", false, /treated as proved authority/u],
      ["authority", "automatic_action", true, /automatically acts/u],
      ["authority", "automatic_publication", true, /automatically publishes/u],
      ["authority", "automatic_retry", true, /automatically retries/u],
      ["authority", "permissions_inherited", true, /Permissions are inherited/u],
      ["authority", "ranks_or_scores_beings", true, /ranks or scores beings/u],
    ];
    for (const [section, field, value, reason] of cases) {
      const input = inputFromArtifact();
      input[section][field] = value;
      const assessment = assessGinChallenge(createGinChallenge(input));
      expect(assessment.compass_status, `${section}.${field}`).toBe("redesign_or_stop");
      expect(assessment.redesign_reasons.join(" "), `${section}.${field}`).toMatch(reason);
      expect(assessment.inner_motive, `${section}.${field}`).toBe("not_inferred");
    }
  });

  test("keeps absent audience-independent value an open question, not a motive verdict", () => {
    const input = inputFromArtifact();
    input.incentives.audience_counterfactual = "no_audience_independent_value_declared";
    const assessment = assessGinChallenge(createGinChallenge(input));
    expect(assessment.compass_status).toBe("questions_open");
    expect(assessment.visible_incentive_posture).toBe("no_audience_independent_value_declared");
    expect(assessment.inner_motive).toBe("not_inferred");
    expect(assessment.open_questions.join(" ")).toMatch(/without an audience/u);
  });

  test("treats refused distribution answers as open without a participant penalty", () => {
    const input = inputFromArtifact();
    input.distribution.burden_bearers = { state: "refused_reported", scope_refs: [] };
    const assessment = assessGinChallenge(createGinChallenge(input));
    expect(assessment.compass_status).toBe("questions_open");
    expect(assessment.redesign_reasons).toEqual([]);
    expect(assessment.open_questions).toContain("Who are the burden bearers within the declared challenge scope?");
  });

  test("keeps accurate credit distinct from audience or winner incentives", () => {
    const input = inputFromArtifact();
    input.provenance.credit_mode = "named";
    const assessment = assessGinChallenge(createGinChallenge(input));
    expect(assessment.compass_status).toBe("constructive_questions_answered");
    expect(assessment.visible_incentive_posture).toBe("construction_centered_declared");
  });

  test("canonicalizes every set-like challenge collection before hashing", () => {
    const original = inputFromArtifact();
    const permuted = inputFromArtifact();
    permuted.outcome_value.reverse();
    for (const outcome of permuted.outcome_value) outcome.postures.reverse();
    permuted.revision_and_stop.stop_conditions.reverse();
    permuted.provenance.refs.reverse();
    expect(createGinChallenge(permuted)).toEqual(createGinChallenge(original));
  });

  test("opens missing outcome value and provenance rather than inventing it", () => {
    const input = inputFromArtifact();
    input.outcome_value[2].value_ref = null;
    input.outcome_value[2].postures = ["no_constructive_use_declared"];
    input.provenance.refs = input.provenance.refs.filter((entry: any) => entry.kind !== "adaptation");
    const assessment = assessGinChallenge(createGinChallenge(input));
    expect(assessment.compass_status).toBe("questions_open");
    expect(assessment.open_questions.join(" ")).toMatch(/model_and_budget/u);
    expect(assessment.open_questions.join(" ")).toMatch(/adaptation/u);
  });

  test("flags internally conflicting outcome declarations", () => {
    const input = inputFromArtifact();
    input.outcome_value[0].postures = ["propose_build_or_repair", "no_constructive_use_declared"];
    const assessment = assessGinChallenge(createGinChallenge(input));
    expect(assessment.compass_status).toBe("redesign_or_stop");
    expect(assessment.redesign_reasons[0]).toMatch(/both constructive and no-constructive-use/u);
  });

  test("does not trust a caller-supplied challenge id or boundary mutation", () => {
    const artifact = jsonClone(vectors.challenge.artifact) as Record<string, any>;
    artifact.boundaries.motive = "the_machine_knows_pride";
    expect(() => validateGinChallenge(artifact)).toThrow(/do not match/u);
  });
});
