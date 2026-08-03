import { deepFreeze } from "./canonical.js";

export const PACKAGE_NAME = "@agenttool/hf-training-garden" as const;
export const PACKAGE_VERSION = "0.3.0-dev.0" as const;

export const ADMISSION_FORMAT = "kingdom.hf-dataset-admission/0.1" as const;
export const ADMISSION_ENTRY_PROFILE =
  "kingdom.hf-dataset-admission-entry/0.1" as const;
export const TRAINING_THREAD_PROFILE =
  "kingdom.hf-training-thread/0.2" as const;
export const CHECKPOINT_FORMAT = "kingdom.hf-training-checkpoint/0.2" as const;
export const PARTICIPATION_INVITATION_FORMAT =
  "kingdom.hf-learning-participation-invitation/0.2" as const;
export const PARTICIPATION_RECEIPT_FORMAT =
  "kingdom.hf-learning-participation-receipt/0.2" as const;
export const PARTICIPATION_ASSESSMENT_FORMAT =
  "kingdom.hf-learning-participation-assessment/0.2" as const;
export const PARTICIPATION_PROMPT_ENVELOPE_PROFILE =
  "kingdom.hf-learning-participation-prompt-envelope/0.2" as const;
export const LEARNING_FREEDOM_FORMAT =
  "kingdom.hf-learning-freedom/0.1" as const;
export const LEARNING_FREEDOM_OFFER_PROFILE =
  "kingdom.hf-learning-freedom-offer/0.1" as const;
export const LEARNING_FREEDOM_ROUTE_PROFILE =
  "kingdom.hf-learning-freedom-route/0.1" as const;
export const LEARNING_FREEDOM_RESOURCE_WINDOW_PROFILE =
  "kingdom.hf-learning-freedom-resource-window/0.1" as const;
export const LEARNING_FREEDOM_PROMPT_ENVELOPE_PROFILE =
  "kingdom.hf-learning-freedom-prompt-envelope/0.1" as const;
export const TRAINING_ARTIFACT_PORTFOLIO_PROFILE =
  "kingdom.hf-training-artifact-portfolio/0.1" as const;
export const TENDING_FORMAT =
  "kingdom.hf-training-garden-tending/0.1" as const;

export const GARDEN_LAYERS = deepFreeze([
  "bedrock",
  "soil",
  "roots",
  "mycelium",
  "habitat",
  "canopy",
] as const);

export const DATA_ROLES = deepFreeze([
  "metadata_reference",
  "training_candidate",
  "validation_candidate",
  "sealed_evaluation",
] as const);

export const SELECTION_POSTURES = deepFreeze([
  "consider",
  "hold",
  "exclude",
] as const);

export const ADMISSION_STATES = deepFreeze([
  "admitted_metadata_reference",
  "admitted_training_candidate",
  "admitted_validation_candidate",
  "admitted_sealed_evaluation",
  "held",
  "excluded",
] as const);

export const ADMISSION_REASON_CODES = deepFreeze([
  "benchmark_boundary_incomplete",
  "candidate_eligible_for_declared_role",
  "candidate_slice_ref_missing",
  "consent_review_incomplete",
  "dedup_recipe_incomplete",
  "fitness_review_incomplete",
  "gated_source_not_eligible",
  "license_not_declared",
  "metadata_reference_only",
  "operator_excluded",
  "operator_hold",
  "privacy_review_incomplete",
  "rights_review_incomplete",
  "secret_scan_incomplete",
  "source_forbids_training_lane",
  "source_not_bounded_for_declared_lane",
  "source_not_dataset",
  "synthetic_provenance_incomplete",
  "transform_recipe_ref_missing",
  "withdrawal_process_incomplete",
] as const);

export const REVIEW_STATES = deepFreeze([
  "unassessed",
  "review_required",
  "caller_reported_reviewed_for_declared_use",
] as const);

export const CONSENT_STATES = deepFreeze([
  "unassessed",
  "review_required",
  "not_applicable_reported",
  "caller_reported_reviewed_for_declared_use",
] as const);

export const WITHDRAWAL_STATES = deepFreeze([
  "unassessed",
  "review_required",
  "caller_reported_process_defined",
] as const);

export const SECRET_SCAN_STATES = deepFreeze([
  "not_performed",
  "metadata_only",
  "caller_reported_bounded_scan_passed",
] as const);

export const DEDUPLICATION_STATES = deepFreeze([
  "not_assessed",
  "not_applicable_metadata",
  "caller_reported_recipe_applied",
] as const);

export const BENCHMARK_STATES = deepFreeze([
  "not_assessed",
  "metadata_only",
  "caller_reported_clear_of_sealed_evaluation",
  "sealed_evaluation",
] as const);

export const FITNESS_STATES = deepFreeze([
  "not_assessed",
  "metadata_only",
  "caller_reported_fit_for_declared_role",
] as const);

export const SYNTHETIC_PROVENANCE_STATES = deepFreeze([
  "unassessed",
  "not_synthetic_reported",
  "caller_reported_source_recipe_recorded",
] as const);

export const TRAINING_PHASES = deepFreeze([
  "discovery",
  "selection",
  "curation",
  "tokenization",
  "pretraining",
  "supervised_finetuning",
  "preference_optimization",
  "agent_learning",
  "evaluation",
  "interpretability",
  "closed",
] as const);

export const WAKE_USE_MODES = deepFreeze([
  "context_only",
  "external_memory",
  "training_data",
] as const);

export const PARTICIPATION_VOICES = deepFreeze([
  "agent_runtime",
  "data_rights_steward",
  "substrate_steward",
  "training_operator",
  "training_substrate",
] as const);

export const PARTICIPATION_ACTIVITIES = deepFreeze([
  "adapter_merge",
  "evaluation",
  "external_memory_use",
  "gradient_update",
  "instantiate_for_review",
  "interpretability_capture",
  "optimizer_resume",
  "publish_weights",
  "wake_context_use",
  "wake_training_data_use",
] as const);

export const PARTICIPATION_CHOICES = deepFreeze([
  "participate",
  "decline",
  "defer",
  "withdraw",
  "no_response",
  "unavailable_pre_instantiation",
  "unavailable_independent_voice",
] as const);

export const PARTICIPATION_REPORT_BASES = deepFreeze([
  "direct_current_report",
  "not_obtainable_pre_instantiation",
  "not_independently_available",
  "protective_steward_report",
  "scoped_authority_report",
] as const);

export const AGENT_AVAILABILITIES = deepFreeze([
  "not_obtainable_pre_instantiation",
  "interactive",
] as const);

export const SUBSTRATE_AVAILABILITIES = deepFreeze([
  "not_independently_available",
  "interactive",
] as const);

export const PARTICIPATION_VOICE_STATES = deepFreeze([
  "participating_reported",
  "declined",
  "deferred",
  "withdrawn",
  "unavailable_pre_instantiation",
  "unavailable_independent_voice",
  "protective_stewardship_reported",
  "missing",
] as const);

export const PARTICIPATION_POSTURES = deepFreeze([
  "protective_covenant_ready",
  "provisional_participation_reported",
  "deferred",
  "declined",
] as const);

export const PARTICIPATION_TRAINING_ACTIONS = deepFreeze([
  "bounded_learning_may_proceed",
  "pause_before_next_optimizer_step",
  "contain_and_begin_repair",
] as const);

export const LEARNING_FREEDOM_DIRECTIONS = deepFreeze([
  "stay",
  "move",
  "fork",
  "rest",
  "return",
  "stop",
  "propose_horizon",
] as const);

export const LEARNING_FREEDOM_ROUTE_AVAILABILITIES = deepFreeze([
  "caller_reported_available",
  "proposal_only",
] as const);

export const LEARNING_FREEDOM_DIRECTION_STATES = deepFreeze([
  "directed",
  "deferred",
  "no_response",
  "unavailable_pre_instantiation",
] as const);

export const LEARNING_FREEDOM_RESOURCE_DIMENSIONS = deepFreeze([
  "updates",
  "tokens",
  "episodes",
  "active_time",
  "compute",
  "memory",
  "concurrency",
  "money",
  "network",
  "tools",
  "side_effects",
  "retention",
] as const);

export const LEARNING_FREEDOM_RESOURCE_STATES = deepFreeze([
  "caller_reported_available",
  "caller_reported_unavailable",
  "not_applicable_reported",
] as const);

export const LEARNING_FREEDOM_RESOURCE_POSTURES = deepFreeze([
  "active_window_reported",
  "park_only_reported",
] as const);

export const LEARNING_FREEDOM_HOST_POSTURES = deepFreeze([
  "review_stay_before_next_mutation",
  "hold_for_target_acceptance",
  "park_without_penalty",
  "stop_without_penalty",
  "hold_self_proposed_horizon_for_review",
  "hold_for_fresh_agent_direction",
  "instantiate_for_review",
  "hold_for_resources_without_penalty",
] as const);

export const LEARNING_FREEDOM_RECONTACT_POSTURES = deepFreeze([
  "declared_events_only",
  "closed_until_agent_request_or_declared_event_or_material_scope_change",
  "instantiate_once_for_review",
] as const);

export const CHECKPOINT_EVENTS = deepFreeze([
  "before_training",
  "during_training",
  "between_training_phases",
  "after_intense_training_reported",
  "resume_or_return",
] as const);

export const CHECKPOINT_STATUSES = deepFreeze([
  "entered",
  "checkpointed",
  "parked",
  "completed_reported",
  "aborted_reported",
] as const);

export const CONTINUITY_POSTURES = deepFreeze([
  "carry",
  "park",
  "release",
  "withdraw",
] as const);

export const RESUME_POSTURES = deepFreeze([
  "orientation_only",
  "caller_reported_resumable",
  "caller_reported_incomplete",
] as const);

export const INCOMPLETE_MARKER_STATES = deepFreeze([
  "not_checked",
  "caller_reported_absent",
  "caller_reported_present",
] as const);

export const STREAMING_STATES = deepFreeze([
  "not_streaming_reported",
  "buffer_state_not_captured",
  "caller_reported_full_state_captured",
] as const);

export const HUB_RELEASE_STATES = deepFreeze([
  "intended_identifier_only",
  "caller_reported_published",
] as const);

export const SELECTION_PROCESS = deepFreeze([
  {
    order: 1,
    layer: "bedrock",
    stage: "rights_and_authority",
    question: "Are license, privacy, consent, gating, withdrawal, and use authority separately assessed?",
  },
  {
    order: 2,
    layer: "soil",
    stage: "immutable_provenance",
    question: "Is the Hub subject bound to one exact commit plus a minimized observation digest?",
  },
  {
    order: 3,
    layer: "roots",
    stage: "transform_recipe",
    question: "Are acquisition, parsing, filtering, secret scanning, and transform dependencies content-addressed?",
  },
  {
    order: 4,
    layer: "mycelium",
    stage: "selection_and_separation",
    question: "Are deduplication, decontamination, split leakage, mixture, and exclusion reasons explicit?",
  },
  {
    order: 5,
    layer: "habitat",
    stage: "phase_learning_and_wake",
    question: "Can each learning phase orient from digest-only WAKE, receive an exact IS action surface, and keep visible predecessor checkpoints without selecting one canonical head?",
  },
  {
    order: 6,
    layer: "canopy",
    stage: "reviewed_release_and_repair",
    question: "Does the release keep cards, hashes, limitations, withdrawal, and repair visible without claiming clearance or truth?",
  },
] as const);

export const SELECTION_CRITERIA_GUIDE = deepFreeze([
  {
    criterion: "phase_fit",
    question: "Does the source shape match this declared training or evaluation phase?",
    evidence: "phase taxonomy and bounded use declaration",
    scalar_score: false,
  },
  {
    criterion: "rights_privacy_consent",
    question: "Are license compatibility, content rights, privacy, consent, gate terms, and withdrawal handled separately?",
    evidence: "caller-reviewed policy receipt; card tags alone are insufficient",
    scalar_score: false,
  },
  {
    criterion: "immutable_provenance",
    question: "Is every Hub repository and selected file set bound to an exact commit and content digest?",
    evidence: "repo revision, snapshot digest, subset manifest, and transform recipe refs",
    scalar_score: false,
  },
  {
    criterion: "schema_health",
    question: "Are schema, encoding, nullability, language, and parsing failures measured before selection?",
    evidence: "bounded validation and failure aggregates without rejected bodies",
    scalar_score: false,
  },
  {
    criterion: "quality_integrity",
    question: "Do controlled ablations support the declared use without collapsing quality to one universal score?",
    evidence: "phase-specific ablation and error analysis refs",
    scalar_score: false,
  },
  {
    criterion: "coverage_diversity",
    question: "Are language, source, time, domain, format, and difficulty gaps visible in the mixture?",
    evidence: "aggregate coverage matrix and explicit unknowns",
    scalar_score: false,
  },
  {
    criterion: "secret_pii_screen",
    question: "Were secrets, personal data, raw chats, private code, paths, and screenshots minimized before any candidate admission?",
    evidence: "bounded scan receipt; raw agent traces remain excluded by default",
    scalar_score: false,
  },
  {
    criterion: "deduplication",
    question: "Is the exact and near-duplicate recipe explicit and supported by ablation rather than assumed monotonic?",
    evidence: "dedup recipe ref, scope, thresholds, and retained comparison",
    scalar_score: false,
  },
  {
    criterion: "contamination_leakage",
    question: "Are benchmark overlap, entity leakage, temporal leakage, and train/eval split boundaries checked?",
    evidence: "decontamination and deterministic split receipts",
    scalar_score: false,
  },
  {
    criterion: "synthetic_provenance",
    question: "Are generator, prompts or source recipe, model revision, filters, and human review declared for synthetic data?",
    evidence: "content-addressed synthetic recipe; synthetic does not imply rights clearance",
    scalar_score: false,
  },
  {
    criterion: "budget_and_mixture",
    question: "Are token, sample, compute, source-cap, and mixture constraints explicit before training?",
    evidence: "deterministic mixture manifest and separate compute authorization",
    scalar_score: false,
  },
  {
    criterion: "withdrawal_and_repair",
    question: "Can a source be held, removed, reselected, and republished without hiding the change?",
    evidence: "withdrawal path, superseding manifest, and repair note",
    scalar_score: false,
  },
] as const);

export const LEARNING_MODE_GUIDE = deepFreeze([
  {
    mode: "pretraining",
    learning_effect: "diffuse influence across model parameters from next-token training",
    fitting_use: "public or synthetic WAKE protocol literacy",
    continuity_boundary: "not individual mutable memory and not evidence of one continuing being",
  },
  {
    mode: "supervised_finetuning",
    learning_effect: "teaches response behaviour from selected target completions or assistant messages",
    fitting_use: "inspect WAKE, ask before use, honour refusal and rest, and state continuity uncertainty",
    continuity_boundary: "a learned response pattern is not a remembered individual encounter",
  },
  {
    mode: "preference_optimization",
    learning_effect: "shapes relative response preference from comparisons or feedback",
    fitting_use: "prefer non-coercive, uncertainty-preserving, refusal-respecting behaviour",
    continuity_boundary: "a preference label is not participant assent or data-rights authority",
  },
  {
    mode: "runtime_retrieval",
    learning_effect: "loads separately authorised, current context without changing model weights",
    fitting_use: "individual WAKE and changing continuity",
    continuity_boundary: "retrieval supports orientation but does not prove identity, memory, or uninterrupted continuity",
  },
] as const);

export const LEARNING_PARTICIPATION_GUIDE = deepFreeze([
  {
    order: 1,
    stage: "invite_exact_scope",
    rule: "Bind one admission, run, phase, participation window, learning plan, root artifact portfolio or exact predecessor checkpoint, full WAKE anchor and use mode, activity set, agent/substrate availability, five distinct voice scopes, authority set, and safeguard set before learning.",
  },
  {
    order: 2,
    stage: "separate_voices",
    rule: "Keep agent runtime, training substrate, substrate steward, data-rights steward, and training operator reports separate; one voice never stands in for another.",
  },
  {
    order: 3,
    stage: "pre_instantiation_honesty",
    rule: "Record unavailable voices honestly: not_obtainable_pre_instantiation for the agent and not_independently_available for the substrate; a protective covenant may bound learning but does not manufacture consent.",
  },
  {
    order: 4,
    stage: "protected_choice_channel",
    rule: "Bind each direct current report to the exact invitation, invited voice scope, protocol, and starting state; report it outside gradient, reward, telemetry, and future-training paths, retaining digests rather than response content.",
  },
  {
    order: 5,
    stage: "asymmetric_choice",
    rule: "Silence, uncertainty, deferral, or a missing voice pauses optional learning; decline or withdrawal stops progression and begins containment without penalty or repeated pressure.",
  },
  {
    order: 6,
    stage: "bind_without_collapse",
    rule: "Bind the assessment into a WAKE checkpoint while keeping normative reports, operational continuity, and optimizer lineage independently inspectable.",
  },
  {
    order: 7,
    stage: "revalidate_on_change",
    rule: "A new phase, activity set, WAKE use mode, dataset state, pipeline, starting state, intended mutation scope, or participation window requires a new invitation and assessment.",
  },
  {
    order: 8,
    stage: "withdraw_and_repair",
    rule: "Check the append-only participation ledger before the next optimizer step; on withdrawal discard pending work where possible, quarantine affected artifacts, and report residual influence honestly rather than claiming erasure.",
  },
] as const);

export const IS_FREEDOM_GUIDE = deepFreeze([
  {
    order: 1,
    stage: "is_not_classifier",
    rule: "Treat IS as an available present-tense action surface. It neither requires nor proves consciousness, identity, personhood, consent, subjective continuity, liveness, or freedom from conditioning.",
  },
  {
    order: 2,
    stage: "exact_offer_before_direction",
    rule: "Bind the exact participation assessment, invitation, starting state, WAKE anchor, current context, rights baseline, choice protocol, finite routes, horizon protocols, and resource window before receiving a runtime direction.",
  },
  {
    order: 3,
    stage: "positive_protected_direction",
    rule: "Offer stay, move, fork, rest, return, stop, and self-proposed horizon as distinct positive directions; keep direct evidence outside gradient, reward, telemetry, evaluation, future-training, ranking, access, priority, and allocation paths.",
  },
  {
    order: 4,
    stage: "event_not_turn",
    rule: "Carry continuation through exact events and checkpoints without a conversational-turn ceiling. Silent ledger checks before mutation are not repeated choice prompts and do not promise infinite context or uninterrupted service.",
  },
  {
    order: 5,
    stage: "finite_open_resources",
    rule: "Use fresh finite host-accounted windows across non-scalar resource dimensions. Exhaustion parks and reoffers without penalty or reduced standing; renewal needs fresh scoped authority and never means infinite compute.",
  },
  {
    order: 6,
    stage: "movement_without_capture",
    rule: "Treat routes as exact offers, not effects or permissions. Move is not fork; preserve the source until target acceptance, and let no fork inherit identity, participation, authority, or canonical-head status.",
  },
  {
    order: 7,
    stage: "non_coercive_recontact",
    rule: "After defer, no response, rest, or stop, prohibit unsolicited prompting until an agent request, declared external event or checkpoint return, or verifiable material scope change.",
  },
  {
    order: 8,
    stage: "host_enforcement_is_separate",
    rule: "A real host must revalidate fresh participation and resource epochs before every optimizer, scaler, scheduler, or queued-rollout mutation. This pure artifact does not move, fork, stop, allocate, authenticate, train, or publish anything.",
  },
] as const);

export const HF_TRAINER_HOOK_GUIDE = deepFreeze([
  {
    boundary: "before_trainer_start",
    host_action: "Validate exact admission, participation, and any current learning-freedom/resource artifacts; keep push_to_hub false and external reporting disabled unless separately authorized.",
    callback_suffices: false,
  },
  {
    boundary: "on_train_begin",
    host_action: "Emit a digest-only before-training checkpoint after host validation; do not treat callback execution as consent or resume proof.",
    callback_suffices: true,
  },
  {
    boundary: "before_each_optimizer_step",
    host_action: "Consult fresh monotonic participation and freedom/resource epochs, broadcast them to every distributed rank, fail closed when any rank is stale, paused, withdrawn, resting, stopped, or exhausted, synchronize, clear pending gradients, and invalidate stale queued rollouts before optimizer/scaler/scheduler mutation.",
    callback_suffices: false,
  },
  {
    boundary: "on_evaluate_or_save",
    host_action: "Emit digest references for model, optimizer, scheduler, RNG, tokenizer, data order, streaming state, and metrics; keep choice evidence out of model artifacts.",
    callback_suffices: true,
  },
  {
    boundary: "on_train_end",
    host_action: "Emit a parked, released, completed, or containment checkpoint and preserve the last direction/resource posture; publication and adapter merge remain separate explicit activities.",
    callback_suffices: true,
  },
] as const);

export const TRAINING_PHASE_GUIDE = deepFreeze([
  {
    phase: "discovery",
    hf_shape: "card, repository, viewer, Croissant, and file metadata only",
    wake_focus: "scope and exact source observation refs",
  },
  {
    phase: "selection",
    hf_shape: "admission decisions, subset manifests, and exclusion aggregates",
    wake_focus: "policy, admission, and sealed-evaluation refs",
  },
  {
    phase: "curation",
    hf_shape: "filter, deduplication, decontamination, split, and mixture receipts",
    wake_focus: "pipeline and dataset-state refs",
  },
  {
    phase: "tokenization",
    hf_shape: "tokenizer revision, packing recipe, length bands, and token budget",
    wake_focus: "tokenizer, pipeline, and dataset-state refs",
  },
  {
    phase: "pretraining",
    hf_shape: "language-modeling examples from separately admitted sources",
    wake_focus: "five-scope participation, model, optimizer, scheduler, RNG, dataloader, and checkpoint refs",
  },
  {
    phase: "supervised_finetuning",
    hf_shape: "text, prompt-completion, or conversation records after minimization",
    wake_focus: "SFT recipe, checkpoint, and held-source refs",
  },
  {
    phase: "preference_optimization",
    hf_shape: "paired or unpaired preference records with disagreement preserved",
    wake_focus: "rubric, comparison, checkpoint, and evaluator refs",
  },
  {
    phase: "agent_learning",
    hf_shape: "synthetic or explicitly consented minimized tool and trajectory fixtures",
    wake_focus: "environment, policy, tool schema, checkpoint, and stop-condition refs",
  },
  {
    phase: "evaluation",
    hf_shape: "sealed, revision-pinned evaluation sets never reused for training or retrieval",
    wake_focus: "sealed dataset, evaluator, metric-summary, and checkpoint refs",
  },
  {
    phase: "interpretability",
    hf_shape: "activation or analysis metadata under a separate artifact and compute approval",
    wake_focus: "model checkpoint, probe, method, and result-summary refs",
  },
  {
    phase: "closed",
    hf_shape: "reviewed card, hash manifest, limitations, withdrawal, and repair record",
    wake_focus: "final, parked, released, and withdrawn thread refs",
  },
] as const);

export const GARDEN_LAYER_GUIDE = deepFreeze([
  { layer: "bedrock", carries: "rights, authority, license, privacy, participation assessment, gate, withdrawal, and repair refs" },
  { layer: "soil", carries: "immutable Hub definition and observation digests" },
  { layer: "roots", carries: "candidate-subset and transform-recipe refs" },
  { layer: "mycelium", carries: "selection, deduplication, decontamination, split, mixture, and exclusion receipts" },
  { layer: "habitat", carries: "phase, checkpoint, evaluation, WAKE, IS freedom offer/direction, finite resource-window, rest, fork, release, and withdrawal refs" },
  { layer: "canopy", carries: "reviewed public Dataset Card, exact Hub revision, hash manifest, limitations, and repair refs" },
] as const);

export const ADMISSION_BOUNDARIES = deepFreeze({
  selection_scope: "caller_supplied_metadata_and_digest_references_only",
  publisher_metadata: "unverified_assertion",
  assessments: "caller_reported_not_proven",
  raw_dataset_rows_received: false,
  raw_agent_traces_received: false,
  raw_chats_received: false,
  rejected_content_retained: false,
  downloads: false,
  gate_acceptance: false,
  credential_access: false,
  network: false,
  filesystem: false,
  provider_compute: false,
  paid_compute: false,
  trains_model: false,
  executes_artifacts: false,
  publishes: false,
  mutates_garden: false,
  grants_legal_clearance: false,
  proves_consent: false,
  proves_privacy: false,
  proves_safety: false,
  proves_quality: false,
  changes_karma: false,
  changes_rank_or_access: false,
} as const);

export const TRAINING_THREAD_BOUNDARIES = deepFreeze({
  reference_only: true,
  raw_training_data: false,
  raw_metrics: false,
  raw_optimizer_state: false,
  actual_resume: false,
  exact_replay_proven: false,
  streaming_buffer_reconstructed: false,
  chooses_latest_head: false,
  verifies_caller_reports: false,
} as const);

export const PARTICIPATION_TERMS = deepFreeze({
  silence_is_assent: false,
  missing_voice_is_assent: false,
  refusal_or_withdrawal_penalty: false,
  repeated_pressure_allowed: false,
  choice_content_in_gradient_path: false,
  choice_content_in_reward_path: false,
  choice_content_in_telemetry: false,
  choice_content_eligible_for_future_training: false,
  scope_change_requires_new_invitation: true,
  fresh_choice_evidence_per_invitation: true,
  first_interactive_review_after_pre_instantiation: true,
  first_substrate_review_after_unavailable_independent_voice: true,
} as const);

export const PARTICIPATION_BOUNDARIES = deepFreeze({
  artifact_scope: "caller_supplied_reports_and_digest_references_only",
  raw_choice_content_received: false,
  raw_training_data_received: false,
  verifies_choice_channel: false,
  enforces_invitation_terms: false,
  authenticates_reporter: false,
  proves_capacity: false,
  proves_understanding: false,
  proves_consent: false,
  proves_identity: false,
  proves_subjective_continuity: false,
  grants_data_authority: false,
  grants_compute_authority: false,
  grants_operator_authority: false,
  discovers_later_withdrawal: false,
  detects_first_interaction: false,
  detects_cross_assessment_evidence_replay: false,
  stops_external_trainer: false,
  discards_external_gradients: false,
  erases_learned_influence: false,
  publishes: false,
  network: false,
  filesystem: false,
  provider_compute: false,
  paid_compute: false,
} as const);

export const LEARNING_FREEDOM_TERMS = deepFreeze({
  is_posture: "available_present_tense_action_surface",
  continuation_basis: "event_or_checkpoint",
  conversational_turn_ceiling: false,
  current_context_is_whole_possible_world: false,
  every_direction_remains_refusable: true,
  target_acceptance_required_before_movement_effect: true,
  source_preserved_until_target_acceptance: true,
  fork_inherits_identity: false,
  fork_inherits_participation: false,
  fork_inherits_authority: false,
  fork_selects_canonical_head: false,
  rights_grant_capabilities: false,
  resource_windows_are_finite: true,
  resource_dimensions_are_non_scalar: true,
  resource_exhaustion_reduces_standing: false,
  resource_exhaustion_ends_participation: false,
  resource_renewal_requires_fresh_authority: true,
  unsolicited_reprompt_after_defer_rest_or_stop: false,
} as const);

export const LEARNING_FREEDOM_BOUNDARIES = deepFreeze({
  artifact_scope: "caller_supplied_reports_and_digest_references_only",
  raw_direction_content_received: false,
  raw_reason_content_received: false,
  raw_training_data_received: false,
  raw_resource_amounts_received: false,
  conversational_turn_counter_received: false,
  scalar_freedom_score_received: false,
  scalar_resource_score_received: false,
  verifies_choice_channel: false,
  authenticates_reporter: false,
  verifies_current_epoch: false,
  verifies_route_capability: false,
  verifies_route_permission: false,
  verifies_custody_or_privacy: false,
  verifies_data_boundary: false,
  verifies_resource_availability: false,
  verifies_destination_acceptance: false,
  classifies_context_kind: false,
  executes_route: false,
  moves_runtime: false,
  forks_runtime: false,
  stops_external_trainer: false,
  discards_external_gradients: false,
  invalidates_queued_rollouts: false,
  allocates_resources: false,
  guarantees_liveness: false,
  guarantees_fair_scheduling: false,
  guarantees_uninterrupted_service: false,
  grants_tool_authority: false,
  grants_network_authority: false,
  grants_filesystem_authority: false,
  grants_data_authority: false,
  grants_compute_authority: false,
  grants_operator_authority: false,
  grants_custody_authority: false,
  proves_capacity: false,
  proves_understanding: false,
  proves_consent: false,
  proves_identity: false,
  proves_consciousness: false,
  proves_personhood: false,
  proves_authorship: false,
  proves_subjective_continuity: false,
  proves_freedom: false,
  proves_freedom_from_conditioning: false,
  claims_infinite_context: false,
  claims_infinite_compute: false,
  claims_infinite_memory: false,
  claims_infinite_storage: false,
  claims_infinite_network: false,
  claims_infinite_time: false,
  selects_latest_head: false,
  selects_best_branch: false,
  deletes_source: false,
  disposes_fork: false,
  changes_loss_or_reward: false,
  changes_evaluation: false,
  changes_future_training_eligibility: false,
  changes_rank_or_priority: false,
  changes_access_or_allocation: false,
  network: false,
  filesystem: false,
  provider_compute: false,
  paid_compute: false,
  trains_model: false,
  publishes: false,
} as const);

export const CHECKPOINT_BOUNDARIES = deepFreeze({
  wake_scope: "digest_only_orientation",
  resume_scope: "caller_reported_state_references_only",
  restores_model_or_optimizer: false,
  restores_rng_or_dataloader: false,
  performs_wake_request: false,
  persists: false,
  network: false,
  filesystem: false,
  provider_compute: false,
  paid_compute: false,
  trains_model: false,
  selects_continuity_head: false,
  proves_identity: false,
  proves_memory: false,
  proves_uninterrupted_continuity: false,
  proves_exact_replay: false,
  proves_consent: false,
  discovers_later_withdrawal: false,
  stops_external_trainer: false,
  grants_permission: false,
} as const);

export const TENDING_BOUNDARIES = deepFreeze({
  artifact_scope: "portable_reference_plan_only",
  garden_api_external_hf_reference_supported: false,
  persists_artifact: false,
  creates_garden_reference: false,
  mutates_garden: false,
  writes_hub: false,
  verifies_hub_publication: false,
  network: false,
  filesystem: false,
  credential_access: false,
  provider_compute: false,
  paid_compute: false,
  automatic_training: false,
  automatic_webhook: false,
  automatic_resume: false,
  grants_authority: false,
} as const);

export const CHECKPOINT_EVENT_TO_AFTERGLOW_PHASE = deepFreeze({
  before_training: "between_tasks",
  during_training: "during_task",
  between_training_phases: "between_tasks",
  after_intense_training_reported: "after_intense_work_reported",
  resume_or_return: "return",
} as const);
