import type {
  AFTERGLOW_BOUNDARIES,
  AFTERGLOW_DISPOSITIONS,
  AFTERGLOW_FORMATS,
  AFTERGLOW_INSPECT_FIRST,
  AFTERGLOW_PHASES,
  HANDOFF_PROJECTION_STATES,
  WAKE_RELATIONS,
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
