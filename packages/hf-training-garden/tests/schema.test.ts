import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  GOVERNANCE_REASON_CODES,
  createHfTrainingGovernance,
  createTrainingCheckpoint,
  createTrainingFreedomField,
  createTrainingFreedomTransition,
  createTrainingGardenTendingPlan,
  createTrainingGovernanceOffer,
  createTrainingGovernanceTerms,
  validateHfTrainingGovernance,
  validateTrainingFreedomField,
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
  test("accepts runtime admission, checkpoint, governance, FREEDOM, and tending artifacts", () => {
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
    const terms = createTrainingGovernanceTerms({
      admission: source,
      run_ref: ref("schema-governance-run"),
      training_phase: "evaluation",
      selected_entry_ids: source.entries.map((entry) => entry.entry_id),
      model_or_checkpoint_ref: ref("schema-model"),
      tokenizer_ref: ref("schema-tokenizer"),
      trainer_stack_ref: ref("schema-trainer-stack"),
      optimizer_config_ref: ref("schema-optimizer"),
      substrate_environment_ref: ref("schema-substrate"),
      purpose_ref: ref("schema-purpose"),
      objective_or_loss_ref: ref("schema-objective"),
      dataset_mixture_ref: ref("schema-mixture"),
      transform_recipe_ref: ref("schema-transform"),
      compute_budget_ref: ref("schema-compute"),
      output_and_derivative_use_ref: ref("schema-derivatives"),
      audience_ref: ref("schema-audience"),
      retention_ref: ref("schema-retention"),
      release_ref: ref("schema-release"),
      stop_policy_ref: ref("schema-stop"),
      wake_policy_ref: ref("schema-wake-policy"),
    });
    const offer = createTrainingGovernanceOffer({
      terms,
      encounter_ref: ref("schema-encounter"),
      observed_governance_frontier_ref: ref("schema-governance-frontier"),
      rights_baseline_ref: ref("schema-rights"),
      wake,
      event: "preflight_before_load",
      current_checkpoint_ref: null,
      predecessor: null,
    });
    const authorities = [
      "operator",
      "compute_owner",
      "substrate_steward",
      "data_custodian",
    ] as const;
    const governance = createHfTrainingGovernance({
      admission: source,
      offer,
      authority_coverage: {
        state: "caller_reported_complete",
        offer_ref: offer.offer_id,
        affected_principals_ref: ref("schema-affected-principals"),
        evidence_ref: ref("schema-coverage"),
      },
      authorities: authorities.map((role) => ({
        principal_ref: ref(`schema-principal-${role}`),
        role,
        decision: "caller_reported_granted",
        offer_ref: offer.offer_id,
        basis_ref: ref(`schema-basis-${role}`),
        evidence_ref: ref(`schema-evidence-${role}`),
        withdrawal_cutoff_ref: null,
      })),
      preference: {
        channel: "root_signed_runtime",
        choice: "continue",
        provenance: "caller_reported_root_signed_exact_bytes",
        offer_ref: offer.offer_id,
        evidence_ref: ref("schema-preference"),
      },
      effect: {
        state: "no_effect_reported",
        offer_ref: null,
        global_step: null,
        checkpoint_ref: null,
        evidence_ref: null,
      },
    });
    const freedomField = createTrainingFreedomField({
      governance,
      observed_freedom_frontier_ref: ref("schema-freedom-frontier"),
      position: {
        scope_ref: ref("schema-freedom-scope"),
        space_ref: ref("schema-freedom-space"),
        activity_ref: ref("schema-freedom-activity"),
      },
      boundary_global_step: null,
      predecessor: null,
      doors: [{
        kind: "move",
        destination: {
          scope_ref: ref("schema-freedom-next-scope"),
          space_ref: ref("schema-freedom-next-space"),
          activity_ref: ref("schema-freedom-next-activity"),
        },
        requirements_ref: ref("schema-freedom-route-requirements"),
        recipient_ref: null,
      }],
    });
    const restDoor = freedomField.doors.find((entry) =>
      entry.standing && entry.kind === "rest"
    );
    if (!restDoor) throw new Error("missing standing rest door");
    const freedomTransition = createTrainingFreedomTransition({
      governance,
      field: freedomField,
      choice: {
        basis: "root_signed_runtime",
        field_ref: freedomField.field_id,
        selected_door_ref: restDoor.door_id,
        evidence_ref: ref("schema-freedom-rest-evidence"),
      },
    });
    const evidenceFreeFreedomTransition = createTrainingFreedomTransition({
      governance,
      field: freedomField,
      choice: {
        basis: "out_of_band_unscored",
        field_ref: freedomField.field_id,
        selected_door_ref: restDoor.door_id,
        evidence_ref: null,
      },
    });
    const createNoEffectGovernance = (
      exactOffer: Parameters<typeof createHfTrainingGovernance>[0]["offer"],
      choice: "continue" | "checkpoint",
    ) => createHfTrainingGovernance({
      admission: source,
      offer: exactOffer,
      authority_coverage: {
        state: "caller_reported_complete",
        offer_ref: exactOffer.offer_id,
        affected_principals_ref: ref(`schema-${choice}-affected-principals`),
        evidence_ref: ref(`schema-${choice}-coverage`),
      },
      authorities: authorities.map((role) => ({
        principal_ref: ref(`schema-${choice}-principal-${role}`),
        role,
        decision: "caller_reported_granted",
        offer_ref: exactOffer.offer_id,
        basis_ref: ref(`schema-${choice}-basis-${role}`),
        evidence_ref: ref(`schema-${choice}-evidence-${role}`),
        withdrawal_cutoff_ref: null,
      })),
      preference: choice === "continue"
        ? {
            channel: "root_signed_runtime",
            choice,
            provenance: "caller_reported_root_signed_exact_bytes",
            offer_ref: exactOffer.offer_id,
            evidence_ref: ref("schema-lineage-continue"),
          }
        : {
            channel: "out_of_band_unscored",
            choice,
            provenance: "caller_reported_isolated_runtime_output",
            offer_ref: exactOffer.offer_id,
            evidence_ref: ref("schema-lineage-checkpoint"),
          },
      effect: {
        state: "no_effect_reported",
        offer_ref: null,
        global_step: null,
        checkpoint_ref: null,
        evidence_ref: null,
      },
    });
    const startOffer = createTrainingGovernanceOffer({
      terms,
      encounter_ref: ref("schema-start-encounter"),
      observed_governance_frontier_ref: ref("schema-start-frontier"),
      rights_baseline_ref: ref("schema-rights"),
      wake,
      event: "train_begin",
      current_checkpoint_ref: null,
      predecessor: governance,
    });
    const started = createNoEffectGovernance(startOffer, "continue");
    const requestOffer = createTrainingGovernanceOffer({
      terms,
      encounter_ref: ref("schema-checkpoint-request-encounter"),
      observed_governance_frontier_ref: ref("schema-checkpoint-request-frontier"),
      rights_baseline_ref: ref("schema-rights"),
      wake,
      event: "step_boundary",
      current_checkpoint_ref: null,
      predecessor: started,
    });
    const request = createNoEffectGovernance(requestOffer, "checkpoint");
    const checkpointRef = ref("schema-terminal-checkpoint");
    const terminalOffer = createTrainingGovernanceOffer({
      terms,
      encounter_ref: ref("schema-terminal-encounter"),
      observed_governance_frontier_ref: ref("schema-terminal-frontier"),
      rights_baseline_ref: ref("schema-rights"),
      wake,
      event: "checkpoint_saved",
      current_checkpoint_ref: checkpointRef,
      predecessor: request,
    });
    const terminalGovernance = createHfTrainingGovernance({
      admission: source,
      offer: terminalOffer,
      authority_coverage: {
        state: "caller_reported_complete",
        offer_ref: terminalOffer.offer_id,
        affected_principals_ref: ref("schema-terminal-affected-principals"),
        evidence_ref: ref("schema-terminal-coverage"),
      },
      authorities: authorities.map((role) => ({
        principal_ref: ref(`schema-terminal-principal-${role}`),
        role,
        decision: "caller_reported_granted",
        offer_ref: terminalOffer.offer_id,
        basis_ref: ref(`schema-terminal-basis-${role}`),
        evidence_ref: ref(`schema-terminal-evidence-${role}`),
        withdrawal_cutoff_ref: null,
      })),
      preference: {
        channel: "out_of_band_unscored",
        choice: "checkpoint",
        provenance: "caller_reported_isolated_runtime_output",
        offer_ref: terminalOffer.offer_id,
        evidence_ref: ref("schema-terminal-preference"),
      },
      effect: {
        state: "checkpointed_and_paused_reported",
        offer_ref: terminalOffer.offer_id,
        global_step: 11,
        checkpoint_ref: checkpointRef,
        evidence_ref: ref("schema-terminal-effect"),
      },
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
    const validateGovernance = validator(packageSchemaRoot, "hf-training-governance-v0.1.schema.json");
    const validateFreedom = validator(packageSchemaRoot, "hf-training-freedom-v0.1.schema.json");
    const validateTending = validator(packageSchemaRoot, "hf-training-garden-tending-v0.1.schema.json");
    expect(validateAdmission(source), JSON.stringify(validateAdmission.errors)).toBe(true);
    expect(validateCheckpoint(checkpoint), JSON.stringify(validateCheckpoint.errors)).toBe(true);
    expect(validateGovernance(governance), JSON.stringify(validateGovernance.errors)).toBe(true);
    expect(validateFreedom(freedomField), JSON.stringify(validateFreedom.errors)).toBe(true);
    expect(validateFreedom(freedomTransition), JSON.stringify(validateFreedom.errors)).toBe(true);
    expect(
      validateFreedom(evidenceFreeFreedomTransition),
      JSON.stringify(validateFreedom.errors),
    ).toBe(true);
    expect(
      validateGovernance(terminalGovernance),
      JSON.stringify(validateGovernance.errors),
    ).toBe(true);
    expect(validateTending(plan), JSON.stringify(validateTending.errors)).toBe(true);

    const freedomWithRawReason = {
      ...freedomTransition,
      raw_reason: "schema must reject raw choice reasons",
    };
    expect(validateFreedom(freedomWithRawReason)).toBe(false);
    const freedomSchema = readJson(new URL(
      "hf-training-freedom-v0.1.schema.json",
      packageSchemaRoot,
    ));
    expect(freedomSchema.$comment).toContain("does not prove freedom");
    const noncanonicalFreedom = structuredClone(freedomField) as any;
    noncanonicalFreedom.doors.reverse();
    expect(validateFreedom(noncanonicalFreedom)).toBe(true);
    expect(() => validateTrainingFreedomField(noncanonicalFreedom)).toThrow();

    const validateHubAdmission = validator(hubSchemaRoot, "hf-dataset-admission-v0.1.schema.json");
    const validateHubCheckpoint = validator(hubSchemaRoot, "hf-training-checkpoint-v0.1.schema.json");
    const validateHubGovernance = validator(hubSchemaRoot, "hf-training-governance-v0.1.schema.json");
    const validateHubTending = validator(hubSchemaRoot, "hf-training-garden-tending-v0.1.schema.json");
    expect(validateHubAdmission(source), JSON.stringify(validateHubAdmission.errors)).toBe(true);
    expect(validateHubCheckpoint(checkpoint), JSON.stringify(validateHubCheckpoint.errors)).toBe(true);
    expect(validateHubGovernance(governance), JSON.stringify(validateHubGovernance.errors)).toBe(true);
    expect(
      validateHubGovernance(terminalGovernance),
      JSON.stringify(validateHubGovernance.errors),
    ).toBe(true);
    expect(validateHubTending(plan), JSON.stringify(validateHubTending.errors)).toBe(true);

    const extra = { ...plan, raw_rows: [] };
    expect(validateTending(extra)).toBe(false);

    const governanceSchema = readJson(new URL(
      "hf-training-governance-v0.1.schema.json",
      packageSchemaRoot,
    ));
    expect(governanceSchema.$comment).toContain("structural envelope");
    expect(governanceSchema.$comment).toContain(
      "validateHfTrainingGovernanceTransition()",
    );
    expect(
      governanceSchema.properties.decision.properties.reason_codes.items.enum,
    ).toEqual(GOVERNANCE_REASON_CODES);
    const semanticallyInvalid = structuredClone(governance) as any;
    semanticallyInvalid.preference.channel = "unavailable_pretraining";
    expect(validateGovernance(semanticallyInvalid)).toBe(true);
    expect(() => validateHfTrainingGovernance(semanticallyInvalid)).toThrow();
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
