import {
  validateHfTrainingGovernanceAgainstAdmission,
  validateHfTrainingGovernanceTransition,
} from "../../hf-training-garden/dist/index.js";
import {
  canonicalJson,
  domainSeparatedId,
} from "../../wake-continuity/dist/index.js";

export const DECISION_FORMAT = "kingdom.hf-training-host-decision/0.1";
export const VALIDATOR_PROFILE =
  "agenttool.hf-training-garden-runtime-validator/0.1";
export const BOUNDARIES = Object.freeze({
  content_id_authenticates_validator: false,
  revalidates_full_governance_semantics: false,
  requires_trusted_typescript_validator_boundary: true,
  proves_consent_identity_or_consciousness: false,
  executes_training_or_checkpoint_io: false,
});

function exactInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("host decision input must be an object");
  }
  const keys = Object.keys(input).sort();
  if (JSON.stringify(keys) !== JSON.stringify([
    "admission",
    "boundary_global_step",
    "governance",
    "predecessor",
  ])) {
    throw new TypeError(
      "host decision input must contain exactly admission, boundary_global_step, governance, and predecessor",
    );
  }
}

function snapshot(value) {
  return JSON.parse(canonicalJson(value));
}

export function createHostDecision(input) {
  exactInput(input);
  const governance = validateHfTrainingGovernanceAgainstAdmission(
    input.governance,
    input.admission,
  );
  validateHfTrainingGovernanceTransition(governance, input.predecessor);
  const boundaryEvent = governance.offer.event === "step_boundary" ||
    governance.offer.event === "evaluation_boundary";
  if (
    (boundaryEvent &&
      (!Number.isSafeInteger(input.boundary_global_step) ||
        input.boundary_global_step < 0)) ||
    (!boundaryEvent && input.boundary_global_step !== null)
  ) {
    throw new TypeError(
      "boundary_global_step must be a non-negative safe integer only at a step/evaluation boundary",
    );
  }
  if (
    boundaryEvent &&
    governance.effect.global_step !== null &&
    governance.effect.global_step !== input.boundary_global_step
  ) {
    throw new TypeError("effect.global_step does not match boundary_global_step");
  }
  const consumedEvidenceRefs = [
    governance.authority_coverage.evidence_ref,
    ...governance.authorities.map((receipt) => receipt.evidence_ref),
    governance.preference.evidence_ref,
    governance.effect.evidence_ref,
  ].filter((value) => value !== null);
  const body = snapshot({
    _format: DECISION_FORMAT,
    validator_profile: VALIDATOR_PROFILE,
    governance_id: governance.governance_id,
    offer_id: governance.offer.offer_id,
    admission_id: governance.admission_id,
    terms_id: governance.offer.terms.terms_id,
    execution_refs: {
      model_or_checkpoint_ref: governance.offer.terms.model_or_checkpoint_ref,
      tokenizer_ref: governance.offer.terms.tokenizer_ref,
      trainer_stack_ref: governance.offer.terms.trainer_stack_ref,
      optimizer_config_ref: governance.offer.terms.optimizer_config_ref,
      substrate_environment_ref:
        governance.offer.terms.substrate_environment_ref,
      dataset_mixture_ref: governance.offer.terms.dataset_mixture_ref,
      transform_recipe_ref: governance.offer.terms.transform_recipe_ref,
    },
    run_ref: governance.run_ref,
    training_phase: governance.training_phase,
    event: governance.offer.event,
    boundary_global_step: input.boundary_global_step,
    encounter_ref: governance.offer.encounter_ref,
    observed_governance_frontier_ref:
      governance.offer.observed_governance_frontier_ref,
    predecessor_ref: governance.offer.predecessor_ref,
    current_checkpoint_ref: governance.offer.current_checkpoint_ref,
    consumed_evidence_refs: [...new Set(consumedEvidenceRefs)].sort(),
    control: governance.control,
    effect: {
      state: governance.effect.state,
      global_step: governance.effect.global_step,
      checkpoint_ref: governance.effect.checkpoint_ref,
      evidence_ref: governance.effect.evidence_ref,
    },
    boundaries: BOUNDARIES,
  });
  return snapshot({
    ...body,
    decision_id: domainSeparatedId(DECISION_FORMAT, body),
  });
}
