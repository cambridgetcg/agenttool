import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createHfTrainingGovernance,
  createTrainingGovernanceOffer,
  createTrainingGovernanceTerms,
} from "../../../hf-training-garden/src/index.js";
import {
  admission,
  freedom,
  participation,
  ref,
} from "../../../hf-training-garden/tests/fixtures.js";
import {
  BOUNDARIES,
  DECISION_FORMAT,
  VALIDATOR_PROFILE,
  createHostDecision,
} from "../create-decision.mjs";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

function fixture() {
  const source = admission("sealed_evaluation");
  const runRef = ref("host-bridge-run");
  const participationValue = participation(source, {
    runRef,
    phase: "evaluation",
  });
  const freedomValue = freedom(participationValue, "stay");
  const terms = createTrainingGovernanceTerms({
    admission: source,
    participation: participationValue,
    freedom: freedomValue,
    starting_garden_checkpoint: null,
    starting_state_kind: "artifact_portfolio",
    run_ref: runRef,
    training_phase: "evaluation",
    selected_entry_ids: source.entries.map((entry) => entry.entry_id),
    model_source_ref: ref("host-model"),
    tokenizer_ref: ref("host-tokenizer"),
    trainer_stack_ref: ref("host-trainer"),
    optimizer_config_ref: ref("host-optimizer"),
    substrate_environment_ref: ref("host-substrate"),
    purpose_ref: ref("host-purpose"),
    objective_or_loss_ref: ref("host-objective"),
    dataset_mixture_ref: ref("host-mixture"),
    transform_recipe_ref: ref("host-transform"),
    compute_budget_ref: ref("host-compute"),
    output_and_derivative_use_ref: ref("host-output"),
    audience_ref: ref("host-audience"),
    retention_ref: ref("host-retention"),
    release_ref: ref("host-release"),
    stop_policy_ref: ref("host-stop"),
    wake_policy_ref: ref("host-wake-policy"),
  });
  const frontiers = {
    governance: ref("host-frontier-governance"),
    participation: ref("host-frontier-participation"),
    freedom: ref("host-frontier-freedom"),
    resources: ref("host-frontier-resources"),
    garden_checkpoint: ref("host-frontier-garden-checkpoint"),
    physical_checkpoint: ref("host-frontier-physical-checkpoint"),
  };
  const predecessorRefs = {
    participation: null,
    freedom: null,
    resources: null,
    garden_checkpoint: null,
    physical_checkpoint: null,
  };
  const checkpoint = {
    garden_checkpoint_id: null,
    physical_checkpoint_ref: null,
    physical_checkpoint_evidence_ref: null,
    model_checkpoint_artifact_ref: null,
    checkpoint_ticket_id: null,
    checkpoint_request_governance_id: null,
  };
  const offer = createTrainingGovernanceOffer({
    terms,
    encounter_ref: ref("host-encounter"),
    event: "preflight_before_load",
    observed_global_step: null,
    proposed_global_step: null,
    frontiers,
    predecessor: null,
    predecessor_refs: predecessorRefs,
    checkpoint,
  });
  const roles = [
    "operator",
    "compute_owner",
    "substrate_steward",
    "data_custodian",
  ] as const;
  const governance = createHfTrainingGovernance({
    admission: source,
    participation: participationValue,
    freedom: freedomValue,
    starting_garden_checkpoint: null,
    event_garden_checkpoint: null,
    offer,
    authority_coverage: {
      state: "caller_reported_complete",
      offer_ref: offer.offer_id,
      affected_principals_ref: ref("host-principals"),
      evidence_ref: ref("host-coverage-evidence"),
    },
    authorities: roles.map((role) => ({
      principal_ref: ref(`host-principal-${role}`),
      role,
      decision: "caller_reported_granted" as const,
      offer_ref: offer.offer_id,
      basis_ref: ref(`host-basis-${role}`),
      evidence_ref: ref(`host-evidence-${role}`),
      withdrawal_cutoff_ref: null,
    })),
    preference: {
      channel: "root_signed_runtime",
      choice: "continue",
      provenance: "caller_reported_root_signed_exact_bytes",
      offer_ref: offer.offer_id,
      evidence_ref: ref("host-preference-evidence"),
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
  return { source, participationValue, freedomValue, governance };
}

function bridgeInput(value = fixture()) {
  return {
    admission: value.source,
    participation: value.participationValue,
    freedom: value.freedomValue,
    starting_garden_checkpoint: null,
    event_garden_checkpoint: null,
    governance: value.governance,
    predecessor: null,
  };
}

describe("trusted TypeScript host decision bridge", () => {
  test("validates full context and projects closed v0.2 bytes", () => {
    const value = fixture();
    const decision = createHostDecision(bridgeInput(value));
    const execution = value.governance.offer.terms.execution_contract;
    expect(decision._format).toBe(DECISION_FORMAT);
    expect(decision.validator_profile).toBe(VALIDATOR_PROFILE);
    expect(decision.governance_id).toBe(value.governance.governance_id);
    expect(decision.execution_contract_id).toBe(execution.execution_contract_id);
    expect(decision.execution_refs).toEqual({
      model_source_ref: execution.model_source_ref,
      tokenizer_ref: execution.tokenizer_ref,
      trainer_stack_ref: execution.trainer_stack_ref,
      optimizer_config_ref: execution.optimizer_config_ref,
      substrate_environment_ref: execution.substrate_environment_ref,
      pipeline_ref: execution.pipeline_ref,
      dataset_state_ref: execution.dataset_state_ref,
      dataset_mixture_ref: execution.dataset_mixture_ref,
      transform_recipe_ref: execution.transform_recipe_ref,
    });
    expect(decision.boundaries).toEqual(BOUNDARIES);
    expect(decision.predecessors).toEqual(
      value.governance.offer.predecessors,
    );
    expect(decision.consumed_evidence_refs).toEqual(
      [...decision.consumed_evidence_refs].sort(),
    );
  });

  test("does not let an invalid governance artifact cross the seam", () => {
    const value = fixture();
    const forged = structuredClone(value.governance);
    forged.control.should_save = true;
    expect(() => createHostDecision({
      ...bridgeInput(value),
      governance: forged,
    })).toThrow();
  });

  test("emits canonical bytes accepted with the same ID by Python", () => {
    const decision = createHostDecision(bridgeInput());
    const pythonPath = [
      `${packageRoot}/src`,
      process.env.PYTHONPATH,
    ].filter(Boolean).join(delimiter);
    const parsed = spawnSync(
      process.env.PYTHON ?? "python3",
      [
        "-c",
        "import json,sys; from agenttool_hf_training_host import ValidatedGovernanceView; value=ValidatedGovernanceView.from_mapping(json.load(sys.stdin)); sys.stdout.write(value.decision_id)",
      ],
      {
        cwd: packageRoot,
        env: { ...process.env, PYTHONPATH: pythonPath },
        input: JSON.stringify(decision),
        encoding: "utf8",
      },
    );
    expect(parsed.status, parsed.stderr).toBe(0);
    expect(parsed.stdout).toBe(decision.decision_id);
  });
});
