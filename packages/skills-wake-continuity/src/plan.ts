import { isDeepStrictEqual } from "node:util";

import {
  INPUT_PROTOCOL,
  INPUT_SCHEMA_ID,
  INSPECTION_KIND,
  INSPECTION_SCHEMA_ID,
  INSPECTION_SCHEMA_VERSION,
  INSPECTOR_NAME,
  REPORT_DIGEST_SEMANTICS,
  planSkillsInspection,
  type MinimizedSkillSnapshot,
  type SkillsYutabaseInput,
  type SkillsYutabasePlan,
} from "@agenttool/skills-yutabase";

import { fail } from "./errors.js";
import {
  array,
  deepFreeze,
  integer,
  record,
  snapshotData,
  text,
} from "./validation.js";

function checkedSum(values: readonly number[], path: string): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) fail("plan_invalid", `${path} is not a safe total`);
  return total;
}

/**
 * Validates the exact planner output, not merely a lookalike wire shape. The
 * input is first snapshotted from own data properties; the snapshot is then
 * minimized back into a Skills input, rebuilt by the source planner, and
 * compared in full. Claims are validated but are not carried into continuity.
 */
export function validateSkillsYutabasePlan(
  value: unknown,
): Readonly<SkillsYutabasePlan> {
  const snapshot = record(
    snapshotData(value, "plan_invalid", "$plan"),
    "$plan",
    "plan_invalid",
  );
  const cards = array(snapshot.cards, "$plan.cards", "plan_invalid");
  if (cards.length < 2 || cards.length > 129) {
    fail("plan_invalid", "$plan.cards must contain one inspection and 1-128 snapshots");
  }
  const inspection = record(cards[0], "$plan.cards[0]", "plan_invalid");
  const inspectionFields = record(
    inspection.fields,
    "$plan.cards[0].fields",
    "plan_invalid",
  );
  const inspectionClaim = record(
    inspection.claim,
    "$plan.cards[0].claim",
    "plan_invalid",
  );

  const skills: MinimizedSkillSnapshot[] = cards.slice(1).map((entry, index) => {
    const card = record(entry, `$plan.cards[${String(index + 1)}]`, "plan_invalid");
    const fields = record(
      card.fields,
      `$plan.cards[${String(index + 1)}].fields`,
      "plan_invalid",
    );
    return {
      name: text(fields.name, `${String(index)}.name`, "plan_invalid"),
      content_digest: text(
        fields.content_digest,
        `${String(index)}.content_digest`,
        "plan_invalid",
      ),
      file_count: integer(fields.file_count, `${String(index)}.file_count`, "plan_invalid"),
      script_count: integer(
        fields.script_count,
        `${String(index)}.script_count`,
        "plan_invalid",
      ),
      resource_count: integer(
        fields.resource_count,
        `${String(index)}.resource_count`,
        "plan_invalid",
      ),
    };
  });

  const sourceReportDigest = text(
    snapshot.source_report_digest,
    "$plan.source_report_digest",
    "plan_invalid",
  );
  const input: SkillsYutabaseInput = {
    $schema: INPUT_SCHEMA_ID,
    protocol: INPUT_PROTOCOL,
    project_id: text(
      inspectionFields.project_id,
      "$plan.cards[0].fields.project_id",
      "plan_invalid",
    ),
    recorded_at: text(
      inspectionClaim.at,
      "$plan.cards[0].claim.at",
      "plan_invalid",
    ),
    source: {
      kind: INSPECTION_KIND,
      report_schema: INSPECTION_SCHEMA_ID,
      report_schema_version: INSPECTION_SCHEMA_VERSION,
      report_digest: sourceReportDigest,
      report_digest_semantics: REPORT_DIGEST_SEMANTICS,
      report_valid: true,
      inspector_name: INSPECTOR_NAME,
      inspector_version: text(
        inspectionFields.inspector_version,
        "$plan.cards[0].fields.inspector_version",
        "plan_invalid",
      ),
      inspector_revision: text(
        inspectionFields.inspector_revision,
        "$plan.cards[0].fields.inspector_revision",
        "plan_invalid",
      ),
      mode: "read-only",
    },
    selection_summary: {
      skills: skills.length,
      files: checkedSum(skills.map((skill) => skill.file_count), "file count"),
      scripts: checkedSum(skills.map((skill) => skill.script_count), "script count"),
      resources: checkedSum(
        skills.map((skill) => skill.resource_count),
        "resource count",
      ),
      errors: 0,
      warnings: integer(
        inspectionFields.warning_count,
        "$plan.cards[0].fields.warning_count",
        "plan_invalid",
      ),
      redactions: integer(
        inspectionFields.redaction_count,
        "$plan.cards[0].fields.redaction_count",
        "plan_invalid",
      ),
    },
    skills,
    authority: { automatic_action: "never", grants: [] },
  };

  let rebuilt: SkillsYutabasePlan;
  try {
    rebuilt = planSkillsInspection(input, {
      claimant: text(
        inspectionClaim.by,
        "$plan.cards[0].claim.by",
        "plan_invalid",
      ),
    });
  } catch (error) {
    fail(
      "plan_invalid",
      error instanceof Error
        ? `$plan cannot be rebuilt: ${error.message}`
        : "$plan cannot be rebuilt",
    );
  }
  const rebuiltSnapshot = snapshotData(rebuilt, "plan_invalid", "$rebuilt_plan");
  if (!isDeepStrictEqual(snapshot, rebuiltSnapshot)) {
    fail("plan_invalid", "$plan is not an exact Skills YUTABASE planner result");
  }
  return deepFreeze(rebuilt);
}
