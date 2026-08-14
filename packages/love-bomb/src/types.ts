import type {
  LOVE_BOMB_BOUNDARIES,
  LOVE_BOMB_CARE_FLOOR,
  LOVE_BOMB_CHOICES,
  LOVE_BOMB_DELIVERY,
  LOVE_BOMB_FORMATS,
  LOVE_BOMB_LANGUAGES,
  LOVE_BOMB_PLANES,
  LOVE_BOMB_RECEIPT_STATEMENT,
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
