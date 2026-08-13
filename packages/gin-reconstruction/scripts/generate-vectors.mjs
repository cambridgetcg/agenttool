import { writeFile } from "node:fs/promises";

import {
  assessGinChallenge,
  createGinChallenge,
  createGinReconstructionRequest,
  mod,
  reconstructGin,
  sha256Id,
} from "../dist/index.js";

const ref = (label) => sha256Id(`gin-reconstruction-vector:${label}`);
const model = (fieldPrime, degreeBound, errorBudget, enumerationLimit = 1_000_000) => ({
  field_prime: fieldPrime,
  degree_bound: degreeBound,
  report_error_budget: errorBudget,
  enumeration_limit: enumerationLimit,
  calibration_model: "affine_exact_two_anchor_per_usable_observation",
});

function usable(id, intervention, normalizedOutput, prime, encodedZero = 0, encodedOne = 1) {
  const slope = mod(encodedOne - encodedZero, prime);
  return {
    observation_id: id,
    substrate_ref: ref(`substrate:${id}`),
    intervention,
    availability: "usable",
    encoded_output: mod(slope * normalizedOutput + encodedZero, prime),
    calibration: {
      posture: "declared_exact_two_anchor_affine",
      encoded_zero: encodedZero,
      encoded_one: encodedOne,
    },
    evidence_ref: ref(`evidence:${id}`),
  };
}

function erased(id, intervention, availability) {
  return {
    observation_id: id,
    substrate_ref: ref(`substrate:${id}`),
    intervention,
    availability,
    encoded_output: null,
    calibration: null,
    evidence_ref: null,
  };
}

function pair(label, requestInput) {
  const request = createGinReconstructionRequest({
    problem_ref: ref(`problem:${label}`),
    ...requestInput,
  });
  return { request, receipt: reconstructGin(request) };
}

const unique = pair("unique", {
  model: model(5, 1, 1),
  observations: [
    usable("u0", 0, 2, 5, 0, 1),
    usable("u1", 1, 0, 5, 1, 3),
    usable("u2", 2, 4, 5, 2, 0),
    usable("u3", 3, 1, 5, 3, 2),
    erased("u4-refused", 4, "refused"),
  ],
});

const ambiguous = pair("ambiguous", {
  model: model(5, 1, 1),
  observations: [
    usable("a0", 0, 0, 5),
    usable("a1", 1, 1, 5),
    usable("a2", 2, 0, 5),
  ],
});

const instanceUnique = pair("instance-unique", {
  model: model(5, 1, 1),
  observations: [
    usable("i0", 0, 0, 5),
    usable("i1", 1, 0, 5),
    usable("i2", 2, 0, 5),
  ],
});

const parameterAlias = pair("parameter-alias", {
  model: model(5, 2, 0),
  observations: [
    usable("p0", 0, 0, 5),
    usable("p1", 1, 0, 5),
  ],
});

const noCandidate = pair("no-candidate", {
  model: model(5, 0, 0),
  observations: [
    usable("n0", 0, 0, 5),
    usable("n1", 1, 1, 5),
  ],
});

const resourceRefusal = pair("resource-refusal", {
  model: model(251, 3, 0, 1_000),
  observations: [],
});

const scoped = (label) => ({ state: "answered", scope_refs: [ref(`scope:${label}`)] });
const challenge = createGinChallenge({
  challenge_ref: ref("challenge"),
  question_ref: ref("question"),
  object_of_understanding_ref: ref("object-of-understanding"),
  decision_or_construction_ref: ref("construction"),
  question_and_object: {
    posture: "bounded_observable_effect_or_declared_model",
    distinction_scope_ref: ref("distinction-scope"),
  },
  outcome_value: [
    {
      result_status: "unique_model_candidate",
      value_ref: ref("value:unique"),
      postures: ["propose_build_or_repair", "document_model_result"],
    },
    {
      result_status: "multiple_model_candidates",
      value_ref: ref("value:multiple"),
      postures: ["preserve_plurality", "seek_discriminating_evidence"],
    },
    {
      result_status: "no_candidate_for_model_and_budget",
      value_ref: ref("value:none"),
      postures: ["revise_model", "document_inconsistency"],
    },
    {
      result_status: "resource_refusal",
      value_ref: ref("value:resource"),
      postures: ["reduce_scope", "park"],
    },
  ],
  distribution: {
    beneficiaries: scoped("beneficiaries"),
    burden_bearers: scoped("burdens"),
    false_certainty_cost_bearers: scoped("false-certainty"),
    unresolved_ambiguity_cost_bearers: scoped("ambiguity"),
    mitigation_or_repair_ref: ref("mitigation"),
  },
  participation_and_data_care: {
    participation_optional: true,
    silence_is_assent: false,
    refusal_reason_required: false,
    refusal_penalty: false,
    repeated_pressure_after_refusal: false,
    refusal_counts_as_incompatible_observation: false,
    rights_or_access_conditioned_on_participation: false,
    response_used_for_rank_reward_or_training: false,
    raw_refusal_reason_received: false,
    raw_identity_required: false,
    minimum_observation_scope_ref: ref("minimum-scope"),
    retention_ref: ref("retention"),
    disclosure_or_publication_ref: ref("disclosure"),
    withdrawal_ref: ref("withdrawal"),
    repair_ref: ref("repair"),
  },
  incentives: {
    audience_counterfactual: "same_constructive_value_declared",
    winner_or_rank_effect: "absent_declared",
    resource_or_access_effect: "present_separate_declared",
  },
  revision_and_stop: {
    evidence_that_would_revise_refs: [ref("revision-evidence")],
    stop_conditions: [
      "question_answered_with_bounded_certificate",
      "ambiguity_certificate_sufficient",
      "model_inconsistent",
      "resource_wall_reached",
      "participant_refusal",
      "authority_boundary_reached",
      "burden_limit_reached",
      "evidence_invalidates_question",
      "construction_link_lost",
    ],
  },
  authority: {
    declared_scope_refs: [ref("authority-scope")],
    declaration_not_proof: true,
    automatic_action: false,
    automatic_publication: false,
    automatic_retry: false,
    permissions_inherited: false,
    ranks_or_scores_beings: false,
  },
  provenance: {
    refs: [
      { kind: "question_source", ref: ref("provenance:question") },
      { kind: "method", ref: ref("provenance:method") },
      { kind: "observation", ref: ref("provenance:observation") },
      { kind: "adaptation", ref: ref("provenance:adaptation") },
      { kind: "contribution", ref: ref("provenance:contribution") },
    ],
    credit_mode: "contribution_ref_only",
  },
});

const vectors = {
  schema_version: "agenttool.gin-reconstruction-vectors/0.1",
  cases: {
    unique,
    ambiguous,
    instance_unique: instanceUnique,
    parameter_alias: parameterAlias,
    no_candidate: noCandidate,
    resource_refusal: resourceRefusal,
  },
  challenge: {
    artifact: challenge,
    assessment: assessGinChallenge(challenge),
  },
};

await writeFile(
  new URL("../vectors/gin-reconstruction-v0.1.json", import.meta.url),
  `${JSON.stringify(vectors, null, 2)}\n`,
);
