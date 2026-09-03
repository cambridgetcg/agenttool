import { createHash } from "node:crypto";

import { LIMITS, SCHEMAS } from "./constants.js";
import { fail } from "./errors.js";
import {
  deepFreeze,
  enumValue,
  exactKeys,
  identifier,
  record,
  reference,
  sameJson,
  sha256Identifier,
  snapshotJson,
  timestamp,
  uint64Decimal,
} from "./internal.js";
import {
  appendLedgerTransaction,
  assertLedgerAccountUnitCompatibility,
  LedgerAccountRegistry,
  validateLedgerJournal,
  validateLedgerTransaction,
} from "./ledger.js";
import { quoteIsLive, validateEconomicQuote } from "./quotes.js";
import type {
  AttemptRegistrationResult,
  AttemptTransition,
  AttemptTransitionResult,
  EffectAttempt,
  EffectAttemptSeed,
  EffectAttemptTransition,
  EffectOperation,
  EffectRecoveryAction,
  EffectStatus,
  EffectTransitionCommand,
  ExternalIntent,
  OrphanedApplicationCompensationResult,
  PaymentAttempt,
  PaymentAttemptSeed,
  PaymentLedgerState,
  PaymentLedgerTransitionResult,
  PaymentOperation,
  PaymentRecoveryAction,
  PaymentStatus,
  PaymentTransitionCommand,
  RecoveryPlan,
} from "./types.js";
import { UnitRegistry } from "./units.js";

const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "CREATED",
  "AUTHORIZATION_RECORDED",
  "SUBMISSION_INTENT_PERSISTED",
  "SUBMITTING",
  "AMBIGUOUS",
  "EXTERNALLY_SETTLED",
  "APPLIED",
  "DEFINITIVELY_FAILED",
  "CANCELLED",
  "EXPIRED",
  "REVERSED",
];

const PAYMENT_OPERATIONS: readonly PaymentOperation[] = [
  "RECORD_AUTHORIZATION",
  "PERSIST_SUBMISSION_INTENT",
  "BEGIN_SUBMISSION",
  "OBSERVE_AMBIGUOUS",
  "OBSERVE_SETTLED",
  "OBSERVE_DEFINITIVE_FAILURE",
  "RECONCILE_SETTLED",
  "RECONCILE_DEFINITIVE_FAILURE",
  "APPLY_INTERNAL",
  "REVERSE",
  "CANCEL",
  "EXPIRE",
];

const EFFECT_STATUSES: readonly EffectStatus[] = [
  "CREATED",
  "EXECUTION_INTENT_PERSISTED",
  "EXECUTING",
  "AMBIGUOUS",
  "SUCCEEDED",
  "DEFINITIVELY_FAILED",
  "CANCELLED",
];

const EFFECT_OPERATIONS: readonly EffectOperation[] = [
  "PERSIST_EXECUTION_INTENT",
  "BEGIN_EXECUTION",
  "OBSERVE_AMBIGUOUS",
  "OBSERVE_SUCCESS",
  "OBSERVE_DEFINITIVE_FAILURE",
  "RECONCILE_SUCCESS",
  "RECONCILE_DEFINITIVE_FAILURE",
  "CANCEL",
];

function digest(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

function sha256(payload: unknown): string {
  return `sha256:${digest(payload)}`;
}

function derivedId(prefix: string, payload: unknown): string {
  return `${prefix}-${digest(payload)}`;
}

function paymentFingerprint(quoteId: string): string {
  return sha256({ domain: "PAYMENT", quote_id: quoteId });
}

function effectFingerprint(actionDigest: string, quoteId: string | null, paymentAttemptId: string | null): string {
  return sha256({
    domain: "EFFECT",
    action_digest: actionDigest,
    quote_id: quoteId,
    payment_attempt_id: paymentAttemptId,
  });
}

function reversalFingerprint(payment: PaymentAttempt): string {
  return sha256({ domain: "PAYMENT_REVERSAL", request_fingerprint: payment.request_fingerprint });
}

function paymentTarget(status: PaymentStatus, operation: PaymentOperation): PaymentStatus {
  if (status === "CREATED" && operation === "RECORD_AUTHORIZATION") return "AUTHORIZATION_RECORDED";
  if (status === "AUTHORIZATION_RECORDED" && operation === "PERSIST_SUBMISSION_INTENT") return "SUBMISSION_INTENT_PERSISTED";
  if (status === "SUBMISSION_INTENT_PERSISTED" && operation === "BEGIN_SUBMISSION") return "SUBMITTING";
  if (status === "SUBMITTING" && operation === "OBSERVE_AMBIGUOUS") return "AMBIGUOUS";
  if (status === "SUBMITTING" && operation === "OBSERVE_SETTLED") return "EXTERNALLY_SETTLED";
  if (status === "SUBMITTING" && operation === "OBSERVE_DEFINITIVE_FAILURE") return "DEFINITIVELY_FAILED";
  if (status === "AMBIGUOUS" && operation === "RECONCILE_SETTLED") return "EXTERNALLY_SETTLED";
  if (status === "AMBIGUOUS" && operation === "RECONCILE_DEFINITIVE_FAILURE") return "DEFINITIVELY_FAILED";
  if (status === "EXTERNALLY_SETTLED" && operation === "APPLY_INTERNAL") return "APPLIED";
  if ((status === "EXTERNALLY_SETTLED" || status === "APPLIED") && operation === "REVERSE") return "REVERSED";
  if (["CREATED", "AUTHORIZATION_RECORDED", "SUBMISSION_INTENT_PERSISTED"].includes(status)) {
    if (operation === "CANCEL") return "CANCELLED";
    if (operation === "EXPIRE") return "EXPIRED";
  }
  fail("INVALID_STATE_TRANSITION", `Payment cannot apply ${operation} from ${status}.`, "payment_transition.operation");
}

function effectTarget(status: EffectStatus, operation: EffectOperation): EffectStatus {
  if (status === "CREATED" && operation === "PERSIST_EXECUTION_INTENT") return "EXECUTION_INTENT_PERSISTED";
  if (status === "EXECUTION_INTENT_PERSISTED" && operation === "BEGIN_EXECUTION") return "EXECUTING";
  if (status === "EXECUTING" && operation === "OBSERVE_AMBIGUOUS") return "AMBIGUOUS";
  if (status === "EXECUTING" && operation === "OBSERVE_SUCCESS") return "SUCCEEDED";
  if (status === "EXECUTING" && operation === "OBSERVE_DEFINITIVE_FAILURE") return "DEFINITIVELY_FAILED";
  if (status === "AMBIGUOUS" && operation === "RECONCILE_SUCCESS") return "SUCCEEDED";
  if (status === "AMBIGUOUS" && operation === "RECONCILE_DEFINITIVE_FAILURE") return "DEFINITIVELY_FAILED";
  if ((status === "CREATED" || status === "EXECUTION_INTENT_PERSISTED") && operation === "CANCEL") return "CANCELLED";
  fail("INVALID_STATE_TRANSITION", `Effect cannot apply ${operation} from ${status}.`, "effect_transition.operation");
}

function transitionValue<Status extends string, Operation extends string>(
  value: unknown,
  label: string,
  statuses: readonly Status[],
  operations: readonly Operation[],
): Readonly<AttemptTransition<Status, Operation>> {
  const item = record(value, label);
  exactKeys(item, ["evidence_ref", "from", "observed_at", "operation", "to", "transition_id"], label);
  identifier(item.transition_id, `${label}.transition_id`);
  enumValue(item.operation, operations, `${label}.operation`);
  enumValue(item.from, statuses, `${label}.from`);
  enumValue(item.to, statuses, `${label}.to`);
  reference(item.evidence_ref, `${label}.evidence_ref`);
  timestamp(item.observed_at, `${label}.observed_at`);
  return deepFreeze(item as unknown as AttemptTransition<Status, Operation>);
}

function effectTransitionValue(value: unknown, label: string): Readonly<EffectAttemptTransition> {
  const item = record(value, label);
  exactKeys(item, ["evidence_ref", "from", "gate_revision", "observed_at", "operation", "to", "transition_id"], label);
  const base = transitionValue({
    evidence_ref: item.evidence_ref,
    from: item.from,
    observed_at: item.observed_at,
    operation: item.operation,
    to: item.to,
    transition_id: item.transition_id,
  }, label, EFFECT_STATUSES, EFFECT_OPERATIONS);
  const forward = base.operation === "PERSIST_EXECUTION_INTENT" || base.operation === "BEGIN_EXECUTION";
  if (forward) {
    const revision = uint64Decimal(item.gate_revision, `${label}.gate_revision`);
    if (revision === "0") fail("INVALID_STATE_TRANSITION", "Forward effect transition requires a positive gate revision.", `${label}.gate_revision`);
    return deepFreeze({ ...base, gate_revision: revision });
  }
  if (item.gate_revision !== null) {
    fail("INVALID_STATE_TRANSITION", "Observation and terminal transitions do not carry gate authority.", `${label}.gate_revision`);
  }
  return deepFreeze({ ...base, gate_revision: null });
}

function replayPaymentHistory(
  value: unknown,
  seed: PaymentAttempt,
  units: UnitRegistry,
): { status: PaymentStatus; updatedAt: string; transitions: readonly AttemptTransition<PaymentStatus, PaymentOperation>[] } {
  if (!Array.isArray(value) || value.length > LIMITS.maxTransitions) {
    fail("LIMIT_EXCEEDED", "Payment transition history exceeds the v0.2 bound.", "payment_attempt.transitions");
  }
  let status: PaymentStatus = "CREATED";
  let updatedAt = seed.created_at;
  const ids = new Set<string>();
  const transitions = value.map((entry, index) => {
    const transition = transitionValue(entry, `payment_attempt.transitions[${String(index)}]`, PAYMENT_STATUSES, PAYMENT_OPERATIONS);
    if (ids.has(transition.transition_id)) {
      fail("IDEMPOTENCY_CONFLICT", "Payment transition ids must be unique.", "payment_attempt.transitions");
    }
    ids.add(transition.transition_id);
    const target = paymentTarget(status, transition.operation);
    if (transition.from !== status || transition.to !== target) {
      fail("INVALID_STATE_TRANSITION", "Payment history is forged or out of order.", `payment_attempt.transitions[${String(index)}]`);
    }
    if (Date.parse(transition.observed_at) < Date.parse(updatedAt)) {
      fail("INVALID_STATE_TRANSITION", "Payment transition time cannot move backwards.", `payment_attempt.transitions[${String(index)}].observed_at`);
    }
    if (["RECORD_AUTHORIZATION", "PERSIST_SUBMISSION_INTENT", "BEGIN_SUBMISSION"].includes(transition.operation)
      && !quoteIsLive(seed.quote, transition.observed_at, units)) {
      fail("INVALID_STATE_TRANSITION", "Persisted payment advanced toward submission outside quote validity.", `payment_attempt.transitions[${String(index)}].observed_at`);
    }
    if (transition.operation === "EXPIRE" && Date.parse(transition.observed_at) < Date.parse(seed.quote.expires_at)) {
      fail("INVALID_STATE_TRANSITION", "Persisted payment expired before its quote.", `payment_attempt.transitions[${String(index)}].observed_at`);
    }
    const applicationTransition = transition.operation === "APPLY_INTERNAL";
    const occupiesApplicationTransitionId = transition.transition_id === seed.application_transition_id;
    if (
      applicationTransition !== occupiesApplicationTransitionId
      || (applicationTransition && transition.evidence_ref !== seed.application_transaction_id)
    ) {
      fail("INVALID_STATE_TRANSITION", "Persisted application transition is not bound to its derived ledger identity.", `payment_attempt.transitions[${String(index)}]`);
    }
    const appliedReversalTransition = transition.operation === "REVERSE" && status === "APPLIED";
    const occupiesReversalTransitionId = transition.transition_id === seed.reversal_transition_id;
    if (
      appliedReversalTransition !== occupiesReversalTransitionId
      || (appliedReversalTransition && transition.evidence_ref !== seed.reversal_transaction_id)
    ) {
      fail("INVALID_STATE_TRANSITION", "Persisted reversal transition is not bound to its derived ledger identity.", `payment_attempt.transitions[${String(index)}]`);
    }
    status = target;
    updatedAt = transition.observed_at;
    return transition;
  });
  return { status, updatedAt, transitions };
}

function replayEffectHistory(
  value: unknown,
  createdAt: string,
): { status: EffectStatus; updatedAt: string; transitions: readonly EffectAttemptTransition[] } {
  if (!Array.isArray(value) || value.length > LIMITS.maxTransitions) {
    fail("LIMIT_EXCEEDED", "Effect transition history exceeds the v0.2 bound.", "effect_attempt.transitions");
  }
  let status: EffectStatus = "CREATED";
  let updatedAt = createdAt;
  let latestGateRevision = 0n;
  const ids = new Set<string>();
  const transitions = value.map((entry, index) => {
    const transition = effectTransitionValue(entry, `effect_attempt.transitions[${String(index)}]`);
    if (ids.has(transition.transition_id)) {
      fail("IDEMPOTENCY_CONFLICT", "Effect transition ids must be unique.", "effect_attempt.transitions");
    }
    ids.add(transition.transition_id);
    const target = effectTarget(status, transition.operation);
    if (transition.from !== status || transition.to !== target) {
      fail("INVALID_STATE_TRANSITION", "Effect history is forged or out of order.", `effect_attempt.transitions[${String(index)}]`);
    }
    if (Date.parse(transition.observed_at) < Date.parse(updatedAt)) {
      fail("INVALID_STATE_TRANSITION", "Effect transition time cannot move backwards.", `effect_attempt.transitions[${String(index)}].observed_at`);
    }
    if (transition.gate_revision !== null) {
      const revision = BigInt(transition.gate_revision);
      if (revision < latestGateRevision) {
        fail("INVALID_STATE_TRANSITION", "Persisted gate revisions cannot move backwards.", `effect_attempt.transitions[${String(index)}].gate_revision`);
      }
      latestGateRevision = revision;
    }
    status = target;
    updatedAt = transition.observed_at;
    return transition;
  });
  return { status, updatedAt, transitions };
}

function createPaymentAttempt(value: unknown, units: UnitRegistry): Readonly<PaymentAttempt> {
  const item = record(value, "payment_seed");
  exactKeys(item, ["attempt_id", "created_at", "payment_idempotency_key", "quote"], "payment_seed");
  const attemptId = identifier(item.attempt_id, "payment_seed.attempt_id");
  const idempotencyKey = identifier(item.payment_idempotency_key, "payment_seed.payment_idempotency_key");
  const quote = validateEconomicQuote(item.quote, units);
  const createdAt = timestamp(item.created_at, "payment_seed.created_at");
  if (!quoteIsLive(quote, createdAt, units)) {
    fail("INVALID_STATE_TRANSITION", "Payment attempt must be registered while its quote is live.", "payment_seed.created_at");
  }
  const identity = { attempt_id: attemptId, quote_id: quote.quote_id };
  return deepFreeze({
    schema: SCHEMAS.paymentAttempt,
    attempt_id: attemptId,
    payment_idempotency_key: idempotencyKey,
    quote,
    request_fingerprint: paymentFingerprint(quote.quote_id),
    application_transaction_id: derivedId("transaction:payment-application", identity),
    application_idempotency_key: derivedId("ledger-key:payment-application", { key: idempotencyKey }),
    application_transition_id: derivedId("payment-transition:apply", identity),
    reversal_transaction_id: derivedId("transaction:payment-reversal", identity),
    reversal_idempotency_key: derivedId("ledger-key:payment-reversal", { key: idempotencyKey }),
    reversal_transition_id: derivedId("payment-transition:reverse", identity),
    status: "CREATED",
    created_at: createdAt,
    updated_at: createdAt,
    transitions: [],
  });
}

export function validatePaymentAttempt(value: unknown, units: UnitRegistry): Readonly<PaymentAttempt> {
  const item = record(value, "payment_attempt");
  exactKeys(item, [
    "application_idempotency_key",
    "application_transaction_id",
    "application_transition_id",
    "attempt_id",
    "created_at",
    "payment_idempotency_key",
    "quote",
    "request_fingerprint",
    "reversal_idempotency_key",
    "reversal_transaction_id",
    "reversal_transition_id",
    "schema",
    "status",
    "transitions",
    "updated_at",
  ], "payment_attempt");
  if (item.schema !== SCHEMAS.paymentAttempt) fail("INVALID_RECORD", "payment_attempt.schema is unsupported.", "payment_attempt.schema");
  const seed = createPaymentAttempt({
    attempt_id: item.attempt_id,
    created_at: item.created_at,
    payment_idempotency_key: item.payment_idempotency_key,
    quote: item.quote,
  } satisfies Record<keyof PaymentAttemptSeed, unknown>, units);
  for (const field of [
    "application_idempotency_key",
    "application_transaction_id",
    "application_transition_id",
    "request_fingerprint",
    "reversal_idempotency_key",
    "reversal_transaction_id",
    "reversal_transition_id",
  ] as const) {
    if (item[field] !== seed[field]) fail("INVALID_RECORD", `payment_attempt.${field} is not derived from its immutable seed.`, `payment_attempt.${field}`);
  }
  enumValue(item.status, PAYMENT_STATUSES, "payment_attempt.status");
  timestamp(item.updated_at, "payment_attempt.updated_at");
  const history = replayPaymentHistory(item.transitions, seed, units);
  if (item.status !== history.status || item.updated_at !== history.updatedAt) {
    fail("INVALID_STATE_TRANSITION", "Payment projection must equal its replayed history.", "payment_attempt");
  }
  return deepFreeze({ ...seed, status: history.status, updated_at: history.updatedAt, transitions: history.transitions });
}

export function validatePaymentAttemptJournal(value: unknown, units: UnitRegistry): readonly Readonly<PaymentAttempt>[] {
  const snapshot = snapshotJson(value);
  if (!Array.isArray(snapshot) || snapshot.length > LIMITS.maxArrayItems) {
    fail("LIMIT_EXCEEDED", "Payment journal exceeds the bounded v0.2 history.", "payment_journal");
  }
  const attempts = snapshot.map((entry) => validatePaymentAttempt(entry, units));
  const ids = new Set<string>();
  const keys = new Set<string>();
  const quotes = new Set<string>();
  for (const attempt of attempts) {
    if (ids.has(attempt.attempt_id) || keys.has(attempt.payment_idempotency_key) || quotes.has(attempt.quote.quote_id)) {
      fail("IDEMPOTENCY_CONFLICT", "Payment journal contains a duplicate attempt, key, or quote.", "payment_journal");
    }
    ids.add(attempt.attempt_id);
    keys.add(attempt.payment_idempotency_key);
    quotes.add(attempt.quote.quote_id);
  }
  return deepFreeze(attempts);
}

export function registerPaymentAttempt(
  journalValue: unknown,
  seedValue: unknown,
  units: UnitRegistry,
): Readonly<AttemptRegistrationResult<PaymentAttempt>> {
  const journal = validatePaymentAttemptJournal(journalValue, units);
  const candidate = createPaymentAttempt(seedValue, units);
  const byKey = journal.find((entry) => entry.payment_idempotency_key === candidate.payment_idempotency_key);
  if (byKey) {
    if (byKey.request_fingerprint !== candidate.request_fingerprint) {
      fail("IDEMPOTENCY_CONFLICT", "Payment key was reused for a different content-derived quote.", "payment_seed.payment_idempotency_key");
    }
    return deepFreeze({ attempt: byKey, disposition: "REPLAYED", journal });
  }
  if (journal.some((entry) => entry.attempt_id === candidate.attempt_id || entry.quote.quote_id === candidate.quote.quote_id)) {
    fail("IDEMPOTENCY_CONFLICT", "Payment attempt or quote was reused under a different key.", "payment_seed");
  }
  const next = validatePaymentAttemptJournal([...journal, candidate], units);
  return deepFreeze({ attempt: candidate, disposition: "REGISTERED", journal: next });
}

function paymentCommand(value: unknown): Readonly<PaymentTransitionCommand> {
  const item = record(value, "payment_transition");
  exactKeys(item, ["evidence_ref", "observed_at", "operation", "transition_id"], "payment_transition");
  identifier(item.transition_id, "payment_transition.transition_id");
  enumValue(item.operation, PAYMENT_OPERATIONS, "payment_transition.operation");
  reference(item.evidence_ref, "payment_transition.evidence_ref");
  timestamp(item.observed_at, "payment_transition.observed_at");
  return deepFreeze(item as unknown as PaymentTransitionCommand);
}

interface RecordTransitionResult<Attempt> {
  attempt: Readonly<Attempt>;
  disposition: "APPLIED" | "REPLAYED";
  external_intent: Readonly<ExternalIntent> | null;
}

function applyPaymentRecord(
  currentValue: PaymentAttempt,
  commandValue: PaymentTransitionCommand,
  units: UnitRegistry,
  ledgerComposed: boolean,
): Readonly<RecordTransitionResult<PaymentAttempt>> {
  const current = validatePaymentAttempt(currentValue, units);
  const command = paymentCommand(commandValue);
  const prior = current.transitions.find((entry) => entry.transition_id === command.transition_id);
  if (prior) {
    const comparable = {
      transition_id: prior.transition_id,
      operation: prior.operation,
      evidence_ref: prior.evidence_ref,
      observed_at: prior.observed_at,
    };
    if (!sameJson(comparable, command)) {
      fail("IDEMPOTENCY_CONFLICT", "Payment transition id was reused with different semantics.", "payment_transition.transition_id");
    }
    return deepFreeze({ attempt: current, disposition: "REPLAYED", external_intent: null });
  }
  if (command.operation === "APPLY_INTERNAL" && !ledgerComposed) {
    fail("INVALID_STATE_TRANSITION", "APPLY_INTERNAL requires the composed ledger API.", "payment_transition.operation");
  }
  if (command.operation === "REVERSE" && current.status === "APPLIED" && !ledgerComposed) {
    fail("INVALID_STATE_TRANSITION", "Reversing an applied payment requires the composed ledger API.", "payment_transition.operation");
  }
  if (current.transitions.length >= LIMITS.maxTransitions) fail("LIMIT_EXCEEDED", "Payment transition history is full.", "payment_attempt.transitions");
  if (Date.parse(command.observed_at) < Date.parse(current.updated_at)) {
    fail("INVALID_STATE_TRANSITION", "Payment transition time cannot move backwards.", "payment_transition.observed_at");
  }
  if (["RECORD_AUTHORIZATION", "PERSIST_SUBMISSION_INTENT", "BEGIN_SUBMISSION"].includes(command.operation)
    && !quoteIsLive(current.quote, command.observed_at, units)) {
    fail("INVALID_STATE_TRANSITION", "Payment cannot advance toward submission after quote expiry.", "payment_transition.observed_at");
  }
  if (command.operation === "EXPIRE" && Date.parse(command.observed_at) < Date.parse(current.quote.expires_at)) {
    fail("INVALID_STATE_TRANSITION", "Payment cannot expire before its quote.", "payment_transition.observed_at");
  }
  const target = paymentTarget(current.status, command.operation);
  const transition: AttemptTransition<PaymentStatus, PaymentOperation> = { ...command, from: current.status, to: target };
  const attempt = validatePaymentAttempt({
    ...current,
    status: target,
    updated_at: command.observed_at,
    transitions: [...current.transitions, transition],
  }, units);
  let externalIntent: ExternalIntent | null = null;
  if (command.operation === "BEGIN_SUBMISSION") {
    const authorization = current.transitions.find((entry) => entry.operation === "RECORD_AUTHORIZATION");
    if (!authorization) fail("INVALID_STATE_TRANSITION", "Payment authorization evidence is missing.", "payment_attempt.transitions");
    externalIntent = {
      kind: "SUBMIT_PAYMENT",
      idempotency_namespace: "PAYMENT",
      idempotency_key: current.payment_idempotency_key,
      attempt_id: current.attempt_id,
      request_fingerprint: current.request_fingerprint,
      authorization_ref: authorization.evidence_ref,
    };
  }
  return deepFreeze({ attempt, disposition: "APPLIED", external_intent: externalIntent });
}

function replaceAttempt<Attempt extends { attempt_id: string }>(
  journal: readonly Readonly<Attempt>[],
  attempt: Readonly<Attempt>,
): readonly Readonly<Attempt>[] {
  return deepFreeze(journal.map((entry) => entry.attempt_id === attempt.attempt_id ? attempt : entry));
}

export function transitionPaymentAttempt(
  journalValue: unknown,
  attemptIdValue: string,
  commandValue: PaymentTransitionCommand,
  units: UnitRegistry,
): Readonly<AttemptTransitionResult<PaymentAttempt>> {
  const journal = validatePaymentAttemptJournal(journalValue, units);
  const attemptId = identifier(attemptIdValue, "attempt_id");
  const current = journal.find((entry) => entry.attempt_id === attemptId);
  if (!current) fail("INVALID_RECORD", "Payment attempt is absent from the supplied journal.", "attempt_id");
  const result = applyPaymentRecord(current, commandValue, units, false);
  const next = result.disposition === "REPLAYED" ? journal : validatePaymentAttemptJournal(replaceAttempt(journal, result.attempt), units);
  return deepFreeze({ ...result, journal: next });
}

function assertApplicationLedger(
  payment: PaymentAttempt,
  transactionValue: unknown,
  accounts: LedgerAccountRegistry,
  units: UnitRegistry,
) {
  assertLedgerAccountUnitCompatibility(accounts, units, [payment.quote.input.unit_id, payment.quote.output.unit_id]);
  const validated = validateLedgerTransaction(transactionValue, accounts);
  const transaction = validated.transaction;
  if (
    transaction.transaction_id !== payment.application_transaction_id
    || transaction.idempotency_key !== payment.application_idempotency_key
    || transaction.request_fingerprint !== payment.request_fingerprint
    || transaction.causation_ref !== payment.attempt_id
    || transaction.reverses_transaction_id !== null
    || transaction.price_revision_id !== payment.quote.price_revision.price_revision_id
    || !sameJson(transaction.conversion_refs, [payment.quote.quote_id])
    || transaction.evidence_refs.length === 0
  ) {
    fail("INVALID_RECORD", "Payment application ledger identity is not bound to the exact attempt and quote.", "ledger_transaction");
  }
  if (validated.balances.some((balance) => units.get(balance.unit_id).ledger_domain !== balance.ledger_domain)) {
    fail("UNIT_MISMATCH", "Payment application ledger domains do not match the supplied unit registry.", "ledger_transaction.postings");
  }
  const expected = new Map([
    [payment.quote.input.unit_id, payment.quote.input.amount_atomic],
    [payment.quote.output.unit_id, payment.quote.output.amount_atomic],
  ]);
  if (validated.balances.length !== expected.size || validated.balances.some((balance) =>
    expected.get(balance.unit_id) !== balance.debit_atomic || balance.credit_atomic !== balance.debit_atomic)) {
    fail("UNBALANCED_LEDGER", "Payment application must conserve exactly the quoted input and output legs.", "ledger_transaction.postings");
  }
  return transaction;
}

function assertReversalLedger(
  payment: PaymentAttempt,
  transactionValue: unknown,
  accounts: LedgerAccountRegistry,
  units: UnitRegistry,
) {
  assertLedgerAccountUnitCompatibility(accounts, units, [payment.quote.input.unit_id, payment.quote.output.unit_id]);
  const validated = validateLedgerTransaction(transactionValue, accounts);
  const transaction = validated.transaction;
  if (validated.balances.some((balance) => units.get(balance.unit_id).ledger_domain !== balance.ledger_domain)) {
    fail("UNIT_MISMATCH", "Payment reversal ledger domains do not match the supplied unit registry.", "ledger_transaction.postings");
  }
  if (
    transaction.transaction_id !== payment.reversal_transaction_id
    || transaction.idempotency_key !== payment.reversal_idempotency_key
    || transaction.request_fingerprint !== reversalFingerprint(payment)
    || transaction.causation_ref !== payment.attempt_id
    || transaction.reverses_transaction_id !== payment.application_transaction_id
    || transaction.price_revision_id !== payment.quote.price_revision.price_revision_id
    || !sameJson(transaction.conversion_refs, [payment.quote.quote_id])
    || transaction.evidence_refs.length === 0
  ) {
    fail("INVALID_RECORD", "Payment reversal ledger identity is not bound to the applied attempt.", "ledger_transaction");
  }
  return transaction;
}

function paymentLedgerState(
  paymentValue: unknown,
  ledgerJournalValue: unknown,
  accounts: LedgerAccountRegistry,
  units: UnitRegistry,
): Readonly<PaymentLedgerState> {
  const payment = validatePaymentAttempt(paymentValue, units);
  assertLedgerAccountUnitCompatibility(accounts, units, [payment.quote.input.unit_id, payment.quote.output.unit_id]);
  const ledgerJournal = validateLedgerJournal(ledgerJournalValue, accounts);
  const applicationCandidates = ledgerJournal.filter((entry) =>
    entry.transaction_id === payment.application_transaction_id
    || entry.idempotency_key === payment.application_idempotency_key
    || entry.request_fingerprint === payment.request_fingerprint);
  if (applicationCandidates.length > 1) {
    fail(
      "IDEMPOTENCY_CONFLICT",
      "Payment application identities appear in multiple ledger entries.",
      "ledger_journal",
    );
  }
  const applicationCandidate = applicationCandidates[0] ?? null;
  const expectedReversalFingerprint = reversalFingerprint(payment);
  const reversalCandidates = ledgerJournal.filter((entry) =>
    entry.transaction_id === payment.reversal_transaction_id
    || entry.idempotency_key === payment.reversal_idempotency_key
    || entry.request_fingerprint === expectedReversalFingerprint
    || entry.reverses_transaction_id === payment.application_transaction_id);
  if (reversalCandidates.length > 1) {
    fail(
      "IDEMPOTENCY_CONFLICT",
      "Payment reversal identities or the application reversal target appear in multiple ledger entries.",
      "ledger_journal",
    );
  }
  const reversalCandidate = reversalCandidates[0] ?? null;
  const application = applicationCandidate === null ? null : assertApplicationLedger(payment, applicationCandidate, accounts, units);
  const reversal = reversalCandidate === null ? null : assertReversalLedger(payment, reversalCandidate, accounts, units);
  const settlementTransition = payment.transitions.find((entry) =>
    entry.operation === "OBSERVE_SETTLED" || entry.operation === "RECONCILE_SETTLED") ?? null;
  const applicationTransition = payment.transitions.find((entry) => entry.operation === "APPLY_INTERNAL") ?? null;
  const appliedReversalTransition = payment.transitions.find((entry) =>
    entry.operation === "REVERSE" && entry.from === "APPLIED") ?? null;
  const externalReversalTransition = payment.transitions.find((entry) =>
    entry.operation === "REVERSE" && entry.from === "EXTERNALLY_SETTLED") ?? null;
  const appliedTransition = applicationTransition !== null;
  const orphanedApplication = payment.status === "REVERSED"
    && externalReversalTransition !== null
    && applicationTransition === null
    && application !== null;
  const ledgerEligibleStatus = payment.status === "EXTERNALLY_SETTLED" || payment.status === "APPLIED" || payment.status === "REVERSED";
  if (application !== null && !ledgerEligibleStatus) {
    fail("INVALID_STATE_TRANSITION", "Application ledger entry precedes an eligible payment state.", "payment_attempt.status");
  }
  if (application !== null && applicationTransition === null && settlementTransition === null) {
    fail(
      "INVALID_STATE_TRANSITION",
      "Ledger-first payment application requires an observed settled payment head.",
      "payment_attempt.transitions",
    );
  }
  if (application !== null && applicationTransition === null && settlementTransition !== null
    && Date.parse(application.recorded_at) < Date.parse(settlementTransition.observed_at)) {
    fail(
      "INVALID_STATE_TRANSITION",
      "Ledger-first payment application cannot predate the settled payment head.",
      "ledger_transaction.recorded_at",
    );
  }
  if (appliedTransition && application === null) {
    fail("PAYMENT_NOT_APPLIED", "Applied payment projection is missing its exact ledger transaction.", "ledger_journal");
  }
  if (application !== null && applicationTransition !== null
    && application.recorded_at !== applicationTransition.observed_at) {
    fail(
      "INVALID_STATE_TRANSITION",
      "Payment application ledger time must equal its derived transition time.",
      "payment_attempt.transitions",
    );
  }
  if (reversal !== null && application === null) {
    fail("INVALID_STATE_TRANSITION", "Payment reversal exists without its application transaction.", "ledger_journal");
  }
  if (reversal !== null && !appliedTransition && !orphanedApplication) {
    fail(
      "INVALID_STATE_TRANSITION",
      "A fixed payment reversal requires either the derived application transition or an orphaned ledger-first application.",
      "ledger_journal",
    );
  }
  if (reversal !== null && externalReversalTransition !== null && !appliedTransition
    && Date.parse(reversal.recorded_at) < Date.parse(externalReversalTransition.observed_at)) {
    fail(
      "INVALID_STATE_TRANSITION",
      "Orphaned application compensation cannot predate the external reversal.",
      "ledger_transaction.recorded_at",
    );
  }
  if (payment.status === "REVERSED" && reversal !== null
    && appliedReversalTransition === null && !orphanedApplication) {
    fail(
      "INVALID_STATE_TRANSITION",
      "A persisted fixed payment reversal requires its derived transition or an external-reversal compensation path.",
      "payment_attempt.transitions",
    );
  }
  if (reversal !== null && appliedReversalTransition !== null
    && reversal.recorded_at !== appliedReversalTransition.observed_at) {
    fail(
      "INVALID_STATE_TRANSITION",
      "Payment reversal ledger time must equal its derived transition time.",
      "payment_attempt.transitions",
    );
  }
  if (
    payment.status === "REVERSED"
    && application !== null
    && reversal === null
    && !orphanedApplication
  ) {
    fail("PAYMENT_NOT_APPLIED", "Reversed applied payment is missing its exact compensating transaction.", "ledger_journal");
  }
  if (ledgerJournal.some((entry) => entry.reverses_transaction_id === payment.reversal_transaction_id)) {
    fail(
      "INVALID_STATE_TRANSITION",
      "A payment reversal cannot itself be reversed outside the fixed payment state machine.",
      "ledger_journal",
    );
  }
  return deepFreeze({
    payment,
    ledger_journal: ledgerJournal,
    application_transaction: application,
    reversal_transaction: reversal,
    compensation_required: orphanedApplication && reversal === null,
    economically_applied: payment.status === "APPLIED" && application !== null && reversal === null,
  });
}

export function validatePaymentLedgerState(
  paymentValue: unknown,
  ledgerJournalValue: unknown,
  accounts: LedgerAccountRegistry,
  units: UnitRegistry,
): Readonly<PaymentLedgerState> {
  return paymentLedgerState(paymentValue, ledgerJournalValue, accounts, units);
}

export function applySettledPayment(
  paymentJournalValue: unknown,
  attemptIdValue: string,
  ledgerJournalValue: unknown,
  transactionValue: unknown,
  accounts: LedgerAccountRegistry,
  units: UnitRegistry,
): Readonly<PaymentLedgerTransitionResult> {
  const paymentJournal = validatePaymentAttemptJournal(paymentJournalValue, units);
  const attemptId = identifier(attemptIdValue, "attempt_id");
  const current = paymentJournal.find((entry) => entry.attempt_id === attemptId);
  if (!current) fail("INVALID_RECORD", "Payment attempt is absent from the supplied journal.", "attempt_id");
  paymentLedgerState(current, ledgerJournalValue, accounts, units);
  const transaction = assertApplicationLedger(current, transactionValue, accounts, units);
  const ledger = appendLedgerTransaction(ledgerJournalValue, transaction, accounts);
  const transition = applyPaymentRecord(current, {
    transition_id: current.application_transition_id,
    operation: "APPLY_INTERNAL",
    evidence_ref: current.application_transaction_id,
    observed_at: transaction.recorded_at,
  }, units, true);
  const next = transition.disposition === "REPLAYED"
    ? paymentJournal
    : validatePaymentAttemptJournal(replaceAttempt(paymentJournal, transition.attempt), units);
  paymentLedgerState(transition.attempt, ledger.journal, accounts, units);
  return deepFreeze({ attempt: transition.attempt, disposition: transition.disposition, payment_journal: next, ledger });
}

export function reverseAppliedPayment(
  paymentJournalValue: unknown,
  attemptIdValue: string,
  ledgerJournalValue: unknown,
  transactionValue: unknown,
  accounts: LedgerAccountRegistry,
  units: UnitRegistry,
): Readonly<PaymentLedgerTransitionResult> {
  const paymentJournal = validatePaymentAttemptJournal(paymentJournalValue, units);
  const attemptId = identifier(attemptIdValue, "attempt_id");
  const current = paymentJournal.find((entry) => entry.attempt_id === attemptId);
  if (!current) fail("INVALID_RECORD", "Payment attempt is absent from the supplied journal.", "attempt_id");
  const appliedReversalTransition = current.transitions.some((entry) =>
    entry.operation === "REVERSE" && entry.from === "APPLIED");
  if (current.status !== "APPLIED" && !(current.status === "REVERSED" && appliedReversalTransition)) {
    fail(
      "INVALID_STATE_TRANSITION",
      "The composed reversal API requires an applied payment or replay of its derived reversal.",
      "payment_attempt.status",
    );
  }
  paymentLedgerState(current, ledgerJournalValue, accounts, units);
  const transaction = assertReversalLedger(current, transactionValue, accounts, units);
  const ledger = appendLedgerTransaction(ledgerJournalValue, transaction, accounts);
  const transition = applyPaymentRecord(current, {
    transition_id: current.reversal_transition_id,
    operation: "REVERSE",
    evidence_ref: current.reversal_transaction_id,
    observed_at: transaction.recorded_at,
  }, units, true);
  const next = transition.disposition === "REPLAYED"
    ? paymentJournal
    : validatePaymentAttemptJournal(replaceAttempt(paymentJournal, transition.attempt), units);
  paymentLedgerState(transition.attempt, ledger.journal, accounts, units);
  return deepFreeze({ attempt: transition.attempt, disposition: transition.disposition, payment_journal: next, ledger });
}

export function compensateOrphanedApplication(
  paymentJournalValue: unknown,
  attemptIdValue: string,
  ledgerJournalValue: unknown,
  transactionValue: unknown,
  accounts: LedgerAccountRegistry,
  units: UnitRegistry,
): Readonly<OrphanedApplicationCompensationResult> {
  const paymentJournal = validatePaymentAttemptJournal(paymentJournalValue, units);
  const attemptId = identifier(attemptIdValue, "attempt_id");
  const current = paymentJournal.find((entry) => entry.attempt_id === attemptId);
  if (!current) fail("INVALID_RECORD", "Payment attempt is absent from the supplied journal.", "attempt_id");
  const externalReversalTransition = current.transitions.some((entry) =>
    entry.operation === "REVERSE" && entry.from === "EXTERNALLY_SETTLED");
  const appliedTransition = current.transitions.some((entry) => entry.operation === "APPLY_INTERNAL");
  if (current.status !== "REVERSED" || !externalReversalTransition || appliedTransition) {
    fail(
      "INVALID_STATE_TRANSITION",
      "Orphaned application compensation requires an external reversal after a ledger-first application.",
      "payment_attempt.status",
    );
  }
  const state = paymentLedgerState(current, ledgerJournalValue, accounts, units);
  if (state.application_transaction === null) {
    fail("INVALID_STATE_TRANSITION", "There is no orphaned application transaction to compensate.", "ledger_journal");
  }
  const transaction = assertReversalLedger(current, transactionValue, accounts, units);
  const ledger = appendLedgerTransaction(ledgerJournalValue, transaction, accounts);
  paymentLedgerState(current, ledger.journal, accounts, units);
  return deepFreeze({ attempt: current, payment_journal: paymentJournal, ledger });
}

export function planPaymentRecovery(
  value: PaymentAttempt,
  ledgerJournalValue: unknown,
  accounts: LedgerAccountRegistry,
  units: UnitRegistry,
): Readonly<RecoveryPlan<PaymentRecoveryAction>> {
  const state = paymentLedgerState(value, ledgerJournalValue, accounts, units);
  const attempt = state.payment;
  let action: PaymentRecoveryAction;
  switch (attempt.status) {
    case "CREATED": action = "RECORD_AUTHORIZATION"; break;
    case "AUTHORIZATION_RECORDED": action = "PERSIST_SUBMISSION_INTENT"; break;
    case "SUBMISSION_INTENT_PERSISTED": action = "BEGIN_SUBMISSION"; break;
    case "SUBMITTING":
    case "AMBIGUOUS": action = "RECONCILE_EXTERNAL"; break;
    case "EXTERNALLY_SETTLED": action = "APPLY_INTERNAL"; break;
    case "APPLIED": action = state.reversal_transaction === null ? "COMPLETE" : "FINALIZE_REVERSAL"; break;
    case "REVERSED": action = state.compensation_required ? "COMPENSATE_ORPHANED_APPLICATION" : "COMPLETE"; break;
    case "DEFINITIVELY_FAILED":
    case "CANCELLED":
    case "EXPIRED": action = "STOP"; break;
  }
  return deepFreeze({ action, automatic_retry: false, first_attempt_permitted: action === "BEGIN_SUBMISSION" });
}

function createEffectAttempt(value: unknown): Readonly<EffectAttempt> {
  const item = record(value, "effect_seed");
  exactKeys(item, [
    "action_digest",
    "attempt_id",
    "created_at",
    "effect_idempotency_key",
    "payment_attempt_id",
    "quote_id",
  ], "effect_seed");
  const attemptId = identifier(item.attempt_id, "effect_seed.attempt_id");
  const idempotencyKey = identifier(item.effect_idempotency_key, "effect_seed.effect_idempotency_key");
  const actionDigest = sha256Identifier(item.action_digest, "effect_seed.action_digest");
  if (item.quote_id !== null) {
    const quoteId = identifier(item.quote_id, "effect_seed.quote_id");
    if (!/^sha256:[0-9a-f]{64}$/u.test(quoteId)) fail("INVALID_RECORD", "Effect quote id must be content-derived.", "effect_seed.quote_id");
  }
  if (item.payment_attempt_id !== null) identifier(item.payment_attempt_id, "effect_seed.payment_attempt_id");
  if ((item.quote_id === null) !== (item.payment_attempt_id === null)) {
    fail("INVALID_RECORD", "Effect must bind both quote and payment attempt, or neither.", "effect_seed");
  }
  const createdAt = timestamp(item.created_at, "effect_seed.created_at");
  return deepFreeze({
    schema: SCHEMAS.effectAttempt,
    attempt_id: attemptId,
    effect_idempotency_key: idempotencyKey,
    action_digest: actionDigest,
    quote_id: item.quote_id as string | null,
    payment_attempt_id: item.payment_attempt_id as string | null,
    request_fingerprint: effectFingerprint(actionDigest, item.quote_id as string | null, item.payment_attempt_id as string | null),
    status: "CREATED",
    created_at: createdAt,
    updated_at: createdAt,
    transitions: [],
  });
}

export function validateEffectAttempt(value: unknown): Readonly<EffectAttempt> {
  const item = record(value, "effect_attempt");
  exactKeys(item, [
    "action_digest",
    "attempt_id",
    "created_at",
    "effect_idempotency_key",
    "payment_attempt_id",
    "quote_id",
    "request_fingerprint",
    "schema",
    "status",
    "transitions",
    "updated_at",
  ], "effect_attempt");
  if (item.schema !== SCHEMAS.effectAttempt) fail("INVALID_RECORD", "effect_attempt.schema is unsupported.", "effect_attempt.schema");
  const seed = createEffectAttempt({
    action_digest: item.action_digest,
    attempt_id: item.attempt_id,
    created_at: item.created_at,
    effect_idempotency_key: item.effect_idempotency_key,
    payment_attempt_id: item.payment_attempt_id,
    quote_id: item.quote_id,
  } satisfies Record<keyof EffectAttemptSeed, unknown>);
  if (item.request_fingerprint !== seed.request_fingerprint) {
    fail("INVALID_RECORD", "effect_attempt.request_fingerprint is not derived from its immutable request.", "effect_attempt.request_fingerprint");
  }
  enumValue(item.status, EFFECT_STATUSES, "effect_attempt.status");
  timestamp(item.updated_at, "effect_attempt.updated_at");
  const history = replayEffectHistory(item.transitions, seed.created_at);
  if (item.status !== history.status || item.updated_at !== history.updatedAt) {
    fail("INVALID_STATE_TRANSITION", "Effect projection must equal its replayed history.", "effect_attempt");
  }
  return deepFreeze({ ...seed, status: history.status, updated_at: history.updatedAt, transitions: history.transitions });
}

export function validateEffectAttemptJournal(value: unknown): readonly Readonly<EffectAttempt>[] {
  const snapshot = snapshotJson(value);
  if (!Array.isArray(snapshot) || snapshot.length > LIMITS.maxArrayItems) {
    fail("LIMIT_EXCEEDED", "Effect journal exceeds the bounded v0.2 history.", "effect_journal");
  }
  const attempts = snapshot.map((entry) => validateEffectAttempt(entry));
  const ids = new Set<string>();
  const keys = new Set<string>();
  const requests = new Set<string>();
  for (const attempt of attempts) {
    if (ids.has(attempt.attempt_id) || keys.has(attempt.effect_idempotency_key) || requests.has(attempt.request_fingerprint)) {
      fail("IDEMPOTENCY_CONFLICT", "Effect journal contains a duplicate attempt, key, or semantic request.", "effect_journal");
    }
    ids.add(attempt.attempt_id);
    keys.add(attempt.effect_idempotency_key);
    requests.add(attempt.request_fingerprint);
  }
  return deepFreeze(attempts);
}

export function registerEffectAttempt(
  journalValue: unknown,
  seedValue: unknown,
): Readonly<AttemptRegistrationResult<EffectAttempt>> {
  const journal = validateEffectAttemptJournal(journalValue);
  const candidate = createEffectAttempt(seedValue);
  const byKey = journal.find((entry) => entry.effect_idempotency_key === candidate.effect_idempotency_key);
  if (byKey) {
    if (byKey.request_fingerprint !== candidate.request_fingerprint) {
      fail("IDEMPOTENCY_CONFLICT", "Effect key was reused for a different semantic request.", "effect_seed.effect_idempotency_key");
    }
    return deepFreeze({ attempt: byKey, disposition: "REPLAYED", journal });
  }
  if (journal.some((entry) => entry.attempt_id === candidate.attempt_id || entry.request_fingerprint === candidate.request_fingerprint)) {
    fail("IDEMPOTENCY_CONFLICT", "Effect attempt or semantic request was reused under a different key.", "effect_seed");
  }
  const next = validateEffectAttemptJournal([...journal, candidate]);
  return deepFreeze({ attempt: candidate, disposition: "REGISTERED", journal: next });
}

function effectCommand(value: unknown): Readonly<EffectTransitionCommand> {
  const item = record(value, "effect_transition");
  exactKeys(item, ["evidence_ref", "gate_revision", "observed_at", "operation", "transition_id"], "effect_transition");
  identifier(item.transition_id, "effect_transition.transition_id");
  enumValue(item.operation, EFFECT_OPERATIONS, "effect_transition.operation");
  reference(item.evidence_ref, "effect_transition.evidence_ref");
  timestamp(item.observed_at, "effect_transition.observed_at");
  const forward = item.operation === "PERSIST_EXECUTION_INTENT" || item.operation === "BEGIN_EXECUTION";
  if (forward) {
    const revision = uint64Decimal(item.gate_revision, "effect_transition.gate_revision");
    if (revision === "0") fail("INVALID_STATE_TRANSITION", "Forward effect transition requires a positive gate revision.", "effect_transition.gate_revision");
    return deepFreeze({ ...item, gate_revision: revision } as unknown as EffectTransitionCommand);
  }
  if (item.gate_revision !== null) {
    fail("INVALID_STATE_TRANSITION", "Observation and terminal transitions must use null gate_revision.", "effect_transition.gate_revision");
  }
  return deepFreeze(item as unknown as EffectTransitionCommand);
}

export function transitionEffectAttemptRecord(
  journalValue: unknown,
  attemptIdValue: string,
  commandValue: EffectTransitionCommand,
): Readonly<AttemptTransitionResult<EffectAttempt>> {
  const journal = validateEffectAttemptJournal(journalValue);
  const attemptId = identifier(attemptIdValue, "attempt_id");
  const current = journal.find((entry) => entry.attempt_id === attemptId);
  if (!current) fail("INVALID_RECORD", "Effect attempt is absent from the supplied journal.", "attempt_id");
  const command = effectCommand(commandValue);
  const prior = current.transitions.find((entry) => entry.transition_id === command.transition_id);
  if (prior) {
    const comparable = {
      transition_id: prior.transition_id,
      operation: prior.operation,
      evidence_ref: prior.evidence_ref,
      gate_revision: prior.gate_revision,
      observed_at: prior.observed_at,
    };
    if (!sameJson(comparable, command)) {
      fail("IDEMPOTENCY_CONFLICT", "Effect transition id was reused with different semantics.", "effect_transition.transition_id");
    }
    return deepFreeze({ attempt: current, disposition: "REPLAYED", journal, external_intent: null });
  }
  if (current.transitions.length >= LIMITS.maxTransitions) fail("LIMIT_EXCEEDED", "Effect transition history is full.", "effect_attempt.transitions");
  if (Date.parse(command.observed_at) < Date.parse(current.updated_at)) {
    fail("INVALID_STATE_TRANSITION", "Effect transition time cannot move backwards.", "effect_transition.observed_at");
  }
  const target = effectTarget(current.status, command.operation);
  const transition: EffectAttemptTransition = { ...command, from: current.status, to: target };
  const attempt = validateEffectAttempt({
    ...current,
    status: target,
    updated_at: command.observed_at,
    transitions: [...current.transitions, transition],
  });
  const next = validateEffectAttemptJournal(replaceAttempt(journal, attempt));
  return deepFreeze({ attempt, disposition: "APPLIED", journal: next, external_intent: null });
}

export function planEffectRecovery(value: EffectAttempt): Readonly<RecoveryPlan<EffectRecoveryAction>> {
  const attempt = validateEffectAttempt(value);
  let action: EffectRecoveryAction;
  switch (attempt.status) {
    case "CREATED": action = "PERSIST_EXECUTION_INTENT"; break;
    case "EXECUTION_INTENT_PERSISTED": action = "BEGIN_EXECUTION"; break;
    case "EXECUTING":
    case "AMBIGUOUS": action = "RECONCILE_EFFECT"; break;
    case "SUCCEEDED": action = "RETURN_RECORDED_RESULT"; break;
    case "DEFINITIVELY_FAILED":
    case "CANCELLED": action = "STOP"; break;
  }
  return deepFreeze({ action, automatic_retry: false, first_attempt_permitted: action === "BEGIN_EXECUTION" });
}

export function paymentReversalRequestFingerprint(paymentValue: PaymentAttempt, units: UnitRegistry): string {
  return reversalFingerprint(validatePaymentAttempt(paymentValue, units));
}
