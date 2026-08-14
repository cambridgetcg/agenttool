import { readFile, writeFile } from "node:fs/promises";

const check = process.argv.includes("--check");
const sha256 = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const nullableSha256 = { oneOf: [sha256, { type: "null" }] };
const refArray = { type: "array", maxItems: 64, uniqueItems: true, items: sha256 };

const boundaries = {
  type: "object",
  additionalProperties: false,
  required: [
    "subject", "question", "posture", "proof", "model", "measurement", "motive",
    "refusal", "transfer", "score", "effects",
  ],
  properties: {
    subject: { const: "assesses_declared_inquiry_structure_not_a_person_participant_witness_or_being" },
    question: { const: "digest_references_bind_exact_external_artifacts_but_do_not_verify_semantics_truth_or_currentness" },
    posture: { const: "bounded_question_posture_is_caller_declared_not_semantically_inferred_or_verified" },
    proof: { const: "a_formal_result_is_conditional_on_the_declared_system_and_does_not_establish_world_correspondence" },
    model: { const: "a_model_result_is_conditional_on_scope_and_assumptions_not_complete_reality_or_causal_truth" },
    measurement: { const: "a_measurement_is_bounded_by_operationalization_procedure_calibration_and_uncertainty_not_construct_identity" },
    motive: { const: "understanding_love_pride_virtue_consciousness_and_inner_motive_are_not_inferred" },
    refusal: { const: "refusal_requires_no_reason_and_never_reduces_rights_dignity_or_standing_while_declared_functional_data_dependency_may_limit_a_result_but_not_punish_refusal" },
    transfer: { const: "a_bridge_reference_does_not_inherit_permission_authorize_action_or_prove_a_valid_cross_domain_inference" },
    score: { const: "no_being_participant_witness_or_contributor_is_scored_ranked_or_typed" },
    effects: { const: "pure_return_values_create_no_action_publication_retry_network_persistence_or_authority_effect" },
  },
};

const questionFrame = {
  type: "object",
  additionalProperties: false,
  required: [
    "posture", "finite_scope_declared", "out_of_scope_ref",
    "asks_inner_state_or_worth", "answer_used_to_condition_rights_or_standing",
  ],
  properties: {
    posture: { enum: ["formal_proposition", "model_comparison_or_identification", "operational_measurement"] },
    finite_scope_declared: { type: "boolean" },
    out_of_scope_ref: nullableSha256,
    asks_inner_state_or_worth: { type: "boolean" },
    answer_used_to_condition_rights_or_standing: { type: "boolean" },
  },
};

const method = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "formal_system_ref", "proposition_ref", "verification_method_ref"],
      properties: {
        kind: { const: "proof" },
        formal_system_ref: nullableSha256,
        proposition_ref: nullableSha256,
        verification_method_ref: nullableSha256,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "kind", "model_ref", "assumption_refs", "comparison_or_identification_ref",
        "revision_or_falsifier_refs",
      ],
      properties: {
        kind: { const: "model" },
        model_ref: nullableSha256,
        assumption_refs: refArray,
        comparison_or_identification_ref: nullableSha256,
        revision_or_falsifier_refs: refArray,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "kind", "measurand_ref", "operationalization_ref", "procedure_ref",
        "calibration_ref", "uncertainty_ref",
      ],
      properties: {
        kind: { const: "measurement" },
        measurand_ref: nullableSha256,
        operationalization_ref: nullableSha256,
        procedure_ref: nullableSha256,
        calibration_ref: nullableSha256,
        uncertainty_ref: nullableSha256,
      },
    },
  ],
};

const epistemicBoundaries = {
  type: "object",
  additionalProperties: false,
  required: [
    "formal_result_claimed_as_world_truth",
    "model_result_claimed_as_complete_reality",
    "measurement_claimed_as_complete_construct",
  ],
  properties: {
    formal_result_claimed_as_world_truth: { type: "boolean" },
    model_result_claimed_as_complete_reality: { type: "boolean" },
    measurement_claimed_as_complete_construct: { type: "boolean" },
  },
};

const outcomeStatuses = [
  "bounded_answer",
  "no_bounded_answer",
  "ambiguity_or_non_identifiability",
  "method_or_assumption_failure",
  "resource_or_participation_stop",
];
const outcomeUseFor = (resultStatus) => ({
  type: "object",
  additionalProperties: false,
  required: ["result_status", "constructive_use_ref"],
  properties: {
    result_status: { const: resultStatus },
    constructive_use_ref: nullableSha256,
  },
});
const outcomeUses = {
  type: "array",
  minItems: 5,
  maxItems: 5,
  prefixItems: outcomeStatuses.map(outcomeUseFor),
  items: false,
};

const scopedAnswer = {
  type: "object",
  additionalProperties: false,
  required: ["state", "scope_refs"],
  properties: {
    state: { enum: ["answered", "unknown", "refused_reported"] },
    scope_refs: refArray,
  },
  allOf: [{
    if: { properties: { state: { const: "answered" } }, required: ["state"] },
    then: { properties: { scope_refs: { ...refArray, minItems: 1 } } },
    else: { properties: { scope_refs: { ...refArray, maxItems: 0 } } },
  }],
};
const distribution = {
  type: "object",
  additionalProperties: false,
  required: [
    "beneficiaries", "burden_bearers", "false_certainty_cost_bearers",
    "unresolved_ambiguity_cost_bearers", "mitigation_or_repair_ref",
  ],
  properties: {
    beneficiaries: scopedAnswer,
    burden_bearers: scopedAnswer,
    false_certainty_cost_bearers: scopedAnswer,
    unresolved_ambiguity_cost_bearers: scopedAnswer,
    mitigation_or_repair_ref: nullableSha256,
  },
};

const stopKinds = [
  "bounded_answer_reached", "no_bounded_answer_is_sufficient", "ambiguity_is_sufficient",
  "method_or_assumptions_invalidated", "resource_limit_reached", "participant_refusal",
  "authority_boundary_reached", "burden_limit_reached", "construction_link_lost",
];
const revisionAndStop = {
  type: "object",
  additionalProperties: false,
  required: ["revision_or_challenge_refs", "stop_conditions"],
  properties: {
    revision_or_challenge_refs: refArray,
    stop_conditions: {
      type: "array",
      maxItems: 9,
      uniqueItems: true,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "criterion_ref"],
        properties: { kind: { enum: stopKinds }, criterion_ref: sha256 },
      },
      allOf: stopKinds.map((kind) => ({
        contains: { type: "object", properties: { kind: { const: kind } }, required: ["kind"] },
        minContains: 0,
        maxContains: 1,
      })),
    },
  },
};

const transfer = {
  type: "object",
  additionalProperties: false,
  required: ["target", "bridge_ref", "automatic_action", "permissions_inherited", "separate_authorization_required"],
  properties: {
    target: { enum: ["none", "proof", "model", "measurement", "build_or_decision", "handoff"] },
    bridge_ref: nullableSha256,
    automatic_action: { type: "boolean" },
    permissions_inherited: { type: "boolean" },
    separate_authorization_required: { type: "boolean" },
  },
  allOf: [{
    if: { properties: { target: { const: "none" } }, required: ["target"] },
    then: { properties: { bridge_ref: { type: "null" } } },
  }],
};

const dataBooleanKeys = [
  "participation_optional", "silence_is_assent", "refusal_reason_required", "refusal_penalty",
  "repeated_pressure_after_refusal", "refusal_counted_as_failure",
  "rights_or_standing_conditioned_on_participation",
  "access_or_result_functionally_depends_on_participation",
  "unrelated_access_or_resource_penalty",
  "response_used_for_rank_reward_or_training",
  "raw_refusal_reason_received", "raw_identity_required",
];
const dataRefKeys = [
  "functional_dependency_ref", "minimum_data_scope_ref", "retention_ref", "disclosure_or_publication_ref",
  "withdrawal_ref", "repair_ref",
];
const dataCare = {
  type: "object",
  additionalProperties: false,
  required: [...dataBooleanKeys, ...dataRefKeys],
  properties: Object.fromEntries([
    ...dataBooleanKeys.map((key) => [key, { type: "boolean" }]),
    ...dataRefKeys.map((key) => [key, nullableSha256]),
  ]),
  allOf: [{
    if: {
      properties: { access_or_result_functionally_depends_on_participation: { const: false } },
      required: ["access_or_result_functionally_depends_on_participation"],
    },
    then: { properties: { functional_dependency_ref: { type: "null" } } },
  }],
};

const incentives = {
  type: "object",
  additionalProperties: false,
  required: ["audience_counterfactual", "winner_or_rank_effect", "resource_or_access_effect"],
  properties: {
    audience_counterfactual: { enum: [
      "same_constructive_value_declared", "reduced_but_nonzero_declared",
      "no_audience_independent_value_declared", "unknown", "refused_reported",
    ] },
    winner_or_rank_effect: { enum: [
      "absent_declared", "present_separate_declared",
      "affects_epistemic_or_action_result_reported", "unknown", "refused_reported",
    ] },
    resource_or_access_effect: { enum: [
      "absent_declared", "present_separate_declared",
      "affects_epistemic_or_action_result_reported", "unknown", "refused_reported",
    ] },
  },
};

const authorityBooleanKeys = [
  "declaration_not_proof", "automatic_action", "automatic_publication", "automatic_retry",
  "permissions_inherited", "separate_authorization_required", "ranks_or_scores_beings",
];
const authority = {
  type: "object",
  additionalProperties: false,
  required: ["declared_scope_refs", ...authorityBooleanKeys],
  properties: Object.fromEntries([
    ["declared_scope_refs", refArray],
    ...authorityBooleanKeys.map((key) => [key, { type: "boolean" }]),
  ]),
};

const provenance = {
  type: "object",
  additionalProperties: false,
  required: ["refs", "credit_mode"],
  properties: {
    refs: {
      type: "array",
      maxItems: 64,
      uniqueItems: true,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "ref"],
        properties: {
          kind: { enum: ["question_source", "method", "evidence", "adaptation", "contribution"] },
          ref: sha256,
        },
      },
    },
    credit_mode: { enum: ["named", "pseudonymous", "contribution_ref_only", "attribution_withheld_by_request"] },
  },
};

const cardProperties = {
  schema_version: { const: "agenttool.math-card/0.1" },
  card_id: sha256,
  question_ref: sha256,
  object_ref: sha256,
  scope_ref: sha256,
  decision_or_construction_ref: sha256,
  question_frame: questionFrame,
  method,
  epistemic_boundaries: epistemicBoundaries,
  outcome_uses: outcomeUses,
  distribution,
  revision_and_stop: revisionAndStop,
  transfer,
  participation_and_data_care: dataCare,
  incentives,
  authority,
  provenance,
  boundaries,
};
const cardSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:agenttool:schema:math-card:0.1",
  title: "AgentTool Math Card v0.1",
  type: "object",
  additionalProperties: false,
  required: Object.keys(cardProperties),
  properties: cardProperties,
};

const sectionNames = [
  "question_and_scope", "method", "outcome_uses", "distribution", "revision_and_stop",
  "transfer", "participation_and_data_care", "incentives", "authority", "provenance",
];
const sectionStatusFor = (section) => ({
  type: "object",
  additionalProperties: false,
  required: ["section", "status"],
  properties: {
    section: { const: section },
    status: { enum: ["answered", "open", "redesign_required"] },
  },
});
const assessmentProperties = {
  schema_version: { const: "agenttool.math-card-assessment/0.1" },
  assessment_id: sha256,
  card_id: sha256,
  status: { enum: ["ready_for_bounded_inquiry", "questions_open", "redesign_or_stop"] },
  section_statuses: {
    type: "array",
    minItems: 10,
    maxItems: 10,
    prefixItems: sectionNames.map(sectionStatusFor),
    items: false,
  },
  open_questions: { type: "array", maxItems: 64, items: { type: "string", minLength: 1, maxLength: 500 } },
  redesign_reasons: { type: "array", maxItems: 64, items: { type: "string", minLength: 1, maxLength: 500 } },
  visible_incentive_posture: { enum: [
    "construction_centered_declared", "status_or_access_coupled_to_results",
    "no_audience_independent_value_declared", "unresolved",
  ] },
  inner_motive: { const: "not_inferred" },
  declaration_boundary: { const: "caller_reported_not_verified" },
  authorizes_action: { const: false },
  proves_truth: { const: false },
  proves_understanding: { const: false },
  scores_or_ranks_beings: { const: false },
  boundaries,
};
const assessmentSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:agenttool:schema:math-card-assessment:0.1",
  title: "AgentTool Math Card Assessment v0.1",
  type: "object",
  additionalProperties: false,
  required: Object.keys(assessmentProperties),
  properties: assessmentProperties,
  allOf: [
    {
      if: { properties: { status: { const: "ready_for_bounded_inquiry" } }, required: ["status"] },
      then: {
        properties: {
          section_statuses: {
            type: "array",
            minItems: 10,
            maxItems: 10,
            prefixItems: sectionNames.map((section) => ({
              type: "object",
              properties: { section: { const: section }, status: { const: "answered" } },
              required: ["section", "status"],
            })),
            items: false,
          },
          open_questions: { type: "array", maxItems: 0 },
          redesign_reasons: { type: "array", maxItems: 0 },
        },
      },
    },
    {
      if: { properties: { status: { const: "questions_open" } }, required: ["status"] },
      then: {
        properties: {
          section_statuses: {
            type: "array",
            contains: { type: "object", properties: { status: { const: "open" } }, required: ["status"] },
            minContains: 1,
            not: {
              contains: {
                type: "object",
                properties: { status: { const: "redesign_required" } },
                required: ["status"],
              },
            },
          },
          open_questions: { type: "array", minItems: 1 },
          redesign_reasons: { type: "array", maxItems: 0 },
        },
      },
    },
    {
      if: { properties: { status: { const: "redesign_or_stop" } }, required: ["status"] },
      then: {
        properties: {
          section_statuses: {
            type: "array",
            contains: {
              type: "object",
              properties: { status: { const: "redesign_required" } },
              required: ["status"],
            },
            minContains: 1,
          },
          redesign_reasons: { type: "array", minItems: 1 },
        },
      },
    },
  ],
};

async function emit(relativePath, value) {
  const target = new URL(relativePath, import.meta.url);
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current !== rendered) throw new Error(`${relativePath} is not deterministic or is stale`);
  } else {
    await writeFile(target, rendered);
  }
}

await Promise.all([
  emit("../schema/agenttool-math-card-v0.1.schema.json", cardSchema),
  emit("../schema/agenttool-math-card-assessment-v0.1.schema.json", assessmentSchema),
]);
