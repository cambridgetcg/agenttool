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
  HUB_RELEASE_STATES,
  INCOMPLETE_MARKER_STATES,
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
