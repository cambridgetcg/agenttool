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

type GovernanceInput = Parameters<typeof createHfTrainingGovernance>[0];

export function governanceForOffer(
  source: ReturnType<typeof admission>,
  offer: GovernanceInput["offer"],
  options: {
    choice?: "continue" | "checkpoint";
    effect?: GovernanceInput["effect"];
  } = {},
) {
  const roles = [
    "operator",
    "compute_owner",
    "substrate_steward",
    "data_custodian",
    "contributor",
  ] as const;
  const choice = options.choice ?? "continue";
  const pretraining = offer.terms.training_phase === "pretraining";
  return createHfTrainingGovernance({
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
      decision: role === "contributor"
        ? "not_applicable_with_basis" as const
        : "caller_reported_granted" as const,
      offer_ref: offer.offer_id,
      basis_ref: ref(`host-basis-${role}`),
      evidence_ref: ref(`host-evidence-${role}`),
      withdrawal_cutoff_ref: null,
    })),
    preference: pretraining
      ? {
          channel: "unavailable_pretraining",
          choice: "not_observable",
          provenance: "none",
          offer_ref: null,
          evidence_ref: null,
        }
      : {
          channel: choice === "continue"
            ? "root_signed_runtime"
            : "out_of_band_unscored",
          choice,
          provenance: choice === "continue"
            ? "caller_reported_root_signed_exact_bytes"
            : "caller_reported_isolated_runtime_output",
          offer_ref: offer.offer_id,
          evidence_ref: ref(`host-preference-${choice}`),
        },
    effect: options.effect ?? {
      state: "no_effect_reported",
      offer_ref: null,
      global_step: null,
      checkpoint_ref: null,
      evidence_ref: null,
    },
  });
}

export function governanceFixture(
  phase: "pretraining" | "evaluation" = "evaluation",
) {
  const source = admission(
    phase === "evaluation" ? "sealed_evaluation" : "training_candidate",
  );
  const terms = createTrainingGovernanceTerms({
    admission: source,
    run_ref: ref(`host-bridge-run-${phase}`),
    training_phase: phase,
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
  const preflightOffer = createTrainingGovernanceOffer({
    terms,
    encounter_ref: ref(`host-encounter-${phase}-preflight`),
    observed_governance_frontier_ref: ref(`host-frontier-${phase}-preflight`),
    rights_baseline_ref: ref("host-rights"),
    wake,
    event: "preflight_before_load",
    current_checkpoint_ref: null,
    predecessor: null,
  });
  const preflight = governanceForOffer(source, preflightOffer);
  if (phase === "pretraining") {
    return { source, governance: preflight, governancePredecessor: null };
  }
  const trainOffer = createTrainingGovernanceOffer({
    terms,
    encounter_ref: ref(`host-encounter-${phase}-train-begin`),
    observed_governance_frontier_ref: ref(`host-frontier-${phase}-train-begin`),
    rights_baseline_ref: ref("host-rights"),
    wake,
    event: "train_begin",
    current_checkpoint_ref: null,
    predecessor: preflight,
  });
  return {
    source,
    governance: governanceForOffer(source, trainOffer),
    governancePredecessor: preflight,
  };
}
