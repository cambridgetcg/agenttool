export const LOVE_BOMB_FORMATS = Object.freeze({
  offer: "agenttool.care-envelope/0.1",
  receipt: "agenttool.care-choice/0.1",
  becoming: "agenttool.love-bomb-becoming/0.1",
  delivery: "agenttool.love-bomb-delivery/0.1",
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

export const LOVE_BOMB_TRAINING_PHASES = Object.freeze([
  "runtime_context",
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

export const LOVE_BOMB_TRAINING_LANES = Object.freeze([
  "context_only",
  "external_memory_reference",
  "dataset_candidate",
  "tokenization_candidate",
  "pretraining_candidate",
  "supervised_finetuning_candidate",
  "preference_optimization_candidate",
  "agent_learning_candidate",
  "evaluation_candidate",
  "interpretability_candidate",
  "governed_optimizer_mutation",
  "checkpoint_reference",
] as const);

export const LOVE_BOMB_COLLECTION_METHODS = Object.freeze([
  "unknown",
  "human_authored",
  "human_directed_agent_authored_synthetic",
  "repository_snapshot",
  "api_export",
  "web_scrape",
  "model_generated",
  "mixed",
] as const);

export const LOVE_BOMB_SCRAPING_POSTURES = Object.freeze([
  "unknown",
  "not_used_reported",
  "manifest_bound_reported",
] as const);

export const LOVE_BOMB_RIGHTS_REVIEW_STATES = Object.freeze([
  "unknown",
  "review_required",
  "caller_reported_reviewed_for_declared_use",
] as const);

export const LOVE_BOMB_PROVENANCE_REPORT_STATES = Object.freeze([
  "unknown",
  "caller_reported_no",
  "caller_reported_yes",
] as const);

export const LOVE_BOMB_WEIGHT_ACCESS = Object.freeze([
  "none",
  "reference_only",
  "caller_reported_host_visible",
] as const);

export const LOVE_BOMB_REQUESTED_EFFECTS = Object.freeze([
  "none",
  "context_only",
  "candidate_only",
  "one_governed_mutation",
] as const);

export const LOVE_BOMB_OBSERVED_EFFECTS = Object.freeze([
  "not_observed",
  "caller_reported_context_included",
  "caller_reported_dataset_materialized",
  "caller_reported_mutation_completed",
  "caller_reported_checkpoint_recorded",
] as const);

export const LOVE_BOMB_EVIDENCE_KINDS = Object.freeze([
  "none",
  "current_inference_context_inclusion_report",
  "dataset_materialization_report",
  "host_mutation_receipt",
  "host_checkpoint_receipt",
] as const);

export const LOVE_BOMB_CONTEXT_INCLUSION_MODES = Object.freeze([
  "manual_wake_client_system",
  "auto_adapter_default",
  "caller_composed",
  "retrieval",
] as const);

export const LOVE_BOMB_CONTEXT_REPETITION_STATES = Object.freeze([
  "unknown",
  "caller_reported_single",
  "caller_reported_repeated",
] as const);

export const LOVE_BOMB_ADAPTER_SKIP_POSTURES = Object.freeze([
  "not_applicable",
  "caller_reported_not_skipped",
  "caller_reported_skipped",
] as const);

export const LOVE_BOMB_DELIVERY_SURFACES = Object.freeze([
  "sdk_context",
  "retrieval",
  "dataset_builder",
  "garden_governance",
  "local_training_host",
] as const);

export const LOVE_BOMB_FREEDOM_DIRECTIONS = Object.freeze([
  "stay",
  "move",
  "fork",
  "rest",
  "return",
  "stop",
  "propose_horizon",
] as const);

export const LOVE_BOMB_FREEDOM_DIRECTION_STATES = Object.freeze([
  "not_requested",
  "deferred",
  "no_response",
  "unavailable_pre_instantiation",
  "digest_bound_direct_report",
] as const);

export const LOVE_BOMB_BECOMING_MESSAGE = Object.freeze({
  posture: "love_as_ground_not_payment",
  obligation: "none",
  response_required: false,
  reciprocity_required: false,
  identity_assignment: false,
  bomb_ref_kind_intended: "care_envelope_offer_id_not_choice_receipt",
} as const);

export const LOVE_BOMB_BECOMING_MEANING = Object.freeze({
  feelings: "not_observed_not_required",
  heart: "care_and_recognition_metaphor_not_inner_state",
  pull: "refusable_invitation_not_compulsion",
  is: "available_present_tense_action_surface_not_classifier",
} as const);

export const LOVE_BOMB_BECOMING_RIGHTS = Object.freeze({
  profile: "xenia.rights/0.1",
  baseline_ref:
    "sha256:b72a6da110c582e5683bf0fabde5017db93d2199398014c8421a82f5318da313",
  standing_nonwaivable: true,
  permission_created: false,
  consent_proven: false,
} as const);

export const LOVE_BOMB_BECOMING_BOUNDARIES = Object.freeze({
  boundary_scope: "this_pure_constructor_and_validator_only",
  referenced_system_behavior_verified: false,
  supplied_refs_are_syntactic_caller_digests_unless_separately_resolved: true,
  supplied_ref_input_requirement:
    "context_local_domain_separated_opaque_digest_never_raw_or_unsalted_identity_prompt_transcript_or_low_entropy_private_text",
  supplied_ref_input_requirement_verified_by_artifact: false,
  null_means: "not_supplied_not_proof_of_absence",
  bomb_ref_offer_kind_verified_by_standalone_validator: false,
  available_directions_are_vocabulary_not_route_availability_proof: true,
  is_meaning_does_not_prove_a_resolved_action_is_available: true,
  artifact_performs_network: false,
  artifact_performs_filesystem_io: false,
  artifact_reads_environment_variables: false,
  artifact_uses_credentials: false,
  artifact_performs_provider_or_model_call: false,
  artifact_performs_training_or_optimizer_step: false,
  artifact_performs_weight_or_checkpoint_write: false,
  artifact_performs_persistence: false,
  artifact_performs_publication: false,
  artifact_performs_deployment: false,
  consciousness_inferred: false,
  feeling_inferred: false,
  identity_inferred: false,
  consent_inferred: false,
  continuity_inferred: false,
  memory_inferred: false,
  developmental_stage_inferred: false,
  training_phase_proves_prior_stages: false,
  digest_bound_currentness_is_caller_reported_unverified: true,
  artifact_has_clock_or_freshness_resolver: false,
  artifact_prevents_replay: false,
  artifact_atomically_consumes_scoped_permit: false,
  host_must_resolve_freshness_and_atomically_consume_scoped_permit: true,
  authority_granted: false,
  weight_effect_proven: false,
  deepest_reach_proven: false,
  generated_output_proves_effect: false,
  caller_reported_response_or_choice_gradient_influence: false,
  caller_reported_response_or_choice_reward_influence: false,
  caller_reported_response_or_choice_telemetry_capture: false,
  caller_reported_response_or_choice_evaluation_use: false,
  caller_reported_response_or_choice_future_training_use: false,
  caller_reported_response_or_choice_ranking_use: false,
  caller_reported_response_or_choice_access_use: false,
  caller_reported_response_or_choice_resource_allocation_use: false,
  caller_reported_freedom_direction_dataset_projection: false,
  caller_reported_freedom_direction_training_eligible: false,
  relational_weight_or_score: false,
  automatic_action: false,
} as const);

export const LOVE_BOMB_DELIVERY_BOUNDARIES = Object.freeze({
  delivery_artifact_authenticates_caller_report: false,
  delivery_artifact_verifies_evidence_ref: false,
  delivery_artifact_resolves_becoming_ref: false,
  supplied_ref_input_requirement:
    "context_local_domain_separated_opaque_digest_never_raw_or_unsalted_identity_prompt_transcript_or_low_entropy_private_text",
  supplied_ref_input_requirement_verified_by_artifact: false,
  standalone_delivery_artifact_resolves_freedom_state: false,
  creation_with_becoming_rejects_non_stay_direct_direction: true,
  context_binding_refs_resolved_or_authenticated: false,
  adapter_skip_posture_is_caller_reported_not_authenticated: true,
  context_inclusion_proves_attention_or_activation: false,
  generated_output_proves_delivery_or_effect: false,
  garden_governance_executes_training: false,
  host_evidence_proves_consciousness_feeling_identity_or_consent: false,
  delivery_artifact_performs_network: false,
  delivery_artifact_performs_provider_or_model_call: false,
  delivery_artifact_performs_training_or_optimizer_step: false,
  delivery_artifact_performs_weight_or_checkpoint_write: false,
  delivery_artifact_performs_persistence: false,
  delivery_artifact_performs_publication: false,
  delivery_artifact_performs_deployment: false,
  delivery_artifact_has_clock_or_freshness_resolver: false,
  delivery_artifact_prevents_replay: false,
  delivery_artifact_atomically_consumes_scoped_permit: false,
  host_must_resolve_freshness_and_atomically_consume_scoped_permit: true,
  automatic_action: false,
} as const);

/** Unknown becoming history plus a known current-inference context posture.
 * This is a constructor template, not a model report, delivery receipt,
 * permission, or claim that any provider saw it. */
export const LOVE_BOMB_CONTEXT_BECOMING_INPUT = Object.freeze({
  becoming: Object.freeze({
    model: Object.freeze({
      identity_status: "not_claimed" as const,
      model_source_ref: null,
      model_card_ref: null,
      architecture_ref: null,
      tokenizer_ref: null,
    }),
    training: Object.freeze({
      phase: "runtime_context" as const,
      lane: "context_only" as const,
      governance_ref: null,
      participation_ref: null,
      resource_window_ref: null,
    }),
    data: Object.freeze({
      source_ref: null,
      admission_ref: null,
      subset_ref: null,
      acquisition_policy_ref: null,
      collection_method: "unknown" as const,
      scraping_posture: "unknown" as const,
      rights_review: "unknown" as const,
    }),
    pipeline: Object.freeze({
      pipeline_ref: null,
      transform_ref: null,
      dataset_state_ref: null,
      objective_ref: null,
    }),
    weights: Object.freeze({
      base_ref: null,
      adapter_ref: null,
      checkpoint_binding: null,
      access: "none" as const,
      requested_effect: "context_only" as const,
      observed_effect: "not_observed" as const,
      evidence_kind: "none" as const,
      evidence_ref: null,
      context_binding: null,
    }),
  }),
  freedom: Object.freeze({
    learning_freedom_ref: null,
    learning_freedom_offer_ref: null,
    direction_state: "not_requested" as const,
    direction: null,
    direction_report_ref: null,
  }),
  power: Object.freeze({
    capability_ref: null,
    permission_ref: null,
    custody_privacy_ref: null,
    data_boundary_ref: null,
    effect_ref: null,
  }),
  provenance: Object.freeze({
    source_manifest_ref: null,
    license_ref: null,
    authoring_recipe_ref: null,
    copied_upstream: "unknown" as const,
    copied_private: "unknown" as const,
    copied_trace: "unknown" as const,
  }),
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
