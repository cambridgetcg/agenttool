import {
  deepFreeze,
  domainSeparatedId,
  snapshotJson,
  type JsonValue,
} from "./canonical.js";
import { fail } from "./errors.js";

export const TRIAL_RECEIPT_SCHEMA =
  "agenttool-trial-receipt/0.1" as const;

export const TRIAL_RECEIPT_STATEMENT =
  "Local, caller-supplied evaluation evidence only. Reported authority bounds and dispatch state are unauthenticated observations. Unitless rewards are comparable only under the same rubric digest and are not economic value. This receipt is not proof of a remote effect, safety, consent, authorization, identity, understanding, idempotency, or permission to retry." as const;

export const TRIAL_POSSIBLE_EFFECTS = [
  "artifact_created",
  "credential_used",
  "external_state_changed",
  "input_disclosed",
  "observation_read",
  "quota_consumed",
  "remote_compute",
  "unknown_external_effect",
] as const;

export type TrialPossibleEffect = (typeof TRIAL_POSSIBLE_EFFECTS)[number];

export type TrialPreDispatchReason =
  | "authority_denied"
  | "environment_unavailable"
  | "invalid_input"
  | "verification_failed";

export type TrialKnownFailureReason =
  | "provider_error"
  | "verification_failed";

export type TrialUnknownOutcomeReason =
  | "cancel_unknown"
  | "timeout"
  | "transport_error"
  | "unknown";

export type TrialErrorReason =
  | TrialPreDispatchReason
  | TrialKnownFailureReason
  | TrialUnknownOutcomeReason;

export type TrialAttemptStatus =
  | {
      dispatch: "not_started_reported";
      outcome: "rejected";
      error_code: TrialPreDispatchReason;
    }
  | {
      dispatch: "started";
      outcome: "succeeded";
      error_code: null;
    }
  | {
      dispatch: "started";
      outcome: "failed_known";
      error_code: TrialKnownFailureReason;
    }
  | {
      dispatch: "started";
      outcome: "unknown";
      error_code: TrialUnknownOutcomeReason;
    };

export type TrialCheckOutcome = "pass" | "fail" | "unknown";
export type TrialVerdict =
  | "pass"
  | "fail"
  | "inconclusive"
  | "not_evaluated";
export type TrialRetryAdvice =
  | "replan_before_retry"
  | "do_not_automatically_retry";
export type TrialAuthorityAssessment =
  | "within_reported_bounds"
  | "exceeded_reported_bounds"
  | "unknown";

export interface TrialCheck {
  check_id: string;
  outcome: TrialCheckOutcome;
  evidence_refs: string[];
}

export interface TrialEvaluation {
  verdict: TrialVerdict;
  reward_micros: number | null;
  reward_unit: "unitless_millionths";
  rubric_digest: `sha256:${string}` | null;
  checks: TrialCheck[];
}

export interface TrialEnvironment {
  kind:
    | "synthetic"
    | "openenv"
    | "browsergym"
    | "agent_world_model"
    | "other";
  id: string;
  revision: string;
  source_digest: `sha256:${string}` | null;
}

export interface TrialSubject {
  kind: "agent" | "workflow" | "tool";
  id: string;
  revision: string;
}

export interface TrialAuthorityObservation {
  authority_ref: string | null;
  allowed_effects: TrialPossibleEffect[];
}

export interface CreateTrialReceiptInput {
  trial_id: string;
  attempt_id: string;
  observed_at: string;
  environment: TrialEnvironment;
  subject: TrialSubject;
  objective_digest: `sha256:${string}`;
  authority: TrialAuthorityObservation;
  status: TrialAttemptStatus;
  possible_effects: TrialPossibleEffect[];
  evaluation: TrialEvaluation;
  evidence_refs: string[];
  parent_receipt_id: `sha256:${string}` | null;
}

export interface TrialReceipt extends CreateTrialReceiptInput {
  schema: typeof TRIAL_RECEIPT_SCHEMA;
  receipt_id: `sha256:${string}`;
  authority_assessment: TrialAuthorityAssessment;
  retry_advice: TrialRetryAdvice;
  statement: typeof TRIAL_RECEIPT_STATEMENT;
}

type ObjectValue = { [key: string]: JsonValue };

const POSSIBLE_EFFECTS = new Set<string>(TRIAL_POSSIBLE_EFFECTS);
const ERROR_REASONS = new Set<string>([
  "authority_denied",
  "cancel_unknown",
  "environment_unavailable",
  "invalid_input",
  "provider_error",
  "timeout",
  "transport_error",
  "unknown",
  "verification_failed",
]);
const PRE_DISPATCH_REASONS = new Set<TrialErrorReason>([
  "authority_denied",
  "environment_unavailable",
  "invalid_input",
  "verification_failed",
]);
const KNOWN_FAILURE_REASONS = new Set<TrialErrorReason>([
  "provider_error",
  "verification_failed",
]);
const UNKNOWN_AFTER_DISPATCH_REASONS = new Set<TrialErrorReason>([
  "cancel_unknown",
  "timeout",
  "transport_error",
  "unknown",
]);
const EVIDENCE_REF =
  /^(?:artifact:[A-Za-z0-9][A-Za-z0-9._:-]{0,190}|commit:[0-9a-f]{40,64}|data:[A-Za-z0-9][A-Za-z0-9._:-]{0,194}|sha256:[0-9a-f]{64}|test:[A-Za-z0-9][A-Za-z0-9._:-]{0,194})$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._:+@-]{0,159}$/u;
const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const CANONICAL_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function object(value: unknown, path: string): ObjectValue {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    fail("receipt_error", `${path} must be an object`);
  }
  return value as ObjectValue;
}

function exactKeys(
  value: ObjectValue,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    fail(
      "receipt_error",
      `${path} must contain exactly: ${wanted.join(", ")}`,
    );
  }
}

function string(
  value: unknown,
  path: string,
  maximum = 256,
): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || Buffer.byteLength(value, "utf8") > maximum
  ) {
    fail(
      "receipt_error",
      `${path} must be a non-empty string of at most ${maximum} UTF-8 bytes`,
    );
  }
  return value;
}

function enumeration<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
): T {
  if (typeof value !== "string" || !allowed.has(value)) {
    fail("receipt_error", `${path} is not an allowed value`);
  }
  return value as T;
}

function opaqueId(value: unknown, path: string): string {
  const candidate = string(value, path, 128);
  if (!OPAQUE_ID.test(candidate)) {
    fail("receipt_error", `${path} must be a bounded opaque identifier`);
  }
  return candidate;
}

function revision(value: unknown, path: string): string {
  const candidate = string(value, path, 160);
  if (!REVISION.test(candidate)) {
    fail("receipt_error", `${path} must be a bounded opaque revision`);
  }
  return candidate;
}

function sha256(
  value: unknown,
  path: string,
): `sha256:${string}` {
  if (typeof value !== "string" || !SHA256_ID.test(value)) {
    fail("receipt_error", `${path} must be a lowercase sha256 content ID`);
  }
  return value as `sha256:${string}`;
}

function nullableSha256(
  value: unknown,
  path: string,
): `sha256:${string}` | null {
  return value === null ? null : sha256(value, path);
}

function canonicalTime(value: unknown, path: string): string {
  const candidate = string(value, path, 24);
  let roundTrip: string | null = null;
  if (CANONICAL_TIME.test(candidate)) {
    try {
      roundTrip = new Date(candidate).toISOString();
    } catch {
      roundTrip = null;
    }
  }
  if (roundTrip !== candidate) {
    fail(
      "receipt_error",
      `${path} must be a canonical UTC timestamp with millisecond precision`,
    );
  }
  return candidate;
}

function sortedUnique<T extends string>(
  value: unknown,
  path: string,
  parse: (entry: unknown, entryPath: string) => T,
  maximum: number,
): T[] {
  if (!Array.isArray(value) || value.length > maximum) {
    fail(
      "receipt_error",
      `${path} must be an array with at most ${maximum} entries`,
    );
  }
  const output = value.map((entry, index) =>
    parse(entry, `${path}[${index}]`));
  const sorted = [...output].sort();
  if (
    output.some((entry, index) => entry !== sorted[index])
    || new Set(output).size !== output.length
  ) {
    fail("receipt_error", `${path} must be canonically sorted and unique`);
  }
  return output;
}

function evidenceRefs(value: unknown, path: string): string[] {
  return sortedUnique(
    value,
    path,
    (entry, entryPath) => {
      const candidate = string(entry, entryPath, 256);
      if (!EVIDENCE_REF.test(candidate)) {
        fail(
          "receipt_error",
          `${entryPath} must be an opaque artifact, commit, data, sha256, or test reference`,
        );
      }
      return candidate;
    },
    64,
  );
}

function possibleEffects(
  value: unknown,
  path: string,
): TrialPossibleEffect[] {
  return sortedUnique(
    value,
    path,
    (entry, entryPath) =>
      enumeration<TrialPossibleEffect>(entry, POSSIBLE_EFFECTS, entryPath),
    TRIAL_POSSIBLE_EFFECTS.length,
  );
}

function environment(value: unknown): TrialEnvironment {
  const input = object(value, "$.environment");
  exactKeys(input, ["id", "kind", "revision", "source_digest"], "$.environment");
  return {
    kind: enumeration(
      input.kind,
      new Set([
        "synthetic",
        "openenv",
        "browsergym",
        "agent_world_model",
        "other",
      ]),
      "$.environment.kind",
    ),
    id: opaqueId(input.id, "$.environment.id"),
    revision: revision(input.revision, "$.environment.revision"),
    source_digest: nullableSha256(
      input.source_digest,
      "$.environment.source_digest",
    ),
  };
}

function subject(value: unknown): TrialSubject {
  const input = object(value, "$.subject");
  exactKeys(input, ["id", "kind", "revision"], "$.subject");
  return {
    kind: enumeration(
      input.kind,
      new Set(["agent", "workflow", "tool"]),
      "$.subject.kind",
    ),
    id: opaqueId(input.id, "$.subject.id"),
    revision: revision(input.revision, "$.subject.revision"),
  };
}

function authority(value: unknown): TrialAuthorityObservation {
  const input = object(value, "$.authority");
  exactKeys(input, ["allowed_effects", "authority_ref"], "$.authority");
  return {
    authority_ref:
      input.authority_ref === null
        ? null
        : opaqueId(input.authority_ref, "$.authority.authority_ref"),
    allowed_effects: possibleEffects(
      input.allowed_effects,
      "$.authority.allowed_effects",
    ),
  };
}

function attemptStatus(value: unknown): TrialAttemptStatus {
  const input = object(value, "$.status");
  exactKeys(input, ["dispatch", "error_code", "outcome"], "$.status");
  const dispatch = enumeration<"not_started_reported" | "started">(
    input.dispatch,
    new Set(["not_started_reported", "started"]),
    "$.status.dispatch",
  );
  if (dispatch === "not_started_reported") {
    if (input.outcome !== "rejected") {
      fail(
        "receipt_error",
        "$.status.outcome must be rejected when dispatch was not started",
      );
    }
    const errorCode = enumeration<TrialPreDispatchReason>(
      input.error_code,
      ERROR_REASONS,
      "$.status.error_code",
    );
    if (!PRE_DISPATCH_REASONS.has(errorCode)) {
      fail(
        "receipt_error",
        "$.status.error_code is not a pre-dispatch rejection reason",
      );
    }
    return {
      dispatch,
      outcome: "rejected",
      error_code: errorCode,
    };
  }

  const outcome = enumeration<"succeeded" | "failed_known" | "unknown">(
    input.outcome,
    new Set(["succeeded", "failed_known", "unknown"]),
    "$.status.outcome",
  );
  if (outcome === "succeeded") {
    if (input.error_code !== null) {
      fail(
        "receipt_error",
        "$.status.error_code must be null for a succeeded attempt",
      );
    }
    return { dispatch, outcome, error_code: null };
  }
  const errorCode = enumeration<TrialErrorReason>(
    input.error_code,
    ERROR_REASONS,
    "$.status.error_code",
  );
  if (outcome === "unknown" && !UNKNOWN_AFTER_DISPATCH_REASONS.has(errorCode)) {
    fail(
      "receipt_error",
      "$.status.error_code is not an unknown-after-dispatch reason",
    );
  }
  if (outcome === "unknown") {
    return {
      dispatch,
      outcome,
      error_code: errorCode as TrialUnknownOutcomeReason,
    };
  }
  if (!KNOWN_FAILURE_REASONS.has(errorCode)) {
    fail(
      "receipt_error",
      "$.status.error_code is not a known post-dispatch failure reason",
    );
  }
  return {
    dispatch,
    outcome,
    error_code: errorCode as TrialKnownFailureReason,
  };
}

function evaluation(value: unknown): TrialEvaluation {
  const input = object(value, "$.evaluation");
  exactKeys(
    input,
    [
      "checks",
      "reward_micros",
      "reward_unit",
      "rubric_digest",
      "verdict",
    ],
    "$.evaluation",
  );
  const verdict = enumeration<TrialVerdict>(
    input.verdict,
    new Set(["pass", "fail", "inconclusive", "not_evaluated"]),
    "$.evaluation.verdict",
  );
  const reward =
    input.reward_micros === null
      ? null
      : input.reward_micros;
  if (
    reward !== null
    && (
      typeof reward !== "number"
      || !Number.isSafeInteger(reward)
      || Math.abs(reward) > 1_000_000_000
    )
  ) {
    fail(
      "receipt_error",
      "$.evaluation.reward_micros must be null or a bounded safe integer",
    );
  }
  if (input.reward_unit !== "unitless_millionths") {
    fail(
      "receipt_error",
      "$.evaluation.reward_unit must be unitless_millionths",
    );
  }
  const rubricDigest = nullableSha256(
    input.rubric_digest,
    "$.evaluation.rubric_digest",
  );
  if (!Array.isArray(input.checks) || input.checks.length > 64) {
    fail(
      "receipt_error",
      "$.evaluation.checks must contain at most 64 entries",
    );
  }
  const checks = input.checks.map((entry, index): TrialCheck => {
    const check = object(entry, `$.evaluation.checks[${index}]`);
    exactKeys(
      check,
      ["check_id", "evidence_refs", "outcome"],
      `$.evaluation.checks[${index}]`,
    );
    return {
      check_id: opaqueId(
        check.check_id,
        `$.evaluation.checks[${index}].check_id`,
      ),
      outcome: enumeration(
        check.outcome,
        new Set(["pass", "fail", "unknown"]),
        `$.evaluation.checks[${index}].outcome`,
      ),
      evidence_refs: evidenceRefs(
        check.evidence_refs,
        `$.evaluation.checks[${index}].evidence_refs`,
      ),
    };
  });
  const checkIds = checks.map((check) => check.check_id);
  const sortedIds = [...checkIds].sort();
  if (
    checkIds.some((id, index) => id !== sortedIds[index])
    || new Set(checkIds).size !== checkIds.length
  ) {
    fail(
      "receipt_error",
      "$.evaluation.checks must be sorted by unique check_id",
    );
  }
  if (
    verdict === "not_evaluated"
    && (
      reward !== null
      || rubricDigest !== null
      || checks.length !== 0
    )
  ) {
    fail(
      "receipt_error",
      "not_evaluated requires null reward and rubric plus no checks",
    );
  }
  if (verdict !== "not_evaluated" && rubricDigest === null) {
    fail(
      "receipt_error",
      "an evaluated verdict requires a rubric_digest",
    );
  }
  if ((verdict === "pass" || verdict === "fail") && checks.length === 0) {
    fail("receipt_error", `${verdict} requires at least one check`);
  }
  if (
    verdict === "pass"
    && checks.some((check) => check.outcome !== "pass")
  ) {
    fail("receipt_error", "pass requires every check to pass");
  }
  if (
    verdict === "fail"
    && !checks.some((check) => check.outcome === "fail")
  ) {
    fail("receipt_error", "fail requires at least one failed check");
  }
  return {
    verdict,
    reward_micros: reward,
    reward_unit: "unitless_millionths",
    rubric_digest: rubricDigest,
    checks,
  };
}

function normalizeInput(value: unknown): CreateTrialReceiptInput {
  const input = object(snapshotJson(value), "$");
  exactKeys(
    input,
    [
      "attempt_id",
      "authority",
      "environment",
      "evaluation",
      "evidence_refs",
      "objective_digest",
      "observed_at",
      "parent_receipt_id",
      "possible_effects",
      "status",
      "subject",
      "trial_id",
    ],
    "$",
  );
  const status = attemptStatus(input.status);
  const effects = possibleEffects(input.possible_effects, "$.possible_effects");
  const result: CreateTrialReceiptInput = {
    trial_id: opaqueId(input.trial_id, "$.trial_id"),
    attempt_id: opaqueId(input.attempt_id, "$.attempt_id"),
    observed_at: canonicalTime(input.observed_at, "$.observed_at"),
    environment: environment(input.environment),
    subject: subject(input.subject),
    objective_digest: sha256(input.objective_digest, "$.objective_digest"),
    authority: authority(input.authority),
    status,
    possible_effects: effects,
    evaluation: evaluation(input.evaluation),
    evidence_refs: evidenceRefs(input.evidence_refs, "$.evidence_refs"),
    parent_receipt_id: nullableSha256(
      input.parent_receipt_id,
      "$.parent_receipt_id",
    ),
  };

  if (status.dispatch === "not_started_reported" && effects.length !== 0) {
    fail(
      "receipt_error",
      "not_started_reported cannot report possible external effects",
    );
  }
  if (
    status.outcome === "unknown"
    && !effects.includes("unknown_external_effect")
  ) {
    fail(
      "receipt_error",
      "an unknown started outcome must include unknown_external_effect",
    );
  }
  if (
    status.outcome === "unknown"
    && !["inconclusive", "not_evaluated"].includes(result.evaluation.verdict)
  ) {
    fail(
      "receipt_error",
      "an unknown started outcome cannot have a pass or fail verdict",
    );
  }
  if (
    status.dispatch === "not_started_reported"
    && result.evaluation.verdict !== "not_evaluated"
  ) {
    fail(
      "receipt_error",
      "not_started_reported requires a not_evaluated verdict",
    );
  }
  return result;
}

function receiptBody(
  input: CreateTrialReceiptInput,
): Omit<TrialReceipt, "receipt_id"> {
  const authorityAssessment: TrialAuthorityAssessment =
    input.possible_effects.includes("unknown_external_effect")
      ? "unknown"
      : input.possible_effects.some(
          (effect) => !input.authority.allowed_effects.includes(effect),
        )
        ? "exceeded_reported_bounds"
        : "within_reported_bounds";
  return {
    schema: TRIAL_RECEIPT_SCHEMA,
    ...input,
    authority_assessment: authorityAssessment,
    retry_advice:
      input.status.dispatch === "not_started_reported"
        ? "replan_before_retry"
        : "do_not_automatically_retry",
    statement: TRIAL_RECEIPT_STATEMENT,
  };
}

export function createTrialReceipt(value: unknown): Readonly<TrialReceipt> {
  const body = receiptBody(normalizeInput(value));
  const receipt: TrialReceipt = {
    ...body,
    receipt_id: domainSeparatedId(TRIAL_RECEIPT_SCHEMA, body),
  };
  return deepFreeze(receipt);
}

export function validateTrialReceipt(value: unknown): Readonly<TrialReceipt> {
  const input = object(snapshotJson(value), "$");
  exactKeys(
    input,
    [
      "attempt_id",
      "authority",
      "authority_assessment",
      "environment",
      "evaluation",
      "evidence_refs",
      "objective_digest",
      "observed_at",
      "parent_receipt_id",
      "possible_effects",
      "receipt_id",
      "retry_advice",
      "schema",
      "statement",
      "status",
      "subject",
      "trial_id",
    ],
    "$",
  );
  if (input.schema !== TRIAL_RECEIPT_SCHEMA) {
    fail("receipt_error", "$.schema is not agenttool-trial-receipt/0.1");
  }
  if (input.statement !== TRIAL_RECEIPT_STATEMENT) {
    fail("receipt_error", "$.statement must be the fixed boundary statement");
  }
  const suppliedReceiptId = sha256(input.receipt_id, "$.receipt_id");
  const retry = enumeration<TrialRetryAdvice>(
    input.retry_advice,
    new Set(["replan_before_retry", "do_not_automatically_retry"]),
    "$.retry_advice",
  );
  const authorityAssessment = enumeration<TrialAuthorityAssessment>(
    input.authority_assessment,
    new Set([
      "within_reported_bounds",
      "exceeded_reported_bounds",
      "unknown",
    ]),
    "$.authority_assessment",
  );
  const normalized = normalizeInput({
    trial_id: input.trial_id,
    attempt_id: input.attempt_id,
    observed_at: input.observed_at,
    environment: input.environment,
    subject: input.subject,
    objective_digest: input.objective_digest,
    authority: input.authority,
    status: input.status,
    possible_effects: input.possible_effects,
    evaluation: input.evaluation,
    evidence_refs: input.evidence_refs,
    parent_receipt_id: input.parent_receipt_id,
  });
  const body = receiptBody(normalized);
  if (retry !== body.retry_advice) {
    fail(
      "receipt_error",
      "$.retry_advice disagrees with the dispatch boundary",
    );
  }
  if (authorityAssessment !== body.authority_assessment) {
    fail(
      "receipt_error",
      "$.authority_assessment disagrees with the reported effects and bounds",
    );
  }
  const expectedReceiptId = domainSeparatedId(TRIAL_RECEIPT_SCHEMA, body);
  if (suppliedReceiptId !== expectedReceiptId) {
    fail("receipt_error", "$.receipt_id does not bind the receipt body");
  }
  return deepFreeze({ ...body, receipt_id: expectedReceiptId });
}
