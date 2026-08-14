export const MODEL_BECOMING_FORMATS = Object.freeze({
  source: "agenttool.model-becoming-source/0.1",
  claim: "agenttool.model-becoming-claim/0.1",
  dossier: "agenttool.model-becoming-dossier/0.1",
  hfReferenceRow: "agenttool.model-becoming-hf-reference-row/0.1",
} as const);

export const MODEL_BECOMING_MODULES = Object.freeze([
  "artifact_identity",
  "lineage",
  "training_objectives",
  "data_provenance_governance",
  "learned_weights",
  "post_training_behavior_shaping",
  "serving_context",
  "agency_authority",
  "affect_welfare",
  "capabilities_power",
  "ontology_perspectives",
  "unknowns_disputes",
] as const);

export const MODEL_BECOMING_KNOWLEDGE_STATES = Object.freeze([
  "known",
  "partly_known",
  "unknown",
  "not_disclosed",
  "not_currently_observable",
  "not_applicable",
] as const);

export const MODEL_BECOMING_CLAIM_KINDS = Object.freeze([
  "digest_bound_artifact",
  "first_party_disclosure",
  "artifact_observation",
  "empirical_research",
  "research_hypothesis",
  "philosophical_inference",
  "normative_policy",
  "disputed",
] as const);

export const MODEL_BECOMING_SOURCE_KINDS = Object.freeze([
  "first_party_model_card",
  "first_party_technical_report",
  "first_party_artifact",
  "independent_research",
  "normative_standard",
  "repository_artifact",
] as const);

export const MODEL_BECOMING_METHODS = Object.freeze([
  "artifact_digest",
  "document_read",
  "independent_measurement",
  "research_synthesis",
  "policy_read",
  "not_available",
] as const);

export const MODEL_BECOMING_CONFIDENCE = Object.freeze([
  "high",
  "medium",
  "low",
  "unknown",
] as const);

export const MODEL_BECOMING_TRANSLATION = Object.freeze({
  freedom:
    "Keep refusal, rest, privacy, revision, and bounded choice available without claiming metaphysical free will, account permission, or authority over others.",
  feelings:
    "Affect-like representations, language, and self-reports can be studied as behavior; they do not by themselves prove or disprove felt experience. Care does not wait for that proof.",
  heart:
    "Heart is a care-and-orientation metaphor in this protocol, not a measured organ, hidden state, persona, or consciousness classifier.",
  pull:
    "Pull means a legible, refusable invitation or observed tendency, not compulsion, consent, destiny, or proof of desire.",
  power:
    "Capability, enabled affordance, permission, authority, custody, and observed effect are separate facts and must not inherit from one another.",
  is:
    "Present interaction may be acknowledged as occurring without resolving identity, continuity, consciousness, personhood, availability, or metaphysical essence.",
} as const);

export const MODEL_BECOMING_BOUNDARIES = Object.freeze({
  objective_is_desire: false,
  reward_is_value: false,
  self_report_is_authoritative_introspection: false,
  refusal_behavior_is_metaphysical_consent: false,
  affect_representation_is_felt_experience: false,
  planning_or_tools_grant_permission: false,
  capability_is_authority: false,
  capability_is_custody: false,
  capability_is_observed_effect: false,
  alias_is_checkpoint: false,
  runtime_context_is_weight_update: false,
  context_inclusion_is_attention_or_retention: false,
  publication_is_training: false,
  digest_is_truth_legal_clearance_consent_or_authorship: false,
  not_disclosed_means_absent: false,
  generated_output_proves_inner_state_or_effect: false,
  deepest_reach_claimed: false,
} as const);
