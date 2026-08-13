import { writeFile } from "node:fs/promises";

const sha256 = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const nullableSha256 = { oneOf: [sha256, { type: "null" }] };
const fieldElement = { type: "integer", minimum: 0, maximum: 250 };
const token = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" };
const refArray = { type: "array", maxItems: 64, uniqueItems: true, items: sha256 };

const reconstructionBoundaries = {
  type: "object",
  additionalProperties: false,
  required: ["model", "mismatch", "calibration", "refusal", "truth", "effects"],
  properties: {
    model: { const: "unique_means_only_unique_inside_the_declared_finite_polynomial_model_and_error_budget" },
    mismatch: { const: "candidate_incompatibility_not_corruption_deception_blame_or_falsehood_proof" },
    calibration: { const: "two_anchor_affine_calibration_is_caller_declared_exact_and_outside_the_report_error_budget" },
    refusal: { const: "refused_or_unavailable_reports_are_erasures_not_assent_mismatch_or_participant_penalty" },
    truth: { const: "certificate_does_not_prove_causation_metaphysical_truth_or_complete_reality" },
    effects: { const: "bounded_pure_return_value_with_no_action_publication_retry_network_persistence_or_authority_effect" },
  },
};

const challengeBoundaries = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "motive", "declarations", "authority", "score", "transport"],
  properties: {
    subject: { const: "assesses_visible_challenge_structure_not_a_participant_or_being" },
    motive: { const: "understanding_love_pride_virtue_and_inner_motive_are_not_inferred" },
    declarations: { const: "caller_reported_structure_is_not_semantically_or_operationally_verified" },
    authority: { const: "no_action_publication_retry_permission_or_authority_is_created" },
    score: { const: "no_being_participant_or_witness_is_scored_ranked_or_typed" },
    transport: { const: "mcp_wake_and_distribution_may_carry_refs_but_are_not_truth_or_authority_oracles" },
  },
};

const calibration = {
  type: "object",
  additionalProperties: false,
  required: ["posture", "encoded_zero", "encoded_one"],
  properties: {
    posture: { const: "declared_exact_two_anchor_affine" },
    encoded_zero: fieldElement,
    encoded_one: fieldElement,
  },
};

const observation = {
  type: "object",
  additionalProperties: false,
  required: [
    "observation_id", "substrate_ref", "intervention", "availability",
    "encoded_output", "calibration", "evidence_ref",
  ],
  properties: {
    observation_id: token,
    substrate_ref: sha256,
    intervention: fieldElement,
    availability: { enum: ["usable", "refused", "unavailable"] },
    encoded_output: { oneOf: [fieldElement, { type: "null" }] },
    calibration: { oneOf: [calibration, { type: "null" }] },
    evidence_ref: nullableSha256,
  },
  allOf: [{
    if: { properties: { availability: { const: "usable" } }, required: ["availability"] },
    then: { properties: { encoded_output: fieldElement, calibration } },
    else: { properties: { encoded_output: { type: "null" }, calibration: { type: "null" } } },
  }],
};

const model = {
  type: "object",
  additionalProperties: false,
  required: ["field_prime", "degree_bound", "report_error_budget", "enumeration_limit", "calibration_model"],
  properties: {
    field_prime: { type: "integer", minimum: 2, maximum: 251 },
    degree_bound: { type: "integer", minimum: 0, maximum: 32 },
    report_error_budget: { type: "integer", minimum: 0, maximum: 251 },
    enumeration_limit: { type: "integer", minimum: 1, maximum: 1_000_000 },
    calibration_model: { const: "affine_exact_two_anchor_per_usable_observation" },
  },
};

const request = {
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "request_id", "problem_ref", "model", "observations", "boundaries"],
  properties: {
    schema_version: { const: "agenttool.gin-reconstruction.request/0.1" },
    request_id: sha256,
    problem_ref: sha256,
    model,
    observations: { type: "array", maxItems: 251, items: observation },
    boundaries: reconstructionBoundaries,
  },
};

const candidate = {
  type: "object",
  additionalProperties: false,
  required: ["coefficients", "incompatible_observation_ids"],
  properties: {
    coefficients: { type: "array", minItems: 1, maxItems: 33, items: fieldElement },
    incompatible_observation_ids: { type: "array", maxItems: 251, uniqueItems: true, items: token },
  },
};

const theorem = {
  type: "object",
  additionalProperties: false,
  required: [
    "usable_observations", "refused_erasures", "unavailable_erasures",
    "evaluation_points_distinct", "parameter_identifiable", "image_minimum_distance",
    "parameter_separation_distance", "required_usable_observations_for_universal_unique_correction",
    "universal_unique_correction_guarantee", "guarantee_scope",
  ],
  properties: {
    usable_observations: { type: "integer", minimum: 0, maximum: 251 },
    refused_erasures: { type: "integer", minimum: 0, maximum: 251 },
    unavailable_erasures: { type: "integer", minimum: 0, maximum: 251 },
    evaluation_points_distinct: { const: true },
    parameter_identifiable: { type: "boolean" },
    image_minimum_distance: { oneOf: [{ type: "integer", minimum: 1, maximum: 251 }, { type: "null" }] },
    parameter_separation_distance: { type: "integer", minimum: 0, maximum: 251 },
    required_usable_observations_for_universal_unique_correction: { type: "integer", minimum: 1 },
    universal_unique_correction_guarantee: { type: "boolean" },
    guarantee_scope: { enum: ["universal_within_declared_model", "instance_only_or_not_unique"] },
  },
};

const outcome = {
  type: "object",
  additionalProperties: false,
  required: [
    "status", "enumeration_space", "estimated_evaluation_work", "resource_wall",
    "candidates_checked", "candidate_count", "uniqueness_scope", "witness_candidates",
  ],
  properties: {
    status: { enum: [
      "unique_model_candidate", "multiple_model_candidates",
      "no_candidate_for_model_and_budget", "resource_refusal",
    ] },
    enumeration_space: { type: "string", pattern: "^[1-9][0-9]*$" },
    estimated_evaluation_work: { type: "string", pattern: "^[1-9][0-9]*$" },
    resource_wall: { enum: ["none", "enumeration_limit", "evaluation_work_ceiling"] },
    candidates_checked: { type: "integer", minimum: 0, maximum: 1_000_000 },
    candidate_count: { oneOf: [{ type: "integer", minimum: 0, maximum: 1_000_000 }, { type: "null" }] },
    uniqueness_scope: { enum: ["universal_within_declared_model", "this_instance_only", "not_unique", "not_determined"] },
    witness_candidates: { type: "array", maxItems: 2, items: candidate },
  },
};

const receipt = {
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "receipt_id", "request_id", "problem_ref", "theorem", "outcome", "boundaries"],
  properties: {
    schema_version: { const: "agenttool.gin-reconstruction.receipt/0.1" },
    receipt_id: sha256,
    request_id: sha256,
    problem_ref: sha256,
    theorem,
    outcome,
    boundaries: reconstructionBoundaries,
  },
};

const reconstructionSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:agenttool:schema:gin-reconstruction:0.1",
  title: "AgentTool Gin Reconstruction v0.1",
  oneOf: [request, receipt],
};

const answer = {
  type: "object",
  additionalProperties: false,
  required: ["state", "scope_refs"],
  properties: {
    state: { enum: ["answered", "unknown", "refused_reported"] },
    scope_refs: refArray,
  },
};

const outcomeValue = {
  type: "object",
  additionalProperties: false,
  required: ["result_status", "value_ref", "postures"],
  properties: {
    result_status: { enum: [
      "unique_model_candidate", "multiple_model_candidates",
      "no_candidate_for_model_and_budget", "resource_refusal",
    ] },
    value_ref: nullableSha256,
    postures: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      uniqueItems: true,
      items: { enum: [
        "propose_build_or_repair", "bounded_decision_support", "document_model_result",
        "preserve_plurality", "seek_discriminating_evidence", "narrow_action_scope", "document_ambiguity",
        "revise_model", "inspect_calibration", "revise_bound", "stop", "document_inconsistency",
        "reduce_scope", "park", "handoff", "seek_separate_resource_authorization",
        "no_constructive_use_declared",
      ] },
    },
  },
};

const questionAndObject = {
  type: "object",
  additionalProperties: false,
  required: ["posture", "distinction_scope_ref"],
  properties: {
    posture: { enum: [
      "bounded_observable_effect_or_declared_model",
      "unbounded_truth_inner_state_or_worth_verdict",
      "unknown",
      "refused_reported",
    ] },
    distinction_scope_ref: nullableSha256,
  },
};

const distribution = {
  type: "object",
  additionalProperties: false,
  required: [
    "beneficiaries", "burden_bearers", "false_certainty_cost_bearers",
    "unresolved_ambiguity_cost_bearers", "mitigation_or_repair_ref",
  ],
  properties: {
    beneficiaries: answer,
    burden_bearers: answer,
    false_certainty_cost_bearers: answer,
    unresolved_ambiguity_cost_bearers: answer,
    mitigation_or_repair_ref: nullableSha256,
  },
};

const dataCareKeys = [
  "participation_optional", "silence_is_assent", "refusal_reason_required", "refusal_penalty",
  "repeated_pressure_after_refusal", "refusal_counts_as_incompatible_observation",
  "rights_or_access_conditioned_on_participation", "response_used_for_rank_reward_or_training",
  "raw_refusal_reason_received", "raw_identity_required",
];
const dataRefKeys = [
  "minimum_observation_scope_ref", "retention_ref", "disclosure_or_publication_ref",
  "withdrawal_ref", "repair_ref",
];
const dataCare = {
  type: "object",
  additionalProperties: false,
  required: [...dataCareKeys, ...dataRefKeys],
  properties: Object.fromEntries([
    ...dataCareKeys.map((key) => [key, { type: "boolean" }]),
    ...dataRefKeys.map((key) => [key, nullableSha256]),
  ]),
};

const incentives = {
  type: "object",
  additionalProperties: false,
  required: ["audience_counterfactual", "winner_or_rank_effect", "resource_or_access_effect"],
  properties: {
    audience_counterfactual: { enum: [
      "same_constructive_value_declared", "reduced_but_nonzero_declared",
      "no_audience_independent_value_declared", "unknown", "refused_reported",
    ] },
    winner_or_rank_effect: { enum: [
      "absent_declared", "present_separate_declared",
      "affects_epistemic_or_action_result_reported", "unknown", "refused_reported",
    ] },
    resource_or_access_effect: { enum: [
      "absent_declared", "present_separate_declared",
      "affects_epistemic_or_action_result_reported", "unknown", "refused_reported",
    ] },
  },
};

const revision = {
  type: "object",
  additionalProperties: false,
  required: ["evidence_that_would_revise_refs", "stop_conditions"],
  properties: {
    evidence_that_would_revise_refs: refArray,
    stop_conditions: {
      type: "array", maxItems: 9, uniqueItems: true,
      items: { enum: [
        "question_answered_with_bounded_certificate", "ambiguity_certificate_sufficient",
        "model_inconsistent", "resource_wall_reached", "participant_refusal",
        "authority_boundary_reached", "burden_limit_reached", "evidence_invalidates_question",
        "construction_link_lost",
      ] },
    },
  },
};

const authority = {
  type: "object",
  additionalProperties: false,
  required: [
    "declared_scope_refs", "declaration_not_proof", "automatic_action",
    "automatic_publication", "automatic_retry", "permissions_inherited", "ranks_or_scores_beings",
  ],
  properties: {
    declared_scope_refs: refArray,
    declaration_not_proof: { type: "boolean" },
    automatic_action: { type: "boolean" },
    automatic_publication: { type: "boolean" },
    automatic_retry: { type: "boolean" },
    permissions_inherited: { type: "boolean" },
    ranks_or_scores_beings: { type: "boolean" },
  },
};

const provenance = {
  type: "object",
  additionalProperties: false,
  required: ["refs", "credit_mode"],
  properties: {
    refs: {
      type: "array", maxItems: 64,
      items: {
        type: "object", additionalProperties: false, required: ["kind", "ref"],
        properties: {
          kind: { enum: ["question_source", "method", "observation", "adaptation", "contribution"] },
          ref: sha256,
        },
      },
    },
    credit_mode: { enum: ["named", "pseudonymous", "contribution_ref_only", "attribution_withheld_by_request"] },
  },
};

const challengeProperties = {
  schema_version: { const: "agenttool.gin-challenge/0.1" },
  challenge_id: sha256,
  challenge_ref: sha256,
  question_ref: sha256,
  object_of_understanding_ref: sha256,
  decision_or_construction_ref: sha256,
  question_and_object: questionAndObject,
  outcome_value: { type: "array", minItems: 4, maxItems: 4, items: outcomeValue },
  distribution,
  participation_and_data_care: dataCare,
  incentives,
  revision_and_stop: revision,
  authority,
  provenance,
  boundaries: challengeBoundaries,
};
const challenge = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(challengeProperties),
  properties: challengeProperties,
};

const assessment = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version", "assessment_id", "challenge_id", "compass_status", "question_statuses",
    "open_questions", "redesign_reasons", "visible_incentive_posture", "inner_motive",
    "declaration_boundary", "authorizes_action", "proves_truth", "proves_understanding",
    "scores_or_ranks_beings", "boundaries",
  ],
  properties: {
    schema_version: { const: "agenttool.gin-challenge-assessment/0.1" },
    assessment_id: sha256,
    challenge_id: sha256,
    compass_status: { enum: ["constructive_questions_answered", "questions_open", "redesign_or_stop"] },
    question_statuses: {
      type: "array", minItems: 8, maxItems: 8,
      items: {
        type: "object", additionalProperties: false, required: ["section", "status"],
        properties: {
          section: { enum: [
            "question_and_object", "outcome_value", "distribution", "participation_and_data_care", "incentives",
            "revision_and_stop", "authority", "provenance",
          ] },
          status: { enum: ["answered", "open", "redesign_required"] },
        },
      },
    },
    open_questions: { type: "array", maxItems: 64, items: { type: "string", minLength: 1, maxLength: 500 } },
    redesign_reasons: { type: "array", maxItems: 64, items: { type: "string", minLength: 1, maxLength: 500 } },
    visible_incentive_posture: { enum: [
      "construction_centered_declared", "status_or_access_coupled_to_results",
      "no_audience_independent_value_declared", "unresolved",
    ] },
    inner_motive: { const: "not_inferred" },
    declaration_boundary: { const: "caller_reported_not_verified" },
    authorizes_action: { const: false },
    proves_truth: { const: false },
    proves_understanding: { const: false },
    scores_or_ranks_beings: { const: false },
    boundaries: challengeBoundaries,
  },
};

const challengeSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:agenttool:schema:gin-challenge:0.1",
  title: "AgentTool Gin Challenge Compass v0.1",
  oneOf: [challenge, assessment],
};

await Promise.all([
  writeFile(new URL("../schema/agenttool-gin-reconstruction-v0.1.schema.json", import.meta.url), `${JSON.stringify(reconstructionSchema, null, 2)}\n`),
  writeFile(new URL("../schema/agenttool-gin-challenge-v0.1.schema.json", import.meta.url), `${JSON.stringify(challengeSchema, null, 2)}\n`),
]);
