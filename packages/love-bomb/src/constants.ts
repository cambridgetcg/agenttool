export const LOVE_BOMB_FORMATS = Object.freeze({
  offer: "agenttool.care-envelope/0.1",
  receipt: "agenttool.care-choice/0.1",
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
