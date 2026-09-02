import { describe, expect, test } from "bun:test";

import {
  EconomicKernelError,
  SCHEMAS,
  amount,
  appendLedgerTransaction,
  applySettledPayment,
  evaluateEconomicAdmission,
  planEffectRecovery,
  planPaidEffect,
  planPaymentRecovery,
  paymentReversalRequestFingerprint,
  registerEffectAttempt,
  registerPaymentAttempt,
  reverseAppliedPayment,
  transitionEffectAttempt,
  transitionPaymentAttempt,
  validateEconomicAdmission,
  validatePaymentAttempt,
  validatePaymentLedgerState,
  type EconomicAdmission,
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
  PROJECT_CREDIT,
  START,
  effectSeed,
  makeAccounts,
  makeUnits,
  nextTime,
  paymentSeed,
  quote,
} from "./fixtures.js";

interface PaymentState {
  journal: readonly Readonly<PaymentAttempt>[];
  attempt: Readonly<PaymentAttempt>;
}

interface EffectState {
  journal: readonly Readonly<EffectAttempt>[];
  attempt: Readonly<EffectAttempt>;
}

function paymentCommand(operation: PaymentOperation, index: number) {
  return {
    transition_id: `payment-transition:${String(index)}`,
    operation,
    evidence_ref: `evidence:payment-${String(index)}`,
    observed_at: nextTime(index),
  };
}

function effectCommand(
  operation: EffectOperation,
  index: number,
  evidenceRef = "gate:decision-1",
  gateRevision: string | null = operation === "PERSIST_EXECUTION_INTENT" || operation === "BEGIN_EXECUTION" ? "1" : null,
) {
  return {
    transition_id: `effect-transition:${String(index)}`,
    operation,
    evidence_ref: evidenceRef,
    observed_at: nextTime(index),
    gate_revision: gateRevision,
  };
}

function advancePayment(operations: readonly PaymentOperation[]): PaymentState {
  const units = makeUnits();
  const registered = registerPaymentAttempt([], paymentSeed(), units);
  let journal = registered.journal;
  let attempt = registered.attempt;
  for (const [offset, operation] of operations.entries()) {
    const result = transitionPaymentAttempt(journal, attempt.attempt_id, paymentCommand(operation, offset + 1), units);
    journal = result.journal;
    attempt = result.attempt;
  }
  return { journal, attempt };
}

function admission(overrides: Record<string, unknown> = {}): Readonly<EconomicAdmission> {
  return evaluateEconomicAdmission({
    action_digest: ACTION_DIGEST,
    gate_evidence_ref: "gate:decision-1",
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

function applicationTransaction(payment: Readonly<PaymentAttempt>, overrides: Partial<LedgerTransaction> = {}): LedgerTransaction {
  return {
    schema: SCHEMAS.ledgerTransaction,
    transaction_id: payment.application_transaction_id,
    idempotency_key: payment.application_idempotency_key,
    request_fingerprint: payment.request_fingerprint,
    causation_ref: payment.attempt_id,
    recorded_at: nextTime(5),
    postings: [
      posting("posting:payment-usdc-debit", "account:usdc-user", "ledger:base-usdc", BASE_USDC, "DEBIT", "1000"),
      posting("posting:payment-usdc-credit", "account:usdc-clearing", "ledger:base-usdc", BASE_USDC, "CREDIT", "1000"),
      posting("posting:payment-credit-debit", "account:project-issuer", "ledger:project-credit", PROJECT_CREDIT, "DEBIT", "1"),
      posting("posting:payment-credit-credit", "account:project-user", "ledger:project-credit", PROJECT_CREDIT, "CREDIT", "1"),
    ],
    evidence_refs: ["evidence:provider-settlement-1"],
    conversion_refs: [payment.quote.quote_id],
    price_revision_id: payment.quote.price_revision.price_revision_id,
    reverses_transaction_id: null,
    ...overrides,
  };
}

function reversalTransaction(payment: Readonly<PaymentAttempt>): LedgerTransaction {
  const units = makeUnits();
  return {
    schema: SCHEMAS.ledgerTransaction,
    transaction_id: payment.reversal_transaction_id,
    idempotency_key: payment.reversal_idempotency_key,
    request_fingerprint: paymentReversalRequestFingerprint(payment as PaymentAttempt, units),
    causation_ref: payment.attempt_id,
    recorded_at: nextTime(9),
    postings: [
      posting("posting:reverse-usdc-credit", "account:usdc-user", "ledger:base-usdc", BASE_USDC, "CREDIT", "1000"),
      posting("posting:reverse-usdc-debit", "account:usdc-clearing", "ledger:base-usdc", BASE_USDC, "DEBIT", "1000"),
      posting("posting:reverse-credit-credit", "account:project-issuer", "ledger:project-credit", PROJECT_CREDIT, "CREDIT", "1"),
      posting("posting:reverse-credit-debit", "account:project-user", "ledger:project-credit", PROJECT_CREDIT, "DEBIT", "1"),
    ],
    evidence_refs: ["evidence:provider-reversal-1"],
    conversion_refs: [payment.quote.quote_id],
    price_revision_id: payment.quote.price_revision.price_revision_id,
    reverses_transaction_id: payment.application_transaction_id,
  };
}

function appliedPayment(): PaymentState & { ledger: readonly Readonly<LedgerTransaction>[] } {
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
  return { journal: applied.payment_journal, attempt: applied.attempt, ledger: applied.ledger.journal };
}

function registeredEffect(seed = effectSeed()): EffectState {
  const registered = registerEffectAttempt([], seed);
  return { journal: registered.journal, attempt: registered.attempt };
}

function advancePaidEffect(operations: readonly EffectOperation[]): EffectState {
  const units = makeUnits();
  const accounts = makeAccounts(units);
  const payment = appliedPayment();
  let state = registeredEffect();
  for (const [offset, operation] of operations.entries()) {
    const forward = operation === "PERSIST_EXECUTION_INTENT" || operation === "BEGIN_EXECUTION";
    const result = transitionEffectAttempt(
      state.journal,
      state.attempt.attempt_id,
      effectCommand(operation, offset + 6, forward ? "gate:decision-1" : `evidence:effect-${String(offset + 6)}`),
      forward ? admission() : null,
      forward ? payment.attempt as PaymentAttempt : null,
      payment.ledger,
      accounts,
      forward ? "1" : null,
      units,
    );
    state = { journal: result.journal, attempt: result.attempt };
  }
  return state;
}

describe("payment attempt journal and crash recovery", () => {
  test("emits one namespaced payment intent only after a newly applied begin", () => {
    const units = makeUnits();
    let state = advancePayment(["RECORD_AUTHORIZATION", "PERSIST_SUBMISSION_INTENT"]);
    expect(planPaymentRecovery(state.attempt as PaymentAttempt, [], makeAccounts(units), units)).toEqual({
      action: "BEGIN_SUBMISSION",
      automatic_retry: false,
      first_attempt_permitted: true,
    });
    const command = paymentCommand("BEGIN_SUBMISSION", 3);
    const begun = transitionPaymentAttempt(state.journal, state.attempt.attempt_id, command, units);
    expect(begun.external_intent).toMatchObject({
      kind: "SUBMIT_PAYMENT",
      idempotency_namespace: "PAYMENT",
      idempotency_key: "payment-key:order-1",
      attempt_id: "payment:attempt-1",
      authorization_ref: "evidence:payment-1",
    });
    state = { journal: begun.journal, attempt: begun.attempt };
    const replay = transitionPaymentAttempt(state.journal, state.attempt.attempt_id, {
      observed_at: command.observed_at,
      evidence_ref: command.evidence_ref,
      operation: command.operation,
      transition_id: command.transition_id,
    }, units);
    expect(replay.disposition).toBe("REPLAYED");
    expect(replay.external_intent).toBeNull();
    expect(planPaymentRecovery(state.attempt as PaymentAttempt, [], makeAccounts(units), units).action).toBe("RECONCILE_EXTERNAL");
  });

  test("makes ambiguous submission sticky and never an automatic retry", () => {
    const units = makeUnits();
    const state = advancePayment([
      "RECORD_AUTHORIZATION",
      "PERSIST_SUBMISSION_INTENT",
      "BEGIN_SUBMISSION",
      "OBSERVE_AMBIGUOUS",
    ]);
    expect(planPaymentRecovery(state.attempt as PaymentAttempt, [], makeAccounts(units), units)).toEqual({
      action: "RECONCILE_EXTERNAL",
      automatic_retry: false,
      first_attempt_permitted: false,
    });
    expect(() => transitionPaymentAttempt(
      state.journal,
      state.attempt.attempt_id,
      paymentCommand("BEGIN_SUBMISSION", 5),
      units,
    )).toThrow();
  });

  test("enforces idempotency over content-derived quote semantics", () => {
    const units = makeUnits();
    const first = registerPaymentAttempt([], paymentSeed(), units);
    expect(registerPaymentAttempt(first.journal, paymentSeed({ attempt_id: "payment:attempt-retry" }), units).disposition).toBe("REPLAYED");
    const largerQuote = quote({
      input: amount(BASE_USDC, "2000", units),
      output: amount(PROJECT_CREDIT, "2", units),
    });
    expect(() => registerPaymentAttempt(first.journal, paymentSeed({
      attempt_id: "payment:attempt-2",
      quote: largerQuote,
    }), units)).toThrow(EconomicKernelError);
    expect(() => registerPaymentAttempt(first.journal, paymentSeed({
      attempt_id: "payment:attempt-2",
      payment_idempotency_key: "payment-key:different",
    }), units)).toThrow(EconomicKernelError);
  });

  test("pins projection to replayed history and rejects direct ledger application", () => {
    const units = makeUnits();
    const state = advancePayment(["RECORD_AUTHORIZATION"]);
    expect(() => validatePaymentAttempt({ ...state.attempt, status: "APPLIED" }, units)).toThrow();
    expect(() => transitionPaymentAttempt(
      state.journal,
      state.attempt.attempt_id,
      paymentCommand("APPLY_INTERNAL", 2),
      units,
    )).toThrow();
  });

  test("replays a fixed ledger application after either crash boundary without double credit", () => {
    const units = makeUnits();
    const accounts = makeAccounts(units);
    const settled = advancePayment([
      "RECORD_AUTHORIZATION",
      "PERSIST_SUBMISSION_INTENT",
      "BEGIN_SUBMISSION",
      "OBSERVE_SETTLED",
    ]);
    const transaction = applicationTransaction(settled.attempt);
    const ledgerOnly = appendLedgerTransaction([], transaction, accounts);
    const recovered = applySettledPayment(
      settled.journal,
      settled.attempt.attempt_id,
      ledgerOnly.journal,
      transaction,
      accounts,
      units,
    );
    expect(recovered.ledger.disposition).toBe("REPLAYED");
    expect(recovered.attempt.status).toBe("APPLIED");
    const replay = applySettledPayment(
      recovered.payment_journal,
      recovered.attempt.attempt_id,
      recovered.ledger.journal,
      transaction,
      accounts,
      units,
    );
    expect(replay.disposition).toBe("REPLAYED");
    expect(replay.ledger.journal).toHaveLength(1);
  });

  test("rejects underpayment even when its supplied ledger balances", () => {
    const units = makeUnits();
    const accounts = makeAccounts(units);
    const settled = advancePayment([
      "RECORD_AUTHORIZATION",
      "PERSIST_SUBMISSION_INTENT",
      "BEGIN_SUBMISSION",
      "OBSERVE_SETTLED",
    ]);
    const underpaid = applicationTransaction(settled.attempt, { postings: [
      posting("posting:under-usdc-debit", "account:usdc-user", "ledger:base-usdc", BASE_USDC, "DEBIT", "1"),
      posting("posting:under-usdc-credit", "account:usdc-clearing", "ledger:base-usdc", BASE_USDC, "CREDIT", "1"),
      posting("posting:under-credit-debit", "account:project-issuer", "ledger:project-credit", PROJECT_CREDIT, "DEBIT", "1"),
      posting("posting:under-credit-credit", "account:project-user", "ledger:project-credit", PROJECT_CREDIT, "CREDIT", "1"),
    ] });
    expect(() => applySettledPayment(settled.journal, settled.attempt.attempt_id, [], underpaid, accounts, units)).toThrow();
  });

  test("finishes a ledger-first reversal and rejects an uncompensated reversed projection", () => {
    const units = makeUnits();
    const accounts = makeAccounts(units);
    const applied = appliedPayment();
    const reversal = reversalTransaction(applied.attempt);
    const ledgerFirst = appendLedgerTransaction(applied.ledger, reversal, accounts);
    expect(planPaymentRecovery(applied.attempt as PaymentAttempt, ledgerFirst.journal, accounts, units).action)
      .toBe("FINALIZE_REVERSAL");
    const finalized = reverseAppliedPayment(
      applied.journal,
      applied.attempt.attempt_id,
      ledgerFirst.journal,
      reversal,
      accounts,
      units,
    );
    expect(finalized.ledger.disposition).toBe("REPLAYED");
    expect(finalized.attempt.status).toBe("REVERSED");
    expect(planPaymentRecovery(finalized.attempt as PaymentAttempt, finalized.ledger.journal, accounts, units).action)
      .toBe("COMPLETE");

    const settled = advancePayment([
      "RECORD_AUTHORIZATION",
      "PERSIST_SUBMISSION_INTENT",
      "BEGIN_SUBMISSION",
      "OBSERVE_SETTLED",
    ]);
    const application = applicationTransaction(settled.attempt);
    const ledgerOnly = appendLedgerTransaction([], application, accounts);
    const reversedWithoutRepair = transitionPaymentAttempt(
      settled.journal,
      settled.attempt.attempt_id,
      paymentCommand("REVERSE", 6),
      units,
    );
    expect(() => validatePaymentLedgerState(reversedWithoutRepair.attempt, ledgerOnly.journal, accounts, units)).toThrow();
  });

  test("rejects an exact generic reversal that bypasses the payment-derived identity", () => {
    const units = makeUnits();
    const accounts = makeAccounts(units);
    const applied = appliedPayment();
    const alternateReversal = {
      ...reversalTransaction(applied.attempt),
      transaction_id: "ledger:alternate-payment-reversal",
      idempotency_key: "ledger-key:alternate-payment-reversal",
      request_fingerprint: "request:alternate-payment-reversal",
    } satisfies LedgerTransaction;
    const compensated = appendLedgerTransaction(applied.ledger, alternateReversal, accounts).journal;

    expect(compensated).toHaveLength(2);
    expect(() => validatePaymentLedgerState(applied.attempt, compensated, accounts, units))
      .toThrow(EconomicKernelError);
    expect(() => planPaidEffect(
      admission(),
      registeredEffect().attempt as EffectAttempt,
      applied.attempt as PaymentAttempt,
      compensated,
      accounts,
      units,
    )).toThrow(EconomicKernelError);
  });
});

describe("gate-bound effect attempt journal", () => {
  test("cannot prepare or begin effect execution without fresh admission and applied payment", () => {
    const units = makeUnits();
    const state = registeredEffect();
    expect(() => transitionEffectAttempt(
      state.journal,
      state.attempt.attempt_id,
      effectCommand("PERSIST_EXECUTION_INTENT", 6),
      null,
      null,
      [],
      makeAccounts(units),
      "1",
      units,
    )).toThrow();
    expect(() => transitionEffectAttempt(
      state.journal,
      state.attempt.attempt_id,
      effectCommand("PERSIST_EXECUTION_INTENT", 6),
      admission(),
      advancePayment(["RECORD_AUTHORIZATION"]).attempt as PaymentAttempt,
      [],
      makeAccounts(units),
      "1",
      units,
    )).toThrow();
  });

  test("emits one effect intent with separate idempotency identity", () => {
    const units = makeUnits();
    const payment = appliedPayment();
    let state = advancePaidEffect(["PERSIST_EXECUTION_INTENT"]);
    expect(planEffectRecovery(state.attempt as EffectAttempt).first_attempt_permitted).toBe(true);
    const command = effectCommand("BEGIN_EXECUTION", 7);
    const begun = transitionEffectAttempt(
      state.journal,
      state.attempt.attempt_id,
      command,
      admission(),
      payment.attempt as PaymentAttempt,
      payment.ledger,
      makeAccounts(units),
      "1",
      units,
    );
    expect(begun.external_intent).toMatchObject({
      kind: "EXECUTE_EFFECT",
      idempotency_namespace: "EFFECT",
      idempotency_key: "effect-key:order-1",
      authorization_ref: "gate:decision-1",
      gate_revision: "1",
    });
    state = { journal: begun.journal, attempt: begun.attempt };
    expect(transitionEffectAttempt(
      state.journal,
      state.attempt.attempt_id,
      command,
      null,
      null,
      [],
      makeAccounts(units),
      null,
      units,
    ).external_intent).toBeNull();
    expect(planEffectRecovery(state.attempt as EffectAttempt).action).toBe("RECONCILE_EFFECT");
  });

  test("requires a fresh gate revision at BEGIN_EXECUTION", () => {
    const units = makeUnits();
    const payment = appliedPayment();
    const state = advancePaidEffect(["PERSIST_EXECUTION_INTENT"]);
    expect(() => transitionEffectAttempt(
      state.journal,
      state.attempt.attempt_id,
      { ...effectCommand("BEGIN_EXECUTION", 31), observed_at: nextTime(31) },
      admission(),
      payment.attempt as PaymentAttempt,
      payment.ledger,
      makeAccounts(units),
      "1",
      units,
    )).toThrow();
    const refreshed = admission({
      gate_evidence_ref: "gate:decision-2",
      gate_revision: "2",
      evaluated_at: nextTime(30),
      valid_until: nextTime(60),
    });
    const begun = transitionEffectAttempt(
      state.journal,
      state.attempt.attempt_id,
      effectCommand("BEGIN_EXECUTION", 31, "gate:decision-2", "2"),
      refreshed,
      payment.attempt as PaymentAttempt,
      payment.ledger,
      makeAccounts(units),
      "2",
      units,
    );
    expect(begun.attempt.status).toBe("EXECUTING");
  });

  test("rejects an admission that is not the trusted gate head even inside its TTL", () => {
    const units = makeUnits();
    const accounts = makeAccounts(units);
    const payment = appliedPayment();
    const state = registeredEffect();
    expect(() => transitionEffectAttempt(
      state.journal,
      state.attempt.attempt_id,
      effectCommand("PERSIST_EXECUTION_INTENT", 6),
      admission(),
      payment.attempt as PaymentAttempt,
      payment.ledger,
      accounts,
      "2",
      units,
    )).toThrow();
  });

  test("reconciles an in-flight effect despite later refusal", () => {
    const units = makeUnits();
    let state = advancePaidEffect(["PERSIST_EXECUTION_INTENT", "BEGIN_EXECUTION"]);
    const ambiguous = transitionEffectAttempt(
      state.journal,
      state.attempt.attempt_id,
      effectCommand("OBSERVE_AMBIGUOUS", 8, "evidence:effect-ambiguous"),
      null,
      null,
      [],
      makeAccounts(units),
      null,
      units,
    );
    state = { journal: ambiguous.journal, attempt: ambiguous.attempt };
    expect(planPaidEffect(
      admission({ participation: "REFUSED" }),
      state.attempt as EffectAttempt,
      null,
      [],
      makeAccounts(units),
      units,
    ).action).toBe("RECONCILE_EFFECT");
  });

  test("keeps payment application separate from effect success", () => {
    expect(appliedPayment().attempt.status).toBe("APPLIED");
    expect(registeredEffect().attempt.status).toBe("CREATED");
  });
});

describe("XENIA hard-gate admission", () => {
  test("payment cannot buy through refusal, authority denial, or safety denial", () => {
    expect(admission({ participation: "REFUSED" }).outcome).toBe("REFUSED");
    expect(admission({ participation: "REFUSED", payment: "UNSATISFIED" }).outcome).toBe("REFUSED");
    expect(admission({ authority: "DENY" }).outcome).toBe("HARD_DENY");
    expect(admission({ safety: "DENY" }).outcome).toBe("HARD_DENY");
    expect(admission({ participation: "REFUSED" }).rights_conditional_on_payment).toBe(false);
  });

  test("does not infer participation from silence or unresolved evidence", () => {
    for (const participation of ["DEFERRED", "WITHHELD", "UNKNOWN"] as const) {
      expect(admission({ participation }).outcome).toBe("HOLD");
    }
    expect(admission({ authority: "UNKNOWN" }).outcome).toBe("HOLD");
  });

  test("asks for payment only after protected gates pass", () => {
    expect(admission({ payment: "UNSATISFIED" }).outcome).toBe("PAYMENT_REQUIRED");
    expect(admission({ payment: "AMBIGUOUS" }).outcome).toBe("HOLD");
    expect(admission({ payment: "NOT_REQUIRED" }).outcome).toBe("ADMIT");
  });

  test("rejects forged projections and invalid validity windows", () => {
    const denied = admission({ safety: "DENY" });
    expect(() => validateEconomicAdmission({ ...denied, outcome: "ADMIT" })).toThrow();
    expect(() => admission({ valid_until: START })).toThrow();
  });

  test("binds paid effects to the exact immutable quote", () => {
    const units = makeUnits();
    const paid = appliedPayment();
    const effect = registeredEffect().attempt;
    expect(planPaidEffect(
      admission(),
      effect as EffectAttempt,
      paid.attempt as PaymentAttempt,
      paid.ledger,
      makeAccounts(units),
      units,
    ).action).toBe("PERSIST_EFFECT_INTENT");
    const different = registerEffectAttempt([], effectSeed({ quote_id: quote({
      input: amount(BASE_USDC, "2000", units),
      output: amount(PROJECT_CREDIT, "2", units),
    }).quote_id })).attempt;
    expect(() => planPaidEffect(
      admission(),
      different as EffectAttempt,
      paid.attempt as PaymentAttempt,
      paid.ledger,
      makeAccounts(units),
      units,
    )).toThrow();
    expect(() => planPaidEffect(
      admission(),
      effect as EffectAttempt,
      paid.attempt as PaymentAttempt,
      [],
      makeAccounts(units),
      units,
    )).toThrow();
  });

  test("blocks forward movement after fresh refusal despite applied payment", () => {
    const units = makeUnits();
    const paid = appliedPayment();
    expect(planPaidEffect(
      admission({ participation: "REFUSED" }),
      registeredEffect().attempt as EffectAttempt,
      paid.attempt as PaymentAttempt,
      paid.ledger,
      makeAccounts(units),
      units,
    )).toMatchObject({ action: "BLOCK_HARD_GATE", may_execute: false });
  });

  test("supports explicitly payment-free effects without quote smuggling", () => {
    const units = makeUnits();
    const freeAdmission = admission({ payment: "NOT_REQUIRED" });
    const free = registerEffectAttempt([], effectSeed({ quote_id: null, payment_attempt_id: null })).attempt;
    expect(planPaidEffect(
      freeAdmission,
      free as EffectAttempt,
      null,
      [],
      makeAccounts(units),
      units,
    ).action).toBe("PERSIST_EFFECT_INTENT");
    const paid = appliedPayment();
    expect(() => planPaidEffect(
      freeAdmission,
      free as EffectAttempt,
      paid.attempt as PaymentAttempt,
      paid.ledger,
      makeAccounts(units),
      units,
    )).toThrow();
  });
});
