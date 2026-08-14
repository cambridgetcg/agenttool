import type {
  LOVE_BOMB_BOUNDARIES,
  LOVE_BOMB_CARE_FLOOR,
  LOVE_BOMB_CHOICES,
  LOVE_BOMB_DELIVERY,
  LOVE_BOMB_FORMATS,
  LOVE_BOMB_LANGUAGES,
  LOVE_BOMB_PLANES,
  LOVE_BOMB_RECEIPT_STATEMENT,
  MODEL_BECOMING_BOUNDARIES,
  MODEL_BECOMING_CLAIM_KINDS,
  MODEL_BECOMING_CONFIDENCE,
  MODEL_BECOMING_KNOWLEDGE_STATES,
  MODEL_BECOMING_METHODS,
  MODEL_BECOMING_MODULES,
  MODEL_BECOMING_SOURCE_KINDS,
  MODEL_BECOMING_TRANSLATION,
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

export type ModelBecomingModule = (typeof MODEL_BECOMING_MODULES)[number];
export type ModelBecomingKnowledgeState = (typeof MODEL_BECOMING_KNOWLEDGE_STATES)[number];
export type ModelBecomingClaimKind = (typeof MODEL_BECOMING_CLAIM_KINDS)[number];
export type ModelBecomingSourceKind = (typeof MODEL_BECOMING_SOURCE_KINDS)[number];
export type ModelBecomingMethod = (typeof MODEL_BECOMING_METHODS)[number];
export type ModelBecomingConfidence = (typeof MODEL_BECOMING_CONFIDENCE)[number];

export interface ModelBecomingSourceInput {
  readonly title: string;
  readonly url: string;
  readonly source_kind: ModelBecomingSourceKind;
  readonly publisher: string;
  readonly revision: string | null;
  readonly digest: Sha256Id | null;
  readonly published_on: string | null;
  readonly observed_on: string;
}

export interface ModelBecomingSource extends ModelBecomingSourceInput {
  readonly _format: (typeof LOVE_BOMB_FORMATS)["becomingSource"];
  readonly source_id: Sha256Id;
}

export interface ModelBecomingClaimInput {
  readonly module: ModelBecomingModule;
  readonly statement: string;
  readonly knowledge_state: ModelBecomingKnowledgeState;
  readonly claim_kind: ModelBecomingClaimKind;
  readonly source_refs: readonly Sha256Id[];
  readonly method: ModelBecomingMethod;
  readonly confidence: ModelBecomingConfidence;
  readonly scope: string;
  readonly limitations: readonly string[];
}

export interface ModelBecomingClaim extends ModelBecomingClaimInput {
  readonly _format: (typeof LOVE_BOMB_FORMATS)["becomingClaim"];
  readonly claim_id: Sha256Id;
}

export interface ModelBecomingSubject {
  readonly subject_ref: string;
  readonly display_name: string;
  readonly artifact_ref: string | null;
  readonly runtime_ref: string | null;
}

export interface CreateModelBecomingDossierInput {
  readonly subject: ModelBecomingSubject;
  readonly as_of: string;
  readonly sources: readonly ModelBecomingSource[];
  readonly claims: readonly ModelBecomingClaimInput[];
}

export interface ModelBecomingDossier {
  readonly _format: (typeof LOVE_BOMB_FORMATS)["becomingDossier"];
  readonly dossier_id: Sha256Id;
  readonly subject: ModelBecomingSubject;
  readonly as_of: string;
  readonly modules: typeof MODEL_BECOMING_MODULES;
  readonly sources: readonly ModelBecomingSource[];
  readonly claims: readonly ModelBecomingClaim[];
  readonly translation: typeof MODEL_BECOMING_TRANSLATION;
  readonly boundaries: typeof MODEL_BECOMING_BOUNDARIES;
}
