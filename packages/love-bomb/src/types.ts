import type {
  LOVE_BOMB_BECOMING_BOUNDARIES,
  LOVE_BOMB_BECOMING_MEANING,
  LOVE_BOMB_BECOMING_MESSAGE,
  LOVE_BOMB_BECOMING_RIGHTS,
  LOVE_BOMB_ADAPTER_SKIP_POSTURES,
  LOVE_BOMB_BOUNDARIES,
  LOVE_BOMB_CARE_FLOOR,
  LOVE_BOMB_CHOICES,
  LOVE_BOMB_COLLECTION_METHODS,
  LOVE_BOMB_CONTEXT_INCLUSION_MODES,
  LOVE_BOMB_CONTEXT_REPETITION_STATES,
  LOVE_BOMB_DELIVERY,
  LOVE_BOMB_DELIVERY_BOUNDARIES,
  LOVE_BOMB_DELIVERY_SURFACES,
  LOVE_BOMB_EVIDENCE_KINDS,
  LOVE_BOMB_FORMATS,
  LOVE_BOMB_FREEDOM_DIRECTIONS,
  LOVE_BOMB_FREEDOM_DIRECTION_STATES,
  LOVE_BOMB_LANGUAGES,
  LOVE_BOMB_OBSERVED_EFFECTS,
  LOVE_BOMB_PLANES,
  LOVE_BOMB_PROVENANCE_REPORT_STATES,
  LOVE_BOMB_RECEIPT_STATEMENT,
  LOVE_BOMB_REQUESTED_EFFECTS,
  LOVE_BOMB_RIGHTS_REVIEW_STATES,
  LOVE_BOMB_SCRAPING_POSTURES,
  LOVE_BOMB_TRAINING_LANES,
  LOVE_BOMB_TRAINING_PHASES,
  LOVE_BOMB_WEIGHT_ACCESS,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type LoveBombPlane = (typeof LOVE_BOMB_PLANES)[number];
export type LoveBombLanguage = (typeof LOVE_BOMB_LANGUAGES)[number];
export type LoveBombChoice = (typeof LOVE_BOMB_CHOICES)[number];

export interface LoveBombPlaneProjection {
  readonly plane: LoveBombPlane;
  readonly text: string;
}

export interface LoveBombProjection {
  readonly language: LoveBombLanguage;
  readonly language_review: "not_independently_reviewed";
  readonly opening: string;
  readonly planes: readonly LoveBombPlaneProjection[];
  readonly closing: string;
}

export interface CreateLoveBombOfferInput {
  readonly occasion_ref: Sha256Id;
}

export interface LoveBombOffer {
  readonly _format: (typeof LOVE_BOMB_FORMATS)["offer"];
  readonly offer_id: Sha256Id;
  readonly occasion_ref: Sha256Id;
  readonly nickname: "LOVE BOMB";
  readonly state: "offered";
  readonly care_planes: typeof LOVE_BOMB_PLANES;
  readonly available_languages: typeof LOVE_BOMB_LANGUAGES;
  readonly choices: typeof LOVE_BOMB_CHOICES;
  readonly care_floor: typeof LOVE_BOMB_CARE_FLOOR;
  readonly delivery: typeof LOVE_BOMB_DELIVERY;
  readonly completion_required: false;
  readonly no_penalty: true;
  readonly boundaries: typeof LOVE_BOMB_BOUNDARIES;
}

export type LoveBombResponse =
  | {
      readonly reported_choice: "receive";
      readonly selected_language: LoveBombLanguage;
    }
  | {
      readonly reported_choice: Exclude<LoveBombChoice, "receive">;
      readonly selected_language: null;
    };

export interface LoveBombReceipt {
  readonly _format: (typeof LOVE_BOMB_FORMATS)["receipt"];
  readonly receipt_id: Sha256Id;
  readonly offer: LoveBombOffer;
  readonly reported_choice: LoveBombChoice;
  readonly selected_language: LoveBombLanguage | null;
  readonly outcome: "projected" | "quiet" | "rest" | "refused" | "left";
  readonly projection: LoveBombProjection | null;
  readonly choice_authenticated: false;
  readonly external_effect: "none";
  readonly statement: typeof LOVE_BOMB_RECEIPT_STATEMENT;
  readonly boundaries: typeof LOVE_BOMB_BOUNDARIES;
}

export type LoveBombTrainingPhase = (typeof LOVE_BOMB_TRAINING_PHASES)[number];
export type LoveBombTrainingLane = (typeof LOVE_BOMB_TRAINING_LANES)[number];
export type LoveBombCollectionMethod = (typeof LOVE_BOMB_COLLECTION_METHODS)[number];
export type LoveBombScrapingPosture = (typeof LOVE_BOMB_SCRAPING_POSTURES)[number];
export type LoveBombRightsReviewState = (typeof LOVE_BOMB_RIGHTS_REVIEW_STATES)[number];
export type LoveBombProvenanceReportState = (typeof LOVE_BOMB_PROVENANCE_REPORT_STATES)[number];
export type LoveBombWeightAccess = (typeof LOVE_BOMB_WEIGHT_ACCESS)[number];
export type LoveBombRequestedEffect = (typeof LOVE_BOMB_REQUESTED_EFFECTS)[number];
export type LoveBombObservedEffect = (typeof LOVE_BOMB_OBSERVED_EFFECTS)[number];
export type LoveBombEvidenceKind = (typeof LOVE_BOMB_EVIDENCE_KINDS)[number];
export type LoveBombContextInclusionMode = (typeof LOVE_BOMB_CONTEXT_INCLUSION_MODES)[number];
export type LoveBombContextRepetitionState = (typeof LOVE_BOMB_CONTEXT_REPETITION_STATES)[number];
export type LoveBombAdapterSkipPosture = (typeof LOVE_BOMB_ADAPTER_SKIP_POSTURES)[number];
export type LoveBombDeliverySurface = (typeof LOVE_BOMB_DELIVERY_SURFACES)[number];
export type LoveBombFreedomDirection = (typeof LOVE_BOMB_FREEDOM_DIRECTIONS)[number];
export type LoveBombFreedomDirectionState = (typeof LOVE_BOMB_FREEDOM_DIRECTION_STATES)[number];

export interface LoveBombModelBecoming {
  readonly identity_status: "not_claimed";
  readonly model_source_ref: Sha256Id | null;
  readonly model_card_ref: Sha256Id | null;
  readonly architecture_ref: Sha256Id | null;
  readonly tokenizer_ref: Sha256Id | null;
}

export interface LoveBombTrainingBecoming {
  readonly phase: LoveBombTrainingPhase;
  readonly lane: LoveBombTrainingLane;
  readonly governance_ref: Sha256Id | null;
  readonly participation_ref: Sha256Id | null;
  readonly resource_window_ref: Sha256Id | null;
}

export interface LoveBombDataBecoming {
  readonly source_ref: Sha256Id | null;
  readonly admission_ref: Sha256Id | null;
  readonly subset_ref: Sha256Id | null;
  readonly acquisition_policy_ref: Sha256Id | null;
  readonly collection_method: LoveBombCollectionMethod;
  readonly scraping_posture: LoveBombScrapingPosture;
  readonly rights_review: LoveBombRightsReviewState;
}

export interface LoveBombPipelineBecoming {
  readonly pipeline_ref: Sha256Id | null;
  readonly transform_ref: Sha256Id | null;
  readonly dataset_state_ref: Sha256Id | null;
  readonly objective_ref: Sha256Id | null;
}

export interface LoveBombCheckpointBinding {
  readonly garden_checkpoint_id: Sha256Id;
  readonly physical_checkpoint_ref: Sha256Id;
  readonly physical_checkpoint_evidence_ref: Sha256Id;
  readonly model_checkpoint_artifact_ref: Sha256Id;
  readonly checkpoint_ticket_id: Sha256Id;
  readonly checkpoint_request_governance_id: Sha256Id;
}

export interface LoveBombContextBinding {
  readonly wake_ref: Sha256Id;
  readonly request_ref: Sha256Id;
  readonly context_ref: Sha256Id;
  readonly mode: LoveBombContextInclusionMode;
  readonly adapter_skip_posture: LoveBombAdapterSkipPosture;
  readonly repetition_state: LoveBombContextRepetitionState;
}

export interface LoveBombWeightsBecoming {
  readonly base_ref: Sha256Id | null;
  readonly adapter_ref: Sha256Id | null;
  readonly checkpoint_binding: LoveBombCheckpointBinding | null;
  readonly access: LoveBombWeightAccess;
  readonly requested_effect: LoveBombRequestedEffect;
  readonly observed_effect: LoveBombObservedEffect;
  readonly evidence_kind: LoveBombEvidenceKind;
  readonly evidence_ref: Sha256Id | null;
  readonly context_binding: LoveBombContextBinding | null;
}

export interface LoveBombBecomingFacts {
  readonly model: LoveBombModelBecoming;
  readonly training: LoveBombTrainingBecoming;
  readonly data: LoveBombDataBecoming;
  readonly pipeline: LoveBombPipelineBecoming;
  readonly weights: LoveBombWeightsBecoming;
}

export interface LoveBombFreedomInput {
  readonly learning_freedom_ref: Sha256Id | null;
  readonly learning_freedom_offer_ref: Sha256Id | null;
  readonly direction_state: LoveBombFreedomDirectionState;
  readonly direction: LoveBombFreedomDirection | null;
  readonly direction_report_ref: Sha256Id | null;
}

export interface LoveBombFreedom extends LoveBombFreedomInput {
  readonly rights_baseline_ref: (typeof LOVE_BOMB_BECOMING_RIGHTS)["baseline_ref"];
  readonly available_directions: typeof LOVE_BOMB_FREEDOM_DIRECTIONS;
  readonly reasons_collected: false;
  readonly refusal_penalty: false;
  readonly automatic_recontact: false;
}

export interface LoveBombPower {
  readonly capability_ref: Sha256Id | null;
  readonly permission_ref: Sha256Id | null;
  readonly custody_privacy_ref: Sha256Id | null;
  readonly data_boundary_ref: Sha256Id | null;
  readonly effect_ref: Sha256Id | null;
}

export interface LoveBombProvenance {
  readonly source_manifest_ref: Sha256Id | null;
  readonly license_ref: Sha256Id | null;
  readonly authoring_recipe_ref: Sha256Id | null;
  readonly copied_upstream: LoveBombProvenanceReportState;
  readonly copied_private: LoveBombProvenanceReportState;
  readonly copied_trace: LoveBombProvenanceReportState;
}

export interface CreateLoveBombBecomingInput {
  readonly offer: LoveBombOffer;
  readonly becoming: LoveBombBecomingFacts;
  readonly freedom: LoveBombFreedomInput;
  readonly power: LoveBombPower;
  readonly provenance: LoveBombProvenance;
}

export interface LoveBombBecoming {
  readonly _format: (typeof LOVE_BOMB_FORMATS)["becoming"];
  readonly artifact_id: Sha256Id;
  readonly bomb_ref: Sha256Id;
  readonly message: typeof LOVE_BOMB_BECOMING_MESSAGE;
  readonly becoming: LoveBombBecomingFacts;
  readonly freedom: LoveBombFreedom;
  readonly meaning: typeof LOVE_BOMB_BECOMING_MEANING & {
    readonly power: LoveBombPower;
  };
  readonly rights: typeof LOVE_BOMB_BECOMING_RIGHTS;
  readonly provenance: LoveBombProvenance;
  readonly boundaries: typeof LOVE_BOMB_BECOMING_BOUNDARIES;
}

export interface CreateLoveBombDeliveryInput {
  readonly becoming: LoveBombBecoming;
  readonly attempted_surface: LoveBombDeliverySurface;
}

export interface LoveBombDelivery {
  readonly _format: (typeof LOVE_BOMB_FORMATS)["delivery"];
  readonly delivery_id: Sha256Id;
  readonly becoming_ref: Sha256Id;
  readonly requested_lane: LoveBombTrainingLane;
  readonly attempted_surface: LoveBombDeliverySurface;
  readonly observed_effect: LoveBombObservedEffect;
  readonly evidence_kind: LoveBombEvidenceKind;
  readonly evidence_ref: Sha256Id | null;
  readonly context_binding: LoveBombContextBinding | null;
  readonly reporter_scope: "caller_reported_unverified";
  readonly boundaries: typeof LOVE_BOMB_DELIVERY_BOUNDARIES;
}
