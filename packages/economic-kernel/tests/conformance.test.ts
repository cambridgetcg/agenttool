import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  evaluateConformance,
  verifyOfficialVectorSources,
  type ConformanceObservation,
  type JsonValue,
} from "../../economic-conformance/src/index.js";
import {
  EconomicKernelError,
  SCHEMAS,
  UnitRegistry,
  addAmounts,
  amount,
  appendLedgerTransaction,
  applySettledPayment,
  compensateOrphanedApplication,
  convertAmount,
  evaluateEconomicAdmission,
  paymentReversalRequestFingerprint,
  planPaidEffect,
  planPaymentRecovery,
  registerEffectAttempt,
  registerPaymentAttempt,
  reverseAppliedPayment,
  selectEffectivePriceRevision,
  transitionEffectAttempt,
  transitionPaymentAttempt,
  validateAmount,
  validateEconomicQuote,
  validateLedgerTransaction,
  validatePaymentLedgerState,
  validatePriceBookTimeline,
  validatePriceRevision,
  type AdmissionInput,
  type EffectAttempt,
  type EffectOperation,
  type LedgerPosting,
  type LedgerTransaction,
  type PaymentAttempt,
  type PaymentOperation,
} from "../src/index.js";
import {
  ACTION_DIGEST,
  BASE_USDC,
  GBP,
  PROJECT_CREDIT,
  START,
  effectSeed,
  makeAccounts,
  makeUnits,
  nextTime,
  paymentSeed,
  price,
  quote,
} from "./fixtures.js";

type JsonObject = { [key: string]: JsonValue };

interface AdapterRequest {
  case_id: string;
  operation: string;
  input: JsonValue;
}

interface PaymentState {
  journal: readonly Readonly<PaymentAttempt>[];
  attempt: Readonly<PaymentAttempt>;
}

interface AppliedPaymentState extends PaymentState {
  ledger: readonly Readonly<LedgerTransaction>[];
}

interface EffectState {
  journal: readonly Readonly<EffectAttempt>[];
  attempt: Readonly<EffectAttempt>;
}

function inputObject(value: JsonValue): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Conformance adapter input must be an object.");
  }
  return value;
}

function stringField(input: JsonObject, name: string): string {
  const value = input[name];
  if (typeof value !== "string") throw new Error(`Conformance adapter field ${name} must be a string.`);
  return value;
}

function integerField(input: JsonObject, name: string): number {
  const value = input[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Conformance adapter field ${name} must be a non-negative safe integer.`);
  }
  return value;
}

function posting(
  postingId: string,
  accountId: string,
  domain: string,
  unitId: string,
  side: "DEBIT" | "CREDIT",
  value: string,
): LedgerPosting {
  return {
    posting_id: postingId,
    account_id: accountId,
    ledger_domain: domain,
    unit_id: unitId,
    side,
    amount_atomic: value,
  };
}

function ledgerTransaction(overrides: Partial<LedgerTransaction> = {}): LedgerTransaction {
  return {
    schema: SCHEMAS.ledgerTransaction,
    transaction_id: "transaction:conformance-gbp-1",
    idempotency_key: "ledger-key:conformance-gbp-1",
    request_fingerprint: "sha256:conformance-ledger-request-1",
    causation_ref: "cause:conformance-order-1",
    recorded_at: nextTime(1),
    postings: [
      posting("posting:conformance-gbp-debit", "account:gbp-user", "ledger:gbp", GBP, "DEBIT", "125"),
      posting("posting:conformance-gbp-credit", "account:gbp-clearing", "ledger:gbp", GBP, "CREDIT", "125"),
    ],
    evidence_refs: ["evidence:conformance-ledger-1"],
    conversion_refs: [],
    price_revision_id: null,
    reverses_transaction_id: null,
    ...overrides,
  };
}

function paymentCommand(operation: PaymentOperation, index: number) {
  return {
    transition_id: `payment-transition:conformance-${String(index)}`,
    operation,
    evidence_ref: `evidence:conformance-payment-${String(index)}`,
    observed_at: nextTime(index),
  };
}

function advancePayment(
  operations: readonly PaymentOperation[],
  fixedQuote = quote(),
): PaymentState {
  const units = makeUnits();
  const registered = registerPaymentAttempt([], paymentSeed({ quote: fixedQuote }), units);
  let journal = registered.journal;
  let attempt = registered.attempt;
  for (const [offset, operation] of operations.entries()) {
    const result = transitionPaymentAttempt(
      journal,
      attempt.attempt_id,
      paymentCommand(operation, offset + 1),
      units,
    );
    journal = result.journal;
    attempt = result.attempt;
  }
  return { journal, attempt };
}

function applicationTransaction(
  payment: Readonly<PaymentAttempt>,
  paidInputAtomic = payment.quote.input.amount_atomic,
  deliveredOutputAtomic = payment.quote.output.amount_atomic,
): LedgerTransaction {
  return {
    schema: SCHEMAS.ledgerTransaction,
    transaction_id: payment.application_transaction_id,
    idempotency_key: payment.application_idempotency_key,
    request_fingerprint: payment.request_fingerprint,
    causation_ref: payment.attempt_id,
    recorded_at: nextTime(5),
    postings: [
      posting(
        "posting:conformance-payment-usdc-debit",
        "account:usdc-user",
        "ledger:base-usdc",
        BASE_USDC,
        "DEBIT",
        paidInputAtomic,
      ),
      posting(
        "posting:conformance-payment-usdc-credit",
        "account:usdc-clearing",
        "ledger:base-usdc",
        BASE_USDC,
        "CREDIT",
        paidInputAtomic,
      ),
      posting(
        "posting:conformance-payment-credit-debit",
        "account:project-issuer",
        "ledger:project-credit",
        PROJECT_CREDIT,
        "DEBIT",
        deliveredOutputAtomic,
      ),
      posting(
        "posting:conformance-payment-credit-credit",
        "account:project-user",
        "ledger:project-credit",
        PROJECT_CREDIT,
        "CREDIT",
        deliveredOutputAtomic,
      ),
    ],
    evidence_refs: ["evidence:conformance-provider-settlement-1"],
    conversion_refs: [payment.quote.quote_id],
    price_revision_id: payment.quote.price_revision.price_revision_id,
    reverses_transaction_id: null,
  };
}

function reversalTransaction(
  payment: Readonly<PaymentAttempt>,
  overrides: Partial<LedgerTransaction> = {},
): LedgerTransaction {
  const units = makeUnits();
  return {
    schema: SCHEMAS.ledgerTransaction,
    transaction_id: payment.reversal_transaction_id,
    idempotency_key: payment.reversal_idempotency_key,
    request_fingerprint: paymentReversalRequestFingerprint(payment as PaymentAttempt, units),
    causation_ref: payment.attempt_id,
    recorded_at: nextTime(9),
    postings: [
      posting("posting:conformance-reverse-usdc-credit", "account:usdc-user", "ledger:base-usdc", BASE_USDC, "CREDIT", payment.quote.input.amount_atomic),
      posting("posting:conformance-reverse-usdc-debit", "account:usdc-clearing", "ledger:base-usdc", BASE_USDC, "DEBIT", payment.quote.input.amount_atomic),
      posting("posting:conformance-reverse-credit-credit", "account:project-issuer", "ledger:project-credit", PROJECT_CREDIT, "CREDIT", payment.quote.output.amount_atomic),
      posting("posting:conformance-reverse-credit-debit", "account:project-user", "ledger:project-credit", PROJECT_CREDIT, "DEBIT", payment.quote.output.amount_atomic),
    ],
    evidence_refs: ["evidence:conformance-provider-reversal-1"],
    conversion_refs: [payment.quote.quote_id],
    price_revision_id: payment.quote.price_revision.price_revision_id,
    reverses_transaction_id: payment.application_transaction_id,
    ...overrides,
  };
}

function reversalOfReversalTransaction(payment: Readonly<PaymentAttempt>): LedgerTransaction {
  return {
    ...applicationTransaction(payment),
    transaction_id: "ledger:conformance-payment-reversal-of-reversal-1",
    idempotency_key: "ledger-key:conformance-payment-reversal-of-reversal-1",
    request_fingerprint: "request:conformance-payment-reversal-of-reversal-1",
    recorded_at: nextTime(10),
    evidence_refs: ["evidence:conformance-payment-reversal-of-reversal-1"],
    reverses_transaction_id: payment.reversal_transaction_id,
  };
}

function unrelatedTransaction(
  recordedAt: string,
  overrides: Partial<LedgerTransaction> = {},
): LedgerTransaction {
  return ledgerTransaction({
    transaction_id: "ledger:conformance-unrelated-gbp-1",
    idempotency_key: "ledger-key:conformance-unrelated-gbp-1",
    request_fingerprint: "request:conformance-unrelated-gbp-1",
    causation_ref: "cause:conformance-unrelated-gbp-1",
    recorded_at: recordedAt,
    postings: [
      posting("posting:conformance-unrelated-gbp-debit", "account:gbp-user", "ledger:gbp", GBP, "DEBIT", "1"),
      posting("posting:conformance-unrelated-gbp-credit", "account:gbp-clearing", "ledger:gbp", GBP, "CREDIT", "1"),
    ],
    evidence_refs: ["evidence:conformance-unrelated-gbp-1"],
    ...overrides,
  });
}

function appliedPayment(): AppliedPaymentState {
  const units = makeUnits();
  const accounts = makeAccounts(units);
  const settled = advancePayment([
    "RECORD_AUTHORIZATION",
    "PERSIST_SUBMISSION_INTENT",
    "BEGIN_SUBMISSION",
    "OBSERVE_SETTLED",
  ]);
  const applied = applySettledPayment(
    settled.journal,
    settled.attempt.attempt_id,
    [],
    applicationTransaction(settled.attempt),
    accounts,
    units,
  );
  return {
    journal: applied.payment_journal,
    attempt: applied.attempt,
    ledger: applied.ledger.journal,
  };
}

function admission(overrides: Partial<AdmissionInput> = {}) {
  return evaluateEconomicAdmission({
    action_digest: ACTION_DIGEST,
    gate_evidence_ref: "gate:conformance-decision-1",
    gate_revision: "1",
    evaluated_at: START,
    valid_until: "2026-09-02T00:00:30.000Z",
    authority: "ALLOW",
    safety: "ALLOW",
    participation: "ACCEPTED",
    payment: "SATISFIED",
    ...overrides,
  });
}

function effectCommand(
  operation: EffectOperation,
  index: number,
  evidenceRef = "gate:conformance-decision-1",
  gateRevision: string | null = operation === "PERSIST_EXECUTION_INTENT" || operation === "BEGIN_EXECUTION"
    ? "1"
    : null,
) {
  return {
    transition_id: `effect-transition:conformance-${String(index)}`,
    operation,
    evidence_ref: evidenceRef,
    observed_at: nextTime(index),
    gate_revision: gateRevision,
  };
}

function registeredEffect(): EffectState {
  const registered = registerEffectAttempt([], effectSeed());
  return { journal: registered.journal, attempt: registered.attempt };
}

function persistedPaidEffect(gateRevision = "1") {
  const units = makeUnits();
  const payment = appliedPayment();
  const initial = registeredEffect();
  const authorization = admission({ gate_revision: gateRevision });
  const persisted = transitionEffectAttempt(
    initial.journal,
    initial.attempt.attempt_id,
    effectCommand("PERSIST_EXECUTION_INTENT", 6, authorization.input.gate_evidence_ref, gateRevision),
    authorization,
    payment.attempt as PaymentAttempt,
    payment.ledger,
    makeAccounts(units),
    gateRevision,
    units,
  );
  return {
    journal: persisted.journal,
    attempt: persisted.attempt,
    payment,
    authorization,
  };
}

function quoteForInput(inputAtomic: string) {
  const units = makeUnits();
  const outputAtomic = (BigInt(inputAtomic) / 1_000n).toString();
  return quote({
    input: amount(BASE_USDC, inputAtomic, units),
    output: amount(PROJECT_CREDIT, outputAtomic, units),
  });
}

function runAdmission(input: JsonObject): JsonValue {
  const decision = admission({
    authority: stringField(input, "authority") as AdmissionInput["authority"],
    safety: stringField(input, "safety") as AdmissionInput["safety"],
    participation: stringField(input, "participation") as AdmissionInput["participation"],
    payment: stringField(input, "payment") as AdmissionInput["payment"],
  });
  return {
    economically_ready: decision.economically_ready,
    hard_gate_status: decision.hard_gate_status,
    outcome: decision.outcome,
    rights_conditional_on_payment: decision.rights_conditional_on_payment,
  };
}

function runAddAmounts(input: JsonObject): JsonValue {
  const units = makeUnits();
  const sharedUnit = input.unit_id;
  const leftUnit = typeof sharedUnit === "string" ? sharedUnit : stringField(input, "left_unit_id");
  const rightUnit = typeof sharedUnit === "string" ? sharedUnit : stringField(input, "right_unit_id");
  const result = addAmounts(
    amount(leftUnit, stringField(input, "left_atomic"), units),
    amount(rightUnit, stringField(input, "right_atomic"), units),
    units,
  );
  return { amount_atomic: result.amount_atomic, unit_id: result.unit_id };
}

function runValidateAmount(input: JsonObject): JsonValue {
  const validated = validateAmount({
    schema: SCHEMAS.amount,
    unit_id: input.unit_id,
    amount_atomic: input.amount_atomic,
  }, makeUnits());
  return { amount_atomic: validated.amount_atomic, unit_id: validated.unit_id };
}

function runPriceScenario(input: JsonObject): JsonValue {
  const units = makeUnits();
  switch (stringField(input, "scenario")) {
    case "EXACT_CONVERSION": {
      const result = convertAmount(
        amount(BASE_USDC, stringField(input, "input_atomic"), units),
        price({
          input_atomic_per_lot: stringField(input, "input_per_lot"),
          output_atomic_per_lot: stringField(input, "output_per_lot"),
        }),
        START,
        units,
      );
      if (!result.exact) throw new Error("Exact conversion vector unexpectedly produced a remainder.");
      return { exact: true, output_atomic: result.output.amount_atomic };
    }
    case "RETURN_REMAINDER": {
      const result = convertAmount(
        amount(BASE_USDC, stringField(input, "input_atomic"), units),
        price({
          input_atomic_per_lot: stringField(input, "input_per_lot"),
          output_atomic_per_lot: stringField(input, "output_per_lot"),
          rounding: "RETURN_REMAINDER",
        }),
        START,
        units,
      );
      if (result.exact) throw new Error("Remainder vector unexpectedly converted exactly.");
      return {
        divisor: result.divisor,
        exact: false,
        has_output: "output" in result,
        remainder: result.remainder,
      };
    }
    case "OVERLAPPING_REVISIONS": {
      const first = price({
        input_atomic_per_lot: stringField(input, "first_input_per_lot"),
        effective_until: "2027-06-01T00:00:00.000Z",
      });
      const second = price({
        revision: "2",
        input_atomic_per_lot: stringField(input, "second_input_per_lot"),
        effective_from: "2027-01-01T00:00:00.000Z",
        supersedes_price_revision_id: first.price_revision_id,
      });
      validatePriceBookTimeline([first, second], units);
      return null;
    }
    case "SUCCESSOR_BOUNDARY": {
      const observedAt = stringField(input, "observed_at");
      const first = price({ effective_until: observedAt });
      const second = price({
        revision: "2",
        input_atomic_per_lot: "2000",
        effective_from: observedAt,
        supersedes_price_revision_id: first.price_revision_id,
      });
      const timeline = validatePriceBookTimeline([first, second], units);
      return { revision: selectEffectivePriceRevision(timeline, observedAt, units).revision };
    }
    case "REUSE_ID_DIFFERENT_RATIO": {
      const original = price({ input_atomic_per_lot: stringField(input, "first_input_per_lot") });
      validatePriceRevision({
        ...original,
        input_atomic_per_lot: stringField(input, "mutated_input_per_lot"),
      }, units);
      return null;
    }
    default:
      throw new Error("Unsupported price conformance scenario.");
  }
}

function runQuoteScenario(input: JsonObject): JsonValue {
  const units = makeUnits();
  switch (stringField(input, "scenario")) {
    case "REORDERED_AMOUNT_KEYS": {
      const canonical = quote();
      const reordered = quote({
        input: {
          amount_atomic: canonical.input.amount_atomic,
          unit_id: canonical.input.unit_id,
          schema: canonical.input.schema,
        },
      });
      return { same_quote_id: reordered.quote_id === canonical.quote_id };
    }
    case "REUSE_ID_CHANGED_AMOUNT": {
      const original = quoteForInput(stringField(input, "first_atomic"));
      const changed = quoteForInput(stringField(input, "changed_atomic"));
      validateEconomicQuote({ ...changed, quote_id: original.quote_id }, units);
      return null;
    }
    case "ZERO_PAYMENT": {
      quote({
        input: amount(BASE_USDC, stringField(input, "input_atomic"), units),
        output: amount(PROJECT_CREDIT, stringField(input, "output_atomic"), units),
      });
      return null;
    }
    default:
      throw new Error("Unsupported quote conformance scenario.");
  }
}

function runLedgerScenario(input: JsonObject): JsonValue {
  const units = makeUnits();
  const accounts = makeAccounts(units);
  switch (stringField(input, "scenario")) {
    case "ACCOUNT_UNIT_MISMATCH": {
      validateLedgerTransaction(ledgerTransaction({ postings: [
        posting(
          "posting:conformance-bad-unit-debit",
          "account:gbp-user",
          "ledger:base-usdc",
          BASE_USDC,
          "DEBIT",
          "1",
        ),
        posting(
          "posting:conformance-bad-unit-credit",
          "account:gbp-clearing",
          "ledger:base-usdc",
          BASE_USDC,
          "CREDIT",
          "1",
        ),
      ] }), accounts);
      return null;
    }
    case "BALANCED_MULTI_UNIT": {
      const inputAtomic = stringField(input, "input_atomic");
      const outputAtomic = stringField(input, "output_atomic");
      const transaction = ledgerTransaction({
        transaction_id: "transaction:conformance-conversion-1",
        idempotency_key: "ledger-key:conformance-conversion-1",
        request_fingerprint: "sha256:conformance-conversion-request-1",
        postings: [
          posting("posting:conformance-usdc-debit", "account:usdc-user", "ledger:base-usdc", BASE_USDC, "DEBIT", inputAtomic),
          posting("posting:conformance-usdc-credit", "account:usdc-clearing", "ledger:base-usdc", BASE_USDC, "CREDIT", inputAtomic),
          posting("posting:conformance-credit-debit", "account:project-issuer", "ledger:project-credit", PROJECT_CREDIT, "DEBIT", outputAtomic),
          posting("posting:conformance-credit-credit", "account:project-user", "ledger:project-credit", PROJECT_CREDIT, "CREDIT", outputAtomic),
        ],
        conversion_refs: ["conversion:conformance-quote-1"],
        price_revision_id: price().price_revision_id,
      });
      const result = validateLedgerTransaction(transaction, accounts);
      return { balanced_units: result.balances.length, posting_count: result.transaction.postings.length };
    }
    case "CROSS_UNIT_CANCELLATION": {
      validateLedgerTransaction(ledgerTransaction({
        transaction_id: "transaction:conformance-bad-cross-unit",
        idempotency_key: "ledger-key:conformance-bad-cross-unit",
        postings: [
          posting("posting:conformance-bad-usdc-debit", "account:usdc-user", "ledger:base-usdc", BASE_USDC, "DEBIT", "1000"),
          posting("posting:conformance-bad-usdc-credit", "account:usdc-clearing", "ledger:base-usdc", BASE_USDC, "CREDIT", "999"),
          posting("posting:conformance-bad-credit-debit", "account:project-issuer", "ledger:project-credit", PROJECT_CREDIT, "DEBIT", "1"),
          posting("posting:conformance-bad-credit-credit", "account:project-user", "ledger:project-credit", PROJECT_CREDIT, "CREDIT", "2"),
        ],
        conversion_refs: ["conversion:conformance-bad-1"],
        price_revision_id: price().price_revision_id,
      }), accounts);
      return null;
    }
    case "FORGED_PRIOR_REVERSAL": {
      const original = ledgerTransaction();
      const forgedReversal = ledgerTransaction({
        transaction_id: "transaction:conformance-forged-reversal",
        idempotency_key: "ledger-key:conformance-forged-reversal",
        request_fingerprint: "sha256:conformance-forged-reversal",
        causation_ref: "cause:conformance-forged-reversal",
        recorded_at: nextTime(2),
        reverses_transaction_id: original.transaction_id,
      });
      const unrelated = ledgerTransaction({
        transaction_id: "transaction:conformance-unrelated",
        idempotency_key: "ledger-key:conformance-unrelated",
        request_fingerprint: "sha256:conformance-unrelated",
        recorded_at: nextTime(3),
      });
      appendLedgerTransaction([original, forgedReversal], unrelated, accounts);
      return null;
    }
    case "IDEMPOTENT_REPLAY": {
      const first = appendLedgerTransaction([], ledgerTransaction(), accounts);
      const replay = appendLedgerTransaction(first.journal, ledgerTransaction(), accounts);
      return { disposition: replay.disposition, journal_length: replay.journal.length };
    }
    case "SPLIT_TOTAL_OVERFLOW": {
      const maximum = stringField(input, "amount_atomic");
      validateLedgerTransaction(ledgerTransaction({
        transaction_id: "transaction:conformance-split-total-overflow",
        idempotency_key: "ledger-key:conformance-split-total-overflow",
        request_fingerprint: "sha256:conformance-split-total-overflow",
        postings: [
          posting("posting:conformance-split-debit-1", "account:gbp-user", "ledger:gbp", GBP, "DEBIT", maximum),
          posting("posting:conformance-split-debit-2", "account:gbp-user", "ledger:gbp", GBP, "DEBIT", maximum),
          posting("posting:conformance-split-credit-1", "account:gbp-clearing", "ledger:gbp", GBP, "CREDIT", maximum),
          posting("posting:conformance-split-credit-2", "account:gbp-clearing", "ledger:gbp", GBP, "CREDIT", maximum),
        ],
      }), accounts);
      return null;
    }
    case "SPLIT_TOTAL_MAXIMUM": {
      const first = stringField(input, "first_atomic");
      const second = stringField(input, "second_atomic");
      const validated = validateLedgerTransaction(ledgerTransaction({
        transaction_id: "transaction:conformance-split-total-maximum",
        idempotency_key: "ledger-key:conformance-split-total-maximum",
        request_fingerprint: "sha256:conformance-split-total-maximum",
        postings: [
          posting("posting:conformance-maximum-debit-1", "account:gbp-user", "ledger:gbp", GBP, "DEBIT", first),
          posting("posting:conformance-maximum-debit-2", "account:gbp-user", "ledger:gbp", GBP, "DEBIT", second),
          posting("posting:conformance-maximum-credit-1", "account:gbp-clearing", "ledger:gbp", GBP, "CREDIT", first),
          posting("posting:conformance-maximum-credit-2", "account:gbp-clearing", "ledger:gbp", GBP, "CREDIT", second),
        ],
      }), accounts);
      return {
        credit_atomic: validated.balances[0]!.credit_atomic,
        debit_atomic: validated.balances[0]!.debit_atomic,
        posting_count: validated.balances[0]!.posting_count,
      };
    }
    default:
      throw new Error("Unsupported ledger conformance scenario.");
  }
}

function runPaymentScenario(input: JsonObject): JsonValue {
  const units = makeUnits();
  const accounts = makeAccounts(units);
  switch (stringField(input, "scenario")) {
    case "AMBIGUOUS_RECOVERY": {
      const state = advancePayment([
        "RECORD_AUTHORIZATION",
        "PERSIST_SUBMISSION_INTENT",
        "BEGIN_SUBMISSION",
        "OBSERVE_AMBIGUOUS",
      ]);
      const plan = planPaymentRecovery(state.attempt as PaymentAttempt, [], accounts, units);
      return {
        action: plan.action,
        automatic_retry: plan.automatic_retry,
        first_attempt_permitted: plan.first_attempt_permitted,
      };
    }
    case "RESERVED_APPLICATION_TRANSITION_ID": {
      const registered = registerPaymentAttempt([], paymentSeed(), units);
      transitionPaymentAttempt(
        registered.journal,
        registered.attempt.attempt_id,
        {
          ...paymentCommand("RECORD_AUTHORIZATION", 1),
          transition_id: registered.attempt.application_transition_id,
        },
        units,
      );
      return null;
    }
    case "RESERVED_REVERSAL_TRANSITION_ID": {
      const settled = advancePayment([
        "RECORD_AUTHORIZATION",
        "PERSIST_SUBMISSION_INTENT",
        "BEGIN_SUBMISSION",
        "OBSERVE_SETTLED",
      ]);
      transitionPaymentAttempt(
        settled.journal,
        settled.attempt.attempt_id,
        {
          ...paymentCommand("REVERSE", 5),
          transition_id: settled.attempt.reversal_transition_id,
          evidence_ref: settled.attempt.reversal_transaction_id,
        },
        units,
      );
      return null;
    }
    case "LEDGER_FIRST_APPLICATION": {
      const settled = advancePayment([
        "RECORD_AUTHORIZATION",
        "PERSIST_SUBMISSION_INTENT",
        "BEGIN_SUBMISSION",
        "OBSERVE_SETTLED",
      ]);
      const transaction = applicationTransaction(settled.attempt);
      const ledgerOnly = appendLedgerTransaction([], transaction, accounts);
      const withLaterEntry = appendLedgerTransaction(
        ledgerOnly.journal,
        unrelatedTransaction(nextTime(6)),
        accounts,
      );
      const recovered = applySettledPayment(
        settled.journal,
        settled.attempt.attempt_id,
        withLaterEntry.journal,
        transaction,
        accounts,
        units,
      );
      return {
        ledger_disposition: recovered.ledger.disposition,
        ledger_entries: recovered.ledger.journal.length,
        payment_status: recovered.attempt.status,
      };
    }
    case "PROJECTION_FIRST_APPLICATION": {
      const settled = advancePayment([
        "RECORD_AUTHORIZATION",
        "PERSIST_SUBMISSION_INTENT",
        "BEGIN_SUBMISSION",
        "OBSERVE_SETTLED",
      ]);
      const composed = applySettledPayment(
        settled.journal,
        settled.attempt.attempt_id,
        [],
        applicationTransaction(settled.attempt),
        accounts,
        units,
      );
      validatePaymentLedgerState(composed.attempt, [], accounts, units);
      return null;
    }
    case "APPLICATION_TRANSITION_TIME_MISMATCH": {
      const applied = appliedPayment();
      validatePaymentLedgerState(applied.attempt, [{
        ...applied.ledger[0]!,
        recorded_at: nextTime(6),
      }], accounts, units);
      return null;
    }
    case "LEDGER_FIRST_APPLICATION_TIME_REGRESSION": {
      const settled = advancePayment([
        "RECORD_AUTHORIZATION",
        "PERSIST_SUBMISSION_INTENT",
        "BEGIN_SUBMISSION",
        "OBSERVE_SETTLED",
      ]);
      const early = appendLedgerTransaction([], {
        ...applicationTransaction(settled.attempt),
        recorded_at: nextTime(3),
      }, accounts);
      validatePaymentLedgerState(settled.attempt, early.journal, accounts, units);
      return null;
    }
    case "APPLICATION_IDENTITY_CONFLICT": {
      const settled = advancePayment([
        "RECORD_AUTHORIZATION",
        "PERSIST_SUBMISSION_INTENT",
        "BEGIN_SUBMISSION",
        "OBSERVE_SETTLED",
      ]);
      const collisionField = stringField(input, "collision_field");
      if (collisionField !== "idempotency_key" && collisionField !== "request_fingerprint") {
        throw new Error("Unsupported application identity collision field.");
      }
      const base = applicationTransaction(settled.attempt);
      const collision = {
        ...base,
        transaction_id: `ledger:conformance-application-${collisionField}-conflict`,
        idempotency_key: collisionField === "idempotency_key"
          ? settled.attempt.application_idempotency_key
          : `ledger-key:conformance-application-${collisionField}-conflict`,
        request_fingerprint: collisionField === "request_fingerprint"
          ? settled.attempt.request_fingerprint
          : `request:conformance-application-${collisionField}-conflict`,
      };
      const collisionJournal = appendLedgerTransaction([], collision, accounts);
      planPaymentRecovery(settled.attempt as PaymentAttempt, collisionJournal.journal, accounts, units);
      return null;
    }
    case "COMPOSITE_PREFLIGHT_POISON": {
      const settled = advancePayment([
        "RECORD_AUTHORIZATION",
        "PERSIST_SUBMISSION_INTENT",
        "BEGIN_SUBMISSION",
        "OBSERVE_SETTLED",
      ]);
      const poisoned = appendLedgerTransaction([], unrelatedTransaction(nextTime(5), {
        transaction_id: settled.attempt.reversal_transaction_id,
      }), accounts);
      applySettledPayment(
        settled.journal,
        settled.attempt.attempt_id,
        poisoned.journal,
        { ...applicationTransaction(settled.attempt), recorded_at: nextTime(6) },
        accounts,
        units,
      );
      return null;
    }
    case "SAME_KEY_DIFFERENT_QUOTE": {
      const first = registerPaymentAttempt([], paymentSeed(), units);
      const largerQuote = quoteForInput("2000");
      registerPaymentAttempt(first.journal, paymentSeed({
        attempt_id: "payment:conformance-attempt-2",
        quote: largerQuote,
      }), units);
      return null;
    }
    case "REVERSAL_DESCENDANT": {
      const applied = appliedPayment();
      const reversed = reverseAppliedPayment(
        applied.journal,
        applied.attempt.attempt_id,
        applied.ledger,
        reversalTransaction(applied.attempt),
        accounts,
        units,
      );
      const reactivated = appendLedgerTransaction(
        reversed.ledger.journal,
        reversalOfReversalTransaction(applied.attempt),
        accounts,
      );
      validatePaymentLedgerState(reversed.attempt, reactivated.journal, accounts, units);
      return null;
    }
    case "LEDGER_FIRST_REVERSAL": {
      const applied = appliedPayment();
      const reversal = reversalTransaction(applied.attempt);
      const ledgerFirst = appendLedgerTransaction(applied.ledger, reversal, accounts);
      const withLaterEntry = appendLedgerTransaction(
        ledgerFirst.journal,
        unrelatedTransaction(nextTime(10)),
        accounts,
      );
      const recovered = reverseAppliedPayment(
        applied.journal,
        applied.attempt.attempt_id,
        withLaterEntry.journal,
        reversal,
        accounts,
        units,
      );
      return {
        ledger_disposition: recovered.ledger.disposition,
        ledger_entries: recovered.ledger.journal.length,
        payment_status: recovered.attempt.status,
      };
    }
    case "PROJECTION_FIRST_REVERSAL": {
      const applied = appliedPayment();
      const reversed = reverseAppliedPayment(
        applied.journal,
        applied.attempt.attempt_id,
        applied.ledger,
        reversalTransaction(applied.attempt),
        accounts,
        units,
      );
      validatePaymentLedgerState(reversed.attempt, applied.ledger, accounts, units);
      return null;
    }
    case "REVERSAL_TRANSITION_TIME_MISMATCH": {
      const applied = appliedPayment();
      const reversed = reverseAppliedPayment(
        applied.journal,
        applied.attempt.attempt_id,
        applied.ledger,
        reversalTransaction(applied.attempt),
        accounts,
        units,
      );
      validatePaymentLedgerState(reversed.attempt, [
        reversed.ledger.journal[0]!,
        { ...reversed.ledger.journal[1]!, recorded_at: nextTime(10) },
      ], accounts, units);
      return null;
    }
    case "ORPHANED_APPLICATION_COMPENSATION": {
      const settled = advancePayment([
        "RECORD_AUTHORIZATION",
        "PERSIST_SUBMISSION_INTENT",
        "BEGIN_SUBMISSION",
        "OBSERVE_SETTLED",
      ]);
      const externallyReversed = transitionPaymentAttempt(
        settled.journal,
        settled.attempt.attempt_id,
        paymentCommand("REVERSE", 6),
        units,
      );
      const application = appendLedgerTransaction([], {
        ...applicationTransaction(externallyReversed.attempt),
        recorded_at: nextTime(7),
      }, accounts);
      const initialAction = planPaymentRecovery(
        externallyReversed.attempt as PaymentAttempt,
        application.journal,
        accounts,
        units,
      ).action;
      const reversal = reversalTransaction(externallyReversed.attempt, { recorded_at: nextTime(8) });
      const compensated = compensateOrphanedApplication(
        externallyReversed.journal,
        externallyReversed.attempt.attempt_id,
        application.journal,
        reversal,
        accounts,
        units,
      );
      const later = appendLedgerTransaction(
        compensated.ledger.journal,
        unrelatedTransaction(nextTime(9)),
        accounts,
      );
      const replayed = compensateOrphanedApplication(
        compensated.payment_journal,
        compensated.attempt.attempt_id,
        later.journal,
        reversal,
        accounts,
        units,
      );
      const final = validatePaymentLedgerState(
        replayed.attempt,
        replayed.ledger.journal,
        accounts,
        units,
      );
      return {
        append_disposition: compensated.ledger.disposition,
        compensation_required: final.compensation_required,
        economically_applied: final.economically_applied,
        initial_action: initialAction,
        ledger_entries: replayed.ledger.journal.length,
        payment_status: replayed.attempt.status,
        replay_disposition: replayed.ledger.disposition,
      };
    }
    case "ORPHANED_APPLICATION_EARLY_COMPENSATION": {
      const settled = advancePayment([
        "RECORD_AUTHORIZATION",
        "PERSIST_SUBMISSION_INTENT",
        "BEGIN_SUBMISSION",
        "OBSERVE_SETTLED",
      ]);
      const application = appendLedgerTransaction([], applicationTransaction(settled.attempt), accounts);
      const externallyReversed = transitionPaymentAttempt(
        settled.journal,
        settled.attempt.attempt_id,
        paymentCommand("REVERSE", 6),
        units,
      );
      compensateOrphanedApplication(
        externallyReversed.journal,
        externallyReversed.attempt.attempt_id,
        application.journal,
        reversalTransaction(externallyReversed.attempt, { recorded_at: nextTime(5) }),
        accounts,
        units,
      );
      return null;
    }
    case "REGISTRY_DEFINITION_MISMATCH": {
      const alternateUnits = new UnitRegistry(units.list().map((unit) => (
        unit.unit_id === BASE_USDC ? { ...unit, decimals: unit.decimals + 1 } : unit
      )));
      const settled = advancePayment([
        "RECORD_AUTHORIZATION",
        "PERSIST_SUBMISSION_INTENT",
        "BEGIN_SUBMISSION",
        "OBSERVE_SETTLED",
      ]);
      applySettledPayment(
        settled.journal,
        settled.attempt.attempt_id,
        [],
        applicationTransaction(settled.attempt),
        makeAccounts(alternateUnits),
        units,
      );
      return null;
    }
    case "REVERSAL_WITHOUT_TRANSITIONS": {
      const settled = advancePayment([
        "RECORD_AUTHORIZATION",
        "PERSIST_SUBMISSION_INTENT",
        "BEGIN_SUBMISSION",
        "OBSERVE_SETTLED",
      ]);
      const application = appendLedgerTransaction([], applicationTransaction(settled.attempt), accounts);
      const reversal = appendLedgerTransaction(
        application.journal,
        reversalTransaction(settled.attempt),
        accounts,
      );
      validatePaymentLedgerState(settled.attempt, reversal.journal, accounts, units);
      return null;
    }
    case "BALANCED_UNDERPAYMENT": {
      const quotedAtomic = stringField(input, "quoted_atomic");
      const paidAtomic = stringField(input, "paid_atomic");
      const fixedQuote = quoteForInput(quotedAtomic);
      const settled = advancePayment([
        "RECORD_AUTHORIZATION",
        "PERSIST_SUBMISSION_INTENT",
        "BEGIN_SUBMISSION",
        "OBSERVE_SETTLED",
      ], fixedQuote);
      applySettledPayment(
        settled.journal,
        settled.attempt.attempt_id,
        [],
        applicationTransaction(settled.attempt, paidAtomic),
        accounts,
        units,
      );
      return null;
    }
    default:
      throw new Error("Unsupported payment conformance scenario.");
  }
}

function runEffectScenario(operation: string, input: JsonObject): JsonValue {
  const units = makeUnits();
  const accounts = makeAccounts(units);
  switch (operation) {
    case "EFFECT_WITHOUT_LEDGER": {
      const payment = appliedPayment();
      if (payment.attempt.status !== stringField(input, "payment_status")) {
        throw new Error("Effect vector payment status does not match the constructed kernel state.");
      }
      const ledgerEntries = integerField(input, "ledger_entries");
      if (ledgerEntries > payment.ledger.length) {
        throw new Error("Effect vector requests more ledger entries than the constructed kernel state contains.");
      }
      planPaidEffect(
        admission(),
        registeredEffect().attempt as EffectAttempt,
        payment.attempt as PaymentAttempt,
        payment.ledger.slice(0, ledgerEntries),
        accounts,
        units,
      );
      return null;
    }
    case "EFFECT_GATE_HEAD_MISMATCH": {
      const payment = appliedPayment();
      const effect = registeredEffect();
      const admissionRevision = stringField(input, "admission_revision");
      const authorization = admission({ gate_revision: admissionRevision });
      transitionEffectAttempt(
        effect.journal,
        effect.attempt.attempt_id,
        effectCommand("PERSIST_EXECUTION_INTENT", 6, authorization.input.gate_evidence_ref, admissionRevision),
        authorization,
        payment.attempt as PaymentAttempt,
        payment.ledger,
        accounts,
        stringField(input, "trusted_gate_head_revision"),
        units,
      );
      return null;
    }
    case "EFFECT_BEGIN_ONCE": {
      const gateRevision = stringField(input, "gate_revision");
      const persisted = persistedPaidEffect(gateRevision);
      const command = effectCommand(
        "BEGIN_EXECUTION",
        7,
        persisted.authorization.input.gate_evidence_ref,
        gateRevision,
      );
      const begun = transitionEffectAttempt(
        persisted.journal,
        persisted.attempt.attempt_id,
        command,
        persisted.authorization,
        persisted.payment.attempt as PaymentAttempt,
        persisted.payment.ledger,
        accounts,
        gateRevision,
        units,
      );
      const replay = transitionEffectAttempt(
        begun.journal,
        begun.attempt.attempt_id,
        command,
        null,
        null,
        [],
        accounts,
        null,
        units,
      );
      return {
        first_intent: begun.external_intent?.kind ?? null,
        idempotency_namespace: begun.external_intent?.idempotency_namespace ?? null,
        replay_intent: replay.external_intent,
        status: begun.attempt.status,
      };
    }
    case "EFFECT_RECONCILE_AFTER_REFUSAL": {
      const persisted = persistedPaidEffect();
      const begun = transitionEffectAttempt(
        persisted.journal,
        persisted.attempt.attempt_id,
        effectCommand("BEGIN_EXECUTION", 7),
        persisted.authorization,
        persisted.payment.attempt as PaymentAttempt,
        persisted.payment.ledger,
        accounts,
        "1",
        units,
      );
      const ambiguous = transitionEffectAttempt(
        begun.journal,
        begun.attempt.attempt_id,
        effectCommand("OBSERVE_AMBIGUOUS", 8, "evidence:conformance-effect-ambiguous"),
        null,
        null,
        [],
        accounts,
        null,
        units,
      );
      if (ambiguous.attempt.status !== stringField(input, "effect_status")) {
        throw new Error("Effect vector status does not match the constructed kernel state.");
      }
      const plan = planPaidEffect(
        admission({ participation: stringField(input, "participation") as AdmissionInput["participation"] }),
        ambiguous.attempt as EffectAttempt,
        null,
        [],
        accounts,
        units,
      );
      return {
        action: plan.action,
        automatic_retry: plan.automatic_retry,
        may_execute: plan.may_execute,
      };
    }
    default:
      throw new Error("Unsupported effect conformance operation.");
  }
}

function runSecurityScenario(input: JsonObject): JsonValue {
  switch (stringField(input, "scenario")) {
    case "ACCESSOR_ARRAY": {
      let getterRan = false;
      let rejected = false;
      const hostile = [makeUnits().list()[0]];
      Object.defineProperty(hostile, "0", {
        enumerable: true,
        configurable: true,
        get: () => {
          getterRan = true;
          return makeUnits().list()[0];
        },
      });
      try {
        new UnitRegistry(hostile);
      } catch (error) {
        if (!(error instanceof EconomicKernelError)) throw error;
        rejected = true;
      }
      return { getter_ran: getterRan, rejected };
    }
    case "OWN_PROTO_FIELD": {
      const hostile: Record<string, unknown> = {
        schema: SCHEMAS.amount,
        unit_id: GBP,
        amount_atomic: "1",
      };
      Object.defineProperty(hostile, "__proto__", {
        value: 7,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      validateAmount(hostile, makeUnits());
      return null;
    }
    default:
      throw new Error("Unsupported security conformance scenario.");
  }
}

function executeAdapterRequest(request: Readonly<AdapterRequest>): JsonValue {
  const input = inputObject(request.input);
  switch (request.operation) {
    case "ADMISSION_DECISION":
      return runAdmission(input);
    case "ADD_AMOUNTS":
      return runAddAmounts(input);
    case "VALIDATE_AMOUNT":
      return runValidateAmount(input);
    case "PRICE_SCENARIO":
      return runPriceScenario(input);
    case "QUOTE_SCENARIO":
      return runQuoteScenario(input);
    case "LEDGER_SCENARIO":
      return runLedgerScenario(input);
    case "PAYMENT_SCENARIO":
      return runPaymentScenario(input);
    case "EFFECT_WITHOUT_LEDGER":
    case "EFFECT_GATE_HEAD_MISMATCH":
    case "EFFECT_BEGIN_ONCE":
    case "EFFECT_RECONCILE_AFTER_REFUSAL":
      return runEffectScenario(request.operation, input);
    case "SECURITY_SCENARIO":
      return runSecurityScenario(input);
    default:
      throw new Error(`Unsupported conformance operation ${request.operation} for ${request.case_id}.`);
  }
}

function observe(request: Readonly<AdapterRequest>): ConformanceObservation {
  try {
    return { outcome: "VALUE", value: executeAdapterRequest(request) };
  } catch (error) {
    if (error instanceof EconomicKernelError) {
      return { outcome: "ERROR", error_code: error.code };
    }
    throw error;
  }
}

test("reference adapter passes every frozen economic-conformance v0.2 vector", () => {
  const vectorSource = readFileSync(
    new URL("../../economic-conformance/vectors/economic-kernel-v0.2.json", import.meta.url),
  );
  const manifestSource = readFileSync(
    new URL("../../economic-conformance/vectors/manifest.json", import.meta.url),
  );
  const suite = verifyOfficialVectorSources(vectorSource, manifestSource);
  const requests: readonly Readonly<AdapterRequest>[] = suite.cases.map((entry) => Object.freeze({
    case_id: entry.case_id,
    operation: entry.operation,
    input: entry.input,
  }));

  expect(suite.cases).toHaveLength(53);
  expect(requests).toHaveLength(53);
  expect(new Set(requests.map(({ case_id }) => case_id)).size).toBe(53);
  expect(requests.every((request) => (
    Object.keys(request).sort().join(",") === "case_id,input,operation"
  ))).toBe(true);

  const entries = requests.map((request) => ({
    case_id: request.case_id,
    observed: observe(request),
  }));
  const report = evaluateConformance(suite, {
    schema: "agenttool.economic-conformance-trace/1",
    suite_id: suite.suite_id,
    suite_revision: suite.suite_revision,
    producer_declared_ref: "adapter:economic-kernel-reference-test",
    entries,
  });

  expect(report.cases.filter(({ status }) => status !== "PASS").map(({ case_id }) => case_id)).toEqual([]);
  expect(report.status).toBe("PASS");
  expect(report.counts).toEqual({ total: 53, pass: 53, fail: 0, inconclusive: 0 });
  expect(report.cases).toHaveLength(53);
  expect(report.cases.every(({ status }) => status === "PASS")).toBe(true);
});
