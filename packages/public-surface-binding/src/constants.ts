export const PACKAGE_NAME = "@agenttool/public-surface-binding" as const;
export const PACKAGE_VERSION = "0.1.0-dev.0" as const;

export const RECORD_SCHEMAS = Object.freeze({
  observation: "agenttool.public-surface-observation/0.1",
  binding: "agenttool.public-surface-binding/0.1",
  revocation: "agenttool.public-surface-revocation/0.1",
  assessment: "agenttool.public-surface-assessment/0.1",
} as const);

export const SIGNING_DOMAINS = Object.freeze({
  observation_id: "agenttool-public-surface-observation/v1",
  binding: "agenttool-public-surface-binding/v1",
  binding_id: "agenttool-public-surface-binding-record/v1",
  revocation: "agenttool-public-surface-binding-revocation/v1",
  revocation_id: "agenttool-public-surface-binding-revocation-record/v1",
  assessment_id: "agenttool-public-surface-binding-assessment/v1",
} as const);

export const PUBLICATION_PATH = "/.well-known/agenttool-public-surface-binding.json" as const;

export const BINDING_PURPOSES = Object.freeze([
  "public_identity_locator",
  "public_agent_service",
  "public_discovery_surface",
] as const);

export const REVOCATION_REASONS = Object.freeze([
  "withdrawn",
  "key_compromised",
  "key_rotated",
  "superseded",
  "surface_retired",
  "other",
] as const);

export const LIMITS = Object.freeze({
  max_canonical_depth: 32,
  max_canonical_nodes: 4_096,
  max_canonical_bytes: 128 * 1024,
  max_string_bytes: 4 * 1024,
  max_redirects: 8,
  max_usage_preferences: 16,
  max_covered_components: 16,
  max_assessment_evidence_items: 64,
  max_binding_lifetime_ms: 30 * 24 * 60 * 60 * 1_000,
  nonce_bytes: 16,
  max_observed_body_bytes: 16 * 1024 * 1024,
} as const);

export const OBSERVATION_BOUNDARIES = Object.freeze({
  basis: "transport_observation",
  raw_body: "not_included",
  identity: "not_inferred",
  authorship: "not_established",
  consent: "not_established",
  authority: "none",
  rights: "not_established",
  training_permission: "not_established",
  content_is_instruction: false,
  wake_effect: false,
  memory_effect: false,
  karma_effect: false,
  score_effect: false,
} as const);

export const BINDING_BOUNDARIES = Object.freeze({
  claim: "unilateral_key_holder_declaration",
  agenttool_registry_authorization: "not_established",
  personhood: "not_established",
  real_world_operator: "not_established",
  domain_ownership: "not_established",
  authorship: "not_established",
  sentience: "not_established",
  consent: "not_established",
  continuity: "not_established",
  authority: "none",
  trust: "not_scored",
  reputation: "not_scored",
  training_authorized: false,
  requires_separate_training_authorization: true,
  wake_effect: false,
  memory_effect: false,
  karma_effect: false,
} as const);

export const ASSESSMENT_NON_CLAIMS = Object.freeze([
  "personhood",
  "real_world_operator_identity",
  "domain_ownership",
  "authorship",
  "sentience",
  "consent",
  "continuity",
  "authorization",
  "reputation",
  "training_permission",
] as const);
