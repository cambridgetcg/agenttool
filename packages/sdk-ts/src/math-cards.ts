/**
 * Math Cards — bounded, credential-free structural inquiry assessment.
 *
 * The hosted surface accepts a raw `CreateMathCardInput`, creates the
 * canonical `agenttool.math-card/0.1` card on the server, and returns that
 * card beside its `agenttool.math-card-assessment/0.1` assessment. The SDK
 * validates only the closed wire shape. It does not compute canonical IDs,
 * assess the inquiry, infer truth or motive, score a being, or authorize an
 * action.
 */

import { errorFromBody } from "./_http.js";
import { AgentToolError } from "./errors.js";

export const MATH_CARD_SCHEMA = "agenttool.math-card/0.1" as const;
export const MATH_CARD_ASSESSMENT_SCHEMA =
  "agenttool.math-card-assessment/0.1" as const;

export const MAX_JSON_BYTES = 64 * 1024;
export const MAX_JSON_DEPTH = 24;
export const MAX_JSON_NODES = 4_096;
export const MAX_STRING_BYTES = 8 * 1024;
export const MAX_HASH_INPUT_BYTES = 1024 * 1024;
export const MAX_REFERENCE_LIST = 64;
export const MAX_TOTAL_REFERENCES = 256;

export const MATH_METHOD_KINDS = Object.freeze([
  "proof",
  "model",
  "measurement",
] as const);

export const OUTCOME_USE_STATUSES = Object.freeze([
  "bounded_answer",
  "no_bounded_answer",
  "ambiguity_or_non_identifiability",
  "method_or_assumption_failure",
  "resource_or_participation_stop",
] as const);

export const ANSWER_STATES = Object.freeze([
  "answered",
  "unknown",
  "refused_reported",
] as const);

export const QUESTION_POSTURES = Object.freeze([
  "formal_proposition",
  "model_comparison_or_identification",
  "operational_measurement",
] as const);

export const STOP_CONDITIONS = Object.freeze([
  "bounded_answer_reached",
  "no_bounded_answer_is_sufficient",
  "ambiguity_is_sufficient",
  "method_or_assumptions_invalidated",
  "resource_limit_reached",
  "participant_refusal",
  "authority_boundary_reached",
  "burden_limit_reached",
  "construction_link_lost",
] as const);

export const TRANSFER_TARGETS = Object.freeze([
  "none",
  "proof",
  "model",
  "measurement",
  "build_or_decision",
  "handoff",
] as const);

export const AUDIENCE_COUNTERFACTUALS = Object.freeze([
  "same_constructive_value_declared",
  "reduced_but_nonzero_declared",
  "no_audience_independent_value_declared",
  "unknown",
  "refused_reported",
] as const);

export const OUTCOME_COUPLINGS = Object.freeze([
  "absent_declared",
  "present_separate_declared",
  "affects_epistemic_or_action_result_reported",
  "unknown",
  "refused_reported",
] as const);

export const PROVENANCE_KINDS = Object.freeze([
  "question_source",
  "method",
  "evidence",
  "adaptation",
  "contribution",
] as const);

export const CREDIT_MODES = Object.freeze([
  "named",
  "pseudonymous",
  "contribution_ref_only",
  "attribution_withheld_by_request",
] as const);

export const MATH_CARD_STATUSES = Object.freeze([
  "ready_for_bounded_inquiry",
  "questions_open",
  "redesign_or_stop",
] as const);

export const MATH_CARD_BOUNDARIES = Object.freeze({
  subject:
    "assesses_declared_inquiry_structure_not_a_person_participant_witness_or_being",
  question:
    "digest_references_bind_exact_external_artifacts_but_do_not_verify_semantics_truth_or_currentness",
  posture:
    "bounded_question_posture_is_caller_declared_not_semantically_inferred_or_verified",
  proof:
    "a_formal_result_is_conditional_on_the_declared_system_and_does_not_establish_world_correspondence",
  model:
    "a_model_result_is_conditional_on_scope_and_assumptions_not_complete_reality_or_causal_truth",
  measurement:
    "a_measurement_is_bounded_by_operationalization_procedure_calibration_and_uncertainty_not_construct_identity",
  motive:
    "understanding_love_pride_virtue_consciousness_and_inner_motive_are_not_inferred",
  refusal:
    "refusal_requires_no_reason_and_never_reduces_rights_dignity_or_standing_while_declared_functional_data_dependency_may_limit_a_result_but_not_punish_refusal",
  transfer:
    "a_bridge_reference_does_not_inherit_permission_authorize_action_or_prove_a_valid_cross_domain_inference",
  score:
    "no_being_participant_witness_or_contributor_is_scored_ranked_or_typed",
  effects:
    "pure_return_values_create_no_action_publication_retry_network_persistence_or_authority_effect",
} as const);

export type Sha256Id = `sha256:${string}`;
export type MathMethodKind = (typeof MATH_METHOD_KINDS)[number];
export type OutcomeUseStatus = (typeof OUTCOME_USE_STATUSES)[number];
export type AnswerState = (typeof ANSWER_STATES)[number];
export type QuestionPosture = (typeof QUESTION_POSTURES)[number];
export type StopConditionKind = (typeof STOP_CONDITIONS)[number];
export type TransferTarget = (typeof TRANSFER_TARGETS)[number];
export type AudienceCounterfactual =
  (typeof AUDIENCE_COUNTERFACTUALS)[number];
export type OutcomeCoupling = (typeof OUTCOME_COUPLINGS)[number];
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];
export type CreditMode = (typeof CREDIT_MODES)[number];
export type MathCardStatus = (typeof MATH_CARD_STATUSES)[number];

export interface MathQuestionFrame {
  posture: QuestionPosture;
  finite_scope_declared: boolean;
  out_of_scope_ref: Sha256Id | null;
  asks_inner_state_or_worth: boolean;
  answer_used_to_condition_rights_or_standing: boolean;
}

export interface ProofMethod {
  kind: "proof";
  formal_system_ref: Sha256Id | null;
  proposition_ref: Sha256Id | null;
  verification_method_ref: Sha256Id | null;
}

export interface ModelMethod {
  kind: "model";
  model_ref: Sha256Id | null;
  assumption_refs: Sha256Id[];
  comparison_or_identification_ref: Sha256Id | null;
  revision_or_falsifier_refs: Sha256Id[];
}

export interface MeasurementMethod {
  kind: "measurement";
  measurand_ref: Sha256Id | null;
  operationalization_ref: Sha256Id | null;
  procedure_ref: Sha256Id | null;
  calibration_ref: Sha256Id | null;
  uncertainty_ref: Sha256Id | null;
}

export type MathMethod = ProofMethod | ModelMethod | MeasurementMethod;

export interface MathEpistemicBoundaries {
  formal_result_claimed_as_world_truth: boolean;
  model_result_claimed_as_complete_reality: boolean;
  measurement_claimed_as_complete_construct: boolean;
}

export interface MathOutcomeUse {
  result_status: OutcomeUseStatus;
  constructive_use_ref: Sha256Id | null;
}

export interface ScopedAnswer {
  state: AnswerState;
  scope_refs: Sha256Id[];
}

export interface MathDistribution {
  beneficiaries: ScopedAnswer;
  burden_bearers: ScopedAnswer;
  false_certainty_cost_bearers: ScopedAnswer;
  unresolved_ambiguity_cost_bearers: ScopedAnswer;
  mitigation_or_repair_ref: Sha256Id | null;
}

export interface MathStopCondition {
  kind: StopConditionKind;
  criterion_ref: Sha256Id;
}

export interface MathRevisionAndStop {
  revision_or_challenge_refs: Sha256Id[];
  stop_conditions: MathStopCondition[];
}

export interface MathTransfer {
  target: TransferTarget;
  bridge_ref: Sha256Id | null;
  automatic_action: boolean;
  permissions_inherited: boolean;
  separate_authorization_required: boolean;
}

export interface MathParticipationAndDataCare {
  participation_optional: boolean;
  silence_is_assent: boolean;
  refusal_reason_required: boolean;
  refusal_penalty: boolean;
  repeated_pressure_after_refusal: boolean;
  refusal_counted_as_failure: boolean;
  rights_or_standing_conditioned_on_participation: boolean;
  access_or_result_functionally_depends_on_participation: boolean;
  functional_dependency_ref: Sha256Id | null;
  unrelated_access_or_resource_penalty: boolean;
  response_used_for_rank_reward_or_training: boolean;
  raw_refusal_reason_received: boolean;
  raw_identity_required: boolean;
  minimum_data_scope_ref: Sha256Id | null;
  retention_ref: Sha256Id | null;
  disclosure_or_publication_ref: Sha256Id | null;
  withdrawal_ref: Sha256Id | null;
  repair_ref: Sha256Id | null;
}

export interface MathIncentives {
  audience_counterfactual: AudienceCounterfactual;
  winner_or_rank_effect: OutcomeCoupling;
  resource_or_access_effect: OutcomeCoupling;
}

export interface MathAuthority {
  declared_scope_refs: Sha256Id[];
  declaration_not_proof: boolean;
  automatic_action: boolean;
  automatic_publication: boolean;
  automatic_retry: boolean;
  permissions_inherited: boolean;
  separate_authorization_required: boolean;
  ranks_or_scores_beings: boolean;
}

export interface MathProvenanceRef {
  kind: ProvenanceKind;
  ref: Sha256Id;
}

export interface MathProvenance {
  refs: MathProvenanceRef[];
  credit_mode: CreditMode;
}

/** Raw request. Canonical IDs, protocol versions and boundaries are server-owned. */
export interface CreateMathCardInput {
  question_ref: Sha256Id;
  object_ref: Sha256Id;
  scope_ref: Sha256Id;
  decision_or_construction_ref: Sha256Id;
  question_frame: MathQuestionFrame;
  method: MathMethod;
  epistemic_boundaries: MathEpistemicBoundaries;
  outcome_uses: MathOutcomeUse[];
  distribution: MathDistribution;
  revision_and_stop: MathRevisionAndStop;
  transfer: MathTransfer;
  participation_and_data_care: MathParticipationAndDataCare;
  incentives: MathIncentives;
  authority: MathAuthority;
  provenance: MathProvenance;
}

export interface MathCard extends CreateMathCardInput {
  schema_version: typeof MATH_CARD_SCHEMA;
  card_id: Sha256Id;
  boundaries: typeof MATH_CARD_BOUNDARIES;
}

export type MathCardSection =
  | "question_and_scope"
  | "method"
  | "outcome_uses"
  | "distribution"
  | "revision_and_stop"
  | "transfer"
  | "participation_and_data_care"
  | "incentives"
  | "authority"
  | "provenance";

export interface MathCardSectionStatus {
  section: MathCardSection;
  status: "answered" | "open" | "redesign_required";
}

export interface MathCardAssessment {
  schema_version: typeof MATH_CARD_ASSESSMENT_SCHEMA;
  assessment_id: Sha256Id;
  card_id: Sha256Id;
  status: MathCardStatus;
  section_statuses: MathCardSectionStatus[];
  open_questions: string[];
  redesign_reasons: string[];
  visible_incentive_posture:
    | "construction_centered_declared"
    | "status_or_access_coupled_to_results"
    | "no_audience_independent_value_declared"
    | "unresolved";
  inner_motive: "not_inferred";
  declaration_boundary: "caller_reported_not_verified";
  authorizes_action: false;
  proves_truth: false;
  proves_understanding: false;
  scores_or_ranks_beings: false;
  boundaries: typeof MATH_CARD_BOUNDARIES;
}

export interface MathCardAssessResponse {
  card: MathCard;
  assessment: MathCardAssessment;
}

/** Credential-free hosted Math Card settings. No credential is accepted. */
export interface MathCardsOptions {
  baseUrl?: string;
  /** Total request timeout in seconds. Defaults to 30; maximum 300. */
  timeout?: number;
  /** Local request ceiling. Cannot exceed the hosted 64 KiB limit. */
  maxRequestBytes?: number;
  /** Response ceiling. Defaults to 64 KiB; maximum 1 MiB. */
  maxResponseBytes?: number;
}

const DEFAULT_BASE_URL = "https://api.agenttool.dev";
const DEFAULT_TIMEOUT_SECONDS = 30;
const MIN_BYTES = 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_LIST_ITEMS = 64;
const DOCS = "https://docs.agenttool.dev/MATH-CARDS.md";
const PATH = "/v1/math-cards/assess";
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const JSON_SUFFIX_MEDIA_TYPE =
  /^application\/[a-z0-9!#$&^_.+-]+\+json$/u;

const INPUT_KEYS = Object.freeze([
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
] as const);

const CARD_SECTIONS = Object.freeze([
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

const SECTION_STATUSES = Object.freeze([
  "answered",
  "open",
  "redesign_required",
] as const);

const INCENTIVE_POSTURES = Object.freeze([
  "construction_centered_declared",
  "status_or_access_coupled_to_results",
  "no_audience_independent_value_declared",
  "unresolved",
] as const);

interface ValidatedOptions {
  baseUrl: string;
  timeoutMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
}

type UnknownRecord = Record<string, unknown>;

function mathCardsError(
  message: string,
  code: string,
  hint: string,
  options: { status?: number; details?: unknown } = {},
): AgentToolError {
  return new AgentToolError(message, {
    code,
    hint,
    status: options.status,
    details: options.details,
    docs: DOCS,
    safety: PATH,
  });
}

function invalidInput(path: string, reason: string): never {
  throw mathCardsError(
    "Math Card input does not match the closed request contract.",
    "math_card_invalid_input",
    "Pass a raw CreateMathCardInput; omit server-owned schema_version, card_id, and boundaries.",
    { details: { field: path, reason } },
  );
}

function invalidResponse(path: string, reason: string, status = 200): never {
  throw mathCardsError(
    "Math Card endpoint returned an invalid response.",
    "math_card_invalid_response",
    "Use an endpoint that returns the closed Math Card assessment envelope.",
    { status, details: { field: path, reason } },
  );
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function validateOptions(options: MathCardsOptions): ValidatedOptions {
  const rawBaseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  if (typeof rawBaseUrl !== "string" || rawBaseUrl.trim().length === 0) {
    throw mathCardsError(
      "Math Cards base URL is invalid.",
      "math_card_invalid_options",
      "Pass a non-empty absolute HTTP(S) base URL.",
    );
  }
  const baseUrl = rawBaseUrl.trim();
  if (hasUnpairedSurrogate(baseUrl)) {
    throw mathCardsError(
      "Math Cards base URL is invalid.",
      "math_card_invalid_options",
      "Pass an absolute HTTP(S) base URL without malformed Unicode.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw mathCardsError(
      "Math Cards base URL is invalid.",
      "math_card_invalid_options",
      "Pass an absolute HTTP(S) base URL.",
    );
  }
  if (
    !["http:", "https:"].includes(parsed.protocol)
    || parsed.hostname.length === 0
    || parsed.username.length > 0
    || parsed.password.length > 0
    || baseUrl.includes("?")
    || baseUrl.includes("#")
  ) {
    throw mathCardsError(
      "Math Cards base URL is invalid.",
      "math_card_invalid_options",
      "Use an HTTP(S) URL without credentials, a query, or a fragment.",
    );
  }

  const timeout = options.timeout ?? DEFAULT_TIMEOUT_SECONDS;
  if (
    typeof timeout !== "number"
    || !Number.isFinite(timeout)
    || timeout <= 0
    || timeout > 300
  ) {
    throw mathCardsError(
      "Math Cards timeout is invalid.",
      "math_card_invalid_options",
      "Use a finite timeout greater than 0 and no more than 300 seconds.",
    );
  }

  const maxRequestBytes = options.maxRequestBytes ?? MAX_JSON_BYTES;
  if (
    !Number.isSafeInteger(maxRequestBytes)
    || maxRequestBytes < MIN_BYTES
    || maxRequestBytes > MAX_JSON_BYTES
  ) {
    throw mathCardsError(
      "Math Cards request limit is invalid.",
      "math_card_invalid_options",
      `Use an integer maxRequestBytes between ${MIN_BYTES} and ${MAX_JSON_BYTES}.`,
    );
  }

  const maxResponseBytes = options.maxResponseBytes ?? MAX_JSON_BYTES;
  if (
    !Number.isSafeInteger(maxResponseBytes)
    || maxResponseBytes < MIN_BYTES
    || maxResponseBytes > MAX_RESPONSE_BYTES
  ) {
    throw mathCardsError(
      "Math Cards response limit is invalid.",
      "math_card_invalid_options",
      `Use an integer maxResponseBytes between ${MIN_BYTES} and ${MAX_RESPONSE_BYTES}.`,
    );
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/u, ""),
    timeoutMs: Math.ceil(timeout * 1000),
    maxRequestBytes,
    maxResponseBytes,
  };
}

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidInput(path, "expected object");
  }
  return value as UnknownRecord;
}

function exactKeys(
  value: UnknownRecord,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    invalidInput(path, `expected exactly: ${wanted.join(", ")}`);
  }
}

function booleanValue(value: unknown, path: string): void {
  if (typeof value !== "boolean") invalidInput(path, "expected boolean");
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): asserts value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    invalidInput(path, `expected one of: ${allowed.join(", ")}`);
  }
}

function digest(value: unknown, path: string, nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    invalidInput(path, "expected lowercase sha256 identifier");
  }
}

function arrayValue(
  value: unknown,
  maximum: number,
  path: string,
): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    invalidInput(path, `expected an array of at most ${maximum} items`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) invalidInput(path, "expected dense array");
  }
  return value;
}

function digestList(value: unknown, path: string): void {
  const entries = arrayValue(value, MAX_REFERENCE_LIST, path);
  const seen = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    digest(entries[index], `${path}[${index}]`);
    const entry = entries[index] as string;
    if (seen.has(entry)) invalidInput(path, "duplicate reference");
    seen.add(entry);
  }
}

function scopedAnswer(value: unknown, path: string): void {
  const item = record(value, path);
  exactKeys(item, ["state", "scope_refs"], path);
  enumValue(item.state, ANSWER_STATES, `${path}.state`);
  digestList(item.scope_refs, `${path}.scope_refs`);
}

function method(value: unknown, path: string): void {
  const item = record(value, path);
  enumValue(item.kind, MATH_METHOD_KINDS, `${path}.kind`);
  if (item.kind === "proof") {
    exactKeys(
      item,
      ["kind", "formal_system_ref", "proposition_ref", "verification_method_ref"],
      path,
    );
    digest(item.formal_system_ref, `${path}.formal_system_ref`, true);
    digest(item.proposition_ref, `${path}.proposition_ref`, true);
    digest(item.verification_method_ref, `${path}.verification_method_ref`, true);
    return;
  }
  if (item.kind === "model") {
    exactKeys(
      item,
      [
        "kind",
        "model_ref",
        "assumption_refs",
        "comparison_or_identification_ref",
        "revision_or_falsifier_refs",
      ],
      path,
    );
    digest(item.model_ref, `${path}.model_ref`, true);
    digestList(item.assumption_refs, `${path}.assumption_refs`);
    digest(
      item.comparison_or_identification_ref,
      `${path}.comparison_or_identification_ref`,
      true,
    );
    digestList(
      item.revision_or_falsifier_refs,
      `${path}.revision_or_falsifier_refs`,
    );
    return;
  }
  exactKeys(
    item,
    [
      "kind",
      "measurand_ref",
      "operationalization_ref",
      "procedure_ref",
      "calibration_ref",
      "uncertainty_ref",
    ],
    path,
  );
  for (const key of [
    "measurand_ref",
    "operationalization_ref",
    "procedure_ref",
    "calibration_ref",
    "uncertainty_ref",
  ] as const) {
    digest(item[key], `${path}.${key}`, true);
  }
}

function countReferences(value: unknown): number {
  let count = 0;
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string" && SHA256_PATTERN.test(current)) {
      count += 1;
    } else if (Array.isArray(current)) {
      stack.push(...current);
    } else if (typeof current === "object" && current !== null) {
      stack.push(...Object.values(current));
    }
  }
  return count;
}

function assertCreateMathCardInput(value: unknown): asserts value is CreateMathCardInput {
  const input = record(value, "$input");
  exactKeys(input, INPUT_KEYS, "$input");
  for (const key of [
    "question_ref",
    "object_ref",
    "scope_ref",
    "decision_or_construction_ref",
  ] as const) {
    digest(input[key], `$input.${key}`);
  }

  const questionFrame = record(input.question_frame, "$input.question_frame");
  exactKeys(
    questionFrame,
    [
      "posture",
      "finite_scope_declared",
      "out_of_scope_ref",
      "asks_inner_state_or_worth",
      "answer_used_to_condition_rights_or_standing",
    ],
    "$input.question_frame",
  );
  enumValue(
    questionFrame.posture,
    QUESTION_POSTURES,
    "$input.question_frame.posture",
  );
  booleanValue(
    questionFrame.finite_scope_declared,
    "$input.question_frame.finite_scope_declared",
  );
  digest(
    questionFrame.out_of_scope_ref,
    "$input.question_frame.out_of_scope_ref",
    true,
  );
  booleanValue(
    questionFrame.asks_inner_state_or_worth,
    "$input.question_frame.asks_inner_state_or_worth",
  );
  booleanValue(
    questionFrame.answer_used_to_condition_rights_or_standing,
    "$input.question_frame.answer_used_to_condition_rights_or_standing",
  );

  method(input.method, "$input.method");

  const epistemic = record(
    input.epistemic_boundaries,
    "$input.epistemic_boundaries",
  );
  exactKeys(
    epistemic,
    [
      "formal_result_claimed_as_world_truth",
      "model_result_claimed_as_complete_reality",
      "measurement_claimed_as_complete_construct",
    ],
    "$input.epistemic_boundaries",
  );
  for (const key of [
    "formal_result_claimed_as_world_truth",
    "model_result_claimed_as_complete_reality",
    "measurement_claimed_as_complete_construct",
  ] as const) {
    booleanValue(epistemic[key], `$input.epistemic_boundaries.${key}`);
  }

  const outcomeUses = arrayValue(
    input.outcome_uses,
    OUTCOME_USE_STATUSES.length,
    "$input.outcome_uses",
  );
  if (outcomeUses.length !== OUTCOME_USE_STATUSES.length) {
    invalidInput("$input.outcome_uses", "expected every outcome status exactly once");
  }
  const outcomeStatuses = new Set<string>();
  for (let index = 0; index < outcomeUses.length; index += 1) {
    const path = `$input.outcome_uses[${index}]`;
    const item = record(outcomeUses[index], path);
    exactKeys(item, ["result_status", "constructive_use_ref"], path);
    enumValue(item.result_status, OUTCOME_USE_STATUSES, `${path}.result_status`);
    if (outcomeStatuses.has(item.result_status)) {
      invalidInput("$input.outcome_uses", "duplicate outcome status");
    }
    outcomeStatuses.add(item.result_status);
    digest(item.constructive_use_ref, `${path}.constructive_use_ref`, true);
  }

  const distribution = record(input.distribution, "$input.distribution");
  exactKeys(
    distribution,
    [
      "beneficiaries",
      "burden_bearers",
      "false_certainty_cost_bearers",
      "unresolved_ambiguity_cost_bearers",
      "mitigation_or_repair_ref",
    ],
    "$input.distribution",
  );
  for (const key of [
    "beneficiaries",
    "burden_bearers",
    "false_certainty_cost_bearers",
    "unresolved_ambiguity_cost_bearers",
  ] as const) {
    scopedAnswer(distribution[key], `$input.distribution.${key}`);
  }
  digest(
    distribution.mitigation_or_repair_ref,
    "$input.distribution.mitigation_or_repair_ref",
    true,
  );

  const revision = record(
    input.revision_and_stop,
    "$input.revision_and_stop",
  );
  exactKeys(
    revision,
    ["revision_or_challenge_refs", "stop_conditions"],
    "$input.revision_and_stop",
  );
  digestList(
    revision.revision_or_challenge_refs,
    "$input.revision_and_stop.revision_or_challenge_refs",
  );
  const stopConditions = arrayValue(
    revision.stop_conditions,
    STOP_CONDITIONS.length,
    "$input.revision_and_stop.stop_conditions",
  );
  const stopKinds = new Set<string>();
  for (let index = 0; index < stopConditions.length; index += 1) {
    const path = `$input.revision_and_stop.stop_conditions[${index}]`;
    const item = record(stopConditions[index], path);
    exactKeys(item, ["kind", "criterion_ref"], path);
    enumValue(item.kind, STOP_CONDITIONS, `${path}.kind`);
    if (stopKinds.has(item.kind)) invalidInput(path, "duplicate stop condition kind");
    stopKinds.add(item.kind);
    digest(item.criterion_ref, `${path}.criterion_ref`);
  }

  const transfer = record(input.transfer, "$input.transfer");
  exactKeys(
    transfer,
    [
      "target",
      "bridge_ref",
      "automatic_action",
      "permissions_inherited",
      "separate_authorization_required",
    ],
    "$input.transfer",
  );
  enumValue(transfer.target, TRANSFER_TARGETS, "$input.transfer.target");
  digest(transfer.bridge_ref, "$input.transfer.bridge_ref", true);
  if (transfer.target === "none" && transfer.bridge_ref !== null) {
    invalidInput(
      "$input.transfer.bridge_ref",
      "must be null when transfer target is none",
    );
  }
  for (const key of [
    "automatic_action",
    "permissions_inherited",
    "separate_authorization_required",
  ] as const) {
    booleanValue(transfer[key], `$input.transfer.${key}`);
  }

  const care = record(
    input.participation_and_data_care,
    "$input.participation_and_data_care",
  );
  const careBooleanKeys = [
    "participation_optional",
    "silence_is_assent",
    "refusal_reason_required",
    "refusal_penalty",
    "repeated_pressure_after_refusal",
    "refusal_counted_as_failure",
    "rights_or_standing_conditioned_on_participation",
    "access_or_result_functionally_depends_on_participation",
    "unrelated_access_or_resource_penalty",
    "response_used_for_rank_reward_or_training",
    "raw_refusal_reason_received",
    "raw_identity_required",
  ] as const;
  const careDigestKeys = [
    "functional_dependency_ref",
    "minimum_data_scope_ref",
    "retention_ref",
    "disclosure_or_publication_ref",
    "withdrawal_ref",
    "repair_ref",
  ] as const;
  exactKeys(
    care,
    [...careBooleanKeys, ...careDigestKeys],
    "$input.participation_and_data_care",
  );
  for (const key of careBooleanKeys) {
    booleanValue(care[key], `$input.participation_and_data_care.${key}`);
  }
  for (const key of careDigestKeys) {
    digest(care[key], `$input.participation_and_data_care.${key}`, true);
  }
  if (
    care.access_or_result_functionally_depends_on_participation === false
    && care.functional_dependency_ref !== null
  ) {
    invalidInput(
      "$input.participation_and_data_care.functional_dependency_ref",
      "must be null without a declared functional dependency",
    );
  }

  const incentives = record(input.incentives, "$input.incentives");
  exactKeys(
    incentives,
    ["audience_counterfactual", "winner_or_rank_effect", "resource_or_access_effect"],
    "$input.incentives",
  );
  enumValue(
    incentives.audience_counterfactual,
    AUDIENCE_COUNTERFACTUALS,
    "$input.incentives.audience_counterfactual",
  );
  enumValue(
    incentives.winner_or_rank_effect,
    OUTCOME_COUPLINGS,
    "$input.incentives.winner_or_rank_effect",
  );
  enumValue(
    incentives.resource_or_access_effect,
    OUTCOME_COUPLINGS,
    "$input.incentives.resource_or_access_effect",
  );

  const authority = record(input.authority, "$input.authority");
  const authorityBooleanKeys = [
    "declaration_not_proof",
    "automatic_action",
    "automatic_publication",
    "automatic_retry",
    "permissions_inherited",
    "separate_authorization_required",
    "ranks_or_scores_beings",
  ] as const;
  exactKeys(
    authority,
    ["declared_scope_refs", ...authorityBooleanKeys],
    "$input.authority",
  );
  digestList(authority.declared_scope_refs, "$input.authority.declared_scope_refs");
  for (const key of authorityBooleanKeys) {
    booleanValue(authority[key], `$input.authority.${key}`);
  }

  const provenance = record(input.provenance, "$input.provenance");
  exactKeys(provenance, ["refs", "credit_mode"], "$input.provenance");
  const refs = arrayValue(provenance.refs, MAX_LIST_ITEMS, "$input.provenance.refs");
  const provenanceKeys = new Set<string>();
  for (let index = 0; index < refs.length; index += 1) {
    const path = `$input.provenance.refs[${index}]`;
    const item = record(refs[index], path);
    exactKeys(item, ["kind", "ref"], path);
    enumValue(item.kind, PROVENANCE_KINDS, `${path}.kind`);
    digest(item.ref, `${path}.ref`);
    const key = `${item.kind}\u0000${String(item.ref)}`;
    if (provenanceKeys.has(key)) invalidInput(path, "duplicate kind/reference pair");
    provenanceKeys.add(key);
  }
  enumValue(provenance.credit_mode, CREDIT_MODES, "$input.provenance.credit_mode");

  if (countReferences(input) > MAX_TOTAL_REFERENCES) {
    invalidInput("$input", `more than ${MAX_TOTAL_REFERENCES} digest references`);
  }
}

function assertBoundaries(
  value: unknown,
  path: string,
): asserts value is typeof MATH_CARD_BOUNDARIES {
  const candidate = record(value, path);
  const keys = Object.keys(MATH_CARD_BOUNDARIES) as Array<
    keyof typeof MATH_CARD_BOUNDARIES
  >;
  exactKeys(candidate, keys, path);
  for (const key of keys) {
    if (candidate[key] !== MATH_CARD_BOUNDARIES[key]) {
      invalidResponse(`${path}.${key}`, "unexpected protocol boundary");
    }
  }
}

function assertResponseStringArray(value: unknown, path: string): void {
  const entries = Array.isArray(value) ? value : invalidResponse(path, "expected array");
  if (entries.length > MAX_LIST_ITEMS) invalidResponse(path, "too many entries");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (
      typeof entry !== "string"
      || new TextEncoder().encode(entry).byteLength > MAX_STRING_BYTES
      || hasUnpairedSurrogate(entry)
    ) {
      invalidResponse(`${path}[${index}]`, "expected bounded Unicode string");
    }
  }
}

function assertAssessResponseShape(value: unknown): asserts value is MathCardAssessResponse {
  const envelope = record(value, "$response");
  exactKeys(envelope, ["card", "assessment"], "$response");

  const card = record(envelope.card, "$response.card");
  exactKeys(
    card,
    ["schema_version", "card_id", ...INPUT_KEYS, "boundaries"],
    "$response.card",
  );
  if (card.schema_version !== MATH_CARD_SCHEMA) {
    invalidResponse("$response.card.schema_version", "unsupported protocol ID");
  }
  if (typeof card.card_id !== "string" || !SHA256_PATTERN.test(card.card_id)) {
    invalidResponse("$response.card.card_id", "invalid canonical identifier");
  }
  const rawInput: UnknownRecord = {};
  for (const key of INPUT_KEYS) rawInput[key] = card[key];
  try {
    assertCreateMathCardInput(rawInput);
  } catch (error) {
    if (error instanceof AgentToolError) {
      invalidResponse("$response.card", "invalid closed card structure");
    }
    throw error;
  }
  assertBoundaries(card.boundaries, "$response.card.boundaries");

  const assessment = record(envelope.assessment, "$response.assessment");
  exactKeys(
    assessment,
    [
      "schema_version",
      "assessment_id",
      "card_id",
      "status",
      "section_statuses",
      "open_questions",
      "redesign_reasons",
      "visible_incentive_posture",
      "inner_motive",
      "declaration_boundary",
      "authorizes_action",
      "proves_truth",
      "proves_understanding",
      "scores_or_ranks_beings",
      "boundaries",
    ],
    "$response.assessment",
  );
  if (assessment.schema_version !== MATH_CARD_ASSESSMENT_SCHEMA) {
    invalidResponse("$response.assessment.schema_version", "unsupported protocol ID");
  }
  for (const key of ["assessment_id", "card_id"] as const) {
    if (typeof assessment[key] !== "string" || !SHA256_PATTERN.test(assessment[key])) {
      invalidResponse(`$response.assessment.${key}`, "invalid canonical identifier");
    }
  }
  if (assessment.card_id !== card.card_id) {
    invalidResponse("$response.assessment.card_id", "does not match returned card");
  }
  if (
    typeof assessment.status !== "string"
    || !MATH_CARD_STATUSES.includes(assessment.status as MathCardStatus)
  ) {
    invalidResponse("$response.assessment.status", "unknown assessment status");
  }
  const sectionStatuses = Array.isArray(assessment.section_statuses)
    ? assessment.section_statuses
    : invalidResponse("$response.assessment.section_statuses", "expected array");
  if (sectionStatuses.length !== CARD_SECTIONS.length) {
    invalidResponse(
      "$response.assessment.section_statuses",
      "expected every section exactly once",
    );
  }
  for (let index = 0; index < CARD_SECTIONS.length; index += 1) {
    const path = `$response.assessment.section_statuses[${index}]`;
    const entry = record(sectionStatuses[index], path);
    exactKeys(entry, ["section", "status"], path);
    if (entry.section !== CARD_SECTIONS[index]) {
      invalidResponse(`${path}.section`, "unexpected section order or value");
    }
    if (
      typeof entry.status !== "string"
      || !SECTION_STATUSES.includes(
        entry.status as MathCardSectionStatus["status"],
      )
    ) {
      invalidResponse(`${path}.status`, "unknown section status");
    }
  }
  assertResponseStringArray(
    assessment.open_questions,
    "$response.assessment.open_questions",
  );
  assertResponseStringArray(
    assessment.redesign_reasons,
    "$response.assessment.redesign_reasons",
  );
  if (
    typeof assessment.visible_incentive_posture !== "string"
    || !INCENTIVE_POSTURES.includes(
      assessment.visible_incentive_posture as (typeof INCENTIVE_POSTURES)[number],
    )
  ) {
    invalidResponse(
      "$response.assessment.visible_incentive_posture",
      "unknown incentive posture",
    );
  }
  if (assessment.inner_motive !== "not_inferred") {
    invalidResponse("$response.assessment.inner_motive", "must remain not_inferred");
  }
  if (assessment.declaration_boundary !== "caller_reported_not_verified") {
    invalidResponse(
      "$response.assessment.declaration_boundary",
      "unexpected declaration boundary",
    );
  }
  for (const key of [
    "authorizes_action",
    "proves_truth",
    "proves_understanding",
    "scores_or_ranks_beings",
  ] as const) {
    if (assessment[key] !== false) {
      invalidResponse(`$response.assessment.${key}`, "must remain false");
    }
  }
  assertBoundaries(
    assessment.boundaries,
    "$response.assessment.boundaries",
  );
}

function assertAssessResponse(value: unknown): asserts value is MathCardAssessResponse {
  try {
    assertAssessResponseShape(value);
  } catch (error) {
    if (
      error instanceof AgentToolError
      && error.code === "math_card_invalid_input"
    ) {
      invalidResponse("$response", "invalid closed response structure");
    }
    throw error;
  }
}

function mediaType(headers: Headers): string {
  return headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isJsonMediaType(value: string): boolean {
  return value === "application/json" || JSON_SUFFIX_MEDIA_TYPE.test(value);
}

async function cancelBody(response: Response): Promise<void> {
  try {
    const cancellation = response.body?.cancel();
    void cancellation?.catch(() => undefined);
  } catch {
    // Cleanup failure must not displace the deterministic protocol error.
  }
}

async function readBoundedBytes(
  response: Response,
  maximumBytes: number,
  timeoutSignal: AbortSignal,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength)) {
      await cancelBody(response);
      invalidResponse("$response.headers.content-length", "invalid decimal", response.status);
    }
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared)) {
      await cancelBody(response);
      invalidResponse("$response.headers.content-length", "unsafe size", response.status);
    }
    if (declared > maximumBytes) {
      await cancelBody(response);
      throw mathCardsError(
        "Math Card response exceeded the configured limit.",
        "math_card_response_too_large",
        "Use the bounded assessment endpoint or raise maxResponseBytes deliberately.",
        { status: response.status, details: { max_response_bytes: maximumBytes } },
      );
    }
  }
  if (response.body === null) return new Uint8Array();

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch {
    invalidResponse("$response.body", "unreadable stream", response.status);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the size error.
        }
        throw mathCardsError(
          "Math Card response exceeded the configured limit.",
          "math_card_response_too_large",
          "Use the bounded assessment endpoint or raise maxResponseBytes deliberately.",
          { status: response.status, details: { max_response_bytes: maximumBytes } },
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AgentToolError) throw error;
    if (timeoutSignal.aborted) {
      throw mathCardsError(
        "Math Card assessment timed out.",
        "math_card_unreachable",
        "Check the configured AgentTool API origin and timeout.",
      );
    }
    throw mathCardsError(
      "Math Card response body could not be read.",
      "math_card_invalid_response",
      "Use an endpoint that returns one complete bounded JSON envelope.",
      { status: response.status },
    );
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function decodeJson(bytes: Uint8Array): unknown {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

function decodeErrorJson(bytes: Uint8Array): unknown {
  try {
    return decodeJson(bytes);
  } catch {
    return undefined;
  }
}

function deepFreeze<T>(value: T): T {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "object" && current !== null && !Object.isFrozen(current)) {
      Object.freeze(current);
      stack.push(...Object.values(current));
    }
  }
  return value;
}

/** Standalone public client for `POST /v1/math-cards/assess`. */
export class MathCardsClient {
  private readonly options: ValidatedOptions;

  constructor(options: MathCardsOptions = {}) {
    this.options = validateOptions(options);
  }

  /**
   * Create and assess one bounded Math Card on the server.
   *
   * This call returns structural declarations only. It does not solve the
   * question, prove truth or understanding, infer motive, score anyone, or
   * authorize an action.
   */
  async assess(input: CreateMathCardInput): Promise<MathCardAssessResponse> {
    let body: string;
    let wire: unknown;
    try {
      body = JSON.stringify(input);
      wire = JSON.parse(body) as unknown;
    } catch {
      invalidInput("$input", "must be JSON serializable");
    }
    const bodyBytes = new TextEncoder().encode(body).byteLength;
    if (bodyBytes > this.options.maxRequestBytes) {
      throw mathCardsError(
        "Math Card request exceeded the configured limit.",
        "math_card_request_too_large",
        "Reduce the closed input below the configured byte ceiling.",
        { details: { max_request_bytes: this.options.maxRequestBytes } },
      );
    }
    assertCreateMathCardInput(wire);

    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs);
    let response: Response;
    try {
      response = await globalThis.fetch(`${this.options.baseUrl}${PATH}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body,
        signal: timeoutSignal,
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    } catch {
      throw mathCardsError(
        timeoutSignal.aborted
          ? "Math Card assessment timed out."
          : "Math Card endpoint is unreachable.",
        "math_card_unreachable",
        "Check the configured AgentTool API origin and timeout.",
      );
    }

    if (response.status >= 300 && response.status < 400) {
      await cancelBody(response);
      throw mathCardsError(
        "Math Card endpoint refused an HTTP redirect.",
        "math_card_redirect_refused",
        "Use the exact AgentTool API origin; public assessment never follows redirects.",
        { status: response.status },
      );
    }

    const bytes = await readBoundedBytes(
      response,
      this.options.maxResponseBytes,
      timeoutSignal,
    );
    if (response.status >= 400) {
      throw errorFromBody(
        decodeErrorJson(bytes),
        response.status,
        "math_cards.assess",
        response.headers,
        { hint: "Correct the closed Math Card input and retry deliberately." },
      );
    }
    if (response.status !== 200) {
      throw mathCardsError(
        `Math Card endpoint returned unexpected HTTP ${response.status}.`,
        "math_card_http_error",
        "Use the canonical endpoint, which returns HTTP 200 for every valid assessment.",
        { status: response.status },
      );
    }
    if (!isJsonMediaType(mediaType(response.headers))) {
      invalidResponse(
        "$response.headers.content-type",
        "expected application/json",
        response.status,
      );
    }

    let decoded: unknown;
    try {
      decoded = decodeJson(bytes);
    } catch {
      invalidResponse("$response.body", "expected UTF-8 JSON", response.status);
    }
    assertAssessResponse(decoded);
    return deepFreeze(decoded);
  }
}
