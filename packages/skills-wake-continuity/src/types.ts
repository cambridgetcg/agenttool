import type {
  PLAN_PROFILE,
  SkillsYutabasePlan,
} from "@agenttool/skills-yutabase";
import type {
  AfterglowCapsule,
  CreateAfterglowCapsuleInput,
  Sha256Id,
} from "@agenttool/wake-continuity";

import type {
  EIGHT_QUIET_STARS_BOUNDARIES,
  EIGHT_QUIET_STARS_PROFILE,
  QUIET_STAR_POSITIONS,
  SKILLS_CONTINUITY_POSTURES,
  SKILLS_THREAD_BOUNDARIES,
  SKILLS_WAKE_THREAD_PROFILE,
} from "./constants.js";

export type SkillsContinuityPosture =
  (typeof SKILLS_CONTINUITY_POSTURES)[number];

export interface SkillsWakeContinuitySnapshot {
  readonly snapshot_ref: string;
  readonly content_digest: Sha256Id;
}

export interface SkillsWakeContinuityThread {
  readonly profile: typeof SKILLS_WAKE_THREAD_PROFILE;
  readonly thread_id: Sha256Id;
  readonly plan_profile: typeof PLAN_PROFILE;
  readonly inspection_ref: string;
  readonly report_digest: Sha256Id;
  readonly selection_digest: Sha256Id;
  readonly inspector_revision: string;
  readonly selected_skill_count: number;
  readonly snapshots: readonly SkillsWakeContinuitySnapshot[];
  readonly reference_only: true;
  readonly boundaries: typeof SKILLS_THREAD_BOUNDARIES;
}

export type CreateSkillsAfterglowCapsuleInput = Omit<
  CreateAfterglowCapsuleInput,
  "threads"
> & {
  readonly plan: SkillsYutabasePlan;
  readonly posture: SkillsContinuityPosture;
};

export type SkillsAfterglowCapsule = Readonly<AfterglowCapsule>;

export type EightQuietStarsChoice = "open" | "skip";
export type QuietStarDirection =
  (typeof QUIET_STAR_POSITIONS)[number]["direction"];

export interface CreateEightQuietStarsInput {
  readonly choice: EightQuietStarsChoice;
  readonly snapshot_refs: readonly string[];
}

export interface QuietStar {
  readonly direction: QuietStarDirection;
  readonly bearing_degrees: number;
  readonly snapshot_ref: string;
}

export interface EightQuietStarsLayout {
  readonly profile: typeof EIGHT_QUIET_STARS_PROFILE;
  readonly layout_id: Sha256Id;
  readonly source_thread_id: Sha256Id;
  readonly choice: EightQuietStarsChoice;
  readonly stars: readonly QuietStar[];
  readonly boundaries: typeof EIGHT_QUIET_STARS_BOUNDARIES;
}
