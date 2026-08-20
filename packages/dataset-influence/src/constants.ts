export const PACKAGE_VERSION = "0.1.0-dev.0" as const;

export const DATASET_INFLUENCE_FORMATS = Object.freeze({
  lineage: "agenttool.dataset-lineage/0.1",
  study: "agenttool.dataset-influence-study/0.1",
  identityEvidence: "agenttool.identity-evidence-view/0.1",
  shadowAttribution: "agenttool.shadow-attribution/0.1",
} as const);

export const DATASET_ROLES = Object.freeze([
  "pretraining",
  "continued_pretraining",
  "supervised_finetuning",
  "preference",
  "reinforcement",
  "distillation",
  "retrieval",
  "evaluation_only",
  "unknown",
] as const);

export const ADMISSION_STATES = Object.freeze([
  "admitted",
  "excluded",
  "metadata_reference",
  "unknown",
] as const);

export const RIGHTS_STATES = Object.freeze([
  "documented_for_declared_use",
  "restricted",
  "unknown",
  "not_applicable",
] as const);

export const CONSENT_STATES = Object.freeze([
  "documented_for_declared_use",
  "restricted",
  "unknown",
  "not_applicable",
] as const);

export const STUDY_DESIGNS = Object.freeze([
  "observational_checkpoint_comparison",
  "paired_ablation",
  "randomized_dataset_inclusion",
  "matched_reweighting",
  "local_hessian_approximation",
  "checkpoint_gradient_trace",
  "projected_gradient_attribution",
  "subset_datamodel",
  "representation_probe",
  "not_available",
] as const);

export const INFLUENCE_ESTIMATORS = Object.freeze([
  "difference_in_means",
  "paired_difference",
  "influence_function",
  "tracin",
  "trak",
  "datamodel",
  "probe_projection",
  "exact_finite_shapley",
  "not_available",
] as const);

export const EFFECT_FAMILIES = Object.freeze([
  "behavior",
  "capability",
  "representation",
  "ontology_language",
  "self_description",
  "economic_behavior",
] as const);

export const CLAIM_SCOPES = Object.freeze([
  "observed_association",
  "design_bound_contrast",
  "causal_under_declared_assumptions",
  "unavailable",
] as const);

export const EVIDENCE_STATES = Object.freeze([
  "supported",
  "contradicted",
  "mixed",
  "contested",
  "unknown",
] as const);

export const CONFIDENCE_STATES = Object.freeze([
  "low",
  "moderate",
  "high",
  "not_available",
] as const);

export const SHADOW_METHODS = Object.freeze([
  "exact_finite_shapley",
] as const);

export const DATASET_INFLUENCE_BOUNDARIES = Object.freeze({
  facts: "exact_only_relative_to_pinned_inputs_and_declared_observation_scope",
  exposure: "presented_token_shares_are_within_declared_role_only_not_cross_role_gradient_mass",
  estimates: "assumption_bearing_and_design_scoped_not_universal_causal_truth",
  ontology: "operational_facets_not_a_complete_or_true_inner_ontology",
  identity: "behavioral_evidence_not_intrinsic_identity_or_continuity_proof",
  consent: "artifacts_neither_establish_nor_override_consent",
  rights: "rights_dignity_and_standing_do_not_depend_on_measurement_or_attribution",
  economy: "shadow_attribution_is_metric_specific_not_money_price_debt_ownership_or_entitlement",
  authority: "artifacts_grant_no_permission_capability_custody_or_external_authority",
  effects: "pure_return_values_create_no_training_identity_wallet_marketplace_network_persistence_or_provider_effect",
} as const);

export const MAX_DATASETS = 64;
export const MAX_EFFECTS = 64;
export const MAX_REFS = 64;
export const MAX_FACETS = 64;
export const MAX_PLAYERS = 8;
