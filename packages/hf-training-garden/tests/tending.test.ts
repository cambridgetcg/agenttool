import { describe, expect, test } from "bun:test";

import {
  HfTrainingGardenError,
  createTrainingCheckpoint,
  createTrainingGardenTendingPlan,
  validateTrainingGardenTendingPlan,
  validateTrainingGardenTendingPlanAgainstSources,
} from "../src/index.js";
import {
  admission,
  artifacts,
  orientationOnly,
  participation,
  ref,
  wake,
} from "./fixtures.js";

describe("Garden to HF tending seam", () => {
  test("projects six local layers around an intended public Hub dataset", () => {
    const source = admission("sealed_evaluation");
    const checkpoint = createTrainingCheckpoint({
      admission: source,
      run_ref: ref("run:tending"),
      training_phase: "evaluation",
      event: "between_training_phases",
      checkpoint_status: "parked",
      participation: participation(source, { runRef: ref("run:tending") }),
      artifacts,
      resume: orientationOnly,
      wake,
      continuity_portfolio_ref: null,
      continuity_posture: "park",
      predecessors: [],
    });
    const input = {
      admission: source,
      checkpoints: [checkpoint],
      hub_release: {
        repo_id: "Yu-and-Ai/agenttool-training-garden",
        state: "intended_identifier_only" as const,
        revision: null,
        card_sha256: null,
        hash_manifest_sha256: null,
      },
    };
    const plan = createTrainingGardenTendingPlan(input);
    expect(plan.layers.bedrock).toEqual([
      source.policy_ref,
      checkpoint.participation.assessment_id,
    ].sort());
    expect(plan.layers.roots).toEqual([
      source.entries[0]!.candidate_slice_ref!,
      source.entries[0]!.transform_recipe_ref!,
    ].sort());
    expect(plan.layers.mycelium).toEqual([source.admission_id]);
    expect(plan.layers.habitat).toEqual([checkpoint.checkpoint_id]);
    expect(plan.layers.canopy).toEqual(["dataset:Yu-and-Ai/agenttool-training-garden@intended"]);
    expect(plan.garden_reference_draft).toEqual({
      suggested_kind: "curation",
      artifact_ref: source.admission_id,
      host_action: "persist_artifact_then_add_supported_reference",
      automatic: false,
    });
    expect(plan.latest_head_selected).toBe(false);
    expect(plan.boundaries.mutates_garden).toBe(false);
    expect(plan.boundaries.writes_hub).toBe(false);
    expect(validateTrainingGardenTendingPlan(plan)).toEqual(plan);
    expect(validateTrainingGardenTendingPlanAgainstSources(plan, input)).toEqual(plan);
  });

  test("requires exact evidence hashes for a caller-reported published release", () => {
    const source = admission();
    expect(() => createTrainingGardenTendingPlan({
      admission: source,
      checkpoints: [],
      hub_release: {
        repo_id: "Yu-and-Ai/agenttool-training-garden",
        state: "caller_reported_published",
        revision: "a".repeat(40),
        card_sha256: null,
        hash_manifest_sha256: null,
      },
    })).toThrow(HfTrainingGardenError);
  });

  test("never treats an opaque Garden scope as an API reference or verified referent", () => {
    const source = admission("sealed_evaluation");
    const input = {
      admission: source,
      checkpoints: [],
      hub_release: {
        repo_id: "Yu-and-Ai/agenttool-training-garden",
        state: "intended_identifier_only" as const,
        revision: null,
        card_sha256: null,
        hash_manifest_sha256: null,
      },
    };
    const plan = createTrainingGardenTendingPlan(input);
    const json = JSON.stringify(plan);
    expect(json).not.toContain("https://");
    expect(json).not.toContain("project_id");
    expect(json).not.toContain("garden_id");
    expect(plan.boundaries.garden_api_external_hf_reference_supported).toBe(false);

    const tampered = structuredClone(plan) as Record<string, any>;
    tampered.layers.habitat = [ref("unknown-checkpoint")];
    expect(() => validateTrainingGardenTendingPlan(tampered)).toThrow(HfTrainingGardenError);

    const rootsOmitted = structuredClone(plan) as Record<string, any>;
    rootsOmitted.layers.roots = [];
    expect(() => validateTrainingGardenTendingPlanAgainstSources(rootsOmitted, input))
      .toThrow(HfTrainingGardenError);
  });
});
