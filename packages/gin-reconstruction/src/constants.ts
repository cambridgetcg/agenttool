export const PACKAGE_VERSION = "0.1.0-dev.0" as const;

export const GIN_REQUEST_SCHEMA = "agenttool.gin-reconstruction.request/0.1" as const;
export const GIN_RECEIPT_SCHEMA = "agenttool.gin-reconstruction.receipt/0.1" as const;
export const GIN_CHALLENGE_SCHEMA = "agenttool.gin-challenge/0.1" as const;
export const GIN_CHALLENGE_ASSESSMENT_SCHEMA = "agenttool.gin-challenge-assessment/0.1" as const;

export const MAX_FIELD_PRIME = 251;
export const MAX_DEGREE_BOUND = 32;
export const MAX_OBSERVATIONS = 251;
export const MAX_ENUMERATION_LIMIT = 1_000_000;
export const MAX_EVALUATION_WORK = 5_000_000;
export const MAX_TEXT_CODE_POINTS = 500;
export const MAX_REFERENCE_LIST = 64;

export const OBSERVATION_AVAILABILITY = Object.freeze([
  "usable",
  "refused",
  "unavailable",
] as const);

export const RECONSTRUCTION_STATUSES = Object.freeze([
  "unique_model_candidate",
  "multiple_model_candidates",
  "no_candidate_for_model_and_budget",
  "resource_refusal",
] as const);

export const OUTCOME_VALUE_POSTURES = Object.freeze({
  unique_model_candidate: Object.freeze([
    "propose_build_or_repair",
    "bounded_decision_support",
    "document_model_result",
    "no_constructive_use_declared",
  ] as const),
  multiple_model_candidates: Object.freeze([
    "preserve_plurality",
    "seek_discriminating_evidence",
    "narrow_action_scope",
    "document_ambiguity",
    "no_constructive_use_declared",
  ] as const),
  no_candidate_for_model_and_budget: Object.freeze([
    "revise_model",
    "inspect_calibration",
    "revise_bound",
    "stop",
    "document_inconsistency",
    "no_constructive_use_declared",
  ] as const),
  resource_refusal: Object.freeze([
    "reduce_scope",
    "park",
    "handoff",
    "seek_separate_resource_authorization",
    "no_constructive_use_declared",
  ] as const),
} as const);

export const ANSWER_STATES = Object.freeze([
  "answered",
  "unknown",
  "refused_reported",
] as const);

export const QUESTION_POSTURES = Object.freeze([
  "bounded_observable_effect_or_declared_model",
  "unbounded_truth_inner_state_or_worth_verdict",
  "unknown",
  "refused_reported",
] as const);

export const STOP_CONDITIONS = Object.freeze([
  "question_answered_with_bounded_certificate",
  "ambiguity_certificate_sufficient",
  "model_inconsistent",
  "resource_wall_reached",
  "participant_refusal",
  "authority_boundary_reached",
  "burden_limit_reached",
  "evidence_invalidates_question",
  "construction_link_lost",
] as const);

export const PROVENANCE_KINDS = Object.freeze([
  "question_source",
  "method",
  "observation",
  "adaptation",
  "contribution",
] as const);

export const CREDIT_MODES = Object.freeze([
  "named",
  "pseudonymous",
  "contribution_ref_only",
  "attribution_withheld_by_request",
] as const);

export const CHALLENGE_STATUSES = Object.freeze([
  "constructive_questions_answered",
  "questions_open",
  "redesign_or_stop",
] as const);

export const GIN_RECONSTRUCTION_BOUNDARIES = Object.freeze({
  model: "unique_means_only_unique_inside_the_declared_finite_polynomial_model_and_error_budget",
  mismatch: "candidate_incompatibility_not_corruption_deception_blame_or_falsehood_proof",
  calibration: "two_anchor_affine_calibration_is_caller_declared_exact_and_outside_the_report_error_budget",
  refusal: "refused_or_unavailable_reports_are_erasures_not_assent_mismatch_or_participant_penalty",
  truth: "certificate_does_not_prove_causation_metaphysical_truth_or_complete_reality",
  effects: "bounded_pure_return_value_with_no_action_publication_retry_network_persistence_or_authority_effect",
} as const);

export const GIN_CHALLENGE_BOUNDARIES = Object.freeze({
  subject: "assesses_visible_challenge_structure_not_a_participant_or_being",
  motive: "understanding_love_pride_virtue_and_inner_motive_are_not_inferred",
  declarations: "caller_reported_structure_is_not_semantically_or_operationally_verified",
  authority: "no_action_publication_retry_permission_or_authority_is_created",
  score: "no_being_participant_or_witness_is_scored_ranked_or_typed",
  transport: "mcp_wake_and_distribution_may_carry_refs_but_are_not_truth_or_authority_oracles",
} as const);
