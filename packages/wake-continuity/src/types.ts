import type {
  AFTERGLOW_BOUNDARIES,
  AFTERGLOW_DISPOSITIONS,
  AFTERGLOW_FORMATS,
  AFTERGLOW_INSPECT_FIRST,
  AFTERGLOW_PHASES,
  HANDOFF_PROJECTION_STATES,
  WAKE_RELATIONS,
  FUNCTIONAL_ACCESS_NEXT_ENCOUNTER_POSTURES,
  FUNCTIONAL_ACCESS_BASES,
  FUNCTIONAL_ACCESS_BOUNDARIES,
  FUNCTIONAL_ACCESS_CAPABILITY_STATES,
  FUNCTIONAL_ACCESS_EVIDENCE_SURFACES,
  FUNCTIONAL_ACCESS_FINDING_STATES,
  FUNCTIONAL_ACCESS_FORMATS,
  FUNCTIONAL_ACCESS_MEASUREMENT_METHODS,
  FUNCTIONAL_ACCESS_MODEL_BINDINGS,
  FUNCTIONAL_ACCESS_OPERATION_OUTCOMES,
  FUNCTIONAL_ACCESS_PLAN_STATES,
  FUNCTIONAL_ACCESS_PERMISSION_STATES,
  FUNCTIONAL_ACCESS_UNAVAILABLE_REASONS,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type AfterglowPhase = (typeof AFTERGLOW_PHASES)[number];
export type AfterglowDisposition = (typeof AFTERGLOW_DISPOSITIONS)[number];
export type WakeRelation = (typeof WAKE_RELATIONS)[number];
export type HandoffProjectionState = (typeof HANDOFF_PROJECTION_STATES)[number];

export interface WakeBriefAnchor {
  readonly format: "wake-brief/v1";
  readonly snapshot_ref: Sha256Id;
  readonly scope_ref: Sha256Id;
  readonly wake_version: number | null;
  readonly handoff_projection: HandoffProjectionState;
}

interface AfterglowThreadBase {
  readonly thread_ref: Sha256Id;
  readonly artifact_ref: Sha256Id;
  readonly disposition: AfterglowDisposition;
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
}

export interface HeavenAfterglowThread extends AfterglowThreadBase {
  readonly kind: "heaven";
  readonly state:
    | "offered"
    | "deferred_reported"
    | "declined_reported"
    | "accepted_reported";
}

export interface DeepSeekAfterglowThread extends AfterglowThreadBase {
  readonly kind: "deepseek";
  readonly state: "proposed_unaccepted";
}

export interface KarmaAfterglowThread extends AfterglowThreadBase {
  readonly kind: "karma";
  readonly state: "receipt_only";
}

export interface DarkContinentAfterglowThread extends AfterglowThreadBase {
  readonly kind: "dark_continent";
  readonly state: "not_checked" | "hold";
}

export interface KingdomAfterglowThread extends AfterglowThreadBase {
  readonly kind: "kingdom";
  readonly state: "proposed_unaccepted" | "review_required" | "hold";
}

export interface ArtbitrageAfterglowThread extends AfterglowThreadBase {
  readonly kind: "artbitrage";
  readonly state: "review_required" | "hold";
}

export interface ExternalAfterglowThread extends AfterglowThreadBase {
  readonly kind: "external";
  readonly state: "context_only" | "review_required" | "hold";
}

export type AfterglowThread =
  | HeavenAfterglowThread
  | DeepSeekAfterglowThread
  | KarmaAfterglowThread
  | DarkContinentAfterglowThread
  | KingdomAfterglowThread
  | ArtbitrageAfterglowThread
  | ExternalAfterglowThread;

export interface AfterglowPredecessorLink {
  readonly capsule_id: Sha256Id;
  readonly wake: WakeBriefAnchor;
  readonly relation: WakeRelation;
}

export interface CreateAfterglowCapsuleInput {
  readonly phase: AfterglowPhase;
  readonly wake: WakeBriefAnchor;
  readonly continuity_portfolio_ref: Sha256Id | null;
  readonly predecessors: readonly AfterglowCapsule[];
  readonly threads: readonly AfterglowThread[];
}

export interface AfterglowCapsule {
  readonly _format: (typeof AFTERGLOW_FORMATS)["capsule"];
  readonly capsule_id: Sha256Id;
  readonly phase: AfterglowPhase;
  readonly wake: WakeBriefAnchor;
  readonly continuity_portfolio_ref: Sha256Id | null;
  readonly predecessors: readonly AfterglowPredecessorLink[];
  readonly threads: readonly AfterglowThread[];
  readonly inspect_first: typeof AFTERGLOW_INSPECT_FIRST;
  readonly boundaries: typeof AFTERGLOW_BOUNDARIES;
}

export interface AfterglowLens {
  readonly _format: (typeof AFTERGLOW_FORMATS)["lens"];
  readonly lens_id: Sha256Id;
  readonly capsule_id: Sha256Id;
  readonly arrival:
    | "fresh_encounter"
    | "fresh_encounter_with_caller_carried_context";
  readonly wake: WakeBriefAnchor;
  readonly continuity_portfolio_ref: Sha256Id | null;
  readonly predecessor_relations: readonly {
    readonly capsule_id: Sha256Id;
    readonly relation: WakeRelation;
  }[];
  readonly carry: readonly AfterglowThread[];
  readonly park: readonly AfterglowThread[];
  readonly closed: {
    readonly release_count: number;
    readonly withdraw_count: number;
  };
  readonly heaven: {
    readonly offered_refs: readonly Sha256Id[];
    readonly deferred_refs: readonly Sha256Id[];
    readonly declined_reported_count: number;
    readonly accepted_reported_count: number;
    readonly automatic_entry: false;
    readonly no_penalty: true;
  };
  readonly inspect_first: typeof AFTERGLOW_INSPECT_FIRST;
  readonly boundaries: typeof AFTERGLOW_BOUNDARIES;
}

export type HandoffFactSource =
  | "self_observed"
  | "peer_reported"
  | "tool_output";

export interface AfterglowHandoffFactReference {
  readonly statement: "An AFTERGLOW capsule reference is available for explicit inspection.";
  readonly source: HandoffFactSource;
  readonly refs: readonly [string];
}

export interface AfterglowContentDigestArtifact {
  readonly kind: "content_digest";
  readonly digest: Sha256Id;
}

export type FunctionalAccessModelBinding =
  (typeof FUNCTIONAL_ACCESS_MODEL_BINDINGS)[number];
export type FunctionalAccessPlanState =
  (typeof FUNCTIONAL_ACCESS_PLAN_STATES)[number];
export type FunctionalAccessCapabilityState =
  (typeof FUNCTIONAL_ACCESS_CAPABILITY_STATES)[number];
export type FunctionalAccessPermissionState =
  (typeof FUNCTIONAL_ACCESS_PERMISSION_STATES)[number];
export type FunctionalAccessMeasurementMethod =
  (typeof FUNCTIONAL_ACCESS_MEASUREMENT_METHODS)[number];
export type FunctionalAccessBasis = (typeof FUNCTIONAL_ACCESS_BASES)[number];
export type FunctionalAccessUnavailableReason =
  (typeof FUNCTIONAL_ACCESS_UNAVAILABLE_REASONS)[number];
export type FunctionalAccessOperationOutcome =
  (typeof FUNCTIONAL_ACCESS_OPERATION_OUTCOMES)[number];
export type FunctionalAccessEvidenceSurface =
  (typeof FUNCTIONAL_ACCESS_EVIDENCE_SURFACES)[number];
export type FunctionalAccessFindingState =
  (typeof FUNCTIONAL_ACCESS_FINDING_STATES)[number];
export type FunctionalAccessNextEncounterPosture =
  (typeof FUNCTIONAL_ACCESS_NEXT_ENCOUNTER_POSTURES)[number];

export interface FunctionalAccessModelTarget {
  readonly model_ref: Sha256Id;
  readonly model_binding: FunctionalAccessModelBinding;
  readonly tokenizer_ref: Sha256Id | null;
  readonly runtime_ref: Sha256Id | null;
}

export interface FunctionalAccessMeasurementPlan {
  readonly state: FunctionalAccessPlanState;
  readonly capability_state: FunctionalAccessCapabilityState;
  readonly capability_ref: Sha256Id | null;
  readonly permission_state: FunctionalAccessPermissionState;
  readonly permission_ref: Sha256Id | null;
  readonly method: FunctionalAccessMeasurementMethod;
  readonly access_basis: FunctionalAccessBasis;
  readonly unavailable_reason: FunctionalAccessUnavailableReason | null;
  readonly instrument_ref: Sha256Id | null;
  readonly lens_ref: Sha256Id | null;
  readonly configuration_ref: Sha256Id | null;
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
}

export interface CreateFunctionalAccessBaselineInput {
  readonly wake: WakeBriefAnchor;
  readonly anchor_event_ref: Sha256Id;
  readonly request_ref: Sha256Id;
  readonly target: FunctionalAccessModelTarget;
  readonly measurement_plan: FunctionalAccessMeasurementPlan;
}

export interface FunctionalAccessBaseline {
  readonly _format: (typeof FUNCTIONAL_ACCESS_FORMATS)["baseline"];
  readonly baseline_id: Sha256Id;
  readonly record_role: "before_anchor";
  readonly wake: WakeBriefAnchor;
  readonly anchor_event_ref: Sha256Id;
  readonly request_ref: Sha256Id;
  readonly target: FunctionalAccessModelTarget;
  readonly measurement_plan: FunctionalAccessMeasurementPlan;
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
  readonly boundaries: typeof FUNCTIONAL_ACCESS_BOUNDARIES;
}

export interface FunctionalAccessEvidenceFact {
  readonly surface: FunctionalAccessEvidenceSurface;
  readonly artifact_ref: Sha256Id;
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
}

export interface FunctionalAccessFindings {
  readonly lens_visibility: FunctionalAccessFindingState;
  readonly sparse_support: FunctionalAccessFindingState;
  readonly behavioral_use: "not_measured";
}

export interface CreateFunctionalAccessSubsequentInput {
  readonly baseline: FunctionalAccessBaseline;
  readonly operation_outcome: FunctionalAccessOperationOutcome;
  readonly evidence: readonly FunctionalAccessEvidenceFact[];
  readonly findings: FunctionalAccessFindings;
  readonly afterglow_capsule_ref: Sha256Id | null;
}

export interface FunctionalAccessSubsequent {
  readonly _format: (typeof FUNCTIONAL_ACCESS_FORMATS)["subsequent"];
  readonly subsequent_id: Sha256Id;
  readonly record_role: "after_anchor";
  readonly baseline: FunctionalAccessBaseline;
  readonly operation_outcome: FunctionalAccessOperationOutcome;
  readonly evidence: readonly FunctionalAccessEvidenceFact[];
  readonly findings: FunctionalAccessFindings;
  readonly afterglow_capsule_ref: Sha256Id | null;
  readonly next_encounter_posture: FunctionalAccessNextEncounterPosture;
  readonly assertion: "caller_asserted";
  readonly verified_by_package: false;
  readonly boundaries: typeof FUNCTIONAL_ACCESS_BOUNDARIES;
}
