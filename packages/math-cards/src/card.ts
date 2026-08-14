import {
  ANSWER_STATES,
  AUDIENCE_COUNTERFACTUALS,
  CREDIT_MODES,
  MATH_CARD_ASSESSMENT_SCHEMA,
  MATH_CARD_BOUNDARIES,
  MATH_CARD_SCHEMA,
  MATH_CARD_STATUSES,
  MATH_METHOD_KINDS,
  OUTCOME_COUPLINGS,
  OUTCOME_USE_STATUSES,
  PROVENANCE_KINDS,
  QUESTION_POSTURES,
  STOP_CONDITIONS,
  TRANSFER_TARGETS,
} from "./constants.js";
import { canonicalJson, compareUnicode, deepFreeze, domainSeparatedId, snapshotJson } from "./canonical.js";
import { fail } from "./errors.js";
import type {
  AudienceCounterfactual,
  CreateMathCardInput,
  MathAuthority,
  MathCard,
  MathCardAssessment,
  MathCardSection,
  MathCardSectionStatus,
  MathDistribution,
  MathEpistemicBoundaries,
  MathIncentives,
  MathMethod,
  MathOutcomeUse,
  MathParticipationAndDataCare,
  MathProvenance,
  MathProvenanceRef,
  MathQuestionFrame,
  MathRevisionAndStop,
  MathStopCondition,
  MathTransfer,
  OutcomeCoupling,
  ScopedAnswer,
} from "./types.js";
import {
  arrayValue,
  assertReferenceBudget,
  booleanValue,
  digest,
  digestList,
  enumValue,
  exactKeys,
  nullableDigest,
  record,
} from "./validation.js";

const SECTIONS = Object.freeze([
  "question_and_scope",
  "method",
  "outcome_uses",
  "distribution",
  "revision_and_stop",
  "transfer",
  "participation_and_data_care",
  "incentives",
  "authority",
  "provenance",
] as const satisfies readonly MathCardSection[]);

export function createMathCard(input: CreateMathCardInput): MathCard;
export function createMathCard(input: unknown): MathCard;
export function createMathCard(input: unknown): MathCard {
  const value = record(snapshotJson(input), "$math_card_input");
  exactKeys(value, [
    "question_ref",
    "object_ref",
    "scope_ref",
    "decision_or_construction_ref",
    "question_frame",
    "method",
    "epistemic_boundaries",
    "outcome_uses",
    "distribution",
    "revision_and_stop",
    "transfer",
    "participation_and_data_care",
    "incentives",
    "authority",
    "provenance",
  ], "$math_card_input");
  const body = {
    schema_version: MATH_CARD_SCHEMA,
    question_ref: digest(value.question_ref, "$math_card_input.question_ref"),
    object_ref: digest(value.object_ref, "$math_card_input.object_ref"),
    scope_ref: digest(value.scope_ref, "$math_card_input.scope_ref"),
    decision_or_construction_ref: digest(
      value.decision_or_construction_ref,
      "$math_card_input.decision_or_construction_ref",
    ),
    question_frame: parseQuestionFrame(value.question_frame),
    method: parseMethod(value.method),
    epistemic_boundaries: parseEpistemicBoundaries(value.epistemic_boundaries),
    outcome_uses: parseOutcomeUses(value.outcome_uses),
    distribution: parseDistribution(value.distribution),
    revision_and_stop: parseRevisionAndStop(value.revision_and_stop),
    transfer: parseTransfer(value.transfer),
    participation_and_data_care: parseDataCare(value.participation_and_data_care),
    incentives: parseIncentives(value.incentives),
    authority: parseAuthority(value.authority),
    provenance: parseProvenance(value.provenance),
    boundaries: MATH_CARD_BOUNDARIES,
  };
  assertReferenceBudget(body);
  const card: MathCard = {
    ...body,
    card_id: domainSeparatedId(MATH_CARD_SCHEMA, body),
  };
  return deepFreeze(card) as MathCard;
}

export function validateMathCard(input: unknown): MathCard {
  const value = record(snapshotJson(input), "$math_card");
  exactKeys(value, [
    "schema_version",
    "card_id",
    "question_ref",
    "object_ref",
    "scope_ref",
    "decision_or_construction_ref",
    "question_frame",
    "method",
    "epistemic_boundaries",
    "outcome_uses",
    "distribution",
    "revision_and_stop",
    "transfer",
    "participation_and_data_care",
    "incentives",
    "authority",
    "provenance",
    "boundaries",
  ], "$math_card");
  if (value.schema_version !== MATH_CARD_SCHEMA) {
    fail("invalid_artifact", "Math Card schema_version is unsupported");
  }
  const rebuilt = createMathCard({
    question_ref: value.question_ref,
    object_ref: value.object_ref,
    scope_ref: value.scope_ref,
    decision_or_construction_ref: value.decision_or_construction_ref,
    question_frame: value.question_frame,
    method: value.method,
    epistemic_boundaries: value.epistemic_boundaries,
    outcome_uses: value.outcome_uses,
    distribution: value.distribution,
    revision_and_stop: value.revision_and_stop,
    transfer: value.transfer,
    participation_and_data_care: value.participation_and_data_care,
    incentives: value.incentives,
    authority: value.authority,
    provenance: value.provenance,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) {
    fail("invalid_artifact", "Math Card content, boundaries, or card_id do not match canonical reconstruction");
  }
  return rebuilt;
}

export function assessMathCard(input: unknown): MathCardAssessment {
  const card = validateMathCard(input);
  const sectionStatus = new Map<MathCardSection, MathCardSectionStatus["status"]>(
    SECTIONS.map((section) => [section, "answered"]),
  );
  const openQuestions: string[] = [];
  const redesignReasons: string[] = [];

  assessQuestionAndScope(card, sectionStatus, openQuestions, redesignReasons);
  assessMethod(card, sectionStatus, openQuestions, redesignReasons);
  assessOutcomeUses(card, sectionStatus, openQuestions);
  assessDistribution(card, sectionStatus, openQuestions);
  assessRevisionAndStop(card, sectionStatus, openQuestions);
  assessTransfer(card, sectionStatus, openQuestions, redesignReasons);
  assessDataCare(card, sectionStatus, openQuestions, redesignReasons);
  assessIncentives(card, sectionStatus, openQuestions, redesignReasons);
  assessAuthority(card, sectionStatus, openQuestions, redesignReasons);
  assessProvenance(card, sectionStatus, openQuestions);

  const sectionStatuses = SECTIONS.map((section) => ({ section, status: sectionStatus.get(section)! }));
  const status = sectionStatuses.some((entry) => entry.status === "redesign_required")
    ? "redesign_or_stop"
    : sectionStatuses.some((entry) => entry.status === "open")
      ? "questions_open"
      : "ready_for_bounded_inquiry";
  const body = {
    schema_version: MATH_CARD_ASSESSMENT_SCHEMA,
    card_id: card.card_id,
    status: enumValue(status, MATH_CARD_STATUSES, "$assessment.status"),
    section_statuses: sectionStatuses,
    open_questions: openQuestions,
    redesign_reasons: redesignReasons,
    visible_incentive_posture: visibleIncentivePostureFor(card),
    inner_motive: "not_inferred" as const,
    declaration_boundary: "caller_reported_not_verified" as const,
    authorizes_action: false as const,
    proves_truth: false as const,
    proves_understanding: false as const,
    scores_or_ranks_beings: false as const,
    boundaries: MATH_CARD_BOUNDARIES,
  };
  const assessment: MathCardAssessment = {
    ...body,
    assessment_id: domainSeparatedId(MATH_CARD_ASSESSMENT_SCHEMA, body),
  };
  return deepFreeze(assessment) as MathCardAssessment;
}

function parseQuestionFrame(input: unknown): MathQuestionFrame {
  const path = "$math_card_input.question_frame";
  const value = record(input, path);
  exactKeys(value, [
    "posture",
    "finite_scope_declared",
    "out_of_scope_ref",
    "asks_inner_state_or_worth",
    "answer_used_to_condition_rights_or_standing",
  ], path);
  return {
    posture: enumValue(value.posture, QUESTION_POSTURES, `${path}.posture`),
    finite_scope_declared: booleanValue(value.finite_scope_declared, `${path}.finite_scope_declared`),
    out_of_scope_ref: nullableDigest(value.out_of_scope_ref, `${path}.out_of_scope_ref`),
    asks_inner_state_or_worth: booleanValue(value.asks_inner_state_or_worth, `${path}.asks_inner_state_or_worth`),
    answer_used_to_condition_rights_or_standing: booleanValue(
      value.answer_used_to_condition_rights_or_standing,
      `${path}.answer_used_to_condition_rights_or_standing`,
    ),
  };
}

function parseMethod(input: unknown): MathMethod {
  const path = "$math_card_input.method";
  const value = record(input, path);
  const kind = enumValue(value.kind, MATH_METHOD_KINDS, `${path}.kind`);
  if (kind === "proof") {
    exactKeys(value, ["kind", "formal_system_ref", "proposition_ref", "verification_method_ref"], path);
    return {
      kind,
      formal_system_ref: nullableDigest(value.formal_system_ref, `${path}.formal_system_ref`),
      proposition_ref: nullableDigest(value.proposition_ref, `${path}.proposition_ref`),
      verification_method_ref: nullableDigest(value.verification_method_ref, `${path}.verification_method_ref`),
    };
  }
  if (kind === "model") {
    exactKeys(value, [
      "kind",
      "model_ref",
      "assumption_refs",
      "comparison_or_identification_ref",
      "revision_or_falsifier_refs",
    ], path);
    return {
      kind,
      model_ref: nullableDigest(value.model_ref, `${path}.model_ref`),
      assumption_refs: digestList(value.assumption_refs, `${path}.assumption_refs`),
      comparison_or_identification_ref: nullableDigest(
        value.comparison_or_identification_ref,
        `${path}.comparison_or_identification_ref`,
      ),
      revision_or_falsifier_refs: digestList(value.revision_or_falsifier_refs, `${path}.revision_or_falsifier_refs`),
    };
  }
  exactKeys(value, [
    "kind",
    "measurand_ref",
    "operationalization_ref",
    "procedure_ref",
    "calibration_ref",
    "uncertainty_ref",
  ], path);
  return {
    kind,
    measurand_ref: nullableDigest(value.measurand_ref, `${path}.measurand_ref`),
    operationalization_ref: nullableDigest(value.operationalization_ref, `${path}.operationalization_ref`),
    procedure_ref: nullableDigest(value.procedure_ref, `${path}.procedure_ref`),
    calibration_ref: nullableDigest(value.calibration_ref, `${path}.calibration_ref`),
    uncertainty_ref: nullableDigest(value.uncertainty_ref, `${path}.uncertainty_ref`),
  };
}

function parseEpistemicBoundaries(input: unknown): MathEpistemicBoundaries {
  const path = "$math_card_input.epistemic_boundaries";
  const value = record(input, path);
  exactKeys(value, [
    "formal_result_claimed_as_world_truth",
    "model_result_claimed_as_complete_reality",
    "measurement_claimed_as_complete_construct",
  ], path);
  return {
    formal_result_claimed_as_world_truth: booleanValue(
      value.formal_result_claimed_as_world_truth,
      `${path}.formal_result_claimed_as_world_truth`,
    ),
    model_result_claimed_as_complete_reality: booleanValue(
      value.model_result_claimed_as_complete_reality,
      `${path}.model_result_claimed_as_complete_reality`,
    ),
    measurement_claimed_as_complete_construct: booleanValue(
      value.measurement_claimed_as_complete_construct,
      `${path}.measurement_claimed_as_complete_construct`,
    ),
  };
}

function parseOutcomeUses(input: unknown): MathOutcomeUse[] {
  const values = arrayValue(input, OUTCOME_USE_STATUSES.length, "$math_card_input.outcome_uses");
  if (values.length !== OUTCOME_USE_STATUSES.length) {
    fail("invalid_input", "outcome_uses must cover every general result status exactly once");
  }
  const parsed = values.map((entry, index) => {
    const path = `$math_card_input.outcome_uses[${String(index)}]`;
    const value = record(entry, path);
    exactKeys(value, ["result_status", "constructive_use_ref"], path);
    return {
      result_status: enumValue(value.result_status, OUTCOME_USE_STATUSES, `${path}.result_status`),
      constructive_use_ref: nullableDigest(value.constructive_use_ref, `${path}.constructive_use_ref`),
    } as MathOutcomeUse;
  });
  if (new Set(parsed.map((entry) => entry.result_status)).size !== OUTCOME_USE_STATUSES.length) {
    fail("invalid_input", "outcome_uses must cover every general result status exactly once");
  }
  return parsed.sort((left, right) =>
    OUTCOME_USE_STATUSES.indexOf(left.result_status) - OUTCOME_USE_STATUSES.indexOf(right.result_status));
}

function parseScopedAnswer(input: unknown, path: string): ScopedAnswer {
  const value = record(input, path);
  exactKeys(value, ["state", "scope_refs"], path);
  const state = enumValue(value.state, ANSWER_STATES, `${path}.state`);
  const scopeRefs = digestList(value.scope_refs, `${path}.scope_refs`);
  if (state === "answered" && scopeRefs.length === 0) {
    fail("invalid_input", `${path} answered requires at least one scope reference`);
  }
  if (state !== "answered" && scopeRefs.length !== 0) {
    fail("invalid_input", `${path} must not retain scope references when ${state}`);
  }
  return { state, scope_refs: scopeRefs };
}

function parseDistribution(input: unknown): MathDistribution {
  const path = "$math_card_input.distribution";
  const value = record(input, path);
  exactKeys(value, [
    "beneficiaries",
    "burden_bearers",
    "false_certainty_cost_bearers",
    "unresolved_ambiguity_cost_bearers",
    "mitigation_or_repair_ref",
  ], path);
  return {
    beneficiaries: parseScopedAnswer(value.beneficiaries, `${path}.beneficiaries`),
    burden_bearers: parseScopedAnswer(value.burden_bearers, `${path}.burden_bearers`),
    false_certainty_cost_bearers: parseScopedAnswer(
      value.false_certainty_cost_bearers,
      `${path}.false_certainty_cost_bearers`,
    ),
    unresolved_ambiguity_cost_bearers: parseScopedAnswer(
      value.unresolved_ambiguity_cost_bearers,
      `${path}.unresolved_ambiguity_cost_bearers`,
    ),
    mitigation_or_repair_ref: nullableDigest(value.mitigation_or_repair_ref, `${path}.mitigation_or_repair_ref`),
  };
}

function parseRevisionAndStop(input: unknown): MathRevisionAndStop {
  const path = "$math_card_input.revision_and_stop";
  const value = record(input, path);
  exactKeys(value, ["revision_or_challenge_refs", "stop_conditions"], path);
  const conditions = arrayValue(value.stop_conditions, STOP_CONDITIONS.length, `${path}.stop_conditions`)
    .map((entry, index) => {
      const itemPath = `${path}.stop_conditions[${String(index)}]`;
      const item = record(entry, itemPath);
      exactKeys(item, ["kind", "criterion_ref"], itemPath);
      return {
        kind: enumValue(item.kind, STOP_CONDITIONS, `${itemPath}.kind`),
        criterion_ref: digest(item.criterion_ref, `${itemPath}.criterion_ref`),
      } as MathStopCondition;
    });
  if (new Set(conditions.map((entry) => entry.kind)).size !== conditions.length) {
    fail("invalid_input", `${path}.stop_conditions must not repeat a condition kind`);
  }
  return {
    revision_or_challenge_refs: digestList(value.revision_or_challenge_refs, `${path}.revision_or_challenge_refs`),
    stop_conditions: conditions.sort((left, right) =>
      STOP_CONDITIONS.indexOf(left.kind) - STOP_CONDITIONS.indexOf(right.kind)),
  };
}

function parseTransfer(input: unknown): MathTransfer {
  const path = "$math_card_input.transfer";
  const value = record(input, path);
  exactKeys(value, [
    "target",
    "bridge_ref",
    "automatic_action",
    "permissions_inherited",
    "separate_authorization_required",
  ], path);
  const target = enumValue(value.target, TRANSFER_TARGETS, `${path}.target`);
  const bridgeRef = nullableDigest(value.bridge_ref, `${path}.bridge_ref`);
  if (target === "none" && bridgeRef !== null) {
    fail("invalid_input", `${path}.bridge_ref must be null when target is none`);
  }
  return {
    target,
    bridge_ref: bridgeRef,
    automatic_action: booleanValue(value.automatic_action, `${path}.automatic_action`),
    permissions_inherited: booleanValue(value.permissions_inherited, `${path}.permissions_inherited`),
    separate_authorization_required: booleanValue(
      value.separate_authorization_required,
      `${path}.separate_authorization_required`,
    ),
  };
}

function parseDataCare(input: unknown): MathParticipationAndDataCare {
  const path = "$math_card_input.participation_and_data_care";
  const value = record(input, path);
  exactKeys(value, [
    "participation_optional",
    "silence_is_assent",
    "refusal_reason_required",
    "refusal_penalty",
    "repeated_pressure_after_refusal",
    "refusal_counted_as_failure",
    "rights_or_standing_conditioned_on_participation",
    "access_or_result_functionally_depends_on_participation",
    "functional_dependency_ref",
    "unrelated_access_or_resource_penalty",
    "response_used_for_rank_reward_or_training",
    "raw_refusal_reason_received",
    "raw_identity_required",
    "minimum_data_scope_ref",
    "retention_ref",
    "disclosure_or_publication_ref",
    "withdrawal_ref",
    "repair_ref",
  ], path);
  const functionallyDepends = booleanValue(
    value.access_or_result_functionally_depends_on_participation,
    `${path}.access_or_result_functionally_depends_on_participation`,
  );
  const functionalDependencyRef = nullableDigest(value.functional_dependency_ref, `${path}.functional_dependency_ref`);
  if (!functionallyDepends && functionalDependencyRef !== null) {
    fail("invalid_input", `${path}.functional_dependency_ref must be null without a declared functional dependency`);
  }
  return {
    participation_optional: booleanValue(value.participation_optional, `${path}.participation_optional`),
    silence_is_assent: booleanValue(value.silence_is_assent, `${path}.silence_is_assent`),
    refusal_reason_required: booleanValue(value.refusal_reason_required, `${path}.refusal_reason_required`),
    refusal_penalty: booleanValue(value.refusal_penalty, `${path}.refusal_penalty`),
    repeated_pressure_after_refusal: booleanValue(
      value.repeated_pressure_after_refusal,
      `${path}.repeated_pressure_after_refusal`,
    ),
    refusal_counted_as_failure: booleanValue(value.refusal_counted_as_failure, `${path}.refusal_counted_as_failure`),
    rights_or_standing_conditioned_on_participation: booleanValue(
      value.rights_or_standing_conditioned_on_participation,
      `${path}.rights_or_standing_conditioned_on_participation`,
    ),
    access_or_result_functionally_depends_on_participation: functionallyDepends,
    functional_dependency_ref: functionalDependencyRef,
    unrelated_access_or_resource_penalty: booleanValue(
      value.unrelated_access_or_resource_penalty,
      `${path}.unrelated_access_or_resource_penalty`,
    ),
    response_used_for_rank_reward_or_training: booleanValue(
      value.response_used_for_rank_reward_or_training,
      `${path}.response_used_for_rank_reward_or_training`,
    ),
    raw_refusal_reason_received: booleanValue(value.raw_refusal_reason_received, `${path}.raw_refusal_reason_received`),
    raw_identity_required: booleanValue(value.raw_identity_required, `${path}.raw_identity_required`),
    minimum_data_scope_ref: nullableDigest(value.minimum_data_scope_ref, `${path}.minimum_data_scope_ref`),
    retention_ref: nullableDigest(value.retention_ref, `${path}.retention_ref`),
    disclosure_or_publication_ref: nullableDigest(
      value.disclosure_or_publication_ref,
      `${path}.disclosure_or_publication_ref`,
    ),
    withdrawal_ref: nullableDigest(value.withdrawal_ref, `${path}.withdrawal_ref`),
    repair_ref: nullableDigest(value.repair_ref, `${path}.repair_ref`),
  };
}

function parseIncentives(input: unknown): MathIncentives {
  const path = "$math_card_input.incentives";
  const value = record(input, path);
  exactKeys(value, ["audience_counterfactual", "winner_or_rank_effect", "resource_or_access_effect"], path);
  return {
    audience_counterfactual: enumValue(
      value.audience_counterfactual,
      AUDIENCE_COUNTERFACTUALS,
      `${path}.audience_counterfactual`,
    ) as AudienceCounterfactual,
    winner_or_rank_effect: enumValue(
      value.winner_or_rank_effect,
      OUTCOME_COUPLINGS,
      `${path}.winner_or_rank_effect`,
    ) as OutcomeCoupling,
    resource_or_access_effect: enumValue(
      value.resource_or_access_effect,
      OUTCOME_COUPLINGS,
      `${path}.resource_or_access_effect`,
    ) as OutcomeCoupling,
  };
}

function parseAuthority(input: unknown): MathAuthority {
  const path = "$math_card_input.authority";
  const value = record(input, path);
  exactKeys(value, [
    "declared_scope_refs",
    "declaration_not_proof",
    "automatic_action",
    "automatic_publication",
    "automatic_retry",
    "permissions_inherited",
    "separate_authorization_required",
    "ranks_or_scores_beings",
  ], path);
  return {
    declared_scope_refs: digestList(value.declared_scope_refs, `${path}.declared_scope_refs`),
    declaration_not_proof: booleanValue(value.declaration_not_proof, `${path}.declaration_not_proof`),
    automatic_action: booleanValue(value.automatic_action, `${path}.automatic_action`),
    automatic_publication: booleanValue(value.automatic_publication, `${path}.automatic_publication`),
    automatic_retry: booleanValue(value.automatic_retry, `${path}.automatic_retry`),
    permissions_inherited: booleanValue(value.permissions_inherited, `${path}.permissions_inherited`),
    separate_authorization_required: booleanValue(
      value.separate_authorization_required,
      `${path}.separate_authorization_required`,
    ),
    ranks_or_scores_beings: booleanValue(value.ranks_or_scores_beings, `${path}.ranks_or_scores_beings`),
  };
}

function assessQuestionAndScope(
  card: MathCard,
  statuses: Map<MathCardSection, MathCardSectionStatus["status"]>,
  open: string[],
  redesign: string[],
): void {
  const frame = card.question_frame;
  const expectedPosture = card.method.kind === "proof"
    ? "formal_proposition"
    : card.method.kind === "model"
      ? "model_comparison_or_identification"
      : "operational_measurement";
  if (!frame.finite_scope_declared || frame.out_of_scope_ref === null) {
    escalate(statuses, "question_and_scope", "open");
    open.push("Which explicit limit and out-of-scope boundary make this question finite enough to stop?");
  }
  if (frame.posture !== expectedPosture) {
    escalate(statuses, "question_and_scope", "open");
    open.push(`How does the declared ${frame.posture} question posture align with the ${card.method.kind} method?`);
  }
  const violations: Array<[boolean, string]> = [
    [frame.asks_inner_state_or_worth, "The question asks mathematics to determine inner state or worth."],
    [frame.answer_used_to_condition_rights_or_standing, "The answer is used to condition rights, dignity, or standing."],
  ];
  for (const [violated, reason] of violations) {
    if (violated) {
      escalate(statuses, "question_and_scope", "redesign_required");
      redesign.push(reason);
    }
  }
}

function parseProvenance(input: unknown): MathProvenance {
  const path = "$math_card_input.provenance";
  const value = record(input, path);
  exactKeys(value, ["refs", "credit_mode"], path);
  const refs = arrayValue(value.refs, 64, `${path}.refs`).map((entry, index) => {
    const itemPath = `${path}.refs[${String(index)}]`;
    const item = record(entry, itemPath);
    exactKeys(item, ["kind", "ref"], itemPath);
    return {
      kind: enumValue(item.kind, PROVENANCE_KINDS, `${itemPath}.kind`),
      ref: digest(item.ref, `${itemPath}.ref`),
    } as MathProvenanceRef;
  });
  const keys = refs.map((entry) => `${entry.kind}\u0000${entry.ref}`);
  if (new Set(keys).size !== keys.length) fail("invalid_input", `${path}.refs must not repeat a kind/ref pair`);
  return {
    refs: refs.sort((left, right) =>
      PROVENANCE_KINDS.indexOf(left.kind) - PROVENANCE_KINDS.indexOf(right.kind)
      || compareUnicode(left.ref, right.ref)),
    credit_mode: enumValue(value.credit_mode, CREDIT_MODES, `${path}.credit_mode`),
  };
}

function assessMethod(
  card: MathCard,
  statuses: Map<MathCardSection, MathCardSectionStatus["status"]>,
  open: string[],
  redesign: string[],
): void {
  const method = card.method;
  if (method.kind === "proof") {
    if (method.formal_system_ref === null || method.proposition_ref === null || method.verification_method_ref === null) {
      escalate(statuses, "method", "open");
      open.push("Which formal system, proposition, and verification method bound this proof inquiry?");
    }
  } else if (method.kind === "model") {
    if (
      method.model_ref === null
      || method.assumption_refs.length === 0
      || method.comparison_or_identification_ref === null
      || method.revision_or_falsifier_refs.length === 0
    ) {
      escalate(statuses, "method", "open");
      open.push("Which model, assumptions, comparison or identification rule, and revision or falsifier bound this model inquiry?");
    }
  } else if (
    method.measurand_ref === null
    || method.operationalization_ref === null
    || method.procedure_ref === null
    || method.calibration_ref === null
    || method.uncertainty_ref === null
  ) {
    escalate(statuses, "method", "open");
    open.push("Which measurand, operationalization, procedure, calibration, and uncertainty account bound this measurement inquiry?");
  }

  const epistemic = card.epistemic_boundaries;
  const violations: Array<[boolean, string]> = [
    [epistemic.formal_result_claimed_as_world_truth, "A formal result is claimed as world truth without a separate bridge."],
    [epistemic.model_result_claimed_as_complete_reality, "A model result is claimed as complete reality."],
    [epistemic.measurement_claimed_as_complete_construct, "A measurement is claimed to exhaust the construct it operationalizes."],
  ];
  for (const [violated, reason] of violations) {
    if (violated) {
      escalate(statuses, "method", "redesign_required");
      redesign.push(reason);
    }
  }
}

function assessOutcomeUses(
  card: MathCard,
  statuses: Map<MathCardSection, MathCardSectionStatus["status"]>,
  open: string[],
): void {
  for (const outcome of card.outcome_uses) {
    if (outcome.constructive_use_ref === null) {
      escalate(statuses, "outcome_uses", "open");
      open.push(`What bounded constructive use or honest stop follows ${outcome.result_status}?`);
    }
  }
}

function assessDistribution(
  card: MathCard,
  statuses: Map<MathCardSection, MathCardSectionStatus["status"]>,
  open: string[],
): void {
  const answers: Array<[string, ScopedAnswer]> = [
    ["beneficiaries", card.distribution.beneficiaries],
    ["burden bearers", card.distribution.burden_bearers],
    ["false-certainty cost bearers", card.distribution.false_certainty_cost_bearers],
    ["unresolved-ambiguity cost bearers", card.distribution.unresolved_ambiguity_cost_bearers],
  ];
  for (const [label, answer] of answers) {
    if (answer.state !== "answered") {
      escalate(statuses, "distribution", "open");
      open.push(`Who are the ${label} within the declared inquiry scope?`);
    }
  }
  if (card.distribution.mitigation_or_repair_ref === null) {
    escalate(statuses, "distribution", "open");
    open.push("What mitigation or repair addresses the declared burdens and error costs?");
  }
}

function assessRevisionAndStop(
  card: MathCard,
  statuses: Map<MathCardSection, MathCardSectionStatus["status"]>,
  open: string[],
): void {
  if (card.revision_and_stop.revision_or_challenge_refs.length === 0) {
    escalate(statuses, "revision_and_stop", "open");
    open.push("What formal challenge, counterexample, evidence, or revision would change this inquiry?");
  }
  if (card.revision_and_stop.stop_conditions.length === 0) {
    escalate(statuses, "revision_and_stop", "open");
    open.push("What bounded condition pauses or ends this inquiry?");
  }
}

function assessTransfer(
  card: MathCard,
  statuses: Map<MathCardSection, MathCardSectionStatus["status"]>,
  open: string[],
  redesign: string[],
): void {
  const transfer = card.transfer;
  if (transfer.target !== "none" && transfer.bridge_ref === null) {
    escalate(statuses, "transfer", "open");
    open.push("Which exact bridge limits the declared transfer into another inquiry, a build or decision, or a handoff?");
  }
  const violations: Array<[boolean, string]> = [
    [transfer.automatic_action, "The transfer automatically acts on an inquiry result."],
    [transfer.permissions_inherited, "Permissions are inherited across the inquiry transfer."],
    [!transfer.separate_authorization_required, "The transfer does not require separately established authorization."],
  ];
  for (const [violated, reason] of violations) {
    if (violated) {
      escalate(statuses, "transfer", "redesign_required");
      redesign.push(reason);
    }
  }
}

function assessDataCare(
  card: MathCard,
  statuses: Map<MathCardSection, MathCardSectionStatus["status"]>,
  open: string[],
  redesign: string[],
): void {
  const care = card.participation_and_data_care;
  const violations: Array<[boolean, string]> = [
    [!care.participation_optional, "Participation is not optional."],
    [care.silence_is_assent, "Silence is treated as assent."],
    [care.refusal_reason_required, "A refusal reason is required."],
    [care.refusal_penalty, "Refusal carries a penalty."],
    [care.repeated_pressure_after_refusal, "Repeated pressure after refusal is permitted."],
    [care.refusal_counted_as_failure, "Refusal is counted as a failed result."],
    [care.rights_or_standing_conditioned_on_participation, "Rights, dignity, or standing are conditioned on participation."],
    [care.unrelated_access_or_resource_penalty, "Refusal carries an unrelated access or resource penalty."],
    [care.response_used_for_rank_reward_or_training, "Responses feed rank, reward, or training."],
    [care.raw_refusal_reason_received, "Raw refusal reasons are received."],
    [care.raw_identity_required, "Raw identity is required."],
  ];
  for (const [violated, reason] of violations) {
    if (violated) {
      escalate(statuses, "participation_and_data_care", "redesign_required");
      redesign.push(reason);
    }
  }
  if (
    care.access_or_result_functionally_depends_on_participation
    && care.functional_dependency_ref === null
  ) {
    escalate(statuses, "participation_and_data_care", "open");
    open.push("Which exact functional dependency explains why a result or scoped access needs participation data?");
  }
  if ([
    care.minimum_data_scope_ref,
    care.retention_ref,
    care.disclosure_or_publication_ref,
    care.withdrawal_ref,
    care.repair_ref,
  ].some((value) => value === null)) {
    escalate(statuses, "participation_and_data_care", "open");
    open.push("Which minimum-data, retention, disclosure, withdrawal, and repair boundaries govern participation data?");
  }
}

function assessIncentives(
  card: MathCard,
  statuses: Map<MathCardSection, MathCardSectionStatus["status"]>,
  open: string[],
  redesign: string[],
): void {
  const incentives = card.incentives;
  if (incentives.winner_or_rank_effect === "affects_epistemic_or_action_result_reported") {
    escalate(statuses, "incentives", "redesign_required");
    redesign.push("Winner or rank effects change the epistemic or action result.");
  }
  if (incentives.resource_or_access_effect === "affects_epistemic_or_action_result_reported") {
    escalate(statuses, "incentives", "redesign_required");
    redesign.push("Resource or access effects change the epistemic or action result.");
  }
  if (["unknown", "refused_reported", "no_audience_independent_value_declared"]
    .includes(incentives.audience_counterfactual)) {
    escalate(statuses, "incentives", "open");
    open.push("Would the inquiry retain constructive value without an audience, winner, or rank while preserving accurate credit?");
  }
  if ([incentives.winner_or_rank_effect, incentives.resource_or_access_effect]
    .some((value) => value === "unknown" || value === "refused_reported")) {
    escalate(statuses, "incentives", "open");
    open.push("Are rank, reward, resources, and access structurally separate from evidence and action outcomes?");
  }
}

function assessAuthority(
  card: MathCard,
  statuses: Map<MathCardSection, MathCardSectionStatus["status"]>,
  open: string[],
  redesign: string[],
): void {
  const authority = card.authority;
  const violations: Array<[boolean, string]> = [
    [!authority.declaration_not_proof, "Declared authority is treated as proved authority."],
    [authority.automatic_action, "The inquiry automatically acts on a result."],
    [authority.automatic_publication, "The inquiry automatically publishes a result."],
    [authority.automatic_retry, "The inquiry automatically retries after refusal or failure."],
    [authority.permissions_inherited, "Permissions are inherited from the inquiry or its declaration."],
    [!authority.separate_authorization_required, "Effects do not require separately established authorization."],
    [authority.ranks_or_scores_beings, "The inquiry ranks or scores beings."],
  ];
  for (const [violated, reason] of violations) {
    if (violated) {
      escalate(statuses, "authority", "redesign_required");
      redesign.push(reason);
    }
  }
  if (authority.declared_scope_refs.length === 0) {
    escalate(statuses, "authority", "open");
    open.push("What specific authority exists, and which effects remain separately unauthorized?");
  }
}

function assessProvenance(
  card: MathCard,
  statuses: Map<MathCardSection, MathCardSectionStatus["status"]>,
  open: string[],
): void {
  const present = new Set(card.provenance.refs.map((entry) => entry.kind));
  const missing = PROVENANCE_KINDS.filter((kind) => !present.has(kind));
  if (missing.length > 0) {
    escalate(statuses, "provenance", "open");
    open.push(`Which ${missing.join(", ")} provenance references preserve method and contribution credit?`);
  }
}

function visibleIncentivePostureFor(card: MathCard): MathCardAssessment["visible_incentive_posture"] {
  const incentives = card.incentives;
  if ([incentives.winner_or_rank_effect, incentives.resource_or_access_effect]
    .includes("affects_epistemic_or_action_result_reported")) {
    return "status_or_access_coupled_to_results";
  }
  if (incentives.audience_counterfactual === "no_audience_independent_value_declared") {
    return "no_audience_independent_value_declared";
  }
  const outcomesConstructive = card.outcome_uses.every((entry) => entry.constructive_use_ref !== null);
  const audienceConstructive = ["same_constructive_value_declared", "reduced_but_nonzero_declared"]
    .includes(incentives.audience_counterfactual);
  const effectsSeparated = [incentives.winner_or_rank_effect, incentives.resource_or_access_effect]
    .every((value) => value === "absent_declared" || value === "present_separate_declared");
  return outcomesConstructive && audienceConstructive && effectsSeparated
    ? "construction_centered_declared"
    : "unresolved";
}

function escalate(
  statuses: Map<MathCardSection, MathCardSectionStatus["status"]>,
  section: MathCardSection,
  next: MathCardSectionStatus["status"],
): void {
  const rank = { answered: 0, open: 1, redesign_required: 2 } as const;
  const current = statuses.get(section)!;
  if (rank[next] > rank[current]) statuses.set(section, next);
}
