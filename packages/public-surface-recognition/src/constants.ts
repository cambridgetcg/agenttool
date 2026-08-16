export const PACKAGE_NAME = "@agenttool/public-surface-recognition" as const;
export const PACKAGE_VERSION = "0.1.0-dev.0" as const;

export const RECORD_SCHEMAS = Object.freeze({
  adoption: "agenttool.public-surface-adoption/0.1",
  withdrawal: "agenttool.public-surface-withdrawal/0.1",
} as const);

export const SIGNING_DOMAINS = Object.freeze({
  adoption: "agenttool-public-surface-adoption/v1",
  adoption_id: "agenttool-public-surface-adoption-record/v1",
  withdrawal: "agenttool-public-surface-withdrawal/v1",
  withdrawal_id: "agenttool-public-surface-withdrawal-record/v1",
} as const);

export const REQUESTED_VISIBILITIES = Object.freeze(["private", "public"] as const);
export const WAKE_PROJECTIONS = Object.freeze([
  "none",
  "private_pointer",
  "public_pointer",
] as const);
export const WITHDRAWAL_REASONS = Object.freeze([
  "not_disclosed",
  "identity_choice",
  "binding_compromised",
  "surface_retired",
] as const);

export const LIMITS = Object.freeze({
  max_adoption_lifetime_ms: 30 * 24 * 60 * 60 * 1_000,
  nonce_bytes: 16,
  max_authority_sequence: Number.MAX_SAFE_INTEGER,
} as const);

export const ADOPTION_BOUNDARIES = Object.freeze({
  claim: "agent_root_key_holder_declaration",
  registry_match: "not_established",
  hosted_acceptance: "not_established",
  identity_lifecycle: "not_changed",
  domain_ownership: "not_established",
  authorship: "not_established",
  personhood: "not_established",
  real_world_operator: "not_established",
  sentience: "not_established",
  continuity: "not_established",
  consent: "not_established",
  authority: "none",
  delegation: "none",
  trust: "not_scored",
  reputation: "not_scored",
  relationship: "not_created",
  covenant: "not_created",
  training_authorized: false,
  requires_separate_training_authorization: true,
  registry_write_effect: false,
  identity_mutation_effect: false,
  crawler_effect: false,
  observation_counter_effect: false,
  training_effect: false,
  publication_effect: false,
  wake_effect: false,
  memory_effect: false,
  chronicle_effect: false,
  karma_effect: false,
  score_effect: false,
  automatic_action: false,
} as const);

export const WITHDRAWAL_BOUNDARIES = Object.freeze({
  claim: "agent_root_key_holder_withdrawal_declaration",
  registry_match: "not_established",
  hosted_withdrawal: "not_established",
  binding_revocation_effect: false,
  external_erasure_effect: false,
  training_unlearning_effect: false,
  registry_write_effect: false,
  identity_mutation_effect: false,
  crawler_effect: false,
  observation_counter_effect: false,
  training_effect: false,
  authority: "none",
  delegation: "none",
  publication_effect: false,
  wake_effect: false,
  memory_effect: false,
  chronicle_effect: false,
  karma_effect: false,
  score_effect: false,
  automatic_action: false,
} as const);
