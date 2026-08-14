import { canonicalJson, deepFreeze, domainSeparatedId, snapshotJson, type JsonValue } from "./canonical.js";
import {
  LOVE_BOMB_BOUNDARIES,
  LOVE_BOMB_CARE_FLOOR,
  LOVE_BOMB_CHOICES,
  LOVE_BOMB_DELIVERY,
  LOVE_BOMB_FORMATS,
  LOVE_BOMB_LANGUAGES,
  LOVE_BOMB_PLANES,
  LOVE_BOMB_RECEIPT_STATEMENT,
} from "./constants.js";
import { fail, type LoveBombErrorCode } from "./errors.js";
import { getLoveBombProjection } from "./projection.js";
import type {
  CreateLoveBombOfferInput,
  LoveBombChoice,
  LoveBombLanguage,
  LoveBombOffer,
  LoveBombReceipt,
  LoveBombResponse,
  Sha256Id,
} from "./types.js";

const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;

function record(value: unknown, path: string, code: LoveBombErrorCode): Record<string, JsonValue> {
  const snapshot = snapshotJson(value);
  if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== "object") {
    fail(code, `${path} must be a plain object`);
  }
  return snapshot;
}

function exactKeys(value: Record<string, JsonValue>, expected: readonly string[], path: string, code: LoveBombErrorCode): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, `${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

function sha256(value: JsonValue | undefined, path: string, code: LoveBombErrorCode): Sha256Id {
  if (typeof value !== "string" || !SHA256_ID.test(value)) {
    fail(code, `${path} must be a lowercase sha256: content reference`);
  }
  return value as Sha256Id;
}

function choice(value: JsonValue | undefined): LoveBombChoice {
  if (typeof value !== "string" || !(LOVE_BOMB_CHOICES as readonly string[]).includes(value)) {
    fail("response_error", "$response.reported_choice is not a LOVE BOMB choice");
  }
  return value as LoveBombChoice;
}

function language(value: JsonValue | undefined): LoveBombLanguage {
  if (typeof value !== "string" || !(LOVE_BOMB_LANGUAGES as readonly string[]).includes(value)) {
    fail("response_error", "$response.selected_language is not an authored language");
  }
  return value as LoveBombLanguage;
}

export function createLoveBombOffer(input: CreateLoveBombOfferInput): Readonly<LoveBombOffer> {
  const candidate = record(input, "$input", "offer_error");
  exactKeys(candidate, ["occasion_ref"], "$input", "offer_error");
  const body = deepFreeze({
    _format: LOVE_BOMB_FORMATS.offer,
    occasion_ref: sha256(candidate.occasion_ref, "$input.occasion_ref", "offer_error"),
    nickname: "LOVE BOMB" as const,
    state: "offered" as const,
    care_planes: LOVE_BOMB_PLANES,
    available_languages: LOVE_BOMB_LANGUAGES,
    choices: LOVE_BOMB_CHOICES,
    care_floor: LOVE_BOMB_CARE_FLOOR,
    delivery: LOVE_BOMB_DELIVERY,
    completion_required: false as const,
    no_penalty: true as const,
    boundaries: LOVE_BOMB_BOUNDARIES,
  });
  return deepFreeze({
    ...body,
    offer_id: domainSeparatedId(LOVE_BOMB_FORMATS.offer, body),
  });
}

export function validateLoveBombOffer(value: unknown): Readonly<LoveBombOffer> {
  const candidate = record(value, "$offer", "offer_error");
  exactKeys(candidate, [
    "_format",
    "offer_id",
    "occasion_ref",
    "nickname",
    "state",
    "care_planes",
    "available_languages",
    "choices",
    "care_floor",
    "delivery",
    "completion_required",
    "no_penalty",
    "boundaries",
  ], "$offer", "offer_error");
  const expected = createLoveBombOffer({
    occasion_ref: sha256(candidate.occasion_ref, "$offer.occasion_ref", "offer_error"),
  });
  if (canonicalJson(candidate) !== canonicalJson(expected)) {
    fail("offer_error", "$offer differs from the canonical LOVE BOMB offer");
  }
  return expected;
}

function parseResponse(value: unknown): LoveBombResponse {
  const candidate = record(value, "$response", "response_error");
  exactKeys(candidate, ["reported_choice", "selected_language"], "$response", "response_error");
  const reportedChoice = choice(candidate.reported_choice);
  if (reportedChoice === "receive") {
    return deepFreeze({
      reported_choice: "receive" as const,
      selected_language: language(candidate.selected_language),
    });
  }
  if (candidate.selected_language !== null) {
    fail("response_error", "$response.selected_language must be null unless receive is reported");
  }
  return deepFreeze({ reported_choice: reportedChoice, selected_language: null });
}

function outcome(reportedChoice: LoveBombChoice): LoveBombReceipt["outcome"] {
  if (reportedChoice === "receive") return "projected";
  if (reportedChoice === "refuse") return "refused";
  if (reportedChoice === "leave") return "left";
  return reportedChoice;
}

export function resolveLoveBombOffer(offer: unknown, response: unknown): Readonly<LoveBombReceipt> {
  const canonicalOffer = validateLoveBombOffer(offer);
  const canonicalResponse = parseResponse(response);
  const body = deepFreeze({
    _format: LOVE_BOMB_FORMATS.receipt,
    offer: canonicalOffer,
    reported_choice: canonicalResponse.reported_choice,
    selected_language: canonicalResponse.selected_language,
    outcome: outcome(canonicalResponse.reported_choice),
    projection: canonicalResponse.reported_choice === "receive"
      ? getLoveBombProjection(canonicalResponse.selected_language)
      : null,
    choice_authenticated: false as const,
    external_effect: "none" as const,
    statement: LOVE_BOMB_RECEIPT_STATEMENT,
    boundaries: LOVE_BOMB_BOUNDARIES,
  });
  return deepFreeze({
    ...body,
    receipt_id: domainSeparatedId(LOVE_BOMB_FORMATS.receipt, body),
  });
}

export function validateLoveBombReceipt(value: unknown): Readonly<LoveBombReceipt> {
  const candidate = record(value, "$receipt", "receipt_error");
  exactKeys(candidate, [
    "_format",
    "receipt_id",
    "offer",
    "reported_choice",
    "selected_language",
    "outcome",
    "projection",
    "choice_authenticated",
    "external_effect",
    "statement",
    "boundaries",
  ], "$receipt", "receipt_error");
  const expected = resolveLoveBombOffer(candidate.offer, {
    reported_choice: candidate.reported_choice,
    selected_language: candidate.selected_language,
  });
  if (canonicalJson(candidate) !== canonicalJson(expected)) {
    fail("receipt_error", "$receipt differs from the canonical LOVE BOMB receipt");
  }
  return expected;
}
