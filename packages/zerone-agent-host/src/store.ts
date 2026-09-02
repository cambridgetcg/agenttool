import { Database } from "bun:sqlite";
import {
  assertIntentWithinCapabilityStatic,
  assertUuid,
  assertVerifiedRecord,
  base64UrlDecode,
  base64UrlEncode,
  canonicalJson,
  sha256Id,
  sha256BytesId,
} from "@agenttool/wallet";
import {
  assertSecp256k1PublicKey,
  COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL,
  getZeroneProfile,
} from "@agenttool/wallet-zerone";
import {
  assertZeroneEconomyDirectSignPlan,
  createZeroneEconomySigningRequest,
  createZeroneEconomySimulationBinding,
  getZeroneEconomyModuleAccounts,
  verifyZeroneEconomySignedTransactionRecord,
  verifyZeroneEconomySimulationEvidence,
  type ZeroneEconomySignedTransactionRecord,
  zeroneEconomyDirectSignPlanContentId,
} from "@agenttool/wallet-zerone-economy";
import {
  assertWalletIdentityBindingSuccessor,
  validateTreasuryPolicy,
  verifyWalletIdentityBindingProofEnvelope,
  type TreasuryPolicy,
  type TreasuryPurpose,
  type WalletIdentityBinding,
  type WalletIdentityBindingProofEnvelope,
  type VerifiedWalletIdentityBindingProof,
} from "@agenttool/zerone-agent-economy";

import {
  AUTHORIZATION_PROJECTION_BOUNDARY,
  ECONOMY_AUTHORIZATION_BOUNDARY,
  ECONOMY_COMMITMENT_HASH_DOMAIN,
  ECONOMY_SEQUENCE_ADVANCE_EVIDENCE_HASH_DOMAIN,
  ECONOMY_SEQUENCE_ADVANCE_EVIDENCE_BOUNDARY,
  EXECUTION_SUPPORT,
  GENESIS_EVENT_HASH,
  OPERATION_STATUSES,
  SQLITE_SCHEMA_VERSION,
} from "./constants.js";
import { ZeroneAgentHostError, fail } from "./errors.js";
import { eventHash } from "./events.js";
import { SecureSqliteFiles } from "./filesystem.js";
import type {
  BindingHead,
  BindingHeadExpectation,
  BindingCurrentnessAssertion,
  BindingCurrentnessResolver,
  BroadcastEvidence,
  BroadcastInvocationBoundary,
  CanonicalReorgEvidence,
  CapabilityBudget,
  CapabilityUsageSnapshot,
  HostVerificationReport,
  OperationEvent,
  OperationKind,
  OperationSnapshot,
  OperationStatus,
  PurposeReservation,
  RecordVerifiedZeroneEconomySignedTransactionInput,
  ReservationState,
  ReserveOperationInput,
  ReserveAndEnterZeroneEconomySigningBoundaryInput,
  ObserveAndApplyZeroneEconomySequenceAdvanceInput,
  SequenceAdvanceEvidence,
  Sha256Id,
  SignerInvocationBoundary,
  TransactionEvidence,
  TrustedSimulationAdapterAssertion,
  TrustedBindingCurrentnessVerifierAssertion,
  VerifiedSignedEvidence,
  ZeroneAccountSnapshot,
  ZeroneStateObserver,
  ZeroneAccountId,
  ZeroneCaip2,
  ZeroneEconomyActivationCurrentnessAssertion,
  ZeroneEconomyActivationCurrentnessResolver,
  ZeroneEconomyOperationCommitment,
  ZeroneEconomySigningBoundaryResult,
} from "./types.js";
import {
  assertBlockHash,
  assertCount,
  assertIdentifier,
  assertPurpose,
  assertSha256Id,
  assertTimestamp,
  assertTxHash,
  networkForChain,
  parseUint64,
  validateAccountSnapshot,
  validateBindingCurrentnessAssertion,
  validateTrustedBindingCurrentnessVerifierAssertion,
  validateTrustedSimulationAdapterAssertion,
  validateZeroneEconomyActivationCurrentnessAssertion,
} from "./validation.js";

interface BindingHeadRow {
  wallet_id: string;
  head_version: number;
  binding_id: Sha256Id;
  proof_id: Sha256Id;
  currentness_id: Sha256Id;
  binding_revision: number;
  continuity_sequence: number;
  revocation_nonce: number;
  descriptor_id: Sha256Id;
  signer_key_id: Sha256Id;
  source_account: ZeroneAccountId;
  network: "mainnet" | "testnet";
  proof_envelope_json: string;
  currentness_json: string;
  updated_at: string;
}

interface BindingHistoryRow {
  currentness_id: Sha256Id;
  proof_id: Sha256Id;
  wallet_id: string;
  head_version: number;
  binding_id: Sha256Id;
  source_account: ZeroneAccountId;
  proof_envelope_json: string;
  currentness_json: string;
  recorded_at: string;
}

interface CapabilityUsageRow {
  capability_record_id: Sha256Id;
  wallet_id: string;
  descriptor_id: Sha256Id;
  policy_hash: Sha256Id;
  revocation_nonce: number;
  max_intents: number;
  max_spend_uzrn: string;
  max_fee_per_intent_uzrn: string;
  reserved_intents: number;
  consumed_intents: number;
  reserved_spend_uzrn: string;
  consumed_spend_uzrn: string;
  version: number;
  updated_at: string;
}

interface AccountStateRow {
  chain_id: ZeroneCaip2;
  source_account: ZeroneAccountId;
  account_number: string;
  sequence: string;
  balance_uzrn: string;
  observed_at_height: string;
  block_hash: string;
  public_key_type_url: ZeroneAccountSnapshot["public_key_type_url"];
  public_key_b64u: string | null;
  valid_until: string;
  halted: number;
  halted_at_height: string | null;
  halt_evidence_id: Sha256Id | null;
  halted_at: string | null;
  revision: number;
  observed_at: string;
}

interface OperationRow {
  operation_id: string;
  operation_kind: OperationKind;
  revision: number;
  status: OperationStatus;
  wallet_id: string;
  binding_id: Sha256Id;
  proof_id: Sha256Id;
  currentness_id: Sha256Id;
  binding_head_version: number;
  descriptor_id: Sha256Id;
  capability_record_id: Sha256Id;
  capability_revocation_nonce: number;
  authorization_verification_id: Sha256Id;
  intent_record_id: Sha256Id;
  simulation_record_id: Sha256Id;
  plan_reference_id: Sha256Id;
  treasury_policy_id: Sha256Id;
  treasury_policy_json: string;
  window_start_height: string;
  reserve_floor_uzrn: string;
  chain_id: ZeroneCaip2;
  source_account: ZeroneAccountId;
  account_number: string;
  sequence: string;
  signer_key_id: Sha256Id;
  signer_invoked: number;
  request_id: string | null;
  unsigned_payload_hash: Sha256Id | null;
  signing_boundary_verification_id: Sha256Id | null;
  tx_hash: string | null;
  signed_payload_hash: Sha256Id | null;
  signed_verification_id: Sha256Id | null;
  inclusion_height: string | null;
  inclusion_block_hash: string | null;
  inclusion_code: number | null;
  inclusion_codespace: string | null;
  unresolved_reorg_event_sequence: number | null;
  unresolved_reorg_evidence_id: Sha256Id | null;
  event_count: number;
  event_head_hash: Sha256Id;
  created_at: string;
  updated_at: string;
}

interface EconomyCommitmentRow {
  operation_id: string;
  commitment_id: Sha256Id;
  plan_id: Sha256Id;
  plan_content_id: Sha256Id;
  message_kind: string;
  message_type_url: string;
  intent_record_id: Sha256Id;
  simulation_evidence_record_id: Sha256Id;
  simulation_evidence_json: string;
  binding_currentness_id: Sha256Id;
  binding_verifier_trust_id: Sha256Id;
  sign_doc_bytes_hash: Sha256Id;
  activation_currentness_id: Sha256Id;
  request_id: string;
  requested_at: string;
  commitment_json: string;
}

interface EconomySignedTransactionRow {
  operation_id: string;
  content_id: Sha256Id;
  plan_id: Sha256Id;
  plan_content_id: Sha256Id;
  intent_record_id: Sha256Id;
  request_id: string;
  signer_key_id: Sha256Id;
  sign_doc_bytes_hash: Sha256Id;
  tx_bytes_hash: Sha256Id;
  tx_hash: string;
  admitted_at: string;
  record_json: string;
}

interface ReservationRow {
  operation_id: string;
  purpose: TreasuryPurpose;
  amount_uzrn: string;
  state: ReservationState;
}

interface EventRow {
  ledger_sequence: number;
  operation_id: string;
  sequence: number;
  kind: string;
  at: string;
  details_json: string;
  previous_event_hash: Sha256Id;
  event_hash: Sha256Id;
}

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

interface IndexListRow {
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface ReplayedReorgEpoch {
  readonly chain_id: ZeroneCaip2;
  readonly source_account: ZeroneAccountId;
  readonly observed_at_height: string;
  readonly evidence_id: Sha256Id;
  readonly observed_at: string;
  readonly operation_event_sequence: number;
  readonly ledger_sequence: number;
}

interface ReplayedLifecycle {
  readonly status: OperationStatus;
  readonly signer_invoked: number;
  readonly request_id: string | null;
  readonly unsigned_payload_hash: Sha256Id | null;
  readonly signing_boundary_verification_id: Sha256Id | null;
  readonly tx_hash: string | null;
  readonly signed_payload_hash: Sha256Id | null;
  readonly signed_verification_id: Sha256Id | null;
  readonly inclusion_height: string | null;
  readonly inclusion_block_hash: string | null;
  readonly inclusion_code: number | null;
  readonly inclusion_codespace: string | null;
  readonly release_evidence_id: Sha256Id | null;
  readonly release_at: string | null;
  readonly unresolved_reorg: ReplayedReorgEpoch | null;
  readonly reorg_epochs: readonly ReplayedReorgEpoch[];
  readonly observations: readonly ZeroneAccountSnapshot[];
}

export interface ZeroneAgentHostStoreOptions {
  readonly create: boolean;
  /** Non-durable escape hatch for unit tests only. Production callers must omit it. */
  readonly allow_in_memory_for_tests?: boolean;
  /**
   * Enables the opaque pre-v3 generic injected lifecycle for legacy tests only.
   * Typed production hosts must omit this and use the economy boundary.
   */
  readonly allow_legacy_generic_injected_for_tests?: boolean;
  /**
   * Defaults to true even with create-if-missing. Only one lifecycle driver
   * may perform cold-start recovery for a database at a time. Concurrent
   * reservation-only workers must explicitly set this false.
   */
  readonly recover_interrupted?: boolean;
  readonly now?: () => string;
  /** Immutable resolver used by every typed economy operation. */
  readonly binding_currentness_resolver?: BindingCurrentnessResolver;
  /** Immutable resolver used by every typed economy operation. */
  readonly activation_currentness_resolver?: ZeroneEconomyActivationCurrentnessResolver;
  /** Immutable account observer used by every typed economy operation. */
  readonly account_observer?: ZeroneStateObserver;
  /** Exact immutable binding-currentness verifier trust epochs. */
  readonly trusted_binding_currentness_verifiers?: readonly TrustedBindingCurrentnessVerifierAssertion[];
  /** Exact immutable adapter trust entries required by the typed economy path. */
  readonly trusted_simulation_adapters?: readonly TrustedSimulationAdapterAssertion[];
  /** Resolver verifier names admitted by the typed activation-currentness path. */
  readonly trusted_activation_verifier_ids?: readonly string[];
}

const TABLE_COLUMNS = Object.freeze({
  account_states: [
    "chain_id", "source_account", "account_number", "sequence", "balance_uzrn",
    "observed_at_height", "block_hash", "public_key_type_url", "public_key_b64u",
    "valid_until", "halted", "halted_at_height",
    "halt_evidence_id", "halted_at", "revision", "observed_at",
  ],
  binding_heads: [
    "wallet_id", "head_version", "binding_id", "proof_id", "currentness_id", "binding_revision",
    "continuity_sequence", "revocation_nonce", "descriptor_id", "signer_key_id",
    "source_account", "network", "proof_envelope_json", "currentness_json", "updated_at",
  ],
  binding_history: [
    "currentness_id", "proof_id", "wallet_id", "head_version", "binding_id",
    "source_account", "proof_envelope_json", "currentness_json", "recorded_at",
  ],
  capability_usage: [
    "capability_record_id", "wallet_id", "descriptor_id", "policy_hash",
    "revocation_nonce", "max_intents", "max_spend_uzrn", "max_fee_per_intent_uzrn",
    "reserved_intents", "consumed_intents", "reserved_spend_uzrn",
    "consumed_spend_uzrn", "version", "updated_at",
  ],
  operation_events: [
    "ledger_sequence", "operation_id", "sequence", "kind", "at", "details_json",
    "previous_event_hash", "event_hash",
  ],
  economy_operation_commitments: [
    "operation_id", "commitment_id", "plan_id", "plan_content_id", "message_kind",
    "message_type_url", "intent_record_id", "simulation_evidence_record_id",
    "simulation_evidence_json", "binding_currentness_id", "binding_verifier_trust_id",
    "sign_doc_bytes_hash", "activation_currentness_id", "request_id", "requested_at",
    "commitment_json",
  ],
  economy_signed_transactions: [
    "operation_id", "content_id", "plan_id", "plan_content_id", "intent_record_id",
    "request_id", "signer_key_id", "sign_doc_bytes_hash", "tx_bytes_hash", "tx_hash",
    "admitted_at", "record_json",
  ],
  operations: [
    "operation_id", "operation_kind", "revision", "status", "wallet_id", "binding_id", "proof_id",
    "currentness_id", "binding_head_version", "descriptor_id", "capability_record_id",
    "capability_revocation_nonce", "authorization_verification_id", "intent_record_id", "simulation_record_id",
    "plan_reference_id", "treasury_policy_id", "treasury_policy_json",
    "window_start_height", "reserve_floor_uzrn", "chain_id", "source_account",
    "account_number", "sequence", "signer_key_id", "signer_invoked", "request_id",
    "unsigned_payload_hash", "signing_boundary_verification_id", "tx_hash",
    "signed_payload_hash", "signed_verification_id", "inclusion_height",
    "inclusion_block_hash", "inclusion_code", "inclusion_codespace",
    "unresolved_reorg_event_sequence", "unresolved_reorg_evidence_id", "event_count",
    "event_head_hash", "created_at", "updated_at",
  ],
  sequence_fences: [
    "operation_id", "chain_id", "source_account", "account_number", "sequence",
    "state", "acquired_at", "released_at", "release_evidence_id",
  ],
  treasury_reservations: ["operation_id", "purpose", "amount_uzrn", "state"],
} as const);

const TABLE_SIGNATURES: Readonly<Record<keyof typeof TABLE_COLUMNS, string>> = Object.freeze({
  account_states: "chain_id:TEXT:1:1|source_account:TEXT:1:2|account_number:TEXT:1:0|sequence:TEXT:1:0|balance_uzrn:TEXT:1:0|observed_at_height:TEXT:1:0|block_hash:TEXT:1:0|public_key_type_url:TEXT:0:0|public_key_b64u:TEXT:0:0|valid_until:TEXT:1:0|halted:INTEGER:1:0|halted_at_height:TEXT:0:0|halt_evidence_id:TEXT:0:0|halted_at:TEXT:0:0|revision:INTEGER:1:0|observed_at:TEXT:1:0",
  binding_heads: "wallet_id:TEXT:0:1|head_version:INTEGER:1:0|binding_id:TEXT:1:0|proof_id:TEXT:1:0|currentness_id:TEXT:1:0|binding_revision:INTEGER:1:0|continuity_sequence:INTEGER:1:0|revocation_nonce:INTEGER:1:0|descriptor_id:TEXT:1:0|signer_key_id:TEXT:1:0|source_account:TEXT:1:0|network:TEXT:1:0|proof_envelope_json:TEXT:1:0|currentness_json:TEXT:1:0|updated_at:TEXT:1:0",
  binding_history: "currentness_id:TEXT:0:1|proof_id:TEXT:1:0|wallet_id:TEXT:1:0|head_version:INTEGER:1:0|binding_id:TEXT:1:0|source_account:TEXT:1:0|proof_envelope_json:TEXT:1:0|currentness_json:TEXT:1:0|recorded_at:TEXT:1:0",
  capability_usage: "capability_record_id:TEXT:0:1|wallet_id:TEXT:1:0|descriptor_id:TEXT:1:0|policy_hash:TEXT:1:0|revocation_nonce:INTEGER:1:0|max_intents:INTEGER:1:0|max_spend_uzrn:TEXT:1:0|max_fee_per_intent_uzrn:TEXT:1:0|reserved_intents:INTEGER:1:0|consumed_intents:INTEGER:1:0|reserved_spend_uzrn:TEXT:1:0|consumed_spend_uzrn:TEXT:1:0|version:INTEGER:1:0|updated_at:TEXT:1:0",
  operation_events: "ledger_sequence:INTEGER:0:1|operation_id:TEXT:1:0|sequence:INTEGER:1:0|kind:TEXT:1:0|at:TEXT:1:0|details_json:TEXT:1:0|previous_event_hash:TEXT:1:0|event_hash:TEXT:1:0",
  economy_operation_commitments: "operation_id:TEXT:0:1|commitment_id:TEXT:1:0|plan_id:TEXT:1:0|plan_content_id:TEXT:1:0|message_kind:TEXT:1:0|message_type_url:TEXT:1:0|intent_record_id:TEXT:1:0|simulation_evidence_record_id:TEXT:1:0|simulation_evidence_json:TEXT:1:0|binding_currentness_id:TEXT:1:0|binding_verifier_trust_id:TEXT:1:0|sign_doc_bytes_hash:TEXT:1:0|activation_currentness_id:TEXT:1:0|request_id:TEXT:1:0|requested_at:TEXT:1:0|commitment_json:TEXT:1:0",
  economy_signed_transactions: "operation_id:TEXT:0:1|content_id:TEXT:1:0|plan_id:TEXT:1:0|plan_content_id:TEXT:1:0|intent_record_id:TEXT:1:0|request_id:TEXT:1:0|signer_key_id:TEXT:1:0|sign_doc_bytes_hash:TEXT:1:0|tx_bytes_hash:TEXT:1:0|tx_hash:TEXT:1:0|admitted_at:TEXT:1:0|record_json:TEXT:1:0",
  operations: "operation_id:TEXT:0:1|operation_kind:TEXT:1:0|revision:INTEGER:1:0|status:TEXT:1:0|wallet_id:TEXT:1:0|binding_id:TEXT:1:0|proof_id:TEXT:1:0|currentness_id:TEXT:1:0|binding_head_version:INTEGER:1:0|descriptor_id:TEXT:1:0|capability_record_id:TEXT:1:0|capability_revocation_nonce:INTEGER:1:0|authorization_verification_id:TEXT:1:0|intent_record_id:TEXT:1:0|simulation_record_id:TEXT:1:0|plan_reference_id:TEXT:1:0|treasury_policy_id:TEXT:1:0|treasury_policy_json:TEXT:1:0|window_start_height:TEXT:1:0|reserve_floor_uzrn:TEXT:1:0|chain_id:TEXT:1:0|source_account:TEXT:1:0|account_number:TEXT:1:0|sequence:TEXT:1:0|signer_key_id:TEXT:1:0|signer_invoked:INTEGER:1:0|request_id:TEXT:0:0|unsigned_payload_hash:TEXT:0:0|signing_boundary_verification_id:TEXT:0:0|tx_hash:TEXT:0:0|signed_payload_hash:TEXT:0:0|signed_verification_id:TEXT:0:0|inclusion_height:TEXT:0:0|inclusion_block_hash:TEXT:0:0|inclusion_code:INTEGER:0:0|inclusion_codespace:TEXT:0:0|unresolved_reorg_event_sequence:INTEGER:0:0|unresolved_reorg_evidence_id:TEXT:0:0|event_count:INTEGER:1:0|event_head_hash:TEXT:1:0|created_at:TEXT:1:0|updated_at:TEXT:1:0",
  sequence_fences: "operation_id:TEXT:0:1|chain_id:TEXT:1:0|source_account:TEXT:1:0|account_number:TEXT:1:0|sequence:TEXT:1:0|state:TEXT:1:0|acquired_at:TEXT:1:0|released_at:TEXT:0:0|release_evidence_id:TEXT:0:0",
  treasury_reservations: "operation_id:TEXT:1:1|purpose:TEXT:1:2|amount_uzrn:TEXT:1:0|state:TEXT:1:0",
});

const TABLE_SQL: Readonly<Record<keyof typeof TABLE_COLUMNS, string>> = Object.freeze({
  account_states: "create table account_states (chain_id text not null, source_account text not null, account_number text not null, sequence text not null, balance_uzrn text not null, observed_at_height text not null, block_hash text not null, public_key_type_url text, public_key_b64u text, valid_until text not null, halted integer not null check(halted in (0, 1)), halted_at_height text, halt_evidence_id text, halted_at text, revision integer not null check(revision >= 1), observed_at text not null, primary key(chain_id, source_account), check((public_key_type_url is null and public_key_b64u is null) or (public_key_type_url = '/cosmos.crypto.secp256k1.pubkey' and public_key_b64u is not null)))",
  binding_heads: "create table binding_heads (wallet_id text primary key, head_version integer not null check(head_version >= 1), binding_id text not null unique, proof_id text not null, currentness_id text not null references binding_history(currentness_id), binding_revision integer not null check(binding_revision >= 1), continuity_sequence integer not null check(continuity_sequence >= 0), revocation_nonce integer not null check(revocation_nonce >= 0), descriptor_id text not null, signer_key_id text not null, source_account text not null unique, network text not null check(network in ('mainnet', 'testnet')), proof_envelope_json text not null, currentness_json text not null, updated_at text not null)",
  binding_history: "create table binding_history (currentness_id text primary key, proof_id text not null, wallet_id text not null, head_version integer not null check(head_version >= 1), binding_id text not null, source_account text not null, proof_envelope_json text not null, currentness_json text not null, recorded_at text not null, unique(wallet_id, head_version))",
  capability_usage: "create table capability_usage (capability_record_id text primary key, wallet_id text not null references binding_heads(wallet_id), descriptor_id text not null, policy_hash text not null, revocation_nonce integer not null check(revocation_nonce >= 0), max_intents integer not null check(max_intents >= 1), max_spend_uzrn text not null, max_fee_per_intent_uzrn text not null, reserved_intents integer not null check(reserved_intents >= 0), consumed_intents integer not null check(consumed_intents >= 0), reserved_spend_uzrn text not null, consumed_spend_uzrn text not null, version integer not null check(version >= 1), updated_at text not null)",
  operation_events: "create table operation_events (ledger_sequence integer primary key, operation_id text not null references operations(operation_id), sequence integer not null check(sequence >= 1), kind text not null, at text not null, details_json text not null, previous_event_hash text not null, event_hash text not null unique, unique(operation_id, sequence))",
  economy_operation_commitments: "create table economy_operation_commitments (operation_id text primary key references operations(operation_id), commitment_id text not null unique, plan_id text not null unique, plan_content_id text not null unique, message_kind text not null check(message_kind in ('create_bounty', 'submit_claim', 'fulfill_bounty')), message_type_url text not null, intent_record_id text not null, simulation_evidence_record_id text not null unique, simulation_evidence_json text not null, binding_currentness_id text not null, binding_verifier_trust_id text not null, sign_doc_bytes_hash text not null unique, activation_currentness_id text not null, request_id text not null unique, requested_at text not null, commitment_json text not null)",
  economy_signed_transactions: "create table economy_signed_transactions (operation_id text primary key references operations(operation_id), content_id text not null unique, plan_id text not null unique, plan_content_id text not null unique, intent_record_id text not null unique, request_id text not null unique, signer_key_id text not null, sign_doc_bytes_hash text not null unique, tx_bytes_hash text not null unique, tx_hash text not null unique, admitted_at text not null, record_json text not null)",
  operations: "create table operations (operation_id text primary key, operation_kind text not null check(operation_kind in ('generic_injected', 'zerone_economy')), revision integer not null check(revision >= 1), status text not null check(status in ('reserved', 'signing', 'signing_unknown', 'signed', 'submitting', 'submission_unknown', 'submitted', 'rejected_pre_submit_sticky', 'confirmed_success', 'confirmed_failed', 'reorged', 'sequence_superseded', 'released_pre_sign')), wallet_id text not null references binding_heads(wallet_id), binding_id text not null, proof_id text not null, currentness_id text not null references binding_history(currentness_id), binding_head_version integer not null, descriptor_id text not null, capability_record_id text not null references capability_usage(capability_record_id), capability_revocation_nonce integer not null, authorization_verification_id text not null unique, intent_record_id text not null unique, simulation_record_id text not null, plan_reference_id text not null, treasury_policy_id text not null, treasury_policy_json text not null, window_start_height text not null, reserve_floor_uzrn text not null, chain_id text not null, source_account text not null, account_number text not null, sequence text not null, signer_key_id text not null, signer_invoked integer not null check(signer_invoked in (0, 1)), request_id text unique, unsigned_payload_hash text, signing_boundary_verification_id text, tx_hash text unique, signed_payload_hash text, signed_verification_id text, inclusion_height text, inclusion_block_hash text, inclusion_code integer, inclusion_codespace text, unresolved_reorg_event_sequence integer, unresolved_reorg_evidence_id text, event_count integer not null check(event_count >= 0), event_head_hash text not null, created_at text not null, updated_at text not null, check((unresolved_reorg_event_sequence is null and unresolved_reorg_evidence_id is null) or (unresolved_reorg_event_sequence >= 1 and unresolved_reorg_evidence_id is not null)))",
  sequence_fences: "create table sequence_fences (operation_id text primary key references operations(operation_id), chain_id text not null, source_account text not null, account_number text not null, sequence text not null, state text not null check(state in ('held', 'released')), acquired_at text not null, released_at text, release_evidence_id text)",
  treasury_reservations: "create table treasury_reservations (operation_id text not null references operations(operation_id), purpose text not null check(purpose in ('compute', 'knowledge_bond', 'network_fee', 'sponsorship_escrow', 'storage')), amount_uzrn text not null, state text not null check(state in ('reserved', 'sticky', 'settled', 'released')), primary key(operation_id, purpose))",
});

const INDEX_SIGNATURES: Readonly<Record<keyof typeof TABLE_COLUMNS, readonly string[]>> = Object.freeze({
  account_states: ["1:pk:0:chain_id,source_account"],
  binding_heads: ["1:pk:0:wallet_id", "1:u:0:binding_id", "1:u:0:source_account"],
  binding_history: [
    "0:c:0:source_account",
    "1:pk:0:currentness_id",
    "1:u:0:wallet_id,head_version",
  ],
  capability_usage: ["1:pk:0:capability_record_id"],
  operation_events: ["1:u:0:event_hash", "1:u:0:operation_id,sequence"],
  economy_operation_commitments: [
    "1:pk:0:operation_id",
    "1:u:0:commitment_id",
    "1:u:0:plan_content_id",
    "1:u:0:plan_id",
    "1:u:0:request_id",
    "1:u:0:sign_doc_bytes_hash",
    "1:u:0:simulation_evidence_record_id",
  ],
  economy_signed_transactions: [
    "1:pk:0:operation_id",
    "1:u:0:content_id",
    "1:u:0:intent_record_id",
    "1:u:0:plan_content_id",
    "1:u:0:plan_id",
    "1:u:0:request_id",
    "1:u:0:sign_doc_bytes_hash",
    "1:u:0:tx_bytes_hash",
    "1:u:0:tx_hash",
  ],
  operations: [
    "0:c:0:capability_record_id,created_at",
    "0:c:0:chain_id,source_account,window_start_height",
    "1:pk:0:operation_id",
    "1:u:0:authorization_verification_id",
    "1:u:0:intent_record_id",
    "1:u:0:request_id",
    "1:u:0:tx_hash",
  ],
  sequence_fences: ["1:c:1:chain_id,source_account", "1:pk:0:operation_id"],
  treasury_reservations: ["0:c:0:state,operation_id", "1:pk:0:operation_id,purpose"],
});

const FOREIGN_KEY_SIGNATURES: Readonly<Record<keyof typeof TABLE_COLUMNS, readonly string[]>> = Object.freeze({
  account_states: [],
  binding_heads: ["currentness_id->binding_history.currentness_id:NO ACTION:NO ACTION:NONE"],
  binding_history: [],
  capability_usage: ["wallet_id->binding_heads.wallet_id:NO ACTION:NO ACTION:NONE"],
  operation_events: ["operation_id->operations.operation_id:NO ACTION:NO ACTION:NONE"],
  economy_operation_commitments: ["operation_id->operations.operation_id:NO ACTION:NO ACTION:NONE"],
  economy_signed_transactions: ["operation_id->operations.operation_id:NO ACTION:NO ACTION:NONE"],
  operations: [
    "capability_record_id->capability_usage.capability_record_id:NO ACTION:NO ACTION:NONE",
    "currentness_id->binding_history.currentness_id:NO ACTION:NO ACTION:NONE",
    "wallet_id->binding_heads.wallet_id:NO ACTION:NO ACTION:NONE",
  ],
  sequence_fences: ["operation_id->operations.operation_id:NO ACTION:NO ACTION:NONE"],
  treasury_reservations: ["operation_id->operations.operation_id:NO ACTION:NO ACTION:NONE"],
});

function normalizeSql(value: string | null): string {
  return (value ?? "")
    .replace(/\s+/gu, " ")
    .replace(/\(\s+/gu, "(")
    .replace(/\s+\)/gu, ")")
    .trim()
    .toLowerCase();
}

function bigintSum(values: readonly string[]): bigint {
  return values.reduce((sum, value) => sum + BigInt(value), 0n);
}

const UTF8 = new TextEncoder();

function economyCommitmentId(
  core: Omit<ZeroneEconomyOperationCommitment, "commitment_id">,
): Sha256Id {
  return sha256BytesId(UTF8.encode(
    `${ECONOMY_COMMITMENT_HASH_DOMAIN}\0${canonicalJson(core)}`,
  ));
}

function economySequenceAdvanceEvidenceId(input: {
  readonly operation_id: string;
  readonly expected_revision: number;
  readonly reserved_sequence: string;
  readonly snapshot: ZeroneAccountSnapshot;
}): Sha256Id {
  return sha256BytesId(UTF8.encode(
    `${ECONOMY_SEQUENCE_ADVANCE_EVIDENCE_HASH_DOMAIN}\0${canonicalJson(input)}`,
  ));
}

const ECONOMY_COMMITMENT_KEYS = [
  "account_block_hash", "account_number", "account_observed_at",
  "account_observed_at_height", "account_public_key_b64u",
  "account_public_key_type_url", "account_sequence", "account_valid_until",
  "activation_block_hash", "activation_currentness_id",
  "activation_currentness_json", "activation_external_verification_id",
  "activation_observation_hash", "activation_observed_at_height",
  "activation_valid_until", "activation_verified_at", "activation_verifier_id",
  "actor_address", "authorization_usage_json", "authorization_verification_id",
  "chain_id", "commitment_id",
  "binding_currentness_id", "binding_currentness_json",
  "binding_verifier_external_verification_id", "binding_verifier_id",
  "binding_verifier_trust_id", "binding_verifier_trust_json",
  "binding_verifier_valid_until", "binding_verifier_verified_at",
  "cosmos_sdk", "economic_effect_json", "format", "local_durable_effects",
  "intent_record_id", "knowledge_consensus_version", "message_kind", "message_type_url",
  "module_account", "network_fee_uzrn", "operation_id", "plan_content_id",
  "plan_id", "projection_hash", "request_id", "requested_at", "reserved_spend_uzrn",
  "sign_doc_bytes_hash", "simulation_adapter_external_verification_id",
  "simulation_adapter_public_key", "simulation_adapter_trust_id",
  "simulation_adapter_trust_json", "simulation_adapter_valid_until",
  "simulation_adapter_verified_at", "simulation_adapter_verifier_id",
  "simulation_block_hash", "simulation_block_ref",
  "simulation_evidence_content_id", "simulation_evidence_json",
  "simulation_evidence_record_id",
  "simulation_observed_at_height", "simulation_record_id",
  "simulation_simulated_at", "simulation_tx_bytes_hash",
  "simulation_valid_until", "source_account", "sponsorship_consensus_version",
  "network_effects_performed", "value_b64u", "value_hash", "wallet_method",
  "zerone_core_commit",
] as const;

function parseEconomyCommitment(json: string): ZeroneEconomyOperationCommitment {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    fail("integrity_error", "Economy commitment JSON is not parseable");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail("integrity_error", "Economy commitment must be an object");
  }
  const actual = Object.keys(parsed).sort();
  const expected = [...ECONOMY_COMMITMENT_KEYS].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
    || canonicalJson(parsed) !== json
  ) {
    fail("integrity_error", "Economy commitment is not the closed canonical record");
  }
  const commitment = parsed as ZeroneEconomyOperationCommitment;
  if (
    commitment.format !== "agenttool.zerone-economy-operation-commitment/0.1"
    || commitment.network_effects_performed !== false
    || commitment.local_durable_effects
      !== "reservation_and_possible_signer_boundary_committed"
    || commitment.zerone_core_commit !== "a5b82e82b2a32be2b75bd11575964b0a69aa34ac"
    || commitment.cosmos_sdk !== "v0.53.8"
    || commitment.sponsorship_consensus_version !== 2
    || commitment.knowledge_consensus_version !== 7
  ) {
    fail("integrity_error", "Economy commitment boundary or source tuple is invalid");
  }
  assertIdentifier(commitment.operation_id, "economy_commitment.operation_id");
  assertUuid(commitment.request_id, "economy_commitment.request_id");
  for (const [label, id] of [
    ["commitment_id", commitment.commitment_id],
    ["plan_id", commitment.plan_id],
    ["plan_content_id", commitment.plan_content_id],
    ["projection_hash", commitment.projection_hash],
    ["value_hash", commitment.value_hash],
    ["authorization_verification_id", commitment.authorization_verification_id],
    ["binding_currentness_id", commitment.binding_currentness_id],
    ["binding_verifier_trust_id", commitment.binding_verifier_trust_id],
    ["binding_verifier_external_verification_id", commitment.binding_verifier_external_verification_id],
    ["intent_record_id", commitment.intent_record_id],
    ["simulation_record_id", commitment.simulation_record_id],
    ["simulation_evidence_content_id", commitment.simulation_evidence_content_id],
    ["simulation_evidence_record_id", commitment.simulation_evidence_record_id],
    ["simulation_tx_bytes_hash", commitment.simulation_tx_bytes_hash],
    ["simulation_adapter_trust_id", commitment.simulation_adapter_trust_id],
    ["simulation_adapter_external_verification_id", commitment.simulation_adapter_external_verification_id],
    ["sign_doc_bytes_hash", commitment.sign_doc_bytes_hash],
    ["activation_currentness_id", commitment.activation_currentness_id],
    ["activation_external_verification_id", commitment.activation_external_verification_id],
    ["activation_observation_hash", commitment.activation_observation_hash],
  ] as const) {
    assertSha256Id(id, `economy_commitment.${label}`);
  }
  for (const [label, amount, positive] of [
    ["reserved_spend_uzrn", commitment.reserved_spend_uzrn, false],
    ["network_fee_uzrn", commitment.network_fee_uzrn, true],
    ["activation_observed_at_height", commitment.activation_observed_at_height, true],
    ["simulation_observed_at_height", commitment.simulation_observed_at_height, true],
    ["account_observed_at_height", commitment.account_observed_at_height, true],
    ["account_number", commitment.account_number, false],
    ["account_sequence", commitment.account_sequence, false],
  ] as const) {
    parseUint64(amount, `economy_commitment.${label}`, positive);
  }
  for (const [label, timestamp] of [
    ["requested_at", commitment.requested_at],
    ["activation_verified_at", commitment.activation_verified_at],
    ["activation_valid_until", commitment.activation_valid_until],
    ["simulation_adapter_verified_at", commitment.simulation_adapter_verified_at],
    ["simulation_adapter_valid_until", commitment.simulation_adapter_valid_until],
    ["binding_verifier_verified_at", commitment.binding_verifier_verified_at],
    ["binding_verifier_valid_until", commitment.binding_verifier_valid_until],
    ["simulation_simulated_at", commitment.simulation_simulated_at],
    ["simulation_valid_until", commitment.simulation_valid_until],
    ["account_observed_at", commitment.account_observed_at],
    ["account_valid_until", commitment.account_valid_until],
  ] as const) {
    assertTimestamp(timestamp, `economy_commitment.${label}`);
  }
  assertBlockHash(commitment.activation_block_hash, "economy_commitment.activation_block_hash");
  assertBlockHash(commitment.account_block_hash, "economy_commitment.account_block_hash");
  if (
    (commitment.account_public_key_type_url === null)
      !== (commitment.account_public_key_b64u === null)
    || (BigInt(commitment.account_sequence) > 0n
      && commitment.account_public_key_type_url === null)
  ) {
    fail("integrity_error", "Economy account registered-key pair is incomplete");
  }
  if (commitment.account_public_key_type_url !== null) {
    if (commitment.account_public_key_type_url !== COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL) {
      fail("integrity_error", "Economy account registered-key type is unsupported");
    }
    let accountPublicKey: Uint8Array;
    try {
      accountPublicKey = base64UrlDecode(commitment.account_public_key_b64u as string);
      if (base64UrlEncode(accountPublicKey) !== commitment.account_public_key_b64u) {
        fail("integrity_error", "Economy account registered key is not canonical base64url");
      }
      assertSecp256k1PublicKey(accountPublicKey, "economy_commitment.account_public_key_b64u");
    } catch {
      fail("integrity_error", "Economy account registered secp256k1 key is invalid");
    }
  }
  if (commitment.simulation_block_hash === null) {
    fail("integrity_error", "Economy simulation commitment requires a canonical block hash");
  }
  assertBlockHash(commitment.simulation_block_hash, "economy_commitment.simulation_block_hash");
  assertIdentifier(commitment.binding_verifier_id, "economy_commitment.binding_verifier_id");
  assertIdentifier(commitment.activation_verifier_id, "economy_commitment.activation_verifier_id");
  assertIdentifier(
    commitment.simulation_adapter_verifier_id,
    "economy_commitment.simulation_adapter_verifier_id",
  );
  let valueBytes: Uint8Array;
  let economicEffectValue: unknown;
  try {
    valueBytes = base64UrlDecode(commitment.value_b64u);
    economicEffectValue = JSON.parse(commitment.economic_effect_json);
  } catch {
    fail("integrity_error", "Economy message payload or economic effect is not parseable");
  }
  if (
    base64UrlEncode(valueBytes) !== commitment.value_b64u
    || sha256BytesId(valueBytes) !== commitment.value_hash
    || canonicalJson(economicEffectValue) !== commitment.economic_effect_json
  ) {
    fail("integrity_error", "Economy message payload or effect is not canonical");
  }
  const network = networkForChain(commitment.chain_id);
  const profile = getZeroneProfile(network);
  const modules = getZeroneEconomyModuleAccounts(network);
  const messageSpec = commitment.message_kind === "create_bounty"
    ? Object.freeze({
        type_url: "/zerone.sponsorship.v1.MsgCreateBountyOrder",
        wallet_method: "zerone.sponsorship.v1.MsgCreateBountyOrder",
        module_account: modules.sponsorship,
        effect: Object.freeze({
          message_index: 0,
          kind: "escrow_lock",
          module: "sponsorship",
          direction: "outgoing",
          asset_id: profile.native_asset_id,
          amount_atomic: commitment.reserved_spend_uzrn,
          condition: "message_success",
        }),
      })
    : commitment.message_kind === "submit_claim"
      ? Object.freeze({
          type_url: "/zerone.knowledge.v1.MsgSubmitClaim",
          wallet_method: "zerone.knowledge.v1.MsgSubmitClaim",
          module_account: modules.knowledge,
          effect: Object.freeze({
            message_index: 0,
            kind: "review_fee",
            module: "knowledge",
            direction: "outgoing",
            asset_id: profile.native_asset_id,
            amount_atomic: commitment.reserved_spend_uzrn,
            condition: "message_success",
          }),
        })
      : commitment.message_kind === "fulfill_bounty"
        ? Object.freeze({
            type_url: "/zerone.sponsorship.v1.MsgFulfillBounty",
            wallet_method: "zerone.sponsorship.v1.MsgFulfillBounty",
            module_account: modules.sponsorship,
            effect: Object.freeze({
              message_index: 0,
              kind: "fulfillment_request",
              module: "sponsorship",
              direction: "conditional_incoming",
              asset_id: profile.native_asset_id,
              amount_atomic: null,
              condition: "keeper_state_and_message_success",
            }),
          })
        : null;
  if (
    messageSpec === null
    || commitment.message_type_url !== messageSpec.type_url
    || commitment.wallet_method !== messageSpec.wallet_method
    || commitment.module_account !== messageSpec.module_account
    || commitment.actor_address
      !== commitment.source_account.slice(commitment.chain_id.length + 1)
    || (commitment.message_kind === "fulfill_bounty"
      && commitment.reserved_spend_uzrn !== "0")
    || canonicalJson(economicEffectValue) !== canonicalJson(messageSpec.effect)
  ) {
    fail("integrity_error", "Economy message kind, module, actor, value, or effect mapping is invalid");
  }
  let activationValue: unknown;
  let adapterValue: unknown;
  let bindingCurrentnessValue: unknown;
  let bindingVerifierTrustValue: unknown;
  let authorizationUsageValue: unknown;
  let simulationEvidenceValue: unknown;
  try {
    activationValue = JSON.parse(commitment.activation_currentness_json);
    adapterValue = JSON.parse(commitment.simulation_adapter_trust_json);
    bindingCurrentnessValue = JSON.parse(commitment.binding_currentness_json);
    bindingVerifierTrustValue = JSON.parse(commitment.binding_verifier_trust_json);
    authorizationUsageValue = JSON.parse(commitment.authorization_usage_json);
    simulationEvidenceValue = JSON.parse(commitment.simulation_evidence_json);
  } catch {
    fail("integrity_error", "Economy commitment nested JSON is not parseable");
  }
  if (
    canonicalJson(activationValue) !== commitment.activation_currentness_json
    || canonicalJson(adapterValue) !== commitment.simulation_adapter_trust_json
    || canonicalJson(bindingCurrentnessValue) !== commitment.binding_currentness_json
    || canonicalJson(bindingVerifierTrustValue) !== commitment.binding_verifier_trust_json
    || canonicalJson(authorizationUsageValue) !== commitment.authorization_usage_json
    || canonicalJson(simulationEvidenceValue) !== commitment.simulation_evidence_json
  ) {
    fail("integrity_error", "Economy commitment nested records are not canonical JSON");
  }
  if (
    typeof authorizationUsageValue !== "object"
    || authorizationUsageValue === null
    || Array.isArray(authorizationUsageValue)
    || Object.keys(authorizationUsageValue).sort().join("\0")
      !== [
        "host_verified_approval_ids",
        "intent_count",
        "revocation_nonce",
        "spent",
      ].sort().join("\0")
  ) {
    fail("integrity_error", "Economy authorization usage snapshot is not closed");
  }
  const authorizationUsage = authorizationUsageValue as Record<string, unknown>;
  assertCount(authorizationUsage.revocation_nonce, "economy_authorization_usage.revocation_nonce");
  assertCount(authorizationUsage.intent_count, "economy_authorization_usage.intent_count");
  const approvals = authorizationUsage.host_verified_approval_ids;
  const spent = authorizationUsage.spent;
  if (
    !Array.isArray(approvals)
    || approvals.length !== 0
    || !Array.isArray(spent)
    || spent.length !== 1
    || typeof spent[0] !== "object"
    || spent[0] === null
    || Array.isArray(spent[0])
  ) {
    fail("integrity_error", "Economy authorization usage approvals or spend shape is invalid");
  }
  const nativeSpend = spent[0] as Record<string, unknown>;
  if (
    Object.keys(nativeSpend).sort().join("\0") !== "amount_atomic\0asset_id"
    || nativeSpend.asset_id !== profile.native_asset_id
  ) {
    fail("integrity_error", "Economy authorization usage does not bind native Zerone spend");
  }
  parseUint64(nativeSpend.amount_atomic, "economy_authorization_usage.spent.amount_atomic");
  const activation = validateZeroneEconomyActivationCurrentnessAssertion(
    activationValue as ZeroneEconomyActivationCurrentnessAssertion,
  );
  const adapter = validateTrustedSimulationAdapterAssertion(
    adapterValue as TrustedSimulationAdapterAssertion,
  );
  const bindingCurrentness = validateBindingCurrentnessAssertion(
    bindingCurrentnessValue as BindingCurrentnessAssertion,
  );
  const bindingVerifierTrust = validateTrustedBindingCurrentnessVerifierAssertion(
    bindingVerifierTrustValue as TrustedBindingCurrentnessVerifierAssertion,
  );
  let simulationEvidence;
  try {
    simulationEvidence = verifyZeroneEconomySimulationEvidence(simulationEvidenceValue);
  } catch {
    fail("integrity_error", "Economy simulation evidence signature does not verify");
  }
  if (
    activation.currentness_id !== commitment.activation_currentness_id
    || authorizationUsage.revocation_nonce !== bindingCurrentness.wallet_revocation_nonce
    || bindingCurrentness.currentness_id !== commitment.binding_currentness_id
    || bindingCurrentness.verifier_id !== commitment.binding_verifier_id
    || bindingVerifierTrust.trust_id !== commitment.binding_verifier_trust_id
    || bindingVerifierTrust.external_verification_id
      !== commitment.binding_verifier_external_verification_id
    || bindingVerifierTrust.verifier_id !== commitment.binding_verifier_id
    || bindingVerifierTrust.verified_at !== commitment.binding_verifier_verified_at
    || bindingVerifierTrust.valid_until !== commitment.binding_verifier_valid_until
    || Date.parse(bindingCurrentness.verified_at)
      < Date.parse(bindingVerifierTrust.verified_at)
    || Date.parse(bindingCurrentness.verified_at)
      >= Date.parse(bindingVerifierTrust.valid_until)
    || Date.parse(bindingCurrentness.valid_until)
      > Date.parse(bindingVerifierTrust.valid_until)
    || Date.parse(commitment.requested_at) < Date.parse(bindingVerifierTrust.verified_at)
    || Date.parse(commitment.requested_at) >= Date.parse(bindingVerifierTrust.valid_until)
    || Date.parse(commitment.requested_at) < Date.parse(bindingCurrentness.verified_at)
    || Date.parse(commitment.requested_at) >= Date.parse(bindingCurrentness.valid_until)
    || activation.external_verification_id !== commitment.activation_external_verification_id
    || activation.verifier_id !== commitment.activation_verifier_id
    || activation.activation_observation_hash !== commitment.activation_observation_hash
    || activation.observed_at_height !== commitment.activation_observed_at_height
    || activation.block_hash !== commitment.activation_block_hash
    || activation.verified_at !== commitment.activation_verified_at
    || activation.valid_until !== commitment.activation_valid_until
    || activation.chain_id !== commitment.chain_id
    || adapter.trust_id !== commitment.simulation_adapter_trust_id
    || adapter.external_verification_id
      !== commitment.simulation_adapter_external_verification_id
    || adapter.verifier_id !== commitment.simulation_adapter_verifier_id
    || adapter.adapter.public_key !== commitment.simulation_adapter_public_key
    || adapter.chain_id !== commitment.chain_id
    || adapter.verified_at !== commitment.simulation_adapter_verified_at
    || adapter.valid_until !== commitment.simulation_adapter_valid_until
    || simulationEvidence.content_id !== commitment.simulation_evidence_content_id
    || simulationEvidence.record_id !== commitment.simulation_evidence_record_id
    || simulationEvidence.plan_id !== commitment.plan_id
    || simulationEvidence.intent_record_id !== commitment.intent_record_id
    || simulationEvidence.simulation_record_id !== commitment.simulation_record_id
    || simulationEvidence.simulation_tx_bytes_hash !== commitment.simulation_tx_bytes_hash
    || simulationEvidence.activation_observation_hash
      !== commitment.activation_observation_hash
    || simulationEvidence.chain_id !== commitment.chain_id
    || simulationEvidence.source_account !== commitment.source_account
    || canonicalJson(simulationEvidence.adapter) !== canonicalJson(adapter.adapter)
    || simulationEvidence.status !== "succeeded"
    || simulationEvidence.code !== 0
    || simulationEvidence.simulated_at !== commitment.simulation_simulated_at
    || simulationEvidence.valid_until !== commitment.simulation_valid_until
    || simulationEvidence.observed_at_height
      !== commitment.simulation_observed_at_height
    || simulationEvidence.block_ref !== commitment.simulation_block_ref
    || simulationEvidence.block_hash !== commitment.simulation_block_hash
    || commitment.simulation_block_ref
      !== `${commitment.chain_id.split(":")[1]}:${commitment.simulation_observed_at_height}`
    || BigInt(commitment.account_observed_at_height)
      < BigInt(commitment.activation_observed_at_height)
    || BigInt(commitment.simulation_observed_at_height)
      < BigInt(commitment.activation_observed_at_height)
    || (commitment.account_observed_at_height === commitment.activation_observed_at_height
      && commitment.account_block_hash !== commitment.activation_block_hash)
    || (commitment.simulation_observed_at_height === commitment.activation_observed_at_height
      && commitment.simulation_block_hash !== commitment.activation_block_hash)
    || (commitment.simulation_observed_at_height === commitment.account_observed_at_height
      && commitment.simulation_block_hash !== commitment.account_block_hash)
  ) {
    fail("integrity_error", "Economy commitment trust assertions do not match their exact fields");
  }
  const { commitment_id: suppliedId, ...core } = commitment;
  if (economyCommitmentId(core) !== suppliedId) {
    fail("integrity_error", "Economy commitment ID does not match its canonical core");
  }
  return Object.freeze({ ...commitment });
}

function assertNotBefore(at: string, floor: string, label: string): void {
  if (Date.parse(at) < Date.parse(floor)) {
    fail("evidence_rejected", `${label} moves durable chronology backwards`);
  }
}

function eventString(
  details: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string {
  const value = details[key];
  if (typeof value !== "string") fail("integrity_error", `${label}.${key} must be a string`);
  return value;
}

function eventBoolean(
  details: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): boolean {
  const value = details[key];
  if (typeof value !== "boolean") fail("integrity_error", `${label}.${key} must be a boolean`);
  return value;
}

function eventSafeCount(
  details: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): number {
  const value = details[key];
  assertCount(value, `${label}.${key}`);
  return value;
}

function assertEventShape(
  details: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(details).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("integrity_error", `${label} has an unexpected durable field set`);
  }
}

function eventNullableString(
  details: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string | null {
  const value = details[key];
  if (value !== null && typeof value !== "string") {
    fail("integrity_error", `${label}.${key} must be a string or null`);
  }
  return value;
}

function requireEventBoolean(
  details: Readonly<Record<string, unknown>>,
  key: string,
  expected: boolean,
  label: string,
): void {
  if (eventBoolean(details, key, label) !== expected) {
    fail("integrity_error", `${label}.${key} has an unsafe value`);
  }
}

function sameCapabilityBudget(row: CapabilityUsageRow, budget: CapabilityBudget): boolean {
  return row.descriptor_id === budget.descriptor_id
    && row.policy_hash === budget.policy_hash
    && row.revocation_nonce === budget.revocation_nonce
    && row.max_intents === budget.max_intents
    && row.max_spend_uzrn === budget.max_spend_uzrn
    && row.max_fee_per_intent_uzrn === budget.max_fee_per_intent_uzrn;
}

function currentnessMatchesBinding(
  currentness: BindingCurrentnessAssertion,
  binding: WalletIdentityBinding,
  proof: VerifiedWalletIdentityBindingProof,
): boolean {
  return currentness.binding_id === binding.binding_id
    && currentness.proof_id === proof.proof_id
    && currentness.owner_identity_id === binding.owner_identity_id
    && currentness.wallet_id === binding.wallet_id
    && currentness.wallet_descriptor_id === binding.wallet_descriptor_id
    && canonicalJson(currentness.identity_authority)
      === canonicalJson(binding.identity_authority)
    && currentness.binding_revision === binding.revision
    && currentness.wallet_continuity_sequence === binding.wallet_continuity_sequence;
}

export class ZeroneAgentHostStore {
  private readonly db: Database;
  private readonly files: SecureSqliteFiles;
  private readonly recoverOnInitialize: boolean;
  private readonly allowLegacyGenericInjectedForTests: boolean;
  private readonly now: () => string;
  private readonly resolveBindingCurrentness:
    BindingCurrentnessResolver["resolveCurrentness"] | null;
  private readonly resolveActivationCurrentness:
    ZeroneEconomyActivationCurrentnessResolver["resolveCurrentness"] | null;
  private readonly observeEconomyAccount: ZeroneStateObserver["observeAccount"] | null;
  private readonly trustedBindingCurrentnessVerifiers:
    ReadonlyMap<string, TrustedBindingCurrentnessVerifierAssertion>;
  private readonly trustedSimulationAdapters: ReadonlyMap<string, TrustedSimulationAdapterAssertion>;
  private readonly trustedActivationVerifierIds: ReadonlySet<string>;

  constructor(path: string, options: ZeroneAgentHostStoreOptions) {
    if (path === ":memory:" && options.allow_in_memory_for_tests !== true) {
      fail(
        "file_error",
        "In-memory host ledgers are non-durable and require allow_in_memory_for_tests: true",
      );
    }
    this.files = new SecureSqliteFiles(path, options.create);
    const databasePath = this.files.path ?? ":memory:";
    this.db = new Database(databasePath, { create: options.create, strict: true });
    this.recoverOnInitialize = options.recover_interrupted ?? true;
    this.allowLegacyGenericInjectedForTests =
      options.allow_legacy_generic_injected_for_tests === true;
    this.now = options.now ?? (() => new Date().toISOString());
    const bindingResolver = options.binding_currentness_resolver ?? null;
    const activationResolver = options.activation_currentness_resolver ?? null;
    const accountObserver = options.account_observer ?? null;
    if (bindingResolver !== null && typeof bindingResolver.resolveCurrentness !== "function") {
      fail("invalid_input", "binding_currentness_resolver does not implement resolveCurrentness");
    }
    if (activationResolver !== null && typeof activationResolver.resolveCurrentness !== "function") {
      fail("invalid_input", "activation_currentness_resolver does not implement resolveCurrentness");
    }
    if (accountObserver !== null && typeof accountObserver.observeAccount !== "function") {
      fail("invalid_input", "account_observer does not implement observeAccount");
    }
    this.resolveBindingCurrentness = bindingResolver === null
      ? null
      : bindingResolver.resolveCurrentness.bind(bindingResolver);
    this.resolveActivationCurrentness = activationResolver === null
      ? null
      : activationResolver.resolveCurrentness.bind(activationResolver);
    this.observeEconomyAccount = accountObserver === null
      ? null
      : accountObserver.observeAccount.bind(accountObserver);
    if (
      options.trusted_binding_currentness_verifiers !== undefined
      && !Array.isArray(options.trusted_binding_currentness_verifiers)
    ) {
      fail("invalid_input", "trusted_binding_currentness_verifiers must be an array");
    }
    const bindingVerifierEntries = (options.trusted_binding_currentness_verifiers ?? [])
      .map((entry) => validateTrustedBindingCurrentnessVerifierAssertion(entry));
    const bindingVerifiers = new Map<string, TrustedBindingCurrentnessVerifierAssertion>();
    for (const entry of bindingVerifierEntries) {
      if (bindingVerifiers.has(entry.trust_id)) {
        fail("invalid_input", "Binding currentness verifier trust IDs must be unique");
      }
      bindingVerifiers.set(entry.trust_id, entry);
    }
    this.trustedBindingCurrentnessVerifiers = bindingVerifiers;
    if (
      options.trusted_simulation_adapters !== undefined
      && !Array.isArray(options.trusted_simulation_adapters)
    ) {
      fail("invalid_input", "trusted_simulation_adapters must be an array");
    }
    const adapterEntries = (options.trusted_simulation_adapters ?? [])
      .map((entry) => validateTrustedSimulationAdapterAssertion(entry));
    const adapters = new Map<string, TrustedSimulationAdapterAssertion>();
    for (const entry of adapterEntries) {
      if (adapters.has(entry.trust_id)) {
        fail("invalid_input", "Simulation adapter trust IDs must be unique");
      }
      adapters.set(entry.trust_id, entry);
    }
    this.trustedSimulationAdapters = adapters;
    if (
      options.trusted_activation_verifier_ids !== undefined
      && !Array.isArray(options.trusted_activation_verifier_ids)
    ) {
      fail("invalid_input", "trusted_activation_verifier_ids must be an array");
    }
    const verifierIds = new Set<string>();
    for (const verifierId of options.trusted_activation_verifier_ids ?? []) {
      assertIdentifier(verifierId, "trusted_activation_verifier_id");
      if (verifierIds.has(verifierId)) {
        fail("invalid_input", "Activation verifier allowlist entries must be unique");
      }
      verifierIds.add(verifierId);
    }
    this.trustedActivationVerifierIds = verifierIds;
    this.configure();
  }

  private configure(): void {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    if (this.db.filename !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.files.tighten();
  }

  initialize(): void {
    const initialVersion = (this.db.query("PRAGMA user_version").get() as {
      user_version: number;
    } | null)?.user_version;
    const initialApplicationObjects = this.db.query(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
    `).get() as { count: number } | null;
    if (
      initialVersion !== 0
      && initialVersion !== SQLITE_SCHEMA_VERSION
    ) {
      fail("integrity_error", "Refusing to relabel an unknown host-ledger schema version");
    }
    if (initialVersion === 0 && (initialApplicationObjects?.count ?? 0) !== 0) {
      fail("integrity_error", "Unversioned database already contains application objects");
    }
    const statuses = OPERATION_STATUSES.map((status) => `'${status}'`).join(", ");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS binding_history (
        currentness_id TEXT PRIMARY KEY,
        proof_id TEXT NOT NULL,
        wallet_id TEXT NOT NULL,
        head_version INTEGER NOT NULL CHECK(head_version >= 1),
        binding_id TEXT NOT NULL,
        source_account TEXT NOT NULL,
        proof_envelope_json TEXT NOT NULL,
        currentness_json TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        UNIQUE(wallet_id, head_version)
      );
      CREATE TABLE IF NOT EXISTS binding_heads (
        wallet_id TEXT PRIMARY KEY,
        head_version INTEGER NOT NULL CHECK(head_version >= 1),
        binding_id TEXT NOT NULL UNIQUE,
        proof_id TEXT NOT NULL,
        currentness_id TEXT NOT NULL REFERENCES binding_history(currentness_id),
        binding_revision INTEGER NOT NULL CHECK(binding_revision >= 1),
        continuity_sequence INTEGER NOT NULL CHECK(continuity_sequence >= 0),
        revocation_nonce INTEGER NOT NULL CHECK(revocation_nonce >= 0),
        descriptor_id TEXT NOT NULL,
        signer_key_id TEXT NOT NULL,
        source_account TEXT NOT NULL UNIQUE,
        network TEXT NOT NULL CHECK(network IN ('mainnet', 'testnet')),
        proof_envelope_json TEXT NOT NULL,
        currentness_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS capability_usage (
        capability_record_id TEXT PRIMARY KEY,
        wallet_id TEXT NOT NULL REFERENCES binding_heads(wallet_id),
        descriptor_id TEXT NOT NULL,
        policy_hash TEXT NOT NULL,
        revocation_nonce INTEGER NOT NULL CHECK(revocation_nonce >= 0),
        max_intents INTEGER NOT NULL CHECK(max_intents >= 1),
        max_spend_uzrn TEXT NOT NULL,
        max_fee_per_intent_uzrn TEXT NOT NULL,
        reserved_intents INTEGER NOT NULL CHECK(reserved_intents >= 0),
        consumed_intents INTEGER NOT NULL CHECK(consumed_intents >= 0),
        reserved_spend_uzrn TEXT NOT NULL,
        consumed_spend_uzrn TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version >= 1),
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS account_states (
        chain_id TEXT NOT NULL,
        source_account TEXT NOT NULL,
        account_number TEXT NOT NULL,
        sequence TEXT NOT NULL,
        balance_uzrn TEXT NOT NULL,
        observed_at_height TEXT NOT NULL,
        block_hash TEXT NOT NULL,
        public_key_type_url TEXT,
        public_key_b64u TEXT,
        valid_until TEXT NOT NULL,
        halted INTEGER NOT NULL CHECK(halted IN (0, 1)),
        halted_at_height TEXT,
        halt_evidence_id TEXT,
        halted_at TEXT,
        revision INTEGER NOT NULL CHECK(revision >= 1),
        observed_at TEXT NOT NULL,
        PRIMARY KEY(chain_id, source_account),
        CHECK(
          (public_key_type_url IS NULL AND public_key_b64u IS NULL)
          OR (
            public_key_type_url = '/cosmos.crypto.secp256k1.PubKey'
            AND public_key_b64u IS NOT NULL
          )
        )
      );
      CREATE TABLE IF NOT EXISTS operations (
        operation_id TEXT PRIMARY KEY,
        operation_kind TEXT NOT NULL CHECK(operation_kind IN ('generic_injected', 'zerone_economy')),
        revision INTEGER NOT NULL CHECK(revision >= 1),
        status TEXT NOT NULL CHECK(status IN (${statuses})),
        wallet_id TEXT NOT NULL REFERENCES binding_heads(wallet_id),
        binding_id TEXT NOT NULL,
        proof_id TEXT NOT NULL,
        currentness_id TEXT NOT NULL REFERENCES binding_history(currentness_id),
        binding_head_version INTEGER NOT NULL,
        descriptor_id TEXT NOT NULL,
        capability_record_id TEXT NOT NULL REFERENCES capability_usage(capability_record_id),
        capability_revocation_nonce INTEGER NOT NULL,
        authorization_verification_id TEXT NOT NULL UNIQUE,
        intent_record_id TEXT NOT NULL UNIQUE,
        simulation_record_id TEXT NOT NULL,
        plan_reference_id TEXT NOT NULL,
        treasury_policy_id TEXT NOT NULL,
        treasury_policy_json TEXT NOT NULL,
        window_start_height TEXT NOT NULL,
        reserve_floor_uzrn TEXT NOT NULL,
        chain_id TEXT NOT NULL,
        source_account TEXT NOT NULL,
        account_number TEXT NOT NULL,
        sequence TEXT NOT NULL,
        signer_key_id TEXT NOT NULL,
        signer_invoked INTEGER NOT NULL CHECK(signer_invoked IN (0, 1)),
        request_id TEXT UNIQUE,
        unsigned_payload_hash TEXT,
        signing_boundary_verification_id TEXT,
        tx_hash TEXT UNIQUE,
        signed_payload_hash TEXT,
        signed_verification_id TEXT,
        inclusion_height TEXT,
        inclusion_block_hash TEXT,
        inclusion_code INTEGER,
        inclusion_codespace TEXT,
        unresolved_reorg_event_sequence INTEGER,
        unresolved_reorg_evidence_id TEXT,
        event_count INTEGER NOT NULL CHECK(event_count >= 0),
        event_head_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(
          (unresolved_reorg_event_sequence IS NULL AND unresolved_reorg_evidence_id IS NULL)
          OR (
            unresolved_reorg_event_sequence >= 1
            AND unresolved_reorg_evidence_id IS NOT NULL
          )
        )
      );
      CREATE TABLE IF NOT EXISTS economy_operation_commitments (
        operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id),
        commitment_id TEXT NOT NULL UNIQUE,
        plan_id TEXT NOT NULL UNIQUE,
        plan_content_id TEXT NOT NULL UNIQUE,
        message_kind TEXT NOT NULL CHECK(message_kind IN ('create_bounty', 'submit_claim', 'fulfill_bounty')),
        message_type_url TEXT NOT NULL,
        intent_record_id TEXT NOT NULL,
        simulation_evidence_record_id TEXT NOT NULL UNIQUE,
        simulation_evidence_json TEXT NOT NULL,
        binding_currentness_id TEXT NOT NULL,
        binding_verifier_trust_id TEXT NOT NULL,
        sign_doc_bytes_hash TEXT NOT NULL UNIQUE,
        activation_currentness_id TEXT NOT NULL,
        request_id TEXT NOT NULL UNIQUE,
        requested_at TEXT NOT NULL,
        commitment_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS economy_signed_transactions (
        operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id),
        content_id TEXT NOT NULL UNIQUE,
        plan_id TEXT NOT NULL UNIQUE,
        plan_content_id TEXT NOT NULL UNIQUE,
        intent_record_id TEXT NOT NULL UNIQUE,
        request_id TEXT NOT NULL UNIQUE,
        signer_key_id TEXT NOT NULL,
        sign_doc_bytes_hash TEXT NOT NULL UNIQUE,
        tx_bytes_hash TEXT NOT NULL UNIQUE,
        tx_hash TEXT NOT NULL UNIQUE,
        admitted_at TEXT NOT NULL,
        record_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS treasury_reservations (
        operation_id TEXT NOT NULL REFERENCES operations(operation_id),
        purpose TEXT NOT NULL CHECK(purpose IN ('compute', 'knowledge_bond', 'network_fee', 'sponsorship_escrow', 'storage')),
        amount_uzrn TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('reserved', 'sticky', 'settled', 'released')),
        PRIMARY KEY(operation_id, purpose)
      );
      CREATE TABLE IF NOT EXISTS sequence_fences (
        operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id),
        chain_id TEXT NOT NULL,
        source_account TEXT NOT NULL,
        account_number TEXT NOT NULL,
        sequence TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('held', 'released')),
        acquired_at TEXT NOT NULL,
        released_at TEXT,
        release_evidence_id TEXT
      );
      CREATE TABLE IF NOT EXISTS operation_events (
        ledger_sequence INTEGER PRIMARY KEY,
        operation_id TEXT NOT NULL REFERENCES operations(operation_id),
        sequence INTEGER NOT NULL CHECK(sequence >= 1),
        kind TEXT NOT NULL,
        at TEXT NOT NULL,
        details_json TEXT NOT NULL,
        previous_event_hash TEXT NOT NULL,
        event_hash TEXT NOT NULL UNIQUE,
        UNIQUE(operation_id, sequence)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS sequence_fences_one_held_account_idx
        ON sequence_fences(chain_id, source_account) WHERE state = 'held';
      CREATE INDEX IF NOT EXISTS operations_capability_idx
        ON operations(capability_record_id, created_at);
      CREATE INDEX IF NOT EXISTS binding_history_source_account_idx
        ON binding_history(source_account);
      CREATE INDEX IF NOT EXISTS operations_treasury_window_idx
        ON operations(chain_id, source_account, window_start_height);
      CREATE INDEX IF NOT EXISTS treasury_reservations_state_idx
        ON treasury_reservations(state, operation_id);
      CREATE TRIGGER IF NOT EXISTS operation_events_no_update
        BEFORE UPDATE ON operation_events
        BEGIN SELECT RAISE(ABORT, 'operation events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS operation_events_no_delete
        BEFORE DELETE ON operation_events
        BEGIN SELECT RAISE(ABORT, 'operation events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS binding_history_no_update
        BEFORE UPDATE ON binding_history
        BEGIN SELECT RAISE(ABORT, 'binding history is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS binding_history_no_delete
        BEFORE DELETE ON binding_history
        BEGIN SELECT RAISE(ABORT, 'binding history is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS binding_heads_no_delete
        BEFORE DELETE ON binding_heads
        BEGIN SELECT RAISE(ABORT, 'binding heads cannot be deleted'); END;
      CREATE TRIGGER IF NOT EXISTS economy_operation_commitments_no_update
        BEFORE UPDATE ON economy_operation_commitments
        BEGIN SELECT RAISE(ABORT, 'economy commitments are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS economy_operation_commitments_no_delete
        BEFORE DELETE ON economy_operation_commitments
        BEGIN SELECT RAISE(ABORT, 'economy commitments are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS economy_signed_transactions_no_update
        BEFORE UPDATE ON economy_signed_transactions
        BEGIN SELECT RAISE(ABORT, 'economy signed transactions are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS economy_signed_transactions_no_delete
        BEFORE DELETE ON economy_signed_transactions
        BEGIN SELECT RAISE(ABORT, 'economy signed transactions are append-only'); END;
    `);
    if (initialVersion === 0) this.db.exec(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION}`);
    this.assertSchema();
    this.verify();
    if (this.recoverOnInitialize) {
      this.recoverInterruptedOperations(this.now());
      this.verify();
    }
    this.files.tighten();
  }

  private assertSchema(): void {
    const version = this.db.query("PRAGMA user_version").get() as { user_version: number } | null;
    const foreignKeys = this.db.query("PRAGMA foreign_keys").get() as { foreign_keys: number } | null;
    if (version?.user_version !== SQLITE_SCHEMA_VERSION || foreignKeys?.foreign_keys !== 1) {
      fail("integrity_error", "SQLite schema version or foreign-key enforcement is invalid");
    }
    if (this.db.filename !== ":memory:") {
      const journal = this.db.query("PRAGMA journal_mode").get() as { journal_mode: string } | null;
      if (journal?.journal_mode.toLowerCase() !== "wal") {
        fail("integrity_error", "File-backed host ledger must use WAL journal mode");
      }
    }
    const tables = this.db.query(`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name: keyof typeof TABLE_COLUMNS; sql: string | null }>;
    const expectedNames = Object.keys(TABLE_COLUMNS).sort();
    if (tables.map(({ name }) => name).join("\0") !== expectedNames.join("\0")) {
      fail("integrity_error", "Host ledger application-table set is not the v4 schema");
    }
    for (const { name, sql } of tables) {
      if (normalizeSql(sql) !== TABLE_SQL[name]) {
        fail("integrity_error", `Host ledger ${name} CREATE TABLE SQL is not the v4 schema`);
      }
      const columns = this.db.query(`PRAGMA table_info(${name})`).all() as TableInfoRow[];
      const signature = columns
        .map(({ name: column, type, notnull, pk }) => `${column}:${type}:${notnull}:${pk}`)
        .join("|");
      if (
        columns.map(({ name: column }) => column).join("\0") !== TABLE_COLUMNS[name].join("\0")
        || signature !== TABLE_SIGNATURES[name]
      ) {
        fail("integrity_error", `Host ledger ${name} columns are not the v4 schema`);
      }
      const indexes = (this.db.query(`PRAGMA index_list(${name})`).all() as IndexListRow[])
        .map((index) => {
          const indexColumns = this.db.query(
            "SELECT name FROM pragma_index_info(?) ORDER BY seqno",
          ).all(index.name) as Array<{ name: string }>;
          return `${index.unique}:${index.origin}:${index.partial}:${indexColumns
            .map(({ name: column }) => column).join(",")}`;
        })
        .sort();
      if (indexes.join("|") !== [...INDEX_SIGNATURES[name]].sort().join("|")) {
        fail("integrity_error", `Host ledger ${name} indexes are not the v4 schema`);
      }
      const foreignKeys = (this.db.query(`PRAGMA foreign_key_list(${name})`).all() as Array<{
        table: string;
        from: string;
        to: string;
        on_update: string;
        on_delete: string;
        match: string;
      }>).map((foreignKey) =>
        `${foreignKey.from}->${foreignKey.table}.${foreignKey.to}:${foreignKey.on_update}:${foreignKey.on_delete}:${foreignKey.match}`)
        .sort();
      if (foreignKeys.join("|") !== [...FOREIGN_KEY_SIGNATURES[name]].sort().join("|")) {
        fail("integrity_error", `Host ledger ${name} foreign keys are not the v4 schema`);
      }
    }
    const requiredObjects = [
      "operation_events_no_delete",
      "operation_events_no_update",
      "binding_history_no_delete",
      "binding_history_no_update",
      "binding_history_source_account_idx",
      "binding_heads_no_delete",
      "economy_operation_commitments_no_delete",
      "economy_operation_commitments_no_update",
      "economy_signed_transactions_no_delete",
      "economy_signed_transactions_no_update",
      "operations_capability_idx",
      "operations_treasury_window_idx",
      "sequence_fences_one_held_account_idx",
      "treasury_reservations_state_idx",
    ];
    const objects = this.db.query(`
      SELECT name FROM sqlite_master
      WHERE type IN ('index', 'trigger') AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;
    const present = new Set(objects.map(({ name }) => name));
    if (requiredObjects.some((name) => !present.has(name))) {
      fail("integrity_error", "Host ledger indexes or append-only triggers are incomplete");
    }
    const expectedTriggers = new Map<string, string>([
      [
        "binding_heads_no_delete",
        "create trigger binding_heads_no_delete before delete on binding_heads begin select raise(abort, 'binding heads cannot be deleted'); end",
      ],
      [
        "binding_history_no_delete",
        "create trigger binding_history_no_delete before delete on binding_history begin select raise(abort, 'binding history is append-only'); end",
      ],
      [
        "binding_history_no_update",
        "create trigger binding_history_no_update before update on binding_history begin select raise(abort, 'binding history is append-only'); end",
      ],
      [
        "economy_operation_commitments_no_delete",
        "create trigger economy_operation_commitments_no_delete before delete on economy_operation_commitments begin select raise(abort, 'economy commitments are append-only'); end",
      ],
      [
        "economy_operation_commitments_no_update",
        "create trigger economy_operation_commitments_no_update before update on economy_operation_commitments begin select raise(abort, 'economy commitments are append-only'); end",
      ],
      [
        "economy_signed_transactions_no_delete",
        "create trigger economy_signed_transactions_no_delete before delete on economy_signed_transactions begin select raise(abort, 'economy signed transactions are append-only'); end",
      ],
      [
        "economy_signed_transactions_no_update",
        "create trigger economy_signed_transactions_no_update before update on economy_signed_transactions begin select raise(abort, 'economy signed transactions are append-only'); end",
      ],
      [
        "operation_events_no_delete",
        "create trigger operation_events_no_delete before delete on operation_events begin select raise(abort, 'operation events are append-only'); end",
      ],
      [
        "operation_events_no_update",
        "create trigger operation_events_no_update before update on operation_events begin select raise(abort, 'operation events are append-only'); end",
      ],
    ]);
    const triggers = this.db.query(`
      SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name
    `).all() as Array<{ name: string; sql: string | null }>;
    if (
      triggers.length !== expectedTriggers.size
      || triggers.some(({ name, sql }) => normalizeSql(sql) !== expectedTriggers.get(name))
    ) {
      fail("integrity_error", "Application append-only triggers are not the v4 schema");
    }
    const expectedIndexes = new Map<string, string>([
      [
        "binding_history_source_account_idx",
        "create index binding_history_source_account_idx on binding_history(source_account)",
      ],
      [
        "operations_capability_idx",
        "create index operations_capability_idx on operations(capability_record_id, created_at)",
      ],
      [
        "operations_treasury_window_idx",
        "create index operations_treasury_window_idx on operations(chain_id, source_account, window_start_height)",
      ],
      [
        "sequence_fences_one_held_account_idx",
        "create unique index sequence_fences_one_held_account_idx on sequence_fences(chain_id, source_account) where state = 'held'",
      ],
      [
        "treasury_reservations_state_idx",
        "create index treasury_reservations_state_idx on treasury_reservations(state, operation_id)",
      ],
    ]);
    const applicationIndexes = this.db.query(`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name: string; sql: string | null }>;
    if (
      applicationIndexes.length !== expectedIndexes.size
      || applicationIndexes.some(({ name, sql }) => normalizeSql(sql) !== expectedIndexes.get(name))
    ) {
      fail("integrity_error", "Application index definitions are not the v4 schema");
    }
  }

  private putBindingHeadInTransaction(
    proof: VerifiedWalletIdentityBindingProof,
    currentness: BindingCurrentnessAssertion,
    expected: BindingHeadExpectation | null,
    updatedAt: string,
  ): BindingHead {
    const binding = proof.binding;
    const historicalAccountOwner = this.db.query(`
      SELECT wallet_id FROM binding_history WHERE source_account = ? LIMIT 1
    `).get(binding.zerone_account_id) as { wallet_id: string } | null;
    if (
      historicalAccountOwner !== null
      && historicalAccountOwner.wallet_id !== binding.wallet_id
    ) {
      fail(
        "authorization_denied",
        "A Zerone source account remains permanently bound to its first wallet ID in this ledger",
      );
    }
    const existing = this.bindingRow(binding.wallet_id);
    if (existing === null) {
      if (expected !== null) {
        fail("conflict", "Binding head was absent; a non-null expectation cannot initialize it");
      }
      if (binding.revision !== 1 || binding.previous_binding_id !== null) {
        fail("conflict", "A new binding head must start at revision 1");
      }
      this.insertBindingHistory(proof, currentness, 1, updatedAt);
      this.db.query(`
        INSERT INTO binding_heads (
          wallet_id, head_version, binding_id, proof_id, currentness_id, binding_revision,
          continuity_sequence, revocation_nonce, descriptor_id, signer_key_id,
          source_account, network, proof_envelope_json, currentness_json, updated_at
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        binding.wallet_id,
        binding.binding_id,
        proof.proof_id,
        currentness.currentness_id,
        binding.revision,
        binding.wallet_continuity_sequence,
        currentness.wallet_revocation_nonce,
        binding.wallet_descriptor_id,
        binding.zerone_signer.key_id,
        binding.zerone_account_id,
        binding.network,
        canonicalJson(proof),
        canonicalJson(currentness),
        updatedAt,
      );
      return this.getBindingHeadOrFail(binding.wallet_id);
    }
    this.assertBindingExpectation(existing, expected);
    assertNotBefore(updatedAt, existing.updated_at, "Binding-head update");
    assertNotBefore(currentness.verified_at, existing.updated_at, "Binding proof observation");
    const latestOperation = this.db.query(`
      SELECT updated_at FROM operations WHERE wallet_id = ?
      ORDER BY updated_at DESC, operation_id DESC LIMIT 1
    `).get(binding.wallet_id) as { updated_at: string } | null;
    if (
      latestOperation !== null
      && Date.parse(updatedAt) <= Date.parse(latestOperation.updated_at)
    ) {
      fail(
        "conflict",
        "Binding-head updates must be strictly later than existing wallet operation history",
      );
    }
    const previousProof = verifyWalletIdentityBindingProofEnvelope(
      JSON.parse(existing.proof_envelope_json),
    );
    const previous = previousProof.binding;
    if (binding.binding_id === previous.binding_id) {
      if (canonicalJson(binding) !== canonicalJson(previous)) {
        fail("conflict", "Current binding ID was supplied with different canonical bytes");
      }
      if (
        proof.proof_id === existing.proof_id
        && canonicalJson(proof) !== existing.proof_envelope_json
      ) {
        fail("conflict", "Current proof ID was supplied with different canonical bytes");
      }
    } else {
      assertNotBefore(binding.issued_at, existing.updated_at, "Binding successor issued_at");
      assertWalletIdentityBindingSuccessor(previous, binding);
    }
    if (currentness.currentness_id === existing.currentness_id) {
      fail("conflict", "Binding currentness refresh must name a new content-addressed assertion");
    }
    if (currentness.wallet_revocation_nonce < existing.revocation_nonce) {
      fail("conflict", "Wallet revocation nonce cannot move backwards");
    }
    const nextVersion = existing.head_version + 1;
    this.insertBindingHistory(proof, currentness, nextVersion, updatedAt);
    const result = this.db.query(`
      UPDATE binding_heads SET
        head_version = ?, binding_id = ?, proof_id = ?, currentness_id = ?, binding_revision = ?,
        continuity_sequence = ?, revocation_nonce = ?, descriptor_id = ?,
        signer_key_id = ?, source_account = ?, network = ?, proof_envelope_json = ?,
        currentness_json = ?, updated_at = ?
      WHERE wallet_id = ? AND head_version = ? AND binding_id = ? AND proof_id = ?
        AND currentness_id = ?
    `).run(
      nextVersion,
      binding.binding_id,
      proof.proof_id,
      currentness.currentness_id,
      binding.revision,
      binding.wallet_continuity_sequence,
      currentness.wallet_revocation_nonce,
      binding.wallet_descriptor_id,
      binding.zerone_signer.key_id,
      binding.zerone_account_id,
      binding.network,
      canonicalJson(proof),
      canonicalJson(currentness),
      updatedAt,
      existing.wallet_id,
      existing.head_version,
      existing.binding_id,
      existing.proof_id,
      existing.currentness_id,
    );
    if (result.changes !== 1) fail("conflict", "Binding-head compare-and-swap lost its race");
    return this.getBindingHeadOrFail(binding.wallet_id);
  }

  putBindingHead(
    proofEnvelopeValue: WalletIdentityBindingProofEnvelope,
    currentnessValue: BindingCurrentnessAssertion,
    options: {
      readonly expected: BindingHeadExpectation | null;
      readonly updated_at: string;
    },
  ): BindingHead {
    const proof = verifyWalletIdentityBindingProofEnvelope(proofEnvelopeValue);
    const binding = proof.binding;
    const currentness = validateBindingCurrentnessAssertion(currentnessValue);
    assertTimestamp(options.updated_at, "updated_at");
    if (
      !currentnessMatchesBinding(currentness, binding, proof)
    ) {
      fail("authorization_denied", "Currentness assertion does not name the verified binding proof");
    }
    if (Date.parse(currentness.verified_at) < Date.parse(binding.issued_at)) {
      fail("authorization_denied", "Binding proof currentness predates the binding candidate");
    }
    assertNotBefore(options.updated_at, currentness.verified_at, "Binding-head update");
    if (Date.parse(options.updated_at) >= Date.parse(currentness.valid_until)) {
      fail("authorization_denied", "Binding currentness is expired at the durable head update");
    }
    this.files.tighten();
    this.verify();
    const apply = this.db.transaction((): BindingHead => {
      const historicalAccountOwner = this.db.query(`
        SELECT wallet_id FROM binding_history WHERE source_account = ? LIMIT 1
      `).get(binding.zerone_account_id) as { wallet_id: string } | null;
      if (
        historicalAccountOwner !== null
        && historicalAccountOwner.wallet_id !== binding.wallet_id
      ) {
        fail(
          "authorization_denied",
          "A Zerone source account remains permanently bound to its first wallet ID in this ledger",
        );
      }
      const existing = this.bindingRow(binding.wallet_id);
      if (existing === null) {
        if (options.expected !== null) {
          fail("conflict", "Binding head was absent; a non-null expectation cannot initialize it");
        }
        if (binding.revision !== 1 || binding.previous_binding_id !== null) {
          fail("conflict", "A new binding head must start at revision 1");
        }
        this.insertBindingHistory(proof, currentness, 1, options.updated_at);
        this.db.query(`
          INSERT INTO binding_heads (
            wallet_id, head_version, binding_id, proof_id, currentness_id, binding_revision,
            continuity_sequence, revocation_nonce, descriptor_id, signer_key_id,
            source_account, network, proof_envelope_json, currentness_json, updated_at
          ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          binding.wallet_id,
          binding.binding_id,
          proof.proof_id,
          currentness.currentness_id,
          binding.revision,
          binding.wallet_continuity_sequence,
          currentness.wallet_revocation_nonce,
          binding.wallet_descriptor_id,
          binding.zerone_signer.key_id,
          binding.zerone_account_id,
          binding.network,
          canonicalJson(proof),
          canonicalJson(currentness),
          options.updated_at,
        );
        return this.getBindingHeadOrFail(binding.wallet_id);
      }
      this.assertBindingExpectation(existing, options.expected);
      assertNotBefore(options.updated_at, existing.updated_at, "Binding-head update");
      assertNotBefore(currentness.verified_at, existing.updated_at, "Binding proof observation");
      const latestOperation = this.db.query(`
        SELECT updated_at FROM operations WHERE wallet_id = ?
        ORDER BY updated_at DESC, operation_id DESC LIMIT 1
      `).get(binding.wallet_id) as { updated_at: string } | null;
      if (
        latestOperation !== null
        && Date.parse(options.updated_at) <= Date.parse(latestOperation.updated_at)
      ) {
        fail(
          "conflict",
          "Binding-head updates must be strictly later than existing wallet operation history",
        );
      }
      const previousProof = verifyWalletIdentityBindingProofEnvelope(
        JSON.parse(existing.proof_envelope_json),
      );
      const previous = previousProof.binding;
      if (binding.binding_id === previous.binding_id) {
        if (canonicalJson(binding) !== canonicalJson(previous)) {
          fail("conflict", "Current binding ID was supplied with different canonical bytes");
        }
        if (
          proof.proof_id === existing.proof_id
          && canonicalJson(proof) !== existing.proof_envelope_json
        ) {
          fail("conflict", "Current proof ID was supplied with different canonical bytes");
        }
      } else {
        assertNotBefore(binding.issued_at, existing.updated_at, "Binding successor issued_at");
        assertWalletIdentityBindingSuccessor(previous, binding);
      }
      if (currentness.currentness_id === existing.currentness_id) {
        fail("conflict", "Binding currentness refresh must name a new content-addressed assertion");
      }
      if (currentness.wallet_revocation_nonce < existing.revocation_nonce) {
        fail("conflict", "Wallet revocation nonce cannot move backwards");
      }
      const nextVersion = existing.head_version + 1;
      this.insertBindingHistory(proof, currentness, nextVersion, options.updated_at);
      const result = this.db.query(`
        UPDATE binding_heads SET
          head_version = ?, binding_id = ?, proof_id = ?, currentness_id = ?, binding_revision = ?,
          continuity_sequence = ?, revocation_nonce = ?, descriptor_id = ?,
          signer_key_id = ?, source_account = ?, network = ?, proof_envelope_json = ?,
          currentness_json = ?, updated_at = ?
        WHERE wallet_id = ? AND head_version = ? AND binding_id = ? AND proof_id = ?
          AND currentness_id = ?
      `).run(
        nextVersion,
        binding.binding_id,
        proof.proof_id,
        currentness.currentness_id,
        binding.revision,
        binding.wallet_continuity_sequence,
        currentness.wallet_revocation_nonce,
        binding.wallet_descriptor_id,
        binding.zerone_signer.key_id,
        binding.zerone_account_id,
        binding.network,
        canonicalJson(proof),
        canonicalJson(currentness),
        options.updated_at,
        existing.wallet_id,
        existing.head_version,
        existing.binding_id,
        existing.proof_id,
        existing.currentness_id,
      );
      if (result.changes !== 1) fail("conflict", "Binding-head compare-and-swap lost its race");
      return this.getBindingHeadOrFail(binding.wallet_id);
    });
    try {
      const result = apply.immediate();
      this.files.tighten();
      return result;
    } catch (error) {
      if (error instanceof ZeroneAgentHostError) throw error;
      if (error instanceof Error && /UNIQUE constraint failed/u.test(error.message)) {
        fail("conflict", "Binding identity, currentness, version, or source account is already consumed");
      }
      throw error;
    }
  }

  getBindingHead(walletId: string): BindingHead | null {
    assertIdentifier(walletId, "wallet_id");
    const row = this.bindingRow(walletId);
    return row === null ? null : this.bindingRowToHead(row);
  }

  private getBindingHeadOrFail(walletId: string): BindingHead {
    const row = this.bindingRow(walletId);
    if (row === null) fail("not_found", "Binding head was not found");
    return this.bindingRowToHead(row);
  }

  private bindingRow(walletId: string): BindingHeadRow | null {
    return this.db.query("SELECT * FROM binding_heads WHERE wallet_id = ?").get(walletId) as BindingHeadRow | null;
  }

  private bindingHistoryAt(walletId: string, at: string): BindingHistoryRow | null {
    return this.db.query(`
      SELECT currentness_id, proof_id, wallet_id, head_version, binding_id,
        source_account, proof_envelope_json, currentness_json, recorded_at
      FROM binding_history
      WHERE wallet_id = ? AND recorded_at <= ?
      ORDER BY recorded_at DESC, head_version DESC LIMIT 1
    `).get(walletId, at) as BindingHistoryRow | null;
  }

  private insertBindingHistory(
    proof: VerifiedWalletIdentityBindingProof,
    currentness: BindingCurrentnessAssertion,
    headVersion: number,
    recordedAt: string,
  ): void {
    this.db.query(`
      INSERT INTO binding_history (
        currentness_id, proof_id, wallet_id, head_version, binding_id,
        source_account, proof_envelope_json, currentness_json, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      currentness.currentness_id,
      proof.proof_id,
      proof.binding.wallet_id,
      headVersion,
      proof.binding.binding_id,
      proof.binding.zerone_account_id,
      canonicalJson(proof),
      canonicalJson(currentness),
      recordedAt,
    );
  }

  private bindingRowToHead(row: BindingHeadRow): BindingHead {
    const proof = verifyWalletIdentityBindingProofEnvelope(
      JSON.parse(row.proof_envelope_json),
    );
    return Object.freeze({
      wallet_id: row.wallet_id,
      head_version: row.head_version,
      binding: proof.binding,
      proof,
      currentness: validateBindingCurrentnessAssertion(
        JSON.parse(row.currentness_json) as BindingCurrentnessAssertion,
      ),
      updated_at: row.updated_at,
    });
  }

  private assertBindingExpectation(
    row: BindingHeadRow,
    expected: BindingHeadExpectation | null,
  ): void {
    if (
      expected === null
      || expected.wallet_id !== row.wallet_id
      || expected.binding_id !== row.binding_id
      || expected.proof_id !== row.proof_id
      || expected.currentness_id !== row.currentness_id
      || expected.head_version !== row.head_version
    ) {
      fail("conflict", "Binding-head compare-and-swap expectation is stale");
    }
  }

  /**
   * Resolve all external observations first, then cross the durable possible-
   * signer boundary in one IMMEDIATE transaction. The returned request is
   * process-branded but no signer is called here. A crash after commit is
   * therefore recovered as signing_unknown and never recreated automatically.
   */
  async reserveAndEnterZeroneEconomySigningBoundary(
    inputValue: ReserveAndEnterZeroneEconomySigningBoundaryInput,
  ): Promise<ZeroneEconomySigningBoundaryResult> {
    const operationId = inputValue.operation_id;
    const requestId = inputValue.request_id;
    const proofEnvelope = JSON.parse(
      canonicalJson(inputValue.proof),
    ) as WalletIdentityBindingProofEnvelope;
    const resolveBindingCurrentness = this.resolveBindingCurrentness;
    const expectedBindingHeadValue = inputValue.expected_binding_head;
    let expectedBindingHead: BindingHeadExpectation | null = null;
    if (expectedBindingHeadValue !== null) {
      const snapshot = JSON.parse(canonicalJson(expectedBindingHeadValue)) as Record<string, unknown>;
      if (
        Object.keys(snapshot).sort().join("\0")
          !== [
            "binding_id", "currentness_id", "head_version", "proof_id", "wallet_id",
          ].sort().join("\0")
      ) {
        fail("invalid_input", "Expected binding head must use its closed field set");
      }
      assertIdentifier(snapshot.wallet_id, "expected_binding_head.wallet_id");
      assertSha256Id(snapshot.binding_id, "expected_binding_head.binding_id");
      assertSha256Id(snapshot.proof_id, "expected_binding_head.proof_id");
      assertSha256Id(snapshot.currentness_id, "expected_binding_head.currentness_id");
      assertCount(snapshot.head_version, "expected_binding_head.head_version", true);
      expectedBindingHead = Object.freeze(snapshot) as unknown as BindingHeadExpectation;
    }
    const resolveActivationCurrentness = this.resolveActivationCurrentness;
    const descriptor = inputValue.descriptor;
    const capability = inputValue.capability;
    const intent = inputValue.intent;
    const simulation = inputValue.simulation;
    const simulationEvidenceValue = JSON.parse(canonicalJson(inputValue.simulation_evidence));
    const plan = inputValue.plan;
    const treasuryPolicyValue = JSON.parse(
      canonicalJson(inputValue.treasury_policy),
    ) as TreasuryPolicy;
    const observeEconomyAccount = this.observeEconomyAccount;

    assertIdentifier(operationId, "operation_id");
    assertUuid(requestId, "request_id");
    assertZeroneEconomyDirectSignPlan(plan);
    assertVerifiedRecord(descriptor);
    assertVerifiedRecord(capability);
    assertVerifiedRecord(intent);
    assertVerifiedRecord(simulation);
    const proofForResolver = verifyWalletIdentityBindingProofEnvelope(proofEnvelope);
    const activationObservation = Object.freeze(
      JSON.parse(canonicalJson(inputValue.activation_observation)),
    ) as ReserveAndEnterZeroneEconomySigningBoundaryInput["activation_observation"];
    if (sha256Id(activationObservation) !== plan.activation_observation_hash) {
      fail("authorization_denied", "Activation observation does not bind the branded plan");
    }
    if (
      resolveBindingCurrentness === null
      || resolveActivationCurrentness === null
      || observeEconomyAccount === null
    ) {
      fail("authorization_denied", "Economy boundary constructor dependencies are not configured");
    }
    const [bindingCurrentnessValue, activationCurrentnessValue, accountSnapshotValue] =
      await Promise.all([
        resolveBindingCurrentness(proofForResolver),
        resolveActivationCurrentness(Object.freeze({
          activation_observation: activationObservation,
          plan,
        })),
        observeEconomyAccount(plan.source_account),
      ]);

    return this.runImmediate(this.db.transaction((): ZeroneEconomySigningBoundaryResult => {
      const at = this.now();
      assertTimestamp(at, "host.now");
      const proof = verifyWalletIdentityBindingProofEnvelope(proofEnvelope);
      const binding = proof.binding;
      const bindingCurrentness = validateBindingCurrentnessAssertion(bindingCurrentnessValue);
      const activationCurrentness = validateZeroneEconomyActivationCurrentnessAssertion(
        activationCurrentnessValue,
      );
      const accountSnapshot = validateAccountSnapshot(accountSnapshotValue);
      const policy = validateTreasuryPolicy(treasuryPolicyValue);
      assertZeroneEconomyDirectSignPlan(plan);
      assertVerifiedRecord(descriptor);
      assertVerifiedRecord(capability);
      assertVerifiedRecord(intent);
      assertVerifiedRecord(simulation);
      const simulationEvidence = verifyZeroneEconomySimulationEvidence(
        simulationEvidenceValue,
      );
      if (simulationEvidence.block_hash === null) {
        fail("evidence_rejected", "Typed economy signing requires a simulation block hash");
      }
      assertBlockHash(simulationEvidence.block_hash, "simulation_evidence.block_hash");
      if (
        simulationEvidence.block_ref
          !== `${plan.chain_reference}:${simulationEvidence.observed_at_height}`
      ) {
        fail("evidence_rejected", "Simulation evidence block reference is not exact");
      }

      if (this.operationRow(operationId) !== null) {
        fail("conflict", "Operation ID is already present in the durable ledger");
      }
      if (
        !currentnessMatchesBinding(bindingCurrentness, binding, proof)
        || Date.parse(bindingCurrentness.verified_at) < Date.parse(binding.issued_at)
        || Date.parse(at) < Date.parse(bindingCurrentness.verified_at)
        || Date.parse(at) >= Date.parse(bindingCurrentness.valid_until)
      ) {
        fail("authorization_denied", "Binding currentness is not fresh for the exact dual-key proof");
      }
      const trustedBindingVerifiers = [
        ...this.trustedBindingCurrentnessVerifiers.values(),
      ].filter((entry) =>
        entry.verifier_id === bindingCurrentness.verifier_id
        && Date.parse(bindingCurrentness.verified_at) >= Date.parse(entry.verified_at)
        && Date.parse(bindingCurrentness.verified_at) < Date.parse(entry.valid_until)
        && Date.parse(bindingCurrentness.valid_until) <= Date.parse(entry.valid_until)
        && Date.parse(at) >= Date.parse(entry.verified_at)
        && Date.parse(at) < Date.parse(entry.valid_until));
      if (trustedBindingVerifiers.length !== 1) {
        fail(
          "authorization_denied",
          "Binding currentness verifier is absent or ambiguous in configured trust epochs",
        );
      }
      const bindingVerifierTrust = trustedBindingVerifiers[0] as TrustedBindingCurrentnessVerifierAssertion;
      if (
        !this.trustedActivationVerifierIds.has(activationCurrentness.verifier_id)
        || activationCurrentness.activation_observation_hash !== plan.activation_observation_hash
        || activationCurrentness.network !== plan.network
        || activationCurrentness.chain_id !== plan.chain_id
        || activationCurrentness.zerone_core_commit !== plan.zerone_core_commit
        || activationCurrentness.cosmos_sdk !== plan.cosmos_sdk
        || activationCurrentness.sponsorship_consensus_version
          !== plan.sponsorship_consensus_version
        || activationCurrentness.knowledge_consensus_version
          !== plan.knowledge_consensus_version
        || BigInt(activationCurrentness.observed_at_height)
          < BigInt(plan.activation_observed_at_height)
        || Date.parse(at) < Date.parse(activationCurrentness.verified_at)
        || Date.parse(at) >= Date.parse(activationCurrentness.valid_until)
      ) {
        fail("authorization_denied", "Activation currentness is not from the configured exact resolver boundary");
      }
      if (
        plan.messages.length !== 1
        || plan.economic_effects.length !== 1
        || plan.intent_record_id !== intent.record_id
        || plan.chain_id !== intent.chain_id
        || plan.source_account !== intent.source_account
      ) {
        fail("authorization_denied", "Economy host admits exactly one fully intent-bound lifecycle message");
      }
      if (
        binding.wallet_id !== descriptor.wallet_id
        || binding.owner_identity_id !== descriptor.owner_identity_id
        || binding.wallet_descriptor_id !== descriptor.record_id
        || canonicalJson(binding.identity_authority) !== canonicalJson(descriptor.authority)
        || !descriptor.accounts.some(({ account_id, account_kind }) =>
          account_id === binding.zerone_account_id && account_kind === "eoa")
        || plan.source_account !== binding.zerone_account_id
        || plan.signer_key_id !== binding.zerone_signer.key_id
        || plan.signer_public_key_b64u !== binding.zerone_signer.public_key_b64u
        || plan.network !== binding.network
      ) {
        fail("authorization_denied", "Wallet records, identity proof, account, and planner signer do not correspond");
      }
      if (
        accountSnapshot.chain_id !== plan.chain_id
        || accountSnapshot.account !== plan.source_account
        || accountSnapshot.account_number !== plan.account_number
        || accountSnapshot.sequence !== plan.sequence
        || BigInt(accountSnapshot.observed_at_height) < BigInt(plan.account_observed_at_height)
        || Date.parse(at) < Date.parse(accountSnapshot.observed_at)
        || Date.parse(at) >= Date.parse(accountSnapshot.valid_until)
        || (
          accountSnapshot.observed_at_height === activationCurrentness.observed_at_height
          && accountSnapshot.block_hash !== activationCurrentness.block_hash
        )
        || (
          simulationEvidence.observed_at_height === activationCurrentness.observed_at_height
          && simulationEvidence.block_hash !== null
          && simulationEvidence.block_hash !== activationCurrentness.block_hash
        )
        || (
          simulationEvidence.observed_at_height === accountSnapshot.observed_at_height
          && simulationEvidence.block_hash !== null
          && simulationEvidence.block_hash !== accountSnapshot.block_hash
        )
      ) {
        fail("evidence_rejected", "Fresh account observation does not bind the exact planned SignDoc account tuple");
      }
      if (
        (BigInt(accountSnapshot.sequence) > 0n
          && accountSnapshot.public_key_type_url === null)
        || (
          accountSnapshot.public_key_type_url !== null
          && (
            accountSnapshot.public_key_type_url !== COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL
            || accountSnapshot.public_key_b64u !== plan.signer_public_key_b64u
            || accountSnapshot.public_key_b64u !== binding.zerone_signer.public_key_b64u
          )
        )
      ) {
        fail("evidence_rejected", "Registered Cosmos account key differs from the exact binding and plan signer");
      }
      if (
        BigInt(plan.account_observed_at_height) < BigInt(activationCurrentness.observed_at_height)
        || BigInt(accountSnapshot.observed_at_height) < BigInt(activationCurrentness.observed_at_height)
        || BigInt(simulationEvidence.observed_at_height)
          < BigInt(activationCurrentness.observed_at_height)
      ) {
        fail("evidence_rejected", "Plan, account, or simulation evidence predates current activation evidence");
      }

      const trustedAdapters = [...this.trustedSimulationAdapters.values()].filter((entry) =>
        entry.chain_id === plan.chain_id
        && entry.adapter.key_id === simulationEvidence.adapter.key_id
        && entry.adapter.public_key === simulationEvidence.adapter.public_key
        && Date.parse(simulationEvidence.simulated_at) >= Date.parse(entry.verified_at)
        && Date.parse(simulationEvidence.simulated_at) < Date.parse(entry.valid_until)
        && Date.parse(at) >= Date.parse(entry.verified_at)
        && Date.parse(at) < Date.parse(entry.valid_until));
      if (trustedAdapters.length !== 1) {
        fail("authorization_denied", "Simulation adapter is absent or ambiguous in the active exact host allowlist");
      }
      const adapterTrust = trustedAdapters[0] as TrustedSimulationAdapterAssertion;
      if (
        simulation.adapter.key_id !== adapterTrust.adapter.key_id
        || simulation.adapter.public_key !== adapterTrust.adapter.public_key
      ) {
        fail("authorization_denied", "Wallet simulation receipt does not use the configured adapter key");
      }

      const profile = getZeroneProfile(plan.network);
      const spendLimit = capability.spend_limits.find(
        ({ asset_id }) => asset_id === profile.native_asset_id,
      );
      const feeLimit = capability.fee_limits.find(
        ({ asset_id }) => asset_id === profile.native_asset_id,
      );
      if (
        feeLimit === undefined
        || (spendLimit === undefined && plan.total_reserved_spend_uzrn !== "0")
      ) {
        fail("authorization_denied", "Capability lacks exact native spend or fee limits required by this plan");
      }
      const capabilityBudget: CapabilityBudget = Object.freeze({
        capability_record_id: capability.record_id,
        descriptor_id: capability.descriptor_id,
        policy_hash: capability.policy_hash,
        revocation_nonce: capability.revocation_nonce,
        max_intents: capability.max_intents,
        max_spend_uzrn: spendLimit?.max_total ?? "0",
        max_fee_per_intent_uzrn: feeLimit.max_per_intent,
      });
      parseUint64(capabilityBudget.max_spend_uzrn, "capability native max_total");
      parseUint64(capabilityBudget.max_fee_per_intent_uzrn, "capability native max_fee");

      const existingUsage = this.capabilityRow(capability.record_id);
      if (
        existingUsage !== null
        && (existingUsage.wallet_id !== binding.wallet_id
          || !sameCapabilityBudget(existingUsage, capabilityBudget))
      ) {
        fail("authorization_denied", "Verified capability differs from its durable usage identity");
      }
      const priorIntentCount = existingUsage === null
        ? 0
        : existingUsage.reserved_intents + existingUsage.consumed_intents;
      const priorSpend = existingUsage === null
        ? 0n
        : BigInt(existingUsage.reserved_spend_uzrn)
          + BigInt(existingUsage.consumed_spend_uzrn);
      const authorizationUsage = Object.freeze({
        revocation_nonce: bindingCurrentness.wallet_revocation_nonce,
        intent_count: priorIntentCount,
        spent: [Object.freeze({
          asset_id: profile.native_asset_id,
          amount_atomic: priorSpend.toString(),
        })],
        host_verified_approval_ids: [],
      });
      const authorization = assertIntentWithinCapabilityStatic({
        descriptor,
        capability,
        intent,
        simulation,
        context: {
          now: at,
          usage: authorizationUsage,
        },
      });
      const authorizationVerificationId = sha256Id({
        boundary: ECONOMY_AUTHORIZATION_BOUNDARY,
        authorization,
        usage: authorizationUsage,
      });
      const simulationBinding = createZeroneEconomySimulationBinding({
        plan,
        simulation,
        evidence: simulationEvidence,
      });
      const signingRequest = createZeroneEconomySigningRequest({
        plan,
        simulation,
        binding: simulationBinding,
        authorization,
        request_id: requestId,
        requested_at: at,
      });
      if (
        signingRequest.unsigned_payload_hash !== plan.sign_doc_bytes_hash
        || signingRequest.signer_key_id !== plan.signer_key_id
      ) {
        fail("integrity_error", "Planner signing request does not bind the exact SignDoc and signer");
      }

      const message = plan.messages[0];
      const economicEffect = plan.economic_effects[0];
      if (message === undefined || economicEffect === undefined) {
        fail("integrity_error", "One-message plan lost its derived economy fields");
      }
      const reservations: PurposeReservation[] = [{
        purpose: "network_fee",
        amount_uzrn: plan.fee.amount,
      }];
      if (message.kind === "create_bounty") {
        reservations.push({
          purpose: "sponsorship_escrow",
          amount_uzrn: message.reserved_spend_uzrn,
        });
      } else if (message.kind === "submit_claim") {
        reservations.push({
          purpose: "knowledge_bond",
          amount_uzrn: message.reserved_spend_uzrn,
        });
      } else if (message.reserved_spend_uzrn !== "0") {
        fail("integrity_error", "Fulfillment must remain fee-only");
      }
      reservations.sort((left, right) => left.purpose.localeCompare(right.purpose));
      for (const [index, reservation] of reservations.entries()) {
        assertPurpose(reservation.purpose, `derived_reservations[${index}].purpose`);
        parseUint64(
          reservation.amount_uzrn,
          `derived_reservations[${index}].amount_uzrn`,
          true,
        );
      }
      const nonFeeSpend = bigintSum(reservations
        .filter(({ purpose }) => purpose !== "network_fee")
        .map(({ amount_uzrn }) => amount_uzrn));
      const fee = bigintSum(reservations
        .filter(({ purpose }) => purpose === "network_fee")
        .map(({ amount_uzrn }) => amount_uzrn));
      const total = bigintSum(reservations.map(({ amount_uzrn }) => amount_uzrn));
      if (nonFeeSpend.toString() !== plan.total_reserved_spend_uzrn) {
        fail("integrity_error", "Derived treasury reservation differs from planner native spend");
      }

      if (
        policy.wallet_binding_id !== binding.binding_id
        || policy.treasury_account !== binding.zerone_account_id
        || policy.network !== binding.network
        || capability.policy_hash !== policy.treasury_policy_id
        || capability.descriptor_id !== descriptor.record_id
        || capability.revocation_nonce !== bindingCurrentness.wallet_revocation_nonce
      ) {
        fail("authorization_denied", "Treasury, capability, descriptor, and fresh identity head do not agree");
      }
      assertNotBefore(at, policy.issued_at, "Economy reservation");
      if (fee > BigInt(capabilityBudget.max_fee_per_intent_uzrn)) {
        fail("authorization_denied", "Economy network fee exceeds the capability ceiling");
      }
      const windowBlocks = BigInt(policy.window_blocks);
      const windowStart = (
        BigInt(accountSnapshot.observed_at_height) / windowBlocks
      ) * windowBlocks;
      const windowUsage = this.windowUsage(
        accountSnapshot.chain_id,
        accountSnapshot.account,
        windowStart.toString(),
      );
      for (const reservation of reservations) {
        if (!policy.allowed_purposes.includes(reservation.purpose)) {
          fail("treasury_denied", `Treasury purpose is not allowed: ${reservation.purpose}`);
        }
        if (
          windowUsage[reservation.purpose] + BigInt(reservation.amount_uzrn)
          > BigInt(policy.window_caps_uzrn[reservation.purpose])
        ) {
          fail("treasury_denied", `${reservation.purpose} treasury window cap would be exceeded`);
        }
      }
      if (
        total > BigInt(policy.max_single_spend_uzrn)
        || windowUsage.total + total > BigInt(policy.window_caps_uzrn.total)
      ) {
        fail("treasury_denied", "Economy operation exceeds single or total window spend limits");
      }
      const exposure = this.accountExposure(plan.chain_id, plan.source_account);
      const floor = this.maximumActiveReserveFloor(
        plan.chain_id,
        plan.source_account,
        BigInt(policy.reserve_floor_uzrn),
      );
      if (BigInt(accountSnapshot.balance_uzrn) < exposure + total + floor) {
        fail("treasury_denied", "Economy reservations would breach the durable reserve floor");
      }
      const durablePolicy = this.db.query(`
        SELECT treasury_policy_id FROM operations
        WHERE chain_id = ? AND source_account = ?
        ORDER BY created_at, operation_id LIMIT 1
      `).get(plan.chain_id, plan.source_account) as { treasury_policy_id: Sha256Id } | null;
      if (durablePolicy !== null && durablePolicy.treasury_policy_id !== policy.treasury_policy_id) {
        fail("treasury_denied", "Treasury-policy rotation is blocked for this account");
      }

      const planContentId = zeroneEconomyDirectSignPlanContentId(plan);
      const activationCurrentnessJson = canonicalJson(activationCurrentness);
      const bindingCurrentnessJson = canonicalJson(bindingCurrentness);
      const bindingVerifierTrustJson = canonicalJson(bindingVerifierTrust);
      const adapterTrustJson = canonicalJson(adapterTrust);
      const simulationEvidenceJson = canonicalJson(simulationEvidence);
      const commitmentCore: Omit<ZeroneEconomyOperationCommitment, "commitment_id"> = Object.freeze({
        format: "agenttool.zerone-economy-operation-commitment/0.1",
        operation_id: operationId,
        plan_id: plan.plan_id,
        plan_content_id: planContentId,
        message_kind: message.kind,
        message_type_url: message.type_url,
        wallet_method: message.wallet_method,
        projection_hash: message.projection_hash,
        value_b64u: message.value_b64u,
        value_hash: message.value_hash,
        actor_address: message.actor_address,
        module_account: message.module_account,
        reserved_spend_uzrn: message.reserved_spend_uzrn,
        economic_effect_json: canonicalJson(economicEffect),
        authorization_verification_id: authorizationVerificationId,
        authorization_usage_json: canonicalJson(authorizationUsage),
        binding_currentness_id: bindingCurrentness.currentness_id,
        binding_currentness_json: bindingCurrentnessJson,
        binding_verifier_trust_id: bindingVerifierTrust.trust_id,
        binding_verifier_external_verification_id:
          bindingVerifierTrust.external_verification_id,
        binding_verifier_id: bindingVerifierTrust.verifier_id,
        binding_verifier_verified_at: bindingVerifierTrust.verified_at,
        binding_verifier_valid_until: bindingVerifierTrust.valid_until,
        binding_verifier_trust_json: bindingVerifierTrustJson,
        intent_record_id: intent.record_id,
        simulation_record_id: simulation.record_id,
        simulation_evidence_content_id: simulationEvidence.content_id,
        simulation_evidence_record_id: simulationEvidence.record_id,
        simulation_evidence_json: simulationEvidenceJson,
        simulation_tx_bytes_hash: plan.simulation_tx_bytes_hash,
        simulation_adapter_trust_id: adapterTrust.trust_id,
        simulation_adapter_external_verification_id: adapterTrust.external_verification_id,
        simulation_adapter_verifier_id: adapterTrust.verifier_id,
        simulation_adapter_public_key: adapterTrust.adapter.public_key,
        simulation_adapter_verified_at: adapterTrust.verified_at,
        simulation_adapter_valid_until: adapterTrust.valid_until,
        simulation_adapter_trust_json: adapterTrustJson,
        simulation_simulated_at: simulationEvidence.simulated_at,
        simulation_valid_until: simulationEvidence.valid_until,
        simulation_observed_at_height: simulationEvidence.observed_at_height,
        simulation_block_ref: simulationEvidence.block_ref,
        simulation_block_hash: simulationEvidence.block_hash,
        sign_doc_bytes_hash: plan.sign_doc_bytes_hash,
        activation_currentness_id: activationCurrentness.currentness_id,
        activation_external_verification_id: activationCurrentness.external_verification_id,
        activation_verifier_id: activationCurrentness.verifier_id,
        activation_observation_hash: plan.activation_observation_hash,
        zerone_core_commit: "a5b82e82b2a32be2b75bd11575964b0a69aa34ac",
        cosmos_sdk: "v0.53.8",
        sponsorship_consensus_version: 2,
        knowledge_consensus_version: 7,
        activation_observed_at_height: activationCurrentness.observed_at_height,
        activation_block_hash: activationCurrentness.block_hash,
        activation_verified_at: activationCurrentness.verified_at,
        activation_valid_until: activationCurrentness.valid_until,
        activation_currentness_json: activationCurrentnessJson,
        chain_id: plan.chain_id,
        source_account: plan.source_account,
        account_number: plan.account_number,
        account_sequence: plan.sequence,
        account_observed_at_height: accountSnapshot.observed_at_height,
        account_block_hash: accountSnapshot.block_hash,
        account_observed_at: accountSnapshot.observed_at,
        account_public_key_type_url: accountSnapshot.public_key_type_url,
        account_public_key_b64u: accountSnapshot.public_key_b64u,
        account_valid_until: accountSnapshot.valid_until,
        network_fee_uzrn: plan.fee.amount,
        request_id: signingRequest.request_id,
        requested_at: at,
        network_effects_performed: false,
        local_durable_effects: "reservation_and_possible_signer_boundary_committed",
      });
      const commitment: ZeroneEconomyOperationCommitment = Object.freeze({
        ...commitmentCore,
        commitment_id: economyCommitmentId(commitmentCore),
      });
      const commitmentJson = canonicalJson(commitment);

      const head = this.putBindingHeadInTransaction(
        proof,
        bindingCurrentness,
        expectedBindingHead,
        at,
      );
      this.observeAccount(accountSnapshot, false);
      const held = this.db.query(`
        SELECT operation_id FROM sequence_fences
        WHERE chain_id = ? AND source_account = ? AND state = 'held'
      `).get(plan.chain_id, plan.source_account) as { operation_id: string } | null;
      if (held !== null) {
        fail("sequence_fenced", `Account already has an in-flight operation: ${held.operation_id}`);
      }

      let usage = this.capabilityRow(capability.record_id);
      if (usage === null) {
        this.db.query(`
          INSERT INTO capability_usage (
            capability_record_id, wallet_id, descriptor_id, policy_hash,
            revocation_nonce, max_intents, max_spend_uzrn,
            max_fee_per_intent_uzrn, reserved_intents, consumed_intents,
            reserved_spend_uzrn, consumed_spend_uzrn, version, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, '0', '0', 1, ?)
        `).run(
          capabilityBudget.capability_record_id,
          head.wallet_id,
          capabilityBudget.descriptor_id,
          capabilityBudget.policy_hash,
          capabilityBudget.revocation_nonce,
          capabilityBudget.max_intents,
          capabilityBudget.max_spend_uzrn,
          capabilityBudget.max_fee_per_intent_uzrn,
          at,
        );
        usage = this.capabilityRow(capability.record_id);
      }
      if (usage === null || !sameCapabilityBudget(usage, capabilityBudget)) {
        fail("integrity_error", "Capability usage could not be materialized exactly");
      }
      assertNotBefore(at, usage.updated_at, "Economy capability reservation");
      const reserveCapability = this.db.query(`
        UPDATE capability_usage SET reserved_intents = reserved_intents + 1,
          reserved_spend_uzrn = ?, version = version + 1, updated_at = ?
        WHERE capability_record_id = ? AND version = ?
      `).run(
        (BigInt(usage.reserved_spend_uzrn) + nonFeeSpend).toString(),
        at,
        usage.capability_record_id,
        usage.version,
      );
      if (reserveCapability.changes !== 1) {
        fail("conflict", "Economy capability reservation compare-and-swap lost its race");
      }

      this.db.query(`
        INSERT INTO operations (
          operation_id, operation_kind, revision, status, wallet_id, binding_id, proof_id,
          currentness_id, binding_head_version, descriptor_id, capability_record_id,
          capability_revocation_nonce, authorization_verification_id,
          intent_record_id, simulation_record_id, plan_reference_id,
          treasury_policy_id, treasury_policy_json, window_start_height,
          reserve_floor_uzrn, chain_id, source_account, account_number, sequence,
          signer_key_id, signer_invoked, request_id, unsigned_payload_hash,
          signing_boundary_verification_id, tx_hash, signed_payload_hash,
          signed_verification_id, inclusion_height, inclusion_block_hash,
          inclusion_code, inclusion_codespace, unresolved_reorg_event_sequence,
          unresolved_reorg_evidence_id, event_count, event_head_hash, created_at, updated_at
        ) VALUES (
          ?, 'zerone_economy', 1, 'reserved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
          NULL, 0, ?, ?, ?
        )
      `).run(
        operationId,
        head.wallet_id,
        head.binding.binding_id,
        head.proof.proof_id,
        head.currentness.currentness_id,
        head.head_version,
        descriptor.record_id,
        capability.record_id,
        capability.revocation_nonce,
        authorizationVerificationId,
        intent.record_id,
        simulation.record_id,
        planContentId,
        policy.treasury_policy_id,
        canonicalJson(policy),
        windowStart.toString(),
        policy.reserve_floor_uzrn,
        plan.chain_id,
        plan.source_account,
        plan.account_number,
        plan.sequence,
        plan.signer_key_id,
        GENESIS_EVENT_HASH,
        at,
        at,
      );
      for (const reservation of reservations) {
        this.db.query(`
          INSERT INTO treasury_reservations (operation_id, purpose, amount_uzrn, state)
          VALUES (?, ?, ?, 'reserved')
        `).run(operationId, reservation.purpose, reservation.amount_uzrn);
      }
      this.db.query(`
        INSERT INTO sequence_fences (
          operation_id, chain_id, source_account, account_number, sequence,
          state, acquired_at, released_at, release_evidence_id
        ) VALUES (?, ?, ?, ?, ?, 'held', ?, NULL, NULL)
      `).run(
        operationId,
        plan.chain_id,
        plan.source_account,
        plan.account_number,
        plan.sequence,
        at,
      );
      this.db.query(`
        INSERT INTO economy_operation_commitments (
          operation_id, commitment_id, plan_id, plan_content_id, message_kind,
          message_type_url, intent_record_id, simulation_evidence_record_id,
          simulation_evidence_json, binding_currentness_id,
          binding_verifier_trust_id, sign_doc_bytes_hash,
          activation_currentness_id, request_id, requested_at, commitment_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        operationId,
        commitment.commitment_id,
        commitment.plan_id,
        commitment.plan_content_id,
        commitment.message_kind,
        commitment.message_type_url,
        intent.record_id,
        commitment.simulation_evidence_record_id,
        commitment.simulation_evidence_json,
        commitment.binding_currentness_id,
        commitment.binding_verifier_trust_id,
        commitment.sign_doc_bytes_hash,
        commitment.activation_currentness_id,
        commitment.request_id,
        at,
        commitmentJson,
      );
      this.appendEvent(operationId, "reserved", at, {
        operation_kind: "zerone_economy",
        economy_commitment_id: commitment.commitment_id,
        economy_commitment_json: commitmentJson,
        binding_id: head.binding.binding_id,
        proof_id: head.proof.proof_id,
        currentness_id: head.currentness.currentness_id,
        wallet_id: head.wallet_id,
        binding_head_version: head.head_version,
        descriptor_id: descriptor.record_id,
        signer_key_id: plan.signer_key_id,
        authorization_verification_id: authorizationVerificationId,
        authorization_trust_boundary: ECONOMY_AUTHORIZATION_BOUNDARY,
        intent_record_id: intent.record_id,
        simulation_record_id: simulation.record_id,
        plan_reference_id: planContentId,
        capability: {
          capability_record_id: capabilityBudget.capability_record_id,
          policy_hash: capabilityBudget.policy_hash,
          revocation_nonce: capabilityBudget.revocation_nonce,
          max_intents: capabilityBudget.max_intents,
          max_spend_uzrn: capabilityBudget.max_spend_uzrn,
          max_fee_per_intent_uzrn: capabilityBudget.max_fee_per_intent_uzrn,
        },
        treasury_policy_id: policy.treasury_policy_id,
        treasury_policy_json: canonicalJson(policy),
        window_start_height: windowStart.toString(),
        reserve_floor_uzrn: policy.reserve_floor_uzrn,
        reservations,
        chain_id: accountSnapshot.chain_id,
        source_account: accountSnapshot.account,
        account_number: accountSnapshot.account_number,
        sequence: accountSnapshot.sequence,
        balance_uzrn: accountSnapshot.balance_uzrn,
        observed_at_height: accountSnapshot.observed_at_height,
        observation_block_hash: accountSnapshot.block_hash,
        observation_at: accountSnapshot.observed_at,
        account_public_key_type_url: accountSnapshot.public_key_type_url,
        account_public_key_b64u: accountSnapshot.public_key_b64u,
        account_valid_until: accountSnapshot.valid_until,
        execution_support: EXECUTION_SUPPORT.mode,
      });

      this.observeAccount(accountSnapshot, false);
      const reservedUsage = this.capabilityRow(capability.record_id);
      if (reservedUsage === null || reservedUsage.reserved_intents < 1) {
        fail("integrity_error", "Economy signer boundary lost reserved capability usage");
      }
      const consumeCapability = this.db.query(`
        UPDATE capability_usage SET reserved_intents = reserved_intents - 1,
          consumed_intents = consumed_intents + 1, reserved_spend_uzrn = ?,
          consumed_spend_uzrn = ?, version = version + 1, updated_at = ?
        WHERE capability_record_id = ? AND version = ?
      `).run(
        (BigInt(reservedUsage.reserved_spend_uzrn) - nonFeeSpend).toString(),
        (BigInt(reservedUsage.consumed_spend_uzrn) + nonFeeSpend).toString(),
        at,
        reservedUsage.capability_record_id,
        reservedUsage.version,
      );
      if (consumeCapability.changes !== 1) {
        fail("conflict", "Economy capability signer compare-and-swap lost its race");
      }
      this.db.query(`
        UPDATE treasury_reservations SET state = 'sticky'
        WHERE operation_id = ? AND state = 'reserved'
      `).run(operationId);
      const operationUpdate = this.db.query(`
        UPDATE operations SET status = 'signing', revision = 2, signer_invoked = 1,
          request_id = ?, unsigned_payload_hash = ?,
          signing_boundary_verification_id = ?, updated_at = ?
        WHERE operation_id = ? AND revision = 1 AND status = 'reserved'
          AND operation_kind = 'zerone_economy'
      `).run(
        signingRequest.request_id,
        plan.sign_doc_bytes_hash,
        commitment.commitment_id,
        at,
        operationId,
      );
      if (operationUpdate.changes !== 1) {
        fail("conflict", "Economy signer boundary compare-and-swap lost its race");
      }
      this.appendEvent(operationId, "signer_invocation_boundary", at, {
        request_id: signingRequest.request_id,
        unsigned_payload_hash: plan.sign_doc_bytes_hash,
        external_verification_id: commitment.commitment_id,
        authorization_trust_boundary: ECONOMY_AUTHORIZATION_BOUNDARY,
        economy_commitment_id: commitment.commitment_id,
        economy_commitment_json: commitmentJson,
        binding_id: head.binding.binding_id,
        proof_id: head.proof.proof_id,
        currentness_id: head.currentness.currentness_id,
        binding_head_version: head.head_version,
        chain_id: accountSnapshot.chain_id,
        source_account: accountSnapshot.account,
        account_number: accountSnapshot.account_number,
        account_sequence: accountSnapshot.sequence,
        balance_uzrn: accountSnapshot.balance_uzrn,
        observed_at_height: accountSnapshot.observed_at_height,
        observation_block_hash: accountSnapshot.block_hash,
        observation_at: accountSnapshot.observed_at,
        account_public_key_type_url: accountSnapshot.public_key_type_url,
        account_public_key_b64u: accountSnapshot.public_key_b64u,
        account_valid_until: accountSnapshot.valid_until,
      });
      return Object.freeze({
        operation: this.getOperationOrFail(operationId),
        commitment,
        signing_request: signingRequest,
      });
    }));
  }

  reserveOperation(input: ReserveOperationInput): OperationSnapshot {
    this.requireLegacyGenericInjected("Generic reservation");
    this.validateReservationInput(input);
    const policy = validateTreasuryPolicy(input.treasury_policy);
    const snapshot = validateAccountSnapshot(input.account_snapshot);
    const nonFeeSpend = bigintSum(input.reservations
      .filter(({ purpose }) => purpose !== "network_fee")
      .map(({ amount_uzrn }) => amount_uzrn));
    const fee = bigintSum(input.reservations
      .filter(({ purpose }) => purpose === "network_fee")
      .map(({ amount_uzrn }) => amount_uzrn));
    const total = bigintSum(input.reservations.map(({ amount_uzrn }) => amount_uzrn));
    const windowBlocks = BigInt(policy.window_blocks);
    const windowStart = (BigInt(snapshot.observed_at_height) / windowBlocks) * windowBlocks;

    this.files.tighten();
    this.verify();
    const reserve = this.db.transaction((): OperationSnapshot => {
      if (this.operationRow(input.operation_id) !== null) {
        fail("conflict", "Operation ID is already present in the durable ledger");
      }
      const head = this.bindingRow(input.binding_head.wallet_id);
      if (head === null) fail("authorization_denied", "Current binding head is absent");
      this.assertBindingExpectation(head, input.binding_head);
      const headCurrentness = validateBindingCurrentnessAssertion(
        JSON.parse(head.currentness_json) as BindingCurrentnessAssertion,
      );
      if (
        Date.parse(input.created_at) < Date.parse(headCurrentness.verified_at)
        || Date.parse(input.created_at) >= Date.parse(headCurrentness.valid_until)
      ) {
        fail("authorization_denied", "Binding currentness is not valid at operation reservation");
      }
      if (
        head.descriptor_id !== input.capability.descriptor_id
        || head.signer_key_id !== input.signer_key_id
        || head.revocation_nonce !== input.capability.revocation_nonce
      ) {
        fail("authorization_denied", "Descriptor, signer, or revocation state is not current");
      }
      if (
        policy.wallet_binding_id !== head.binding_id
        || policy.treasury_account !== head.source_account
        || policy.network !== head.network
        || input.capability.policy_hash !== policy.treasury_policy_id
        || snapshot.account !== head.source_account
        || snapshot.chain_id !== policy.treasury_account.split(":").slice(0, 2).join(":")
      ) {
        fail(
          "authorization_denied",
          "Treasury policy, capability policy hash, binding, and account observation do not agree",
        );
      }
      assertNotBefore(input.created_at, head.updated_at, "Operation reservation");
      assertNotBefore(input.created_at, snapshot.observed_at, "Operation reservation");
      if (Date.parse(input.created_at) >= Date.parse(snapshot.valid_until)) {
        fail("evidence_rejected", "Account observation is expired at operation reservation");
      }
      assertNotBefore(input.created_at, policy.issued_at, "Operation reservation");
      const durablePolicy = this.db.query(`
        SELECT treasury_policy_id FROM operations
        WHERE chain_id = ? AND source_account = ?
        ORDER BY created_at, operation_id LIMIT 1
      `).get(snapshot.chain_id, snapshot.account) as { treasury_policy_id: Sha256Id } | null;
      if (
        durablePolicy !== null
        && durablePolicy.treasury_policy_id !== policy.treasury_policy_id
      ) {
        fail(
          "treasury_denied",
          "Treasury-policy rotation is blocked for this account pending a reviewed non-widening policy protocol",
        );
      }
      this.observeAccount(snapshot, false);
      const held = this.db.query(`
        SELECT operation_id FROM sequence_fences
        WHERE chain_id = ? AND source_account = ? AND state = 'held'
      `).get(snapshot.chain_id, snapshot.account) as { operation_id: string } | null;
      if (held !== null) {
        fail("sequence_fenced", `Account already has an in-flight operation: ${held.operation_id}`);
      }

      let usage = this.capabilityRow(input.capability.capability_record_id);
      if (usage === null) {
        this.db.query(`
          INSERT INTO capability_usage (
            capability_record_id, wallet_id, descriptor_id, policy_hash,
            revocation_nonce, max_intents, max_spend_uzrn,
            max_fee_per_intent_uzrn, reserved_intents, consumed_intents,
            reserved_spend_uzrn, consumed_spend_uzrn, version, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, '0', '0', 1, ?)
        `).run(
          input.capability.capability_record_id,
          head.wallet_id,
          input.capability.descriptor_id,
          input.capability.policy_hash,
          input.capability.revocation_nonce,
          input.capability.max_intents,
          input.capability.max_spend_uzrn,
          input.capability.max_fee_per_intent_uzrn,
          input.created_at,
        );
        usage = this.capabilityRow(input.capability.capability_record_id);
      }
      if (usage === null || usage.wallet_id !== head.wallet_id || !sameCapabilityBudget(usage, input.capability)) {
        fail("authorization_denied", "Capability budget bytes do not match durable usage state");
      }
      assertNotBefore(input.created_at, usage.updated_at, "Capability reservation");
      if (usage.reserved_intents + usage.consumed_intents + 1 > usage.max_intents) {
        fail("authorization_denied", "Capability intent count is exhausted");
      }
      if (
        BigInt(usage.reserved_spend_uzrn)
          + BigInt(usage.consumed_spend_uzrn)
          + nonFeeSpend
        > BigInt(usage.max_spend_uzrn)
      ) {
        fail("authorization_denied", "Capability cumulative spend is exhausted");
      }
      if (fee > BigInt(usage.max_fee_per_intent_uzrn)) {
        fail("authorization_denied", "Operation network fee exceeds the capability per-intent ceiling");
      }

      const windowUsage = this.windowUsage(
        snapshot.chain_id,
        snapshot.account,
        windowStart.toString(),
      );
      for (const reservation of input.reservations) {
        if (!policy.allowed_purposes.includes(reservation.purpose)) {
          fail("treasury_denied", `Treasury purpose is not allowed: ${reservation.purpose}`);
        }
        const next = windowUsage[reservation.purpose] + BigInt(reservation.amount_uzrn);
        if (next > BigInt(policy.window_caps_uzrn[reservation.purpose])) {
          fail("treasury_denied", `${reservation.purpose} treasury window cap would be exceeded`);
        }
      }
      if (total > BigInt(policy.max_single_spend_uzrn)) {
        fail("treasury_denied", "Combined operation spend exceeds max_single_spend_uzrn");
      }
      if (windowUsage.total + total > BigInt(policy.window_caps_uzrn.total)) {
        fail("treasury_denied", "Total treasury window cap would be exceeded");
      }
      const exposure = this.accountExposure(snapshot.chain_id, snapshot.account);
      const floor = this.maximumActiveReserveFloor(
        snapshot.chain_id,
        snapshot.account,
        BigInt(policy.reserve_floor_uzrn),
      );
      if (BigInt(snapshot.balance_uzrn) < exposure + total + floor) {
        fail("treasury_denied", "Durable reservations would breach the treasury reserve floor");
      }

      const capabilityUpdate = this.db.query(`
        UPDATE capability_usage SET
          reserved_intents = reserved_intents + 1,
          reserved_spend_uzrn = ?,
          version = version + 1,
          updated_at = ?
        WHERE capability_record_id = ? AND version = ?
      `).run(
        (BigInt(usage.reserved_spend_uzrn) + nonFeeSpend).toString(),
        input.created_at,
        usage.capability_record_id,
        usage.version,
      );
      if (capabilityUpdate.changes !== 1) {
        fail("conflict", "Capability usage compare-and-swap lost its race");
      }

      this.db.query(`
        INSERT INTO operations (
          operation_id, operation_kind, revision, status, wallet_id, binding_id, proof_id,
          currentness_id, binding_head_version, descriptor_id, capability_record_id,
          capability_revocation_nonce, authorization_verification_id,
          intent_record_id, simulation_record_id,
          plan_reference_id, treasury_policy_id, treasury_policy_json,
          window_start_height, reserve_floor_uzrn, chain_id, source_account,
          account_number, sequence, signer_key_id, signer_invoked, request_id,
          unsigned_payload_hash, signing_boundary_verification_id, tx_hash,
          signed_payload_hash, signed_verification_id, inclusion_height,
          inclusion_block_hash, inclusion_code, inclusion_codespace,
          unresolved_reorg_event_sequence, unresolved_reorg_evidence_id,
          event_count, event_head_hash, created_at, updated_at
        ) VALUES (
          ?, 'generic_injected', 1, 'reserved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, 0, ?, ?, ?
        )
      `).run(
        input.operation_id,
        head.wallet_id,
        head.binding_id,
        head.proof_id,
        head.currentness_id,
        head.head_version,
        head.descriptor_id,
        input.capability.capability_record_id,
        input.capability.revocation_nonce,
        input.authorization.external_verification_id,
        input.authorization.intent_record_id,
        input.authorization.simulation_record_id,
        input.authorization.plan_reference_id,
        policy.treasury_policy_id,
        canonicalJson(policy),
        windowStart.toString(),
        policy.reserve_floor_uzrn,
        snapshot.chain_id,
        snapshot.account,
        snapshot.account_number,
        snapshot.sequence,
        input.signer_key_id,
        GENESIS_EVENT_HASH,
        input.created_at,
        input.created_at,
      );
      for (const reservation of input.reservations) {
        this.db.query(`
          INSERT INTO treasury_reservations (operation_id, purpose, amount_uzrn, state)
          VALUES (?, ?, ?, 'reserved')
        `).run(input.operation_id, reservation.purpose, reservation.amount_uzrn);
      }
      this.db.query(`
        INSERT INTO sequence_fences (
          operation_id, chain_id, source_account, account_number, sequence,
          state, acquired_at, released_at, release_evidence_id
        ) VALUES (?, ?, ?, ?, ?, 'held', ?, NULL, NULL)
      `).run(
        input.operation_id,
        snapshot.chain_id,
        snapshot.account,
        snapshot.account_number,
        snapshot.sequence,
        input.created_at,
      );
      this.appendEvent(input.operation_id, "reserved", input.created_at, {
        operation_kind: "generic_injected",
        binding_id: head.binding_id,
        proof_id: head.proof_id,
        currentness_id: head.currentness_id,
        wallet_id: head.wallet_id,
        binding_head_version: head.head_version,
        descriptor_id: head.descriptor_id,
        signer_key_id: input.signer_key_id,
        authorization_verification_id: input.authorization.external_verification_id,
        authorization_trust_boundary: input.authorization.trust_boundary,
        intent_record_id: input.authorization.intent_record_id,
        simulation_record_id: input.authorization.simulation_record_id,
        plan_reference_id: input.authorization.plan_reference_id,
        capability: {
          capability_record_id: input.capability.capability_record_id,
          policy_hash: input.capability.policy_hash,
          revocation_nonce: input.capability.revocation_nonce,
          max_intents: input.capability.max_intents,
          max_spend_uzrn: input.capability.max_spend_uzrn,
          max_fee_per_intent_uzrn: input.capability.max_fee_per_intent_uzrn,
        },
        treasury_policy_id: policy.treasury_policy_id,
        treasury_policy_json: canonicalJson(policy),
        window_start_height: windowStart.toString(),
        reserve_floor_uzrn: policy.reserve_floor_uzrn,
        reservations: [...input.reservations]
          .sort((left, right) => left.purpose.localeCompare(right.purpose)),
        chain_id: snapshot.chain_id,
        source_account: snapshot.account,
        account_number: snapshot.account_number,
        sequence: snapshot.sequence,
        balance_uzrn: snapshot.balance_uzrn,
        observed_at_height: snapshot.observed_at_height,
        observation_block_hash: snapshot.block_hash,
        observation_at: snapshot.observed_at,
        account_public_key_type_url: snapshot.public_key_type_url,
        account_public_key_b64u: snapshot.public_key_b64u,
        account_valid_until: snapshot.valid_until,
        execution_support: EXECUTION_SUPPORT.mode,
      });
      return this.getOperationOrFail(input.operation_id);
    });

    try {
      const result = reserve.immediate();
      this.files.tighten();
      return result;
    } catch (error) {
      if (error instanceof ZeroneAgentHostError) throw error;
      if (error instanceof Error && /UNIQUE constraint failed/u.test(error.message)) {
        fail("conflict", "A unique authorization, intent, request, transaction, or fence was concurrently consumed");
      }
      throw error;
    }
  }

  private validateReservationInput(input: ReserveOperationInput): void {
    assertIdentifier(input.operation_id, "operation_id");
    assertIdentifier(input.binding_head.wallet_id, "binding_head.wallet_id");
    assertSha256Id(input.binding_head.binding_id, "binding_head.binding_id");
    assertSha256Id(input.binding_head.proof_id, "binding_head.proof_id");
    assertSha256Id(input.binding_head.currentness_id, "binding_head.currentness_id");
    assertCount(input.binding_head.head_version, "binding_head.head_version", true);
    if (input.authorization.trust_boundary !== AUTHORIZATION_PROJECTION_BOUNDARY) {
      fail("invalid_input", "authorization trust boundary is not the injected Wallet projection boundary");
    }
    assertSha256Id(
      input.authorization.external_verification_id,
      "authorization.external_verification_id",
    );
    assertSha256Id(input.authorization.intent_record_id, "authorization.intent_record_id");
    assertSha256Id(input.authorization.simulation_record_id, "authorization.simulation_record_id");
    assertSha256Id(input.authorization.plan_reference_id, "authorization.plan_reference_id");
    assertSha256Id(input.capability.capability_record_id, "capability.capability_record_id");
    assertSha256Id(input.capability.descriptor_id, "capability.descriptor_id");
    assertSha256Id(input.capability.policy_hash, "capability.policy_hash");
    assertCount(input.capability.revocation_nonce, "capability.revocation_nonce");
    assertCount(input.capability.max_intents, "capability.max_intents", true);
    parseUint64(input.capability.max_spend_uzrn, "capability.max_spend_uzrn");
    parseUint64(input.capability.max_fee_per_intent_uzrn, "capability.max_fee_per_intent_uzrn");
    assertSha256Id(input.signer_key_id, "signer_key_id");
    assertTimestamp(input.created_at, "created_at");
    if (input.reservations.length === 0 || input.reservations.length > 5) {
      fail("invalid_input", "Operation must reserve between one and five treasury purposes");
    }
    const purposes = new Set<string>();
    for (const [index, reservation] of input.reservations.entries()) {
      assertPurpose(reservation.purpose, `reservations[${index}].purpose`);
      parseUint64(reservation.amount_uzrn, `reservations[${index}].amount_uzrn`, true);
      if (purposes.has(reservation.purpose)) {
        fail("invalid_input", "Each treasury purpose may appear at most once per operation");
      }
      purposes.add(reservation.purpose);
    }
  }

  private observeAccount(snapshot: ZeroneAccountSnapshot, allowHalted: boolean): void {
    const existing = this.db.query(`
      SELECT * FROM account_states WHERE chain_id = ? AND source_account = ?
    `).get(snapshot.chain_id, snapshot.account) as AccountStateRow | null;
    if (existing !== null) {
      if (!allowHalted && existing.halted === 1) {
        fail("sequence_fenced", "Account is halted by unresolved reorg evidence");
      }
      if (allowHalted && existing.halted === 1) {
        if (
          existing.halted_at_height === null
          || existing.halt_evidence_id === null
          || existing.halted_at === null
          || BigInt(snapshot.observed_at_height) <= BigInt(existing.halted_at_height)
          || Date.parse(snapshot.observed_at) <= Date.parse(existing.halted_at)
        ) {
          fail(
            "evidence_rejected",
            "Account sequence evidence is not causally newer than the durable reorg halt epoch",
          );
        }
      }
      if (existing.account_number !== snapshot.account_number) {
        fail("evidence_rejected", "Account number changed for an existing Zerone account state");
      }
      if (
        existing.public_key_type_url !== null
        && (
          snapshot.public_key_type_url !== existing.public_key_type_url
          || snapshot.public_key_b64u !== existing.public_key_b64u
        )
      ) {
        fail("evidence_rejected", "Registered account public key changed or became unset");
      }
      assertNotBefore(snapshot.observed_at, existing.observed_at, "Account observation");
      if (
        snapshot.observed_at === existing.observed_at
        && snapshot.valid_until !== existing.valid_until
      ) {
        fail("evidence_rejected", "An identical-time account observation cannot extend freshness");
      }
      const oldHeight = BigInt(existing.observed_at_height);
      const nextHeight = BigInt(snapshot.observed_at_height);
      if (nextHeight < oldHeight || BigInt(snapshot.sequence) < BigInt(existing.sequence)) {
        fail("evidence_rejected", "Account observation regresses durable height or sequence");
      }
      if (
        nextHeight === oldHeight
        && (
          snapshot.block_hash !== existing.block_hash
          || snapshot.sequence !== existing.sequence
          || snapshot.balance_uzrn !== existing.balance_uzrn
          || snapshot.public_key_type_url !== existing.public_key_type_url
          || snapshot.public_key_b64u !== existing.public_key_b64u
        )
      ) {
        fail("evidence_rejected", "Same-height account observation conflicts with durable canonical bytes");
      }
      this.db.query(`
        UPDATE account_states SET sequence = ?, balance_uzrn = ?, observed_at_height = ?,
          block_hash = ?, public_key_type_url = ?, public_key_b64u = ?, valid_until = ?,
          revision = revision + 1, observed_at = ?
        WHERE chain_id = ? AND source_account = ? AND revision = ?
      `).run(
        snapshot.sequence,
        snapshot.balance_uzrn,
        snapshot.observed_at_height,
        snapshot.block_hash,
        snapshot.public_key_type_url,
        snapshot.public_key_b64u,
        snapshot.valid_until,
        snapshot.observed_at,
        snapshot.chain_id,
        snapshot.account,
        existing.revision,
      );
      return;
    }
    this.db.query(`
      INSERT INTO account_states (
        chain_id, source_account, account_number, sequence, balance_uzrn,
        observed_at_height, block_hash, public_key_type_url, public_key_b64u,
        valid_until, halted, halted_at_height,
        halt_evidence_id, halted_at, revision, observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, 1, ?)
    `).run(
      snapshot.chain_id,
      snapshot.account,
      snapshot.account_number,
      snapshot.sequence,
      snapshot.balance_uzrn,
      snapshot.observed_at_height,
      snapshot.block_hash,
      snapshot.public_key_type_url,
      snapshot.public_key_b64u,
      snapshot.valid_until,
      snapshot.observed_at,
    );
  }

  private capabilityRow(id: Sha256Id): CapabilityUsageRow | null {
    return this.db.query("SELECT * FROM capability_usage WHERE capability_record_id = ?")
      .get(id) as CapabilityUsageRow | null;
  }

  getCapabilityUsage(id: Sha256Id): CapabilityUsageSnapshot | null {
    assertSha256Id(id, "capability_record_id");
    const row = this.capabilityRow(id);
    if (row === null) return null;
    return Object.freeze({
      capability_record_id: row.capability_record_id,
      reserved_intents: row.reserved_intents,
      consumed_intents: row.consumed_intents,
      reserved_spend_uzrn: row.reserved_spend_uzrn,
      consumed_spend_uzrn: row.consumed_spend_uzrn,
      version: row.version,
    });
  }

  private windowUsage(
    chainId: ZeroneCaip2,
    account: ZeroneAccountId,
    windowStart: string,
  ): Record<TreasuryPurpose | "total", bigint> {
    const rows = this.db.query(`
      SELECT r.purpose, r.amount_uzrn
      FROM treasury_reservations r
      JOIN operations o ON o.operation_id = r.operation_id
      WHERE o.chain_id = ? AND o.source_account = ? AND o.window_start_height = ?
        AND o.status <> 'released_pre_sign'
        AND (o.signer_invoked = 1 OR o.status = 'reserved')
    `).all(chainId, account, windowStart) as Array<{ purpose: TreasuryPurpose; amount_uzrn: string }>;
    const usage: Record<TreasuryPurpose | "total", bigint> = {
      compute: 0n,
      knowledge_bond: 0n,
      network_fee: 0n,
      sponsorship_escrow: 0n,
      storage: 0n,
      total: 0n,
    };
    for (const row of rows) {
      const amount = BigInt(row.amount_uzrn);
      usage[row.purpose] += amount;
      usage.total += amount;
    }
    return usage;
  }

  private accountExposure(chainId: ZeroneCaip2, account: ZeroneAccountId): bigint {
    const rows = this.db.query(`
      SELECT r.amount_uzrn
      FROM treasury_reservations r
      JOIN operations o ON o.operation_id = r.operation_id
      WHERE o.chain_id = ? AND o.source_account = ? AND r.state IN ('reserved', 'sticky')
    `).all(chainId, account) as Array<{ amount_uzrn: string }>;
    return bigintSum(rows.map(({ amount_uzrn }) => amount_uzrn));
  }

  private maximumActiveReserveFloor(
    chainId: ZeroneCaip2,
    account: ZeroneAccountId,
    candidate: bigint,
  ): bigint {
    const rows = this.db.query(`
      SELECT DISTINCT o.reserve_floor_uzrn
      FROM operations o
      JOIN treasury_reservations r ON r.operation_id = o.operation_id
      WHERE o.chain_id = ? AND o.source_account = ? AND r.state IN ('reserved', 'sticky')
    `).all(chainId, account) as Array<{ reserve_floor_uzrn: string }>;
    return rows.reduce(
      (maximum, { reserve_floor_uzrn }) => {
        const value = BigInt(reserve_floor_uzrn);
        return value > maximum ? value : maximum;
      },
      candidate,
    );
  }

  getOperation(operationId: string): OperationSnapshot | null {
    assertIdentifier(operationId, "operation_id");
    const row = this.operationRow(operationId);
    return row === null ? null : this.operationRowToSnapshot(row);
  }

  private getOperationOrFail(operationId: string): OperationSnapshot {
    const row = this.operationRow(operationId);
    if (row === null) fail("not_found", "Operation was not found");
    return this.operationRowToSnapshot(row);
  }

  private operationRow(operationId: string): OperationRow | null {
    return this.db.query("SELECT * FROM operations WHERE operation_id = ?")
      .get(operationId) as OperationRow | null;
  }

  private reservationRows(operationId: string): ReservationRow[] {
    return this.db.query(`
      SELECT operation_id, purpose, amount_uzrn, state
      FROM treasury_reservations WHERE operation_id = ? ORDER BY purpose
    `).all(operationId) as ReservationRow[];
  }

  private operationRowToSnapshot(row: OperationRow): OperationSnapshot {
    return Object.freeze({
      operation_id: row.operation_id,
      operation_kind: row.operation_kind,
      revision: row.revision,
      status: row.status,
      wallet_id: row.wallet_id,
      binding_id: row.binding_id,
      proof_id: row.proof_id,
      currentness_id: row.currentness_id,
      binding_head_version: row.binding_head_version,
      descriptor_id: row.descriptor_id,
      capability_record_id: row.capability_record_id,
      capability_revocation_nonce: row.capability_revocation_nonce,
      authorization_verification_id: row.authorization_verification_id,
      intent_record_id: row.intent_record_id,
      simulation_record_id: row.simulation_record_id,
      plan_reference_id: row.plan_reference_id,
      treasury_policy_id: row.treasury_policy_id,
      chain_id: row.chain_id,
      source_account: row.source_account,
      account_number: row.account_number,
      sequence: row.sequence,
      signer_key_id: row.signer_key_id,
      signer_invoked: row.signer_invoked === 1,
      tx_hash: row.tx_hash,
      signed_payload_hash: row.signed_payload_hash,
      signed_verification_id: row.signed_verification_id,
      inclusion_height: row.inclusion_height,
      inclusion_block_hash: row.inclusion_block_hash,
      inclusion_code: row.inclusion_code,
      unresolved_reorg_event_sequence: row.unresolved_reorg_event_sequence,
      unresolved_reorg_evidence_id: row.unresolved_reorg_evidence_id,
      event_count: row.event_count,
      event_head_hash: row.event_head_hash,
      created_at: row.created_at,
      updated_at: row.updated_at,
      execution_support: EXECUTION_SUPPORT,
      reservations: Object.freeze(this.reservationRows(row.operation_id).map((reservation) => Object.freeze({
        purpose: reservation.purpose,
        amount_uzrn: reservation.amount_uzrn,
        state: reservation.state,
      }))),
    });
  }

  private appendEvent(
    operationId: string,
    kind: string,
    at: string,
    details: Readonly<Record<string, unknown>>,
  ): void {
    assertTimestamp(at, "event.at");
    const operation = this.operationRow(operationId);
    if (operation === null) fail("not_found", "Cannot append event for an absent operation");
    if (operation.updated_at !== at) {
      fail("integrity_error", "Operation update and appended event timestamps do not agree");
    }
    assertNotBefore(at, operation.created_at, "Operation event");
    const priorEvent = this.db.query(`
      SELECT at FROM operation_events WHERE operation_id = ? ORDER BY sequence DESC LIMIT 1
    `).get(operationId) as { at: string } | null;
    if (priorEvent !== null) assertNotBefore(at, priorEvent.at, "Operation event");
    const sequence = operation.event_count + 1;
    const ledgerSequence = ((this.db.query(`
      SELECT COALESCE(MAX(ledger_sequence), 0) + 1 AS next_sequence FROM operation_events
    `).get() as { next_sequence: number } | null)?.next_sequence ?? 1);
    const previous = operation.event_head_hash;
    const hash = eventHash({
      ledger_sequence: ledgerSequence,
      operation_id: operationId,
      sequence,
      kind,
      at,
      details,
      previous_event_hash: previous,
    });
    this.db.query(`
      INSERT INTO operation_events (
        ledger_sequence, operation_id, sequence, kind, at, details_json,
        previous_event_hash, event_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ledgerSequence,
      operationId,
      sequence,
      kind,
      at,
      canonicalJson(details),
      previous,
      hash,
    );
    const updated = this.db.query(`
      UPDATE operations SET event_count = ?, event_head_hash = ?
      WHERE operation_id = ? AND event_count = ? AND event_head_hash = ?
    `).run(sequence, hash, operationId, operation.event_count, previous);
    if (updated.changes !== 1) fail("conflict", "Operation event-head compare-and-swap lost its race");
  }

  listEvents(operationId: string): OperationEvent[] {
    assertIdentifier(operationId, "operation_id");
    return (this.db.query(`
      SELECT ledger_sequence, operation_id, sequence, kind, at, details_json,
        previous_event_hash, event_hash
      FROM operation_events WHERE operation_id = ? ORDER BY sequence
    `).all(operationId) as EventRow[]).map((row) => Object.freeze({
      ledger_sequence: row.ledger_sequence,
      operation_id: row.operation_id,
      sequence: row.sequence,
      kind: row.kind,
      at: row.at,
      details: Object.freeze(JSON.parse(row.details_json) as Record<string, unknown>),
      previous_event_hash: row.previous_event_hash,
      event_hash: row.event_hash,
    }));
  }

  private replayLifecycle(
    operation: OperationRow,
    rows: readonly EventRow[],
    detailsBySequence: readonly Readonly<Record<string, unknown>>[],
  ): ReplayedLifecycle {
    const requireStatus = (
      kind: string,
      status: OperationStatus,
      allowed: readonly OperationStatus[],
    ): void => {
      if (!allowed.includes(status)) {
        fail("integrity_error", `Event ${kind} is invalid after ${status}: ${operation.operation_id}`);
      }
    };
    const observation = (
      details: Readonly<Record<string, unknown>>,
      sequenceKey: string,
      blockHashKey: string,
      label: string,
    ): ZeroneAccountSnapshot => validateAccountSnapshot({
      chain_id: eventString(details, "chain_id", label) as ZeroneCaip2,
      account: eventString(details, "source_account", label) as ZeroneAccountId,
      account_number: eventString(details, "account_number", label),
      sequence: eventString(details, sequenceKey, label),
      balance_uzrn: eventString(details, "balance_uzrn", label),
      observed_at_height: eventString(details, "observed_at_height", label),
      block_hash: eventString(details, blockHashKey, label),
      observed_at: eventString(details, "observation_at", label),
      public_key_type_url: eventNullableString(
        details,
        "account_public_key_type_url",
        label,
      ) as ZeroneAccountSnapshot["public_key_type_url"],
      public_key_b64u: eventNullableString(details, "account_public_key_b64u", label),
      valid_until: eventString(details, "account_valid_until", label),
    });

    if (rows.length === 0 || rows[0]?.kind !== "reserved" || detailsBySequence[0] === undefined) {
      fail("integrity_error", `Operation lifecycle has no reservation genesis: ${operation.operation_id}`);
    }
    const observations: ZeroneAccountSnapshot[] = [
      observation(detailsBySequence[0], "sequence", "observation_block_hash", "reserved"),
    ];
    let status: OperationStatus = "reserved";
    let signerInvoked = 0;
    let requestId: string | null = null;
    let unsignedPayloadHash: Sha256Id | null = null;
    let signingVerificationId: Sha256Id | null = null;
    let txHash: string | null = null;
    let signedPayloadHash: Sha256Id | null = null;
    let signedVerificationId: Sha256Id | null = null;
    let inclusionHeight: string | null = null;
    let inclusionBlockHash: string | null = null;
    let inclusionCode: number | null = null;
    let inclusionCodespace: string | null = null;
    let releaseEvidenceId: Sha256Id | null = null;
    let releaseAt: string | null = null;
    let unresolvedReorg: ReplayedReorgEpoch | null = null;
    const reorgEpochs: ReplayedReorgEpoch[] = [];

    for (let index = 1; index < rows.length; index += 1) {
      const row = rows[index] as EventRow;
      const details = detailsBySequence[index] as Readonly<Record<string, unknown>>;
      const label = `event ${row.kind}`;
      switch (row.kind) {
        case "signer_invocation_boundary": {
          requireStatus(row.kind, status, ["reserved"]);
          assertEventShape(details, [
            "request_id", "unsigned_payload_hash", "external_verification_id",
            "binding_id", "proof_id", "currentness_id", "binding_head_version",
            "chain_id", "source_account", "account_number", "account_sequence",
            "balance_uzrn", "observed_at_height", "observation_block_hash",
            "observation_at", "account_public_key_type_url", "account_public_key_b64u",
            "account_valid_until",
            ...(operation.operation_kind === "zerone_economy" ? [
              "authorization_trust_boundary", "economy_commitment_id",
              "economy_commitment_json",
            ] : []),
          ], label);
          requestId = eventString(details, "request_id", label);
          assertIdentifier(requestId, `${label}.request_id`);
          unsignedPayloadHash = eventString(details, "unsigned_payload_hash", label) as Sha256Id;
          signingVerificationId = eventString(details, "external_verification_id", label) as Sha256Id;
          assertSha256Id(unsignedPayloadHash, `${label}.unsigned_payload_hash`);
          assertSha256Id(signingVerificationId, `${label}.external_verification_id`);
          if (operation.operation_kind === "zerone_economy") {
            const economyCommitmentIdValue = eventString(
              details,
              "economy_commitment_id",
              label,
            ) as Sha256Id;
            const economyCommitmentJson = eventString(
              details,
              "economy_commitment_json",
              label,
            );
            assertSha256Id(economyCommitmentIdValue, `${label}.economy_commitment_id`);
            const economyCommitment = parseEconomyCommitment(economyCommitmentJson);
            if (
              eventString(details, "authorization_trust_boundary", label)
                !== ECONOMY_AUTHORIZATION_BOUNDARY
              || economyCommitment.commitment_id !== economyCommitmentIdValue
              || signingVerificationId !== economyCommitmentIdValue
              || requestId !== economyCommitment.request_id
              || unsignedPayloadHash !== economyCommitment.sign_doc_bytes_hash
              || row.at !== economyCommitment.requested_at
            ) {
              fail("integrity_error", `Economy signer event changed its exact commitment: ${operation.operation_id}`);
            }
          }
          const signerBindingId = eventString(details, "binding_id", label) as Sha256Id;
          const signerProofId = eventString(details, "proof_id", label) as Sha256Id;
          const signerCurrentnessId = eventString(details, "currentness_id", label) as Sha256Id;
          const signerHeadVersion = eventSafeCount(details, "binding_head_version", label);
          assertSha256Id(signerBindingId, `${label}.binding_id`);
          assertSha256Id(signerProofId, `${label}.proof_id`);
          assertSha256Id(signerCurrentnessId, `${label}.currentness_id`);
          const signerObservation = observation(
            details,
            "account_sequence",
            "observation_block_hash",
            label,
          );
          if (
            signerObservation.chain_id !== operation.chain_id
            || signerObservation.account !== operation.source_account
            || signerObservation.account_number !== operation.account_number
            || signerObservation.sequence !== operation.sequence
            || Date.parse(row.at) < Date.parse(signerObservation.observed_at)
          ) {
            fail(
              "integrity_error",
              `Signer event does not bind the reserved account sequence: ${operation.operation_id}`,
            );
          }
          const signerAuthority = this.bindingHistoryAt(operation.wallet_id, row.at);
          if (signerAuthority === null) {
            fail("integrity_error", `Signer event has no historical binding head: ${operation.operation_id}`);
          }
          const signerProof = verifyWalletIdentityBindingProofEnvelope(
            JSON.parse(signerAuthority.proof_envelope_json),
          );
          const signerCurrentness = validateBindingCurrentnessAssertion(
            JSON.parse(signerAuthority.currentness_json) as BindingCurrentnessAssertion,
          );
          if (
            signerBindingId !== operation.binding_id
            || signerProofId !== operation.proof_id
            || signerCurrentnessId !== operation.currentness_id
            || signerHeadVersion !== operation.binding_head_version
            || signerAuthority.binding_id !== operation.binding_id
            || signerAuthority.proof_id !== operation.proof_id
            || signerAuthority.currentness_id !== operation.currentness_id
            || signerAuthority.head_version !== operation.binding_head_version
            || signerProof.binding.wallet_descriptor_id !== operation.descriptor_id
            || signerProof.binding.zerone_signer.key_id !== operation.signer_key_id
            || signerCurrentness.wallet_revocation_nonce !== operation.capability_revocation_nonce
            || Date.parse(row.at) < Date.parse(signerCurrentness.verified_at)
            || Date.parse(row.at) >= Date.parse(signerCurrentness.valid_until)
          ) {
            fail(
              "integrity_error",
              `Signer event did not use the current historical binding head: ${operation.operation_id}`,
            );
          }
          const operationExposure = bigintSum(this.reservationRows(operation.operation_id)
            .map(({ amount_uzrn }) => amount_uzrn));
          if (
            BigInt(signerObservation.balance_uzrn)
            < operationExposure + BigInt(operation.reserve_floor_uzrn)
          ) {
            fail(
              "integrity_error",
              `Signer event violates the committed treasury reserve floor: ${operation.operation_id}`,
            );
          }
          observations.push(signerObservation);
          signerInvoked = 1;
          status = "signing";
          break;
        }
        case "signing_unknown": {
          requireStatus(row.kind, status, ["signing"]);
          assertEventShape(details, ["reason"], label);
          assertIdentifier(eventString(details, "reason", label), `${label}.reason`);
          status = "signing_unknown";
          break;
        }
        case "verified_signed_evidence": {
          if (operation.operation_kind !== "generic_injected") {
            fail(
              "integrity_error",
              `Generic signed evidence advanced a typed operation: ${operation.operation_id}`,
            );
          }
          requireStatus(row.kind, status, ["signing", "signing_unknown"]);
          assertEventShape(details, [
            "tx_hash", "signed_payload_hash", "external_verification_id",
            "recovered_from_unknown",
          ], label);
          const recoveredFromUnknown = eventBoolean(details, "recovered_from_unknown", label);
          if (recoveredFromUnknown !== (status === "signing_unknown")) {
            fail("integrity_error", `Signed evidence has an invalid recovery flag: ${operation.operation_id}`);
          }
          txHash = eventString(details, "tx_hash", label);
          signedPayloadHash = eventString(details, "signed_payload_hash", label) as Sha256Id;
          signedVerificationId = eventString(details, "external_verification_id", label) as Sha256Id;
          assertTxHash(txHash, `${label}.tx_hash`);
          assertSha256Id(signedPayloadHash, `${label}.signed_payload_hash`);
          assertSha256Id(signedVerificationId, `${label}.external_verification_id`);
          status = "signed";
          break;
        }
        case "verified_zerone_economy_signed_transaction": {
          if (operation.operation_kind !== "zerone_economy") {
            fail(
              "integrity_error",
              `Typed signed transaction advanced a generic operation: ${operation.operation_id}`,
            );
          }
          requireStatus(row.kind, status, ["signing", "signing_unknown"]);
          assertEventShape(details, [
            "economy_commitment_id", "signed_transaction_content_id",
            "signed_transaction_json", "tx_hash", "tx_bytes_hash",
            "sign_doc_bytes_hash", "request_id", "recovered_from_unknown",
            "network_effects_performed", "local_durable_effect",
          ], label);
          const recoveredFromUnknown = eventBoolean(
            details,
            "recovered_from_unknown",
            label,
          );
          if (recoveredFromUnknown !== (status === "signing_unknown")) {
            fail(
              "integrity_error",
              `Typed signed transaction has an invalid recovery flag: ${operation.operation_id}`,
            );
          }
          const recordJson = eventString(details, "signed_transaction_json", label);
          let record: ZeroneEconomySignedTransactionRecord;
          try {
            const parsed = JSON.parse(recordJson) as unknown;
            record = verifyZeroneEconomySignedTransactionRecord(parsed);
            if (canonicalJson(record) !== recordJson) {
              fail(
                "integrity_error",
                `Typed signed-transaction event is not canonical: ${operation.operation_id}`,
              );
            }
          } catch (error) {
            if (error instanceof ZeroneAgentHostError) throw error;
            fail(
              "integrity_error",
              `Typed signed-transaction event does not cryptographically verify: ${operation.operation_id}`,
            );
          }
          const commitmentRow = this.db.query(`
            SELECT * FROM economy_operation_commitments WHERE operation_id = ?
          `).get(operation.operation_id) as EconomyCommitmentRow | null;
          if (commitmentRow === null) {
            fail(
              "integrity_error",
              `Typed signed-transaction event lost its economy commitment: ${operation.operation_id}`,
            );
          }
          const commitment = parseEconomyCommitment(commitmentRow.commitment_json);
          const eventCommitmentId = eventString(
            details,
            "economy_commitment_id",
            label,
          ) as Sha256Id;
          const eventContentId = eventString(
            details,
            "signed_transaction_content_id",
            label,
          ) as Sha256Id;
          const eventTxHash = eventString(details, "tx_hash", label);
          const eventTxBytesHash = eventString(details, "tx_bytes_hash", label) as Sha256Id;
          const eventSignDocHash = eventString(
            details,
            "sign_doc_bytes_hash",
            label,
          ) as Sha256Id;
          const eventRequestId = eventString(details, "request_id", label);
          assertSha256Id(eventCommitmentId, `${label}.economy_commitment_id`);
          assertSha256Id(eventContentId, `${label}.signed_transaction_content_id`);
          assertTxHash(eventTxHash, `${label}.tx_hash`);
          assertSha256Id(eventTxBytesHash, `${label}.tx_bytes_hash`);
          assertSha256Id(eventSignDocHash, `${label}.sign_doc_bytes_hash`);
          assertUuid(eventRequestId, `${label}.request_id`);
          requireEventBoolean(details, "network_effects_performed", false, label);
          if (
            eventString(details, "local_durable_effect", label)
              !== "portable_signed_transaction_admitted"
            || eventCommitmentId !== commitment.commitment_id
            || eventContentId !== record.content_id
            || eventTxHash !== record.tx_hash
            || eventTxBytesHash !== record.tx_bytes_hash
            || eventSignDocHash !== record.sign_doc_bytes_hash
            || eventRequestId !== record.request_id
            || Date.parse(row.at) < Date.parse(commitment.requested_at)
            || !this.economySignedTransactionMatches(record, operation, commitment)
          ) {
            fail(
              "integrity_error",
              `Typed signed-transaction event changed its committed transaction: ${operation.operation_id}`,
            );
          }
          txHash = record.tx_hash;
          signedPayloadHash = record.tx_bytes_hash;
          signedVerificationId = record.content_id;
          status = "signed";
          break;
        }
        case "broadcast_invocation_boundary": {
          if (operation.operation_kind !== "generic_injected") {
            fail(
              "integrity_error",
              `Generic broadcast boundary advanced a typed operation: ${operation.operation_id}`,
            );
          }
          requireStatus(row.kind, status, ["signed"]);
          assertEventShape(details, ["automatic_retry"], label);
          requireEventBoolean(details, "automatic_retry", false, label);
          status = "submitting";
          break;
        }
        case "submission_unknown": {
          if (operation.operation_kind !== "generic_injected") {
            fail(
              "integrity_error",
              `Generic submission recovery advanced a typed operation: ${operation.operation_id}`,
            );
          }
          requireStatus(row.kind, status, ["submitting"]);
          assertEventShape(details, ["reason", "automatic_retry"], label);
          assertIdentifier(eventString(details, "reason", label), `${label}.reason`);
          requireEventBoolean(details, "automatic_retry", false, label);
          status = "submission_unknown";
          break;
        }
        case "broadcast_accepted":
        case "broadcast_ambiguous":
        case "broadcast_rejected_pre_submit": {
          if (operation.operation_kind !== "generic_injected") {
            fail(
              "integrity_error",
              `Generic broadcast evidence advanced a typed operation: ${operation.operation_id}`,
            );
          }
          requireStatus(row.kind, status, ["submitting", "submission_unknown"]);
          assertEventShape(details, [
            "tx_hash", "evidence_id", "code", "reservation_released",
            "sequence_fence_released", "automatic_retry",
          ], label);
          const eventTxHash = eventString(details, "tx_hash", label);
          const evidenceId = eventString(details, "evidence_id", label) as Sha256Id;
          assertTxHash(eventTxHash, `${label}.tx_hash`);
          assertSha256Id(evidenceId, `${label}.evidence_id`);
          if (eventTxHash !== txHash) {
            fail("integrity_error", `Broadcast event changed the signed transaction: ${operation.operation_id}`);
          }
          const code = eventNullableString(details, "code", label);
          if (row.kind === "broadcast_accepted") {
            if (code !== null) fail("integrity_error", `${label}.code must be null`);
          } else {
            if (code === null) fail("integrity_error", `${label}.code must be present`);
            assertIdentifier(code, `${label}.code`);
          }
          requireEventBoolean(details, "reservation_released", false, label);
          requireEventBoolean(details, "sequence_fence_released", false, label);
          requireEventBoolean(details, "automatic_retry", false, label);
          status = row.kind === "broadcast_accepted"
            ? "submitted"
            : row.kind === "broadcast_ambiguous"
              ? "submission_unknown"
              : "rejected_pre_submit_sticky";
          break;
        }
        case "released_pre_sign": {
          if (operation.operation_kind !== "generic_injected") {
            fail(
              "integrity_error",
              `Generic pre-sign release advanced a typed operation: ${operation.operation_id}`,
            );
          }
          requireStatus(row.kind, status, ["reserved"]);
          assertEventShape(details, ["release_id", "reason"], label);
          releaseEvidenceId = eventString(details, "release_id", label) as Sha256Id;
          releaseAt = row.at;
          assertSha256Id(releaseEvidenceId, `${label}.release_id`);
          assertIdentifier(eventString(details, "reason", label), `${label}.reason`);
          status = "released_pre_sign";
          break;
        }
        case "transaction_inclusion": {
          if (operation.operation_kind !== "generic_injected") {
            fail(
              "integrity_error",
              `Generic inclusion evidence advanced a typed operation: ${operation.operation_id}`,
            );
          }
          requireStatus(row.kind, status, [
            "signed", "submitting", "submission_unknown", "submitted",
            "rejected_pre_submit_sticky", "reorged",
          ]);
          assertEventShape(details, [
            "evidence_id", "tx_hash", "height", "observed_at_height", "block_hash",
            "code", "codespace", "confirmation_depth", "reservation_released",
            "sequence_fence_released",
          ], label);
          const eventTxHash = eventString(details, "tx_hash", label);
          const evidenceId = eventString(details, "evidence_id", label) as Sha256Id;
          const height = eventString(details, "height", label);
          const observedHeight = eventString(details, "observed_at_height", label);
          const blockHash = eventString(details, "block_hash", label);
          const code = eventSafeCount(details, "code", label);
          const codespace = eventString(details, "codespace", label);
          const confirmationDepth = eventSafeCount(details, "confirmation_depth", label);
          assertTxHash(eventTxHash, `${label}.tx_hash`);
          assertSha256Id(evidenceId, `${label}.evidence_id`);
          parseUint64(height, `${label}.height`, true);
          parseUint64(observedHeight, `${label}.observed_at_height`, true);
          assertBlockHash(blockHash, `${label}.block_hash`);
          if (codespace.length > 256 || codespace.includes("\0")) {
            fail("integrity_error", `${label}.codespace is outside its text boundary`);
          }
          if (confirmationDepth < 1) {
            fail("integrity_error", `${label}.confirmation_depth must be positive`);
          }
          requireEventBoolean(details, "reservation_released", false, label);
          requireEventBoolean(details, "sequence_fence_released", false, label);
          if (
            eventTxHash !== txHash
            || BigInt(observedHeight) < BigInt(height) + BigInt(confirmationDepth)
          ) {
            fail("integrity_error", `Transaction inclusion event is not self-consistent: ${operation.operation_id}`);
          }
          if (
            unresolvedReorg !== null
            && (
              BigInt(observedHeight) <= BigInt(unresolvedReorg.observed_at_height)
              || Date.parse(row.at) <= Date.parse(unresolvedReorg.observed_at)
              || (height === inclusionHeight && blockHash === inclusionBlockHash)
            )
          ) {
            fail("integrity_error", `Re-inclusion predates its reorg epoch: ${operation.operation_id}`);
          }
          inclusionHeight = height;
          inclusionBlockHash = blockHash;
          inclusionCode = code;
          inclusionCodespace = codespace;
          status = code === 0 ? "confirmed_success" : "confirmed_failed";
          break;
        }
        case "canonical_reorg": {
          if (operation.operation_kind !== "generic_injected") {
            fail(
              "integrity_error",
              `Generic reorg evidence advanced a typed operation: ${operation.operation_id}`,
            );
          }
          requireStatus(row.kind, status, ["confirmed_success", "confirmed_failed"]);
          assertEventShape(details, [
            "evidence_id", "tx_hash", "prior_inclusion_height",
            "prior_inclusion_block_hash", "canonical_block_hash_at_height",
            "observed_at_height", "account_halted", "sequence_fence_reacquired",
            "conflicting_held_operation_id", "automatic_rebroadcast",
          ], label);
          const eventTxHash = eventString(details, "tx_hash", label);
          const evidenceId = eventString(details, "evidence_id", label) as Sha256Id;
          const priorHeight = eventString(details, "prior_inclusion_height", label);
          const priorHash = eventString(details, "prior_inclusion_block_hash", label);
          const replacementHash = eventString(details, "canonical_block_hash_at_height", label);
          const observedHeight = eventString(details, "observed_at_height", label);
          assertTxHash(eventTxHash, `${label}.tx_hash`);
          assertSha256Id(evidenceId, `${label}.evidence_id`);
          parseUint64(priorHeight, `${label}.prior_inclusion_height`, true);
          parseUint64(observedHeight, `${label}.observed_at_height`, true);
          assertBlockHash(priorHash, `${label}.prior_inclusion_block_hash`);
          assertBlockHash(replacementHash, `${label}.canonical_block_hash_at_height`);
          if (
            eventTxHash !== txHash
            || priorHeight !== inclusionHeight
            || priorHash !== inclusionBlockHash
            || priorHash === replacementHash
            || BigInt(observedHeight) < BigInt(priorHeight)
          ) {
            fail("integrity_error", `Canonical reorg event is not self-consistent: ${operation.operation_id}`);
          }
          const latestOperationObservation = observations.at(-1) as ZeroneAccountSnapshot;
          if (
            BigInt(observedHeight) < BigInt(latestOperationObservation.observed_at_height)
            || Date.parse(row.at) <= Date.parse(latestOperationObservation.observed_at)
          ) {
            fail(
              "integrity_error",
              `Canonical reorg evidence predates durable account observation: ${operation.operation_id}`,
            );
          }
          requireEventBoolean(details, "account_halted", true, label);
          requireEventBoolean(details, "automatic_rebroadcast", false, label);
          const fenceReacquired = eventBoolean(details, "sequence_fence_reacquired", label);
          const conflictingHeldOperationId = eventNullableString(
            details,
            "conflicting_held_operation_id",
            label,
          );
          if (conflictingHeldOperationId !== null) {
            assertIdentifier(conflictingHeldOperationId, `${label}.conflicting_held_operation_id`);
          }
          if (fenceReacquired === (conflictingHeldOperationId !== null)) {
            fail("integrity_error", `Canonical reorg fence evidence is contradictory: ${operation.operation_id}`);
          }
          unresolvedReorg = {
            chain_id: operation.chain_id,
            source_account: operation.source_account,
            observed_at_height: observedHeight,
            evidence_id: evidenceId,
            observed_at: row.at,
            operation_event_sequence: row.sequence,
            ledger_sequence: row.ledger_sequence,
          };
          reorgEpochs.push(unresolvedReorg);
          if (fenceReacquired) {
            releaseEvidenceId = null;
            releaseAt = null;
          }
          status = "reorged";
          break;
        }
        case "sequence_advanced":
        case "observed_zerone_economy_sequence_advance": {
          const typedSequenceEvent = row.kind === "observed_zerone_economy_sequence_advance";
          if (typedSequenceEvent !== (operation.operation_kind === "zerone_economy")) {
            fail(
              "integrity_error",
              `Sequence event crossed its operation authority boundary: ${operation.operation_id}`,
            );
          }
          requireStatus(row.kind, status, [
            "reserved", "signing", "signing_unknown", "signed", "submitting",
            "submission_unknown", "submitted", "rejected_pre_submit_sticky",
            "confirmed_success", "confirmed_failed", "reorged",
          ]);
          assertEventShape(details, [
            "evidence_id", "chain_id", "source_account", "account_number",
            "reserved_sequence", "observed_sequence", "balance_uzrn",
            "observed_at_height", "block_hash", "observation_at",
            "account_public_key_type_url", "account_public_key_b64u",
            "account_valid_until",
            "exposure_released", "sequence_fence_released",
            "account_halt_handoff_operation_id",
            ...(typedSequenceEvent ? ["authentication_boundary", "expected_revision"] : []),
          ], label);
          const evidenceId = eventString(details, "evidence_id", label) as Sha256Id;
          assertSha256Id(evidenceId, `${label}.evidence_id`);
          const accountObservation = observation(
            details,
            "observed_sequence",
            "block_hash",
            label,
          );
          if (
            accountObservation.chain_id !== operation.chain_id
            || accountObservation.account !== operation.source_account
            || accountObservation.account_number !== operation.account_number
            || eventString(details, "reserved_sequence", label) !== operation.sequence
            || BigInt(accountObservation.sequence) <= BigInt(operation.sequence)
            || Date.parse(accountObservation.observed_at) < Date.parse(operation.created_at)
            || (typedSequenceEvent
              ? Date.parse(accountObservation.observed_at) > Date.parse(row.at)
                || Date.parse(row.at) >= Date.parse(accountObservation.valid_until)
              : accountObservation.observed_at !== row.at)
          ) {
            fail("integrity_error", `Sequence event does not advance its operation: ${operation.operation_id}`);
          }
          if (typedSequenceEvent) {
            const expectedRevision = eventSafeCount(details, "expected_revision", label);
            if (
              eventString(details, "authentication_boundary", label)
                !== ECONOMY_SEQUENCE_ADVANCE_EVIDENCE_BOUNDARY
              || expectedRevision !== row.sequence - 1
              || evidenceId !== economySequenceAdvanceEvidenceId({
                operation_id: operation.operation_id,
                expected_revision: expectedRevision,
                reserved_sequence: operation.sequence,
                snapshot: accountObservation,
              })
            ) {
              fail(
                "integrity_error",
                `Typed sequence evidence does not match its observer commitment: ${operation.operation_id}`,
              );
            }
            this.assertTypedSequenceAccountKey(operation, accountObservation);
          }
          if (
            unresolvedReorg !== null
            && (
              BigInt(accountObservation.observed_at_height)
                <= BigInt(unresolvedReorg.observed_at_height)
              || Date.parse(accountObservation.observed_at)
                <= Date.parse(unresolvedReorg.observed_at)
            )
          ) {
            fail("integrity_error", `Sequence evidence predates its reorg epoch: ${operation.operation_id}`);
          }
          requireEventBoolean(details, "exposure_released", true, label);
          const haltHandoff = eventNullableString(
            details,
            "account_halt_handoff_operation_id",
            label,
          );
          if (haltHandoff !== null) {
            assertIdentifier(haltHandoff, `${label}.account_halt_handoff_operation_id`);
          }
          observations.push(accountObservation);
          if (status !== "confirmed_success" && status !== "confirmed_failed") {
            status = "sequence_superseded";
          }
          const sequenceFenceReleased = eventBoolean(
            details,
            "sequence_fence_released",
            label,
          );
          if (sequenceFenceReleased) {
            releaseEvidenceId = evidenceId;
            releaseAt = row.at;
          } else if (unresolvedReorg === null || releaseEvidenceId === null) {
            fail(
              "integrity_error",
              `Sequence event retained a fence outside released-reorg reconciliation: ${operation.operation_id}`,
            );
          }
          unresolvedReorg = null;
          break;
        }
        case "cold_start_recovery": {
          requireStatus(row.kind, status, ["signing", "submitting"]);
          assertEventShape(details, [
            "from_status", "to_status", "wall_clock_clamped",
            "reservation_released", "sequence_fence_released",
          ], label);
          const fromStatus = eventString(details, "from_status", label);
          const toStatus = eventString(details, "to_status", label);
          const wallClockClamped = eventBoolean(details, "wall_clock_clamped", label);
          if (wallClockClamped && row.at !== rows[index - 1]?.at) {
            fail(
              "integrity_error",
              `Clamped recovery event advanced its operation clock: ${operation.operation_id}`,
            );
          }
          requireEventBoolean(details, "reservation_released", false, label);
          requireEventBoolean(details, "sequence_fence_released", false, label);
          if (fromStatus !== status) {
            fail("integrity_error", `Recovery event does not bind its prior state: ${operation.operation_id}`);
          }
          const expectedTarget: OperationStatus = status === "signing"
            ? "signing_unknown"
            : "submission_unknown";
          if (toStatus !== expectedTarget) {
            fail("integrity_error", `Recovery event has an invalid target: ${operation.operation_id}`);
          }
          status = expectedTarget;
          break;
        }
        default:
          fail("integrity_error", `Unknown operation event kind: ${row.kind}`);
      }
    }

    if (
      operation.revision !== rows.length
      || operation.status !== status
      || operation.signer_invoked !== signerInvoked
      || operation.request_id !== requestId
      || operation.unsigned_payload_hash !== unsignedPayloadHash
      || operation.signing_boundary_verification_id !== signingVerificationId
      || operation.tx_hash !== txHash
      || operation.signed_payload_hash !== signedPayloadHash
      || operation.signed_verification_id !== signedVerificationId
      || operation.inclusion_height !== inclusionHeight
      || operation.inclusion_block_hash !== inclusionBlockHash
      || operation.inclusion_code !== inclusionCode
      || operation.inclusion_codespace !== inclusionCodespace
      || operation.unresolved_reorg_event_sequence
        !== (unresolvedReorg?.operation_event_sequence ?? null)
      || operation.unresolved_reorg_evidence_id !== (unresolvedReorg?.evidence_id ?? null)
    ) {
      fail("integrity_error", `Mutable operation state does not replay from events: ${operation.operation_id}`);
    }
    return {
      status,
      signer_invoked: signerInvoked,
      request_id: requestId,
      unsigned_payload_hash: unsignedPayloadHash,
      signing_boundary_verification_id: signingVerificationId,
      tx_hash: txHash,
      signed_payload_hash: signedPayloadHash,
      signed_verification_id: signedVerificationId,
      inclusion_height: inclusionHeight,
      inclusion_block_hash: inclusionBlockHash,
      inclusion_code: inclusionCode,
      inclusion_codespace: inclusionCodespace,
      release_evidence_id: releaseEvidenceId,
      release_at: releaseAt,
      unresolved_reorg: unresolvedReorg,
      reorg_epochs: reorgEpochs,
      observations,
    };
  }

  recordSignerInvocationBoundary(input: SignerInvocationBoundary): OperationSnapshot {
    this.requireLegacyGenericInjected("Generic signer boundary");
    assertIdentifier(input.operation_id, "operation_id");
    assertCount(input.expected_revision, "expected_revision", true);
    assertIdentifier(input.request_id, "request_id");
    assertSha256Id(input.unsigned_payload_hash, "unsigned_payload_hash");
    assertSha256Id(input.external_verification_id, "external_verification_id");
    assertTimestamp(input.at, "at");
    const snapshot = validateAccountSnapshot(input.account_snapshot);
    assertNotBefore(input.at, snapshot.observed_at, "Signer invocation boundary");
    const begin = this.db.transaction((): OperationSnapshot => {
      const operation = this.requireOperation(
        input.operation_id,
        input.expected_revision,
        ["reserved"],
      );
      if (operation.operation_kind !== "generic_injected") {
        fail("authorization_denied", "Economy operations cannot enter signing through the generic boundary");
      }
      const head = this.bindingRow(operation.wallet_id);
      const headCurrentness = head === null
        ? null
        : validateBindingCurrentnessAssertion(
            JSON.parse(head.currentness_json) as BindingCurrentnessAssertion,
          );
      if (
        head === null
        || headCurrentness === null
        || head.binding_id !== operation.binding_id
        || head.proof_id !== operation.proof_id
        || head.currentness_id !== operation.currentness_id
        || head.head_version !== operation.binding_head_version
        || head.descriptor_id !== operation.descriptor_id
        || head.signer_key_id !== operation.signer_key_id
        || head.revocation_nonce !== operation.capability_revocation_nonce
        || Date.parse(input.at) < Date.parse(headCurrentness.verified_at)
        || Date.parse(input.at) >= Date.parse(headCurrentness.valid_until)
      ) {
        fail("authorization_denied", "Current binding/proof authority changed before signer invocation");
      }
      if (
        snapshot.chain_id !== operation.chain_id
        || snapshot.account !== operation.source_account
        || snapshot.account_number !== operation.account_number
        || snapshot.sequence !== operation.sequence
        || Date.parse(input.at) >= Date.parse(snapshot.valid_until)
      ) {
        fail("evidence_rejected", "Sign-time account observation does not bind the reserved sequence");
      }
      const signFence = this.db.query(`
        SELECT state FROM sequence_fences WHERE operation_id = ?
      `).get(operation.operation_id) as { state: "held" | "released" } | null;
      if (signFence?.state !== "held") {
        fail("sequence_fenced", "Operation does not own its account sequence fence at sign boundary");
      }
      this.observeAccount(snapshot, false);
      const exposure = this.accountExposure(operation.chain_id, operation.source_account);
      const floor = this.maximumActiveReserveFloor(
        operation.chain_id,
        operation.source_account,
        BigInt(operation.reserve_floor_uzrn),
      );
      if (BigInt(snapshot.balance_uzrn) < exposure + floor) {
        fail("treasury_denied", "Sign-time balance observation breaches the durable reserve floor");
      }
      const usage = this.capabilityRow(operation.capability_record_id);
      if (
        usage === null
        || usage.reserved_intents < 1
        || usage.revocation_nonce !== operation.capability_revocation_nonce
      ) {
        fail("authorization_denied", "Reserved capability usage is absent or revoked");
      }
      assertNotBefore(input.at, usage.updated_at, "Capability signer boundary");
      const nonFeeSpend = bigintSum(this.reservationRows(operation.operation_id)
        .filter(({ purpose }) => purpose !== "network_fee")
        .map(({ amount_uzrn }) => amount_uzrn));
      const capabilityUpdate = this.db.query(`
        UPDATE capability_usage SET
          reserved_intents = reserved_intents - 1,
          consumed_intents = consumed_intents + 1,
          reserved_spend_uzrn = ?,
          consumed_spend_uzrn = ?,
          version = version + 1,
          updated_at = ?
        WHERE capability_record_id = ? AND version = ?
      `).run(
        (BigInt(usage.reserved_spend_uzrn) - nonFeeSpend).toString(),
        (BigInt(usage.consumed_spend_uzrn) + nonFeeSpend).toString(),
        input.at,
        usage.capability_record_id,
        usage.version,
      );
      if (capabilityUpdate.changes !== 1) {
        fail("conflict", "Capability sign-time compare-and-swap lost its race");
      }
      this.db.query(`
        UPDATE treasury_reservations SET state = 'sticky'
        WHERE operation_id = ? AND state = 'reserved'
      `).run(operation.operation_id);
      const updated = this.db.query(`
        UPDATE operations SET status = 'signing', revision = revision + 1,
          signer_invoked = 1, request_id = ?, unsigned_payload_hash = ?,
          signing_boundary_verification_id = ?, updated_at = ?
        WHERE operation_id = ? AND revision = ? AND status = 'reserved'
      `).run(
        input.request_id,
        input.unsigned_payload_hash,
        input.external_verification_id,
        input.at,
        operation.operation_id,
        operation.revision,
      );
      if (updated.changes !== 1) fail("conflict", "Signer-boundary compare-and-swap lost its race");
      this.appendEvent(operation.operation_id, "signer_invocation_boundary", input.at, {
        request_id: input.request_id,
        unsigned_payload_hash: input.unsigned_payload_hash,
        external_verification_id: input.external_verification_id,
        binding_id: operation.binding_id,
        proof_id: operation.proof_id,
        currentness_id: operation.currentness_id,
        binding_head_version: operation.binding_head_version,
        chain_id: snapshot.chain_id,
        source_account: snapshot.account,
        account_number: snapshot.account_number,
        account_sequence: snapshot.sequence,
        balance_uzrn: snapshot.balance_uzrn,
        observed_at_height: snapshot.observed_at_height,
        observation_block_hash: snapshot.block_hash,
        observation_at: snapshot.observed_at,
        account_public_key_type_url: snapshot.public_key_type_url,
        account_public_key_b64u: snapshot.public_key_b64u,
        account_valid_until: snapshot.valid_until,
      });
      return this.getOperationOrFail(operation.operation_id);
    });
    return this.runImmediate(begin);
  }

  markSigningUnknown(input: {
    readonly operation_id: string;
    readonly expected_revision: number;
    readonly reason: string;
    readonly at: string;
  }): OperationSnapshot {
    assertIdentifier(input.operation_id, "operation_id");
    assertCount(input.expected_revision, "expected_revision", true);
    assertIdentifier(input.reason, "reason");
    assertTimestamp(input.at, "at");
    return this.transitionSimple(
      input.operation_id,
      input.expected_revision,
      ["signing"],
      "signing_unknown",
      "signing_unknown",
      input.at,
      { reason: input.reason },
    );
  }

  recordVerifiedZeroneEconomySignedTransaction(
    input: RecordVerifiedZeroneEconomySignedTransactionInput,
  ): OperationSnapshot {
    const operationId = input.operation_id;
    const expectedRevision = input.expected_revision;
    const suppliedRecord = input.signed_transaction;
    assertIdentifier(operationId, "operation_id");
    assertCount(expectedRevision, "expected_revision", true);
    const apply = this.db.transaction((): OperationSnapshot => {
      const operation = this.requireOperation(
        operationId,
        expectedRevision,
        ["signing", "signing_unknown"],
      );
      if (operation.operation_kind !== "zerone_economy") {
        fail(
          "state_conflict",
          "Typed signed-transaction admission requires a Zerone economy operation",
        );
      }
      const at = this.now();
      assertTimestamp(at, "host now");
      assertNotBefore(at, operation.updated_at, "Economy signed-transaction admission");
      let record: ZeroneEconomySignedTransactionRecord;
      try {
        record = verifyZeroneEconomySignedTransactionRecord(suppliedRecord);
      } catch {
        fail(
          "evidence_rejected",
          "Portable Zerone economy signed transaction did not cryptographically verify",
        );
      }
      const commitmentRow = this.db.query(`
        SELECT * FROM economy_operation_commitments WHERE operation_id = ?
      `).get(operation.operation_id) as EconomyCommitmentRow | null;
      if (commitmentRow === null) {
        fail("integrity_error", "Typed operation has no economy commitment");
      }
      const commitment = parseEconomyCommitment(commitmentRow.commitment_json);
      if (!this.economySignedTransactionMatches(record, operation, commitment)) {
        fail(
          "evidence_rejected",
          "Portable signed transaction does not match the immutable economy operation commitment",
        );
      }
      assertNotBefore(at, commitment.requested_at, "Economy signed-transaction admission");
      const recordJson = canonicalJson(record);
      this.db.query(`
        INSERT INTO economy_signed_transactions (
          operation_id, content_id, plan_id, plan_content_id, intent_record_id,
          request_id, signer_key_id, sign_doc_bytes_hash, tx_bytes_hash, tx_hash,
          admitted_at, record_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        operation.operation_id,
        record.content_id,
        record.plan_id,
        record.plan_content_id,
        record.intent_record_id,
        record.request_id,
        record.signer_key_id,
        record.sign_doc_bytes_hash,
        record.tx_bytes_hash,
        record.tx_hash,
        at,
        recordJson,
      );
      const updated = this.db.query(`
        UPDATE operations SET status = 'signed', revision = revision + 1,
          tx_hash = ?, signed_payload_hash = ?, signed_verification_id = ?, updated_at = ?
        WHERE operation_id = ? AND revision = ? AND status = ?
      `).run(
        record.tx_hash,
        record.tx_bytes_hash,
        record.content_id,
        at,
        operation.operation_id,
        operation.revision,
        operation.status,
      );
      if (updated.changes !== 1) {
        fail("conflict", "Economy signed-transaction compare-and-swap lost its race");
      }
      this.appendEvent(
        operation.operation_id,
        "verified_zerone_economy_signed_transaction",
        at,
        {
          economy_commitment_id: commitment.commitment_id,
          signed_transaction_content_id: record.content_id,
          signed_transaction_json: recordJson,
          tx_hash: record.tx_hash,
          tx_bytes_hash: record.tx_bytes_hash,
          sign_doc_bytes_hash: record.sign_doc_bytes_hash,
          request_id: record.request_id,
          recovered_from_unknown: operation.status === "signing_unknown",
          network_effects_performed: false,
          local_durable_effect: "portable_signed_transaction_admitted",
        },
      );
      return this.getOperationOrFail(operation.operation_id);
    });
    return this.runImmediate(apply);
  }

  recordVerifiedSignedEvidence(input: VerifiedSignedEvidence): OperationSnapshot {
    assertIdentifier(input.operation_id, "operation_id");
    assertCount(input.expected_revision, "expected_revision", true);
    assertTxHash(input.tx_hash);
    assertSha256Id(input.signed_payload_hash, "signed_payload_hash");
    assertSha256Id(input.external_verification_id, "external_verification_id");
    assertTimestamp(input.at, "at");
    const apply = this.db.transaction((): OperationSnapshot => {
      const operation = this.requireOperation(
        input.operation_id,
        input.expected_revision,
        ["signing", "signing_unknown"],
      );
      this.assertGenericLifecycleAdvance(operation, "Generic signed-evidence admission");
      const updated = this.db.query(`
        UPDATE operations SET status = 'signed', revision = revision + 1,
          tx_hash = ?, signed_payload_hash = ?, signed_verification_id = ?, updated_at = ?
        WHERE operation_id = ? AND revision = ? AND status = ?
      `).run(
        input.tx_hash,
        input.signed_payload_hash,
        input.external_verification_id,
        input.at,
        operation.operation_id,
        operation.revision,
        operation.status,
      );
      if (updated.changes !== 1) fail("conflict", "Signed-evidence compare-and-swap lost its race");
      this.appendEvent(operation.operation_id, "verified_signed_evidence", input.at, {
        tx_hash: input.tx_hash,
        signed_payload_hash: input.signed_payload_hash,
        external_verification_id: input.external_verification_id,
        recovered_from_unknown: operation.status === "signing_unknown",
      });
      return this.getOperationOrFail(operation.operation_id);
    });
    return this.runImmediate(apply);
  }

  recordBroadcastInvocationBoundary(input: BroadcastInvocationBoundary): OperationSnapshot {
    assertIdentifier(input.operation_id, "operation_id");
    assertCount(input.expected_revision, "expected_revision", true);
    assertTimestamp(input.at, "at");
    return this.transitionSimple(
      input.operation_id,
      input.expected_revision,
      ["signed"],
      "submitting",
      "broadcast_invocation_boundary",
      input.at,
      { automatic_retry: false },
      (operation) => {
        this.assertGenericLifecycleAdvance(operation, "Generic broadcast boundary");
        if (operation.tx_hash === null) fail("state_conflict", "Signed operation has no transaction hash");
      },
    );
  }

  markSubmissionUnknown(input: {
    readonly operation_id: string;
    readonly expected_revision: number;
    readonly reason: string;
    readonly at: string;
  }): OperationSnapshot {
    assertIdentifier(input.operation_id, "operation_id");
    assertCount(input.expected_revision, "expected_revision", true);
    assertIdentifier(input.reason, "reason");
    assertTimestamp(input.at, "at");
    return this.transitionSimple(
      input.operation_id,
      input.expected_revision,
      ["submitting"],
      "submission_unknown",
      "submission_unknown",
      input.at,
      { reason: input.reason, automatic_retry: false },
      (operation) => {
        this.assertGenericLifecycleAdvance(operation, "Generic submission-unknown transition");
      },
    );
  }

  recordBroadcastEvidence(input: BroadcastEvidence): OperationSnapshot {
    assertIdentifier(input.operation_id, "operation_id");
    assertCount(input.expected_revision, "expected_revision", true);
    if (!["accepted", "ambiguous", "rejected_pre_submit"].includes(input.status)) {
      fail("invalid_input", "broadcast evidence status is not supported");
    }
    assertTxHash(input.tx_hash);
    assertSha256Id(input.evidence_id, "evidence_id");
    assertTimestamp(input.at, "at");
    if (input.status !== "accepted") assertIdentifier(input.code, "code");
    const target: OperationStatus = input.status === "accepted"
      ? "submitted"
      : input.status === "ambiguous"
        ? "submission_unknown"
        : "rejected_pre_submit_sticky";
    return this.transitionSimple(
      input.operation_id,
      input.expected_revision,
      ["submitting", "submission_unknown"],
      target,
      `broadcast_${input.status}`,
      input.at,
      {
        tx_hash: input.tx_hash,
        evidence_id: input.evidence_id,
        code: input.status === "accepted" ? null : input.code,
        reservation_released: false,
        sequence_fence_released: false,
        automatic_retry: false,
      },
      (operation) => {
        this.assertGenericLifecycleAdvance(operation, "Generic broadcast evidence");
        if (operation.tx_hash !== input.tx_hash) {
          fail("evidence_rejected", "Broadcast evidence does not bind the exact signed transaction hash");
        }
      },
    );
  }

  releasePreSign(input: {
    readonly operation_id: string;
    readonly expected_revision: number;
    readonly release_id: Sha256Id;
    readonly reason: string;
    readonly at: string;
  }): OperationSnapshot {
    assertIdentifier(input.operation_id, "operation_id");
    assertCount(input.expected_revision, "expected_revision", true);
    assertSha256Id(input.release_id, "release_id");
    assertIdentifier(input.reason, "reason");
    assertTimestamp(input.at, "at");
    const release = this.db.transaction((): OperationSnapshot => {
      const operation = this.requireOperation(
        input.operation_id,
        input.expected_revision,
        ["reserved"],
      );
      this.assertGenericLifecycleAdvance(operation, "Generic pre-sign release");
      const usage = this.capabilityRow(operation.capability_record_id);
      if (usage === null || usage.reserved_intents < 1) {
        fail("integrity_error", "Reserved capability usage is absent");
      }
      assertNotBefore(input.at, usage.updated_at, "Capability pre-sign release");
      const nonFeeSpend = bigintSum(this.reservationRows(operation.operation_id)
        .filter(({ purpose }) => purpose !== "network_fee")
        .map(({ amount_uzrn }) => amount_uzrn));
      this.db.query(`
        UPDATE capability_usage SET reserved_intents = reserved_intents - 1,
          reserved_spend_uzrn = ?, version = version + 1, updated_at = ?
        WHERE capability_record_id = ? AND version = ?
      `).run(
        (BigInt(usage.reserved_spend_uzrn) - nonFeeSpend).toString(),
        input.at,
        usage.capability_record_id,
        usage.version,
      );
      this.db.query("UPDATE treasury_reservations SET state = 'released' WHERE operation_id = ?")
        .run(operation.operation_id);
      this.releaseFence(operation.operation_id, input.release_id, input.at);
      const updated = this.db.query(`
        UPDATE operations SET status = 'released_pre_sign', revision = revision + 1, updated_at = ?
        WHERE operation_id = ? AND revision = ? AND status = 'reserved'
      `).run(input.at, operation.operation_id, operation.revision);
      if (updated.changes !== 1) fail("conflict", "Pre-sign release compare-and-swap lost its race");
      this.appendEvent(operation.operation_id, "released_pre_sign", input.at, {
        release_id: input.release_id,
        reason: input.reason,
      });
      return this.getOperationOrFail(operation.operation_id);
    });
    return this.runImmediate(release);
  }

  applyTransactionEvidence(input: TransactionEvidence): OperationSnapshot {
    assertIdentifier(input.operation_id, "operation_id");
    assertCount(input.expected_revision, "expected_revision", true);
    if (!["found", "absent", "unavailable"].includes(input.status)) {
      fail("invalid_input", "transaction evidence status is not supported");
    }
    assertSha256Id(input.evidence_id, "evidence_id");
    assertTxHash(input.tx_hash);
    assertTimestamp(input.observed_at, "observed_at");
    if (input.status !== "found") {
      const operation = this.requireOperation(input.operation_id, input.expected_revision, [
        "signed",
        "submitting",
        "submission_unknown",
        "submitted",
        "rejected_pre_submit_sticky",
        "reorged",
      ]);
      this.assertGenericLifecycleAdvance(operation, "Generic transaction lookup");
      if (operation.tx_hash !== input.tx_hash) {
        fail("evidence_rejected", "Transaction lookup does not bind the durable transaction hash");
      }
      assertNotBefore(input.observed_at, operation.updated_at, "Transaction lookup evidence");
      // Absence and unavailability are deliberately nonauthorizing and leave no
      // durable transition that could be mistaken for positive reconciliation.
      return this.operationRowToSnapshot(operation);
    }
    parseUint64(input.height, "evidence.height", true);
    parseUint64(input.observed_at_height, "evidence.observed_at_height", true);
    assertBlockHash(input.block_hash, "evidence.block_hash");
    assertCount(input.code, "evidence.code");
    assertCount(input.confirmation_depth, "evidence.confirmation_depth", true);
    if (
      typeof input.codespace !== "string"
      || input.codespace.length > 256
      || input.codespace.includes("\0")
    ) {
      fail("invalid_input", "evidence.codespace is outside its text boundary");
    }
    if (
      BigInt(input.observed_at_height)
      < BigInt(input.height) + BigInt(input.confirmation_depth)
    ) {
      fail("evidence_rejected", "Transaction inclusion has not reached the requested confirmation depth");
    }
    const apply = this.db.transaction((): OperationSnapshot => {
      const operation = this.requireOperation(input.operation_id, input.expected_revision, [
        "signed",
        "submitting",
        "submission_unknown",
        "submitted",
        "rejected_pre_submit_sticky",
        "reorged",
      ]);
      this.assertGenericLifecycleAdvance(operation, "Generic transaction inclusion");
      if (operation.tx_hash !== input.tx_hash) {
        fail("evidence_rejected", "Positive inclusion does not bind the durable transaction hash");
      }
      if (operation.unresolved_reorg_event_sequence !== null) {
        const fence = this.db.query(`
          SELECT state FROM sequence_fences WHERE operation_id = ?
        `).get(operation.operation_id) as { state: "held" | "released" } | null;
        if (fence?.state !== "held") {
          fail(
            "state_conflict",
            "A reorged operation must own the account sequence fence before re-confirmation",
          );
        }
        const account = this.db.query(`
          SELECT halted_at_height, halted_at FROM account_states
          WHERE chain_id = ? AND source_account = ? AND halted = 1
        `).get(operation.chain_id, operation.source_account) as {
          halted_at_height: string | null;
          halted_at: string | null;
        } | null;
        if (
          account === null
          || account.halted_at_height === null
          || account.halted_at === null
          || BigInt(input.observed_at_height) <= BigInt(account.halted_at_height)
          || Date.parse(input.observed_at) <= Date.parse(account.halted_at)
          || (
            input.height === operation.inclusion_height
            && input.block_hash === operation.inclusion_block_hash
          )
        ) {
          fail(
            "evidence_rejected",
            "Re-confirmation must be causally newer than the reorg and name a new inclusion",
          );
        }
      }
      const target: OperationStatus = input.code === 0 ? "confirmed_success" : "confirmed_failed";
      const updated = this.db.query(`
        UPDATE operations SET status = ?, revision = revision + 1,
          inclusion_height = ?, inclusion_block_hash = ?, inclusion_code = ?,
          inclusion_codespace = ?, updated_at = ?
        WHERE operation_id = ? AND revision = ? AND status = ?
      `).run(
        target,
        input.height,
        input.block_hash,
        input.code,
        input.codespace,
        input.observed_at,
        operation.operation_id,
        operation.revision,
        operation.status,
      );
      if (updated.changes !== 1) fail("conflict", "Inclusion compare-and-swap lost its race");
      this.appendEvent(operation.operation_id, "transaction_inclusion", input.observed_at, {
        evidence_id: input.evidence_id,
        tx_hash: input.tx_hash,
        height: input.height,
        observed_at_height: input.observed_at_height,
        block_hash: input.block_hash,
        code: input.code,
        codespace: input.codespace,
        confirmation_depth: input.confirmation_depth,
        reservation_released: false,
        sequence_fence_released: false,
      });
      return this.getOperationOrFail(operation.operation_id);
    });
    return this.runImmediate(apply);
  }

  applySequenceAdvanceEvidence(input: SequenceAdvanceEvidence): OperationSnapshot {
    assertIdentifier(input.operation_id, "operation_id");
    assertCount(input.expected_revision, "expected_revision", true);
    assertSha256Id(input.evidence_id, "evidence_id");
    assertTimestamp(input.observed_at, "observed_at");
    const snapshot = validateAccountSnapshot(input.snapshot);
    if (snapshot.observed_at !== input.observed_at) {
      fail("invalid_input", "Sequence evidence timestamps do not agree");
    }
    const apply = this.db.transaction((): OperationSnapshot => {
      const operation = this.requireOperation(input.operation_id, input.expected_revision, [
        "reserved",
        "signing",
        "signing_unknown",
        "signed",
        "submitting",
        "submission_unknown",
        "submitted",
        "rejected_pre_submit_sticky",
        "confirmed_success",
        "confirmed_failed",
        "reorged",
      ]);
      this.assertGenericLifecycleAdvance(operation, "Generic sequence-advance evidence");
      return this.applySequenceAdvanceInTransaction({
        operation,
        snapshot,
        evidence_id: input.evidence_id,
        event_at: input.observed_at,
        event_kind: "sequence_advanced",
        typed_expected_revision: null,
      });
    });
    return this.runImmediate(apply);
  }

  async observeAndApplyZeroneEconomySequenceAdvance(
    input: ObserveAndApplyZeroneEconomySequenceAdvanceInput,
  ): Promise<OperationSnapshot> {
    const operationId = input.operation_id;
    const expectedRevision = input.expected_revision;
    assertIdentifier(operationId, "operation_id");
    assertCount(expectedRevision, "expected_revision", true);
    const observeAccount = this.observeEconomyAccount;
    if (observeAccount === null) {
      fail(
        "authorization_denied",
        "Typed sequence observation requires the immutable constructor account observer",
      );
    }
    const beforeObservation = this.requireOperation(operationId, expectedRevision, [
      "reserved",
      "signing",
      "signing_unknown",
      "signed",
      "submitting",
      "submission_unknown",
      "submitted",
      "rejected_pre_submit_sticky",
      "confirmed_success",
      "confirmed_failed",
      "reorged",
    ]);
    if (beforeObservation.operation_kind !== "zerone_economy") {
      fail(
        "authorization_denied",
        "Typed sequence observation requires a Zerone economy operation",
      );
    }
    const observedValue = await observeAccount(beforeObservation.source_account);
    const snapshot = validateAccountSnapshot(observedValue);
    const apply = this.db.transaction((): OperationSnapshot => {
      const operation = this.requireOperation(operationId, expectedRevision, [
        "reserved",
        "signing",
        "signing_unknown",
        "signed",
        "submitting",
        "submission_unknown",
        "submitted",
        "rejected_pre_submit_sticky",
        "confirmed_success",
        "confirmed_failed",
        "reorged",
      ]);
      if (operation.operation_kind !== "zerone_economy") {
        fail(
          "authorization_denied",
          "Typed sequence observation cannot advance a generic operation",
        );
      }
      const at = this.now();
      assertTimestamp(at, "host now");
      assertNotBefore(at, operation.updated_at, "Typed sequence observation");
      assertNotBefore(at, snapshot.observed_at, "Typed sequence observation");
      if (Date.parse(at) >= Date.parse(snapshot.valid_until)) {
        fail("evidence_rejected", "Typed sequence observation expired before application");
      }
      assertNotBefore(
        snapshot.observed_at,
        operation.created_at,
        "Typed sequence observation",
      );
      this.assertTypedSequenceAccountKey(operation, snapshot);
      const evidenceId = economySequenceAdvanceEvidenceId({
        operation_id: operation.operation_id,
        expected_revision: operation.revision,
        reserved_sequence: operation.sequence,
        snapshot,
      });
      return this.applySequenceAdvanceInTransaction({
        operation,
        snapshot,
        evidence_id: evidenceId,
        event_at: at,
        event_kind: "observed_zerone_economy_sequence_advance",
        typed_expected_revision: operation.revision,
      });
    });
    return this.runImmediate(apply);
  }

  applyCanonicalReorgEvidence(input: CanonicalReorgEvidence): OperationSnapshot {
    assertIdentifier(input.operation_id, "operation_id");
    assertCount(input.expected_revision, "expected_revision", true);
    assertSha256Id(input.evidence_id, "evidence_id");
    assertTxHash(input.tx_hash);
    parseUint64(input.prior_inclusion_height, "prior_inclusion_height", true);
    parseUint64(input.observed_at_height, "observed_at_height", true);
    assertBlockHash(input.prior_inclusion_block_hash, "prior_inclusion_block_hash");
    assertBlockHash(input.canonical_block_hash_at_height, "canonical_block_hash_at_height");
    assertTimestamp(input.observed_at, "observed_at");
    if (
      input.prior_inclusion_block_hash === input.canonical_block_hash_at_height
      || BigInt(input.observed_at_height) < BigInt(input.prior_inclusion_height)
    ) {
      fail("evidence_rejected", "Reorg evidence does not positively replace the prior canonical block");
    }
    const apply = this.db.transaction((): OperationSnapshot => {
      const operation = this.requireOperation(
        input.operation_id,
        input.expected_revision,
        ["confirmed_success", "confirmed_failed"],
      );
      this.assertGenericLifecycleAdvance(operation, "Generic canonical-reorg evidence");
      if (
        operation.tx_hash !== input.tx_hash
        || operation.inclusion_height !== input.prior_inclusion_height
        || operation.inclusion_block_hash !== input.prior_inclusion_block_hash
      ) {
        fail("evidence_rejected", "Reorg evidence does not bind the exact confirmed inclusion");
      }
      this.db.query("UPDATE treasury_reservations SET state = 'sticky' WHERE operation_id = ?")
        .run(operation.operation_id);
      const accountState = this.db.query(`
        SELECT * FROM account_states WHERE chain_id = ? AND source_account = ?
      `).get(operation.chain_id, operation.source_account) as AccountStateRow | null;
      if (
        accountState === null
        || BigInt(input.observed_at_height) < BigInt(accountState.observed_at_height)
        || Date.parse(input.observed_at) <= Date.parse(accountState.observed_at)
        || (
          accountState.halted_at_height !== null
          && (
            accountState.halted_at === null
            || BigInt(input.observed_at_height) <= BigInt(accountState.halted_at_height)
            || Date.parse(input.observed_at) <= Date.parse(accountState.halted_at)
          )
        )
      ) {
        fail(
          "evidence_rejected",
          "Reorg evidence must be strictly newer in height and time than durable observations and any halt epoch",
        );
      }
      this.db.query(`
        UPDATE account_states SET halted = 1, halted_at_height = ?, halt_evidence_id = ?,
          halted_at = ?, revision = revision + 1
        WHERE chain_id = ? AND source_account = ?
      `).run(
        input.observed_at_height,
        input.evidence_id,
        input.observed_at,
        operation.chain_id,
        operation.source_account,
      );
      const otherHeld = this.db.query(`
        SELECT operation_id FROM sequence_fences
        WHERE chain_id = ? AND source_account = ? AND state = 'held' AND operation_id <> ?
        LIMIT 1
      `).get(operation.chain_id, operation.source_account, operation.operation_id) as {
        operation_id: string;
      } | null;
      let fenceReacquired = false;
      if (otherHeld === null) {
        this.db.query(`
          UPDATE sequence_fences SET state = 'held', released_at = NULL, release_evidence_id = NULL
          WHERE operation_id = ?
        `).run(operation.operation_id);
        fenceReacquired = true;
      }
      const updated = this.db.query(`
        UPDATE operations SET status = 'reorged', unresolved_reorg_event_sequence = ?,
          unresolved_reorg_evidence_id = ?, revision = revision + 1, updated_at = ?
        WHERE operation_id = ? AND revision = ? AND status = ?
      `).run(
        operation.event_count + 1,
        input.evidence_id,
        input.observed_at,
        operation.operation_id,
        operation.revision,
        operation.status,
      );
      if (updated.changes !== 1) fail("conflict", "Reorg compare-and-swap lost its race");
      this.appendEvent(operation.operation_id, "canonical_reorg", input.observed_at, {
        evidence_id: input.evidence_id,
        tx_hash: input.tx_hash,
        prior_inclusion_height: input.prior_inclusion_height,
        prior_inclusion_block_hash: input.prior_inclusion_block_hash,
        canonical_block_hash_at_height: input.canonical_block_hash_at_height,
        observed_at_height: input.observed_at_height,
        account_halted: true,
        sequence_fence_reacquired: fenceReacquired,
        conflicting_held_operation_id: otherHeld?.operation_id ?? null,
        automatic_rebroadcast: false,
      });
      return this.getOperationOrFail(operation.operation_id);
    });
    return this.runImmediate(apply);
  }

  recoverInterruptedOperations(at: string): number {
    assertTimestamp(at, "recovery.at");
    const recover = this.db.transaction((): number => {
      const rows = this.db.query(`
        SELECT * FROM operations WHERE status IN ('signing', 'submitting') ORDER BY operation_id
      `).all() as OperationRow[];
      for (const operation of rows) {
        const target: OperationStatus = operation.status === "signing"
          ? "signing_unknown"
          : "submission_unknown";
        const recoveryAt = Date.parse(at) < Date.parse(operation.updated_at)
          ? operation.updated_at
          : at;
        const updated = this.db.query(`
          UPDATE operations SET status = ?, revision = revision + 1, updated_at = ?
          WHERE operation_id = ? AND revision = ? AND status = ?
        `).run(target, recoveryAt, operation.operation_id, operation.revision, operation.status);
        if (updated.changes !== 1) fail("conflict", "Cold-start recovery compare-and-swap lost its race");
        this.appendEvent(operation.operation_id, "cold_start_recovery", recoveryAt, {
          from_status: operation.status,
          to_status: target,
          wall_clock_clamped: recoveryAt !== at,
          reservation_released: false,
          sequence_fence_released: false,
        });
      }
      return rows.length;
    });
    return this.runImmediate(recover);
  }

  getAccountState(chainId: ZeroneCaip2, account: ZeroneAccountId): Readonly<{
    sequence: string;
    observed_at_height: string;
    block_hash: string;
    public_key_type_url: ZeroneAccountSnapshot["public_key_type_url"];
    public_key_b64u: string | null;
    valid_until: string;
    halted: boolean;
    halted_at_height: string | null;
    halt_evidence_id: Sha256Id | null;
    held_operation_id: string | null;
  }> | null {
    const row = this.db.query(`
      SELECT * FROM account_states WHERE chain_id = ? AND source_account = ?
    `).get(chainId, account) as AccountStateRow | null;
    if (row === null) return null;
    const fence = this.db.query(`
      SELECT operation_id FROM sequence_fences
      WHERE chain_id = ? AND source_account = ? AND state = 'held'
    `).get(chainId, account) as { operation_id: string } | null;
    return Object.freeze({
      sequence: row.sequence,
      observed_at_height: row.observed_at_height,
      block_hash: row.block_hash,
      public_key_type_url: row.public_key_type_url,
      public_key_b64u: row.public_key_b64u,
      valid_until: row.valid_until,
      halted: row.halted === 1,
      halted_at_height: row.halted_at_height,
      halt_evidence_id: row.halt_evidence_id,
      held_operation_id: fence?.operation_id ?? null,
    });
  }

  getTreasuryExposure(chainId: ZeroneCaip2, account: ZeroneAccountId): string {
    return this.accountExposure(chainId, account).toString();
  }

  /**
   * Rebuild capability counters in global durable-event order. In particular,
   * a typed reserve must commit the exact usage snapshot that existed before
   * that reservation; end-state aggregates alone cannot establish this.
   */
  private verifyCapabilityUsageTimeline(): void {
    const events = this.db.query(`
      SELECT e.ledger_sequence, e.operation_id, e.kind,
        o.operation_kind, o.capability_record_id, o.capability_revocation_nonce
      FROM operation_events e
      JOIN operations o ON o.operation_id = e.operation_id
      ORDER BY e.ledger_sequence
    `).all() as Array<{
      ledger_sequence: number;
      operation_id: string;
      kind: string;
      operation_kind: OperationKind;
      capability_record_id: Sha256Id;
      capability_revocation_nonce: number;
    }>;
    type Usage = {
      reserved_intents: number;
      consumed_intents: number;
      reserved_spend: bigint;
      consumed_spend: bigint;
    };
    type OperationUsage = {
      capability_record_id: Sha256Id;
      non_fee_spend: bigint;
      signer_seen: boolean;
      reservation_active: boolean;
    };
    const usages = new Map<Sha256Id, Usage>();
    const operationUsages = new Map<string, OperationUsage>();
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index] as (typeof events)[number];
      if (event.ledger_sequence !== index + 1) {
        fail("integrity_error", "Capability event ledger sequence is not contiguous");
      }
      const usage = usages.get(event.capability_record_id) ?? {
        reserved_intents: 0,
        consumed_intents: 0,
        reserved_spend: 0n,
        consumed_spend: 0n,
      };
      if (event.kind === "reserved") {
        if (operationUsages.has(event.operation_id)) {
          fail("integrity_error", `Capability reservation event is duplicated: ${event.operation_id}`);
        }
        const nonFeeSpend = bigintSum(this.reservationRows(event.operation_id)
          .filter(({ purpose }) => purpose !== "network_fee")
          .map(({ amount_uzrn }) => amount_uzrn));
        if (event.operation_kind === "zerone_economy") {
          const commitmentRow = this.db.query(`
            SELECT commitment_json FROM economy_operation_commitments WHERE operation_id = ?
          `).get(event.operation_id) as { commitment_json: string } | null;
          if (commitmentRow === null) {
            fail("integrity_error", `Typed capability usage commitment is absent: ${event.operation_id}`);
          }
          const commitment = parseEconomyCommitment(commitmentRow.commitment_json);
          const recorded = JSON.parse(commitment.authorization_usage_json) as {
            revocation_nonce: number;
            intent_count: number;
            spent: Array<{ asset_id: string; amount_atomic: string }>;
            host_verified_approval_ids: unknown[];
          };
          if (
            recorded.revocation_nonce !== event.capability_revocation_nonce
            || recorded.intent_count !== usage.reserved_intents + usage.consumed_intents
            || recorded.spent.length !== 1
            || BigInt(recorded.spent[0]?.amount_atomic ?? "-1")
              !== usage.reserved_spend + usage.consumed_spend
            || recorded.host_verified_approval_ids.length !== 0
          ) {
            fail(
              "integrity_error",
              `Economy authorization usage does not replay before reservation: ${event.operation_id}`,
            );
          }
        }
        usage.reserved_intents += 1;
        usage.reserved_spend += nonFeeSpend;
        operationUsages.set(event.operation_id, {
          capability_record_id: event.capability_record_id,
          non_fee_spend: nonFeeSpend,
          signer_seen: false,
          reservation_active: true,
        });
      } else if (event.kind === "signer_invocation_boundary") {
        const operationUsage = operationUsages.get(event.operation_id);
        if (
          operationUsage === undefined
          || operationUsage.capability_record_id !== event.capability_record_id
          || operationUsage.signer_seen
          || !operationUsage.reservation_active
          || usage.reserved_intents < 1
          || usage.reserved_spend < operationUsage.non_fee_spend
        ) {
          fail("integrity_error", `Capability signer transfer does not replay: ${event.operation_id}`);
        }
        usage.reserved_intents -= 1;
        usage.consumed_intents += 1;
        usage.reserved_spend -= operationUsage.non_fee_spend;
        usage.consumed_spend += operationUsage.non_fee_spend;
        operationUsage.signer_seen = true;
        operationUsage.reservation_active = false;
      } else if (
        event.kind === "released_pre_sign"
        || event.kind === "sequence_advanced"
        || event.kind === "observed_zerone_economy_sequence_advance"
      ) {
        const operationUsage = operationUsages.get(event.operation_id);
        if (
          operationUsage !== undefined
          && !operationUsage.signer_seen
          && operationUsage.reservation_active
        ) {
          if (
            usage.reserved_intents < 1
            || usage.reserved_spend < operationUsage.non_fee_spend
          ) {
            fail("integrity_error", `Capability pre-sign release does not replay: ${event.operation_id}`);
          }
          usage.reserved_intents -= 1;
          usage.reserved_spend -= operationUsage.non_fee_spend;
          operationUsage.reservation_active = false;
        }
      }
      usages.set(event.capability_record_id, usage);
    }
    const durable = this.db.query(`
      SELECT capability_record_id, reserved_intents, consumed_intents,
        reserved_spend_uzrn, consumed_spend_uzrn
      FROM capability_usage ORDER BY capability_record_id
    `).all() as Array<Pick<CapabilityUsageRow,
      "capability_record_id" | "reserved_intents" | "consumed_intents"
      | "reserved_spend_uzrn" | "consumed_spend_uzrn">>;
    if (durable.length !== usages.size) {
      fail("integrity_error", "Capability usage rows do not match the global event replay");
    }
    for (const row of durable) {
      const replay = usages.get(row.capability_record_id);
      if (
        replay === undefined
        || row.reserved_intents !== replay.reserved_intents
        || row.consumed_intents !== replay.consumed_intents
        || BigInt(row.reserved_spend_uzrn) !== replay.reserved_spend
        || BigInt(row.consumed_spend_uzrn) !== replay.consumed_spend
      ) {
        fail("integrity_error", `Capability usage timeline does not reconcile: ${row.capability_record_id}`);
      }
    }
  }

  private verifyAccountTimeline(): void {
    const rows = this.db.query(`
      SELECT e.ledger_sequence, e.operation_id, e.kind, e.at, e.details_json,
        o.chain_id, o.source_account, o.sequence AS reserved_sequence, o.created_at
      FROM operation_events e
      JOIN operations o ON o.operation_id = e.operation_id
      ORDER BY e.ledger_sequence
    `).all() as Array<{
      ledger_sequence: number;
      operation_id: string;
      kind: string;
      at: string;
      details_json: string;
      chain_id: ZeroneCaip2;
      source_account: ZeroneAccountId;
      reserved_sequence: string;
      created_at: string;
    }>;
    const states = new Map<string, {
      chain_id: ZeroneCaip2;
      source_account: ZeroneAccountId;
      halted: boolean;
      held_operation_id: string | null;
      unresolved_reorgs: Set<string>;
      reorg_epochs: Map<string, {
        ledger_sequence: number;
        reserved_sequence: string;
        created_at: string;
        observed_at_height: string;
        evidence_id: Sha256Id;
        observed_at: string;
      }>;
      observation: ZeroneAccountSnapshot | null;
      halted_at_height: string | null;
      halt_evidence_id: Sha256Id | null;
      halted_at: string | null;
      revision: number;
    }>();
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] as (typeof rows)[number];
      if (row.ledger_sequence !== index + 1) {
        fail("integrity_error", "Account event ledger sequence is not contiguous");
      }
      const key = `${row.chain_id}\0${row.source_account}`;
      const state = states.get(key) ?? {
        chain_id: row.chain_id,
        source_account: row.source_account,
        halted: false,
        held_operation_id: null,
        unresolved_reorgs: new Set<string>(),
        reorg_epochs: new Map(),
        observation: null,
        halted_at_height: null,
        halt_evidence_id: null,
        halted_at: null,
        revision: 0,
      };
      const details = JSON.parse(row.details_json) as Record<string, unknown>;
      const applyObservation = (snapshot: ZeroneAccountSnapshot, allowHalted: boolean): void => {
        if (
          snapshot.chain_id !== row.chain_id
          || snapshot.account !== row.source_account
        ) {
          fail("integrity_error", `Account event observation changed its account: ${row.operation_id}`);
        }
        if (!allowHalted && state.halted) {
          fail("integrity_error", `Account observation crossed a durable halt: ${row.operation_id}`);
        }
        if (allowHalted && state.halted) {
          if (
            state.halted_at_height === null
            || state.halted_at === null
            || BigInt(snapshot.observed_at_height) <= BigInt(state.halted_at_height)
            || Date.parse(snapshot.observed_at) <= Date.parse(state.halted_at)
          ) {
            fail("integrity_error", `Account observation predates its durable halt: ${row.operation_id}`);
          }
        }
        const prior = state.observation;
        if (prior !== null) {
          const oldHeight = BigInt(prior.observed_at_height);
          const nextHeight = BigInt(snapshot.observed_at_height);
          if (
            prior.account_number !== snapshot.account_number
            || Date.parse(snapshot.observed_at) < Date.parse(prior.observed_at)
            || (
              snapshot.observed_at === prior.observed_at
              && snapshot.valid_until !== prior.valid_until
            )
            || nextHeight < oldHeight
            || BigInt(snapshot.sequence) < BigInt(prior.sequence)
            || (
              prior.public_key_type_url !== null
              && (
                snapshot.public_key_type_url !== prior.public_key_type_url
                || snapshot.public_key_b64u !== prior.public_key_b64u
              )
            )
            || (
              nextHeight === oldHeight
              && (
                snapshot.block_hash !== prior.block_hash
                || snapshot.sequence !== prior.sequence
                || snapshot.balance_uzrn !== prior.balance_uzrn
                || snapshot.public_key_type_url !== prior.public_key_type_url
                || snapshot.public_key_b64u !== prior.public_key_b64u
              )
            )
          ) {
            fail("integrity_error", `Account observation regresses in ledger order: ${row.operation_id}`);
          }
        }
        state.observation = snapshot;
      };
      switch (row.kind) {
        case "reserved": {
          if (state.halted || state.held_operation_id !== null) {
            fail("integrity_error", `Reservation crossed an account halt or sequence fence: ${row.operation_id}`);
          }
          applyObservation(validateAccountSnapshot({
            chain_id: eventString(details, "chain_id", row.kind) as ZeroneCaip2,
            account: eventString(details, "source_account", row.kind) as ZeroneAccountId,
            account_number: eventString(details, "account_number", row.kind),
            sequence: eventString(details, "sequence", row.kind),
            balance_uzrn: eventString(details, "balance_uzrn", row.kind),
            observed_at_height: eventString(details, "observed_at_height", row.kind),
            block_hash: eventString(details, "observation_block_hash", row.kind),
            observed_at: eventString(details, "observation_at", row.kind),
            public_key_type_url: eventNullableString(
              details,
              "account_public_key_type_url",
              row.kind,
            ) as ZeroneAccountSnapshot["public_key_type_url"],
            public_key_b64u: eventNullableString(
              details,
              "account_public_key_b64u",
              row.kind,
            ),
            valid_until: eventString(details, "account_valid_until", row.kind),
          }), false);
          state.revision += 1;
          state.held_operation_id = row.operation_id;
          break;
        }
        case "signer_invocation_boundary":
          if (state.halted || state.held_operation_id !== row.operation_id) {
            fail("integrity_error", `Signer event crossed an account halt or sequence fence: ${row.operation_id}`);
          }
          applyObservation(validateAccountSnapshot({
            chain_id: eventString(details, "chain_id", row.kind) as ZeroneCaip2,
            account: eventString(details, "source_account", row.kind) as ZeroneAccountId,
            account_number: eventString(details, "account_number", row.kind),
            sequence: eventString(details, "account_sequence", row.kind),
            balance_uzrn: eventString(details, "balance_uzrn", row.kind),
            observed_at_height: eventString(details, "observed_at_height", row.kind),
            block_hash: eventString(details, "observation_block_hash", row.kind),
            observed_at: eventString(details, "observation_at", row.kind),
            public_key_type_url: eventNullableString(
              details,
              "account_public_key_type_url",
              row.kind,
            ) as ZeroneAccountSnapshot["public_key_type_url"],
            public_key_b64u: eventNullableString(
              details,
              "account_public_key_b64u",
              row.kind,
            ),
            valid_until: eventString(details, "account_valid_until", row.kind),
          }), false);
          state.revision += 1;
          break;
        case "released_pre_sign":
          if (state.held_operation_id !== row.operation_id) {
            fail("integrity_error", `Pre-sign release did not own its account fence: ${row.operation_id}`);
          }
          state.held_operation_id = null;
          break;
        case "canonical_reorg": {
          const observedHeight = eventString(details, "observed_at_height", row.kind);
          const evidenceId = eventString(details, "evidence_id", row.kind) as Sha256Id;
          assertSha256Id(evidenceId, "canonical_reorg.evidence_id");
          if (
            state.observation === null
            || BigInt(observedHeight) < BigInt(state.observation.observed_at_height)
            || Date.parse(row.at) <= Date.parse(state.observation.observed_at)
            || (
              state.halted
              && (
                state.halted_at_height === null
                || state.halted_at === null
                || BigInt(observedHeight) <= BigInt(state.halted_at_height)
                || Date.parse(row.at) <= Date.parse(state.halted_at)
              )
            )
          ) {
            fail("integrity_error", `Reorg event is stale in the account timeline: ${row.operation_id}`);
          }
          state.unresolved_reorgs.add(row.operation_id);
          state.reorg_epochs.set(row.operation_id, {
            ledger_sequence: row.ledger_sequence,
            reserved_sequence: row.reserved_sequence,
            created_at: row.created_at,
            observed_at_height: observedHeight,
            evidence_id: evidenceId,
            observed_at: row.at,
          });
          state.halted = true;
          state.halted_at_height = observedHeight;
          state.halt_evidence_id = evidenceId;
          state.halted_at = row.at;
          state.revision += 1;
          const reacquired = eventBoolean(details, "sequence_fence_reacquired", row.kind);
          const conflicting = eventNullableString(
            details,
            "conflicting_held_operation_id",
            row.kind,
          );
          if (reacquired) {
            if (
              state.held_operation_id !== null
              && state.held_operation_id !== row.operation_id
            ) {
              fail("integrity_error", `Reorg event bypassed a conflicting account fence: ${row.operation_id}`);
            }
            state.held_operation_id = row.operation_id;
          } else if (
            state.held_operation_id === null
            || state.held_operation_id === row.operation_id
            || state.held_operation_id !== conflicting
          ) {
            fail("integrity_error", `Reorg event does not bind its conflicting account fence: ${row.operation_id}`);
          }
          break;
        }
        case "transaction_inclusion":
          if (
            state.unresolved_reorgs.has(row.operation_id)
            && (
              state.held_operation_id !== row.operation_id
              || state.halted_at_height === null
              || state.halted_at === null
              || BigInt(eventString(details, "observed_at_height", row.kind))
                <= BigInt(state.halted_at_height)
              || Date.parse(row.at) <= Date.parse(state.halted_at)
            )
          ) {
            fail("integrity_error", `Re-inclusion predates its account halt or fence: ${row.operation_id}`);
          }
          break;
        case "sequence_advanced":
        case "observed_zerone_economy_sequence_advance": {
          applyObservation(validateAccountSnapshot({
            chain_id: eventString(details, "chain_id", row.kind) as ZeroneCaip2,
            account: eventString(details, "source_account", row.kind) as ZeroneAccountId,
            account_number: eventString(details, "account_number", row.kind),
            sequence: eventString(details, "observed_sequence", row.kind),
            balance_uzrn: eventString(details, "balance_uzrn", row.kind),
            observed_at_height: eventString(details, "observed_at_height", row.kind),
            block_hash: eventString(details, "block_hash", row.kind),
            observed_at: eventString(details, "observation_at", row.kind),
            public_key_type_url: eventNullableString(
              details,
              "account_public_key_type_url",
              row.kind,
            ) as ZeroneAccountSnapshot["public_key_type_url"],
            public_key_b64u: eventNullableString(
              details,
              "account_public_key_b64u",
              row.kind,
            ),
            valid_until: eventString(details, "account_valid_until", row.kind),
          }), true);
          state.revision += 2;
          const released = eventBoolean(details, "sequence_fence_released", row.kind);
          if (released) {
            if (state.held_operation_id !== row.operation_id) {
              fail("integrity_error", `Sequence event released a foreign account fence: ${row.operation_id}`);
            }
            state.held_operation_id = null;
          } else if (!state.unresolved_reorgs.has(row.operation_id)) {
            fail("integrity_error", `Sequence event retained a fence without reorg exposure: ${row.operation_id}`);
          }
          state.unresolved_reorgs.delete(row.operation_id);
          state.reorg_epochs.delete(row.operation_id);
          const handoff = eventNullableString(
            details,
            "account_halt_handoff_operation_id",
            row.kind,
          );
          if (state.unresolved_reorgs.size === 0) {
            if (handoff !== null) {
              fail("integrity_error", `Sequence event retained a halt with no reorg exposure: ${row.operation_id}`);
            }
            state.halted = false;
            state.halted_at_height = null;
            state.halt_evidence_id = null;
            state.halted_at = null;
          } else {
            if (handoff === null) {
              fail("integrity_error", `Sequence event dropped an unresolved account halt: ${row.operation_id}`);
            }
            state.halted = true;
            if (state.held_operation_id === null) {
              const oldest = [...state.reorg_epochs.entries()]
                .sort((left, right) => {
                  const sequenceOrder = BigInt(left[1].reserved_sequence)
                    < BigInt(right[1].reserved_sequence)
                    ? -1
                    : BigInt(left[1].reserved_sequence) > BigInt(right[1].reserved_sequence)
                      ? 1
                      : 0;
                  if (sequenceOrder !== 0) return sequenceOrder;
                  const createdOrder = Date.parse(left[1].created_at) - Date.parse(right[1].created_at);
                  if (createdOrder !== 0) return createdOrder;
                  return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
                })
                .at(0)?.[0] ?? null;
              if (handoff !== oldest) {
                fail("integrity_error", `Sequence event did not hand off to the earliest unresolved sequence liability: ${row.operation_id}`);
              }
              state.held_operation_id = handoff;
            } else if (state.held_operation_id !== handoff) {
              fail("integrity_error", `Sequence event misreported its held-fence handoff: ${row.operation_id}`);
            }
            const epochs = [...state.reorg_epochs.values()].sort((left, right) => {
              const heightOrder = BigInt(left.observed_at_height) < BigInt(right.observed_at_height)
                ? -1
                : BigInt(left.observed_at_height) > BigInt(right.observed_at_height)
                  ? 1
                  : 0;
              return heightOrder !== 0
                ? heightOrder
                : Date.parse(left.observed_at) - Date.parse(right.observed_at);
            });
            const latest = epochs.at(-1);
            if (latest === undefined) {
              fail("integrity_error", `Account halt lost its reorg epoch: ${row.operation_id}`);
            }
            state.halted_at_height = latest.observed_at_height;
            state.halt_evidence_id = latest.evidence_id;
            state.halted_at = latest.observed_at;
          }
          break;
        }
        default:
          break;
      }
      states.set(key, state);
    }
    const accountRows = this.db.query("SELECT * FROM account_states")
      .all() as AccountStateRow[];
    for (const account of accountRows) {
      const key = `${account.chain_id}\0${account.source_account}`;
      const state = states.get(key);
      const held = this.db.query(`
        SELECT operation_id FROM sequence_fences
        WHERE chain_id = ? AND source_account = ? AND state = 'held'
      `).get(account.chain_id, account.source_account) as { operation_id: string } | null;
      if (
        state === undefined
        || state.observation === null
        || state.halted !== (account.halted === 1)
        || state.held_operation_id !== (held?.operation_id ?? null)
        || state.observation.account_number !== account.account_number
        || state.observation.sequence !== account.sequence
        || state.observation.balance_uzrn !== account.balance_uzrn
        || state.observation.observed_at_height !== account.observed_at_height
        || state.observation.block_hash !== account.block_hash
        || state.observation.observed_at !== account.observed_at
        || state.observation.public_key_type_url !== account.public_key_type_url
        || state.observation.public_key_b64u !== account.public_key_b64u
        || state.observation.valid_until !== account.valid_until
        || state.halted_at_height !== account.halted_at_height
        || state.halt_evidence_id !== account.halt_evidence_id
        || state.halted_at !== account.halted_at
        || state.revision !== account.revision
      ) {
        fail("integrity_error", `Account halt or fence state does not replay globally: ${account.source_account}`);
      }
    }
    if (states.size !== accountRows.length) {
      fail("integrity_error", "Account event timeline does not match durable account rows");
    }
  }

  verify(): HostVerificationReport {
    this.assertSchema();
    const integrity = this.db.query("PRAGMA integrity_check").get() as {
      integrity_check: string;
    } | null;
    if (integrity?.integrity_check !== "ok") fail("integrity_error", "SQLite integrity_check failed");
    if (this.db.query("PRAGMA foreign_key_check").all().length !== 0) {
      fail("integrity_error", "SQLite foreign-key verification failed");
    }
    const historyRows = this.db.query(`
      SELECT currentness_id, proof_id, wallet_id, head_version, binding_id,
        source_account, proof_envelope_json, currentness_json, recorded_at
      FROM binding_history ORDER BY wallet_id, head_version
    `).all() as BindingHistoryRow[];
    const historyByCurrentness = new Map<Sha256Id, {
      row: BindingHistoryRow;
      binding: WalletIdentityBinding;
      proof: VerifiedWalletIdentityBindingProof;
      currentness: BindingCurrentnessAssertion;
    }>();
    const priorHistoryByWallet = new Map<string, {
      row: BindingHistoryRow;
      binding: WalletIdentityBinding;
      proof: VerifiedWalletIdentityBindingProof;
      currentness: BindingCurrentnessAssertion;
    }>();
    const historicalWalletByAccount = new Map<ZeroneAccountId, string>();
    for (const row of historyRows) {
      const proof = verifyWalletIdentityBindingProofEnvelope(
        JSON.parse(row.proof_envelope_json),
      );
      const binding = proof.binding;
      const currentness = validateBindingCurrentnessAssertion(
        JSON.parse(row.currentness_json) as BindingCurrentnessAssertion,
      );
      assertCount(row.head_version, "stored binding head_version", true);
      assertTimestamp(row.recorded_at, "stored binding recorded_at");
      if (
        canonicalJson(proof) !== row.proof_envelope_json
        || canonicalJson(currentness) !== row.currentness_json
        || binding.wallet_id !== row.wallet_id
        || binding.binding_id !== row.binding_id
        || binding.zerone_account_id !== row.source_account
        || proof.proof_id !== row.proof_id
        || currentness.currentness_id !== row.currentness_id
        || !currentnessMatchesBinding(currentness, binding, proof)
        || Date.parse(currentness.verified_at) < Date.parse(binding.issued_at)
        || Date.parse(row.recorded_at) < Date.parse(currentness.verified_at)
        || Date.parse(row.recorded_at) >= Date.parse(currentness.valid_until)
      ) {
        fail("integrity_error", `Binding history snapshot does not verify: ${row.currentness_id}`);
      }
      const historicalWallet = historicalWalletByAccount.get(binding.zerone_account_id);
      if (historicalWallet !== undefined && historicalWallet !== binding.wallet_id) {
        fail("integrity_error", `Historical source account has multiple wallet owners: ${binding.zerone_account_id}`);
      }
      historicalWalletByAccount.set(binding.zerone_account_id, binding.wallet_id);
      const prior = priorHistoryByWallet.get(row.wallet_id);
      if (prior === undefined) {
        if (row.head_version !== 1 || binding.revision !== 1 || binding.previous_binding_id !== null) {
          fail("integrity_error", `Binding history does not start at genesis: ${row.wallet_id}`);
        }
      } else {
        if (
          row.head_version !== prior.row.head_version + 1
          || Date.parse(row.recorded_at) < Date.parse(prior.row.recorded_at)
          || Date.parse(currentness.verified_at) < Date.parse(prior.row.recorded_at)
          || currentness.wallet_revocation_nonce < prior.currentness.wallet_revocation_nonce
        ) {
          fail("integrity_error", `Binding history chronology regresses: ${row.wallet_id}`);
        }
        if (binding.binding_id === prior.binding.binding_id) {
          if (canonicalJson(binding) !== canonicalJson(prior.binding)) {
            fail("integrity_error", `Binding proof refresh changed canonical binding bytes: ${row.wallet_id}`);
          }
        } else {
          if (Date.parse(binding.issued_at) < Date.parse(prior.row.recorded_at)) {
            fail("integrity_error", `Binding successor issued_at regresses durable history: ${row.wallet_id}`);
          }
          assertWalletIdentityBindingSuccessor(prior.binding, binding);
        }
      }
      const parsed = { row, binding, proof, currentness };
      historyByCurrentness.set(row.currentness_id, parsed);
      priorHistoryByWallet.set(row.wallet_id, parsed);
    }
    const headRows = this.db.query("SELECT * FROM binding_heads ORDER BY wallet_id")
      .all() as BindingHeadRow[];
    const headWallets = new Set<string>();
    for (const row of headRows) {
      headWallets.add(row.wallet_id);
      const head = this.bindingRowToHead(row);
      const history = historyByCurrentness.get(row.currentness_id);
      assertTimestamp(row.updated_at, "stored binding updated_at");
      if (
        canonicalJson(head.proof) !== row.proof_envelope_json
        || canonicalJson(head.currentness) !== row.currentness_json
        || head.binding.binding_id !== row.binding_id
        || head.proof.proof_id !== row.proof_id
        || head.currentness.currentness_id !== row.currentness_id
        || !currentnessMatchesBinding(head.currentness, head.binding, head.proof)
        || Date.parse(row.updated_at) < Date.parse(head.currentness.verified_at)
        || Date.parse(row.updated_at) >= Date.parse(head.currentness.valid_until)
        || head.binding.revision !== row.binding_revision
        || head.binding.wallet_continuity_sequence !== row.continuity_sequence
        || head.currentness.wallet_revocation_nonce !== row.revocation_nonce
        || head.binding.wallet_descriptor_id !== row.descriptor_id
        || head.binding.zerone_signer.key_id !== row.signer_key_id
        || head.binding.zerone_account_id !== row.source_account
        || head.binding.network !== row.network
        || history?.row.wallet_id !== row.wallet_id
        || history.row.head_version !== row.head_version
        || history.row.binding_id !== row.binding_id
        || history.row.proof_id !== row.proof_id
        || history.row.proof_envelope_json !== row.proof_envelope_json
        || history.row.currentness_json !== row.currentness_json
        || history.row.recorded_at !== row.updated_at
        || priorHistoryByWallet.get(row.wallet_id)?.row.currentness_id !== row.currentness_id
      ) {
        fail("integrity_error", `Current binding head does not verify: ${row.wallet_id}`);
      }
    }
    if (
      headWallets.size !== priorHistoryByWallet.size
      || [...priorHistoryByWallet.keys()].some((walletId) => !headWallets.has(walletId))
    ) {
      fail("integrity_error", "Every binding-history wallet must have exactly one current head");
    }
    const accountRows = this.db.query("SELECT * FROM account_states ORDER BY chain_id, source_account")
      .all() as AccountStateRow[];
    for (const row of accountRows) {
      validateAccountSnapshot({
        chain_id: row.chain_id,
        account: row.source_account,
        account_number: row.account_number,
        sequence: row.sequence,
        balance_uzrn: row.balance_uzrn,
        observed_at_height: row.observed_at_height,
        block_hash: row.block_hash,
        observed_at: row.observed_at,
        public_key_type_url: row.public_key_type_url,
        public_key_b64u: row.public_key_b64u,
        valid_until: row.valid_until,
      });
      assertCount(row.revision, "stored account revision", true);
      const completeHaltEpoch = row.halted_at_height !== null
        && row.halt_evidence_id !== null
        && row.halted_at !== null;
      const absentHaltEpoch = row.halted_at_height === null
        && row.halt_evidence_id === null
        && row.halted_at === null;
      if (row.halted === 1 ? !completeHaltEpoch : !absentHaltEpoch) {
        fail("integrity_error", `Account halt epoch is incomplete: ${row.source_account}`);
      }
      if (completeHaltEpoch) {
        parseUint64(row.halted_at_height as string, "stored account halted_at_height", true);
        assertSha256Id(row.halt_evidence_id as Sha256Id, "stored account halt_evidence_id");
        assertTimestamp(row.halted_at as string, "stored account halted_at");
      }
    }
    const operations = this.db.query("SELECT * FROM operations ORDER BY operation_id").all() as OperationRow[];
    if (
      !this.allowLegacyGenericInjectedForTests
      && operations.some(({ operation_kind }) => operation_kind === "generic_injected")
    ) {
      fail(
        "integrity_error",
        "Legacy generic injected operations require the explicit test-only constructor escape hatch",
      );
    }
    const policyByAccount = new Map<string, Sha256Id>();
    const replayedObservations: ZeroneAccountSnapshot[] = [];
    const replayedReorgEpochs: ReplayedReorgEpoch[] = [];
    const unresolvedReorgs: ReplayedReorgEpoch[] = [];
    let eventCount = 0;
    for (const operation of operations) {
      assertIdentifier(operation.operation_id, "stored operation_id");
      if (
        operation.operation_kind !== "generic_injected"
        && operation.operation_kind !== "zerone_economy"
      ) {
        fail("integrity_error", `Stored operation kind is invalid: ${operation.operation_id}`);
      }
      assertCount(operation.revision, "stored operation revision", true);
      assertSha256Id(operation.binding_id, "stored operation binding_id");
      assertSha256Id(operation.proof_id, "stored operation proof_id");
      assertSha256Id(operation.currentness_id, "stored operation currentness_id");
      assertSha256Id(operation.descriptor_id, "stored operation descriptor_id");
      assertSha256Id(operation.capability_record_id, "stored operation capability_record_id");
      assertSha256Id(
        operation.authorization_verification_id,
        "stored authorization_verification_id",
      );
      assertSha256Id(operation.intent_record_id, "stored operation intent_record_id");
      assertSha256Id(operation.simulation_record_id, "stored operation simulation_record_id");
      assertSha256Id(operation.plan_reference_id, "stored operation plan_reference_id");
      assertSha256Id(operation.signer_key_id, "stored operation signer_key_id");
      parseUint64(operation.account_number, "stored operation account_number");
      parseUint64(operation.sequence, "stored operation sequence");
      parseUint64(operation.window_start_height, "stored operation window_start_height");
      parseUint64(operation.reserve_floor_uzrn, "stored operation reserve_floor_uzrn");
      assertTimestamp(operation.created_at, "stored operation created_at");
      assertTimestamp(operation.updated_at, "stored operation updated_at");
      assertNotBefore(operation.updated_at, operation.created_at, "Stored operation");
      const commitmentRow = this.db.query(`
        SELECT * FROM economy_operation_commitments WHERE operation_id = ?
      `).get(operation.operation_id) as EconomyCommitmentRow | null;
      if ((operation.operation_kind === "zerone_economy") !== (commitmentRow !== null)) {
        fail("integrity_error", `Operation economy commitment cardinality is invalid: ${operation.operation_id}`);
      }
      const economyCommitment = commitmentRow === null
        ? null
        : parseEconomyCommitment(commitmentRow.commitment_json);
      if (commitmentRow !== null && economyCommitment !== null) {
        const configuredAdapter = this.trustedSimulationAdapters.get(
          economyCommitment.simulation_adapter_trust_id,
        );
        const configuredBindingVerifier = this.trustedBindingCurrentnessVerifiers.get(
          economyCommitment.binding_verifier_trust_id,
        );
        const committedBindingHistory = historyByCurrentness.get(operation.currentness_id);
        if (
          commitmentRow.operation_id !== economyCommitment.operation_id
          || commitmentRow.commitment_id !== economyCommitment.commitment_id
          || commitmentRow.plan_id !== economyCommitment.plan_id
          || commitmentRow.plan_content_id !== economyCommitment.plan_content_id
          || commitmentRow.message_kind !== economyCommitment.message_kind
          || commitmentRow.message_type_url !== economyCommitment.message_type_url
          || commitmentRow.intent_record_id !== operation.intent_record_id
          || commitmentRow.intent_record_id !== economyCommitment.intent_record_id
          || commitmentRow.simulation_evidence_record_id
            !== economyCommitment.simulation_evidence_record_id
          || commitmentRow.simulation_evidence_json
            !== economyCommitment.simulation_evidence_json
          || commitmentRow.binding_currentness_id
            !== economyCommitment.binding_currentness_id
          || commitmentRow.binding_verifier_trust_id
            !== economyCommitment.binding_verifier_trust_id
          || commitmentRow.sign_doc_bytes_hash !== economyCommitment.sign_doc_bytes_hash
          || commitmentRow.activation_currentness_id
            !== economyCommitment.activation_currentness_id
          || commitmentRow.request_id !== economyCommitment.request_id
          || commitmentRow.requested_at !== economyCommitment.requested_at
          || economyCommitment.operation_id !== operation.operation_id
          || economyCommitment.plan_content_id !== operation.plan_reference_id
          || economyCommitment.authorization_verification_id
            !== operation.authorization_verification_id
          || economyCommitment.binding_currentness_id !== operation.currentness_id
          || economyCommitment.request_id !== operation.request_id
          || economyCommitment.intent_record_id !== operation.intent_record_id
          || economyCommitment.simulation_record_id !== operation.simulation_record_id
          || economyCommitment.chain_id !== operation.chain_id
          || economyCommitment.source_account !== operation.source_account
          || economyCommitment.account_number !== operation.account_number
          || economyCommitment.account_sequence !== operation.sequence
          || economyCommitment.requested_at !== operation.created_at
          || economyCommitment.sign_doc_bytes_hash !== operation.unsigned_payload_hash
          || economyCommitment.commitment_id !== operation.signing_boundary_verification_id
          || committedBindingHistory === undefined
          || committedBindingHistory.row.currentness_id
            !== economyCommitment.binding_currentness_id
          || committedBindingHistory.row.currentness_json
            !== economyCommitment.binding_currentness_json
          || committedBindingHistory.row.binding_id !== operation.binding_id
          || committedBindingHistory.row.proof_id !== operation.proof_id
          || (economyCommitment.account_public_key_b64u !== null
            && economyCommitment.account_public_key_b64u
              !== committedBindingHistory.binding.zerone_signer.public_key_b64u)
          || operation.signer_invoked !== 1
          || !this.trustedActivationVerifierIds.has(economyCommitment.activation_verifier_id)
          || configuredAdapter === undefined
          || canonicalJson(configuredAdapter)
            !== economyCommitment.simulation_adapter_trust_json
          || configuredBindingVerifier === undefined
          || canonicalJson(configuredBindingVerifier)
            !== economyCommitment.binding_verifier_trust_json
          || Date.parse(economyCommitment.requested_at)
            < Date.parse(economyCommitment.activation_verified_at)
          || Date.parse(economyCommitment.requested_at)
            >= Date.parse(economyCommitment.activation_valid_until)
          || Date.parse(economyCommitment.simulation_simulated_at)
            < Date.parse(economyCommitment.simulation_adapter_verified_at)
          || Date.parse(economyCommitment.simulation_simulated_at)
            >= Date.parse(economyCommitment.simulation_adapter_valid_until)
          || Date.parse(economyCommitment.requested_at)
            >= Date.parse(economyCommitment.simulation_adapter_valid_until)
          || Date.parse(economyCommitment.requested_at)
            < Date.parse(economyCommitment.account_observed_at)
          || Date.parse(economyCommitment.requested_at)
            >= Date.parse(economyCommitment.account_valid_until)
          || Date.parse(economyCommitment.requested_at)
            < Date.parse(economyCommitment.simulation_simulated_at)
          || Date.parse(economyCommitment.requested_at)
            >= Date.parse(economyCommitment.simulation_valid_until)
        ) {
          fail("integrity_error", `Economy operation commitment does not verify: ${operation.operation_id}`);
        }
      }
      const policy = validateTreasuryPolicy(JSON.parse(operation.treasury_policy_json));
      const proofSnapshot = historyByCurrentness.get(operation.currentness_id);
      const reservationAuthority = this.bindingHistoryAt(
        operation.wallet_id,
        operation.created_at,
      );
      const capability = this.capabilityRow(operation.capability_record_id);
      if (
        proofSnapshot === undefined
        || reservationAuthority === null
        || capability === null
      ) {
        fail("integrity_error", `Operation authority snapshots are absent: ${operation.operation_id}`);
      }
      const policyAccountKey = `${operation.chain_id}\0${operation.source_account}`;
      const priorPolicyId = policyByAccount.get(policyAccountKey);
      if (priorPolicyId !== undefined && priorPolicyId !== operation.treasury_policy_id) {
        fail("integrity_error", `Treasury policy rotated inside one account ledger: ${operation.source_account}`);
      }
      policyByAccount.set(policyAccountKey, operation.treasury_policy_id);
      if (
        canonicalJson(policy) !== operation.treasury_policy_json
        || policy.treasury_policy_id !== operation.treasury_policy_id
        || policy.wallet_binding_id !== operation.binding_id
        || policy.treasury_account !== operation.source_account
        || policy.network !== networkForChain(operation.chain_id)
        || policy.reserve_floor_uzrn !== operation.reserve_floor_uzrn
        || Date.parse(policy.issued_at) > Date.parse(operation.created_at)
        || proofSnapshot.row.binding_id !== operation.binding_id
        || proofSnapshot.row.proof_id !== operation.proof_id
        || proofSnapshot.row.currentness_id !== operation.currentness_id
        || proofSnapshot.row.wallet_id !== operation.wallet_id
        || proofSnapshot.row.head_version !== operation.binding_head_version
        || proofSnapshot.binding.wallet_descriptor_id !== operation.descriptor_id
        || proofSnapshot.binding.zerone_signer.key_id !== operation.signer_key_id
        || proofSnapshot.binding.zerone_account_id !== operation.source_account
        || proofSnapshot.binding.network !== policy.network
        || proofSnapshot.currentness.wallet_revocation_nonce !== operation.capability_revocation_nonce
        || Date.parse(proofSnapshot.row.recorded_at) > Date.parse(operation.created_at)
        || Date.parse(operation.created_at) >= Date.parse(proofSnapshot.currentness.valid_until)
        || reservationAuthority.binding_id !== operation.binding_id
        || reservationAuthority.proof_id !== operation.proof_id
        || reservationAuthority.currentness_id !== operation.currentness_id
        || reservationAuthority.head_version !== operation.binding_head_version
        || capability.policy_hash !== operation.treasury_policy_id
        || capability.wallet_id !== operation.wallet_id
        || capability.descriptor_id !== operation.descriptor_id
        || capability.revocation_nonce !== operation.capability_revocation_nonce
      ) {
        fail("integrity_error", `Operation authority references do not verify: ${operation.operation_id}`);
      }
      const reservations = this.reservationRows(operation.operation_id);
      if (reservations.length === 0) fail("integrity_error", "Operation has no treasury reservation");
      let operationTotal = 0n;
      let operationFee = 0n;
      for (const reservation of reservations) {
        assertPurpose(reservation.purpose, "stored reservation purpose");
        const amount = parseUint64(reservation.amount_uzrn, "stored reservation amount", true);
        if (!policy.allowed_purposes.includes(reservation.purpose)) {
          fail("integrity_error", `Operation has a disallowed treasury purpose: ${operation.operation_id}`);
        }
        operationTotal += amount;
        if (reservation.purpose === "network_fee") operationFee += amount;
      }
      if (economyCommitment !== null) {
        const nonFee = bigintSum(reservations
          .filter(({ purpose }) => purpose !== "network_fee")
          .map(({ amount_uzrn }) => amount_uzrn));
        const feeReservation = reservations.find(({ purpose }) => purpose === "network_fee");
        const expectedPurpose = economyCommitment.message_kind === "create_bounty"
          ? "sponsorship_escrow"
          : economyCommitment.message_kind === "submit_claim"
            ? "knowledge_bond"
            : null;
        if (
          feeReservation?.amount_uzrn !== economyCommitment.network_fee_uzrn
          || nonFee.toString() !== economyCommitment.reserved_spend_uzrn
          || (expectedPurpose === null
            ? reservations.length !== 1
            : reservations.length !== 2
              || !reservations.some(({ purpose, amount_uzrn }) =>
                purpose === expectedPurpose
                && amount_uzrn === economyCommitment.reserved_spend_uzrn))
        ) {
          fail("integrity_error", `Economy treasury mapping does not replay: ${operation.operation_id}`);
        }
      }
      if (
        operationTotal > BigInt(policy.max_single_spend_uzrn)
        || operationFee > BigInt(capability.max_fee_per_intent_uzrn)
      ) {
        fail("integrity_error", `Operation exceeds its durable policy or fee ceiling: ${operation.operation_id}`);
      }
      const rows = this.db.query(`
        SELECT ledger_sequence, operation_id, sequence, kind, at, details_json,
          previous_event_hash, event_hash
        FROM operation_events WHERE operation_id = ? ORDER BY sequence
      `).all(operation.operation_id) as EventRow[];
      let previous: Sha256Id = GENESIS_EVENT_HASH;
      let priorEventAt = operation.created_at;
      const parsedDetails: Array<Record<string, unknown>> = [];
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index] as EventRow;
        const details = JSON.parse(row.details_json) as Record<string, unknown>;
        assertIdentifier(row.kind, "stored operation event kind");
        assertTimestamp(row.at, "stored operation event timestamp");
        if (
          row.operation_id !== operation.operation_id
          || row.sequence !== index + 1
          || row.previous_event_hash !== previous
          || Date.parse(row.at) < Date.parse(priorEventAt)
          || row.details_json !== canonicalJson(details)
          || row.event_hash !== eventHash({
            ledger_sequence: row.ledger_sequence,
            operation_id: row.operation_id,
            sequence: row.sequence,
            kind: row.kind,
            at: row.at,
            details,
            previous_event_hash: row.previous_event_hash,
          })
        ) {
          fail("integrity_error", `Operation event chain does not verify: ${operation.operation_id}`);
        }
        parsedDetails.push(details);
        previous = row.event_hash;
        priorEventAt = row.at;
        eventCount += 1;
      }
      if (
        rows.length === 0
        || rows[0]?.kind !== "reserved"
        || rows[0]?.at !== operation.created_at
        || rows.at(-1)?.at !== operation.updated_at
        || operation.event_count !== rows.length
        || operation.event_head_hash !== previous
      ) {
        fail("integrity_error", `Operation event head does not verify: ${operation.operation_id}`);
      }
      const replay = this.replayLifecycle(operation, rows, parsedDetails);
      replayedObservations.push(...replay.observations);
      replayedReorgEpochs.push(...replay.reorg_epochs);
      if (replay.unresolved_reorg !== null) unresolvedReorgs.push(replay.unresolved_reorg);
      const signedTransactionRow = this.db.query(`
        SELECT * FROM economy_signed_transactions WHERE operation_id = ?
      `).get(operation.operation_id) as EconomySignedTransactionRow | null;
      const hasAnySignedCoordinate = operation.tx_hash !== null
        || operation.signed_payload_hash !== null
        || operation.signed_verification_id !== null;
      const hasCompleteSignedCoordinates = operation.tx_hash !== null
        && operation.signed_payload_hash !== null
        && operation.signed_verification_id !== null;
      if (hasAnySignedCoordinate !== hasCompleteSignedCoordinates) {
        fail(
          "integrity_error",
          `Signed lifecycle coordinates are only partially present: ${operation.operation_id}`,
        );
      }
      if (operation.operation_kind === "generic_injected") {
        if (signedTransactionRow !== null) {
          fail(
            "integrity_error",
            `Generic operation acquired a typed signed transaction: ${operation.operation_id}`,
          );
        }
      } else if ((signedTransactionRow !== null) !== hasCompleteSignedCoordinates) {
        fail(
          "integrity_error",
          `Typed signed-transaction cardinality is invalid: ${operation.operation_id}`,
        );
      } else if (signedTransactionRow !== null) {
        if (economyCommitment === null) {
          fail(
            "integrity_error",
            `Typed signed transaction lost its economy commitment: ${operation.operation_id}`,
          );
        }
        assertTimestamp(signedTransactionRow.admitted_at, "signed transaction admitted_at");
        let signedTransaction: ZeroneEconomySignedTransactionRecord;
        try {
          const parsed = JSON.parse(signedTransactionRow.record_json) as unknown;
          signedTransaction = verifyZeroneEconomySignedTransactionRecord(parsed);
          if (canonicalJson(signedTransaction) !== signedTransactionRow.record_json) {
            fail(
              "integrity_error",
              `Stored signed transaction is not canonical: ${operation.operation_id}`,
            );
          }
        } catch (error) {
          if (error instanceof ZeroneAgentHostError) throw error;
          fail(
            "integrity_error",
            `Stored signed transaction does not cryptographically verify: ${operation.operation_id}`,
          );
        }
        const signedEventIndexes = rows.flatMap((event, index) =>
          event.kind === "verified_zerone_economy_signed_transaction" ? [index] : []);
        if (signedEventIndexes.length !== 1) {
          fail(
            "integrity_error",
            `Typed signed transaction does not have exactly one admission event: ${operation.operation_id}`,
          );
        }
        const signedEventIndex = signedEventIndexes[0] as number;
        const signedEvent = rows[signedEventIndex] as EventRow;
        const signedEventDetails = parsedDetails[signedEventIndex] as Record<string, unknown>;
        if (
          signedTransactionRow.operation_id !== operation.operation_id
          || signedTransactionRow.content_id !== signedTransaction.content_id
          || signedTransactionRow.plan_id !== signedTransaction.plan_id
          || signedTransactionRow.plan_content_id !== signedTransaction.plan_content_id
          || signedTransactionRow.intent_record_id !== signedTransaction.intent_record_id
          || signedTransactionRow.request_id !== signedTransaction.request_id
          || signedTransactionRow.signer_key_id !== signedTransaction.signer_key_id
          || signedTransactionRow.sign_doc_bytes_hash
            !== signedTransaction.sign_doc_bytes_hash
          || signedTransactionRow.tx_bytes_hash !== signedTransaction.tx_bytes_hash
          || signedTransactionRow.tx_hash !== signedTransaction.tx_hash
          || signedTransactionRow.content_id !== operation.signed_verification_id
          || signedTransactionRow.tx_bytes_hash !== operation.signed_payload_hash
          || signedTransactionRow.tx_hash !== operation.tx_hash
          || signedTransactionRow.admitted_at !== signedEvent.at
          || Date.parse(signedTransactionRow.admitted_at) > Date.parse(operation.updated_at)
          || eventString(
            signedEventDetails,
            "signed_transaction_json",
            signedEvent.kind,
          ) !== signedTransactionRow.record_json
          || eventString(
            signedEventDetails,
            "signed_transaction_content_id",
            signedEvent.kind,
          ) !== signedTransactionRow.content_id
          || !this.economySignedTransactionMatches(
            signedTransaction,
            operation,
            economyCommitment,
          )
          || Date.parse(signedTransactionRow.admitted_at)
            < Date.parse(economyCommitment.requested_at)
        ) {
          fail(
            "integrity_error",
            `Stored signed transaction changed its operation commitment: ${operation.operation_id}`,
          );
        }
      } else if (rows.some(({ kind }) => kind === "verified_zerone_economy_signed_transaction")) {
        fail(
          "integrity_error",
          `Typed signed admission event has no durable transaction row: ${operation.operation_id}`,
        );
      }
      const genesisDetails = parsedDetails[0] as Record<string, unknown>;
      const genesisBalance = parseUint64(
        genesisDetails.balance_uzrn,
        "stored reservation balance_uzrn",
      );
      const observedHeight = parseUint64(
        genesisDetails.observed_at_height,
        "stored reservation observed_at_height",
        true,
      );
      assertBlockHash(genesisDetails.observation_block_hash, "stored reservation block_hash");
      assertTimestamp(genesisDetails.observation_at, "stored reservation observation_at");
      assertNotBefore(operation.created_at, genesisDetails.observation_at, "Operation reservation");
      const expectedWindowStart = (
        observedHeight / BigInt(policy.window_blocks)
      ) * BigInt(policy.window_blocks);
      if (genesisBalance < operationTotal + BigInt(policy.reserve_floor_uzrn)) {
        fail(
          "integrity_error",
          `Reservation genesis violates the committed treasury reserve floor: ${operation.operation_id}`,
        );
      }
      const expectedGenesisDetails = {
        operation_kind: operation.operation_kind,
        binding_id: operation.binding_id,
        proof_id: operation.proof_id,
        currentness_id: operation.currentness_id,
        wallet_id: operation.wallet_id,
        binding_head_version: operation.binding_head_version,
        descriptor_id: operation.descriptor_id,
        signer_key_id: operation.signer_key_id,
        authorization_verification_id: operation.authorization_verification_id,
        authorization_trust_boundary: operation.operation_kind === "zerone_economy"
          ? ECONOMY_AUTHORIZATION_BOUNDARY
          : AUTHORIZATION_PROJECTION_BOUNDARY,
        ...(economyCommitment === null || commitmentRow === null ? {} : {
          economy_commitment_id: economyCommitment.commitment_id,
          economy_commitment_json: commitmentRow.commitment_json,
        }),
        intent_record_id: operation.intent_record_id,
        simulation_record_id: operation.simulation_record_id,
        plan_reference_id: operation.plan_reference_id,
        capability: {
          capability_record_id: capability.capability_record_id,
          policy_hash: capability.policy_hash,
          revocation_nonce: capability.revocation_nonce,
          max_intents: capability.max_intents,
          max_spend_uzrn: capability.max_spend_uzrn,
          max_fee_per_intent_uzrn: capability.max_fee_per_intent_uzrn,
        },
        treasury_policy_id: operation.treasury_policy_id,
        treasury_policy_json: operation.treasury_policy_json,
        window_start_height: operation.window_start_height,
        reserve_floor_uzrn: operation.reserve_floor_uzrn,
        reservations: reservations.map(({ purpose, amount_uzrn }) => ({ purpose, amount_uzrn })),
        chain_id: operation.chain_id,
        source_account: operation.source_account,
        account_number: operation.account_number,
        sequence: operation.sequence,
        balance_uzrn: genesisDetails.balance_uzrn,
        observed_at_height: genesisDetails.observed_at_height,
        observation_block_hash: genesisDetails.observation_block_hash,
        observation_at: genesisDetails.observation_at,
        account_public_key_type_url: genesisDetails.account_public_key_type_url,
        account_public_key_b64u: genesisDetails.account_public_key_b64u,
        account_valid_until: genesisDetails.account_valid_until,
        execution_support: EXECUTION_SUPPORT.mode,
      };
      if (
        operation.window_start_height !== expectedWindowStart.toString()
        || canonicalJson(genesisDetails) !== canonicalJson(expectedGenesisDetails)
      ) {
        fail("integrity_error", `Reservation authority commitment does not verify: ${operation.operation_id}`);
      }
      const windowUsage = this.windowUsage(
        operation.chain_id,
        operation.source_account,
        operation.window_start_height,
      );
      for (const purpose of policy.allowed_purposes) {
        if (windowUsage[purpose] > BigInt(policy.window_caps_uzrn[purpose])) {
          fail("integrity_error", `Treasury purpose window cap is exceeded: ${operation.source_account}`);
        }
      }
      if (windowUsage.total > BigInt(policy.window_caps_uzrn.total)) {
        fail("integrity_error", `Treasury total window cap is exceeded: ${operation.source_account}`);
      }
      if (operation.signer_invoked === 0) {
        if (
          !["reserved", "released_pre_sign", "sequence_superseded"].includes(operation.status)
          || operation.request_id !== null
          || operation.unsigned_payload_hash !== null
          || operation.signing_boundary_verification_id !== null
        ) {
          fail("integrity_error", `Pre-signer lifecycle fields are inconsistent: ${operation.operation_id}`);
        }
      } else {
        if (
          operation.status === "reserved"
          || operation.status === "released_pre_sign"
          || operation.request_id === null
          || operation.unsigned_payload_hash === null
          || operation.signing_boundary_verification_id === null
        ) {
          fail("integrity_error", `Post-signer lifecycle fields are incomplete: ${operation.operation_id}`);
        }
        assertIdentifier(operation.request_id, "stored signer request_id");
        assertSha256Id(operation.unsigned_payload_hash, "stored unsigned_payload_hash");
        assertSha256Id(
          operation.signing_boundary_verification_id,
          "stored signing boundary verification_id",
        );
      }
      const signedRequired: OperationStatus[] = [
        "signed", "submitting", "submission_unknown", "submitted",
        "rejected_pre_submit_sticky", "confirmed_success", "confirmed_failed", "reorged",
      ];
      if (signedRequired.includes(operation.status)) {
        if (
          operation.tx_hash === null
          || operation.signed_payload_hash === null
          || operation.signed_verification_id === null
        ) {
          fail("integrity_error", `Signed lifecycle evidence is incomplete: ${operation.operation_id}`);
        }
        assertTxHash(operation.tx_hash, "stored tx_hash");
        assertSha256Id(operation.signed_payload_hash, "stored signed_payload_hash");
        assertSha256Id(operation.signed_verification_id, "stored signed_verification_id");
      }
      if (["confirmed_success", "confirmed_failed", "reorged"].includes(operation.status)) {
        if (
          operation.inclusion_height === null
          || operation.inclusion_block_hash === null
          || operation.inclusion_code === null
        ) {
          fail("integrity_error", `Confirmed lifecycle evidence is incomplete: ${operation.operation_id}`);
        }
        parseUint64(operation.inclusion_height, "stored inclusion_height", true);
        assertBlockHash(operation.inclusion_block_hash, "stored inclusion_block_hash");
        assertCount(operation.inclusion_code, "stored inclusion_code");
      }
      const fence = this.db.query(`
        SELECT chain_id, source_account, account_number, sequence, state,
          acquired_at, released_at, release_evidence_id
        FROM sequence_fences WHERE operation_id = ?
      `).get(operation.operation_id) as {
        chain_id: ZeroneCaip2;
        source_account: ZeroneAccountId;
        account_number: string;
        sequence: string;
        state: "held" | "released";
        acquired_at: string;
        released_at: string | null;
        release_evidence_id: Sha256Id | null;
      } | null;
      if (
        fence === null
        || fence.chain_id !== operation.chain_id
        || fence.source_account !== operation.source_account
        || fence.account_number !== operation.account_number
        || fence.sequence !== operation.sequence
      ) {
        fail("integrity_error", `Operation sequence fence does not verify: ${operation.operation_id}`);
      }
      assertTimestamp(fence.acquired_at, "stored sequence fence acquired_at");
      if (fence.acquired_at !== operation.created_at) {
        fail("integrity_error", `Sequence fence acquisition chronology is invalid: ${operation.operation_id}`);
      }
      if (fence.state === "held") {
        if (fence.released_at !== null || fence.release_evidence_id !== null) {
          fail("integrity_error", `Held sequence fence retains release evidence: ${operation.operation_id}`);
        }
        if (replay.release_evidence_id !== null && replay.unresolved_reorg === null) {
          fail("integrity_error", `Sequence fence was re-held without a reorg handoff: ${operation.operation_id}`);
        }
      } else {
        if (fence.released_at === null || fence.release_evidence_id === null) {
          fail("integrity_error", `Released sequence fence lacks evidence: ${operation.operation_id}`);
        }
        assertTimestamp(fence.released_at, "stored sequence fence released_at");
        assertSha256Id(fence.release_evidence_id, "stored sequence release_evidence_id");
        assertNotBefore(fence.released_at, fence.acquired_at, "Sequence fence release");
        if (
          fence.release_evidence_id !== replay.release_evidence_id
          || fence.released_at !== replay.release_at
        ) {
          fail("integrity_error", `Sequence fence release does not replay from events: ${operation.operation_id}`);
        }
      }
      const stickyStatuses: OperationStatus[] = [
        "signing", "signing_unknown", "signed", "submitting", "submission_unknown",
        "submitted", "rejected_pre_submit_sticky", "reorged",
      ];
      if (
        stickyStatuses.includes(operation.status)
        && reservations.some(({ state }) => state !== "sticky")
      ) {
        fail("integrity_error", `Post-signer operation lost sticky exposure: ${operation.operation_id}`);
      }
      if (
        operation.status === "reserved"
        && reservations.some(({ state }) => state !== "reserved")
      ) {
        fail("integrity_error", `Reserved operation exposure is inconsistent: ${operation.operation_id}`);
      }
      if (
        (operation.status === "released_pre_sign" || operation.status === "sequence_superseded")
        && reservations.some(({ state }) => state !== "released")
      ) {
        fail("integrity_error", `Released operation retains exposure: ${operation.operation_id}`);
      }
      if (operation.status === "reserved" && fence.state !== "held") {
        fail("integrity_error", `Reserved operation does not hold its sequence fence: ${operation.operation_id}`);
      }
      if (
        (operation.status === "released_pre_sign" || operation.status === "sequence_superseded")
        && fence.state !== "released"
      ) {
        fail("integrity_error", `Released operation still holds its sequence fence: ${operation.operation_id}`);
      }
      if (stickyStatuses.includes(operation.status)) {
        const account = this.db.query(`
          SELECT halted FROM account_states WHERE chain_id = ? AND source_account = ?
        `).get(operation.chain_id, operation.source_account) as { halted: number } | null;
        if (
          fence.state !== "held"
          && (operation.status !== "reorged" || account?.halted !== 1)
        ) {
          fail("integrity_error", `Sticky operation has no authorized fence ownership: ${operation.operation_id}`);
        }
      }
      if (operation.status === "confirmed_success" || operation.status === "confirmed_failed") {
        if (fence.state === "held" && reservations.some(({ state }) => state !== "sticky")) {
          fail("integrity_error", `Confirmed operation released exposure before sequence advance: ${operation.operation_id}`);
        }
        if (
          fence.state === "released"
          && operation.status === "confirmed_success"
          && reservations.some(({ state }) => state !== "settled")
        ) {
          fail("integrity_error", `Confirmed success did not settle after sequence advance: ${operation.operation_id}`);
        }
        if (
          fence.state === "released"
          && operation.status === "confirmed_failed"
          && reservations.some(({ purpose, state }) =>
            state !== (purpose === "network_fee" ? "settled" : "released"))
        ) {
          fail("integrity_error", `Confirmed failure accounting is invalid after sequence advance: ${operation.operation_id}`);
        }
      }
    }
    this.verifyCapabilityUsageTimeline();
    const observationsByAccount = new Map<string, ZeroneAccountSnapshot[]>();
    for (const snapshot of replayedObservations) {
      const key = `${snapshot.chain_id}\0${snapshot.account}`;
      const snapshots = observationsByAccount.get(key) ?? [];
      snapshots.push(snapshot);
      observationsByAccount.set(key, snapshots);
    }
    for (const reorg of replayedReorgEpochs) {
      const key = `${reorg.chain_id}\0${reorg.source_account}`;
      const observations = observationsByAccount.get(key) ?? [];
      for (const snapshot of observations) {
        const timeOrder = Date.parse(snapshot.observed_at) - Date.parse(reorg.observed_at);
        if (
          timeOrder === 0
          || (
            timeOrder < 0
            && BigInt(snapshot.observed_at_height) > BigInt(reorg.observed_at_height)
          )
        ) {
          fail(
            "integrity_error",
            `Canonical reorg evidence is stale relative to account history: ${reorg.source_account}`,
          );
        }
      }
    }
    const reorgsByAccount = new Map<string, ReplayedReorgEpoch[]>();
    for (const reorg of unresolvedReorgs) {
      const key = `${reorg.chain_id}\0${reorg.source_account}`;
      const reorgs = reorgsByAccount.get(key) ?? [];
      reorgs.push(reorg);
      reorgsByAccount.set(key, reorgs);
    }
    for (const account of accountRows) {
      const key = `${account.chain_id}\0${account.source_account}`;
      const observations = observationsByAccount.get(key) ?? [];
      observations.sort((left, right) => {
        const heightOrder = BigInt(left.observed_at_height) < BigInt(right.observed_at_height)
          ? -1
          : BigInt(left.observed_at_height) > BigInt(right.observed_at_height)
            ? 1
            : 0;
        return heightOrder !== 0
          ? heightOrder
          : Date.parse(left.observed_at) - Date.parse(right.observed_at);
      });
      for (let index = 1; index < observations.length; index += 1) {
        const prior = observations[index - 1] as ZeroneAccountSnapshot;
        const next = observations[index] as ZeroneAccountSnapshot;
        const sameHeight = next.observed_at_height === prior.observed_at_height;
        if (
          BigInt(next.sequence) < BigInt(prior.sequence)
          || Date.parse(next.observed_at) < Date.parse(prior.observed_at)
          || (
            next.observed_at === prior.observed_at
            && next.valid_until !== prior.valid_until
          )
          || (
            prior.public_key_type_url !== null
            && (
              next.public_key_type_url !== prior.public_key_type_url
              || next.public_key_b64u !== prior.public_key_b64u
            )
          )
          || (
            sameHeight
            && (
              next.block_hash !== prior.block_hash
              || next.sequence !== prior.sequence
              || next.balance_uzrn !== prior.balance_uzrn
              || next.public_key_type_url !== prior.public_key_type_url
              || next.public_key_b64u !== prior.public_key_b64u
            )
          )
        ) {
          fail("integrity_error", `Account observations do not replay monotonically: ${account.source_account}`);
        }
      }
      const latest = observations.at(-1);
      if (
        latest === undefined
        || latest.account_number !== account.account_number
        || latest.sequence !== account.sequence
        || latest.balance_uzrn !== account.balance_uzrn
        || latest.observed_at_height !== account.observed_at_height
        || latest.block_hash !== account.block_hash
        || latest.observed_at !== account.observed_at
        || latest.public_key_type_url !== account.public_key_type_url
        || latest.public_key_b64u !== account.public_key_b64u
        || latest.valid_until !== account.valid_until
      ) {
        fail("integrity_error", `Account state does not replay from operation evidence: ${account.source_account}`);
      }
      const unresolved = reorgsByAccount.get(key) ?? [];
      unresolved.sort((left, right) => {
        const heightOrder = BigInt(left.observed_at_height) < BigInt(right.observed_at_height)
          ? -1
          : BigInt(left.observed_at_height) > BigInt(right.observed_at_height)
            ? 1
            : 0;
        return heightOrder !== 0
          ? heightOrder
          : Date.parse(left.observed_at) - Date.parse(right.observed_at);
      });
      for (let index = 1; index < unresolved.length; index += 1) {
        const prior = unresolved[index - 1] as ReplayedReorgEpoch;
        const next = unresolved[index] as ReplayedReorgEpoch;
        if (
          BigInt(next.observed_at_height) <= BigInt(prior.observed_at_height)
          || Date.parse(next.observed_at) <= Date.parse(prior.observed_at)
        ) {
          fail(
            "integrity_error",
            `Unresolved reorg epochs are not strictly ordered in height and time: ${account.source_account}`,
          );
        }
      }
      const latestReorg = unresolved.at(-1);
      if (
        (latestReorg === undefined) !== (account.halted === 0)
        || (
          latestReorg !== undefined
          && (
            account.halted_at_height !== latestReorg.observed_at_height
            || account.halt_evidence_id !== latestReorg.evidence_id
            || account.halted_at !== latestReorg.observed_at
          )
        )
      ) {
        fail("integrity_error", `Account halt does not replay from reorg evidence: ${account.source_account}`);
      }
    }
    if (observationsByAccount.size !== accountRows.length) {
      fail("integrity_error", "Account observation set does not match durable account rows");
    }
    const usageRows = this.db.query("SELECT * FROM capability_usage ORDER BY capability_record_id")
      .all() as CapabilityUsageRow[];
    for (const usage of usageRows) {
      assertSha256Id(usage.capability_record_id, "stored capability_record_id");
      assertSha256Id(usage.descriptor_id, "stored capability descriptor_id");
      assertSha256Id(usage.policy_hash, "stored capability policy_hash");
      assertCount(usage.revocation_nonce, "stored capability revocation_nonce");
      assertCount(usage.max_intents, "stored capability max_intents", true);
      assertCount(usage.reserved_intents, "stored capability reserved_intents");
      assertCount(usage.consumed_intents, "stored capability consumed_intents");
      assertCount(usage.version, "stored capability version", true);
      parseUint64(usage.max_spend_uzrn, "stored capability max_spend_uzrn");
      parseUint64(usage.max_fee_per_intent_uzrn, "stored capability max_fee_per_intent_uzrn");
      parseUint64(usage.reserved_spend_uzrn, "stored capability reserved_spend_uzrn");
      parseUint64(usage.consumed_spend_uzrn, "stored capability consumed_spend_uzrn");
      assertTimestamp(usage.updated_at, "stored capability updated_at");
      const rows = this.db.query(`
        SELECT * FROM operations WHERE capability_record_id = ? ORDER BY operation_id
      `).all(usage.capability_record_id) as OperationRow[];
      const reserved = rows.filter((row) => row.status === "reserved" && row.signer_invoked === 0);
      const consumed = rows.filter((row) => row.signer_invoked === 1);
      // A newly materialized capability starts at version 1, then every
      // reservation and every reserved→consumed/released transfer increments it.
      let expectedVersion = rows.length + 1;
      let expectedUpdatedAt: string | null = null;
      for (const operation of rows) {
        if (
          expectedUpdatedAt === null
          || Date.parse(operation.created_at) > Date.parse(expectedUpdatedAt)
        ) {
          expectedUpdatedAt = operation.created_at;
        }
        const capabilityEventKind = operation.signer_invoked === 1
          ? "signer_invocation_boundary"
          : operation.status === "released_pre_sign"
            ? "released_pre_sign"
            : operation.status === "sequence_superseded"
              ? operation.operation_kind === "zerone_economy"
                ? "observed_zerone_economy_sequence_advance"
                : "sequence_advanced"
              : null;
        if (capabilityEventKind !== null) {
          const event = this.db.query(`
            SELECT at FROM operation_events WHERE operation_id = ? AND kind = ?
            ORDER BY sequence LIMIT 1
          `).get(operation.operation_id, capabilityEventKind) as { at: string } | null;
          if (event === null) {
            fail("integrity_error", `Capability mutation event is absent: ${operation.operation_id}`);
          }
          expectedVersion += 1;
          if (
            expectedUpdatedAt === null
            || Date.parse(event.at) > Date.parse(expectedUpdatedAt)
          ) {
            expectedUpdatedAt = event.at;
          }
        }
      }
      const spend = (selected: readonly OperationRow[]): bigint => selected.reduce((sum, operation) =>
        sum + bigintSum(this.reservationRows(operation.operation_id)
          .filter(({ purpose }) => purpose !== "network_fee")
          .map(({ amount_uzrn }) => amount_uzrn)), 0n);
      if (
        rows.length === 0
        || usage.reserved_intents !== reserved.length
        || usage.consumed_intents !== consumed.length
        || BigInt(usage.reserved_spend_uzrn) !== spend(reserved)
        || BigInt(usage.consumed_spend_uzrn) !== spend(consumed)
        || usage.reserved_intents + usage.consumed_intents > usage.max_intents
        || BigInt(usage.reserved_spend_uzrn) + BigInt(usage.consumed_spend_uzrn)
          > BigInt(usage.max_spend_uzrn)
        || usage.version !== expectedVersion
        || usage.updated_at !== expectedUpdatedAt
      ) {
        fail("integrity_error", `Capability usage does not reconcile: ${usage.capability_record_id}`);
      }
    }
    this.verifyAccountTimeline();
    const fileModesOk = this.files.modesArePrivate();
    if (!fileModesOk) fail("integrity_error", "Database, WAL, or SHM mode is not 0600");
    const bindingCount = this.db.query("SELECT COUNT(*) AS count FROM binding_heads").get() as {
      count: number;
    } | null;
    const heldCount = this.db.query(`
      SELECT COUNT(*) AS count FROM sequence_fences WHERE state = 'held'
    `).get() as { count: number } | null;
    return Object.freeze({
      ok: true,
      binding_head_count: bindingCount?.count ?? 0,
      operation_count: operations.length,
      held_sequence_fence_count: heldCount?.count ?? 0,
      event_count: eventCount,
      file_modes_ok: true,
      execution_support: EXECUTION_SUPPORT,
    });
  }

  private requireOperation(
    operationId: string,
    expectedRevision: number,
    statuses: readonly OperationStatus[],
  ): OperationRow {
    const operation = this.operationRow(operationId);
    if (operation === null) fail("not_found", "Operation was not found");
    if (operation.revision !== expectedRevision || !statuses.includes(operation.status)) {
      fail(
        "state_conflict",
        `Operation compare-and-swap expected revision ${expectedRevision} in ${statuses.join("/")}`,
      );
    }
    return operation;
  }

  private assertGenericLifecycleAdvance(operation: OperationRow, label: string): void {
    this.requireLegacyGenericInjected(label);
    if (operation.operation_kind !== "generic_injected") {
      fail(
        "authorization_denied",
        `${label} cannot advance a typed Zerone economy operation`,
      );
    }
  }

  private economySignedTransactionMatches(
    record: ZeroneEconomySignedTransactionRecord,
    operation: OperationRow,
    commitment: ZeroneEconomyOperationCommitment,
  ): boolean {
    const history = this.db.query(`
      SELECT * FROM binding_history WHERE currentness_id = ?
    `).get(operation.currentness_id) as BindingHistoryRow | null;
    if (history === null) return false;
    let proof: VerifiedWalletIdentityBindingProof;
    try {
      proof = verifyWalletIdentityBindingProofEnvelope(
        JSON.parse(history.proof_envelope_json),
      );
    } catch {
      return false;
    }
    return record.plan_id === commitment.plan_id
      && record.plan_content_id === commitment.plan_content_id
      && record.plan_content_id === operation.plan_reference_id
      && record.activation_observation_hash === commitment.activation_observation_hash
      && record.activation_observed_at_height === commitment.activation_observed_at_height
      && record.intent_record_id === commitment.intent_record_id
      && record.intent_record_id === operation.intent_record_id
      && record.simulation_record_id === commitment.simulation_record_id
      && record.simulation_record_id === operation.simulation_record_id
      && record.simulation_evidence_content_id === commitment.simulation_evidence_content_id
      && record.simulation_evidence_record_id === commitment.simulation_evidence_record_id
      && record.simulation_tx_bytes_hash === commitment.simulation_tx_bytes_hash
      && record.request_id === commitment.request_id
      && record.request_id === operation.request_id
      && record.requested_at === commitment.requested_at
      && record.chain_id === commitment.chain_id
      && record.chain_id === operation.chain_id
      && record.source_account === commitment.source_account
      && record.source_account === operation.source_account
      && record.account_number === commitment.account_number
      && record.account_number === operation.account_number
      && record.sequence === commitment.account_sequence
      && record.sequence === operation.sequence
      && record.account_observed_at_height === commitment.account_observed_at_height
      && record.signer_key_id === operation.signer_key_id
      && record.signer_key_id === proof.binding.zerone_signer.key_id
      && record.signer_public_key_b64u === proof.binding.zerone_signer.public_key_b64u
      && record.message.kind === commitment.message_kind
      && record.message.type_url === commitment.message_type_url
      && record.message.wallet_method === commitment.wallet_method
      && record.message.projection_hash === commitment.projection_hash
      && record.message.value_b64u === commitment.value_b64u
      && record.message.value_hash === commitment.value_hash
      && record.message.actor_address === commitment.actor_address
      && record.message.module_account === commitment.module_account
      && record.message.reserved_spend_uzrn === commitment.reserved_spend_uzrn
      && record.total_reserved_spend_uzrn === commitment.reserved_spend_uzrn
      && canonicalJson(record.economic_effect) === commitment.economic_effect_json
      && record.fee.denom === "uzrn"
      && record.fee.amount === commitment.network_fee_uzrn
      && record.sign_doc_bytes_hash === commitment.sign_doc_bytes_hash
      && record.sign_doc_bytes_hash === operation.unsigned_payload_hash;
  }

  private applySequenceAdvanceInTransaction(input: {
    readonly operation: OperationRow;
    readonly snapshot: ZeroneAccountSnapshot;
    readonly evidence_id: Sha256Id;
    readonly event_at: string;
    readonly event_kind: "sequence_advanced" | "observed_zerone_economy_sequence_advance";
    readonly typed_expected_revision: number | null;
  }): OperationSnapshot {
    const { operation, snapshot } = input;
    const typed = input.typed_expected_revision !== null;
    if (
      typed !== (operation.operation_kind === "zerone_economy")
      || typed !== (input.event_kind === "observed_zerone_economy_sequence_advance")
      || (typed && input.typed_expected_revision !== operation.revision)
    ) {
      fail("integrity_error", "Sequence transition crossed its typed authority boundary");
    }
    if (
      snapshot.chain_id !== operation.chain_id
      || snapshot.account !== operation.source_account
      || snapshot.account_number !== operation.account_number
      || BigInt(snapshot.sequence) <= BigInt(operation.sequence)
    ) {
      fail(
        "evidence_rejected",
        "Account observation does not positively advance past the reserved sequence",
      );
    }
    const fenceBefore = this.db.query(`
      SELECT state FROM sequence_fences WHERE operation_id = ?
    `).get(operation.operation_id) as { state: "held" | "released" } | null;
    const accountBefore = this.db.query(`
      SELECT halted FROM account_states WHERE chain_id = ? AND source_account = ?
    `).get(operation.chain_id, operation.source_account) as { halted: number } | null;
    const releasedByReorgConflict = operation.unresolved_reorg_event_sequence !== null
      && fenceBefore?.state === "released"
      && accountBefore?.halted === 1;
    if (fenceBefore?.state !== "held" && !releasedByReorgConflict) {
      fail("state_conflict", "Operation sequence fence was already released");
    }
    this.observeAccount(snapshot, true);
    let target = operation.status;
    if (operation.signer_invoked === 0) {
      const usage = this.capabilityRow(operation.capability_record_id);
      if (usage === null || usage.reserved_intents < 1) {
        fail("integrity_error", "Pre-sign sequence advance has no reserved capability usage");
      }
      assertNotBefore(input.event_at, usage.updated_at, "Capability sequence release");
      const nonFeeSpend = bigintSum(this.reservationRows(operation.operation_id)
        .filter(({ purpose }) => purpose !== "network_fee")
        .map(({ amount_uzrn }) => amount_uzrn));
      const usageUpdated = this.db.query(`
        UPDATE capability_usage SET reserved_intents = reserved_intents - 1,
          reserved_spend_uzrn = ?, version = version + 1, updated_at = ?
        WHERE capability_record_id = ? AND version = ?
      `).run(
        (BigInt(usage.reserved_spend_uzrn) - nonFeeSpend).toString(),
        input.event_at,
        usage.capability_record_id,
        usage.version,
      );
      if (usageUpdated.changes !== 1) {
        fail("conflict", "Capability sequence release compare-and-swap lost its race");
      }
      target = "sequence_superseded";
      this.db.query("UPDATE treasury_reservations SET state = 'released' WHERE operation_id = ?")
        .run(operation.operation_id);
    } else if (operation.status === "confirmed_success") {
      this.db.query("UPDATE treasury_reservations SET state = 'settled' WHERE operation_id = ?")
        .run(operation.operation_id);
    } else if (operation.status === "confirmed_failed") {
      this.db.query(`
        UPDATE treasury_reservations SET state = CASE
          WHEN purpose = 'network_fee' THEN 'settled' ELSE 'released' END
        WHERE operation_id = ?
      `).run(operation.operation_id);
    } else {
      target = "sequence_superseded";
      this.db.query(`
        UPDATE treasury_reservations SET state = 'released'
        WHERE operation_id = ? AND state IN ('reserved', 'sticky')
      `).run(operation.operation_id);
    }
    if (fenceBefore?.state === "held") {
      this.releaseFence(operation.operation_id, input.evidence_id, input.event_at);
    }
    const updated = this.db.query(`
      UPDATE operations SET status = ?, unresolved_reorg_event_sequence = NULL,
        unresolved_reorg_evidence_id = NULL, revision = revision + 1, updated_at = ?
      WHERE operation_id = ? AND revision = ? AND status = ?
    `).run(
      target,
      input.event_at,
      operation.operation_id,
      operation.revision,
      operation.status,
    );
    if (updated.changes !== 1) {
      fail("conflict", "Sequence release compare-and-swap lost its race");
    }
    const haltHandoff = this.reconcileAccountHaltAndFences(
      operation.chain_id,
      operation.source_account,
    );
    this.appendEvent(operation.operation_id, input.event_kind, input.event_at, {
      ...(typed ? {
        authentication_boundary: ECONOMY_SEQUENCE_ADVANCE_EVIDENCE_BOUNDARY,
        expected_revision: input.typed_expected_revision,
      } : {}),
      evidence_id: input.evidence_id,
      chain_id: snapshot.chain_id,
      source_account: snapshot.account,
      account_number: snapshot.account_number,
      reserved_sequence: operation.sequence,
      observed_sequence: snapshot.sequence,
      balance_uzrn: snapshot.balance_uzrn,
      observed_at_height: snapshot.observed_at_height,
      block_hash: snapshot.block_hash,
      observation_at: snapshot.observed_at,
      account_public_key_type_url: snapshot.public_key_type_url,
      account_public_key_b64u: snapshot.public_key_b64u,
      account_valid_until: snapshot.valid_until,
      exposure_released: true,
      sequence_fence_released: fenceBefore?.state === "held",
      account_halt_handoff_operation_id: haltHandoff,
    });
    return this.getOperationOrFail(operation.operation_id);
  }

  private assertTypedSequenceAccountKey(
    operation: OperationRow,
    snapshot: ZeroneAccountSnapshot,
  ): void {
    const history = this.db.query(`
      SELECT proof_envelope_json FROM binding_history WHERE currentness_id = ?
    `).get(operation.currentness_id) as { proof_envelope_json: string } | null;
    if (history === null) {
      fail("integrity_error", "Typed sequence evidence lost its exact binding history");
    }
    const proof = verifyWalletIdentityBindingProofEnvelope(
      JSON.parse(history.proof_envelope_json),
    );
    if (
      BigInt(snapshot.sequence) > 0n
      && (
        snapshot.public_key_type_url !== COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL
        || snapshot.public_key_b64u === null
        || snapshot.public_key_b64u !== proof.binding.zerone_signer.public_key_b64u
        || proof.binding.zerone_signer.key_id !== operation.signer_key_id
      )
    ) {
      fail(
        "evidence_rejected",
        "Typed sequence evidence must carry the exact registered Cosmos signer key",
      );
    }
  }

  private requireLegacyGenericInjected(label: string): void {
    if (!this.allowLegacyGenericInjectedForTests) {
      fail(
        "authorization_denied",
        `${label} is disabled unless allow_legacy_generic_injected_for_tests is explicitly true`,
      );
    }
  }

  private transitionSimple(
    operationId: string,
    expectedRevision: number,
    fromStatuses: readonly OperationStatus[],
    target: OperationStatus,
    eventKind: string,
    at: string,
    details: Readonly<Record<string, unknown>>,
    assertOperation?: (operation: OperationRow) => void,
  ): OperationSnapshot {
    const apply = this.db.transaction((): OperationSnapshot => {
      const operation = this.requireOperation(operationId, expectedRevision, fromStatuses);
      assertOperation?.(operation);
      const updated = this.db.query(`
        UPDATE operations SET status = ?, revision = revision + 1, updated_at = ?
        WHERE operation_id = ? AND revision = ? AND status = ?
      `).run(target, at, operation.operation_id, operation.revision, operation.status);
      if (updated.changes !== 1) fail("conflict", `${eventKind} compare-and-swap lost its race`);
      this.appendEvent(operation.operation_id, eventKind, at, details);
      return this.getOperationOrFail(operation.operation_id);
    });
    return this.runImmediate(apply);
  }

  private releaseFence(operationId: string, evidenceId: Sha256Id, at: string): void {
    const result = this.db.query(`
      UPDATE sequence_fences SET state = 'released', released_at = ?, release_evidence_id = ?
      WHERE operation_id = ? AND state = 'held'
    `).run(at, evidenceId, operationId);
    if (result.changes !== 1) fail("integrity_error", "Operation does not hold its durable sequence fence");
  }

  /**
   * A late reorg may halt an account while a newer operation owns its sole
   * fence. When that owner resolves, hand the fence to the earliest unresolved
   * Cosmos sequence liability, with creation time and operation ID as stable
   * ties, instead of accidentally clearing the account halt.
   */
  private reconcileAccountHaltAndFences(
    chainId: ZeroneCaip2,
    account: ZeroneAccountId,
  ): string | null {
    const unresolved = this.db.query(`
      SELECT o.operation_id, o.sequence AS reserved_sequence, o.created_at,
        o.unresolved_reorg_evidence_id, e.ledger_sequence, e.at, e.details_json
      FROM operations o
      JOIN operation_events e ON e.operation_id = o.operation_id
        AND e.sequence = o.unresolved_reorg_event_sequence
      WHERE o.chain_id = ? AND o.source_account = ?
        AND o.unresolved_reorg_event_sequence IS NOT NULL
        AND o.unresolved_reorg_evidence_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM treasury_reservations r
          WHERE r.operation_id = o.operation_id AND r.state = 'sticky'
        )
        AND e.kind = 'canonical_reorg'
    `).all(chainId, account) as Array<{
      operation_id: string;
      reserved_sequence: string;
      created_at: string;
      unresolved_reorg_evidence_id: Sha256Id;
      ledger_sequence: number;
      at: string;
      details_json: string;
    }>;
    if (unresolved.length === 0) {
      this.db.query(`
        UPDATE account_states SET halted = 0, halted_at_height = NULL,
          halt_evidence_id = NULL, halted_at = NULL, revision = revision + 1
        WHERE chain_id = ? AND source_account = ?
      `).run(chainId, account);
      return null;
    }
    const epochs = unresolved.map((row) => {
      const details = JSON.parse(row.details_json) as Record<string, unknown>;
      const observedHeight = eventString(details, "observed_at_height", "canonical_reorg");
      const evidenceId = eventString(details, "evidence_id", "canonical_reorg") as Sha256Id;
      parseUint64(observedHeight, "canonical_reorg.observed_at_height", true);
      assertSha256Id(evidenceId, "canonical_reorg.evidence_id");
      assertTimestamp(row.at, "canonical_reorg.at");
      parseUint64(row.reserved_sequence, "unresolved reserved sequence");
      assertTimestamp(row.created_at, "unresolved operation created_at");
      if (evidenceId !== row.unresolved_reorg_evidence_id) {
        fail("integrity_error", "Unresolved reorg pointer does not bind its canonical event");
      }
      return { observedHeight, evidenceId, at: row.at };
    });
    epochs.sort((left, right) => {
      const heightOrder = BigInt(left.observedHeight) < BigInt(right.observedHeight)
        ? -1
        : BigInt(left.observedHeight) > BigInt(right.observedHeight)
          ? 1
          : 0;
      return heightOrder !== 0 ? heightOrder : Date.parse(left.at) - Date.parse(right.at);
    });
    for (let index = 1; index < epochs.length; index += 1) {
      const prior = epochs[index - 1] as (typeof epochs)[number];
      const next = epochs[index] as (typeof epochs)[number];
      if (
        BigInt(next.observedHeight) <= BigInt(prior.observedHeight)
        || Date.parse(next.at) <= Date.parse(prior.at)
      ) {
        fail("integrity_error", "Unresolved reorg epochs are not strictly ordered in height and time");
      }
    }
    const latestEpoch = epochs[epochs.length - 1] as (typeof epochs)[number];
    this.db.query(`
      UPDATE account_states SET halted = 1, halted_at_height = ?, halt_evidence_id = ?,
        halted_at = ?, revision = revision + 1
      WHERE chain_id = ? AND source_account = ?
    `).run(
      latestEpoch.observedHeight,
      latestEpoch.evidenceId,
      latestEpoch.at,
      chainId,
      account,
    );
    const held = this.db.query(`
      SELECT operation_id FROM sequence_fences
      WHERE chain_id = ? AND source_account = ? AND state = 'held' LIMIT 1
    `).get(chainId, account) as { operation_id: string } | null;
    if (held !== null) return held.operation_id;
    unresolved.sort((left, right) => {
      const sequenceOrder = BigInt(left.reserved_sequence) < BigInt(right.reserved_sequence)
        ? -1
        : BigInt(left.reserved_sequence) > BigInt(right.reserved_sequence)
          ? 1
          : 0;
      if (sequenceOrder !== 0) return sequenceOrder;
      const createdOrder = Date.parse(left.created_at) - Date.parse(right.created_at);
      if (createdOrder !== 0) return createdOrder;
      return left.operation_id < right.operation_id
        ? -1
        : left.operation_id > right.operation_id
          ? 1
          : 0;
    });
    const fenceTarget = unresolved[0] as { operation_id: string };
    const reacquired = this.db.query(`
      UPDATE sequence_fences SET state = 'held', released_at = NULL, release_evidence_id = NULL
      WHERE operation_id = ? AND state = 'released'
    `).run(fenceTarget.operation_id);
    if (reacquired.changes !== 1) {
      fail("integrity_error", "Unresolved reorg cannot reacquire its durable sequence fence");
    }
    return fenceTarget.operation_id;
  }

  private runImmediate<T>(transaction: { immediate(): T }): T {
    this.files.tighten();
    this.verify();
    try {
      const result = transaction.immediate();
      this.files.tighten();
      return result;
    } catch (error) {
      if (error instanceof ZeroneAgentHostError) throw error;
      if (error instanceof Error && /UNIQUE constraint failed/u.test(error.message)) {
        fail("conflict", "A unique durable host resource was concurrently consumed");
      }
      throw error;
    }
  }

  close(): void {
    this.files.tighten();
    this.db.close(false);
    this.files.tighten();
  }
}
