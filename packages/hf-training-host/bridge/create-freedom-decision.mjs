import {
  validateTrainingFreedomTransitionAgainstGovernance,
  validateTrainingFreedomTransitionAgainstPredecessor,
} from "../../hf-training-garden/dist/index.js";
import {
  canonicalJson,
  domainSeparatedId,
} from "../../wake-continuity/dist/index.js";

import {
  VALIDATOR_PROFILE,
  createHostDecision,
} from "./create-decision.mjs";

export const FREEDOM_DECISION_FORMAT =
  "kingdom.hf-training-host-freedom-decision/0.1";
export const FREEDOM_VALIDATOR_PROFILE = VALIDATOR_PROFILE;
export const FREEDOM_BOUNDARIES = Object.freeze({
  content_id_authenticates_validator: false,
  revalidates_full_freedom_semantics: false,
  requires_trusted_typescript_validator_boundary: true,
  projects_raw_choice: false,
  projects_selected_door: false,
  projects_choice_evidence: false,
  opaque_content_ids_may_be_linkable: true,
  grants_permission: false,
  can_only_narrow_governance: true,
  executes_training_or_checkpoint_io: false,
});

function exactInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("host FREEDOM decision input must be an object");
  }
  const keys = Object.keys(input).sort();
  if (JSON.stringify(keys) !== JSON.stringify([
    "admission",
    "boundary_global_step",
    "freedom_predecessor",
    "freedom_transition",
    "governance",
    "governance_predecessor",
  ])) {
    throw new TypeError(
      "host FREEDOM decision input has the wrong exact fields",
    );
  }
}

function snapshot(value) {
  return JSON.parse(canonicalJson(value));
}

export function createHostFreedomDecision(input) {
  exactInput(input);
  const governanceDecision = createHostDecision({
    admission: input.admission,
    boundary_global_step: input.boundary_global_step,
    governance: input.governance,
    predecessor: input.governance_predecessor,
  });
  const transition = validateTrainingFreedomTransitionAgainstGovernance(
    input.freedom_transition,
    input.governance,
  );
  validateTrainingFreedomTransitionAgainstPredecessor(
    transition,
    input.freedom_predecessor,
  );

  const field = transition.field;
  if (
    field.governance_ref !== governanceDecision.governance_id ||
    field.offer_ref !== governanceDecision.offer_id ||
    field.run_ref !== governanceDecision.run_ref ||
    field.training_phase !== governanceDecision.training_phase ||
    field.lifecycle_event !== governanceDecision.event
  ) {
    throw new TypeError(
      "FREEDOM transition does not bind the exact projected governance decision",
    );
  }
  if (
    ["step_boundary", "evaluation_boundary"].includes(governanceDecision.event) &&
    field.boundary_global_step !== governanceDecision.boundary_global_step
  ) {
    throw new TypeError(
      "FREEDOM transition does not bind the exact host action boundary",
    );
  }

  const directive = transition.proposal.directive === "continue_current_offer"
    ? "continue_if_governance_allows"
    : "hold_without_save";
  const body = snapshot({
    _format: FREEDOM_DECISION_FORMAT,
    validator_profile: FREEDOM_VALIDATOR_PROFILE,
    governance_decision_ref: governanceDecision.decision_id,
    governance_ref: field.governance_ref,
    offer_ref: field.offer_ref,
    freedom_field_ref: field.field_id,
    freedom_transition_ref: transition.transition_id,
    observed_freedom_frontier_ref: field.observed_freedom_frontier_ref,
    freedom_predecessor_ref: field.predecessor_ref,
    run_ref: field.run_ref,
    training_phase: field.training_phase,
    event: field.lifecycle_event,
    boundary_global_step: field.boundary_global_step,
    control: {
      directive,
      should_save: false,
      should_training_stop: directive === "hold_without_save",
      automatic: false,
      applied: false,
    },
    boundaries: FREEDOM_BOUNDARIES,
  });
  return snapshot({
    ...body,
    freedom_decision_id: domainSeparatedId(FREEDOM_DECISION_FORMAT, body),
  });
}
