import { SCHEMAS } from "./constants.js";
import {
  transitionEffectAttemptRecord,
  validateEffectAttempt,
  validateEffectAttemptJournal,
  validatePaymentLedgerState,
} from "./attempts.js";
import { fail } from "./errors.js";
import {
  deepFreeze,
  enumValue,
  exactKeys,
  record,
  reference,
  sameJson,
  sha256Identifier,
  timestamp,
  uint64Decimal,
} from "./internal.js";
import type {
  AdmissionInput,
  AttemptTransitionResult,
  BinaryGate,
  EconomicAdmission,
  EffectAttempt,
  EffectTransitionCommand,
  ExternalIntent,
  PaidEffectPlan,
  ParticipationGate,
  PaymentAttempt,
  PaymentGate,
  ProtectedGateDecision,
  ProtectedGateInput,
} from "./types.js";
import { LedgerAccountRegistry } from "./ledger.js";
import { UnitRegistry } from "./units.js";

const BINARY_GATES: readonly BinaryGate[] = ["ALLOW", "DENY", "UNKNOWN"];
const PARTICIPATION_GATES: readonly ParticipationGate[] = [
  "ACCEPTED",
  "NOT_REQUIRED",
  "REFUSED",
  "DEFERRED",
  "WITHHELD",
  "UNKNOWN",
];
const PAYMENT_GATES: readonly PaymentGate[] = ["NOT_REQUIRED", "SATISFIED", "UNSATISFIED", "AMBIGUOUS"];

function validateProtectedGateInput(value: unknown): Readonly<ProtectedGateInput> {
  const item = record(value, "protected_gates");
  exactKeys(item, [
    "action_digest",
    "authority",
    "evaluated_at",
    "gate_evidence_ref",
    "gate_revision",
    "participation",
    "safety",
    "valid_until",
  ], "protected_gates");
  sha256Identifier(item.action_digest, "protected_gates.action_digest");
  reference(item.gate_evidence_ref, "protected_gates.gate_evidence_ref");
  const gateRevision = uint64Decimal(item.gate_revision, "protected_gates.gate_revision");
  if (gateRevision === "0") fail("INVALID_RECORD", "Gate revision must be positive.", "protected_gates.gate_revision");
  const evaluatedAt = timestamp(item.evaluated_at, "protected_gates.evaluated_at");
  const validUntil = timestamp(item.valid_until, "protected_gates.valid_until");
  if (Date.parse(validUntil) <= Date.parse(evaluatedAt)) {
    fail("INVALID_RECORD", "Protected gate validity must end after evaluation.", "protected_gates.valid_until");
  }
  enumValue(item.authority, BINARY_GATES, "protected_gates.authority");
  enumValue(item.safety, BINARY_GATES, "protected_gates.safety");
  enumValue(item.participation, PARTICIPATION_GATES, "protected_gates.participation");
  return deepFreeze({
    action_digest: item.action_digest,
    gate_evidence_ref: item.gate_evidence_ref,
    gate_revision: gateRevision,
    evaluated_at: evaluatedAt,
    valid_until: validUntil,
    authority: item.authority,
    safety: item.safety,
    participation: item.participation,
  } as ProtectedGateInput);
}

export function validateAdmissionInput(value: unknown): Readonly<AdmissionInput> {
  const item = record(value, "admission_input");
  exactKeys(item, [
    "action_digest",
    "authority",
    "evaluated_at",
    "gate_evidence_ref",
    "gate_revision",
    "participation",
    "payment",
    "safety",
    "valid_until",
  ], "admission_input");
  const gates = validateProtectedGateInput({
    action_digest: item.action_digest,
    authority: item.authority,
    evaluated_at: item.evaluated_at,
    gate_evidence_ref: item.gate_evidence_ref,
    gate_revision: item.gate_revision,
    participation: item.participation,
    safety: item.safety,
    valid_until: item.valid_until,
  });
  enumValue(item.payment, PAYMENT_GATES, "admission_input.payment");
  return deepFreeze({ ...gates, payment: item.payment });
}

function decisionBase(input: ProtectedGateInput) {
  return {
    action_digest: input.action_digest,
    gate_evidence_ref: input.gate_evidence_ref,
    gate_revision: input.gate_revision,
    evaluated_at: input.evaluated_at,
    valid_until: input.valid_until,
  };
}

export function evaluateProtectedGates(value: unknown): Readonly<ProtectedGateDecision> {
  const input = validateProtectedGateInput(value);
  if (input.participation === "REFUSED") {
    return deepFreeze({
      ...decisionBase(input),
      outcome: "REFUSED",
      reason: "Recorded refusal blocks the action independently of payment.",
    });
  }
  if (input.authority === "DENY" || input.safety === "DENY") {
    return deepFreeze({
      ...decisionBase(input),
      outcome: "HARD_DENY",
      reason: "Authority or safety denied the action; payment cannot override it.",
    });
  }
  if (
    input.authority === "UNKNOWN"
    || input.safety === "UNKNOWN"
    || input.participation === "DEFERRED"
    || input.participation === "WITHHELD"
    || input.participation === "UNKNOWN"
  ) {
    return deepFreeze({
      ...decisionBase(input),
      outcome: "HOLD",
      reason: "A protected gate is unresolved; the action must wait without inference.",
    });
  }
  return deepFreeze({
    ...decisionBase(input),
    outcome: "PASS",
    reason: "All supplied protected gates permit evaluation of economic readiness.",
  });
}

export function evaluateEconomicAdmission(value: unknown): Readonly<EconomicAdmission> {
  const input = validateAdmissionInput(value);
  const protectedDecision = evaluateProtectedGates({
    action_digest: input.action_digest,
    authority: input.authority,
    evaluated_at: input.evaluated_at,
    gate_evidence_ref: input.gate_evidence_ref,
    gate_revision: input.gate_revision,
    participation: input.participation,
    safety: input.safety,
    valid_until: input.valid_until,
  });
  const economicallyReady = input.payment === "SATISFIED" || input.payment === "NOT_REQUIRED";
  let outcome: EconomicAdmission["outcome"];
  let hardGateStatus: EconomicAdmission["hard_gate_status"];
  let reason: string;
  switch (protectedDecision.outcome) {
    case "REFUSED":
      outcome = "REFUSED";
      hardGateStatus = "BLOCK";
      reason = protectedDecision.reason;
      break;
    case "HARD_DENY":
      outcome = "HARD_DENY";
      hardGateStatus = "BLOCK";
      reason = protectedDecision.reason;
      break;
    case "HOLD":
      outcome = "HOLD";
      hardGateStatus = "HOLD";
      reason = protectedDecision.reason;
      break;
    case "PASS":
      hardGateStatus = "PASS";
      if (input.payment === "AMBIGUOUS") {
        outcome = "HOLD";
        reason = "Payment finality is ambiguous and must be reconciled before admission.";
      } else if (input.payment === "UNSATISFIED") {
        outcome = "PAYMENT_REQUIRED";
        reason = "Protected gates passed, but the explicit economic condition is unsatisfied.";
      } else {
        outcome = "ADMIT";
        reason = input.payment === "NOT_REQUIRED"
          ? "Protected gates passed and this action requires no payment."
          : "Protected gates passed and the payment condition is recorded as satisfied.";
      }
      break;
  }
  return deepFreeze({
    schema: SCHEMAS.admission,
    input,
    rights_baseline: "xenia.rights/0.1",
    rights_conditional_on_payment: false,
    outcome,
    hard_gate_status: hardGateStatus,
    economically_ready: economicallyReady,
    reason,
  });
}

export function validateEconomicAdmission(value: unknown): Readonly<EconomicAdmission> {
  const item = record(value, "economic_admission");
  exactKeys(item, [
    "economically_ready",
    "hard_gate_status",
    "input",
    "outcome",
    "reason",
    "rights_baseline",
    "rights_conditional_on_payment",
    "schema",
  ], "economic_admission");
  if (item.schema !== SCHEMAS.admission) fail("INVALID_RECORD", "economic_admission.schema is unsupported.", "economic_admission.schema");
  const expected = evaluateEconomicAdmission(item.input);
  if (!sameJson(item, expected)) {
    fail("INVALID_RECORD", "Economic admission must equal the decision for its embedded input.", "economic_admission");
  }
  return expected;
}

function terminalOrRecoveryPlan(effect: EffectAttempt): Readonly<PaidEffectPlan> | null {
  if (effect.status === "EXECUTING" || effect.status === "AMBIGUOUS") {
    return deepFreeze({
      action: "RECONCILE_EFFECT",
      may_execute: false,
      automatic_retry: false,
      reason: "Execution may already have happened; reconcile even if gates or payment later change.",
    });
  }
  if (effect.status === "SUCCEEDED") {
    return deepFreeze({
      action: "RETURN_RECORDED_RESULT",
      may_execute: false,
      automatic_retry: false,
      reason: "Return the separately recorded result without repeating execution.",
    });
  }
  if (effect.status === "DEFINITIVELY_FAILED" || effect.status === "CANCELLED") {
    return deepFreeze({
      action: "STOP",
      may_execute: false,
      automatic_retry: false,
      reason: "The effect attempt is terminal; later payment or gate changes do not restart it.",
    });
  }
  return null;
}

export function planPaidEffect(
  admissionValue: EconomicAdmission,
  effectValue: EffectAttempt,
  paymentValue: PaymentAttempt | null,
  ledgerJournalValue: unknown,
  accounts: LedgerAccountRegistry,
  units: UnitRegistry,
): Readonly<PaidEffectPlan> {
  const admission = validateEconomicAdmission(admissionValue);
  const effect = validateEffectAttempt(effectValue);
  if (admission.input.action_digest !== effect.action_digest) {
    fail("INVALID_RECORD", "Effect action must match the admission decision.", "effect_attempt.action_digest");
  }

  const terminal = terminalOrRecoveryPlan(effect);
  if (terminal) return terminal;

  if (admission.hard_gate_status === "BLOCK") {
    return deepFreeze({
      action: "BLOCK_HARD_GATE",
      may_execute: false,
      automatic_retry: false,
      reason: "A protected hard gate blocks forward movement independently of payment.",
    });
  }
  if (admission.hard_gate_status === "HOLD") {
    return deepFreeze({
      action: "WAIT_FOR_HARD_GATE",
      may_execute: false,
      automatic_retry: false,
      reason: "A protected gate is unresolved; no economic state can authorize execution.",
    });
  }
  if (admission.outcome !== "ADMIT") {
    return deepFreeze({
      action: "WAIT_FOR_PAYMENT",
      may_execute: false,
      automatic_retry: false,
      reason: admission.input.payment === "AMBIGUOUS"
        ? "Reconcile the ambiguous payment; do not charge or execute again."
        : "The explicit payment condition is not yet satisfied.",
    });
  }

  if (admission.input.payment === "SATISFIED") {
    const paymentState = paymentValue === null
      ? null
      : validatePaymentLedgerState(paymentValue, ledgerJournalValue, accounts, units);
    const payment = paymentState?.payment ?? null;
    if (
      payment === null
      || paymentState?.economically_applied !== true
      || effect.payment_attempt_id !== payment.attempt_id
      || effect.quote_id !== payment.quote.quote_id
      || effect.action_digest !== payment.quote.action_digest
    ) {
      fail(
        "PAYMENT_NOT_APPLIED",
        "Paid effect requires the exact applied content-derived quote and payment binding.",
        "payment_attempt",
      );
    }
  } else if (admission.input.payment === "NOT_REQUIRED") {
    if (paymentValue !== null || effect.payment_attempt_id !== null || effect.quote_id !== null) {
      fail("INVALID_RECORD", "A payment-free admission must not bind a quote or payment attempt.", "payment_attempt");
    }
  } else {
    fail("PAYMENT_NOT_APPLIED", "Admission is not economically ready.", "economic_admission.input.payment");
  }

  if (effect.status === "CREATED") {
    return deepFreeze({
      action: "PERSIST_EFFECT_INTENT",
      may_execute: false,
      automatic_retry: false,
      reason: "Persist a gate-bound effect intent before claiming its one execution attempt.",
    });
  }
  return deepFreeze({
    action: "BEGIN_EFFECT_EXECUTION",
    may_execute: true,
    automatic_retry: false,
    reason: "Commit BEGIN_EXECUTION with CAS; only the newly returned external intent may perform I/O.",
  });
}

function admissionIsFresh(admission: EconomicAdmission, observedAt: string): boolean {
  const time = Date.parse(observedAt);
  return time >= Date.parse(admission.input.evaluated_at) && time < Date.parse(admission.input.valid_until);
}

export function transitionEffectAttempt(
  journalValue: unknown,
  attemptIdValue: string,
  commandValue: EffectTransitionCommand,
  admissionValue: EconomicAdmission | null,
  paymentValue: PaymentAttempt | null,
  ledgerJournalValue: unknown,
  accounts: LedgerAccountRegistry,
  trustedGateHeadRevision: string | null,
  units: UnitRegistry,
): Readonly<AttemptTransitionResult<EffectAttempt>> {
  const journal = validateEffectAttemptJournal(journalValue);
  const current = journal.find((entry) => entry.attempt_id === attemptIdValue);
  if (!current) fail("INVALID_RECORD", "Effect attempt is absent from the supplied journal.", "attempt_id");
  const tentative = transitionEffectAttemptRecord(journal, attemptIdValue, commandValue);
  if (tentative.disposition === "REPLAYED") return tentative;
  const operation = tentative.attempt.transitions[tentative.attempt.transitions.length - 1]!.operation;
  if (operation !== "PERSIST_EXECUTION_INTENT" && operation !== "BEGIN_EXECUTION") return tentative;
  if (admissionValue === null) {
    fail("INVALID_STATE_TRANSITION", "Forward effect movement requires a current admission decision.", "economic_admission");
  }
  const admission = validateEconomicAdmission(admissionValue);
  const plan = planPaidEffect(admission, current, paymentValue, ledgerJournalValue, accounts, units);
  const expectedAction = operation === "PERSIST_EXECUTION_INTENT" ? "PERSIST_EFFECT_INTENT" : "BEGIN_EFFECT_EXECUTION";
  const transition = tentative.attempt.transitions[tentative.attempt.transitions.length - 1]!;
  if (plan.action !== expectedAction || transition.evidence_ref !== admission.input.gate_evidence_ref) {
    fail("INVALID_STATE_TRANSITION", "Effect transition does not match the current gate-bound plan.", "effect_transition");
  }
  if (!admissionIsFresh(admission, transition.observed_at)) {
    fail("INVALID_STATE_TRANSITION", "Admission expired or was not yet valid at effect transition time.", "economic_admission.input.valid_until");
  }
  if (trustedGateHeadRevision === null) {
    fail("INVALID_STATE_TRANSITION", "Forward effect movement requires the host's trusted gate-head revision.", "gate_head_revision");
  }
  const gateHead = uint64Decimal(trustedGateHeadRevision, "gate_head_revision");
  if (gateHead === "0" || transition.gate_revision !== gateHead || admission.input.gate_revision !== gateHead) {
    fail("INVALID_STATE_TRANSITION", "Admission and effect transition must match the trusted current gate head.", "gate_head_revision");
  }
  if (operation !== "BEGIN_EXECUTION") return tentative;
  const externalIntent: ExternalIntent = {
    kind: "EXECUTE_EFFECT",
    idempotency_namespace: "EFFECT",
    idempotency_key: current.effect_idempotency_key,
    attempt_id: current.attempt_id,
    request_fingerprint: current.request_fingerprint,
    authorization_ref: admission.input.gate_evidence_ref,
    gate_revision: gateHead,
  };
  return deepFreeze({ ...tentative, external_intent: externalIntent });
}
