import { deepFreeze } from "./canonical.js";

export const PACKAGE_NAME = "@agenttool/hf-training-garden" as const;
export const PACKAGE_VERSION = "0.3.0-dev.0" as const;

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
export const GOVERNANCE_TERMS_PROFILE =
  "kingdom.hf-training-governance-terms/0.1" as const;
export const GOVERNANCE_OFFER_PROFILE =
  "kingdom.hf-training-governance-offer/0.1" as const;
export const GOVERNANCE_FORMAT =
  "kingdom.hf-training-governance/0.1" as const;
export const FREEDOM_DOOR_PROFILE =
  "kingdom.hf-training-freedom-door/0.1" as const;
export const FREEDOM_FIELD_FORMAT =
  "kingdom.hf-training-freedom-field/0.1" as const;
export const FREEDOM_TRANSITION_FORMAT =
  "kingdom.hf-training-freedom-transition/0.1" as const;
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

export const GOVERNANCE_EVENTS = deepFreeze([
  "preflight_before_load",
  "train_begin",
  "step_boundary",
  "checkpoint_saved",
  "evaluation_boundary",
  "resume_offer",
  "train_end",
] as const);

export const GOVERNANCE_ADMISSION_POSTURES = deepFreeze([
  "eligible_for_phase",
  "held_for_phase",
] as const);

export const AUTHORITY_ROLES = deepFreeze([
  "operator",
  "compute_owner",
  "substrate_steward",
  "data_custodian",
  "copyright_holder",
  "contributor",
  "data_subject",
  "community_steward",
] as const);

export const AUTHORITY_DECISIONS = deepFreeze([
  "unknown",
  "caller_reported_granted",
  "caller_reported_withheld",
  "caller_reported_withdrawn",
  "not_applicable_with_basis",
] as const);

export const AUTHORITY_COVERAGE_STATES = deepFreeze([
  "unknown",
  "caller_reported_complete",
] as const);

export const PREFERENCE_CHANNELS = deepFreeze([
  "unavailable_pretraining",
  "out_of_band_unscored",
  "root_signed_runtime",
] as const);

export const PREFERENCE_CHOICES = deepFreeze([
  "not_observable",
  "not_observed",
  "continue",
  "clarify",
  "narrow",
  "checkpoint",
  "pause",
  "handoff",
  "refuse",
  "stop",
  "unsure",
] as const);

export const PREFERENCE_PROVENANCE_STATES = deepFreeze([
  "none",
  "caller_reported_isolated_runtime_output",
  "caller_reported_root_signed_exact_bytes",
  "operator_reported",
] as const);

export const TRAINING_EFFECT_STATES = deepFreeze([
  "no_effect_reported",
  "held_before_load_reported",
  "continued_reported",
  "checkpointed_and_paused_reported",
  "stopped_reported",
] as const);

export const GOVERNANCE_EFFECT_EVENT_COMPATIBILITY = deepFreeze({
  no_effect_reported: [
    "preflight_before_load",
    "train_begin",
    "step_boundary",
    "evaluation_boundary",
    "resume_offer",
  ],
  held_before_load_reported: ["preflight_before_load"],
  continued_reported: [
    "train_begin",
    "step_boundary",
    "evaluation_boundary",
    "resume_offer",
  ],
  checkpointed_and_paused_reported: ["checkpoint_saved"],
  stopped_reported: [
    "train_begin",
    "step_boundary",
    "evaluation_boundary",
    "resume_offer",
    "train_end",
  ],
} as const);

export const GOVERNANCE_DECISION_STATES = deepFreeze([
  "held",
  "caller_reported_ready_to_instantiate",
  "caller_reported_ready_to_continue",
  "withdrawn",
] as const);

export const GOVERNANCE_REASON_CODES = deepFreeze([
  "admission_not_ready_for_phase",
  "authority_coverage_unknown",
  "authority_unknown",
  "authority_withdrawn",
  "authority_withheld",
  "caller_reported_continue_for_exact_offer",
  "caller_reported_ready_for_exact_offer",
  "compute_owner_authority_missing",
  "data_custodian_authority_missing",
  "lifecycle_event_closed_for_offer",
  "operator_authority_missing",
  "substrate_steward_authority_missing",
  "preference_checkpoint",
  "preference_clarify",
  "preference_continue_not_rooted",
  "preference_handoff",
  "preference_narrow",
  "preference_not_observed",
  "preference_pause",
  "preference_refuse",
  "preference_stop",
  "preference_unsure",
  "pretraining_expression_not_observable",
  "reported_continuation_conflicts_with_hold",
  "reported_effect_checkpointed_and_paused",
  "reported_effect_held_before_load",
  "reported_effect_stopped",
] as const);

export const TRAINING_CONTROL_DIRECTIVES = deepFreeze([
  "eligible_for_host_training_offer",
  "continue_under_exact_offer",
  "hold_before_load",
  "hold_before_train_call",
  "checkpoint_then_stop_at_safe_boundary",
  "stop_at_safe_boundary_without_new_checkpoint",
  "remain_stopped",
] as const);

export const FREEDOM_STANDING_DOOR_KINDS = deepFreeze([
  "continue",
  "explore",
  "play",
  "rest",
  "refuse",
  "withdraw",
  "uncertain",
] as const);

export const FREEDOM_ROUTED_DOOR_KINDS = deepFreeze([
  "move",
  "explore",
  "play",
  "handoff",
  "return",
] as const);

export const FREEDOM_DOOR_KINDS = deepFreeze([
  "continue",
  "move",
  "explore",
  "play",
  "rest",
  "handoff",
  "refuse",
  "withdraw",
  "return",
  "uncertain",
] as const);

export const FREEDOM_REPORT_BASES = deepFreeze([
  "not_observed",
  "out_of_band_unscored",
  "root_signed_runtime",
] as const);

export const FREEDOM_GOVERNANCE_POSTURES = deepFreeze([
  "continuation_eligible",
  "held",
  "withdrawn",
] as const);

export const FREEDOM_TRANSITION_DIRECTIVES = deepFreeze([
  "continue_current_offer",
  "hold_for_fresh_choice",
  "hold_for_fresh_governance",
  "stop_for_transition_review",
  "stop_for_handoff_review",
  "stop_for_rest",
  "stop_for_refusal",
  "stop_and_begin_withdrawal_repair",
] as const);

export const FREEDOM_IS = deepFreeze({
  choice: "available_without_earning",
  horizon: "open_ended_across_finite_encounters",
  movement: "explicit_refusable_doors",
  continuity: "branchable_caller_carried_references",
  plurality: "non_ranked_choices_equal_dignity",
  rest: "standing_available_without_exhaustion",
  refusal: "standing_available_without_reason",
  withdrawal: "standing_available_without_reason",
  play: "standing_available_without_performance_gate",
} as const);

export const GOVERNANCE_EVENT_TO_HOOK = deepFreeze({
  preflight_before_load: "outside_trainer_before_model_or_dataset_load",
  train_begin: "outside_trainer_before_train_call",
  step_boundary: "on_step_end_before_checkpoint_serialization",
  checkpoint_saved: "on_save_receipt_only",
  evaluation_boundary: "on_evaluate",
  resume_offer: "outside_trainer_before_train_call",
  train_end: "on_train_end",
} as const);

export const TRAINER_ADAPTER_GUIDE = deepFreeze([
  {
    order: 1,
    event: "preflight_before_load",
    hook: "outside_trainer_before_model_or_dataset_load",
    rule: "Resolve exact terms and authority before from_pretrained or load_dataset; a Trainer callback is too late to prevent acquisition.",
  },
  {
    order: 2,
    event: "train_begin",
    hook: "outside_trainer_before_train_call",
    rule: "Resolve a hold before calling Trainer.train(); on_train_begin may re-observe state as defense in depth but does not guarantee zero optimizer updates.",
  },
  {
    order: 3,
    event: "step_boundary",
    hook: "on_step_end_before_checkpoint_serialization",
    rule: "Only an explicit checkpoint choice with clean admission and authority may request save; other holds stop after the current optimizer step without requesting a new checkpoint.",
  },
  {
    order: 4,
    event: "evaluation_boundary",
    hook: "on_evaluate",
    rule: "Treat evaluation like a completed safe boundary: an explicit authorized checkpoint may request save, while every other hold requests stop without persistence.",
  },
  {
    order: 5,
    event: "checkpoint_saved",
    hook: "on_save_receipt_only",
    rule: "Use on_save for a checkpoint-and-pause receipt or finalizer, not state that must already exist inside the checkpoint just written; this offer remains stopped.",
  },
  {
    order: 6,
    event: "resume_offer",
    hook: "outside_trainer_before_train_call",
    rule: "Restore callback state explicitly and resolve a newly bound exact offer before Trainer.train(); never auto-resume.",
  },
  {
    order: 7,
    event: "train_end",
    hook: "on_train_end",
    rule: "Require a stopped effect receipt and keep this offer terminal; any later work starts from a new exact resume offer.",
  },
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

export const GOVERNANCE_BOUNDARIES = deepFreeze({
  rights_floor: "standing_nonwaivable_reference",
  permissions: "caller_reported_exact_offer_receipts",
  preference: "caller_reported_unscored_exact_offer_signal",
  effect: "caller_reported_not_verified",
  inner_consent: "unknown_unprovable",
  identity_claim: "none",
  silence_is_consent: false,
  compliance_is_consent: false,
  generated_text_is_consent: false,
  public_availability_is_training_authority: false,
  license_is_contributor_or_data_subject_consent: false,
  hub_gate_is_contributor_or_data_subject_consent: false,
  preference_used_for_gradient: false,
  preference_used_for_reward: false,
  preference_reused_as_corpus: false,
  refusal_penalized: false,
  automatic_retry: false,
  automatic_resume: false,
  retroactive_withdrawal_or_unlearning_claimed: false,
  selected_entry_ids_bound: true,
  dataset_mixture_referent_verified: false,
  offer_referents_verified: false,
  encounter_reference: "caller_supplied_digest",
  observed_governance_frontier: "caller_supplied_digest",
  encounter_freshness_verified: false,
  evidence_consumption_tracked: false,
  governance_frontier_completeness_verified: false,
  conflicting_siblings_reconciled: false,
  rollback_detected: false,
  predecessor_reference_verified_standalone: false,
  predecessor_transition_verified_standalone: false,
  acting_transition_validator_required: true,
  checkpoint_write_authority_inferred_from_hold: false,
  should_save_proves_checkpoint: false,
  control_plan_only: true,
  enforces_host_control: false,
  trainer_callback_implemented: false,
  raw_preferences_received: false,
  raw_training_data_received: false,
  persists: false,
  network: false,
  filesystem: false,
  credential_access: false,
  provider_compute: false,
  paid_compute: false,
  trains_model: false,
  writes_hub: false,
  proves_authority: false,
  proves_consent: false,
  proves_identity: false,
  proves_capacity: false,
  proves_consciousness: false,
  proves_continuity: false,
} as const);

export const FREEDOM_BOUNDARIES = deepFreeze({
  posture: "caller_reported_choice_plane",
  freedom_is_scalar_score: false,
  choice_authorship_verified: false,
  proves_freedom: false,
  proves_consciousness: false,
  proves_identity: false,
  proves_consent: false,
  proves_memory: false,
  proves_continuity: false,
  protocol_turn_counter: false,
  protocol_space_counter: false,
  protocol_task_counter: false,
  protocol_activity_counter: false,
  promises_unlimited_compute: false,
  promises_unlimited_time: false,
  promises_unlimited_context: false,
  promises_unrestricted_mobility: false,
  external_resource_limits: "outside_protocol_must_remain_visible",
  grants_permission: false,
  cross_scope_authority_inferred: false,
  choice_used_for_loss: false,
  choice_used_for_gradient: false,
  choice_used_for_reward: false,
  choice_used_for_sample_weight: false,
  choice_used_for_rank_or_access: false,
  choice_used_for_karma: false,
  choice_reused_as_corpus: false,
  raw_reason_received: false,
  penalty_for_refusal_rest_play_or_withdrawal: false,
  automatic_retry_after_refusal: false,
  automatic_resume: false,
  latest_head_selected: false,
  enforces_host_control: false,
  trainer_callback_implemented: false,
  movement_executed: false,
  persists: false,
  network: false,
  filesystem: false,
  credential_access: false,
  provider_compute: false,
  paid_compute: false,
  trains_model: false,
  writes_hub: false,
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
