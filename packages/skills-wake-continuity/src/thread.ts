import {
  PLAN_PROFILE,
  type SkillsYutabasePlan,
} from "@agenttool/skills-yutabase";
import {
  domainSeparatedId,
  type Sha256Id,
} from "@agenttool/wake-continuity";

import {
  SKILLS_THREAD_BOUNDARIES,
  SKILLS_WAKE_THREAD_PROFILE,
} from "./constants.js";
import { fail } from "./errors.js";
import { validateSkillsYutabasePlan } from "./plan.js";
import type {
  SkillsWakeContinuitySnapshot,
  SkillsWakeContinuityThread,
} from "./types.js";
import {
  array,
  assertDataEqual,
  deepFreeze,
  exactKeys,
  integer,
  record,
  revision,
  sha256,
  snapshotData,
  text,
  yutabaseRef,
} from "./validation.js";

type ThreadBody = Omit<SkillsWakeContinuityThread, "thread_id">;
type PlanCard = SkillsYutabasePlan["cards"][number];
type InspectionCard = Extract<PlanCard, { readonly address: { readonly deck: "inspections" } }>;
type SkillSnapshotCard = Extract<
  PlanCard,
  { readonly address: { readonly deck: "skill_snapshots" } }
>;

function bodyOf(thread: SkillsWakeContinuityThread): ThreadBody {
  const { thread_id: _threadId, ...body } = thread;
  return body;
}

function inspectionCard(plan: Readonly<SkillsYutabasePlan>): InspectionCard {
  const card = plan.cards[0];
  if (!card || card.address.deck !== "inspections") {
    fail("plan_invalid", "$plan must begin with its inspection card");
  }
  return card as InspectionCard;
}

export function createSkillsWakeContinuityThread(
  value: unknown,
): Readonly<SkillsWakeContinuityThread> {
  const plan = validateSkillsYutabasePlan(value);
  const inspection = inspectionCard(plan);
  const snapshots = plan.cards.slice(1).map((card) => {
    if (card.address.deck !== "skill_snapshots") {
      fail("plan_invalid", "$plan contains a non-snapshot card after its inspection");
    }
    const snapshotCard = card as SkillSnapshotCard;
    return deepFreeze({
      snapshot_ref: snapshotCard.address.ref,
      content_digest: snapshotCard.fields.content_digest as Sha256Id,
    });
  }).sort((left, right) =>
    left.snapshot_ref < right.snapshot_ref
      ? -1
      : left.snapshot_ref > right.snapshot_ref
        ? 1
        : 0,
  );
  const body = deepFreeze({
    profile: SKILLS_WAKE_THREAD_PROFILE,
    plan_profile: PLAN_PROFILE,
    inspection_ref: inspection.address.ref,
    report_digest: plan.source_report_digest as Sha256Id,
    selection_digest: plan.selection_digest as Sha256Id,
    inspector_revision: inspection.fields.inspector_revision,
    selected_skill_count: snapshots.length,
    snapshots: deepFreeze(snapshots),
    reference_only: true,
    boundaries: SKILLS_THREAD_BOUNDARIES,
  } satisfies ThreadBody);
  return deepFreeze({
    ...body,
    thread_id: domainSeparatedId(SKILLS_WAKE_THREAD_PROFILE, body),
  });
}

export function validateSkillsWakeContinuityThread(
  value: unknown,
): Readonly<SkillsWakeContinuityThread> {
  const candidate = record(
    snapshotData(value, "thread_invalid", "$thread"),
    "$thread",
    "thread_invalid",
  );
  exactKeys(
    candidate,
    [
      "profile",
      "thread_id",
      "plan_profile",
      "inspection_ref",
      "report_digest",
      "selection_digest",
      "inspector_revision",
      "selected_skill_count",
      "snapshots",
      "reference_only",
      "boundaries",
    ],
    "$thread",
    "thread_invalid",
  );
  if (candidate.profile !== SKILLS_WAKE_THREAD_PROFILE) {
    fail("thread_invalid", "$thread.profile is not the frozen v0.1 profile");
  }
  if (candidate.plan_profile !== PLAN_PROFILE) {
    fail("thread_invalid", "$thread.plan_profile is not the Skills v0.1 plan");
  }
  if (candidate.reference_only !== true) {
    fail("thread_invalid", "$thread.reference_only must be true");
  }
  assertDataEqual(
    candidate.boundaries,
    SKILLS_THREAD_BOUNDARIES,
    "$thread.boundaries",
    "thread_invalid",
  );
  const values = array(candidate.snapshots, "$thread.snapshots", "thread_invalid");
  if (values.length < 1 || values.length > 128) {
    fail("thread_invalid", "$thread.snapshots must contain 1-128 references");
  }
  const snapshots: SkillsWakeContinuitySnapshot[] = values.map((value, index) => {
    const path = `$thread.snapshots[${String(index)}]`;
    const entry = record(value, path, "thread_invalid");
    exactKeys(entry, ["snapshot_ref", "content_digest"], path, "thread_invalid");
    return deepFreeze({
      snapshot_ref: yutabaseRef(
        entry.snapshot_ref,
        "skill_snapshots",
        `${path}.snapshot_ref`,
        "thread_invalid",
      ),
      content_digest: sha256(
        entry.content_digest,
        `${path}.content_digest`,
        "thread_invalid",
      ),
    });
  });
  if (new Set(snapshots.map((entry) => entry.snapshot_ref)).size !== snapshots.length) {
    fail("thread_invalid", "$thread.snapshots has a duplicate snapshot_ref");
  }
  const sorted = [...snapshots].sort((left, right) =>
    left.snapshot_ref < right.snapshot_ref
      ? -1
      : left.snapshot_ref > right.snapshot_ref
        ? 1
        : 0,
  );
  if (snapshots.some((entry, index) => entry.snapshot_ref !== sorted[index]?.snapshot_ref)) {
    fail("thread_invalid", "$thread.snapshots must be sorted by snapshot_ref");
  }
  const selectedSkillCount = integer(
    candidate.selected_skill_count,
    "$thread.selected_skill_count",
    "thread_invalid",
  );
  if (selectedSkillCount !== snapshots.length) {
    fail("thread_invalid", "$thread.selected_skill_count must equal snapshots.length");
  }
  const parsed = deepFreeze({
    profile: SKILLS_WAKE_THREAD_PROFILE,
    thread_id: sha256(candidate.thread_id, "$thread.thread_id", "thread_invalid"),
    plan_profile: PLAN_PROFILE,
    inspection_ref: yutabaseRef(
      candidate.inspection_ref,
      "inspections",
      "$thread.inspection_ref",
      "thread_invalid",
    ),
    report_digest: sha256(
      candidate.report_digest,
      "$thread.report_digest",
      "thread_invalid",
    ),
    selection_digest: sha256(
      candidate.selection_digest,
      "$thread.selection_digest",
      "thread_invalid",
    ),
    inspector_revision: revision(
      candidate.inspector_revision,
      "$thread.inspector_revision",
      "thread_invalid",
    ),
    selected_skill_count: selectedSkillCount,
    snapshots: deepFreeze(snapshots),
    reference_only: true,
    boundaries: SKILLS_THREAD_BOUNDARIES,
  } satisfies SkillsWakeContinuityThread);
  const expectedId = domainSeparatedId(SKILLS_WAKE_THREAD_PROFILE, bodyOf(parsed));
  if (parsed.thread_id !== expectedId) {
    fail("thread_invalid", "$thread.thread_id does not bind its minimized body");
  }
  return parsed;
}

export function validateSkillsWakeContinuityThreadAgainstPlan(
  thread: unknown,
  plan: unknown,
): Readonly<SkillsWakeContinuityThread> {
  const parsed = validateSkillsWakeContinuityThread(thread);
  const expected = createSkillsWakeContinuityThread(plan);
  assertDataEqual(parsed, expected, "$thread", "thread_invalid");
  return parsed;
}
