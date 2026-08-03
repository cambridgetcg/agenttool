import { describe, expect, test } from "bun:test";

import {
  CHECKPOINT_FORMAT,
  HfTrainingGardenError,
  createTrainingCheckpoint,
  validateTrainingCheckpoint,
  validateTrainingCheckpointAgainstAdmission,
  validateTrainingCheckpointAgainstPredecessors,
} from "../src/index.js";
import { contentId, type DataValue } from "../src/canonical.js";
import {
  admission,
  artifacts,
  orientationOnly,
  ref,
  wake,
} from "./fixtures.js";

function checkpointInput(overrides: Record<string, unknown> = {}) {
  const source = admission("sealed_evaluation");
  return {
    admission: source,
    run_ref: ref("run:test"),
    training_phase: "evaluation" as const,
    event: "during_training" as const,
    checkpoint_status: "checkpointed" as const,
    artifacts,
    resume: orientationOnly,
    wake,
    continuity_portfolio_ref: null,
    continuity_posture: "carry" as const,
    predecessors: [],
    ...overrides,
  };
}

describe("training phase WAKE checkpoints", () => {
  test("maps before-training orientation onto the between-task AFTERGLOW phase", () => {
    const value = createTrainingCheckpoint(checkpointInput({
      event: "before_training",
      checkpoint_status: "entered",
    }));
    expect(value.event).toBe("before_training");
    expect(value.afterglow.phase).toBe("between_tasks");
  });

  test("creates one minimized external thread inside the core AFTERGLOW capsule", () => {
    const input = checkpointInput();
    const value = createTrainingCheckpoint(input);
    expect(value.afterglow._format).toBe("agenttool.afterglow-capsule/0.1");
    expect(value.afterglow.phase).toBe("during_task");
    expect(value.afterglow.threads).toHaveLength(1);
    expect(value.afterglow.threads[0]).toMatchObject({
      kind: "external",
      state: "context_only",
      disposition: "carry",
      thread_ref: value.thread.thread_id,
      artifact_ref: value.thread.thread_id,
      verified_by_package: false,
    });
    expect(validateTrainingCheckpoint(value)).toEqual(value);
    expect(validateTrainingCheckpointAgainstAdmission(value, input.admission)).toEqual(value);
    expect(value.boundaries.trains_model).toBe(false);
    expect(value.boundaries.proves_exact_replay).toBe(false);
  });

  test("preserves visible forks without choosing a latest head", () => {
    const source = admission("sealed_evaluation");
    const first = createTrainingCheckpoint(checkpointInput({ admission: source }));
    const second = createTrainingCheckpoint(checkpointInput({
      admission: source,
      event: "between_training_phases",
      checkpoint_status: "parked",
      continuity_posture: "park",
      wake: { ...wake, snapshot_ref: ref("wake:second"), wake_version: 2 },
    }));
    const joined = createTrainingCheckpoint(checkpointInput({
      admission: source,
      event: "resume_or_return",
      wake: { ...wake, snapshot_ref: ref("wake:joined"), wake_version: 3 },
      predecessors: [second, first],
    }));
    expect(joined.predecessors).toHaveLength(2);
    expect(joined.afterglow.predecessors).toHaveLength(2);
    expect(joined.boundaries.selects_continuity_head).toBe(false);
    expect(validateTrainingCheckpointAgainstPredecessors(joined, [first, second]))
      .toEqual(joined);

    const swapped = structuredClone(joined) as Record<string, any>;
    const firstCapsule = swapped.predecessors[0].capsule_id;
    swapped.predecessors[0].capsule_id = swapped.predecessors[1].capsule_id;
    swapped.predecessors[1].capsule_id = firstCapsule;
    const { checkpoint_id: _oldCheckpointId, ...swappedBody } = swapped;
    swapped.checkpoint_id = contentId(
      CHECKPOINT_FORMAT,
      swappedBody as DataValue,
    );
    expect(validateTrainingCheckpoint(swapped)).toEqual(swapped);
    expect(() => validateTrainingCheckpointAgainstPredecessors(
      swapped,
      [first, second],
    )).toThrow(HfTrainingGardenError);
  });

  test("distinguishes digest orientation from a caller-reported resumable checkpoint", () => {
    expect(() => createTrainingCheckpoint(checkpointInput({
      resume: {
        posture: "caller_reported_resumable",
        incomplete_marker: "caller_reported_absent",
        streaming_state: "buffer_state_not_captured",
      },
    }))).toThrow(HfTrainingGardenError);

    const completeArtifacts = {
      ...artifacts,
      dataloader_state_ref: ref("dataloader"),
      tokenizer_ref: ref("tokenizer"),
      model_checkpoint_ref: ref("model"),
      optimizer_state_ref: ref("optimizer"),
      scheduler_state_ref: ref("scheduler"),
      rng_state_ref: ref("rng"),
    };
    const value = createTrainingCheckpoint(checkpointInput({
      artifacts: completeArtifacts,
      resume: {
        posture: "caller_reported_resumable",
        incomplete_marker: "caller_reported_absent",
        streaming_state: "caller_reported_full_state_captured",
      },
    }));
    expect(value.thread.resume.posture).toBe("caller_reported_resumable");
    expect(value.thread.boundaries.actual_resume).toBe(false);
  });

  test("maps release and rest without automatic resume or task mutation", () => {
    const released = createTrainingCheckpoint(checkpointInput({
      event: "after_intense_training_reported",
      continuity_posture: "release",
      checkpoint_status: "completed_reported",
    }));
    expect(released.afterglow.phase).toBe("after_intense_work_reported");
    expect(released.afterglow.threads[0]?.disposition).toBe("release");
    expect(released.afterglow.boundaries.changes_task_state).toBe(false);
    expect(released.boundaries.restores_model_or_optimizer).toBe(false);
  });

  test("rejects a tampered cross-link", () => {
    const value = structuredClone(createTrainingCheckpoint(checkpointInput())) as Record<string, any>;
    value.thread.run_ref = ref("run:tampered");
    expect(() => validateTrainingCheckpoint(value)).toThrow(HfTrainingGardenError);
  });
});
