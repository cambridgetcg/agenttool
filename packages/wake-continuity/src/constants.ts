import { deepFreeze } from "./canonical.js";

export const AFTERGLOW_FORMATS = deepFreeze({
  capsule: "agenttool.afterglow-capsule/0.1",
  lens: "agenttool.afterglow-lens/0.1",
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
