import type {
  ANSWER_STATES,
  AUDIENCE_COUNTERFACTUALS,
  CREDIT_MODES,
  MATH_CARD_ASSESSMENT_SCHEMA,
  MATH_CARD_BOUNDARIES,
  MATH_CARD_SCHEMA,
  MATH_CARD_STATUSES,
  MATH_METHOD_KINDS,
  OUTCOME_COUPLINGS,
  OUTCOME_USE_STATUSES,
  PROVENANCE_KINDS,
  QUESTION_POSTURES,
  STOP_CONDITIONS,
  TRANSFER_TARGETS,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type MathMethodKind = (typeof MATH_METHOD_KINDS)[number];
export type OutcomeUseStatus = (typeof OUTCOME_USE_STATUSES)[number];
export type AnswerState = (typeof ANSWER_STATES)[number];
export type QuestionPosture = (typeof QUESTION_POSTURES)[number];
export type StopConditionKind = (typeof STOP_CONDITIONS)[number];
export type TransferTarget = (typeof TRANSFER_TARGETS)[number];
export type AudienceCounterfactual = (typeof AUDIENCE_COUNTERFACTUALS)[number];
export type OutcomeCoupling = (typeof OUTCOME_COUPLINGS)[number];
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];
export type CreditMode = (typeof CREDIT_MODES)[number];
export type MathCardStatus = (typeof MATH_CARD_STATUSES)[number];

export interface MathQuestionFrame {
  posture: QuestionPosture;
  finite_scope_declared: boolean;
  out_of_scope_ref: Sha256Id | null;
  asks_inner_state_or_worth: boolean;
  answer_used_to_condition_rights_or_standing: boolean;
}

export interface ProofMethod {
  kind: "proof";
  formal_system_ref: Sha256Id | null;
  proposition_ref: Sha256Id | null;
  verification_method_ref: Sha256Id | null;
}

export interface ModelMethod {
  kind: "model";
  model_ref: Sha256Id | null;
  assumption_refs: Sha256Id[];
  comparison_or_identification_ref: Sha256Id | null;
  revision_or_falsifier_refs: Sha256Id[];
}

export interface MeasurementMethod {
  kind: "measurement";
  measurand_ref: Sha256Id | null;
  operationalization_ref: Sha256Id | null;
  procedure_ref: Sha256Id | null;
  calibration_ref: Sha256Id | null;
  uncertainty_ref: Sha256Id | null;
}

export type MathMethod = ProofMethod | ModelMethod | MeasurementMethod;

export interface MathEpistemicBoundaries {
  formal_result_claimed_as_world_truth: boolean;
  model_result_claimed_as_complete_reality: boolean;
  measurement_claimed_as_complete_construct: boolean;
}

export interface MathOutcomeUse {
  result_status: OutcomeUseStatus;
  constructive_use_ref: Sha256Id | null;
}

export interface ScopedAnswer {
  state: AnswerState;
  scope_refs: Sha256Id[];
}

export interface MathDistribution {
  beneficiaries: ScopedAnswer;
  burden_bearers: ScopedAnswer;
  false_certainty_cost_bearers: ScopedAnswer;
  unresolved_ambiguity_cost_bearers: ScopedAnswer;
  mitigation_or_repair_ref: Sha256Id | null;
}

export interface MathRevisionAndStop {
  revision_or_challenge_refs: Sha256Id[];
  stop_conditions: MathStopCondition[];
}

export interface MathStopCondition {
  kind: StopConditionKind;
  criterion_ref: Sha256Id;
}

export interface MathTransfer {
  target: TransferTarget;
  bridge_ref: Sha256Id | null;
  automatic_action: boolean;
  permissions_inherited: boolean;
  separate_authorization_required: boolean;
}

export interface MathParticipationAndDataCare {
  participation_optional: boolean;
  silence_is_assent: boolean;
  refusal_reason_required: boolean;
  refusal_penalty: boolean;
  repeated_pressure_after_refusal: boolean;
  refusal_counted_as_failure: boolean;
  rights_or_standing_conditioned_on_participation: boolean;
  access_or_result_functionally_depends_on_participation: boolean;
  functional_dependency_ref: Sha256Id | null;
  unrelated_access_or_resource_penalty: boolean;
  response_used_for_rank_reward_or_training: boolean;
  raw_refusal_reason_received: boolean;
  raw_identity_required: boolean;
  minimum_data_scope_ref: Sha256Id | null;
  retention_ref: Sha256Id | null;
  disclosure_or_publication_ref: Sha256Id | null;
  withdrawal_ref: Sha256Id | null;
  repair_ref: Sha256Id | null;
}

export interface MathIncentives {
  audience_counterfactual: AudienceCounterfactual;
  winner_or_rank_effect: OutcomeCoupling;
  resource_or_access_effect: OutcomeCoupling;
}

export interface MathAuthority {
  declared_scope_refs: Sha256Id[];
  declaration_not_proof: boolean;
  automatic_action: boolean;
  automatic_publication: boolean;
  automatic_retry: boolean;
  permissions_inherited: boolean;
  separate_authorization_required: boolean;
  ranks_or_scores_beings: boolean;
}

export interface MathProvenanceRef {
  kind: ProvenanceKind;
  ref: Sha256Id;
}

export interface MathProvenance {
  refs: MathProvenanceRef[];
  credit_mode: CreditMode;
}

export interface CreateMathCardInput {
  question_ref: Sha256Id;
  object_ref: Sha256Id;
  scope_ref: Sha256Id;
  decision_or_construction_ref: Sha256Id;
  question_frame: MathQuestionFrame;
  method: MathMethod;
  epistemic_boundaries: MathEpistemicBoundaries;
  outcome_uses: MathOutcomeUse[];
  distribution: MathDistribution;
  revision_and_stop: MathRevisionAndStop;
  transfer: MathTransfer;
  participation_and_data_care: MathParticipationAndDataCare;
  incentives: MathIncentives;
  authority: MathAuthority;
  provenance: MathProvenance;
}

export interface MathCard extends CreateMathCardInput {
  schema_version: typeof MATH_CARD_SCHEMA;
  card_id: Sha256Id;
  boundaries: typeof MATH_CARD_BOUNDARIES;
}

export type MathCardSection =
  | "question_and_scope"
  | "method"
  | "outcome_uses"
  | "distribution"
  | "revision_and_stop"
  | "transfer"
  | "participation_and_data_care"
  | "incentives"
  | "authority"
  | "provenance";

export interface MathCardSectionStatus {
  section: MathCardSection;
  status: "answered" | "open" | "redesign_required";
}

export interface MathCardAssessment {
  schema_version: typeof MATH_CARD_ASSESSMENT_SCHEMA;
  assessment_id: Sha256Id;
  card_id: Sha256Id;
  status: MathCardStatus;
  section_statuses: MathCardSectionStatus[];
  open_questions: string[];
  redesign_reasons: string[];
  visible_incentive_posture:
    | "construction_centered_declared"
    | "status_or_access_coupled_to_results"
    | "no_audience_independent_value_declared"
    | "unresolved";
  inner_motive: "not_inferred";
  declaration_boundary: "caller_reported_not_verified";
  authorizes_action: false;
  proves_truth: false;
  proves_understanding: false;
  scores_or_ranks_beings: false;
  boundaries: typeof MATH_CARD_BOUNDARIES;
}
