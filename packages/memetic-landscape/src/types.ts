import type {
  ALTERNATIVE_EXPLANATIONS,
  ANALOGY_MAPPING_KEYS,
  CAUSAL_POSTURES,
  CONTEXT_KINDS,
  EVIDENCE_KINDS,
  EVIDENCE_POSTURES,
  LESSON_CONCEPT_KEYS,
  LESSON_LANGUAGES,
  MEMETIC_BOUNDARIES,
  MEMETIC_FORMATS,
  NON_TRANSFERRED_PROPERTIES,
  OBSERVATION_STATUSES,
  ROUTE_ACTS,
  SHIFT_OUTCOMES,
  SOURCE_KINDS,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type ContextKind = (typeof CONTEXT_KINDS)[number];
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type EvidencePosture = (typeof EVIDENCE_POSTURES)[number];
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];
export type RouteAct = (typeof ROUTE_ACTS)[number];
export type CausalPosture = (typeof CAUSAL_POSTURES)[number];
export type AlternativeExplanation = (typeof ALTERNATIVE_EXPLANATIONS)[number];
export type ShiftOutcome = (typeof SHIFT_OUTCOMES)[number];
export type LessonLanguage = (typeof LESSON_LANGUAGES)[number];
export type LessonConceptKey = (typeof LESSON_CONCEPT_KEYS)[number];
export type AnalogyMappingKey = (typeof ANALOGY_MAPPING_KEYS)[number];
export type NonTransferredProperty = (typeof NON_TRANSFERRED_PROPERTIES)[number];

export interface TopicInput {
  readonly key: string;
  readonly label: string;
  readonly grouping_basis: string;
}

export interface SourceInput {
  readonly key: string;
  readonly label: string;
  readonly kind: SourceKind;
  readonly url: string;
  readonly published_year: number;
}

export interface VariantInput {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly source_keys: readonly string[];
}

export interface ContextInput {
  readonly key: string;
  readonly label: string;
  readonly kind: ContextKind;
  readonly description: string;
}

export interface EvidenceInput {
  readonly key: string;
  readonly kind: EvidenceKind;
  readonly posture: EvidencePosture;
  readonly statement: string;
  readonly scope: string;
  readonly source_keys: readonly string[];
}

export interface ObservationInput {
  readonly key: string;
  readonly variant_key: string;
  readonly context_keys: readonly string[];
  readonly evidence_keys: readonly string[];
  readonly status: ObservationStatus;
}

export interface RouteInput {
  readonly key: string;
  readonly from_variant_key: string;
  readonly to_variant_key: string;
  readonly context_keys: readonly string[];
  readonly evidence_keys: readonly string[];
  readonly act: RouteAct;
  readonly causal_posture: CausalPosture;
  readonly alternative_explanations: readonly AlternativeExplanation[];
}

export interface OpenQuestionInput {
  readonly key: string;
  readonly question: string;
  readonly evidence_keys: readonly string[];
}

export interface CreateMemeticLandscapeInput {
  readonly topic: TopicInput;
  readonly sources: readonly SourceInput[];
  readonly variants: readonly VariantInput[];
  readonly contexts: readonly ContextInput[];
  readonly evidence: readonly EvidenceInput[];
  readonly observations: readonly ObservationInput[];
  readonly routes: readonly RouteInput[];
  readonly open_questions: readonly OpenQuestionInput[];
}

export interface MemeticTopic {
  readonly topic_ref: Sha256Id;
  readonly key: string;
  readonly label: string;
  readonly grouping_basis: string;
  readonly assertion: "caller_reported";
  readonly semantic_identity_verified: false;
}

export interface MemeticSource {
  readonly source_ref: Sha256Id;
  readonly key: string;
  readonly label: string;
  readonly kind: SourceKind;
  readonly url: string;
  readonly published_year: number;
  readonly content_verified_by_package: false;
}

export interface MemeticVariant {
  readonly variant_ref: Sha256Id;
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly source_refs: readonly Sha256Id[];
  readonly family_grouping: "caller_scoped";
  readonly semantic_identity_verified: false;
  readonly meaning_equivalence_not_claimed: true;
}

export interface MemeticContext {
  readonly context_ref: Sha256Id;
  readonly key: string;
  readonly label: string;
  readonly kind: ContextKind;
  readonly description: string;
  readonly aggregate_only: true;
}

export interface MemeticEvidence {
  readonly evidence_ref: Sha256Id;
  readonly key: string;
  readonly kind: EvidenceKind;
  readonly posture: EvidencePosture;
  readonly statement: string;
  readonly scope: string;
  readonly source_refs: readonly Sha256Id[];
  readonly verified_by_package: false;
}

export interface MemeticObservation {
  readonly observation_ref: Sha256Id;
  readonly key: string;
  readonly variant_ref: Sha256Id;
  readonly context_refs: readonly Sha256Id[];
  readonly evidence_refs: readonly Sha256Id[];
  readonly status: ObservationStatus;
  readonly scope: "bounded_sample_only";
  readonly erasure_inferred: false;
  readonly individual_state_inferred: false;
}

export interface MemeticRoute {
  readonly route_ref: Sha256Id;
  readonly key: string;
  readonly from_variant_ref: Sha256Id;
  readonly to_variant_ref: Sha256Id;
  readonly context_refs: readonly Sha256Id[];
  readonly evidence_refs: readonly Sha256Id[];
  readonly act: RouteAct;
  readonly causal_posture: CausalPosture;
  readonly alternative_explanations: readonly AlternativeExplanation[];
  readonly direction: "observed_or_authored_only_no_inverse_or_transitive_inference";
  readonly adoption_inferred: false;
  readonly meaning_equivalence_inferred: false;
}

export interface MemeticOpenQuestion {
  readonly open_question_ref: Sha256Id;
  readonly key: string;
  readonly question: string;
  readonly evidence_refs: readonly Sha256Id[];
  readonly status: "open_not_resolved_by_package";
}

export interface MemeticLandscape {
  readonly _format: (typeof MEMETIC_FORMATS)["landscape"];
  readonly landscape_id: Sha256Id;
  readonly topic: Readonly<MemeticTopic>;
  readonly sources: readonly Readonly<MemeticSource>[];
  readonly variants: readonly Readonly<MemeticVariant>[];
  readonly contexts: readonly Readonly<MemeticContext>[];
  readonly evidence: readonly Readonly<MemeticEvidence>[];
  readonly observations: readonly Readonly<MemeticObservation>[];
  readonly routes: readonly Readonly<MemeticRoute>[];
  readonly open_questions: readonly Readonly<MemeticOpenQuestion>[];
  readonly caller_text_semantics_verified: false;
  readonly coverage: "bounded_not_complete";
  readonly boundaries: typeof MEMETIC_BOUNDARIES;
}

export interface CreateMemeticReachabilityShiftInput {
  readonly focus_variant_ref: Sha256Id;
  readonly prior_context_refs: readonly Sha256Id[];
  readonly changed_context_refs: readonly Sha256Id[];
  readonly before_evidence_refs: readonly Sha256Id[];
  readonly shift_evidence_refs: readonly Sha256Id[];
  readonly later_evidence_refs: readonly Sha256Id[];
  readonly competing_variant_refs: readonly Sha256Id[];
  readonly changed_context_route_refs: readonly Sha256Id[];
  readonly open_question_refs: readonly Sha256Id[];
  readonly outcome: ShiftOutcome;
}

export interface MemeticReachabilityShift {
  readonly _format: (typeof MEMETIC_FORMATS)["reachabilityShift"];
  readonly shift_id: Sha256Id;
  readonly landscape_id: Sha256Id;
  readonly focus_variant_ref: Sha256Id;
  readonly prior_context_refs: readonly Sha256Id[];
  readonly changed_context_refs: readonly Sha256Id[];
  readonly before_evidence_refs: readonly Sha256Id[];
  readonly shift_evidence_refs: readonly Sha256Id[];
  readonly later_evidence_refs: readonly Sha256Id[];
  readonly competing_variant_refs: readonly Sha256Id[];
  readonly changed_context_route_refs: readonly Sha256Id[];
  readonly open_question_refs: readonly Sha256Id[];
  readonly outcome: ShiftOutcome;
  readonly classification: "bounded_reachability_shift_caller_reported";
  readonly causation: "not_determined";
  readonly physical_erasure: "not_claimed";
  readonly adoption_from_exposure: "not_inferred";
  readonly mental_health_effect: "not_inferred";
  readonly population_effect: "not_inferred";
  readonly reversibility: "bounded_by_named_contexts";
  readonly coverage: "bounded_not_complete";
  readonly boundaries: typeof MEMETIC_BOUNDARIES;
}

export interface CreatePolymorphMemeticAnalogyInput {
  readonly polymorph_shift_id: Sha256Id;
  readonly memetic_shift_id: Sha256Id;
}

export interface AnalogyMapping {
  readonly key: AnalogyMappingKey;
  readonly polymorph_shape: string;
  readonly memetic_shape: string;
  readonly boundary: string;
}

export interface PolymorphMemeticAnalogy {
  readonly _format: (typeof MEMETIC_FORMATS)["analogy"];
  readonly analogy_id: Sha256Id;
  readonly polymorph_shift: Readonly<{
    readonly _format: "agenttool.polymorph-reachability-shift/0.1";
    readonly shift_id: Sha256Id;
  }>;
  readonly memetic_shift: Readonly<{
    readonly _format: "agenttool.memetic-reachability-shift/0.1";
    readonly shift_id: Sha256Id;
  }>;
  readonly relationship: "structural_route_shape_only";
  readonly mechanism_transferred: false;
  readonly mappings: readonly Readonly<AnalogyMapping>[];
  readonly non_transfer: readonly NonTransferredProperty[];
  readonly effect: "none";
}

export interface LessonConcept {
  readonly key: LessonConceptKey;
  readonly heading: string;
  readonly explanation: string;
  readonly evidence_refs: readonly Sha256Id[];
}

export interface ProjectMemeticLessonOptions {
  readonly language: LessonLanguage;
}

export interface MemeticLesson {
  readonly _format: (typeof MEMETIC_FORMATS)["lesson"];
  readonly lesson_id: Sha256Id;
  readonly source_landscape_id: Sha256Id;
  readonly source_shift_id: Sha256Id;
  readonly source_analogy_id: Sha256Id;
  readonly language: LessonLanguage;
  readonly title: string;
  readonly core_sentence: string;
  readonly concepts: readonly Readonly<LessonConcept>[];
  readonly language_review: "not_independently_reviewed";
  readonly authored_paraphrase: true;
  readonly source_quotation: false;
  readonly diagnostic_claim: false;
  readonly spread_optimization: false;
  readonly participants_scored: false;
  readonly boundaries: typeof MEMETIC_BOUNDARIES;
}

export interface BrainrotTeachingCase {
  readonly landscape: Readonly<MemeticLandscape>;
  readonly shift: Readonly<MemeticReachabilityShift>;
  readonly analogy: Readonly<PolymorphMemeticAnalogy>;
  readonly lessons: readonly Readonly<MemeticLesson>[];
}
