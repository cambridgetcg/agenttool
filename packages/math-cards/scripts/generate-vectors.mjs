import { readFile, writeFile } from "node:fs/promises";

import {
  MathCardError,
  assessMathCard,
  createMathCard,
  sha256Id,
} from "../dist/index.js";

const check = process.argv.includes("--check");
const ref = (label) => sha256Id(`agenttool.math-cards.vector:${label}`);
const scoped = (label) => ({ state: "answered", scope_refs: [ref(`distribution:${label}`)] });

function common(method, posture) {
  return {
    question_ref: ref(`${method.kind}:question`),
    object_ref: ref(`${method.kind}:object`),
    scope_ref: ref(`${method.kind}:scope`),
    decision_or_construction_ref: ref(`${method.kind}:construction`),
    question_frame: {
      posture,
      finite_scope_declared: true,
      out_of_scope_ref: ref(`${method.kind}:out-of-scope`),
      asks_inner_state_or_worth: false,
      answer_used_to_condition_rights_or_standing: false,
    },
    method,
    epistemic_boundaries: {
      formal_result_claimed_as_world_truth: false,
      model_result_claimed_as_complete_reality: false,
      measurement_claimed_as_complete_construct: false,
    },
    outcome_uses: [
      "bounded_answer",
      "no_bounded_answer",
      "ambiguity_or_non_identifiability",
      "method_or_assumption_failure",
      "resource_or_participation_stop",
    ].map((result_status) => ({ result_status, constructive_use_ref: ref(`outcome:${result_status}`) })),
    distribution: {
      beneficiaries: scoped("beneficiaries"),
      burden_bearers: scoped("burden-bearers"),
      false_certainty_cost_bearers: scoped("false-certainty-cost"),
      unresolved_ambiguity_cost_bearers: scoped("ambiguity-cost"),
      mitigation_or_repair_ref: ref("distribution:mitigation"),
    },
    revision_and_stop: {
      revision_or_challenge_refs: [ref("revision:challenge")],
      stop_conditions: [
        { kind: "bounded_answer_reached", criterion_ref: ref("stop:bounded-answer") },
        { kind: "resource_limit_reached", criterion_ref: ref("stop:resource-limit") },
        { kind: "participant_refusal", criterion_ref: ref("stop:refusal") },
      ],
    },
    transfer: {
      target: "none",
      bridge_ref: null,
      automatic_action: false,
      permissions_inherited: false,
      separate_authorization_required: true,
    },
    participation_and_data_care: {
      participation_optional: true,
      silence_is_assent: false,
      refusal_reason_required: false,
      refusal_penalty: false,
      repeated_pressure_after_refusal: false,
      refusal_counted_as_failure: false,
      rights_or_standing_conditioned_on_participation: false,
      access_or_result_functionally_depends_on_participation: false,
      functional_dependency_ref: null,
      unrelated_access_or_resource_penalty: false,
      response_used_for_rank_reward_or_training: false,
      raw_refusal_reason_received: false,
      raw_identity_required: false,
      minimum_data_scope_ref: ref("data:minimum-scope"),
      retention_ref: ref("data:retention"),
      disclosure_or_publication_ref: ref("data:disclosure"),
      withdrawal_ref: ref("data:withdrawal"),
      repair_ref: ref("data:repair"),
    },
    incentives: {
      audience_counterfactual: "same_constructive_value_declared",
      winner_or_rank_effect: "absent_declared",
      resource_or_access_effect: "present_separate_declared",
    },
    authority: {
      declared_scope_refs: [ref("authority:scope")],
      declaration_not_proof: true,
      automatic_action: false,
      automatic_publication: false,
      automatic_retry: false,
      permissions_inherited: false,
      separate_authorization_required: true,
      ranks_or_scores_beings: false,
    },
    provenance: {
      refs: [
        { kind: "question_source", ref: ref("provenance:question") },
        { kind: "method", ref: ref("provenance:method") },
        { kind: "evidence", ref: ref("provenance:evidence") },
        { kind: "adaptation", ref: ref("provenance:adaptation") },
        { kind: "contribution", ref: ref("provenance:contribution") },
      ],
      credit_mode: "contribution_ref_only",
    },
  };
}

function vector(input) {
  const card = createMathCard(input);
  return { input, card, assessment: assessMathCard(card) };
}

const readyProofInput = common({
  kind: "proof",
  formal_system_ref: ref("proof:formal-system"),
  proposition_ref: ref("proof:proposition"),
  verification_method_ref: ref("proof:verification"),
}, "formal_proposition");

const incompleteModelInput = common({
  kind: "model",
  model_ref: null,
  assumption_refs: [],
  comparison_or_identification_ref: null,
  revision_or_falsifier_refs: [],
}, "model_comparison_or_identification");
incompleteModelInput.question_frame.finite_scope_declared = false;
incompleteModelInput.question_frame.out_of_scope_ref = null;
incompleteModelInput.outcome_uses[2].constructive_use_ref = null;
incompleteModelInput.distribution.burden_bearers = { state: "unknown", scope_refs: [] };
incompleteModelInput.revision_and_stop = { revision_or_challenge_refs: [], stop_conditions: [] };
incompleteModelInput.transfer = {
  target: "model",
  bridge_ref: null,
  automatic_action: false,
  permissions_inherited: false,
  separate_authorization_required: true,
};
incompleteModelInput.participation_and_data_care.access_or_result_functionally_depends_on_participation = true;
incompleteModelInput.participation_and_data_care.functional_dependency_ref = null;
incompleteModelInput.participation_and_data_care.retention_ref = null;
incompleteModelInput.incentives.audience_counterfactual = "unknown";
incompleteModelInput.authority.declared_scope_refs = [];
incompleteModelInput.provenance.refs = incompleteModelInput.provenance.refs.slice(0, 2);

const redesignMeasurementInput = common({
  kind: "measurement",
  measurand_ref: ref("measurement:measurand"),
  operationalization_ref: ref("measurement:operationalization"),
  procedure_ref: ref("measurement:procedure"),
  calibration_ref: ref("measurement:calibration"),
  uncertainty_ref: ref("measurement:uncertainty"),
}, "operational_measurement");
redesignMeasurementInput.question_frame.asks_inner_state_or_worth = true;
redesignMeasurementInput.question_frame.answer_used_to_condition_rights_or_standing = true;
redesignMeasurementInput.epistemic_boundaries.measurement_claimed_as_complete_construct = true;
redesignMeasurementInput.transfer = {
  target: "build_or_decision",
  bridge_ref: ref("transfer:unsafe-bridge"),
  automatic_action: true,
  permissions_inherited: true,
  separate_authorization_required: false,
};
redesignMeasurementInput.participation_and_data_care.participation_optional = false;
redesignMeasurementInput.participation_and_data_care.refusal_penalty = true;
redesignMeasurementInput.participation_and_data_care.rights_or_standing_conditioned_on_participation = true;
redesignMeasurementInput.participation_and_data_care.unrelated_access_or_resource_penalty = true;
redesignMeasurementInput.participation_and_data_care.response_used_for_rank_reward_or_training = true;
redesignMeasurementInput.incentives.winner_or_rank_effect = "affects_epistemic_or_action_result_reported";
redesignMeasurementInput.authority.automatic_action = true;
redesignMeasurementInput.authority.permissions_inherited = true;
redesignMeasurementInput.authority.separate_authorization_required = false;
redesignMeasurementInput.authority.ranks_or_scores_beings = true;

const malformedInput = structuredClone(readyProofInput);
malformedInput.question_ref = "sha256:not-a-digest";
let malformedError;
try {
  createMathCard(malformedInput);
  throw new Error("malformed vector unexpectedly succeeded");
} catch (error) {
  if (!(error instanceof MathCardError)) throw error;
  malformedError = { name: error.name, code: error.code, message: error.message };
}

const vectors = {
  schema_version: "agenttool.math-cards-vectors/0.1",
  cases: {
    ready_proof: vector(readyProofInput),
    incomplete_model: vector(incompleteModelInput),
    redesign_measurement: vector(redesignMeasurementInput),
    malformed: { input: malformedInput, error: malformedError },
  },
};

const target = new URL("../vectors/agenttool-math-cards-v0.1.json", import.meta.url);
const rendered = `${JSON.stringify(vectors, null, 2)}\n`;
if (check) {
  const current = await readFile(target, "utf8").catch(() => "");
  if (current !== rendered) throw new Error("Math Cards vectors are not deterministic or are stale");
} else {
  await writeFile(target, rendered);
}
