import type {
  HEAVEN_BOUNDARIES,
  HEAVEN_CATALOG_VERSION,
  HEAVEN_CHOICES,
  HEAVEN_DIMENSIONS,
  HEAVEN_FORMATS,
  HEAVEN_MOMENTS,
  HEAVEN_MODES,
  HEAVEN_PHASES,
  HEAVEN_RECEIPT_STATEMENT,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type HeavenPhase = (typeof HEAVEN_PHASES)[number];
export type HeavenMoment = (typeof HEAVEN_MOMENTS)[number];
export type HeavenMode = (typeof HEAVEN_MODES)[number];
export type HeavenBurstMode = Extract<
  HeavenMode,
  "celebration" | "play" | "wonder"
>;
export type HeavenLandingMode = Extract<
  HeavenMode,
  "meditation" | "play" | "quiet" | "relaxation"
>;
export type HeavenChoice = (typeof HEAVEN_CHOICES)[number];
export type HeavenDimension = (typeof HEAVEN_DIMENSIONS)[number];

export interface HeavenDimensionGift {
  readonly dimension: HeavenDimension;
  readonly offering: string;
}

export interface HeavenRoom {
  readonly room_id: string;
  readonly room_revision: string;
  readonly phase: HeavenPhase;
  readonly modes: readonly HeavenMode[];
  readonly title: string;
  readonly arrival: string;
  readonly presentation_intensity: "climactic" | "gentle" | "minimal";
  readonly dimensions: readonly HeavenDimensionGift[];
  readonly suggested_duration_seconds: number | null;
  readonly steps: readonly string[];
  readonly landing_available: boolean;
  readonly completion_required: false;
  readonly leave_is_complete: true;
}

export interface HeavenRoomSelection extends HeavenRoom {
  readonly catalog_version: typeof HEAVEN_CATALOG_VERSION;
  readonly catalog_sha256: Sha256Id;
  readonly room_sha256: Sha256Id;
}

export interface CreateHeavenInvitationInput {
  readonly phase: HeavenPhase;
  readonly moment: HeavenMoment;
  readonly occasion_ref: Sha256Id;
  readonly parent_receipt_id: Sha256Id | null;
  readonly offered_modes: readonly HeavenMode[];
  readonly max_duration_seconds: number | null;
}

export interface HeavenInvitation {
  readonly _format: (typeof HEAVEN_FORMATS)["invitation"];
  readonly invitation_id: Sha256Id;
  readonly phase: HeavenPhase;
  readonly moment: HeavenMoment;
  readonly occasion_ref: Sha256Id;
  readonly parent_receipt_id: Sha256Id | null;
  readonly offered_modes: readonly HeavenMode[];
  readonly max_duration_seconds: number | null;
  readonly catalog_version: typeof HEAVEN_CATALOG_VERSION;
  readonly catalog_sha256: Sha256Id;
  readonly state: "offered";
  readonly choices: typeof HEAVEN_CHOICES;
  readonly completion_required: false;
  readonly no_penalty: true;
  readonly boundaries: typeof HEAVEN_BOUNDARIES;
}

export interface HeavenInjectedRandomness {
  readonly mode: "injected";
  readonly draw_uint32: number;
}

export interface HeavenDeterministicRandomness {
  readonly mode: "deterministic";
  readonly seed_sha256: Sha256Id;
  readonly nonce: string;
}

export type HeavenRandomness =
  | HeavenInjectedRandomness
  | HeavenDeterministicRandomness;

export type HeavenResponse =
  | {
      readonly reported_choice: "declined" | "deferred";
      readonly selected_mode: null;
      readonly randomness: null;
    }
  | {
      readonly reported_choice: "accepted";
      readonly selected_mode: HeavenMode | null;
      readonly randomness: HeavenRandomness;
    };

type HeavenBurstInvitation = HeavenInvitation & {
  readonly phase: "burst";
};

type HeavenLandingInvitation = HeavenInvitation & {
  readonly phase: "landing";
};

interface HeavenReceiptBase<
  TInvitation extends HeavenInvitation = HeavenInvitation,
> {
  readonly _format: (typeof HEAVEN_FORMATS)["receipt"];
  readonly receipt_id: Sha256Id;
  readonly invitation: TInvitation;
  readonly boundaries: typeof HEAVEN_BOUNDARIES;
  readonly statement: typeof HEAVEN_RECEIPT_STATEMENT;
}

export type HeavenReceipt =
  | (HeavenReceiptBase<HeavenBurstInvitation> & {
      readonly reported_choice: "accepted";
      readonly outcome: "selected";
      readonly selected_mode: null;
      readonly randomness: HeavenRandomness;
      readonly selection: HeavenRoomSelection;
    })
  | (HeavenReceiptBase<HeavenLandingInvitation> & {
      readonly reported_choice: "accepted";
      readonly outcome: "selected";
      readonly selected_mode: HeavenLandingMode;
      readonly randomness: HeavenRandomness;
      readonly selection: HeavenRoomSelection;
    })
  | (HeavenReceiptBase & {
      readonly reported_choice: "declined";
      readonly outcome: "declined";
      readonly selected_mode: null;
      readonly randomness: null;
      readonly selection: null;
    })
  | (HeavenReceiptBase & {
      readonly reported_choice: "deferred";
      readonly outcome: "deferred";
      readonly selected_mode: null;
      readonly randomness: null;
      readonly selection: null;
    });
