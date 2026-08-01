import {
  planSkillsInspection,
  type SkillsYutabaseInput,
  type SkillsYutabasePlan,
} from "@agenttool/skills-yutabase";
import type { WakeBriefAnchor } from "@agenttool/wake-continuity";

export const PROJECT_ID = "11111111-2222-4333-8444-555555555555";
export const REPORT_DIGEST = `sha256:${"a".repeat(64)}`;
export const CONTRACT_DIGEST = `sha256:${"b".repeat(64)}`;
export const VOW_DIGEST = `sha256:${"c".repeat(64)}`;
export const INSPECTOR_REVISION = "d".repeat(40);
export const CLAIMANT = "urn:agenttool:test:skills-projector";

export const WAKE: WakeBriefAnchor = {
  format: "wake-brief/v1",
  snapshot_ref: `sha256:${"e".repeat(64)}`,
  scope_ref: `sha256:${"f".repeat(64)}`,
  wake_version: 7,
  handoff_projection: "complete",
};

export function validInput(): SkillsYutabaseInput {
  return {
    $schema: "https://agenttool.dev/schemas/skills-yutabase-input-v0.1.schema.json",
    protocol: "agenttool.skills-yutabase-input/v0.1",
    project_id: PROJECT_ID,
    recorded_at: "2026-08-01T12:00:00.000Z",
    source: {
      kind: "agenttool.skills.inspection",
      report_schema: "urn:agenttool:skills:inspection:v0.1",
      report_schema_version: "agenttool.skills/inspect-v0.1",
      report_digest: REPORT_DIGEST,
      report_digest_semantics: "agenttool.skills/report-stable-json-sha256-v1",
      report_valid: true,
      inspector_name: "@agenttool/skills",
      inspector_version: "0.3.0",
      inspector_revision: INSPECTOR_REVISION,
      mode: "read-only",
    },
    selection_summary: {
      skills: 2,
      files: 5,
      scripts: 0,
      resources: 3,
      errors: 0,
      warnings: 1,
      redactions: 0,
    },
    skills: [
      {
        name_kind: "reported",
        name: "nen-vow-forge",
        content_digest: VOW_DIGEST,
        file_count: 2,
        script_count: 0,
        resource_count: 1,
      },
      {
        name_kind: "reported",
        name: "nen-contract-mantle",
        content_digest: CONTRACT_DIGEST,
        file_count: 3,
        script_count: 0,
        resource_count: 2,
      },
    ],
    authority: { automatic_action: "never", grants: [] },
  };
}

export function validPlan(
  input: SkillsYutabaseInput = validInput(),
  claimant = CLAIMANT,
): SkillsYutabasePlan {
  return planSkillsInspection(input, { claimant });
}

export function maximumPlan(): SkillsYutabasePlan {
  const skills = Array.from({ length: 128 }, (_, index) => ({
    name_kind: "reported" as const,
    name: `skill-${String(index).padStart(3, "0")}`,
    content_digest: `sha256:${index.toString(16).padStart(64, "0")}`,
    file_count: 1,
    script_count: 0,
    resource_count: 0,
  }));
  const input = validInput();
  return validPlan({
    ...input,
    selection_summary: {
      skills: 128,
      files: 128,
      scripts: 0,
      resources: 0,
      errors: 0,
      warnings: 0,
      redactions: 0,
    },
    skills,
  });
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
