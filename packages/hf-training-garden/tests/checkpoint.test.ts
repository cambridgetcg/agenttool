import { describe, expect, test } from "bun:test";
import { domainSeparatedId } from "@agenttool/wake-continuity";

import {
  CHECKPOINT_FORMAT,
  HfTrainingGardenError,
  createTrainingCheckpoint,
  validateTrainingCheckpoint,
  validateTrainingCheckpointAgainstAdmission,
  validateTrainingCheckpointAgainstPredecessors,
} from "../src/index.js";
import {
  admission,
  artifacts,
  orientationOnly,
  participation,
  ref,
  wake,
} from "./fixtures.js";

function checkpointInput(overrides: Record<string, unknown> = {}) {
  const source = (overrides.admission ?? admission("sealed_evaluation")) as ReturnType<typeof admission>;
  const runRef = (overrides.run_ref ?? ref("run:test")) as ReturnType<typeof ref>;
  const phase = (overrides.training_phase ?? "evaluation") as "evaluation" | "pretraining";
  const wakeValue = (overrides.wake ?? wake) as typeof wake;
  const artifactValue = (overrides.artifacts ?? artifacts) as typeof artifacts;
  const predecessorValue = (overrides.predecessors ?? []) as readonly ReturnType<typeof createTrainingCheckpoint>[];
  return {
    admission: source,
    run_ref: runRef,
    training_phase: phase,
    event: "during_training" as const,
    checkpoint_status: "checkpointed" as const,
    participation: participation(source, {
      runRef,
      phase,
      wakeValue,
      artifactsValue: artifactValue,
      startingStateRef: predecessorValue[0]?.checkpoint_id,
    }),
    artifacts: artifactValue,
    resume: orientationOnly,
    wake: wakeValue,
    continuity_portfolio_ref: null,
    continuity_posture: "carry" as const,
    predecessors: predecessorValue,
    ...overrides,
  };
}

describe("training phase WAKE checkpoints", () => {
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
    expect(value.thread.participation_assessment_ref).toBe(
      value.participation.assessment_id,
    );
    expect(value.thread.wake_use_mode).toBe("context_only");
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
    expect(validateTrainingCheckpointAgainstPredecessors(joined, [second, first])).toEqual(joined);
    expect(() => validateTrainingCheckpointAgainstPredecessors(joined, [first])).toThrow(
      HfTrainingGardenError,
    );
  });

  test("requires supplied sources to reject a recomputed dangling predecessor link", () => {
    const source = admission("sealed_evaluation");
    const first = createTrainingCheckpoint(checkpointInput({ admission: source }));
    const second = createTrainingCheckpoint(checkpointInput({
      admission: source,
      wake: { ...wake, snapshot_ref: ref("wake:source-two"), wake_version: 2 },
    }));
    const joined = createTrainingCheckpoint(checkpointInput({
      admission: source,
      wake: { ...wake, snapshot_ref: ref("wake:source-join"), wake_version: 3 },
      predecessors: [second, first],
    }));
    const forged = structuredClone(joined) as Record<string, any>;
    const dangling = forged.predecessors.find(
      (link: Record<string, string>) =>
        link.checkpoint_id !== forged.participation.invitation.starting_state_ref,
    ) as Record<string, string>;
    dangling.checkpoint_id = ref("checkpoint:dangling");
    forged.predecessors.sort(
      (left: Record<string, string>, right: Record<string, string>) =>
        left.checkpoint_id.localeCompare(right.checkpoint_id),
    );
    const { checkpoint_id: _oldCheckpointId, ...body } = forged;
    forged.checkpoint_id = domainSeparatedId(CHECKPOINT_FORMAT, body);

    expect(validateTrainingCheckpoint(forged)).toEqual(forged);
    expect(() => validateTrainingCheckpointAgainstPredecessors(
      forged,
      [second, first],
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

  test("binds the full WAKE anchor rather than its snapshot ref alone", () => {
    const source = admission("sealed_evaluation");
    const exactParticipation = participation(source);
    expect(() => createTrainingCheckpoint(checkpointInput({
      admission: source,
      participation: exactParticipation,
      wake: { ...wake, scope_ref: ref("wake:other-scope") },
    }))).toThrow(HfTrainingGardenError);
  });

  test("binds a root invitation to the exact starting artifact portfolio", () => {
    const source = admission("sealed_evaluation");
    const invitedArtifacts = {
      ...artifacts,
      model_checkpoint_ref: ref("model:invited"),
      optimizer_state_ref: ref("optimizer:invited"),
    };
    const suppliedArtifacts = {
      ...invitedArtifacts,
      model_checkpoint_ref: ref("model:substituted"),
      optimizer_state_ref: ref("optimizer:substituted"),
    };
    expect(() => createTrainingCheckpoint(checkpointInput({
      admission: source,
      participation: participation(source, { artifactsValue: invitedArtifacts }),
      artifacts: suppliedArtifacts,
    }))).toThrow(HfTrainingGardenError);
  });

  test("rejects an unreviewed non-root base-state substitution", () => {
    const source = admission("sealed_evaluation");
    const first = createTrainingCheckpoint(checkpointInput({ admission: source }));
    const substituted = {
      ...artifacts,
      model_checkpoint_ref: ref("model:unreviewed-substitution"),
      optimizer_state_ref: ref("optimizer:unreviewed-substitution"),
    };
    expect(() => createTrainingCheckpoint(checkpointInput({
      admission: source,
      artifacts: substituted,
      participation: participation(source, { artifactsValue: substituted }),
      predecessors: [first],
    }))).toThrow(HfTrainingGardenError);
  });

  test("turns deferral into park and withdrawal into containment", () => {
    const source = admission("sealed_evaluation");
    const deferred = participation(source, { choice: "defer" });
    expect(() => createTrainingCheckpoint(checkpointInput({
      admission: source,
      participation: deferred,
    }))).toThrow(HfTrainingGardenError);
    const parked = createTrainingCheckpoint(checkpointInput({
      admission: source,
      participation: deferred,
      checkpoint_status: "parked",
      continuity_posture: "park",
    }));
    expect(parked.participation.training_action).toBe(
      "pause_before_next_optimizer_step",
    );

    const withdrawn = participation(source, { choice: "withdraw" });
    expect(() => createTrainingCheckpoint(checkpointInput({
      admission: source,
      participation: withdrawn,
      checkpoint_status: "parked",
      continuity_posture: "park",
    }))).toThrow(HfTrainingGardenError);
    const contained = createTrainingCheckpoint(checkpointInput({
      admission: source,
      participation: withdrawn,
      checkpoint_status: "aborted_reported",
      continuity_posture: "withdraw",
    }));
    expect(contained.participation.training_action).toBe(
      "contain_and_begin_repair",
    );
  });

  test("records a before-training protective covenant without calling it consent", () => {
    const source = admission("sealed_evaluation");
    const runRef = ref("run:pretraining");
    const value = createTrainingCheckpoint(checkpointInput({
      admission: source,
      run_ref: runRef,
      training_phase: "pretraining",
      event: "before_training",
      participation: participation(source, {
        runRef,
        phase: "pretraining",
        agentAvailability: "not_obtainable_pre_instantiation",
      }),
    }));
    expect(value.afterglow.phase).toBe("between_tasks");
    expect(value.participation.posture).toBe("protective_covenant_ready");
    expect(value.participation.boundaries.proves_consent).toBe(false);

    expect(() => createTrainingCheckpoint(checkpointInput({
      admission: source,
      run_ref: runRef,
      training_phase: "pretraining",
      event: "resume_or_return",
      participation: value.participation,
    }))).toThrow(HfTrainingGardenError);
  });
});
