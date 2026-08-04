import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  PARTICIPATION_ASSESSMENT_FORMAT,
  PARTICIPATION_INVITATION_FORMAT,
  PARTICIPATION_PROMPT_ENVELOPE_PROFILE,
  PARTICIPATION_RECEIPT_FORMAT,
  createHfTrainingGovernance,
  createTrainingGovernanceOffer,
  createTrainingGovernanceTerms,
  createTrainingCheckpoint,
  createTrainingGardenTendingPlan,
  resolveLearningFreedomOffer,
} from "../src/index.js";
import {
  admission,
  artifacts,
  freedom,
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

    for (const projection of ["truncated", "not_provided"] as const) {
      const alternateParticipation = participation(source, {
        runRef: ref(`schema-run:${projection}`),
        wakeValue: { ...wake, handoff_projection: projection },
      });
      const alternateOffer = freedomOffer(alternateParticipation);
      const alternateFreedom = resolveLearningFreedomOffer({
        offer: alternateOffer,
        state: "directed",
        direction: "stay",
        route_id: alternateOffer.routes.find((route) => route.direction === "stay")!.route_id,
        proposal_ref: null,
        choice_channel: freedomChoiceChannel(alternateOffer),
      });
      expect(validateFreedom(alternateFreedom), JSON.stringify(validateFreedom.errors)).toBe(true);
    }

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
    const obsoletePartialProjection = structuredClone(freedom) as any;
    obsoletePartialProjection.offer.scope.wake.handoff_projection = "partial";
    expect(validateFreedom(obsoletePartialProjection)).toBe(false);
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

  test("keeps governance WAKE schema states aligned with the shared runtime", () => {
    const source = admission("sealed_evaluation");
    const packageValidate = validator(
      packageSchemaRoot,
      "hf-training-governance-v0.2.schema.json",
    );
    const hubValidate = validator(
      hubSchemaRoot,
      "hf-training-governance-v0.2.schema.json",
    );
    let complete: ReturnType<typeof createHfTrainingGovernance> | null = null;
    for (const projection of [
      "complete",
      "truncated",
      "unavailable",
      "not_provided",
    ] as const) {
      const exactParticipation = participation(source, {
        runRef: ref(`schema:governance:run:${projection}`),
        wakeValue: { ...wake, handoff_projection: projection },
      });
      const exactFreedom = freedom(exactParticipation);
      const terms = createTrainingGovernanceTerms({
        admission: source,
        participation: exactParticipation,
        freedom: exactFreedom,
        starting_garden_checkpoint: null,
        starting_state_kind: "artifact_portfolio",
        run_ref: exactParticipation.invitation.run_ref,
        training_phase: "evaluation",
        selected_entry_ids: source.entries.map((entry) => entry.entry_id),
        model_source_ref: ref("schema:governance:model"),
        tokenizer_ref: ref("schema:governance:tokenizer"),
        trainer_stack_ref: ref("schema:governance:trainer"),
        optimizer_config_ref: ref("schema:governance:optimizer"),
        substrate_environment_ref: ref("schema:governance:substrate"),
        purpose_ref: ref("schema:governance:purpose"),
        objective_or_loss_ref: ref("schema:governance:objective"),
        dataset_mixture_ref: ref("schema:governance:mixture"),
        transform_recipe_ref: ref("schema:governance:transform"),
        compute_budget_ref: ref("schema:governance:compute"),
        output_and_derivative_use_ref: ref("schema:governance:derivatives"),
        audience_ref: ref("schema:governance:audience"),
        retention_ref: ref("schema:governance:retention"),
        release_ref: ref("schema:governance:release"),
        stop_policy_ref: ref("schema:governance:stop"),
        wake_policy_ref: ref("schema:governance:wake-policy"),
      });
      const exactOffer = createTrainingGovernanceOffer({
        terms,
        encounter_ref: ref(`schema:governance:encounter:${projection}`),
        event: "preflight_before_load",
        observed_global_step: null,
        proposed_global_step: null,
        frontiers: {
          governance: ref(`schema:frontier:${projection}:governance`),
          participation: ref(`schema:frontier:${projection}:participation`),
          freedom: ref(`schema:frontier:${projection}:freedom`),
          resources: ref(`schema:frontier:${projection}:resources`),
          garden_checkpoint: ref(`schema:frontier:${projection}:garden`),
          physical_checkpoint: ref(`schema:frontier:${projection}:physical`),
        },
        predecessor: null,
        predecessor_refs: {
          participation: null,
          freedom: null,
          resources: null,
          garden_checkpoint: null,
          physical_checkpoint: null,
        },
        checkpoint: {
          garden_checkpoint_id: null,
          physical_checkpoint_ref: null,
          physical_checkpoint_evidence_ref: null,
          model_checkpoint_artifact_ref: null,
          checkpoint_ticket_id: null,
          checkpoint_request_governance_id: null,
        },
      });
      const governance = createHfTrainingGovernance({
        admission: source,
        participation: exactParticipation,
        freedom: exactFreedom,
        starting_garden_checkpoint: null,
        event_garden_checkpoint: null,
        offer: exactOffer,
        authority_coverage: {
          state: "caller_reported_complete",
          offer_ref: exactOffer.offer_id,
          affected_principals_ref: ref("schema:governance:principals"),
          evidence_ref: ref("schema:governance:coverage"),
        },
        authorities: ["operator", "compute_owner", "substrate_steward", "data_custodian"].map((role) => ({
          principal_ref: ref(`schema:governance:principal:${role}`),
          role,
          decision: "caller_reported_granted" as const,
          offer_ref: exactOffer.offer_id,
          basis_ref: ref(`schema:governance:basis:${role}`),
          evidence_ref: ref(`schema:governance:evidence:${role}`),
          withdrawal_cutoff_ref: null,
        })),
        preference: {
          channel: "root_signed_runtime",
          choice: "continue",
          provenance: "caller_reported_root_signed_exact_bytes",
          offer_ref: exactOffer.offer_id,
          evidence_ref: ref(`schema:governance:preference:${projection}`),
        },
        effect: {
          state: "no_effect_reported",
          offer_ref: null,
          observed_global_step: null,
          physical_checkpoint_ref: null,
          physical_checkpoint_evidence_ref: null,
          evidence_ref: null,
        },
      });
      expect(packageValidate(governance), JSON.stringify(packageValidate.errors)).toBe(true);
      expect(hubValidate(governance), JSON.stringify(hubValidate.errors)).toBe(true);
      if (projection === "complete") complete = governance;
    }
    expect(complete).not.toBeNull();
    for (const obsolete of ["partial", "omitted_by_caller", "not_applicable"]) {
      const forged = structuredClone(complete) as any;
      forged.offer.terms.normative_bindings.wake.handoff_projection = obsolete;
      expect(packageValidate(forged)).toBe(false);
      expect(hubValidate(forged)).toBe(false);
    }
    const legacy = readFileSync(new URL(
      "hf-training-governance-v0.1.schema.json",
      packageSchemaRoot,
    ));
    expect(createHash("sha256").update(legacy).digest("hex")).toBe(
      "34583d785db3d69c0f4637d9b7251aae8eaa4970ea02c9dfc53f84eccec47eb6",
    );
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
    expect(PARTICIPATION_PROMPT_ENVELOPE_PROFILE).toBe(
      "kingdom.hf-learning-participation-prompt-envelope/0.2",
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
