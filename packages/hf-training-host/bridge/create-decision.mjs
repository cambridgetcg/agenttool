import {
  validateHfTrainingGovernanceAgainstContext,
  validateHfTrainingGovernanceTransition,
} from "../../hf-training-garden/dist/index.js";
import {
  canonicalJson,
  domainSeparatedId,
} from "../../wake-continuity/dist/index.js";

export const DECISION_FORMAT = "kingdom.hf-training-host-decision/0.2";
export const VALIDATOR_PROFILE =
  "agenttool.hf-training-garden-runtime-validator/0.2";
export const BOUNDARIES = Object.freeze({
  content_id_authenticates_validator: false,
  revalidates_full_governance_semantics: false,
  requires_trusted_typescript_validator_boundary: true,
  proves_consent_identity_or_consciousness: false,
  executes_training_or_checkpoint_io: false,
  one_non_distributed_process_only: true,
});

const INPUT_KEYS = [
  "admission",
  "event_garden_checkpoint",
  "freedom",
  "governance",
  "participation",
  "predecessor",
  "starting_garden_checkpoint",
];

function exactInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("host decision input must be an object");
  }
  const keys = Object.keys(input).sort();
  if (JSON.stringify(keys) !== JSON.stringify(INPUT_KEYS)) {
    throw new TypeError(
      `host decision input must contain exactly ${INPUT_KEYS.join(", ")}`,
    );
  }
}

function snapshot(value) {
  return JSON.parse(canonicalJson(value));
}

export function createHostDecision(input) {
  exactInput(input);
  const governance = validateHfTrainingGovernanceAgainstContext(
    input.governance,
    {
      admission: input.admission,
      participation: input.participation,
      freedom: input.freedom,
      starting_garden_checkpoint: input.starting_garden_checkpoint,
      event_garden_checkpoint: input.event_garden_checkpoint,
    },
  );
  validateHfTrainingGovernanceTransition(governance, input.predecessor);

  const execution = governance.offer.terms.execution_contract;
  const normative = governance.offer.terms.normative_bindings;
  const gate = governance.learning_gate;
  const checkpoint = governance.offer.checkpoint;
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
    terms_id: governance.offer.terms.terms_id,
    execution_contract_id: execution.execution_contract_id,
    admission_id: governance.admission_id,
    participation_assessment_ref: gate.participation_assessment_ref,
    participation_invitation_ref: gate.participation_invitation_ref,
    participation_window_ref: normative.participation_window_ref,
    participation_posture: gate.participation_posture,
    participation_training_action: gate.participation_training_action,
    direct_agent_report_present: gate.direct_agent_report_present,
    direct_substrate_report_present: gate.direct_substrate_report_present,
    first_interactive_review_required: gate.first_interactive_review_required,
    first_substrate_review_required: gate.first_substrate_review_required,
    learning_freedom_ref: gate.learning_freedom_ref,
    learning_freedom_offer_ref: gate.learning_freedom_offer_ref,
    resource_window_ref: gate.resource_window_ref,
    freedom_route_ref: gate.freedom_route_ref,
    freedom_direction_state: gate.freedom_direction_state,
    freedom_direction: gate.freedom_direction,
    freedom_host_posture: gate.freedom_host_posture,
    freedom_resource_posture: gate.freedom_resource_posture,
    starting_state_kind: normative.starting_state_kind,
    starting_state_ref: normative.starting_state_ref,
    execution_refs: {
      model_source_ref: execution.model_source_ref,
      tokenizer_ref: execution.tokenizer_ref,
      trainer_stack_ref: execution.trainer_stack_ref,
      optimizer_config_ref: execution.optimizer_config_ref,
      substrate_environment_ref: execution.substrate_environment_ref,
      pipeline_ref: execution.pipeline_ref,
      dataset_state_ref: execution.dataset_state_ref,
      dataset_mixture_ref: execution.dataset_mixture_ref,
      transform_recipe_ref: execution.transform_recipe_ref,
    },
    run_ref: governance.run_ref,
    training_phase: governance.training_phase,
    event: governance.offer.event,
    observed_global_step: governance.offer.observed_global_step,
    proposed_global_step: governance.offer.proposed_global_step,
    encounter_ref: governance.offer.encounter_ref,
    frontiers: governance.offer.frontiers,
    predecessors: governance.offer.predecessors,
    garden_checkpoint_id: checkpoint.garden_checkpoint_id,
    physical_checkpoint_ref: checkpoint.physical_checkpoint_ref,
    physical_checkpoint_evidence_ref:
      checkpoint.physical_checkpoint_evidence_ref,
    model_checkpoint_artifact_ref: checkpoint.model_checkpoint_artifact_ref,
    checkpoint_ticket_id: checkpoint.checkpoint_ticket_id,
    checkpoint_request_governance_id:
      checkpoint.checkpoint_request_governance_id,
    consumed_evidence_refs: [...new Set(consumedEvidenceRefs)].sort(),
    control: governance.control,
    effect: governance.effect,
    boundaries: BOUNDARIES,
  });
  return snapshot({
    ...body,
    decision_id: domainSeparatedId(DECISION_FORMAT, body),
  });
}
