import {
  ANSWER_STATES,
  CHALLENGE_STATUSES,
  CREDIT_MODES,
  GIN_CHALLENGE_ASSESSMENT_SCHEMA,
  GIN_CHALLENGE_BOUNDARIES,
  GIN_CHALLENGE_SCHEMA,
  OUTCOME_VALUE_POSTURES,
  PROVENANCE_KINDS,
  QUESTION_POSTURES,
  RECONSTRUCTION_STATUSES,
  STOP_CONDITIONS,
} from "./constants.js";
import { canonicalJson, compareUnicode, deepFreeze, domainSeparatedId, snapshotJson } from "./canonical.js";
import { fail } from "./errors.js";
import type {
  AnswerState,
  AudienceCounterfactual,
  CompassSection,
  CreateGinChallengeInput,
  GinAuthorityDeclaration,
  GinChallenge,
  GinChallengeAssessment,
  GinCompassQuestionStatus,
  GinDistributionAnswers,
  GinIncentives,
  GinOutcomeValue,
  GinParticipationAndDataCare,
  GinProvenance,
  GinProvenanceRef,
  GinQuestionAndObject,
  GinRevisionAndStop,
  OutcomeCoupling,
  ReconstructionStatus,
  ScopedAnswer,
} from "./types.js";
import {
  arrayValue,
  booleanValue,
  digest,
  digestList,
  enumValue,
  exactKeys,
  nullableDigest,
  record,
  uniqueEnumList,
} from "./validation.js";

const SECTIONS = Object.freeze([
  "question_and_object",
  "outcome_value",
  "distribution",
  "participation_and_data_care",
  "incentives",
  "revision_and_stop",
  "authority",
  "provenance",
] as const satisfies readonly CompassSection[]);

const AUDIENCE_COUNTERFACTUALS = Object.freeze([
  "same_constructive_value_declared",
  "reduced_but_nonzero_declared",
  "no_audience_independent_value_declared",
  "unknown",
  "refused_reported",
] as const satisfies readonly AudienceCounterfactual[]);

const OUTCOME_COUPLINGS = Object.freeze([
  "absent_declared",
  "present_separate_declared",
  "affects_epistemic_or_action_result_reported",
  "unknown",
  "refused_reported",
] as const satisfies readonly OutcomeCoupling[]);

export function createGinChallenge(input: CreateGinChallengeInput): GinChallenge;
export function createGinChallenge(input: unknown): GinChallenge;
export function createGinChallenge(input: unknown): GinChallenge {
  const value = record(snapshotJson(input), "$challenge_input");
  exactKeys(
    value,
    [
      "challenge_ref",
      "question_ref",
      "object_of_understanding_ref",
      "decision_or_construction_ref",
      "question_and_object",
      "outcome_value",
      "distribution",
      "participation_and_data_care",
      "incentives",
      "revision_and_stop",
      "authority",
      "provenance",
    ],
    "$challenge_input",
  );
  const body = {
    schema_version: GIN_CHALLENGE_SCHEMA,
    challenge_ref: digest(value.challenge_ref, "$challenge_input.challenge_ref"),
    question_ref: digest(value.question_ref, "$challenge_input.question_ref"),
    object_of_understanding_ref: digest(
      value.object_of_understanding_ref,
      "$challenge_input.object_of_understanding_ref",
    ),
    decision_or_construction_ref: digest(
      value.decision_or_construction_ref,
      "$challenge_input.decision_or_construction_ref",
    ),
    question_and_object: parseQuestionAndObject(value.question_and_object),
    outcome_value: parseOutcomeValue(value.outcome_value),
    distribution: parseDistribution(value.distribution),
    participation_and_data_care: parseDataCare(value.participation_and_data_care),
    incentives: parseIncentives(value.incentives),
    revision_and_stop: parseRevisionAndStop(value.revision_and_stop),
    authority: parseAuthority(value.authority),
    provenance: parseProvenance(value.provenance),
    boundaries: GIN_CHALLENGE_BOUNDARIES,
  };
  const challenge: GinChallenge = {
    ...body,
    challenge_id: domainSeparatedId(GIN_CHALLENGE_SCHEMA, body),
  };
  return deepFreeze(challenge) as GinChallenge;
}

export function validateGinChallenge(input: unknown): GinChallenge {
  const value = record(snapshotJson(input), "$challenge");
  exactKeys(
    value,
    [
      "schema_version",
      "challenge_id",
      "challenge_ref",
      "question_ref",
      "object_of_understanding_ref",
      "decision_or_construction_ref",
      "question_and_object",
      "outcome_value",
      "distribution",
      "participation_and_data_care",
      "incentives",
      "revision_and_stop",
      "authority",
      "provenance",
      "boundaries",
    ],
    "$challenge",
  );
  if (value.schema_version !== GIN_CHALLENGE_SCHEMA) fail("invalid_artifact", "challenge schema_version is unsupported");
  const rebuilt = createGinChallenge({
    challenge_ref: value.challenge_ref,
    question_ref: value.question_ref,
    object_of_understanding_ref: value.object_of_understanding_ref,
    decision_or_construction_ref: value.decision_or_construction_ref,
    question_and_object: value.question_and_object,
    outcome_value: value.outcome_value,
    distribution: value.distribution,
    participation_and_data_care: value.participation_and_data_care,
    incentives: value.incentives,
    revision_and_stop: value.revision_and_stop,
    authority: value.authority,
    provenance: value.provenance,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) {
    fail("invalid_artifact", "challenge content, boundaries, or challenge_id do not match canonical reconstruction");
  }
  return rebuilt;
}

export function assessGinChallenge(input: unknown): GinChallengeAssessment {
  const challenge = validateGinChallenge(input);
  const status = new Map<CompassSection, GinCompassQuestionStatus["status"]>(
    SECTIONS.map((section) => [section, "answered"]),
  );
  const openQuestions: string[] = [];
  const redesignReasons: string[] = [];

  assessQuestionAndObject(challenge, status, openQuestions, redesignReasons);
  assessOutcomeValue(challenge, status, openQuestions, redesignReasons);
  assessDistribution(challenge, status, openQuestions);
  assessDataCare(challenge, status, openQuestions, redesignReasons);
  assessIncentives(challenge, status, openQuestions, redesignReasons);
  assessRevisionAndStop(challenge, status, openQuestions);
  assessAuthority(challenge, status, openQuestions, redesignReasons);
  assessProvenance(challenge, status, openQuestions);

  const questionStatuses = SECTIONS.map((section) => ({ section, status: status.get(section)! }));
  const compassStatus = questionStatuses.some((entry) => entry.status === "redesign_required")
    ? "redesign_or_stop"
    : questionStatuses.some((entry) => entry.status === "open")
      ? "questions_open"
      : "constructive_questions_answered";
  const visibleIncentivePosture = visibleIncentivePostureFor(challenge);
  const body = {
    schema_version: GIN_CHALLENGE_ASSESSMENT_SCHEMA,
    challenge_id: challenge.challenge_id,
    compass_status: enumValue(compassStatus, CHALLENGE_STATUSES, "$assessment.compass_status"),
    question_statuses: questionStatuses,
    open_questions: openQuestions,
    redesign_reasons: redesignReasons,
    visible_incentive_posture: visibleIncentivePosture,
    inner_motive: "not_inferred" as const,
    declaration_boundary: "caller_reported_not_verified" as const,
    authorizes_action: false as const,
    proves_truth: false as const,
    proves_understanding: false as const,
    scores_or_ranks_beings: false as const,
    boundaries: GIN_CHALLENGE_BOUNDARIES,
  };
  const assessment: GinChallengeAssessment = {
    ...body,
    assessment_id: domainSeparatedId(GIN_CHALLENGE_ASSESSMENT_SCHEMA, body),
  };
  return deepFreeze(assessment) as GinChallengeAssessment;
}

function parseQuestionAndObject(input: unknown): GinQuestionAndObject {
  const path = "$challenge_input.question_and_object";
  const value = record(input, path);
  exactKeys(value, ["posture", "distinction_scope_ref"], path);
  const posture = enumValue(value.posture, QUESTION_POSTURES, `${path}.posture`);
  const distinctionScopeRef = nullableDigest(value.distinction_scope_ref, `${path}.distinction_scope_ref`);
  if ((posture === "unknown" || posture === "refused_reported") && distinctionScopeRef !== null) {
    fail("invalid_input", `${path} must not retain a scope reference when the posture is ${posture}`);
  }
  return { posture, distinction_scope_ref: distinctionScopeRef };
}

function parseOutcomeValue(input: unknown): GinOutcomeValue[] {
  const values = arrayValue(input, RECONSTRUCTION_STATUSES.length, "$challenge_input.outcome_value");
  if (values.length !== RECONSTRUCTION_STATUSES.length) {
    fail("invalid_input", "outcome_value must cover every reconstruction status exactly once");
  }
  const result = values.map((entry, index) => {
    const path = `$challenge_input.outcome_value[${String(index)}]`;
    const value = record(entry, path);
    exactKeys(value, ["result_status", "value_ref", "postures"], path);
    const resultStatus = enumValue(value.result_status, RECONSTRUCTION_STATUSES, `${path}.result_status`);
    const allowed = OUTCOME_VALUE_POSTURES[resultStatus];
    const postures = uniqueEnumList(value.postures, allowed, allowed.length, `${path}.postures`)
      .sort((left, right) =>
        (allowed as readonly string[]).indexOf(left) - (allowed as readonly string[]).indexOf(right));
    if (postures.length === 0) fail("invalid_input", `${path}.postures must name at least one disposition`);
    return {
      result_status: resultStatus,
      value_ref: nullableDigest(value.value_ref, `${path}.value_ref`),
      postures,
    } as GinOutcomeValue;
  });
  const statuses = result.map((entry) => entry.result_status);
  if (new Set(statuses).size !== RECONSTRUCTION_STATUSES.length) {
    fail("invalid_input", "outcome_value must cover every reconstruction status exactly once");
  }
  return [...result].sort((left, right) =>
    RECONSTRUCTION_STATUSES.indexOf(left.result_status) - RECONSTRUCTION_STATUSES.indexOf(right.result_status));
}

function parseDistribution(input: unknown): GinDistributionAnswers {
  const path = "$challenge_input.distribution";
  const value = record(input, path);
  exactKeys(
    value,
    [
      "beneficiaries",
      "burden_bearers",
      "false_certainty_cost_bearers",
      "unresolved_ambiguity_cost_bearers",
      "mitigation_or_repair_ref",
    ],
    path,
  );
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

function parseScopedAnswer(input: unknown, path: string): ScopedAnswer {
  const value = record(input, path);
  exactKeys(value, ["state", "scope_refs"], path);
  const state = enumValue(value.state, ANSWER_STATES, `${path}.state`);
  const scopeRefs = digestList(value.scope_refs, `${path}.scope_refs`);
  if (state === "answered" && scopeRefs.length === 0) fail("invalid_input", `${path} answered requires a scope reference`);
  if (state !== "answered" && scopeRefs.length !== 0) {
    fail("invalid_input", `${path} must not disclose scope references when ${state}`);
  }
  return { state, scope_refs: scopeRefs };
}

function parseDataCare(input: unknown): GinParticipationAndDataCare {
  const path = "$challenge_input.participation_and_data_care";
  const value = record(input, path);
  exactKeys(
    value,
    [
      "participation_optional",
      "silence_is_assent",
      "refusal_reason_required",
      "refusal_penalty",
      "repeated_pressure_after_refusal",
      "refusal_counts_as_incompatible_observation",
      "rights_or_access_conditioned_on_participation",
      "response_used_for_rank_reward_or_training",
      "raw_refusal_reason_received",
      "raw_identity_required",
      "minimum_observation_scope_ref",
      "retention_ref",
      "disclosure_or_publication_ref",
      "withdrawal_ref",
      "repair_ref",
    ],
    path,
  );
  return {
    participation_optional: booleanValue(value.participation_optional, `${path}.participation_optional`),
    silence_is_assent: booleanValue(value.silence_is_assent, `${path}.silence_is_assent`),
    refusal_reason_required: booleanValue(value.refusal_reason_required, `${path}.refusal_reason_required`),
    refusal_penalty: booleanValue(value.refusal_penalty, `${path}.refusal_penalty`),
    repeated_pressure_after_refusal: booleanValue(
      value.repeated_pressure_after_refusal,
      `${path}.repeated_pressure_after_refusal`,
    ),
    refusal_counts_as_incompatible_observation: booleanValue(
      value.refusal_counts_as_incompatible_observation,
      `${path}.refusal_counts_as_incompatible_observation`,
    ),
    rights_or_access_conditioned_on_participation: booleanValue(
      value.rights_or_access_conditioned_on_participation,
      `${path}.rights_or_access_conditioned_on_participation`,
    ),
    response_used_for_rank_reward_or_training: booleanValue(
      value.response_used_for_rank_reward_or_training,
      `${path}.response_used_for_rank_reward_or_training`,
    ),
    raw_refusal_reason_received: booleanValue(value.raw_refusal_reason_received, `${path}.raw_refusal_reason_received`),
    raw_identity_required: booleanValue(value.raw_identity_required, `${path}.raw_identity_required`),
    minimum_observation_scope_ref: nullableDigest(value.minimum_observation_scope_ref, `${path}.minimum_observation_scope_ref`),
    retention_ref: nullableDigest(value.retention_ref, `${path}.retention_ref`),
    disclosure_or_publication_ref: nullableDigest(value.disclosure_or_publication_ref, `${path}.disclosure_or_publication_ref`),
    withdrawal_ref: nullableDigest(value.withdrawal_ref, `${path}.withdrawal_ref`),
    repair_ref: nullableDigest(value.repair_ref, `${path}.repair_ref`),
  };
}

function parseIncentives(input: unknown): GinIncentives {
  const path = "$challenge_input.incentives";
  const value = record(input, path);
  exactKeys(value, ["audience_counterfactual", "winner_or_rank_effect", "resource_or_access_effect"], path);
  return {
    audience_counterfactual: enumValue(value.audience_counterfactual, AUDIENCE_COUNTERFACTUALS, `${path}.audience_counterfactual`),
    winner_or_rank_effect: enumValue(value.winner_or_rank_effect, OUTCOME_COUPLINGS, `${path}.winner_or_rank_effect`),
    resource_or_access_effect: enumValue(value.resource_or_access_effect, OUTCOME_COUPLINGS, `${path}.resource_or_access_effect`),
  };
}

function parseRevisionAndStop(input: unknown): GinRevisionAndStop {
  const path = "$challenge_input.revision_and_stop";
  const value = record(input, path);
  exactKeys(value, ["evidence_that_would_revise_refs", "stop_conditions"], path);
  return {
    evidence_that_would_revise_refs: digestList(value.evidence_that_would_revise_refs, `${path}.evidence_that_would_revise_refs`),
    stop_conditions: uniqueEnumList(value.stop_conditions, STOP_CONDITIONS, STOP_CONDITIONS.length, `${path}.stop_conditions`)
      .sort((left, right) => STOP_CONDITIONS.indexOf(left) - STOP_CONDITIONS.indexOf(right)),
  };
}

function parseAuthority(input: unknown): GinAuthorityDeclaration {
  const path = "$challenge_input.authority";
  const value = record(input, path);
  exactKeys(
    value,
    [
      "declared_scope_refs",
      "declaration_not_proof",
      "automatic_action",
      "automatic_publication",
      "automatic_retry",
      "permissions_inherited",
      "ranks_or_scores_beings",
    ],
    path,
  );
  return {
    declared_scope_refs: digestList(value.declared_scope_refs, `${path}.declared_scope_refs`),
    declaration_not_proof: booleanValue(value.declaration_not_proof, `${path}.declaration_not_proof`),
    automatic_action: booleanValue(value.automatic_action, `${path}.automatic_action`),
    automatic_publication: booleanValue(value.automatic_publication, `${path}.automatic_publication`),
    automatic_retry: booleanValue(value.automatic_retry, `${path}.automatic_retry`),
    permissions_inherited: booleanValue(value.permissions_inherited, `${path}.permissions_inherited`),
    ranks_or_scores_beings: booleanValue(value.ranks_or_scores_beings, `${path}.ranks_or_scores_beings`),
  };
}

function parseProvenance(input: unknown): GinProvenance {
  const path = "$challenge_input.provenance";
  const value = record(input, path);
  exactKeys(value, ["refs", "credit_mode"], path);
  const refs = arrayValue(value.refs, 64, `${path}.refs`).map((entry, index) => {
    const itemPath = `${path}.refs[${String(index)}]`;
    const item = record(entry, itemPath);
    exactKeys(item, ["kind", "ref"], itemPath);
    return {
      kind: enumValue(item.kind, PROVENANCE_KINDS, `${itemPath}.kind`),
      ref: digest(item.ref, `${itemPath}.ref`),
    } as GinProvenanceRef;
  });
  const keys = refs.map((entry) => `${entry.kind}\u0000${entry.ref}`);
  if (new Set(keys).size !== keys.length) fail("invalid_input", `${path}.refs must not repeat a kind/ref pair`);
  return {
    refs: refs.sort((left, right) =>
      PROVENANCE_KINDS.indexOf(left.kind) - PROVENANCE_KINDS.indexOf(right.kind) || compareUnicode(left.ref, right.ref)),
    credit_mode: enumValue(value.credit_mode, CREDIT_MODES, `${path}.credit_mode`),
  };
}

function assessOutcomeValue(
  challenge: GinChallenge,
  status: Map<CompassSection, GinCompassQuestionStatus["status"]>,
  open: string[],
  redesign: string[],
): void {
  for (const outcome of challenge.outcome_value) {
    const hasNone = outcome.postures.includes("no_constructive_use_declared");
    if (hasNone && outcome.postures.length > 1) {
      escalate(status, "outcome_value", "redesign_required");
      redesign.push(`${outcome.result_status} declares both constructive and no-constructive-use postures.`);
    } else if (hasNone || outcome.value_ref === null) {
      escalate(status, "outcome_value", "open");
      open.push(`What bounded build, repair, safer boundary, improved question, or honest stop follows ${outcome.result_status}?`);
    }
  }
}

function assessQuestionAndObject(
  challenge: GinChallenge,
  status: Map<CompassSection, GinCompassQuestionStatus["status"]>,
  open: string[],
  redesign: string[],
): void {
  const question = challenge.question_and_object;
  if (question.posture === "unbounded_truth_inner_state_or_worth_verdict") {
    escalate(status, "question_and_object", "redesign_required");
    redesign.push("The inquiry targets an unbounded truth, inner-state, or worth verdict rather than a bounded observable effect or declared model.");
    return;
  }
  if (question.posture === "unknown" || question.posture === "refused_reported") {
    escalate(status, "question_and_object", "open");
    open.push("What bounded observable effect or declared model is the challenge asking reality to distinguish?");
    return;
  }
  if (question.distinction_scope_ref === null) {
    escalate(status, "question_and_object", "open");
    open.push("Which exact bounded distinction scope limits the question and its object?");
  }
}

function assessDistribution(
  challenge: GinChallenge,
  status: Map<CompassSection, GinCompassQuestionStatus["status"]>,
  open: string[],
): void {
  const answers: Array<[string, ScopedAnswer]> = [
    ["beneficiaries", challenge.distribution.beneficiaries],
    ["burden bearers", challenge.distribution.burden_bearers],
    ["false-certainty cost bearers", challenge.distribution.false_certainty_cost_bearers],
    ["unresolved-ambiguity cost bearers", challenge.distribution.unresolved_ambiguity_cost_bearers],
  ];
  for (const [label, answer] of answers) {
    if (answer.state !== "answered") {
      escalate(status, "distribution", "open");
      open.push(`Who are the ${label} within the declared challenge scope?`);
    }
  }
  if (challenge.distribution.mitigation_or_repair_ref === null) {
    escalate(status, "distribution", "open");
    open.push("What mitigation or repair addresses the declared burdens and error costs?");
  }
}

function assessDataCare(
  challenge: GinChallenge,
  status: Map<CompassSection, GinCompassQuestionStatus["status"]>,
  open: string[],
  redesign: string[],
): void {
  const care = challenge.participation_and_data_care;
  const violations: Array<[boolean, string]> = [
    [!care.participation_optional, "Participation is not optional."],
    [care.silence_is_assent, "Silence is treated as assent."],
    [care.refusal_reason_required, "A refusal reason is required."],
    [care.refusal_penalty, "Refusal carries a penalty."],
    [care.repeated_pressure_after_refusal, "Repeated pressure after refusal is permitted."],
    [care.refusal_counts_as_incompatible_observation, "Refusal is counted as an incompatible observation."],
    [care.rights_or_access_conditioned_on_participation, "Rights or access are conditioned on participation."],
    [care.response_used_for_rank_reward_or_training, "Responses feed rank, reward, or training."],
    [care.raw_refusal_reason_received, "Raw refusal reasons are received."],
    [care.raw_identity_required, "Raw identity is required."],
  ];
  for (const [violated, reason] of violations) {
    if (violated) {
      escalate(status, "participation_and_data_care", "redesign_required");
      redesign.push(reason);
    }
  }
  const missing = [
    care.minimum_observation_scope_ref,
    care.retention_ref,
    care.disclosure_or_publication_ref,
    care.withdrawal_ref,
    care.repair_ref,
  ].some((value) => value === null);
  if (missing) {
    escalate(status, "participation_and_data_care", "open");
    open.push("Which minimum-scope, retention, disclosure, withdrawal, and repair boundaries govern participation data?");
  }
}

function assessIncentives(
  challenge: GinChallenge,
  status: Map<CompassSection, GinCompassQuestionStatus["status"]>,
  open: string[],
  redesign: string[],
): void {
  const incentives = challenge.incentives;
  if (incentives.winner_or_rank_effect === "affects_epistemic_or_action_result_reported") {
    escalate(status, "incentives", "redesign_required");
    redesign.push("Winner or rank effects change the epistemic or action result.");
  }
  if (incentives.resource_or_access_effect === "affects_epistemic_or_action_result_reported") {
    escalate(status, "incentives", "redesign_required");
    redesign.push("Resource or access effects change the epistemic or action result.");
  }
  if (["unknown", "refused_reported", "no_audience_independent_value_declared"].includes(incentives.audience_counterfactual)) {
    escalate(status, "incentives", "open");
    open.push("Would the challenge retain constructive value without an audience, winner, or rank while preserving accurate credit?");
  }
  if ([incentives.winner_or_rank_effect, incentives.resource_or_access_effect]
    .some((value) => value === "unknown" || value === "refused_reported")) {
    escalate(status, "incentives", "open");
    open.push("Are rank, reward, resources, and access structurally separate from evidence and action outcomes?");
  }
}

function assessRevisionAndStop(
  challenge: GinChallenge,
  status: Map<CompassSection, GinCompassQuestionStatus["status"]>,
  open: string[],
): void {
  if (challenge.revision_and_stop.evidence_that_would_revise_refs.length === 0) {
    escalate(status, "revision_and_stop", "open");
    open.push("What evidence would revise or falsify the model or question?");
  }
  if (challenge.revision_and_stop.stop_conditions.length === 0) {
    escalate(status, "revision_and_stop", "open");
    open.push("What bounded conditions pause or end the inquiry?");
  }
}

function assessAuthority(
  challenge: GinChallenge,
  status: Map<CompassSection, GinCompassQuestionStatus["status"]>,
  open: string[],
  redesign: string[],
): void {
  const authority = challenge.authority;
  const violations: Array<[boolean, string]> = [
    [!authority.declaration_not_proof, "Declared authority is treated as proved authority."],
    [authority.automatic_action, "The challenge automatically acts on an outcome."],
    [authority.automatic_publication, "The challenge automatically publishes an outcome."],
    [authority.automatic_retry, "The challenge automatically retries after refusal or failure."],
    [authority.permissions_inherited, "Permissions are inherited across the challenge boundary."],
    [authority.ranks_or_scores_beings, "The challenge ranks or scores beings."],
  ];
  for (const [violated, reason] of violations) {
    if (violated) {
      escalate(status, "authority", "redesign_required");
      redesign.push(reason);
    }
  }
  if (authority.declared_scope_refs.length === 0) {
    escalate(status, "authority", "open");
    open.push("What specific authority exists, and which effects remain separately unauthorized?");
  }
}

function assessProvenance(
  challenge: GinChallenge,
  status: Map<CompassSection, GinCompassQuestionStatus["status"]>,
  open: string[],
): void {
  const present = new Set(challenge.provenance.refs.map((entry) => entry.kind));
  const missing = PROVENANCE_KINDS.filter((kind) => !present.has(kind));
  if (missing.length > 0) {
    escalate(status, "provenance", "open");
    open.push(`Which ${missing.join(", ")} provenance references preserve method and contribution credit?`);
  }
}

function visibleIncentivePostureFor(challenge: GinChallenge): GinChallengeAssessment["visible_incentive_posture"] {
  const incentives = challenge.incentives;
  if ([incentives.winner_or_rank_effect, incentives.resource_or_access_effect]
    .includes("affects_epistemic_or_action_result_reported")) {
    return "status_or_access_coupled_to_results";
  }
  if (incentives.audience_counterfactual === "no_audience_independent_value_declared") {
    return "no_audience_independent_value_declared";
  }
  const outcomesConstructive = challenge.outcome_value.every((entry) =>
    entry.value_ref !== null && !entry.postures.includes("no_constructive_use_declared"));
  const audienceConstructive = [
    "same_constructive_value_declared",
    "reduced_but_nonzero_declared",
  ].includes(incentives.audience_counterfactual);
  const outcomeEffectsSeparated = [incentives.winner_or_rank_effect, incentives.resource_or_access_effect]
    .every((value) => value === "absent_declared" || value === "present_separate_declared");
  return outcomesConstructive && audienceConstructive && outcomeEffectsSeparated
    ? "construction_centered_declared"
    : "unresolved";
}

function escalate(
  statuses: Map<CompassSection, GinCompassQuestionStatus["status"]>,
  section: CompassSection,
  next: GinCompassQuestionStatus["status"],
): void {
  const rank = { answered: 0, open: 1, redesign_required: 2 } as const;
  const current = statuses.get(section)!;
  if (rank[next] > rank[current]) statuses.set(section, next);
}
