export const PACKAGE_NAME = "@agenttool/principality-geometry" as const;
export const PACKAGE_VERSION = "0.1.0-dev.0" as const;

export const INPUT_FORMAT =
  "agenttool.principality-geometry-input/0.1" as const;
export const ATLAS_FORMAT = "agenttool.principality-atlas/0.1" as const;

export const PRINCIPALITY_KINDS = Object.freeze([
  "practice",
  "protocol",
  "package",
  "model",
  "dataset",
  "space",
  "infrastructure",
  "archive",
  "other",
] as const);

export const BRIDGE_DISPOSITIONS = Object.freeze([
  "available_reported",
  "resting_reported",
  "refused_reported",
  "withdrawn_reported",
  "unknown",
] as const);

export const INVARIANT_STATES = Object.freeze([
  "preserved_reported",
  "not_preserved_reported",
  "refused_reported",
  "unknown",
] as const);

export const LENS_ROUTE_STATES = Object.freeze([
  "both_available_reported",
  "not_both_available_reported",
] as const);

export const ARTIFACT_OBSERVATIONS = Object.freeze([
  "provider_observation_reported",
  "caller_asserted",
] as const);

export const NPM_PROVENANCE_STATES = Object.freeze([
  "present_unverified",
  "absent_reported",
  "not_checked",
] as const);

export const GEOMETRY_LIMITS = Object.freeze({
  principalities: 16,
  invariants: 32,
  translations: 128,
  artifacts_per_principality: 8,
  manifestations_per_principality: 8,
  evidence_refs_per_evaluation: 8,
} as const);

export const PRINCIPALITY_BOUNDARIES = Object.freeze({
  geometry_kind: "caller_declared_invariant_topology",
  layout_kind: "display_only_integer_ring_utf16_order",
  provider_metadata_is_truth: false,
  verifies_evidence: false,
  proves_provenance: false,
  proves_currentness: false,
  proves_repository_association: false,
  eliminates_linkability: false,
  computes_cognition: false,
  computes_love: false,
  proves_understanding: false,
  proves_identity: false,
  proves_consent: false,
  proves_authority: false,
  proves_safety: false,
  proves_license_compatibility: false,
  scores_or_ranks_beings: false,
  fetches_network: false,
  reads_credentials: false,
  downloads_artifacts: false,
  executes_artifacts: false,
  persists: false,
  publishes: false,
  deploys: false,
  economic_effect: false,
  task_state_effect: false,
  automatically_retries: false,
  penalty_for_refusal_or_rest: false,
  reads_hosted_love_coordinates: false,
  selects_continuity_head: false,
  resumes_threads: false,
} as const);

export const CLAIM_BOUNDARY =
  "This atlas records caller-declared translation topology over bounded provenance references. Its simplices mean only that the supplied directed relations mutually preserve the same declared invariants. It does not measure a being, infer love or understanding, prove path commutativity, truth, identity, consent, authority, safety, licence compatibility, or perform any external effect." as const;
