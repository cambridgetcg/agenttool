import { deepFreeze } from "./canonical.js";

export const PACKAGE_NAME = "@agenttool/hf-training-garden" as const;
export const PACKAGE_VERSION = "0.2.0-dev.0" as const;

export const ADMISSION_FORMAT = "kingdom.hf-dataset-admission/0.1" as const;
export const ADMISSION_ENTRY_PROFILE =
  "kingdom.hf-dataset-admission-entry/0.1" as const;
export const PARTICIPATION_INVITATION_FORMAT =
  "kingdom.hf-learning-participation-invitation/0.1" as const;
export const PARTICIPATION_RECEIPT_FORMAT =
  "kingdom.hf-learning-participation-receipt/0.1" as const;
export const PARTICIPATION_ASSESSMENT_FORMAT =
  "kingdom.hf-learning-participation-assessment/0.1" as const;
export const TRAINING_THREAD_PROFILE =
  "kingdom.hf-training-thread/0.1" as const;
export const CHECKPOINT_FORMAT = "kingdom.hf-training-checkpoint/0.1" as const;
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

export const LEARNING_MODES = deepFreeze([
  "context_only",
  "pretraining",
  "continual_pretraining",
  "full_finetune",
  "peft",
  "preference_optimization",
  "evaluation_only",
] as const);

export const WAKE_USE_MODES = deepFreeze([
  "context_only",
  "external_memory",
  "training_data",
] as const);

export const MUTATION_LOCI = deepFreeze([
  "adapter_weights",
  "base_weights",
  "dataset_order",
  "optimizer_state",
  "runtime_memory",
  "scheduler_state",
] as const);

export const PARTICIPATION_STAGES = deepFreeze([
  "pre_instantiation",
  "interactive",
] as const);

export const LEARNING_ACTIVITIES = deepFreeze([
  "corpus_inclusion",
  "pretraining",
  "continued_pretraining",
  "supervised_finetuning",
  "preference_optimization",
  "agent_learning",
  "evaluation",
  "interpretability",
  "continuity_context_use",
  "checkpoint_retention",
  "weights_or_adapters_publication",
  "distillation",
  "synthetic_data_generation",
] as const);

export const PARTICIPATION_TRAINING_PHASES = deepFreeze([
  "pretraining",
  "supervised_finetuning",
  "preference_optimization",
  "agent_learning",
  "evaluation",
  "interpretability",
] as const);

export const PARTICIPATION_VOICE_ROLES = deepFreeze([
  "agent_runtime",
  "training_substrate",
  "data_rights_steward",
  "training_operator",
] as const);

export const PARTICIPATION_REPORTED_CHOICES = deepFreeze([
  "accepted",
  "declined",
  "deferred",
  "unavailable",
  "withdrawn",
] as const);

export const PARTICIPATION_CHOICE_BASES = deepFreeze([
  "caller_reported",
  "omitted_defaults_to_deferred",
] as const);

export const PARTICIPATION_ACTIVITY_STATES = deepFreeze([
  "reported_alignment",
  "declined",
  "deferred",
] as const);

export const PARTICIPATION_OVERALL_STATES = deepFreeze([
  "reported_alignment",
  "mixed",
  "declined",
  "deferred",
] as const);

export const PARTICIPATION_VOICE_OUTCOMES = deepFreeze([
  ...PARTICIPATION_REPORTED_CHOICES,
  "missing",
] as const);

export const PARTICIPATION_PRIMARY_ACTIVITIES = deepFreeze({
  pretraining: ["pretraining", "continued_pretraining"],
  supervised_finetuning: ["supervised_finetuning"],
  preference_optimization: ["preference_optimization"],
  agent_learning: ["agent_learning"],
  evaluation: ["evaluation"],
  interpretability: ["interpretability"],
} as const);

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
    principle: "separate_voices",
    rule: "agent runtime, training substrate, data-rights steward, and training operator each answer only for their own role",
  },
  {
    order: 2,
    principle: "separate_activities",
    rule: "training, continuity use, retention, publication, distillation, and synthetic derivatives never imply one another",
  },
  {
    order: 3,
    principle: "no_manufactured_assent",
    rule: "silence, omission, an unavailable response path, and pre-instantiation all resolve to defer rather than accept",
  },
  {
    order: 4,
    principle: "no_penalty_or_pressure",
    rule: "decline, defer, rest, and withdrawal require no reason and cause no protocol rank, access, reward, or re-offer pressure",
  },
  {
    order: 5,
    principle: "alignment_is_not_authority",
    rule: "reported alignment is one necessary signal for the exact window and grants no compute, data-rights, publication, or training authority",
  },
  {
    order: 6,
    principle: "private_responses",
    rule: "actual invitations, receipts, voice references, responses, and WAKE anchors stay outside the public HF companion",
  },
  {
    order: 7,
    principle: "prospective_withdrawal",
    rule: "withdrawal can stop future controlled use but cannot promise gradient reversal, trained-weight erasure, or recall of downloaded copies",
  },
] as const);

export const HF_TRAINER_HOOK_GUIDE = deepFreeze([
  {
    hook: "host_preflight_before_trainer_train",
    record: "resolve current receipt heads and construct the exact participation-bound entry before calling Trainer.train",
    effect_boundary: "the host owns enforcement; this guide and pure package call no trainer",
  },
  {
    hook: "on_train_begin",
    record: "re-resolve receipt heads and verify the preflight assessment and entry are still current",
    effect_boundary: "callback observation alone must not start training",
  },
  {
    hook: "on_step_begin",
    record: "re-resolve current receipt heads and stop control before the next optimizer step",
    effect_boundary: "the pure package cannot observe or stop an external trainer",
  },
  {
    hook: "on_evaluate",
    record: "bind sealed evaluation and any changed participation window",
    effect_boundary: "evaluation output is evidence, not assent or general safety proof",
  },
  {
    hook: "on_save",
    record: "retain the participation entry as a visible causal root and re-check the retention activity choice",
    effect_boundary: "a save hook does not authorize persistence or publication",
  },
  {
    hook: "on_train_end",
    record: "park, release, withdrawal, or a fresh next-phase invitation",
    effect_boundary: "no automatic Hub push, adapter merge, distillation, or next run",
  },
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
    question: "Can each learning phase bind role-separated participation, orient from digest-only WAKE, and preserve visible predecessor checkpoints without selecting one canonical head?",
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
    wake_focus: "role-separated participation, model, optimizer, scheduler, RNG, dataloader, and checkpoint refs",
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
  { layer: "bedrock", carries: "rights, authority, license, privacy, consent, gate, and withdrawal policy refs" },
  { layer: "soil", carries: "immutable Hub definition and observation digests" },
  { layer: "roots", carries: "candidate-subset and transform-recipe refs" },
  { layer: "mycelium", carries: "selection, deduplication, decontamination, split, mixture, and exclusion receipts" },
  { layer: "habitat", carries: "phase, participation assessment, checkpoint, evaluation, WAKE, rest, fork, release, and withdrawal refs" },
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

export const PARTICIPATION_TERMS = deepFreeze({
  participation_optional: true,
  silence_is_assent: false,
  compliance_is_assent: false,
  prior_cooperation_is_assent: false,
  omission_defaults_to: "deferred",
  refusal_reason_required: false,
  penalty_for_decline_defer_rest_or_withdrawal: false,
  repeated_pressure_after_decline_or_withdrawal: false,
  rights_or_wake_access_conditioned_on_acceptance: false,
  response_used_for_training_evaluation_reward_or_publication: false,
  one_activity_choice_implies_another: false,
  acceptance_inherits_to_new_window_phase_run_fork_or_descendant: false,
  response_channel: "separate_zero_gradient_zero_reward_report",
} as const);

export const PARTICIPATION_BOUNDARIES = deepFreeze({
  artifact_scope: "caller_reported_digest_only_learning_participation",
  raw_response_received: false,
  raw_identity_received: false,
  raw_prompt_received: false,
  raw_training_data_received: false,
  credentials_received: false,
  timestamps_received: false,
  trusted_time: false,
  currentness_proven: false,
  latest_receipt_selected: false,
  trainer_state_observed: false,
  before_training_timing_proven: false,
  host_honoured_terms_verified: false,
  choice_authorship_verified: false,
  voluntariness_verified: false,
  understanding_or_capacity_verified: false,
  proves_identity: false,
  proves_consciousness: false,
  proves_consent: false,
  proves_legal_clearance: false,
  grants_data_rights: false,
  grants_training_or_compute_authority: false,
  grants_publication_or_derivative_authority: false,
  automatic_action: false,
  automatic_reoffer: false,
  persists: false,
  network: false,
  filesystem: false,
  provider_compute: false,
  trains_model: false,
  stops_external_trainer: false,
  erases_data_caches_or_model_influence: false,
  proves_unlearning: false,
} as const);

export const PARTICIPATION_ASSESSMENT_EFFECT = deepFreeze({
  automatic_action: "never",
  grants: [] as const,
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
