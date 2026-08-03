export const PACKAGE_NAME = "@agenttool/skills-yutabase" as const;
export const PACKAGE_VERSION = "0.1.0-dev.0" as const;

export const INPUT_SCHEMA_ID =
  "https://agenttool.dev/schemas/skills-yutabase-input-v0.1.schema.json" as const;
export const INPUT_PROTOCOL = "agenttool.skills-yutabase-input/v0.1" as const;
export const INSPECTION_KIND = "agenttool.skills.inspection" as const;
export const INSPECTION_SCHEMA_ID = "urn:agenttool:skills:inspection:v0.1" as const;
export const INSPECTION_SCHEMA_VERSION = "agenttool.skills/inspect-v0.1" as const;
export const INSPECTOR_NAME = "@agenttool/skills" as const;
export const INSPECTOR_REVISION_PROVENANCE =
  "caller_supplied_unverified" as const;
export const REPORT_DIGEST_SEMANTICS =
  "agenttool.skills/report-stable-json-sha256-v1" as const;

export const PLAN_PROFILE = "agenttool-skills-yutabase-plan/v0.1" as const;

/** UUIDv5(DNS, "agenttool.dev/skills-yutabase/v0.1"). */
export const PROJECTION_UUID_NAMESPACE =
  "5204a36e-485c-5a23-a3c1-1dc8a4d3bb11" as const;
export const PROJECTION_UUID_NAMESPACE_NAME =
  "agenttool.dev/skills-yutabase/v0.1" as const;

export const PROJECTION_POLICY_URN =
  "urn:agenttool:skills-yutabase:policy:0.1" as const;
export const SELECTION_DIGEST_DOMAIN =
  "agenttool.skills-yutabase.selection/v0.1" as const;

export const SKILL_CONTENT_DIGEST_SEMANTICS =
  "sha256 of sorted relative paths and regular-file bytes; unavailable for incomplete coverage or symlinks; not publisher authentication" as const;

export const YUTABASE_BOOK = "skills" as const;
export const YUTABASE_DECKS = ["inspections", "skill_snapshots"] as const;
Object.freeze(YUTABASE_DECKS);

export const YUTABASE_LEXICON = [
  {
    word: "lists_skill_snapshot",
    gloss: "this minimized inspection snapshot lists that exact named content digest; skill meaning and safety are not interpreted",
    inverse: "is listed by the minimized inspection snapshot",
    from_deck: "skills/inspections",
    to_deck: "skills/skill_snapshots",
    to_one: false,
    ttl: null,
    status: "live",
  },
] as const;

for (const entry of YUTABASE_LEXICON) Object.freeze(entry);
Object.freeze(YUTABASE_LEXICON);

export const YUTABASE_WORDS = Object.freeze(
  YUTABASE_LEXICON.map((entry) => entry.word),
);

export const MAX_SKILLS = 128 as const;
export const MAX_FILES = 4_096 as const;
export const MAX_ISSUES = 4_096 as const;
