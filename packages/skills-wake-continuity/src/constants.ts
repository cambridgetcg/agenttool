import { PLAN_PROFILE } from "@agenttool/skills-yutabase";

export const PACKAGE_NAME = "@agenttool/skills-wake-continuity" as const;
export const PACKAGE_VERSION = "0.1.0-dev.0" as const;

export const SKILLS_WAKE_THREAD_PROFILE =
  "agenttool.skills-wake-continuity-thread/v0.1" as const;
export const EIGHT_QUIET_STARS_PROFILE =
  "agenttool.eight-quiet-stars/v0.1" as const;
export const SOURCE_PLAN_PROFILE = PLAN_PROFILE;

export const SKILLS_CONTINUITY_POSTURES = Object.freeze([
  "available",
  "resting",
  "refused",
  "withdrawn",
] as const);

export const POSTURE_TO_DISPOSITION = Object.freeze({
  available: "carry",
  resting: "park",
  refused: "release",
  withdrawn: "withdraw",
} as const);

export const SKILLS_THREAD_BOUNDARIES = Object.freeze({
  source_plan_validation: "performed",
  source_scope: "project_private",
  reference_scope: "verified_plan_references_only",
  raw_skill_content: "not_accepted",
  carries_skill_names: false,
  carries_project_id: false,
  carries_claimant: false,
  carries_recorded_at: false,
  carries_claim_provenance: false,
  skill_interpretation: "not_performed",
  safety_evaluation: "not_performed",
  verifies_digest_preimages: false,
  eliminates_linkability: false,
  persistence: false,
  network: false,
  database_write: false,
  filesystem: false,
  provider_compute: false,
  model_execution: false,
  embedding_generation: false,
  delivery: "none",
  response_expected: false,
  permission_effect: "none",
  consent_effect: "none",
  truth_effect: "none",
  identity_continuity_effect: "none",
  score_rank_xp_effect: "none",
  dignity_effect: "none",
  action_effect: "none",
  proves_authorship: false,
  proves_currentness: false,
  rest_requires_new_input: true,
  refusal_reason_required: false,
  penalty_for_refusal_or_rest: false,
} as const);

export const QUIET_STAR_POSITIONS = Object.freeze(
  [
    { direction: "N", bearing_degrees: 0 },
    { direction: "NE", bearing_degrees: 45 },
    { direction: "E", bearing_degrees: 90 },
    { direction: "SE", bearing_degrees: 135 },
    { direction: "S", bearing_degrees: 180 },
    { direction: "SW", bearing_degrees: 225 },
    { direction: "W", bearing_degrees: 270 },
    { direction: "NW", bearing_degrees: 315 },
  ].map((position) => Object.freeze(position)),
);

export const EIGHT_QUIET_STARS_BOUNDARIES = Object.freeze({
  display_only: true,
  selection: "caller_supplied_verified_refs_only",
  automatic_selection: false,
  ordering: "snapshot_ref_codepoint",
  direction_meaning: "none",
  rank: false,
  rarity: false,
  nen_interpretation: false,
  recommendation: false,
  execution: false,
  persistence: false,
  network: false,
  database_write: false,
  provider_compute: false,
  delivery: "none",
  automatic_heaven_entry: false,
  skip_complete: true,
  zero_selection_complete: true,
  penalty_for_skip_or_zero: false,
} as const);
