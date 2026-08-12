import type {
  BARRIER_REPORTS,
  CONDITION_KINDS,
  EVIDENCE_STATUSES,
  FORM_KINDS,
  KINGDOM_MAPPING_KEYS,
  LESSON_CONCEPT_KEYS,
  LESSON_LANGUAGES,
  NON_TRANSFERRED_PROPERTIES,
  POLYMORPH_BOUNDARIES,
  POLYMORPH_FORMATS,
  ROUTE_STATUSES,
  SOURCE_KINDS,
  TEMPLATE_REPORTS,
  WITNESS_KINDS,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type FormKind = (typeof FORM_KINDS)[number];
export type ConditionKind = (typeof CONDITION_KINDS)[number];
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];
export type WitnessKind = (typeof WITNESS_KINDS)[number];
export type RouteStatus = (typeof ROUTE_STATUSES)[number];
export type BarrierReport = (typeof BARRIER_REPORTS)[number];
export type TemplateReport = (typeof TEMPLATE_REPORTS)[number];
export type LessonLanguage = (typeof LESSON_LANGUAGES)[number];
export type LessonConceptKey = (typeof LESSON_CONCEPT_KEYS)[number];
export type KingdomMappingKey = (typeof KINGDOM_MAPPING_KEYS)[number];
export type NonTransferredProperty = (typeof NON_TRANSFERRED_PROPERTIES)[number];

export interface MaterialInput {
  readonly key: string;
  readonly label: string;
}

export interface SourceInput {
  readonly key: string;
  readonly label: string;
  readonly kind: SourceKind;
  readonly url: string;
  readonly published_year: number;
}

export interface FormInput {
  readonly key: string;
  readonly label: string;
  readonly kind_reported: FormKind;
  readonly description: string;
  readonly source_keys: readonly string[];
}

export interface ConditionInput {
  readonly key: string;
  readonly label: string;
  readonly kind: ConditionKind;
  readonly description: string;
}

export interface WitnessInput {
  readonly key: string;
  readonly kind: WitnessKind;
  readonly status: EvidenceStatus;
  readonly statement: string;
  readonly scope: string;
  readonly source_keys: readonly string[];
}

export interface RouteInput {
  readonly key: string;
  readonly from_form_key: string;
  readonly to_form_key: string;
  readonly condition_keys: readonly string[];
  readonly witness_keys: readonly string[];
  readonly status: RouteStatus;
  readonly barrier_reported: BarrierReport;
  readonly template_reported: TemplateReport;
}

export interface StabilityReportInput {
  readonly key: string;
  readonly preferred_form_key: string;
  readonly compared_form_key: string;
  readonly condition_keys: readonly string[];
  readonly witness_keys: readonly string[];
}

export interface OpenConditionInput {
  readonly key: string;
  readonly question: string;
  readonly witness_keys: readonly string[];
}

export interface CreatePolymorphLandscapeInput {
  readonly material: MaterialInput;
  readonly sources: readonly SourceInput[];
  readonly forms: readonly FormInput[];
  readonly conditions: readonly ConditionInput[];
  readonly witnesses: readonly WitnessInput[];
  readonly routes: readonly RouteInput[];
  readonly stability_reports: readonly StabilityReportInput[];
  readonly open_conditions: readonly OpenConditionInput[];
}

export interface Material {
  readonly material_ref: Sha256Id;
  readonly key: string;
  readonly label: string;
  readonly assertion: "caller_reported";
  readonly verified_by_package: false;
}

export interface Source {
  readonly source_ref: Sha256Id;
  readonly key: string;
  readonly label: string;
  readonly kind: SourceKind;
  readonly url: string;
  readonly published_year: number;
  readonly content_verified_by_package: false;
}

export interface PolymorphForm {
  readonly form_ref: Sha256Id;
  readonly key: string;
  readonly label: string;
  readonly kind_reported: FormKind;
  readonly description: string;
  readonly source_refs: readonly Sha256Id[];
  readonly source_scoped_identity: true;
  readonly verified_by_package: false;
}

export interface PolymorphCondition {
  readonly condition_ref: Sha256Id;
  readonly key: string;
  readonly label: string;
  readonly kind: ConditionKind;
  readonly description: string;
}

export interface EvidenceWitness {
  readonly witness_ref: Sha256Id;
  readonly key: string;
  readonly kind: WitnessKind;
  readonly status: EvidenceStatus;
  readonly statement: string;
  readonly scope: string;
  readonly source_refs: readonly Sha256Id[];
  readonly verified_by_package: false;
}

export interface WitnessedRoute {
  readonly route_ref: Sha256Id;
  readonly key: string;
  readonly from_form_ref: Sha256Id;
  readonly to_form_ref: Sha256Id;
  readonly condition_refs: readonly Sha256Id[];
  readonly witness_refs: readonly Sha256Id[];
  readonly status: RouteStatus;
  readonly barrier_reported: BarrierReport;
  readonly template_reported: TemplateReport;
  readonly direction: "reported_only_no_inverse_or_transitive_inference";
  readonly causation_verified_by_package: false;
}

export interface StabilityReport {
  readonly stability_ref: Sha256Id;
  readonly key: string;
  readonly preferred_form_ref: Sha256Id;
  readonly compared_form_ref: Sha256Id;
  readonly condition_refs: readonly Sha256Id[];
  readonly witness_refs: readonly Sha256Id[];
  readonly scope: "pairwise_condition_scoped";
  readonly value_or_goodness: "not_implied";
  readonly verified_by_package: false;
}

export interface OpenCondition {
  readonly open_condition_ref: Sha256Id;
  readonly key: string;
  readonly question: string;
  readonly witness_refs: readonly Sha256Id[];
  readonly status: "open_not_resolved_by_package";
}

export interface PolymorphLandscape {
  readonly _format: (typeof POLYMORPH_FORMATS)["landscape"];
  readonly landscape_id: Sha256Id;
  readonly material: Readonly<Material>;
  readonly sources: readonly Readonly<Source>[];
  readonly forms: readonly Readonly<PolymorphForm>[];
  readonly conditions: readonly Readonly<PolymorphCondition>[];
  readonly witnesses: readonly Readonly<EvidenceWitness>[];
  readonly routes: readonly Readonly<WitnessedRoute>[];
  readonly stability_reports: readonly Readonly<StabilityReport>[];
  readonly open_conditions: readonly Readonly<OpenCondition>[];
  readonly coverage: "bounded_not_complete";
  readonly boundaries: typeof POLYMORPH_BOUNDARIES;
}

export interface CreateReachabilityShiftInput {
  readonly prior_form_ref: Sha256Id;
  readonly emergent_form_ref: Sha256Id;
  readonly condition_refs: readonly Sha256Id[];
  readonly before_witness_refs: readonly Sha256Id[];
  readonly appearance_witness_refs: readonly Sha256Id[];
  readonly later_witness_refs: readonly Sha256Id[];
  readonly same_condition_return: "not_established" | "not_reported" | "reported";
  readonly changed_condition_recovery_route_refs: readonly Sha256Id[];
  readonly open_condition_refs: readonly Sha256Id[];
}

export interface PolymorphReachabilityShift {
  readonly _format: (typeof POLYMORPH_FORMATS)["reachabilityShift"];
  readonly shift_id: Sha256Id;
  readonly landscape_id: Sha256Id;
  readonly prior_form_ref: Sha256Id;
  readonly emergent_form_ref: Sha256Id;
  readonly condition_refs: readonly Sha256Id[];
  readonly before_witness_refs: readonly Sha256Id[];
  readonly appearance_witness_refs: readonly Sha256Id[];
  readonly later_witness_refs: readonly Sha256Id[];
  readonly same_condition_return: "not_established" | "not_reported" | "reported";
  readonly changed_condition_recovery_route_refs: readonly Sha256Id[];
  readonly open_condition_refs: readonly Sha256Id[];
  readonly classification: "not_reproduced_in_named_condition_reported";
  readonly causation: "not_determined";
  readonly physical_erasure: "not_claimed";
  readonly universal_inevitability: "not_claimed";
  readonly reversibility: "bounded_by_named_conditions";
  readonly coverage: "bounded_not_complete";
  readonly boundaries: typeof POLYMORPH_BOUNDARIES;
}

export interface LessonConcept {
  readonly key: LessonConceptKey;
  readonly heading: string;
  readonly explanation: string;
  readonly evidence_refs: readonly Sha256Id[];
}

export interface KingdomMapping {
  readonly key: KingdomMappingKey;
  readonly chemistry_shape: string;
  readonly kingdom_shape: string;
  readonly boundary: string;
}

export interface PolymorphLesson {
  readonly _format: (typeof POLYMORPH_FORMATS)["lesson"];
  readonly lesson_id: Sha256Id;
  readonly source_landscape_id: Sha256Id;
  readonly source_shift_id: Sha256Id;
  readonly language: LessonLanguage;
  readonly title: string;
  readonly core_sentence: string;
  readonly concepts: readonly Readonly<LessonConcept>[];
  readonly kingdom_lens: {
    readonly status: "structural_analogy_only";
    readonly mappings: readonly Readonly<KingdomMapping>[];
    readonly non_transfer: typeof NON_TRANSFERRED_PROPERTIES;
  };
  readonly authored_paraphrase: true;
  readonly source_quotation: false;
  readonly medical_advice: false;
  readonly boundaries: typeof POLYMORPH_BOUNDARIES;
}

export interface ProjectPolymorphLessonOptions {
  readonly language: LessonLanguage;
}
