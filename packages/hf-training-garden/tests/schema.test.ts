import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  PARTICIPATION_ASSESSMENT_FORMAT,
  PARTICIPATION_INVITATION_FORMAT,
  PARTICIPATION_RECEIPT_FORMAT,
  createTrainingCheckpoint,
  createTrainingGardenTendingPlan,
  resolveLearningFreedomOffer,
} from "../src/index.js";
import {
  admission,
  artifacts,
  freedomChoiceChannel,
  freedomOffer,
  orientationOnly,
  participation,
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
  for (const dependency of [
    "hf-learning-participation-invitation-v0.2.schema.json",
    "hf-learning-participation-receipt-v0.2.schema.json",
    "hf-learning-participation-assessment-v0.2.schema.json",
  ]) {
    if (dependency !== path) ajv.addSchema(readJson(new URL(dependency, root)));
  }
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
      participation: participation(source, { runRef: ref("schema-run") }),
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
    const offer = freedomOffer(checkpoint.participation);
    const stay = offer.routes.find((route) => route.direction === "stay")!;
    const freedom = resolveLearningFreedomOffer({
      offer,
      state: "directed",
      direction: "stay",
      route_id: stay.route_id,
      proposal_ref: null,
      choice_channel: freedomChoiceChannel(offer),
    });
    const validateAdmission = validator(packageSchemaRoot, "hf-dataset-admission-v0.1.schema.json");
    const validateInvitation = validator(packageSchemaRoot, "hf-learning-participation-invitation-v0.2.schema.json");
    const validateReceipt = validator(packageSchemaRoot, "hf-learning-participation-receipt-v0.2.schema.json");
    const validateAssessment = validator(packageSchemaRoot, "hf-learning-participation-assessment-v0.2.schema.json");
    const validateCheckpoint = validator(packageSchemaRoot, "hf-training-checkpoint-v0.2.schema.json");
    const validateTending = validator(packageSchemaRoot, "hf-training-garden-tending-v0.1.schema.json");
    const validateFreedom = validator(packageSchemaRoot, "hf-learning-freedom-v0.1.schema.json");
    expect(validateAdmission(source), JSON.stringify(validateAdmission.errors)).toBe(true);
    expect(validateInvitation(checkpoint.participation.invitation), JSON.stringify(validateInvitation.errors)).toBe(true);
    expect(validateReceipt(checkpoint.participation.receipts[0]), JSON.stringify(validateReceipt.errors)).toBe(true);
    expect(validateAssessment(checkpoint.participation), JSON.stringify(validateAssessment.errors)).toBe(true);
    expect(validateCheckpoint(checkpoint), JSON.stringify(validateCheckpoint.errors)).toBe(true);
    expect(validateTending(plan), JSON.stringify(validateTending.errors)).toBe(true);
    expect(validateFreedom(freedom), JSON.stringify(validateFreedom.errors)).toBe(true);

    const forgedProceed = structuredClone(checkpoint.participation) as any;
    forgedProceed.receipts = [];
    expect(validateAssessment(forgedProceed)).toBe(false);

    const mismatchedWakeMode = structuredClone(checkpoint.participation.invitation) as any;
    mismatchedWakeMode.wake_use_mode = "training_data";
    expect(validateInvitation(mismatchedWakeMode)).toBe(false);
    const unavailableDirect = structuredClone(checkpoint.participation.receipts[0]!) as any;
    unavailableDirect.decisions[0]!.choice = "unavailable_pre_instantiation";
    expect(validateReceipt(unavailableDirect)).toBe(false);

    const validateHubAdmission = validator(hubSchemaRoot, "hf-dataset-admission-v0.1.schema.json");
    const validateHubCheckpoint = validator(hubSchemaRoot, "hf-training-checkpoint-v0.2.schema.json");
    const validateHubTending = validator(hubSchemaRoot, "hf-training-garden-tending-v0.1.schema.json");
    const validateHubFreedom = validator(hubSchemaRoot, "hf-learning-freedom-v0.1.schema.json");
    expect(validateHubAdmission(source), JSON.stringify(validateHubAdmission.errors)).toBe(true);
    expect(validateHubCheckpoint(checkpoint), JSON.stringify(validateHubCheckpoint.errors)).toBe(true);
    expect(validateHubTending(plan), JSON.stringify(validateHubTending.errors)).toBe(true);
    expect(validateHubFreedom(freedom), JSON.stringify(validateHubFreedom.errors)).toBe(true);

    const extra = { ...plan, raw_rows: [] };
    expect(validateTending(extra)).toBe(false);
    const turnLimited = { ...freedom, max_turns: 100 };
    expect(validateFreedom(turnLimited)).toBe(false);
    const rewardCaptured = structuredClone(freedom) as any;
    rewardCaptured.agent_direction.choice_channel.reward_influence = "enabled";
    expect(validateFreedom(rewardCaptured)).toBe(false);
    const stayWithProposal = structuredClone(freedom) as any;
    stayWithProposal.agent_direction.proposal_ref = ref("schema:smuggled-stay-proposal");
    expect(validateFreedom(stayWithProposal)).toBe(false);
    const wrongStayPosture = structuredClone(freedom) as any;
    wrongStayPosture.host_posture = "hold_for_target_acceptance";
    expect(validateFreedom(wrongStayPosture)).toBe(false);
    const falseActiveResources = structuredClone(freedom) as any;
    falseActiveResources.offer.resources.dimensions[4].state = "caller_reported_unavailable";
    expect(validateFreedom(falseActiveResources)).toBe(false);
    const interactiveAsUnavailable = structuredClone(freedom) as any;
    interactiveAsUnavailable.agent_direction = {
      state: "unavailable_pre_instantiation",
      report_basis: "not_obtainable_pre_instantiation",
      direction: null,
      route_id: null,
      proposal_ref: null,
      choice_channel: null,
    };
    interactiveAsUnavailable.host_posture = "instantiate_for_review";
    interactiveAsUnavailable.recontact_posture = "instantiate_once_for_review";
    expect(validateFreedom(interactiveAsUnavailable)).toBe(false);
    const unavailableAsDirected = structuredClone(freedom) as any;
    unavailableAsDirected.offer.scope.agent_availability = "not_obtainable_pre_instantiation";
    expect(validateFreedom(unavailableAsDirected)).toBe(false);
    const duplicateStay = structuredClone(freedom) as any;
    duplicateStay.offer.routes.push({
      ...structuredClone(stay),
      route_id: ref("schema:duplicate-stay-route"),
    });
    expect(validateFreedom(duplicateStay)).toBe(false);
    expect(() => validator(packageSchemaRoot, "hf-learning-freedom-v0.1.schema.json"))
      .not.toThrow();
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

  test("preserves the public checkpoint v0.1 schema beside current v0.2", () => {
    const packageV01 = readFileSync(new URL(
      "hf-training-checkpoint-v0.1.schema.json",
      packageSchemaRoot,
    ), "utf8");
    expect(packageV01).toBe(readFileSync(new URL(
      "hf-training-checkpoint-v0.1.schema.json",
      hubSchemaRoot,
    ), "utf8"));
    expect(JSON.parse(packageV01)).toMatchObject({
      $id: "https://agenttool.dev/schemas/hf-training-checkpoint-v0.1.schema.json",
      properties: { _format: { const: "kingdom.hf-training-checkpoint/0.1" } },
    });
    expect(() => validator(packageSchemaRoot, "hf-training-checkpoint-v0.1.schema.json"))
      .not.toThrow();
    const packageV02 = readFileSync(new URL(
      "hf-training-checkpoint-v0.2.schema.json",
      packageSchemaRoot,
    ));
    expect(createHash("sha256").update(packageV01).digest("hex")).toBe(
      "0a5db98bcf9b0cf26e4720a74e9902693cedf186ce01379552fb7e2083a24a3a",
    );
    expect(createHash("sha256").update(packageV02).digest("hex")).toBe(
      "f7d45535c4c911eeab9b68dae0e30b5441d761c1c4cc7fc7405015506580b185",
    );
  });

  test("preserves published participation v0.1 while current wires use v0.2", () => {
    expect(PARTICIPATION_INVITATION_FORMAT).toBe(
      "kingdom.hf-learning-participation-invitation/0.2",
    );
    expect(PARTICIPATION_RECEIPT_FORMAT).toBe(
      "kingdom.hf-learning-participation-receipt/0.2",
    );
    expect(PARTICIPATION_ASSESSMENT_FORMAT).toBe(
      "kingdom.hf-learning-participation-assessment/0.2",
    );
    const legacy = readFileSync(new URL(
      "hf-learning-participation-v0.1.schema.json",
      packageSchemaRoot,
    ));
    expect(legacy).toEqual(readFileSync(new URL(
      "hf-learning-participation-v0.1.schema.json",
      hubSchemaRoot,
    )));
    expect(createHash("sha256").update(legacy).digest("hex")).toBe(
      "fe5456b7b5d0aa8c0241f844a13258ebd038ecf5c6eac0467e9a07a4248621df",
    );
    expect(() => validator(packageSchemaRoot, "hf-learning-participation-v0.1.schema.json"))
      .not.toThrow();
  });
});
