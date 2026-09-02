import type { SCHEMAS } from "./constants.js";

export type UnitDimension = "FIAT" | "TOKEN" | "ENTITLEMENT";
export type Transferability = "TRANSFERABLE" | "NONTRANSFERABLE";

export interface UnitDefinition {
  schema: typeof SCHEMAS.unit;
  unit_id: string;
  dimension: UnitDimension;
  decimals: number;
  ledger_domain: string;
  transferability: Transferability;
}

export interface EconomicAmount {
  schema: typeof SCHEMAS.amount;
  unit_id: string;
  amount_atomic: string;
}

export type PriceRounding = "EXACT_ONLY" | "RETURN_REMAINDER";

export interface PriceRevision {
  schema: typeof SCHEMAS.priceRevision;
  price_revision_id: string;
  price_book_id: string;
  revision: string;
  input_unit_id: string;
  output_unit_id: string;
  input_atomic_per_lot: string;
  output_atomic_per_lot: string;
  effective_from: string;
  effective_until: string | null;
  supersedes_price_revision_id: string | null;
  rounding: PriceRounding;
}

export type PriceRevisionSeed = Omit<PriceRevision, "price_revision_id">;

export interface EconomicQuote {
  schema: typeof SCHEMAS.quote;
  quote_id: string;
  action_digest: string;
  payer_ref: string;
  payee_ref: string;
  input: EconomicAmount;
  output: EconomicAmount;
  price_revision: PriceRevision;
  issued_at: string;
  expires_at: string;
}

export type EconomicQuoteSeed = Omit<EconomicQuote, "quote_id">;

export interface ExactConversionResult {
  schema: typeof SCHEMAS.conversionResult;
  price_revision_id: string;
  input: EconomicAmount;
  exact: true;
  output: EconomicAmount;
}

export interface InexactConversionResult {
  schema: typeof SCHEMAS.conversionResult;
  price_revision_id: string;
  input: EconomicAmount;
  exact: false;
  output_unit_id: string;
  dividend: string;
  divisor: string;
  remainder: string;
}

export type ConversionResult = ExactConversionResult | InexactConversionResult;

export type LedgerAccountKind = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export interface LedgerAccount {
  schema: typeof SCHEMAS.ledgerAccount;
  account_id: string;
  ledger_domain: string;
  unit_id: string;
  account_kind: LedgerAccountKind;
}

export interface LedgerPosting {
  posting_id: string;
  account_id: string;
  ledger_domain: string;
  unit_id: string;
  side: "DEBIT" | "CREDIT";
  amount_atomic: string;
}

export interface LedgerTransaction {
  schema: typeof SCHEMAS.ledgerTransaction;
  transaction_id: string;
  idempotency_key: string;
  request_fingerprint: string;
  causation_ref: string;
  recorded_at: string;
  postings: readonly LedgerPosting[];
  evidence_refs: readonly string[];
  conversion_refs: readonly string[];
  price_revision_id: string | null;
  reverses_transaction_id: string | null;
}

export interface LedgerBalance {
  ledger_domain: string;
  unit_id: string;
  debit_atomic: string;
  credit_atomic: string;
  posting_count: number;
}

export type PaymentStatus =
  | "CREATED"
  | "AUTHORIZATION_RECORDED"
  | "SUBMISSION_INTENT_PERSISTED"
  | "SUBMITTING"
  | "AMBIGUOUS"
  | "EXTERNALLY_SETTLED"
  | "APPLIED"
  | "DEFINITIVELY_FAILED"
  | "CANCELLED"
  | "EXPIRED"
  | "REVERSED";

export type PaymentOperation =
  | "RECORD_AUTHORIZATION"
  | "PERSIST_SUBMISSION_INTENT"
  | "BEGIN_SUBMISSION"
  | "OBSERVE_AMBIGUOUS"
  | "OBSERVE_SETTLED"
  | "OBSERVE_DEFINITIVE_FAILURE"
  | "RECONCILE_SETTLED"
  | "RECONCILE_DEFINITIVE_FAILURE"
  | "APPLY_INTERNAL"
  | "REVERSE"
  | "CANCEL"
  | "EXPIRE";

export type EffectStatus =
  | "CREATED"
  | "EXECUTION_INTENT_PERSISTED"
  | "EXECUTING"
  | "AMBIGUOUS"
  | "SUCCEEDED"
  | "DEFINITIVELY_FAILED"
  | "CANCELLED";

export type EffectOperation =
  | "PERSIST_EXECUTION_INTENT"
  | "BEGIN_EXECUTION"
  | "OBSERVE_AMBIGUOUS"
  | "OBSERVE_SUCCESS"
  | "OBSERVE_DEFINITIVE_FAILURE"
  | "RECONCILE_SUCCESS"
  | "RECONCILE_DEFINITIVE_FAILURE"
  | "CANCEL";

export interface AttemptTransition<Status extends string, Operation extends string> {
  transition_id: string;
  operation: Operation;
  from: Status;
  to: Status;
  evidence_ref: string;
  observed_at: string;
}

export interface PaymentAttempt {
  schema: typeof SCHEMAS.paymentAttempt;
  attempt_id: string;
  payment_idempotency_key: string;
  quote: EconomicQuote;
  request_fingerprint: string;
  application_transaction_id: string;
  application_idempotency_key: string;
  application_transition_id: string;
  reversal_transaction_id: string;
  reversal_idempotency_key: string;
  reversal_transition_id: string;
  status: PaymentStatus;
  created_at: string;
  updated_at: string;
  transitions: readonly AttemptTransition<PaymentStatus, PaymentOperation>[];
}

export interface PaymentAttemptSeed {
  attempt_id: string;
  payment_idempotency_key: string;
  quote: EconomicQuote;
  created_at: string;
}

export interface EffectAttempt {
  schema: typeof SCHEMAS.effectAttempt;
  attempt_id: string;
  effect_idempotency_key: string;
  action_digest: string;
  quote_id: string | null;
  payment_attempt_id: string | null;
  request_fingerprint: string;
  status: EffectStatus;
  created_at: string;
  updated_at: string;
  transitions: readonly EffectAttemptTransition[];
}

export interface EffectAttemptTransition extends AttemptTransition<EffectStatus, EffectOperation> {
  gate_revision: string | null;
}

export interface EffectAttemptSeed {
  attempt_id: string;
  effect_idempotency_key: string;
  action_digest: string;
  quote_id: string | null;
  payment_attempt_id: string | null;
  created_at: string;
}

export interface PaymentTransitionCommand {
  transition_id: string;
  operation: PaymentOperation;
  evidence_ref: string;
  observed_at: string;
}

export interface EffectTransitionCommand {
  transition_id: string;
  operation: EffectOperation;
  evidence_ref: string;
  observed_at: string;
  gate_revision: string | null;
}

export type TransitionDisposition = "APPLIED" | "REPLAYED";

export interface PaymentExternalIntent {
  kind: "SUBMIT_PAYMENT";
  idempotency_namespace: "PAYMENT";
  idempotency_key: string;
  attempt_id: string;
  request_fingerprint: string;
  authorization_ref: string;
}

export interface EffectExternalIntent {
  kind: "EXECUTE_EFFECT";
  idempotency_namespace: "EFFECT";
  idempotency_key: string;
  attempt_id: string;
  request_fingerprint: string;
  authorization_ref: string;
  gate_revision: string;
}

export type ExternalIntent = PaymentExternalIntent | EffectExternalIntent;

export interface AttemptRegistrationResult<Attempt> {
  attempt: Readonly<Attempt>;
  disposition: "REGISTERED" | "REPLAYED";
  journal: readonly Readonly<Attempt>[];
}

export interface AttemptTransitionResult<Attempt> {
  attempt: Readonly<Attempt>;
  disposition: TransitionDisposition;
  journal: readonly Readonly<Attempt>[];
  external_intent: Readonly<ExternalIntent> | null;
}

export interface PaymentLedgerTransitionResult {
  attempt: Readonly<PaymentAttempt>;
  disposition: TransitionDisposition;
  payment_journal: readonly Readonly<PaymentAttempt>[];
  ledger: Readonly<LedgerAppendResult>;
}

export interface PaymentLedgerState {
  payment: Readonly<PaymentAttempt>;
  ledger_journal: readonly Readonly<LedgerTransaction>[];
  application_transaction: Readonly<LedgerTransaction> | null;
  reversal_transaction: Readonly<LedgerTransaction> | null;
  economically_applied: boolean;
}

export type PaymentRecoveryAction =
  | "RECORD_AUTHORIZATION"
  | "PERSIST_SUBMISSION_INTENT"
  | "BEGIN_SUBMISSION"
  | "RECONCILE_EXTERNAL"
  | "APPLY_INTERNAL"
  | "FINALIZE_REVERSAL"
  | "COMPLETE"
  | "STOP";

export type EffectRecoveryAction =
  | "PERSIST_EXECUTION_INTENT"
  | "BEGIN_EXECUTION"
  | "RECONCILE_EFFECT"
  | "RETURN_RECORDED_RESULT"
  | "STOP";

export interface RecoveryPlan<Action extends string> {
  action: Action;
  automatic_retry: false;
  first_attempt_permitted: boolean;
}

export type BinaryGate = "ALLOW" | "DENY" | "UNKNOWN";
export type ParticipationGate = "ACCEPTED" | "NOT_REQUIRED" | "REFUSED" | "DEFERRED" | "WITHHELD" | "UNKNOWN";
export type PaymentGate = "NOT_REQUIRED" | "SATISFIED" | "UNSATISFIED" | "AMBIGUOUS";
export type AdmissionOutcome = "REFUSED" | "HARD_DENY" | "HOLD" | "PAYMENT_REQUIRED" | "ADMIT";

export interface AdmissionInput {
  action_digest: string;
  gate_evidence_ref: string;
  gate_revision: string;
  evaluated_at: string;
  valid_until: string;
  authority: BinaryGate;
  safety: BinaryGate;
  participation: ParticipationGate;
  payment: PaymentGate;
}

export type ProtectedGateInput = Omit<AdmissionInput, "payment">;

export interface EconomicAdmission {
  schema: typeof SCHEMAS.admission;
  input: AdmissionInput;
  rights_baseline: "xenia.rights/0.1";
  rights_conditional_on_payment: false;
  outcome: AdmissionOutcome;
  hard_gate_status: "PASS" | "BLOCK" | "HOLD";
  economically_ready: boolean;
  reason: string;
}

export type ProtectedGateOutcome = "PASS" | "REFUSED" | "HARD_DENY" | "HOLD";

export interface ProtectedGateDecision {
  action_digest: string;
  gate_evidence_ref: string;
  gate_revision: string;
  evaluated_at: string;
  valid_until: string;
  outcome: ProtectedGateOutcome;
  reason: string;
}

export type PaidEffectAction =
  | "BLOCK_HARD_GATE"
  | "WAIT_FOR_HARD_GATE"
  | "WAIT_FOR_PAYMENT"
  | "PERSIST_EFFECT_INTENT"
  | "BEGIN_EFFECT_EXECUTION"
  | "RECONCILE_EFFECT"
  | "RETURN_RECORDED_RESULT"
  | "STOP";

export interface PaidEffectPlan {
  action: PaidEffectAction;
  may_execute: boolean;
  automatic_retry: false;
  reason: string;
}

export interface LedgerAppendResult {
  disposition: "APPENDED" | "REPLAYED";
  journal: readonly LedgerTransaction[];
  transaction: LedgerTransaction;
}
