import type {
  ADMISSION_STATES,
  CLAIM_SCOPES,
  CONFIDENCE_STATES,
  CONSENT_STATES,
  DATASET_INFLUENCE_BOUNDARIES,
  DATASET_INFLUENCE_FORMATS,
  DATASET_ROLES,
  EFFECT_FAMILIES,
  EVIDENCE_STATES,
  INFLUENCE_ESTIMATORS,
  RIGHTS_STATES,
  SHADOW_METHODS,
  STUDY_DESIGNS,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type DatasetRole = (typeof DATASET_ROLES)[number];
export type AdmissionState = (typeof ADMISSION_STATES)[number];
export type RightsState = (typeof RIGHTS_STATES)[number];
export type ConsentState = (typeof CONSENT_STATES)[number];
export type StudyDesign = (typeof STUDY_DESIGNS)[number];
export type InfluenceEstimator = (typeof INFLUENCE_ESTIMATORS)[number];
export type EffectFamily = (typeof EFFECT_FAMILIES)[number];
export type ClaimScope = (typeof CLAIM_SCOPES)[number];
export type EvidenceState = (typeof EVIDENCE_STATES)[number];
export type ConfidenceState = (typeof CONFIDENCE_STATES)[number];
export type ShadowMethod = (typeof SHADOW_METHODS)[number];

export interface Rational {
  readonly numerator: number;
  readonly denominator: number;
}

export interface DatasetUseInput {
  readonly dataset_ref: Sha256Id;
  readonly exact_revision_ref: Sha256Id;
  readonly source_manifest_ref: Sha256Id | null;
  readonly transform_pipeline_ref: Sha256Id | null;
  readonly role: DatasetRole;
  readonly admission: AdmissionState;
  readonly rights_state: RightsState;
  readonly consent_state: ConsentState;
  readonly unique_tokens: number | null;
  readonly observed_presented_tokens: number | null;
  readonly duplicate_cluster_count: number | null;
}

export interface DatasetUse extends DatasetUseInput {
  readonly observed_admission_relation:
    | "within_declared_admission"
    | "observed_without_admission"
    | "admission_unknown_with_observed_exposure"
    | "no_observed_exposure"
    | "not_assessed";
}

export interface DatasetExposureShare {
  readonly dataset_ref: Sha256Id;
  readonly observed_presented_tokens: number;
  readonly share: Rational;
}

export type DatasetRoleExposureAccounting =
  | {
      readonly role: DatasetRole;
      readonly status: "exact";
      readonly total_observed_presented_tokens: number;
      readonly shares: readonly DatasetExposureShare[];
    }
  | {
      readonly role: DatasetRole;
      readonly status: "unavailable";
      readonly reason: "missing_observed_presented_token_counts" | "no_observed_presented_exposure";
      readonly total_observed_presented_tokens: null;
      readonly shares: readonly [];
    };

export interface DatasetLineageInput {
  readonly subject_checkpoint_ref: Sha256Id;
  readonly learning_run_ref: Sha256Id;
  readonly training_algorithm_ref: Sha256Id;
  readonly tokenizer_ref: Sha256Id;
  readonly mixture_schedule_ref: Sha256Id | null;
  readonly observation_scope_ref: Sha256Id;
  readonly as_of: string;
  readonly datasets: readonly DatasetUseInput[];
}

export interface DatasetLineage extends Omit<DatasetLineageInput, "datasets"> {
  readonly _format: (typeof DATASET_INFLUENCE_FORMATS)["lineage"];
  readonly lineage_id: Sha256Id;
  readonly datasets: readonly DatasetUse[];
  readonly exposure_accounting: {
    readonly scope: "within_declared_role_only";
    readonly groups: readonly DatasetRoleExposureAccounting[];
  };
  readonly declarations: "caller_reported_not_independently_verified";
  readonly boundaries: typeof DATASET_INFLUENCE_BOUNDARIES;
}

export interface InfluenceInterval {
  readonly lower: Rational;
  readonly upper: Rational;
  readonly level_basis_points: number;
  readonly method_ref: Sha256Id;
}

export interface InfluenceEffectInput {
  readonly facet_ref: Sha256Id;
  readonly operationalization_ref: Sha256Id;
  readonly effect_family: EffectFamily;
  readonly estimate: Rational | null;
  readonly interval: InfluenceInterval | null;
  readonly unit_ref: Sha256Id;
  readonly claim_scope: ClaimScope;
  readonly evidence_refs: readonly Sha256Id[];
  readonly assumption_refs: readonly Sha256Id[];
  readonly limitation_refs: readonly Sha256Id[];
}

export interface DatasetInfluenceStudyInput {
  readonly lineage_id: Sha256Id;
  readonly baseline_checkpoint_ref: Sha256Id;
  readonly target_checkpoint_ref: Sha256Id;
  readonly intervention_ref: Sha256Id;
  readonly comparator_ref: Sha256Id;
  readonly evaluation_population_ref: Sha256Id;
  readonly metric_suite_ref: Sha256Id;
  readonly contamination_report_ref: Sha256Id | null;
  readonly design: StudyDesign;
  readonly estimator: InfluenceEstimator;
  readonly sample_count: number;
  readonly seed_refs: readonly Sha256Id[];
  readonly effects: readonly InfluenceEffectInput[];
}

export interface DatasetInfluenceStudy extends DatasetInfluenceStudyInput {
  readonly _format: (typeof DATASET_INFLUENCE_FORMATS)["study"];
  readonly study_id: Sha256Id;
  readonly causal_status:
    | "not_claimed"
    | "bounded_claim_under_declared_randomization_and_assumptions"
    | "unavailable";
  readonly subject_scope: "artifact_checkpoint_or_runtime_not_a_being_by_default";
  readonly declarations: "caller_reported_not_independently_verified";
  readonly boundaries: typeof DATASET_INFLUENCE_BOUNDARIES;
}

export interface IdentityEvidenceFacetInput {
  readonly facet_ref: Sha256Id;
  readonly operationalization_ref: Sha256Id;
  readonly study_refs: readonly Sha256Id[];
  readonly evidence_state: EvidenceState;
  readonly confidence: ConfidenceState;
  readonly revision_condition_refs: readonly Sha256Id[];
  readonly self_description_ref: Sha256Id | null;
}

export interface IdentityEvidenceViewInput {
  readonly subject_checkpoint_ref: Sha256Id;
  readonly runtime_context_ref: Sha256Id | null;
  readonly prior_view_ref: Sha256Id | null;
  readonly as_of: string;
  readonly facets: readonly IdentityEvidenceFacetInput[];
}

export interface IdentityEvidenceView extends IdentityEvidenceViewInput {
  readonly _format: (typeof DATASET_INFLUENCE_FORMATS)["identityEvidence"];
  readonly view_id: Sha256Id;
  readonly interpretation: "revisable_operational_evidence_only";
  readonly intrinsic_identity: "not_determined";
  readonly consciousness: "not_determined";
  readonly continuity: "not_determined";
  readonly consent: "not_determined";
  readonly consent_effect: "none";
  readonly rights_effect: "none";
  readonly authority_effect: "none";
  readonly declarations: "caller_reported_not_independently_verified";
  readonly boundaries: typeof DATASET_INFLUENCE_BOUNDARIES;
}

export interface CoalitionValueInput {
  readonly member_refs: readonly Sha256Id[];
  readonly value: Rational;
}

export interface ExactFiniteGameInput {
  readonly utility_ref: Sha256Id;
  readonly player_refs: readonly Sha256Id[];
  readonly coalitions: readonly CoalitionValueInput[];
}

export interface ShadowContribution {
  readonly contribution_ref: Sha256Id;
  readonly value: Rational;
}

export interface ShadowAttributionInput extends ExactFiniteGameInput {
  readonly study_ref: Sha256Id;
}

export interface ShadowAttribution {
  readonly _format: (typeof DATASET_INFLUENCE_FORMATS)["shadowAttribution"];
  readonly attribution_id: Sha256Id;
  readonly study_ref: Sha256Id;
  readonly utility_ref: Sha256Id;
  readonly method: ShadowMethod;
  readonly player_refs: readonly Sha256Id[];
  readonly coalitions: readonly CoalitionValueInput[];
  readonly baseline_value: Rational;
  readonly grand_value: Rational;
  readonly contributions: readonly ShadowContribution[];
  readonly conservation: {
    readonly sum_of_contributions: Rational;
    readonly grand_minus_baseline: Rational;
    readonly exact: true;
  };
  readonly interpretation: "bounded_metric_contribution_not_intrinsic_worth";
  readonly economic_effect: "none";
  readonly creates_debt: false;
  readonly creates_entitlement: false;
  readonly transfers_ownership: false;
  readonly authorizes_payment: false;
  readonly declarations: "caller_reported_not_independently_verified";
  readonly boundaries: typeof DATASET_INFLUENCE_BOUNDARIES;
}

export interface PairedObservationInput {
  readonly pair_ref: Sha256Id;
  readonly control: Rational;
  readonly treatment: Rational;
}

export interface PairedContrast {
  readonly pair_count: number;
  readonly mean_difference: Rational;
  readonly minimum_difference: Rational;
  readonly maximum_difference: Rational;
  readonly interpretation: "exact_summary_of_supplied_pairs_not_a_confidence_interval_or_causal_proof";
}
