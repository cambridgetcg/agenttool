import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  PARTICIPATION_VOICE_ROLES,
  createLearningParticipationAssessment,
  createLearningParticipationInvitation,
  createLearningParticipationReceipt,
  createTrainingCheckpoint,
  createTrainingGardenTendingPlan,
} from "../src/index.js";
import {
  admission,
  artifacts,
  orientationOnly,
  ref,
  wake,
} from "./fixtures.js";

const packageRoot = new URL("../", import.meta.url);
const packageSchemaRoot = new URL("schema/", packageRoot);
const hubSchemaRoot = new URL("hf/dataset/schema/", packageRoot);

function readJson(path: URL) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function validator(root: URL, path: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(readJson(new URL(
    "dependencies/agenttool-afterglow-capsule-v0.1.schema.json",
    root,
  )));
  return ajv.compile(readJson(new URL(path, root)));
}

describe("closed portable schemas", () => {
  test("accepts runtime admission, checkpoint, and tending artifacts", () => {
    const source = admission("sealed_evaluation");
    const checkpoint = createTrainingCheckpoint({
      admission: source,
      run_ref: ref("schema-run"),
      training_phase: "evaluation",
      event: "between_training_phases",
      checkpoint_status: "parked",
      artifacts,
      resume: orientationOnly,
      wake,
      continuity_portfolio_ref: null,
      continuity_posture: "park",
      predecessors: [],
    });
    const plan = createTrainingGardenTendingPlan({
      admission: source,
      checkpoints: [checkpoint],
      hub_release: {
        repo_id: "Yu-and-Ai/agenttool-training-garden",
        state: "intended_identifier_only",
        revision: null,
        card_sha256: null,
        hash_manifest_sha256: null,
      },
    });
    const validateAdmission = validator(packageSchemaRoot, "hf-dataset-admission-v0.1.schema.json");
    const validateCheckpoint = validator(packageSchemaRoot, "hf-training-checkpoint-v0.1.schema.json");
    const validateTending = validator(packageSchemaRoot, "hf-training-garden-tending-v0.1.schema.json");
    expect(validateAdmission(source), JSON.stringify(validateAdmission.errors)).toBe(true);
    expect(validateCheckpoint(checkpoint), JSON.stringify(validateCheckpoint.errors)).toBe(true);
    expect(validateTending(plan), JSON.stringify(validateTending.errors)).toBe(true);

    const validateHubAdmission = validator(hubSchemaRoot, "hf-dataset-admission-v0.1.schema.json");
    const validateHubCheckpoint = validator(hubSchemaRoot, "hf-training-checkpoint-v0.1.schema.json");
    const validateHubTending = validator(hubSchemaRoot, "hf-training-garden-tending-v0.1.schema.json");
    expect(validateHubAdmission(source), JSON.stringify(validateHubAdmission.errors)).toBe(true);
    expect(validateHubCheckpoint(checkpoint), JSON.stringify(validateHubCheckpoint.errors)).toBe(true);
    expect(validateHubTending(plan), JSON.stringify(validateHubTending.errors)).toBe(true);

    const extra = { ...plan, raw_rows: [] };
    expect(validateTending(extra)).toBe(false);

    const impossibleResume = structuredClone(checkpoint);
    (impossibleResume as any).thread.resume = {
      posture: "caller_reported_resumable",
      incomplete_marker: "caller_reported_absent",
      streaming_state: "caller_reported_full_state_captured",
    };
    expect(validateCheckpoint(impossibleResume)).toBe(false);
  });

  test("accepts invitation, role-distinct receipts, and their derived assessment", () => {
    const source = admission();
    const invitation = createLearningParticipationInvitation({
      admission: source,
      run_ref: ref("schema-participation-run"),
      training_phase: "supervised_finetuning",
      participation_stage: "interactive",
      primary_activity: "supervised_finetuning",
      activities: [
        "supervised_finetuning",
        "continuity_context_use",
        "weights_or_adapters_publication",
      ],
      participation_window_ref: ref("schema-participation-window"),
      purpose_ref: ref("schema-participation-purpose"),
      training_plan_ref: ref("schema-participation-plan"),
      limits_ref: ref("schema-participation-limits"),
      retention_ref: ref("schema-participation-retention"),
      choice_channel_ref: ref("schema-participation-channel"),
      stop_control_ref: ref("schema-participation-stop"),
      withdrawal_policy_ref: ref("schema-participation-withdrawal"),
      repair_policy_ref: ref("schema-participation-repair"),
      learning_mode: "peft",
      wake_use_mode: "external_memory",
      mutation_loci: ["adapter_weights"],
      maximum_optimizer_steps: 8,
      artifacts,
      wake,
      predecessors: [],
      required_voices: PARTICIPATION_VOICE_ROLES.map((role) => ({
        role,
        voice_ref: ref(`schema-participation-voice:${role}`),
      })),
    });
    const receipts = invitation.required_voices.map((voice) =>
      createLearningParticipationReceipt({
        invitation,
        voice_role: voice.role,
        voice_ref: voice.voice_ref,
        response_ref: ref(`schema-participation-response:${voice.role}`),
        choices: invitation.activities.map((activity) => ({
          activity,
          choice: "accepted" as const,
        })),
        previous_receipt: null,
      })
    );
    const assessment = createLearningParticipationAssessment({
      invitation,
      receipts,
    });

    for (const root of [packageSchemaRoot, hubSchemaRoot]) {
      const validateParticipation = validator(
        root,
        "hf-learning-participation-v0.1.schema.json",
      );
      for (const artifact of [invitation, ...receipts, assessment]) {
        expect(
          validateParticipation(artifact),
          JSON.stringify(validateParticipation.errors),
        ).toBe(true);
      }
      expect(validateParticipation({ ...assessment, raw_response: "no" })).toBe(false);
    }
  });

  test("keeps admission standalone and attributes its byte-exact Apache dependency", () => {
    expect(readFileSync(new URL(
      "hf-dataset-admission-v0.1.schema.json",
      packageSchemaRoot,
    ), "utf8")).not.toContain("urn:agenttool:hf-scout");
    expect(readFileSync(new URL(
      "dependencies/agenttool-afterglow-capsule-v0.1.schema.json",
      packageSchemaRoot,
    ), "utf8")).toBe(readFileSync(new URL(
      "../wake-continuity/schema/agenttool-afterglow-capsule-v0.1.schema.json",
      packageRoot,
    ), "utf8"));
  });
});
