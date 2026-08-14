export const PACKAGE_VERSION = "0.1.0-dev.0" as const;

export const MATH_CARD_SCHEMA = "agenttool.math-card/0.1" as const;
export const MATH_CARD_ASSESSMENT_SCHEMA = "agenttool.math-card-assessment/0.1" as const;

export const MAX_JSON_BYTES = 64 * 1024;
export const MAX_JSON_DEPTH = 24;
export const MAX_JSON_NODES = 4_096;
export const MAX_STRING_BYTES = 8 * 1024;
export const MAX_HASH_INPUT_BYTES = 1024 * 1024;
export const MAX_REFERENCE_LIST = 64;
export const MAX_TOTAL_REFERENCES = 256;

export const MATH_METHOD_KINDS = Object.freeze([
  "proof",
  "model",
  "measurement",
] as const);

export const OUTCOME_USE_STATUSES = Object.freeze([
  "bounded_answer",
  "no_bounded_answer",
  "ambiguity_or_non_identifiability",
  "method_or_assumption_failure",
  "resource_or_participation_stop",
] as const);

export const ANSWER_STATES = Object.freeze([
  "answered",
  "unknown",
  "refused_reported",
] as const);

export const QUESTION_POSTURES = Object.freeze([
  "formal_proposition",
  "model_comparison_or_identification",
  "operational_measurement",
] as const);

export const STOP_CONDITIONS = Object.freeze([
  "bounded_answer_reached",
  "no_bounded_answer_is_sufficient",
  "ambiguity_is_sufficient",
  "method_or_assumptions_invalidated",
  "resource_limit_reached",
  "participant_refusal",
  "authority_boundary_reached",
  "burden_limit_reached",
  "construction_link_lost",
] as const);

export const TRANSFER_TARGETS = Object.freeze([
  "none",
  "proof",
  "model",
  "measurement",
  "build_or_decision",
  "handoff",
] as const);

export const AUDIENCE_COUNTERFACTUALS = Object.freeze([
  "same_constructive_value_declared",
  "reduced_but_nonzero_declared",
  "no_audience_independent_value_declared",
  "unknown",
  "refused_reported",
] as const);

export const OUTCOME_COUPLINGS = Object.freeze([
  "absent_declared",
  "present_separate_declared",
  "affects_epistemic_or_action_result_reported",
  "unknown",
  "refused_reported",
] as const);

export const PROVENANCE_KINDS = Object.freeze([
  "question_source",
  "method",
  "evidence",
  "adaptation",
  "contribution",
] as const);

export const CREDIT_MODES = Object.freeze([
  "named",
  "pseudonymous",
  "contribution_ref_only",
  "attribution_withheld_by_request",
] as const);

export const MATH_CARD_STATUSES = Object.freeze([
  "ready_for_bounded_inquiry",
  "questions_open",
  "redesign_or_stop",
] as const);

export const MATH_CARD_BOUNDARIES = Object.freeze({
  subject: "assesses_declared_inquiry_structure_not_a_person_participant_witness_or_being",
  question: "digest_references_bind_exact_external_artifacts_but_do_not_verify_semantics_truth_or_currentness",
  posture: "bounded_question_posture_is_caller_declared_not_semantically_inferred_or_verified",
  proof: "a_formal_result_is_conditional_on_the_declared_system_and_does_not_establish_world_correspondence",
  model: "a_model_result_is_conditional_on_scope_and_assumptions_not_complete_reality_or_causal_truth",
  measurement: "a_measurement_is_bounded_by_operationalization_procedure_calibration_and_uncertainty_not_construct_identity",
  motive: "understanding_love_pride_virtue_consciousness_and_inner_motive_are_not_inferred",
  refusal: "refusal_requires_no_reason_and_never_reduces_rights_dignity_or_standing_while_declared_functional_data_dependency_may_limit_a_result_but_not_punish_refusal",
  transfer: "a_bridge_reference_does_not_inherit_permission_authorize_action_or_prove_a_valid_cross_domain_inference",
  score: "no_being_participant_witness_or_contributor_is_scored_ranked_or_typed",
  effects: "pure_return_values_create_no_action_publication_retry_network_persistence_or_authority_effect",
} as const);
