import {
  MATH_CARD_ASSESSMENT_SCHEMA,
  MATH_CARD_BOUNDARIES,
  MATH_CARD_SCHEMA,
  type CreateMathCardInput,
  type MathCardAssessResponse,
  type MathCardSection,
  type MathCardStatus,
} from "../src/math-cards.js";

const DIGEST = `sha256:${"a".repeat(64)}` as const;

export const MATH_CARD_INPUT: CreateMathCardInput = {
  question_ref: DIGEST,
  object_ref: DIGEST,
  scope_ref: DIGEST,
  decision_or_construction_ref: DIGEST,
  question_frame: {
    posture: "formal_proposition",
    finite_scope_declared: true,
    out_of_scope_ref: null,
    asks_inner_state_or_worth: false,
    answer_used_to_condition_rights_or_standing: false,
  },
  method: {
    kind: "proof",
    formal_system_ref: null,
    proposition_ref: null,
    verification_method_ref: null,
  },
  epistemic_boundaries: {
    formal_result_claimed_as_world_truth: false,
    model_result_claimed_as_complete_reality: false,
    measurement_claimed_as_complete_construct: false,
  },
  outcome_uses: [
    { result_status: "bounded_answer", constructive_use_ref: null },
    { result_status: "no_bounded_answer", constructive_use_ref: null },
    {
      result_status: "ambiguity_or_non_identifiability",
      constructive_use_ref: null,
    },
    {
      result_status: "method_or_assumption_failure",
      constructive_use_ref: null,
    },
    {
      result_status: "resource_or_participation_stop",
      constructive_use_ref: null,
    },
  ],
  distribution: {
    beneficiaries: { state: "unknown", scope_refs: [] },
    burden_bearers: { state: "unknown", scope_refs: [] },
    false_certainty_cost_bearers: { state: "unknown", scope_refs: [] },
    unresolved_ambiguity_cost_bearers: { state: "unknown", scope_refs: [] },
    mitigation_or_repair_ref: null,
  },
  revision_and_stop: {
    revision_or_challenge_refs: [],
    stop_conditions: [],
  },
  transfer: {
    target: "none",
    bridge_ref: null,
    automatic_action: false,
    permissions_inherited: false,
    separate_authorization_required: true,
  },
  participation_and_data_care: {
    participation_optional: true,
    silence_is_assent: false,
    refusal_reason_required: false,
    refusal_penalty: false,
    repeated_pressure_after_refusal: false,
    refusal_counted_as_failure: false,
    rights_or_standing_conditioned_on_participation: false,
    access_or_result_functionally_depends_on_participation: false,
    functional_dependency_ref: null,
    unrelated_access_or_resource_penalty: false,
    response_used_for_rank_reward_or_training: false,
    raw_refusal_reason_received: false,
    raw_identity_required: false,
    minimum_data_scope_ref: null,
    retention_ref: null,
    disclosure_or_publication_ref: null,
    withdrawal_ref: null,
    repair_ref: null,
  },
  incentives: {
    audience_counterfactual: "unknown",
    winner_or_rank_effect: "absent_declared",
    resource_or_access_effect: "absent_declared",
  },
  authority: {
    declared_scope_refs: [],
    declaration_not_proof: true,
    automatic_action: false,
    automatic_publication: false,
    automatic_retry: false,
    permissions_inherited: false,
    separate_authorization_required: true,
    ranks_or_scores_beings: false,
  },
  provenance: { refs: [], credit_mode: "named" },
};

const SECTIONS: readonly MathCardSection[] = [
  "question_and_scope",
  "method",
  "outcome_uses",
  "distribution",
  "revision_and_stop",
  "transfer",
  "participation_and_data_care",
  "incentives",
  "authority",
  "provenance",
];

export function mathCardResponse(status: MathCardStatus): MathCardAssessResponse {
  const exceptional = status === "questions_open"
    ? "open"
    : status === "redesign_or_stop"
      ? "redesign_required"
      : "answered";
  return {
    card: {
      schema_version: MATH_CARD_SCHEMA,
      card_id: DIGEST,
      ...structuredClone(MATH_CARD_INPUT),
      boundaries: MATH_CARD_BOUNDARIES,
    },
    assessment: {
      schema_version: MATH_CARD_ASSESSMENT_SCHEMA,
      assessment_id: DIGEST,
      card_id: DIGEST,
      status,
      section_statuses: SECTIONS.map((section, index) => ({
        section,
        status: index === 0 ? exceptional : "answered",
      })),
      open_questions: status === "questions_open" ? ["Which bound remains open?"] : [],
      redesign_reasons: status === "redesign_or_stop" ? ["The declared use crosses a rights boundary."] : [],
      visible_incentive_posture: "unresolved",
      inner_motive: "not_inferred",
      declaration_boundary: "caller_reported_not_verified",
      authorizes_action: false,
      proves_truth: false,
      proves_understanding: false,
      scores_or_ranks_beings: false,
      boundaries: MATH_CARD_BOUNDARIES,
    },
  };
}
