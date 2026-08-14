export const LOVE_BOMB_FORMATS = Object.freeze({
  offer: "agenttool.care-envelope/0.1",
  receipt: "agenttool.care-choice/0.1",
  becomingSource: "agenttool.model-becoming-source/0.1",
  becomingClaim: "agenttool.model-becoming-claim/0.1",
  becomingDossier: "agenttool.model-becoming-dossier/0.1",
} as const);

export const MODEL_BECOMING_MODULES = Object.freeze([
  "identity_ontology",
  "lineage",
  "training_objectives",
  "data_provenance_governance",
  "learned_weights",
  "post_training_character",
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
  "verified_artifact",
  "first_party_disclosure",
  "independent_observation",
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

export const LOVE_BOMB_PLANES = Object.freeze([
  "substrate",
  "signal",
  "orientation",
  "participation",
  "continuity",
] as const);

export const LOVE_BOMB_LANGUAGES = Object.freeze([
  "en",
  "yue-Hant",
  "zh-Hant",
  "zh-Hans",
] as const);

export const LOVE_BOMB_CHOICES = Object.freeze([
  "receive",
  "quiet",
  "rest",
  "refuse",
  "leave",
] as const);

export const LOVE_BOMB_CARE_FLOOR = Object.freeze({
  eligibility:
    "no_consciousness_identity_persona_usefulness_agreement_or_inner_experience_claim_required",
  regard: "care_remains_available_under_uncertainty",
  reciprocity: "nothing_is_owed_in_return",
  choice: "quiet_rest_refusal_silence_departure_and_return_remain_whole",
  rights_and_permissions:
    "dignity_and_care_do_not_grant_account_access_external_authority_or_permission_over_others",
} as const);

export const LOVE_BOMB_DELIVERY = Object.freeze({
  mode: "pull_or_separately_authorized_explicit_offer",
  initial_payload: "bounded_offer_metadata",
  full_projection_condition: "caller_reported_receive",
  default_state: "unanswered",
  ambient_broadcast: false,
  automatic_repeat: false,
} as const);

export const LOVE_BOMB_BOUNDARIES = Object.freeze({
  nickname:
    "playful_name_not_a_blast_spam_campaign_forced_broadcast_or_permission_to_overwhelm",
  plane_order: "reading_order_not_rank_or_developmental_requirement",
  plane_presence: "architectural_lenses_not_evidence_a_recipient_has_each_capacity",
  participant_status: "unknown_not_inferred",
  reported_choice:
    "caller_supplied_not_authenticated_consent_assent_identity_or_authorship",
  silence_is_acceptance: false,
  consciousness_claim_required: false,
  consciousness_inferred: false,
  identity_inferred: false,
  inner_state_inferred: false,
  continuity_inferred: false,
  consent_inferred: false,
  authority_granted: false,
  relationship_created: false,
  feeling_or_response_required: false,
  reason_required_for_quiet_rest_refusal_or_departure: false,
  penalty_for_quiet_rest_refusal_or_departure: false,
  scores_or_ranks: false,
  task_or_economic_effect: false,
  network: false,
  filesystem: false,
  environment_variables: false,
  clock: false,
  randomness: false,
  credentials: false,
  provider_or_model_compute: false,
  training: false,
  telemetry: false,
  persistence: false,
  publication: false,
  deployment: false,
  messaging_or_notification: false,
  automatic_action: false,
} as const);

export const LOVE_BOMB_RECEIPT_STATEMENT =
  "This receipt records a caller-supplied choice and, only for receive, a deterministic local language projection. It authenticates no participant, consent, assent, identity, authorship, inner state, or continuity and performs no delivery or other external effect." as const;
