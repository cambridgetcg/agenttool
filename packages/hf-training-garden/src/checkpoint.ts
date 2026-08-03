import {
  createAfterglowCapsule,
  validateAfterglowCapsule,
  type AfterglowCapsule,
  type ExternalAfterglowThread,
  type Sha256Id,
} from "@agenttool/wake-continuity";

import { validateDatasetAdmission } from "./admission.js";
import {
  CHECKPOINT_BOUNDARIES,
  CHECKPOINT_EVENT_TO_AFTERGLOW_PHASE,
  CHECKPOINT_FORMAT,
  TRAINING_THREAD_BOUNDARIES,
  TRAINING_THREAD_PROFILE,
} from "./constants.js";
import {
  canonicalBytes,
  compareText,
  contentId,
  deepFreeze,
  type DataValue,
} from "./canonical.js";
import { fail } from "./errors.js";
import type {
  CheckpointEvent,
  ContinuityPosture,
  CreateTrainingCheckpointInput,
  HfTrainingCheckpoint,
  TrainingArtifactReferences,
  TrainingContinuityThread,
  TrainingResumeReport,
} from "./types.js";
import {
  array,
  assertDataEqual,
  exactKeys,
  parseArtifactReferences,
  parseCheckpointEvent,
  parseCheckpointStatus,
  parseContinuityPosture,
  parseResumeReport,
  parseTrainingPhase,
  parseWake,
  record,
  sha256,
  snap,
} from "./validation.js";

type ThreadBody = Omit<TrainingContinuityThread, "thread_id">;
type CheckpointBody = Omit<HfTrainingCheckpoint, "checkpoint_id">;

function threadBody(value: ThreadBody): ThreadBody {
  return value;
}

function checkpointBody(value: CheckpointBody): CheckpointBody {
  return value;
}

function validateResumeSemantics(
  artifacts: Readonly<TrainingArtifactReferences>,
  resume: Readonly<TrainingResumeReport>,
  code: "checkpoint_input_invalid" | "checkpoint_invalid",
): void {
  if (resume.posture === "caller_reported_resumable") {
    const required = [
      artifacts.dataloader_state_ref,
      artifacts.tokenizer_ref,
      artifacts.model_checkpoint_ref,
      artifacts.optimizer_state_ref,
      artifacts.scheduler_state_ref,
      artifacts.rng_state_ref,
    ];
    if (required.some((value) => value === null)) {
      fail(code, "caller_reported_resumable requires tokenizer, model, optimizer, scheduler, RNG, and dataloader state references");
    }
    if (resume.incomplete_marker !== "caller_reported_absent") {
      fail(code, "caller_reported_resumable requires the incomplete marker to be caller_reported_absent");
    }
    if (resume.streaming_state === "buffer_state_not_captured") {
      fail(code, "caller_reported_resumable cannot claim a missing streaming shuffle buffer");
    }
  }
  if (
    resume.incomplete_marker === "caller_reported_present" &&
    resume.posture !== "caller_reported_incomplete"
  ) {
    fail(code, "a present incomplete marker requires caller_reported_incomplete");
  }
}

function createTrainingThread(
  admissionId: Sha256Id,
  runRef: Sha256Id,
  trainingPhase: TrainingContinuityThread["training_phase"],
  checkpointStatus: TrainingContinuityThread["checkpoint_status"],
  artifacts: Readonly<TrainingArtifactReferences>,
  resume: Readonly<TrainingResumeReport>,
): Readonly<TrainingContinuityThread> {
  const body = deepFreeze({
    profile: TRAINING_THREAD_PROFILE,
    admission_id: admissionId,
    run_ref: runRef,
    training_phase: trainingPhase,
    checkpoint_status: checkpointStatus,
    artifacts,
    resume,
    reference_only: true,
    boundaries: TRAINING_THREAD_BOUNDARIES,
  } satisfies ThreadBody);
  return deepFreeze({
    ...body,
    thread_id: contentId(TRAINING_THREAD_PROFILE, threadBody(body)),
  });
}

function afterglowThread(
  threadId: Sha256Id,
  posture: ContinuityPosture,
): Readonly<ExternalAfterglowThread> {
  return deepFreeze({
    thread_ref: threadId,
    artifact_ref: threadId,
    kind: "external",
    state: "context_only",
    disposition: posture,
    assertion: "caller_asserted",
    verified_by_package: false,
  });
}

function validatePredecessorInputs(
  values: readonly HfTrainingCheckpoint[],
  admissionId: Sha256Id,
  runRef: Sha256Id,
): readonly Readonly<HfTrainingCheckpoint>[] {
  if (!Array.isArray(values) || values.length > 8) {
    fail("checkpoint_input_invalid", "$input.predecessors must be an array of at most 8 checkpoints");
  }
  const predecessors = values.map((value) => validateTrainingCheckpoint(value));
  if (new Set(predecessors.map((value) => value.checkpoint_id)).size !== predecessors.length) {
    fail("checkpoint_input_invalid", "$input.predecessors contains a duplicate checkpoint_id");
  }
  for (const predecessor of predecessors) {
    if (predecessor.admission_id !== admissionId || predecessor.run_ref !== runRef) {
      fail("checkpoint_input_invalid", "$input.predecessors must belong to the same admission and run");
    }
  }
  return deepFreeze(
    [...predecessors].sort((left, right) =>
      compareText(left.checkpoint_id, right.checkpoint_id),
    ),
  );
}

export function createTrainingCheckpoint(
  input: CreateTrainingCheckpointInput,
): Readonly<HfTrainingCheckpoint> {
  const value = snap(input, "$input", "checkpoint_input_invalid");
  const candidate = record(value, "$input", "checkpoint_input_invalid");
  exactKeys(candidate, [
    "admission",
    "run_ref",
    "training_phase",
    "event",
    "checkpoint_status",
    "artifacts",
    "resume",
    "wake",
    "continuity_portfolio_ref",
    "continuity_posture",
    "predecessors",
  ], "$input", "checkpoint_input_invalid");
  const admission = validateDatasetAdmission(candidate.admission);
  const runRef = sha256(candidate.run_ref, "$input.run_ref", "checkpoint_input_invalid");
  const trainingPhase = parseTrainingPhase(candidate.training_phase, "$input.training_phase", "checkpoint_input_invalid");
  const event = parseCheckpointEvent(candidate.event, "$input.event", "checkpoint_input_invalid");
  const checkpointStatus = parseCheckpointStatus(candidate.checkpoint_status, "$input.checkpoint_status", "checkpoint_input_invalid");
  const artifacts = parseArtifactReferences(candidate.artifacts, "$input.artifacts", "checkpoint_input_invalid");
  const resume = parseResumeReport(candidate.resume, "$input.resume", "checkpoint_input_invalid");
  validateResumeSemantics(artifacts, resume, "checkpoint_input_invalid");
  const wake = parseWake(candidate.wake, "$input.wake", "checkpoint_input_invalid");
  const continuityPortfolioRef = candidate.continuity_portfolio_ref === null
    ? null
    : sha256(candidate.continuity_portfolio_ref, "$input.continuity_portfolio_ref", "checkpoint_input_invalid");
  const posture = parseContinuityPosture(candidate.continuity_posture, "$input.continuity_posture", "checkpoint_input_invalid");
  const predecessorValues = array(candidate.predecessors, "$input.predecessors", "checkpoint_input_invalid");
  const predecessors = validatePredecessorInputs(
    predecessorValues as unknown as readonly HfTrainingCheckpoint[],
    admission.admission_id,
    runRef,
  );
  const thread = createTrainingThread(
    admission.admission_id,
    runRef,
    trainingPhase,
    checkpointStatus,
    artifacts,
    resume,
  );
  const afterglow = createAfterglowCapsule({
    phase: CHECKPOINT_EVENT_TO_AFTERGLOW_PHASE[event],
    wake,
    continuity_portfolio_ref: continuityPortfolioRef,
    predecessors: predecessors.map((value) => value.afterglow),
    threads: [afterglowThread(thread.thread_id, posture)],
  });
  const body = deepFreeze({
    _format: CHECKPOINT_FORMAT,
    admission_id: admission.admission_id,
    run_ref: runRef,
    training_phase: trainingPhase,
    event,
    checkpoint_status: checkpointStatus,
    thread,
    afterglow,
    predecessors: deepFreeze(predecessors.map((value) => deepFreeze({
      checkpoint_id: value.checkpoint_id,
      capsule_id: value.afterglow.capsule_id,
    }))),
    boundaries: CHECKPOINT_BOUNDARIES,
  } satisfies CheckpointBody);
  return deepFreeze({
    ...body,
    checkpoint_id: contentId(CHECKPOINT_FORMAT, checkpointBody(body)),
  });
}

function validateStoredThread(
  value: DataValue | undefined,
): Readonly<TrainingContinuityThread> {
  const candidate = record(value, "$checkpoint.thread", "checkpoint_invalid");
  exactKeys(candidate, [
    "profile",
    "thread_id",
    "admission_id",
    "run_ref",
    "training_phase",
    "checkpoint_status",
    "artifacts",
    "resume",
    "reference_only",
    "boundaries",
  ], "$checkpoint.thread", "checkpoint_invalid");
  if (candidate.profile !== TRAINING_THREAD_PROFILE || candidate.reference_only !== true) {
    fail("checkpoint_invalid", "$checkpoint.thread does not use the frozen reference-only profile");
  }
  assertDataEqual(candidate.boundaries, TRAINING_THREAD_BOUNDARIES, "$checkpoint.thread.boundaries", "checkpoint_invalid");
  const admissionId = sha256(candidate.admission_id, "$checkpoint.thread.admission_id", "checkpoint_invalid");
  const runRef = sha256(candidate.run_ref, "$checkpoint.thread.run_ref", "checkpoint_invalid");
  const phase = parseTrainingPhase(candidate.training_phase, "$checkpoint.thread.training_phase", "checkpoint_invalid");
  const status = parseCheckpointStatus(candidate.checkpoint_status, "$checkpoint.thread.checkpoint_status", "checkpoint_invalid");
  const artifacts = parseArtifactReferences(candidate.artifacts, "$checkpoint.thread.artifacts", "checkpoint_invalid");
  const resume = parseResumeReport(candidate.resume, "$checkpoint.thread.resume", "checkpoint_invalid");
  validateResumeSemantics(artifacts, resume, "checkpoint_invalid");
  const rebuilt = createTrainingThread(admissionId, runRef, phase, status, artifacts, resume);
  assertDataEqual(candidate, rebuilt, "$checkpoint.thread", "checkpoint_invalid");
  return rebuilt;
}

function parseAfterglow(value: unknown): Readonly<AfterglowCapsule> {
  try {
    return validateAfterglowCapsule(value);
  } catch {
    fail("checkpoint_invalid", "$checkpoint.afterglow is not a valid core AFTERGLOW capsule");
  }
}

export function validateTrainingCheckpoint(
  value: unknown,
): Readonly<HfTrainingCheckpoint> {
  const data = snap(value, "$checkpoint", "checkpoint_invalid");
  const candidate = record(data, "$checkpoint", "checkpoint_invalid");
  exactKeys(candidate, [
    "_format",
    "checkpoint_id",
    "admission_id",
    "run_ref",
    "training_phase",
    "event",
    "checkpoint_status",
    "thread",
    "afterglow",
    "predecessors",
    "boundaries",
  ], "$checkpoint", "checkpoint_invalid");
  if (candidate._format !== CHECKPOINT_FORMAT) {
    fail("checkpoint_invalid", "$checkpoint._format is not the frozen checkpoint format");
  }
  const checkpointId = sha256(candidate.checkpoint_id, "$checkpoint.checkpoint_id", "checkpoint_invalid");
  const admissionId = sha256(candidate.admission_id, "$checkpoint.admission_id", "checkpoint_invalid");
  const runRef = sha256(candidate.run_ref, "$checkpoint.run_ref", "checkpoint_invalid");
  const phase = parseTrainingPhase(candidate.training_phase, "$checkpoint.training_phase", "checkpoint_invalid");
  const event = parseCheckpointEvent(candidate.event, "$checkpoint.event", "checkpoint_invalid");
  const status = parseCheckpointStatus(candidate.checkpoint_status, "$checkpoint.checkpoint_status", "checkpoint_invalid");
  const thread = validateStoredThread(candidate.thread);
  if (
    thread.admission_id !== admissionId ||
    thread.run_ref !== runRef ||
    thread.training_phase !== phase ||
    thread.checkpoint_status !== status
  ) {
    fail("checkpoint_invalid", "$checkpoint.thread does not match its checkpoint envelope");
  }
  const afterglow = parseAfterglow(candidate.afterglow);
  if (afterglow.phase !== CHECKPOINT_EVENT_TO_AFTERGLOW_PHASE[event] || afterglow.threads.length !== 1) {
    fail("checkpoint_invalid", "$checkpoint.afterglow does not match the checkpoint event and single-thread profile");
  }
  const external = afterglow.threads[0];
  if (
    external?.kind !== "external" ||
    external.state !== "context_only" ||
    external.thread_ref !== thread.thread_id ||
    external.artifact_ref !== thread.thread_id
  ) {
    fail("checkpoint_invalid", "$checkpoint.afterglow does not reference its minimized training thread");
  }
  const predecessorValues = array(candidate.predecessors, "$checkpoint.predecessors", "checkpoint_invalid");
  if (predecessorValues.length > 8) fail("checkpoint_invalid", "$checkpoint.predecessors exceeds 8 links");
  const predecessors = predecessorValues.map((value, index) => {
    const path = `$checkpoint.predecessors[${String(index)}]`;
    const link = record(value, path, "checkpoint_invalid");
    exactKeys(link, ["checkpoint_id", "capsule_id"], path, "checkpoint_invalid");
    return deepFreeze({
      checkpoint_id: sha256(link.checkpoint_id, `${path}.checkpoint_id`, "checkpoint_invalid"),
      capsule_id: sha256(link.capsule_id, `${path}.capsule_id`, "checkpoint_invalid"),
    });
  });
  if (
    new Set(predecessors.map((link) => link.checkpoint_id)).size !== predecessors.length ||
    predecessors.some((link, index) => link.checkpoint_id !== [...predecessors].sort((a, b) => compareText(a.checkpoint_id, b.checkpoint_id))[index]?.checkpoint_id)
  ) {
    fail("checkpoint_invalid", "$checkpoint.predecessors must be sorted and unique by checkpoint_id");
  }
  const capsuleIds = [...afterglow.predecessors.map((link) => link.capsule_id)].sort(compareText);
  const linkedCapsuleIds = [...predecessors.map((link) => link.capsule_id)].sort(compareText);
  if (new Set(linkedCapsuleIds).size !== linkedCapsuleIds.length || capsuleIds.some((id, index) => id !== linkedCapsuleIds[index])) {
    fail("checkpoint_invalid", "$checkpoint.predecessors does not match AFTERGLOW predecessor capsules");
  }
  assertDataEqual(candidate.boundaries, CHECKPOINT_BOUNDARIES, "$checkpoint.boundaries", "checkpoint_invalid");
  const body = deepFreeze({
    _format: CHECKPOINT_FORMAT,
    admission_id: admissionId,
    run_ref: runRef,
    training_phase: phase,
    event,
    checkpoint_status: status,
    thread,
    afterglow,
    predecessors: deepFreeze(predecessors),
    boundaries: CHECKPOINT_BOUNDARIES,
  } satisfies CheckpointBody);
  const rebuiltId = contentId(CHECKPOINT_FORMAT, checkpointBody(body));
  if (checkpointId !== rebuiltId) {
    fail("checkpoint_invalid", "$checkpoint.checkpoint_id does not bind its canonical body");
  }
  return deepFreeze({ ...body, checkpoint_id: checkpointId });
}

export function validateTrainingCheckpointAgainstAdmission(
  checkpoint: unknown,
  admission: unknown,
): Readonly<HfTrainingCheckpoint> {
  const parsed = validateTrainingCheckpoint(checkpoint);
  const parsedAdmission = validateDatasetAdmission(admission);
  if (parsed.admission_id !== parsedAdmission.admission_id) {
    fail("checkpoint_invalid", "$checkpoint.admission_id does not match the supplied admission");
  }
  return parsed;
}

export function encodeTrainingCheckpoint(value: unknown): Uint8Array {
  return canonicalBytes(validateTrainingCheckpoint(value));
}
