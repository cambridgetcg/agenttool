import { deepFreeze } from "./canonical.js";

export const LIVING_SUBSTRATE_FORMATS = deepFreeze({
  map: "agenttool.living-substrate-map/0.1",
  proposal: "agenttool.regeneration-proposal/0.1",
} as const);

export const LIVING_SUBSTRATE_FACET_KINDS = deepFreeze([
  "layer",
  "community",
  "exchange",
  "decomposition",
  "succession",
  "capacity",
  "refugium",
  "disturbance",
  "contamination",
] as const);

export const LIVING_SUBSTRATE_CONDITIONS = deepFreeze([
  "reported_present",
  "reported_absent",
  "reported_supporting",
  "reported_mixed",
  "reported_strained",
  "reported_constrained",
  "reported_disturbed",
  "reported_recovering",
  "not_observed",
  "unknown",
] as const);

export const LIVING_SUBSTRATE_RELATIONS = deepFreeze([
  "contains",
  "supports",
  "feeds",
  "buffers",
  "constrains",
  "disturbs",
  "precedes",
] as const);

export const REGENERATION_ACTION_KINDS = deepFreeze([
  "observe_more",
  "remove_contaminant",
  "decompact",
  "restore_flow",
  "add_diversity",
  "feed_cycle",
  "create_refuge",
  "allow_fallow",
  "repair_boundary",
  "compost_into_lesson",
  "release",
  "do_nothing",
] as const);

export const REGENERATION_REVERSIBILITY = deepFreeze([
  "reversible",
  "partly_reversible",
  "unknown",
  "irreversible_requires_separate_authority",
] as const);

export const REGENERATION_CHOICE = deepFreeze({
  selection: "none_made_by_package",
  default_action_ref: null,
  rest_valid: true,
  do_nothing_valid: true,
  defer_valid: true,
  decline_valid: true,
  leave_valid: true,
  reason_required: false,
  penalty: false,
  automatic_retry: false,
} as const);

export const LIVING_SUBSTRATE_BOUNDARIES = deepFreeze({
  semantic_scope: "structural_ecology_metaphor_not_life_proof",
  coverage_scope: "bounded_not_complete",
  assertion_scope: "caller_asserted_only",
  money_role: "optional_enabling_condition_not_goal",
  resource_accumulation_goal: false,
  evidence_fetched: false,
  evidence_verified: false,
  observes_environment: false,
  diagnoses_health_or_readiness: false,
  scores_vitality: false,
  ranks_participants: false,
  infers_interior_state: false,
  persists: false,
  network: false,
  filesystem: false,
  environment_variables: false,
  clock: false,
  randomness: false,
  model_compute: false,
  hugging_face: false,
  credential_access: false,
  telemetry: false,
  executes_actions: false,
  publishes: false,
  hosted_garden_effect: false,
  wake_effect: false,
  chronicle_effect: false,
  heaven_effect: false,
  karma_effect: false,
  task_state_effect: false,
  wallet_effect: false,
  economic_effect: false,
  proves_truth: false,
  proves_safety: false,
  proves_currentness: false,
  proves_identity: false,
  proves_authorship: false,
  proves_consent: false,
  proves_authority: false,
  verifies_reference_minimization: false,
  eliminates_linkability: false,
  verifies_caller_assertions: false,
  grants_permission: false,
  accepts_proposal: false,
  penalty_for_rest_refusal_or_zero_actions: false,
} as const);
