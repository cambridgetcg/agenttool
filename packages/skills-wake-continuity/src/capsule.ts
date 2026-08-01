import {
  createAfterglowCapsule,
  type AfterglowCapsule,
  type AfterglowPhase,
  type ExternalAfterglowThread,
  type Sha256Id,
  type WakeBriefAnchor,
} from "@agenttool/wake-continuity";

import {
  POSTURE_TO_DISPOSITION,
  SKILLS_CONTINUITY_POSTURES,
} from "./constants.js";
import { fail } from "./errors.js";
import { createSkillsWakeContinuityThread } from "./thread.js";
import type {
  CreateSkillsAfterglowCapsuleInput,
  SkillsContinuityPosture,
} from "./types.js";
import { deepFreeze, ownDataRecord, snapshotData } from "./validation.js";

function posture(value: unknown): SkillsContinuityPosture {
  if (
    typeof value !== "string" ||
    !(SKILLS_CONTINUITY_POSTURES as readonly string[]).includes(value)
  ) {
    fail(
      "capsule_input_invalid",
      `$posture must be one of: ${SKILLS_CONTINUITY_POSTURES.join(", ")}`,
    );
  }
  return value as SkillsContinuityPosture;
}

export function createSkillsAfterglowThread(
  plan: unknown,
  reportedPosture: SkillsContinuityPosture,
): Readonly<ExternalAfterglowThread> {
  const thread = createSkillsWakeContinuityThread(plan);
  const parsedPosture = posture(reportedPosture);
  return deepFreeze({
    thread_ref: thread.thread_id,
    artifact_ref: thread.thread_id,
    kind: "external",
    state: "context_only",
    disposition: POSTURE_TO_DISPOSITION[parsedPosture],
    assertion: "caller_asserted",
    verified_by_package: false,
  });
}

/** Returns the accepted core capsule directly; no adapter envelope is added. */
export function createSkillsAfterglowCapsule(
  input: CreateSkillsAfterglowCapsuleInput,
): Readonly<AfterglowCapsule> {
  const candidate = ownDataRecord(
    input,
    [
      "phase",
      "wake",
      "continuity_portfolio_ref",
      "predecessors",
      "plan",
      "posture",
    ],
    "$input",
    "capsule_input_invalid",
  );
  const parsedPosture = posture(candidate.posture);
  const thread = createSkillsAfterglowThread(candidate.plan, parsedPosture);
  const phase = snapshotData(
    candidate.phase,
    "capsule_input_invalid",
    "$input.phase",
  );
  const wake = snapshotData(
    candidate.wake,
    "capsule_input_invalid",
    "$input.wake",
  );
  const continuityPortfolioRef = snapshotData(
    candidate.continuity_portfolio_ref,
    "capsule_input_invalid",
    "$input.continuity_portfolio_ref",
  );
  const predecessors = snapshotData(
    candidate.predecessors,
    "capsule_input_invalid",
    "$input.predecessors",
  );
  return createAfterglowCapsule({
    phase: phase as AfterglowPhase,
    wake: wake as unknown as WakeBriefAnchor,
    continuity_portfolio_ref: continuityPortfolioRef as Sha256Id | null,
    predecessors: predecessors as unknown as readonly AfterglowCapsule[],
    threads: [thread],
  });
}
