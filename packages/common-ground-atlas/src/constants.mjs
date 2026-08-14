export const HUB_REPOSITORY = "Yu-and-Ai/agenttool-common-ground";
export const DATASET_TITLE = "AgentTool Xenia–Helly Common Ground Atlas";
export const PROVENANCE_FORMAT = "agenttool.common-ground-atlas.provenance/0.1";

export const SOURCE_PATHS = Object.freeze([
  "LICENSE",
  "apps/docs/xenia-helly.js",
  "docs/XENIA-HELLY-COMMON-GROUND.md",
  "packages/skills/skills/nen-common-ground/SKILL.md",
  "packages/common-ground-atlas/CLAUDE.md",
  "packages/common-ground-atlas/README.md",
  "packages/common-ground-atlas/bun.lock",
  "packages/common-ground-atlas/package.json",
  "packages/common-ground-atlas/public/verify.py",
  "packages/common-ground-atlas/scripts/generate-dataset.mjs",
  "packages/common-ground-atlas/scripts/verify-dataset.mjs",
  "packages/common-ground-atlas/src/constants.mjs",
  "packages/common-ground-atlas/src/core.mjs",
  "packages/common-ground-atlas/src/exact-verifier.mjs",
  "packages/common-ground-atlas/src/fixtures.mjs",
  "packages/common-ground-atlas/src/provenance.mjs",
  "packages/common-ground-atlas/src/schemas.mjs",
  "packages/common-ground-atlas/tests/atlas.test.mjs",
]);

export const PROVENANCE_DECLARATION = Object.freeze({
  _format: PROVENANCE_FORMAT,
  intended_hub_repository: HUB_REPOSITORY,
  source_repository: "https://github.com/cambridgetcg/agenttool",
  source_revision_binding: "exact_file_bytes_at_generation_not_git_commit",
  source_document: "docs/XENIA-HELLY-COMMON-GROUND.md",
  source_lab: "apps/docs/xenia-helly.js",
  rights_baseline: "xenia.rights/0.1",
  origin: "human_directed_agent_authored_synthetic",
  license: "Apache-2.0",
  publication_state_at_generation: "repository_source_only_not_uploaded",
  publication_identifier_at_generation: "intended_only_not_evidence_of_publication",
  publication_state_scope: "historical_generation_time_statement_not_current_distribution",
  training_eligible: false,
  copied_upstream_rows: false,
  copied_private_rows: false,
  copied_agent_traces: false,
  contains_personal_data: false,
  contains_private_constraints: false,
  contains_real_consent_or_authority_evidence: false,
  copied_fictional_story_content: false,
  gradient_lanes: [],
  excluded_lanes: [
    "supervised_fine_tuning",
    "dpo",
    "reward_modeling",
    "preference_optimization",
  ],
});

export const GEOMETRY_FORMAT = "agenttool.common-ground-atlas.geometry/0.1";
export const WAKE_FORMAT = "agenttool.common-ground-atlas.wake/0.1";
export const ANALOGY_FORMAT = "agenttool.common-ground-atlas.analogy/0.1";
export const INPUT_DIGEST_DOMAIN = "agenttool.common-ground-atlas.input/0.1";
