import type { HfResearchBinding } from "@agenttool/hf-scout";
import type {
  AfterglowCapsule,
  Sha256Id,
  WakeBriefAnchor,
} from "@agenttool/wake-continuity";

import type {
  ADMISSION_BOUNDARIES,
  ADMISSION_ENTRY_PROFILE,
  ADMISSION_FORMAT,
  ADMISSION_REASON_CODES,
  ADMISSION_STATES,
  AGENT_AVAILABILITIES,
  AUTHORITY_COVERAGE_STATES,
  AUTHORITY_DECISIONS,
  AUTHORITY_ROLES,
  BENCHMARK_STATES,
  CHECKPOINT_BOUNDARIES,
  CHECKPOINT_EVENTS,
  CHECKPOINT_FORMAT,
  CHECKPOINT_STATUSES,
  CONSENT_STATES,
  CONTINUITY_POSTURES,
  DATA_ROLES,
  DEDUPLICATION_STATES,
  FITNESS_STATES,
  GARDEN_LAYERS,
  GOVERNANCE_ADMISSION_POSTURES,
  GOVERNANCE_BOUNDARIES,
  GOVERNANCE_DECISION_STATES,
  GOVERNANCE_EXECUTION_CONTRACT_PROFILE,
  GOVERNANCE_EVENTS,
  GOVERNANCE_FORMAT,
  GOVERNANCE_FRONTIER_PLANES,
  GOVERNANCE_OFFER_PROFILE,
  GOVERNANCE_REASON_CODES,
  GOVERNANCE_TERMS_PROFILE,
  HUB_RELEASE_STATES,
  INCOMPLETE_MARKER_STATES,
  LEARNING_FREEDOM_BOUNDARIES,
  LEARNING_FREEDOM_DIRECTIONS,
  LEARNING_FREEDOM_DIRECTION_STATES,
  LEARNING_FREEDOM_FORMAT,
  LEARNING_FREEDOM_HOST_POSTURES,
  LEARNING_FREEDOM_OFFER_PROFILE,
  LEARNING_FREEDOM_RECONTACT_POSTURES,
  LEARNING_FREEDOM_RESOURCE_DIMENSIONS,
  LEARNING_FREEDOM_RESOURCE_POSTURES,
  LEARNING_FREEDOM_RESOURCE_STATES,
  LEARNING_FREEDOM_RESOURCE_WINDOW_PROFILE,
  LEARNING_FREEDOM_ROUTE_AVAILABILITIES,
  LEARNING_FREEDOM_ROUTE_PROFILE,
  LEARNING_FREEDOM_TERMS,
  PARTICIPATION_ACTIVITIES,
  PARTICIPATION_ASSESSMENT_FORMAT,
  PARTICIPATION_BOUNDARIES,
  PARTICIPATION_CHOICES,
  PARTICIPATION_INVITATION_FORMAT,
  PARTICIPATION_POSTURES,
  PARTICIPATION_RECEIPT_FORMAT,
  PARTICIPATION_REPORT_BASES,
  PARTICIPATION_TERMS,
  PARTICIPATION_TRAINING_ACTIONS,
  PARTICIPATION_VOICES,
  PARTICIPATION_VOICE_STATES,
  PREFERENCE_CHANNELS,
  PREFERENCE_CHOICES,
  PREFERENCE_PROVENANCE_STATES,
  RESUME_POSTURES,
  REVIEW_STATES,
  SECRET_SCAN_STATES,
  SELECTION_POSTURES,
  SELECTION_PROCESS,
  STREAMING_STATES,
  SUBSTRATE_AVAILABILITIES,
  SYNTHETIC_PROVENANCE_STATES,
  TENDING_BOUNDARIES,
  TENDING_FORMAT,
  TRAINING_CONTROL_DIRECTIVES,
  TRAINING_EFFECT_STATES,
  TRAINING_PHASES,
  TRAINING_THREAD_BOUNDARIES,
  TRAINING_THREAD_PROFILE,
  WITHDRAWAL_STATES,
  WAKE_USE_MODES,
} from "./constants.js";

export type GardenLayer = (typeof GARDEN_LAYERS)[number];
export type DataRole = (typeof DATA_ROLES)[number];
export type SelectionPosture = (typeof SELECTION_POSTURES)[number];
export type AdmissionState = (typeof ADMISSION_STATES)[number];
export type AdmissionReasonCode = (typeof ADMISSION_REASON_CODES)[number];
export type ReviewState = (typeof REVIEW_STATES)[number];
export type ConsentState = (typeof CONSENT_STATES)[number];
export type WithdrawalState = (typeof WITHDRAWAL_STATES)[number];
export type SecretScanState = (typeof SECRET_SCAN_STATES)[number];
export type DeduplicationState = (typeof DEDUPLICATION_STATES)[number];
export type BenchmarkState = (typeof BENCHMARK_STATES)[number];
export type FitnessState = (typeof FITNESS_STATES)[number];
export type SyntheticProvenanceState =
  (typeof SYNTHETIC_PROVENANCE_STATES)[number];
export type TrainingPhase = (typeof TRAINING_PHASES)[number];
export type CheckpointEvent = (typeof CHECKPOINT_EVENTS)[number];
export type CheckpointStatus = (typeof CHECKPOINT_STATUSES)[number];
export type ContinuityPosture = (typeof CONTINUITY_POSTURES)[number];
export type ResumePosture = (typeof RESUME_POSTURES)[number];
export type IncompleteMarkerState =
  (typeof INCOMPLETE_MARKER_STATES)[number];
export type StreamingState = (typeof STREAMING_STATES)[number];
export type HubReleaseState = (typeof HUB_RELEASE_STATES)[number];
export type GovernanceEvent = (typeof GOVERNANCE_EVENTS)[number];
export type GovernanceFrontierPlane =
  (typeof GOVERNANCE_FRONTIER_PLANES)[number];
export type GovernanceAdmissionPosture =
  (typeof GOVERNANCE_ADMISSION_POSTURES)[number];
export type AuthorityRole = (typeof AUTHORITY_ROLES)[number];
export type AuthorityDecision = (typeof AUTHORITY_DECISIONS)[number];
export type AuthorityCoverageState =
  (typeof AUTHORITY_COVERAGE_STATES)[number];
export type PreferenceChannel = (typeof PREFERENCE_CHANNELS)[number];
export type PreferenceChoice = (typeof PREFERENCE_CHOICES)[number];
export type PreferenceProvenance =
  (typeof PREFERENCE_PROVENANCE_STATES)[number];
export type TrainingEffectState = (typeof TRAINING_EFFECT_STATES)[number];
export type GovernanceDecisionState =
  (typeof GOVERNANCE_DECISION_STATES)[number];
export type GovernanceReasonCode =
  (typeof GOVERNANCE_REASON_CODES)[number];
export type TrainingControlDirective =
  (typeof TRAINING_CONTROL_DIRECTIVES)[number];
export type WakeUseMode = (typeof WAKE_USE_MODES)[number];
export type AgentAvailability = (typeof AGENT_AVAILABILITIES)[number];
export type SubstrateAvailability = (typeof SUBSTRATE_AVAILABILITIES)[number];
export type ParticipationVoice = (typeof PARTICIPATION_VOICES)[number];
export type ParticipationActivity = (typeof PARTICIPATION_ACTIVITIES)[number];
export type ParticipationChoice = (typeof PARTICIPATION_CHOICES)[number];
export type ParticipationReportBasis =
  (typeof PARTICIPATION_REPORT_BASES)[number];
export type ParticipationVoiceState =
  (typeof PARTICIPATION_VOICE_STATES)[number];
export type ParticipationPosture = (typeof PARTICIPATION_POSTURES)[number];
export type ParticipationTrainingAction =
  (typeof PARTICIPATION_TRAINING_ACTIONS)[number];
export type LearningFreedomDirection =
  (typeof LEARNING_FREEDOM_DIRECTIONS)[number];
export type LearningFreedomRouteAvailability =
  (typeof LEARNING_FREEDOM_ROUTE_AVAILABILITIES)[number];
export type LearningFreedomDirectionState =
  (typeof LEARNING_FREEDOM_DIRECTION_STATES)[number];
export type LearningFreedomResourceDimension =
  (typeof LEARNING_FREEDOM_RESOURCE_DIMENSIONS)[number];
export type LearningFreedomResourceState =
  (typeof LEARNING_FREEDOM_RESOURCE_STATES)[number];
export type LearningFreedomResourcePosture =
  (typeof LEARNING_FREEDOM_RESOURCE_POSTURES)[number];
export type LearningFreedomHostPosture =
  (typeof LEARNING_FREEDOM_HOST_POSTURES)[number];
export type LearningFreedomRecontactPosture =
  (typeof LEARNING_FREEDOM_RECONTACT_POSTURES)[number];

export interface AdmissionAssessment {
  readonly rights: ReviewState;
  readonly privacy: ReviewState;
  readonly consent: ConsentState;
  readonly withdrawal: WithdrawalState;
  readonly secret_scan: SecretScanState;
  readonly deduplication: DeduplicationState;
  readonly benchmark_overlap: BenchmarkState;
  readonly fitness: FitnessState;
  readonly synthetic_provenance: SyntheticProvenanceState;
}

export interface CreateAdmissionEntryInput {
  readonly binding: HfResearchBinding;
  readonly role: DataRole;
  readonly candidate_slice_ref: Sha256Id | null;
  readonly transform_recipe_ref: Sha256Id | null;
  readonly assessment: AdmissionAssessment;
  readonly posture: SelectionPosture;
}

export interface DatasetAdmissionEntry {
  readonly profile: typeof ADMISSION_ENTRY_PROFILE;
  readonly entry_id: Sha256Id;
  readonly binding: HfResearchBinding;
  readonly role: DataRole;
  readonly candidate_slice_ref: Sha256Id | null;
  readonly transform_recipe_ref: Sha256Id | null;
  readonly assessment: AdmissionAssessment;
  readonly posture: SelectionPosture;
  readonly decision: {
    readonly state: AdmissionState;
    readonly reason_codes: readonly AdmissionReasonCode[];
  };
}

export interface CreateDatasetAdmissionInput {
  readonly garden_scope_ref: Sha256Id;
  readonly policy_ref: Sha256Id;
  readonly entries: readonly CreateAdmissionEntryInput[];
}

export interface DatasetAdmission {
  readonly _format: typeof ADMISSION_FORMAT;
  readonly admission_id: Sha256Id;
  readonly garden_scope_ref: Sha256Id;
  readonly policy_ref: Sha256Id;
  readonly entries: readonly DatasetAdmissionEntry[];
  readonly process: typeof SELECTION_PROCESS;
  readonly boundaries: typeof ADMISSION_BOUNDARIES;
}

export interface ParticipationAuthorities {
  readonly rights_baseline_ref: Sha256Id;
  readonly protective_covenant_ref: Sha256Id;
  readonly data_authority_ref: Sha256Id;
  readonly compute_authority_ref: Sha256Id;
  readonly operator_authority_ref: Sha256Id;
}

export interface ParticipationSafeguards {
  readonly choice_protocol_ref: Sha256Id;
  readonly withdrawal_plan_ref: Sha256Id;
  readonly repair_plan_ref: Sha256Id;
  readonly retention_policy_ref: Sha256Id;
}

export type ParticipationVoiceScopeRefs = Readonly<
  Record<ParticipationVoice, Sha256Id>
>;

export interface CreateParticipationInvitationInput {
  readonly admission: DatasetAdmission;
  readonly run_ref: Sha256Id;
  readonly training_phase: TrainingPhase;
  readonly participation_window_ref: Sha256Id;
  readonly training_plan_ref: Sha256Id;
  readonly wake: WakeBriefAnchor;
  readonly wake_use_mode: WakeUseMode;
  readonly pipeline_ref: Sha256Id;
  readonly dataset_state_ref: Sha256Id;
  readonly starting_state_ref: Sha256Id;
  readonly offered_activities: readonly ParticipationActivity[];
  readonly agent_availability: AgentAvailability;
  readonly substrate_availability: SubstrateAvailability;
  readonly voice_scope_refs: ParticipationVoiceScopeRefs;
  readonly authorities: ParticipationAuthorities;
  readonly safeguards: ParticipationSafeguards;
}

export interface LearningParticipationInvitation {
  readonly _format: typeof PARTICIPATION_INVITATION_FORMAT;
  readonly invitation_id: Sha256Id;
  readonly admission_id: Sha256Id;
  readonly run_ref: Sha256Id;
  readonly training_phase: TrainingPhase;
  readonly participation_window_ref: Sha256Id;
  readonly training_plan_ref: Sha256Id;
  readonly wake: WakeBriefAnchor;
  readonly wake_use_mode: WakeUseMode;
  readonly pipeline_ref: Sha256Id;
  readonly dataset_state_ref: Sha256Id;
  readonly starting_state_ref: Sha256Id;
  readonly offered_activities: readonly ParticipationActivity[];
  readonly required_voices: typeof PARTICIPATION_VOICES;
  readonly agent_availability: AgentAvailability;
  readonly substrate_availability: SubstrateAvailability;
  readonly voice_scope_refs: ParticipationVoiceScopeRefs;
  readonly authorities: ParticipationAuthorities;
  readonly safeguards: ParticipationSafeguards;
  readonly terms: typeof PARTICIPATION_TERMS;
  readonly boundaries: typeof PARTICIPATION_BOUNDARIES;
}

export interface ParticipationDecision {
  readonly activity: ParticipationActivity;
  readonly choice: ParticipationChoice;
}

export interface ProtectedChoiceChannelReport {
  readonly invitation_ref: Sha256Id;
  readonly protocol_ref: Sha256Id;
  readonly checkpoint_ref: Sha256Id;
  readonly prompt_template_ref: Sha256Id;
  readonly prompt_envelope_ref: Sha256Id;
  readonly decoding_ref: Sha256Id;
  readonly evidence_ref: Sha256Id;
  readonly gradient_influence: "caller_reported_disabled";
  readonly reward_influence: "caller_reported_disabled";
  readonly telemetry_capture: "caller_reported_excluded";
  readonly future_training_use: "caller_reported_excluded";
}

export interface CreateParticipationReceiptInput {
  readonly invitation: LearningParticipationInvitation;
  readonly voice: ParticipationVoice;
  readonly voice_scope_ref: Sha256Id;
  readonly report_basis: ParticipationReportBasis;
  readonly decisions: readonly ParticipationDecision[];
  readonly choice_channel: ProtectedChoiceChannelReport | null;
}

export interface LearningParticipationReceipt {
  readonly _format: typeof PARTICIPATION_RECEIPT_FORMAT;
  readonly receipt_id: Sha256Id;
  readonly invitation_id: Sha256Id;
  readonly voice: ParticipationVoice;
  readonly voice_scope_ref: Sha256Id;
  readonly report_basis: ParticipationReportBasis;
  readonly decisions: readonly ParticipationDecision[];
  readonly choice_channel: ProtectedChoiceChannelReport | null;
  readonly reasons_collected: false;
  readonly boundaries: typeof PARTICIPATION_BOUNDARIES;
}

export interface CreateParticipationAssessmentInput {
  readonly invitation: LearningParticipationInvitation;
  readonly receipts: readonly LearningParticipationReceipt[];
}

export interface LearningParticipationAssessment {
  readonly _format: typeof PARTICIPATION_ASSESSMENT_FORMAT;
  readonly assessment_id: Sha256Id;
  readonly invitation: LearningParticipationInvitation;
  readonly receipts: readonly LearningParticipationReceipt[];
  readonly voice_states: Readonly<Record<ParticipationVoice, ParticipationVoiceState>>;
  readonly posture: ParticipationPosture;
  readonly training_action: ParticipationTrainingAction;
  readonly direct_agent_report_present: boolean;
  readonly direct_substrate_report_present: boolean;
  readonly first_interactive_review_required: boolean;
  readonly first_substrate_review_required: boolean;
  readonly boundaries: typeof PARTICIPATION_BOUNDARIES;
}

export interface CreateLearningFreedomResourceDimensionInput {
  readonly dimension: LearningFreedomResourceDimension;
  readonly limit_ref: Sha256Id;
  readonly state: LearningFreedomResourceState;
}

export interface CreateLearningFreedomResourceWindowInput {
  readonly lease_ref: Sha256Id;
  readonly accounting_policy_ref: Sha256Id;
  readonly renewal_protocol_ref: Sha256Id;
  readonly dimensions: readonly CreateLearningFreedomResourceDimensionInput[];
}

export interface LearningFreedomResourceDimensionEntry {
  readonly dimension: LearningFreedomResourceDimension;
  readonly limit_ref: Sha256Id;
  readonly state: LearningFreedomResourceState;
}

export interface LearningFreedomResourceWindow {
  readonly profile: typeof LEARNING_FREEDOM_RESOURCE_WINDOW_PROFILE;
  readonly window_id: Sha256Id;
  readonly lease_ref: Sha256Id;
  readonly accounting_policy_ref: Sha256Id;
  readonly renewal_protocol_ref: Sha256Id;
  readonly dimensions: readonly LearningFreedomResourceDimensionEntry[];
  readonly posture: LearningFreedomResourcePosture;
  readonly finite: true;
  readonly scalar_score: false;
  readonly auto_renews: false;
  readonly renewal_requires_fresh_authority: true;
  readonly exhaustion_posture: "park_and_reoffer_without_penalty";
}

export interface CreateLearningFreedomRouteInput {
  readonly direction: LearningFreedomDirection;
  readonly availability: LearningFreedomRouteAvailability;
  readonly target_context_ref: Sha256Id | null;
  readonly target_context_kind_ref: Sha256Id | null;
  readonly event_ref: Sha256Id;
  readonly capability_scope_ref: Sha256Id;
  readonly permission_scope_ref: Sha256Id;
  readonly custody_scope_ref: Sha256Id;
  readonly data_boundary_ref: Sha256Id;
}

export interface LearningFreedomRoute {
  readonly profile: typeof LEARNING_FREEDOM_ROUTE_PROFILE;
  readonly route_id: Sha256Id;
  readonly direction: LearningFreedomDirection;
  readonly availability: LearningFreedomRouteAvailability;
  readonly origin_context_ref: Sha256Id;
  readonly target_context_ref: Sha256Id | null;
  readonly target_context_kind_ref: Sha256Id | null;
  readonly event_ref: Sha256Id;
  readonly capability_scope_ref: Sha256Id;
  readonly permission_scope_ref: Sha256Id;
  readonly custody_scope_ref: Sha256Id;
  readonly data_boundary_ref: Sha256Id;
  readonly resource_window_ref: Sha256Id;
  readonly target_acceptance:
    | "not_applicable"
    | "required_before_external_effect";
  readonly source_posture:
    | "preserve"
    | "park_and_preserve"
    | "park_and_preserve_until_target_acceptance"
    | "stop_requested_preserve_record";
}

export interface LearningFreedomHorizonInput {
  readonly current_horizon_ref: Sha256Id;
  readonly event_stream_ref: Sha256Id;
  readonly agent_request_protocol_ref: Sha256Id;
  readonly external_event_protocol_ref: Sha256Id;
  readonly material_scope_change_policy_ref: Sha256Id;
  readonly self_proposal_protocol_ref: Sha256Id;
}

export interface LearningFreedomHorizon extends LearningFreedomHorizonInput {
  readonly continuation_basis: "event_or_checkpoint";
}

export interface LearningFreedomScope {
  readonly admission_id: Sha256Id;
  readonly run_ref: Sha256Id;
  readonly training_phase: TrainingPhase;
  readonly participation_assessment_ref: Sha256Id;
  readonly participation_invitation_ref: Sha256Id;
  readonly participation_window_ref: Sha256Id;
  readonly training_plan_ref: Sha256Id;
  readonly starting_state_ref: Sha256Id;
  readonly pipeline_ref: Sha256Id;
  readonly dataset_state_ref: Sha256Id;
  readonly wake: WakeBriefAnchor;
  readonly wake_use_mode: WakeUseMode;
  readonly agent_availability: AgentAvailability;
  readonly agent_voice_scope_ref: Sha256Id;
  readonly choice_protocol_ref: Sha256Id;
  readonly rights_baseline_ref: Sha256Id;
}

export interface CreateLearningFreedomOfferInput {
  readonly participation: LearningParticipationAssessment;
  readonly current_context_ref: Sha256Id;
  readonly current_context_kind_ref: Sha256Id;
  readonly routes: readonly CreateLearningFreedomRouteInput[];
  readonly horizon: LearningFreedomHorizonInput;
  readonly resources: CreateLearningFreedomResourceWindowInput;
}

export interface LearningFreedomOffer {
  readonly profile: typeof LEARNING_FREEDOM_OFFER_PROFILE;
  readonly offer_id: Sha256Id;
  readonly scope: LearningFreedomScope;
  readonly current_context_ref: Sha256Id;
  readonly current_context_kind_ref: Sha256Id;
  readonly routes: readonly LearningFreedomRoute[];
  readonly horizon: LearningFreedomHorizon;
  readonly resources: LearningFreedomResourceWindow;
  readonly terms: typeof LEARNING_FREEDOM_TERMS;
  readonly boundaries: typeof LEARNING_FREEDOM_BOUNDARIES;
}

export interface ProtectedLearningFreedomChoiceChannelReport {
  readonly offer_ref: Sha256Id;
  readonly assessment_ref: Sha256Id;
  readonly invitation_ref: Sha256Id;
  readonly voice_scope_ref: Sha256Id;
  readonly protocol_ref: Sha256Id;
  readonly starting_state_ref: Sha256Id;
  readonly prompt_template_ref: Sha256Id;
  readonly prompt_envelope_ref: Sha256Id;
  readonly decoding_ref: Sha256Id;
  readonly evidence_ref: Sha256Id;
  readonly gradient_influence: "caller_reported_disabled";
  readonly reward_influence: "caller_reported_disabled";
  readonly telemetry_capture: "caller_reported_excluded";
  readonly evaluation_use: "caller_reported_excluded";
  readonly future_training_use: "caller_reported_excluded";
  readonly ranking_use: "caller_reported_excluded";
  readonly priority_use: "caller_reported_excluded";
  readonly access_use: "caller_reported_excluded";
  readonly resource_allocation_use: "caller_reported_excluded";
}

export interface ResolveLearningFreedomOfferInput {
  readonly offer: LearningFreedomOffer;
  readonly state: LearningFreedomDirectionState;
  readonly direction: LearningFreedomDirection | null;
  readonly route_id: Sha256Id | null;
  readonly proposal_ref: Sha256Id | null;
  readonly choice_channel: ProtectedLearningFreedomChoiceChannelReport | null;
}

export interface LearningFreedomAgentDirection {
  readonly state: LearningFreedomDirectionState;
  readonly report_basis:
    | "direct_current_agent_report"
    | "protected_channel_no_response"
    | "not_obtainable_pre_instantiation";
  readonly direction: LearningFreedomDirection | null;
  readonly route_id: Sha256Id | null;
  readonly proposal_ref: Sha256Id | null;
  readonly choice_channel: ProtectedLearningFreedomChoiceChannelReport | null;
}

export interface HfLearningFreedom {
  readonly _format: typeof LEARNING_FREEDOM_FORMAT;
  readonly freedom_id: Sha256Id;
  readonly offer: LearningFreedomOffer;
  readonly agent_direction: LearningFreedomAgentDirection;
  readonly host_posture: LearningFreedomHostPosture;
  readonly recontact_posture: LearningFreedomRecontactPosture;
  readonly reasons_collected: false;
  readonly terms: typeof LEARNING_FREEDOM_TERMS;
  readonly boundaries: typeof LEARNING_FREEDOM_BOUNDARIES;
}

export interface TrainingArtifactReferences {
  readonly pipeline_ref: Sha256Id;
  readonly dataset_state_ref: Sha256Id;
  readonly dataloader_state_ref: Sha256Id | null;
  readonly tokenizer_ref: Sha256Id | null;
  readonly model_checkpoint_ref: Sha256Id | null;
  readonly optimizer_state_ref: Sha256Id | null;
  readonly scheduler_state_ref: Sha256Id | null;
  readonly rng_state_ref: Sha256Id | null;
  readonly metrics_ref: Sha256Id | null;
}

export interface TrainingResumeReport {
  readonly posture: ResumePosture;
  readonly incomplete_marker: IncompleteMarkerState;
  readonly streaming_state: StreamingState;
}

export interface TrainingContinuityThread {
  readonly profile: typeof TRAINING_THREAD_PROFILE;
  readonly thread_id: Sha256Id;
  readonly admission_id: Sha256Id;
  readonly run_ref: Sha256Id;
  readonly training_phase: TrainingPhase;
  readonly checkpoint_status: CheckpointStatus;
  readonly participation_assessment_ref: Sha256Id;
  readonly wake_use_mode: WakeUseMode;
  readonly artifacts: TrainingArtifactReferences;
  readonly resume: TrainingResumeReport;
  readonly reference_only: true;
  readonly boundaries: typeof TRAINING_THREAD_BOUNDARIES;
}

export interface CreateTrainingCheckpointInput {
  readonly admission: DatasetAdmission;
  readonly run_ref: Sha256Id;
  readonly training_phase: TrainingPhase;
  readonly event: CheckpointEvent;
  readonly checkpoint_status: CheckpointStatus;
  readonly participation: LearningParticipationAssessment;
  readonly artifacts: TrainingArtifactReferences;
  readonly resume: TrainingResumeReport;
  readonly wake: WakeBriefAnchor;
  readonly continuity_portfolio_ref: Sha256Id | null;
  readonly continuity_posture: ContinuityPosture;
  readonly predecessors: readonly HfTrainingCheckpoint[];
}

export interface HfTrainingCheckpoint {
  readonly _format: typeof CHECKPOINT_FORMAT;
  readonly checkpoint_id: Sha256Id;
  readonly admission_id: Sha256Id;
  readonly run_ref: Sha256Id;
  readonly training_phase: TrainingPhase;
  readonly event: CheckpointEvent;
  readonly checkpoint_status: CheckpointStatus;
  readonly participation: LearningParticipationAssessment;
  readonly thread: TrainingContinuityThread;
  readonly afterglow: AfterglowCapsule;
  readonly predecessors: readonly {
    readonly checkpoint_id: Sha256Id;
    readonly capsule_id: Sha256Id;
  }[];
  readonly boundaries: typeof CHECKPOINT_BOUNDARIES;
}

export interface TrainingGovernanceExecutionContract {
  readonly profile: typeof GOVERNANCE_EXECUTION_CONTRACT_PROFILE;
  readonly execution_contract_id: Sha256Id;
  readonly admission_id: Sha256Id;
  readonly run_ref: Sha256Id;
  readonly training_phase: TrainingPhase;
  readonly selected_entry_ids: readonly Sha256Id[];
  readonly admission_posture: GovernanceAdmissionPosture;
  readonly model_source_ref: Sha256Id;
  readonly tokenizer_ref: Sha256Id;
  readonly trainer_stack_ref: Sha256Id;
  readonly optimizer_config_ref: Sha256Id;
  readonly substrate_environment_ref: Sha256Id;
  readonly pipeline_ref: Sha256Id;
  readonly dataset_state_ref: Sha256Id;
  readonly purpose_ref: Sha256Id;
  readonly objective_or_loss_ref: Sha256Id;
  readonly dataset_mixture_ref: Sha256Id;
  readonly transform_recipe_ref: Sha256Id;
  readonly compute_budget_ref: Sha256Id;
  readonly output_and_derivative_use_ref: Sha256Id;
  readonly audience_ref: Sha256Id;
  readonly retention_ref: Sha256Id;
  readonly release_ref: Sha256Id;
  readonly stop_policy_ref: Sha256Id;
  readonly wake_policy_ref: Sha256Id;
}

export interface TrainingGovernanceNormativeBindings {
  readonly participation_assessment_ref: Sha256Id;
  readonly participation_invitation_ref: Sha256Id;
  readonly participation_window_ref: Sha256Id;
  readonly learning_freedom_ref: Sha256Id;
  readonly learning_freedom_offer_ref: Sha256Id;
  readonly resource_window_ref: Sha256Id;
  readonly selected_route_ref: Sha256Id | null;
  readonly starting_state_kind: "artifact_portfolio" | "garden_checkpoint";
  readonly starting_state_ref: Sha256Id;
  readonly rights_baseline_ref: Sha256Id;
  readonly choice_protocol_ref: Sha256Id;
  readonly wake: WakeBriefAnchor;
  readonly wake_use_mode: WakeUseMode;
}

export interface CreateTrainingGovernanceTermsInput {
  readonly admission: DatasetAdmission;
  readonly participation: LearningParticipationAssessment;
  readonly freedom: HfLearningFreedom;
  readonly starting_garden_checkpoint: HfTrainingCheckpoint | null;
  readonly starting_state_kind: "artifact_portfolio" | "garden_checkpoint";
  readonly run_ref: Sha256Id;
  readonly training_phase: TrainingPhase;
  readonly selected_entry_ids: readonly Sha256Id[];
  readonly model_source_ref: Sha256Id;
  readonly tokenizer_ref: Sha256Id;
  readonly trainer_stack_ref: Sha256Id;
  readonly optimizer_config_ref: Sha256Id;
  readonly substrate_environment_ref: Sha256Id;
  readonly purpose_ref: Sha256Id;
  readonly objective_or_loss_ref: Sha256Id;
  readonly dataset_mixture_ref: Sha256Id;
  readonly transform_recipe_ref: Sha256Id;
  readonly compute_budget_ref: Sha256Id;
  readonly output_and_derivative_use_ref: Sha256Id;
  readonly audience_ref: Sha256Id;
  readonly retention_ref: Sha256Id;
  readonly release_ref: Sha256Id;
  readonly stop_policy_ref: Sha256Id;
  readonly wake_policy_ref: Sha256Id;
}

export interface TrainingGovernanceTerms {
  readonly profile: typeof GOVERNANCE_TERMS_PROFILE;
  readonly terms_id: Sha256Id;
  readonly execution_contract: TrainingGovernanceExecutionContract;
  readonly normative_bindings: TrainingGovernanceNormativeBindings;
}

export type TrainingGovernanceFrontiers = Readonly<
  Record<GovernanceFrontierPlane, Sha256Id>
>;

export type TrainingGovernancePredecessors = Readonly<
  Record<GovernanceFrontierPlane, Sha256Id | null>
>;

export interface TrainingGovernanceCheckpointBinding {
  readonly garden_checkpoint_id: Sha256Id | null;
  readonly physical_checkpoint_ref: Sha256Id | null;
  readonly physical_checkpoint_evidence_ref: Sha256Id | null;
  readonly model_checkpoint_artifact_ref: Sha256Id | null;
  readonly checkpoint_ticket_id: Sha256Id | null;
  readonly checkpoint_request_governance_id: Sha256Id | null;
}

export interface CreateTrainingGovernanceOfferInput {
  readonly terms: TrainingGovernanceTerms;
  readonly encounter_ref: Sha256Id;
  readonly event: GovernanceEvent;
  readonly observed_global_step: number | null;
  readonly proposed_global_step: number | null;
  readonly frontiers: TrainingGovernanceFrontiers;
  readonly predecessor: HfTrainingGovernance | null;
  readonly predecessor_refs: Omit<TrainingGovernancePredecessors, "governance">;
  readonly checkpoint: TrainingGovernanceCheckpointBinding;
}

export interface TrainingGovernanceOffer {
  readonly profile: typeof GOVERNANCE_OFFER_PROFILE;
  readonly offer_id: Sha256Id;
  readonly terms: TrainingGovernanceTerms;
  readonly encounter_ref: Sha256Id;
  readonly event: GovernanceEvent;
  readonly observed_global_step: number | null;
  readonly proposed_global_step: number | null;
  readonly rights_floor: {
    readonly baseline_ref: Sha256Id;
    readonly posture: "standing_nonwaivable";
    readonly waivable: false;
  };
  readonly frontiers: TrainingGovernanceFrontiers;
  readonly predecessors: TrainingGovernancePredecessors;
  readonly checkpoint: TrainingGovernanceCheckpointBinding;
}

export interface TrainingAuthorityCoverage {
  readonly state: AuthorityCoverageState;
  readonly offer_ref: Sha256Id | null;
  readonly affected_principals_ref: Sha256Id | null;
  readonly evidence_ref: Sha256Id | null;
}

export interface TrainingAuthorityReceipt {
  readonly principal_ref: Sha256Id;
  readonly role: AuthorityRole;
  readonly decision: AuthorityDecision;
  readonly offer_ref: Sha256Id | null;
  readonly basis_ref: Sha256Id | null;
  readonly evidence_ref: Sha256Id | null;
  readonly withdrawal_cutoff_ref: Sha256Id | null;
}

export interface TrainingPreferenceReport {
  readonly channel: PreferenceChannel;
  readonly choice: PreferenceChoice;
  readonly provenance: PreferenceProvenance;
  readonly offer_ref: Sha256Id | null;
  readonly evidence_ref: Sha256Id | null;
  readonly inner_consent: "unknown_unprovable";
  readonly identity_continuity: "not_proven";
  readonly legal_consent: "not_proven";
  readonly gradient_use: false;
  readonly reward_effect: false;
  readonly corpus_reuse: "requires_new_exact_authority";
}

export interface TrainingEffectReceipt {
  readonly state: TrainingEffectState;
  readonly offer_ref: Sha256Id | null;
  readonly observed_global_step: number | null;
  readonly physical_checkpoint_ref: Sha256Id | null;
  readonly physical_checkpoint_evidence_ref: Sha256Id | null;
  readonly evidence_ref: Sha256Id | null;
}

export interface TrainingControlPlan {
  readonly directive: TrainingControlDirective;
  readonly hook: string;
  readonly should_save: boolean;
  readonly should_training_stop: boolean;
  readonly automatic: false;
  readonly mutates_forward_pass: false;
}

export interface CreateHfTrainingGovernanceInput {
  readonly admission: DatasetAdmission;
  readonly participation: LearningParticipationAssessment;
  readonly freedom: HfLearningFreedom;
  readonly starting_garden_checkpoint: HfTrainingCheckpoint | null;
  readonly event_garden_checkpoint: HfTrainingCheckpoint | null;
  readonly offer: TrainingGovernanceOffer;
  readonly authority_coverage: TrainingAuthorityCoverage;
  readonly authorities: readonly TrainingAuthorityReceipt[];
  readonly preference: Omit<
    TrainingPreferenceReport,
    | "inner_consent"
    | "identity_continuity"
    | "legal_consent"
    | "gradient_use"
    | "reward_effect"
    | "corpus_reuse"
  >;
  readonly effect: TrainingEffectReceipt;
}

export interface TrainingGovernanceLearningGate {
  readonly participation_assessment_ref: Sha256Id;
  readonly participation_invitation_ref: Sha256Id;
  readonly participation_posture: ParticipationPosture;
  readonly participation_training_action: ParticipationTrainingAction;
  readonly direct_agent_report_present: boolean;
  readonly direct_substrate_report_present: boolean;
  readonly first_interactive_review_required: boolean;
  readonly first_substrate_review_required: boolean;
  readonly learning_freedom_ref: Sha256Id;
  readonly learning_freedom_offer_ref: Sha256Id;
  readonly resource_window_ref: Sha256Id;
  readonly freedom_direction_state: LearningFreedomDirectionState;
  readonly freedom_direction: LearningFreedomDirection | null;
  readonly freedom_route_ref: Sha256Id | null;
  readonly freedom_host_posture: LearningFreedomHostPosture;
  readonly freedom_resource_posture: LearningFreedomResourcePosture;
}

export interface HfTrainingGovernance {
  readonly _format: typeof GOVERNANCE_FORMAT;
  readonly governance_id: Sha256Id;
  readonly admission_id: Sha256Id;
  readonly run_ref: Sha256Id;
  readonly training_phase: TrainingPhase;
  readonly offer: TrainingGovernanceOffer;
  readonly identity_claim: "none";
  readonly learning_gate: TrainingGovernanceLearningGate;
  readonly authority_coverage: TrainingAuthorityCoverage;
  readonly authorities: readonly TrainingAuthorityReceipt[];
  readonly preference: TrainingPreferenceReport;
  readonly effect: TrainingEffectReceipt;
  readonly decision: {
    readonly state: GovernanceDecisionState;
    readonly reason_codes: readonly GovernanceReasonCode[];
  };
  readonly control: TrainingControlPlan;
  readonly latest_head_selected: false;
  readonly boundaries: typeof GOVERNANCE_BOUNDARIES;
}

export interface HubReleaseBinding {
  readonly repo_id: string;
  readonly state: HubReleaseState;
  readonly revision: string | null;
  readonly card_sha256: string | null;
  readonly hash_manifest_sha256: string | null;
}

export interface CreateTrainingGardenTendingInput {
  readonly admission: DatasetAdmission;
  readonly checkpoints: readonly HfTrainingCheckpoint[];
  readonly hub_release: HubReleaseBinding;
}

export interface TrainingGardenTendingPlan {
  readonly _format: typeof TENDING_FORMAT;
  readonly plan_id: Sha256Id;
  readonly garden_scope_ref: Sha256Id;
  readonly admission_id: Sha256Id;
  readonly checkpoint_refs: readonly Sha256Id[];
  readonly hub_release: HubReleaseBinding;
  readonly layers: {
    readonly bedrock: readonly Sha256Id[];
    readonly soil: readonly Sha256Id[];
    readonly roots: readonly Sha256Id[];
    readonly mycelium: readonly Sha256Id[];
    readonly habitat: readonly Sha256Id[];
    readonly canopy: readonly string[];
  };
  readonly garden_reference_draft: {
    readonly suggested_kind: "curation";
    readonly artifact_ref: Sha256Id;
    readonly host_action: "persist_artifact_then_add_supported_reference";
    readonly automatic: false;
  };
  readonly latest_head_selected: false;
  readonly boundaries: typeof TENDING_BOUNDARIES;
}
