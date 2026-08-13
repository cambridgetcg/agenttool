import type {
  ANSWER_STATES,
  CHALLENGE_STATUSES,
  CREDIT_MODES,
  GIN_CHALLENGE_ASSESSMENT_SCHEMA,
  GIN_CHALLENGE_BOUNDARIES,
  GIN_CHALLENGE_SCHEMA,
  GIN_RECEIPT_SCHEMA,
  GIN_RECONSTRUCTION_BOUNDARIES,
  GIN_REQUEST_SCHEMA,
  OBSERVATION_AVAILABILITY,
  OUTCOME_VALUE_POSTURES,
  PROVENANCE_KINDS,
  QUESTION_POSTURES,
  RECONSTRUCTION_STATUSES,
  STOP_CONDITIONS,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type ObservationAvailability = (typeof OBSERVATION_AVAILABILITY)[number];
export type ReconstructionStatus = (typeof RECONSTRUCTION_STATUSES)[number];
export type AnswerState = (typeof ANSWER_STATES)[number];
export type StopCondition = (typeof STOP_CONDITIONS)[number];
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];
export type CreditMode = (typeof CREDIT_MODES)[number];
export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number];
export type QuestionPosture = (typeof QUESTION_POSTURES)[number];

export interface AffineCalibration {
  posture: "declared_exact_two_anchor_affine";
  encoded_zero: number;
  encoded_one: number;
}

export interface GinObservation {
  observation_id: string;
  substrate_ref: Sha256Id;
  intervention: number;
  availability: ObservationAvailability;
  encoded_output: number | null;
  calibration: AffineCalibration | null;
  evidence_ref: Sha256Id | null;
}

export interface GinReconstructionModel {
  field_prime: number;
  degree_bound: number;
  report_error_budget: number;
  enumeration_limit: number;
  calibration_model: "affine_exact_two_anchor_per_usable_observation";
}

export interface CreateGinReconstructionRequestInput {
  problem_ref: Sha256Id;
  model: GinReconstructionModel;
  observations: GinObservation[];
}

export interface GinReconstructionRequest extends CreateGinReconstructionRequestInput {
  schema_version: typeof GIN_REQUEST_SCHEMA;
  request_id: Sha256Id;
  boundaries: typeof GIN_RECONSTRUCTION_BOUNDARIES;
}

export interface GinCandidateWitness {
  coefficients: number[];
  incompatible_observation_ids: string[];
}

export interface GinReconstructionTheorem {
  usable_observations: number;
  refused_erasures: number;
  unavailable_erasures: number;
  evaluation_points_distinct: true;
  parameter_identifiable: boolean;
  image_minimum_distance: number | null;
  parameter_separation_distance: number;
  required_usable_observations_for_universal_unique_correction: number;
  universal_unique_correction_guarantee: boolean;
  guarantee_scope: "universal_within_declared_model" | "instance_only_or_not_unique";
}

export interface GinReconstructionOutcome {
  status: ReconstructionStatus;
  enumeration_space: string;
  estimated_evaluation_work: string;
  resource_wall: "none" | "enumeration_limit" | "evaluation_work_ceiling";
  candidates_checked: number;
  candidate_count: number | null;
  uniqueness_scope: "universal_within_declared_model" | "this_instance_only" | "not_unique" | "not_determined";
  witness_candidates: GinCandidateWitness[];
}

export interface GinReconstructionReceipt {
  schema_version: typeof GIN_RECEIPT_SCHEMA;
  receipt_id: Sha256Id;
  request_id: Sha256Id;
  problem_ref: Sha256Id;
  theorem: GinReconstructionTheorem;
  outcome: GinReconstructionOutcome;
  boundaries: typeof GIN_RECONSTRUCTION_BOUNDARIES;
}

export type OutcomeValuePosture = {
  [K in ReconstructionStatus]: (typeof OUTCOME_VALUE_POSTURES)[K][number]
}[ReconstructionStatus];

export interface GinOutcomeValue {
  result_status: ReconstructionStatus;
  value_ref: Sha256Id | null;
  postures: OutcomeValuePosture[];
}

export interface GinQuestionAndObject {
  posture: QuestionPosture;
  distinction_scope_ref: Sha256Id | null;
}

export interface ScopedAnswer {
  state: AnswerState;
  scope_refs: Sha256Id[];
}

export interface GinDistributionAnswers {
  beneficiaries: ScopedAnswer;
  burden_bearers: ScopedAnswer;
  false_certainty_cost_bearers: ScopedAnswer;
  unresolved_ambiguity_cost_bearers: ScopedAnswer;
  mitigation_or_repair_ref: Sha256Id | null;
}

export interface GinParticipationAndDataCare {
  participation_optional: boolean;
  silence_is_assent: boolean;
  refusal_reason_required: boolean;
  refusal_penalty: boolean;
  repeated_pressure_after_refusal: boolean;
  refusal_counts_as_incompatible_observation: boolean;
  rights_or_access_conditioned_on_participation: boolean;
  response_used_for_rank_reward_or_training: boolean;
  raw_refusal_reason_received: boolean;
  raw_identity_required: boolean;
  minimum_observation_scope_ref: Sha256Id | null;
  retention_ref: Sha256Id | null;
  disclosure_or_publication_ref: Sha256Id | null;
  withdrawal_ref: Sha256Id | null;
  repair_ref: Sha256Id | null;
}

export type AudienceCounterfactual =
  | "same_constructive_value_declared"
  | "reduced_but_nonzero_declared"
  | "no_audience_independent_value_declared"
  | "unknown"
  | "refused_reported";

export type OutcomeCoupling =
  | "absent_declared"
  | "present_separate_declared"
  | "affects_epistemic_or_action_result_reported"
  | "unknown"
  | "refused_reported";

export interface GinIncentives {
  audience_counterfactual: AudienceCounterfactual;
  winner_or_rank_effect: OutcomeCoupling;
  resource_or_access_effect: OutcomeCoupling;
}

export interface GinRevisionAndStop {
  evidence_that_would_revise_refs: Sha256Id[];
  stop_conditions: StopCondition[];
}

export interface GinAuthorityDeclaration {
  declared_scope_refs: Sha256Id[];
  declaration_not_proof: boolean;
  automatic_action: boolean;
  automatic_publication: boolean;
  automatic_retry: boolean;
  permissions_inherited: boolean;
  ranks_or_scores_beings: boolean;
}

export interface GinProvenanceRef {
  kind: ProvenanceKind;
  ref: Sha256Id;
}

export interface GinProvenance {
  refs: GinProvenanceRef[];
  credit_mode: CreditMode;
}

export interface CreateGinChallengeInput {
  challenge_ref: Sha256Id;
  question_ref: Sha256Id;
  object_of_understanding_ref: Sha256Id;
  decision_or_construction_ref: Sha256Id;
  question_and_object: GinQuestionAndObject;
  outcome_value: GinOutcomeValue[];
  distribution: GinDistributionAnswers;
  participation_and_data_care: GinParticipationAndDataCare;
  incentives: GinIncentives;
  revision_and_stop: GinRevisionAndStop;
  authority: GinAuthorityDeclaration;
  provenance: GinProvenance;
}

export interface GinChallenge extends CreateGinChallengeInput {
  schema_version: typeof GIN_CHALLENGE_SCHEMA;
  challenge_id: Sha256Id;
  boundaries: typeof GIN_CHALLENGE_BOUNDARIES;
}

export type CompassSection =
  | "question_and_object"
  | "outcome_value"
  | "distribution"
  | "participation_and_data_care"
  | "incentives"
  | "revision_and_stop"
  | "authority"
  | "provenance";

export interface GinCompassQuestionStatus {
  section: CompassSection;
  status: "answered" | "open" | "redesign_required";
}

export interface GinChallengeAssessment {
  schema_version: typeof GIN_CHALLENGE_ASSESSMENT_SCHEMA;
  assessment_id: Sha256Id;
  challenge_id: Sha256Id;
  compass_status: ChallengeStatus;
  question_statuses: GinCompassQuestionStatus[];
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
  boundaries: typeof GIN_CHALLENGE_BOUNDARIES;
}
