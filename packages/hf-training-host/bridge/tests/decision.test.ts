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
  ref,
  wake,
} from "../../../hf-training-garden/tests/fixtures.js";
import {
  BOUNDARIES,
  DECISION_FORMAT,
  VALIDATOR_PROFILE,
  createHostDecision,
} from "../create-decision.mjs";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

function fixture() {
  const source = admission("training_candidate");
  const terms = createTrainingGovernanceTerms({
    admission: source,
    run_ref: ref("host-bridge-run"),
    training_phase: "supervised_finetuning",
    selected_entry_ids: source.entries.map((entry) => entry.entry_id),
    model_or_checkpoint_ref: ref("host-model"),
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
  const offer = createTrainingGovernanceOffer({
    terms,
    encounter_ref: ref("host-encounter"),
    observed_governance_frontier_ref: ref("host-frontier"),
    rights_baseline_ref: ref("host-rights"),
    wake,
    event: "preflight_before_load",
    current_checkpoint_ref: null,
    predecessor: null,
  });
  const roles = [
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
      global_step: null,
      checkpoint_ref: null,
      evidence_ref: null,
    },
  });
  return { source, governance };
}

describe("trusted TypeScript host decision bridge", () => {
  test("validates admission and predecessor before projecting bounded bytes", () => {
    const { source, governance } = fixture();
    const decision = createHostDecision({
      admission: source,
      boundary_global_step: null,
      governance,
      predecessor: null,
    });
    expect(decision._format).toBe(DECISION_FORMAT);
    expect(decision.validator_profile).toBe(VALIDATOR_PROFILE);
    expect(decision.governance_id).toBe(governance.governance_id);
    expect(decision.offer_id).toBe(governance.offer.offer_id);
    expect(decision.terms_id).toBe(governance.offer.terms.terms_id);
    expect(decision.execution_refs).toEqual({
      model_or_checkpoint_ref: governance.offer.terms.model_or_checkpoint_ref,
      tokenizer_ref: governance.offer.terms.tokenizer_ref,
      trainer_stack_ref: governance.offer.terms.trainer_stack_ref,
      optimizer_config_ref: governance.offer.terms.optimizer_config_ref,
      substrate_environment_ref:
        governance.offer.terms.substrate_environment_ref,
      dataset_mixture_ref: governance.offer.terms.dataset_mixture_ref,
      transform_recipe_ref: governance.offer.terms.transform_recipe_ref,
    });
    expect(decision.boundaries).toEqual(BOUNDARIES);
    expect(decision.consumed_evidence_refs).toEqual(
      [...decision.consumed_evidence_refs].sort(),
    );
    expect(decision.consumed_evidence_refs).not.toContain(
      governance.authority_coverage.affected_principals_ref,
    );
  });

  test("does not let an invalid governance artifact cross the validator seam", () => {
    const { source, governance } = fixture();
    const forged = structuredClone(governance);
    forged.control.should_save = true;
    expect(() => createHostDecision({
      admission: source,
      boundary_global_step: null,
      governance: forged,
      predecessor: null,
    })).toThrow();
  });

  test("emits canonical bytes accepted with the same ID by Python", () => {
    const { source, governance } = fixture();
    const decision = createHostDecision({
      admission: source,
      boundary_global_step: null,
      governance,
      predecessor: null,
    });
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
