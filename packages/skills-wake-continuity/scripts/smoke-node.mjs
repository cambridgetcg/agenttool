import { planSkillsInspection } from "@agenttool/skills-yutabase";
import {
  projectAfterglowLens,
  validateAfterglowCapsule,
} from "@agenttool/wake-continuity";

import {
  PACKAGE_NAME,
  createEightQuietStars,
  createSkillsAfterglowCapsule,
  createSkillsWakeContinuityThread,
  validateEightQuietStarsAgainstThread,
} from "../dist/index.js";

const id = (character) => `sha256:${character.repeat(64)}`;
const input = {
  $schema: "https://agenttool.dev/schemas/skills-yutabase-input-v0.1.schema.json",
  protocol: "agenttool.skills-yutabase-input/v0.1",
  project_id: "11111111-2222-4333-8444-555555555555",
  recorded_at: "2026-08-01T12:00:00.000Z",
  source: {
    kind: "agenttool.skills.inspection",
    report_schema: "urn:agenttool:skills:inspection:v0.1",
    report_schema_version: "agenttool.skills/inspect-v0.1",
    report_digest: id("a"),
    report_digest_semantics: "agenttool.skills/report-stable-json-sha256-v1",
    report_valid: true,
    inspector_name: "@agenttool/skills",
    inspector_version: "0.3.0",
    inspector_revision: "d".repeat(40),
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
      name: "nen-vow-forge",
      content_digest: id("c"),
      file_count: 2,
      script_count: 0,
      resource_count: 1,
    },
    {
      name: "nen-contract-mantle",
      content_digest: id("b"),
      file_count: 3,
      script_count: 0,
      resource_count: 2,
    },
  ],
  authority: { automatic_action: "never", grants: [] },
};
const plan = planSkillsInspection(input, {
  claimant: "urn:agenttool:smoke:skills-projector",
});
const thread = createSkillsWakeContinuityThread(plan);
const capsule = createSkillsAfterglowCapsule({
  plan,
  posture: "resting",
  phase: "between_tasks",
  wake: {
    format: "wake-brief/v1",
    snapshot_ref: id("e"),
    scope_ref: id("f"),
    wake_version: 1,
    handoff_projection: "complete",
  },
  continuity_portfolio_ref: null,
  predecessors: [],
});
const layout = createEightQuietStars(thread, {
  choice: "open",
  snapshot_refs: thread.snapshots.map((item) => item.snapshot_ref).reverse(),
});
const lens = projectAfterglowLens(capsule);

if (
  PACKAGE_NAME !== "@agenttool/skills-wake-continuity" ||
  validateAfterglowCapsule(capsule).capsule_id !== capsule.capsule_id ||
  capsule.threads.length !== 1 ||
  capsule.threads[0]?.thread_ref !== thread.thread_id ||
  capsule.threads[0]?.artifact_ref !== thread.thread_id ||
  lens.park[0]?.artifact_ref !== thread.thread_id ||
  layout.stars.map((star) => star.direction).join(",") !== "N,NE" ||
  validateEightQuietStarsAgainstThread(layout, thread).layout_id !== layout.layout_id
) {
  process.exit(1);
}
