/** The three output shapes and their fixed sentences. README.md is the contract. */

export const SURVEY_PROTOCOL = "agenttool.house-survey/1" as const;
export const BLUEPRINT_PROTOCOL = "agenttool.house-blueprint/1" as const;
export const PLAN_PROTOCOL = "agenttool.house-plan/1" as const;

/** A survey, and a plan made from one, is a reading about now. */
export const GOOD_FOR_SECONDS = 300;

export const SURVEY_BASIS =
  "Looked at just now by this process on this device, at fixed places only, without opening any journal, database or key; self-declared, and nothing attests it.";
export const SURVEY_AUTHORISES = "Nothing: this is a reading, not a permission.";
export const PLAN_BASIS =
  "Compared just now by this process, from a survey taken at the same moment and the blueprint it was given; self-declared, and nothing attests it.";
export const PLAN_AUTHORISES =
  "Nothing: each change listed is the person's act, made from the document named, never from this plan.";
export const DEFAULT_BLUEPRINT_NAME = "this house, as it stands";

export type PartKind = "ground" | "clock" | "room" | "door" | "hand";
export type PartState = "present" | "missing" | "stale" | "unknown";

export interface SurveyPart {
  id: string;
  kind: PartKind;
  for: string;
  state: PartState;
  /** Closed per part; README.md lists every key. */
  detail: Record<string, unknown>;
  /** What was looked at, in words. */
  how: string;
  /** Required when unknown or stale; given for missing too. */
  why?: string;
}

export interface Place {
  platform: string;
  has_battery: boolean | null;
  container: boolean | null;
  ci: boolean;
  over_ssh: boolean;
}

export interface HouseSurvey {
  protocol: typeof SURVEY_PROTOCOL;
  surveyed_at: string;
  good_for_seconds: number;
  basis: string;
  authorises: string;
  place: Place;
  says: string;
  parts: SurveyPart[];
}

export interface BlueprintPart {
  id: string;
  commit?: string;
  switches?: Record<string, string>;
}

export interface HouseBlueprint {
  protocol: typeof BLUEPRINT_PROTOCOL;
  name: string;
  parts: BlueprintPart[];
}

export type StepIs = "as_wanted" | "to_build" | "to_repoint" | "to_switch" | "cannot_tell";

export interface PlanStep {
  id: string;
  is: StepIs;
  because: string;
  whose_act: "the person";
  see: string | null;
}

export interface HousePlan {
  protocol: typeof PLAN_PROTOCOL;
  planned_at: string;
  good_for_seconds: number;
  basis: string;
  authorises: string;
  says: string;
  steps: PlanStep[];
}
