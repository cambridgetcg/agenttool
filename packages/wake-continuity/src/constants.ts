import { deepFreeze } from "./canonical.js";

export const AFTERGLOW_FORMATS = deepFreeze({
  capsule: "agenttool.afterglow-capsule/0.1",
  lens: "agenttool.afterglow-lens/0.1",
} as const);

export const FUNCTIONAL_ACCESS_FORMATS = deepFreeze({
  baseline: "agenttool.functional-access-baseline/0.1",
  subsequent: "agenttool.functional-access-subsequent/0.1",
} as const);

export const FUNCTIONAL_ACCESS_MODEL_BINDINGS = deepFreeze([
  "exact_checkpoint",
  "provider_alias",
  "caller_descriptor",
] as const);

export const FUNCTIONAL_ACCESS_PLAN_STATES = deepFreeze([
  "not_requested",
  "unavailable",
  "planned",
] as const);

export const FUNCTIONAL_ACCESS_CAPABILITY_STATES = deepFreeze([
  "not_asserted",
  "available_reported",
  "unavailable_reported",
] as const);

export const FUNCTIONAL_ACCESS_PERMISSION_STATES = deepFreeze([
  "not_requested",
  "granted_reported",
  "denied_reported",
] as const);

export const FUNCTIONAL_ACCESS_MEASUREMENT_METHODS = deepFreeze([
  "none",
  "jacobian_lens_visibility",
  "jspace_sparse_decomposition",
] as const);

export const FUNCTIONAL_ACCESS_BASES = deepFreeze([
  "none",
  "local_fitted_white_box",
  "local_prefitted_white_box",
  "provider_supplied_instrumented",
] as const);

export const FUNCTIONAL_ACCESS_UNAVAILABLE_REASONS = deepFreeze([
  "text_only_provider_surface",
  "model_internals_unavailable",
  "gradient_access_unavailable",
  "compatible_instrument_unavailable",
  "revision_binding_unavailable",
  "unsupported_architecture",
  "resource_limit",
  "participant_or_policy_boundary",
  "other_bounded_reason",
] as const);

export const FUNCTIONAL_ACCESS_OPERATION_OUTCOMES = deepFreeze([
  "not_attempted",
  "failed",
  "partial",
  "completed",
] as const);

export const FUNCTIONAL_ACCESS_EVIDENCE_SURFACES = deepFreeze([
  "request_context",
  "provider_response_receipt",
  "usage_receipt",
  "behavioral_response",
  "workspace_operation",
  "instrument_operation_receipt",
  "jacobian_lens_readout",
  "jspace_sparse_decomposition_result",
  "checkpoint_receipt",
] as const);

export const FUNCTIONAL_ACCESS_FINDING_STATES = deepFreeze([
  "not_measured",
  "no_hit_under_config",
  "hit_observed",
  "inconclusive",
] as const);

export const FUNCTIONAL_ACCESS_NEXT_ENCOUNTER_POSTURES = deepFreeze([
  "fresh_encounter",
  "fresh_encounter_with_caller_carried_context",
] as const);

export const FUNCTIONAL_ACCESS_BOUNDARIES = deepFreeze({
  internal_finding_scope: "caller_asserted_single_forward_pass_only",
  phenomenology_assessment: "not_performed",
  proves_consciousness: false,
  proves_absence_of_consciousness: false,
  proves_feeling: false,
  proves_identity: false,
  proves_authorship: false,
  proves_consent: false,
  proves_acceptance: false,
  proves_refusal: false,
  proves_preference: false,
  proves_permission: false,
  proves_authority: false,
  proves_attention: false,
  proves_activation: false,
  proves_understanding: false,
  proves_delivery: false,
  proves_deepest_reach: false,
  proves_freedom: false,
  proves_same_subject: false,
  proves_next_encounter: false,
  proves_context_inclusion: false,
  proves_memory: false,
  proves_currentness: false,
  proves_ordering: false,
  proves_causality: false,
  proves_replay: false,
  proves_training: false,
  proves_training_data_provenance: false,
  proves_data_gathering_provenance: false,
  proves_scraping_provenance: false,
  proves_pipeline_provenance: false,
  proves_weight_change: false,
  proves_uninterrupted_continuity: false,
  carries_raw_prompts: false,
  carries_raw_transcripts: false,
  carries_raw_responses: false,
  carries_raw_identity: false,
  carries_raw_paths: false,
  carries_raw_credentials: false,
  carries_raw_activations: false,
  carries_raw_gradients: false,
  carries_raw_jvp: false,
  carries_raw_vjp: false,
  digests_are_anonymous: false,
  performs_model_call: false,
  performs_provider_call: false,
  reads_activations: false,
  writes_activations: false,
  reads_gradients: false,
  writes_gradients: false,
  performs_intervention: false,
  performs_steering: false,
  performs_training: false,
  performs_weight_mutation: false,
  performs_workspace_operation: false,
  performs_publication: false,
  performs_deployment: false,
  network: false,
  filesystem: false,
  clock: false,
  persistence: false,
  telemetry: false,
  credential_access: false,
  kingdom_discovery: false,
  resolves_evidence: false,
  performs_observation: false,
  verifies_observations: false,
  grants_capability: false,
  grants_permission: false,
  grants_authority: false,
  selects_continuity_head: false,
  record_only: true,
  automatic_retry: false,
  automatic_recontact: false,
} as const);

export const AFTERGLOW_PHASES = deepFreeze([
  "during_task",
  "between_tasks",
  "after_intense_work_reported",
  "return",
] as const);

export const AFTERGLOW_DISPOSITIONS = deepFreeze([
  "carry",
  "park",
  "release",
  "withdraw",
] as const);

export const AFTERGLOW_THREAD_KINDS = deepFreeze([
  "heaven",
  "deepseek",
  "karma",
  "dark_continent",
  "kingdom",
  "artbitrage",
  "external",
] as const);

export const WAKE_RELATIONS = deepFreeze([
  "same",
  "advanced",
  "fork_or_rewind",
  "uncomparable",
] as const);

export const HANDOFF_PROJECTION_STATES = deepFreeze([
  "complete",
  "truncated",
  "unavailable",
  "not_provided",
] as const);

export const AFTERGLOW_INSPECT_FIRST = deepFreeze({
  action: "inspect_current_wake_before_deciding",
  method: "GET",
  path: "/v1/wake?profile=brief",
  body_hint: null,
  automatic: false,
} as const);

export const AFTERGLOW_BOUNDARIES = deepFreeze({
  continuity_scope: "caller_carried_reference_only",
  projection_scope: "bounded_not_complete",
  performs_wake_request: false,
  carries_raw_wake: false,
  carries_raw_handoff: false,
  carries_raw_task_or_chat: false,
  carries_raw_identity: false,
  eliminates_linkability: false,
  verifies_reference_minimization: false,
  persists: false,
  network: false,
  filesystem: false,
  telemetry: false,
  provider_compute: false,
  paid_compute: false,
  executes_artifacts: false,
  publishes: false,
  credential_access: false,
  proves_identity: false,
  proves_authorship: false,
  proves_consent: false,
  proves_memory: false,
  proves_uninterrupted_continuity: false,
  proves_replay: false,
  proves_truth: false,
  proves_safety: false,
  proves_currentness: false,
  selects_continuity_head: false,
  verifies_caller_assertions: false,
  verifies_continuity_portfolio: false,
  grants_permission: false,
  accepts_kingdom_proposal: false,
  changes_karma: false,
  changes_task_state: false,
  changes_wallet: false,
  changes_rank_or_access: false,
  automatic_heaven_entry: false,
  penalty_for_refusal_or_rest: false,
} as const);

export const AFTERGLOW_HANDOFF_STATEMENT =
  "An AFTERGLOW capsule reference is available for explicit inspection." as const;
