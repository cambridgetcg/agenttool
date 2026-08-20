import type {
  Ed25519PublicKey,
  Sha256Id,
  SigningRequest,
  SimulationReceipt,
  TransactionIntent,
  Verified,
  WalletCapability,
  WalletDescriptor,
} from "@agenttool/wallet";
import type {
  TreasuryPolicy,
  TreasuryPurpose,
  VerifiedWalletIdentityBindingProof,
  WalletIdentityBinding,
  WalletIdentityBindingProofEnvelope,
  ZeroneAccountId,
  ZeroneCaip2,
} from "@agenttool/zerone-agent-economy";
import type {
  EconomyMessageKind,
  ZeroneEconomyActivationObservation,
  ZeroneEconomyDirectSignPlan,
  ZeroneEconomyPlannedMessage,
  ZeroneEconomySimulationEvidence,
} from "@agenttool/wallet-zerone-economy";

import type {
  AUTHORIZATION_PROJECTION_BOUNDARY,
  EXECUTION_SUPPORT,
  OPERATION_KINDS,
  OPERATION_STATUSES,
  RESERVATION_STATES,
} from "./constants.js";

export type { Sha256Id, TreasuryPurpose, ZeroneAccountId, ZeroneCaip2 };

export type OperationStatus = (typeof OPERATION_STATUSES)[number];
export type OperationKind = (typeof OPERATION_KINDS)[number];
export type ReservationState = (typeof RESERVATION_STATES)[number];

/**
 * A closed, content-addressed observation asserted by an injected currentness
 * resolver. The host verifies its shape, ID, chronology, and exact linkage to
 * a cryptographically verified dual-key proof. It does not authenticate the
 * resolver's off-host currentness claim and this record grants no authority.
 */
export interface BindingCurrentnessAssertionCore {
  readonly format: "agenttool.zerone-binding-currentness-assertion/0.2";
  readonly external_verification_id: Sha256Id;
  readonly binding_id: Sha256Id;
  readonly proof_id: Sha256Id;
  readonly owner_identity_id: string;
  readonly wallet_id: string;
  readonly wallet_descriptor_id: Sha256Id;
  readonly identity_authority: Ed25519PublicKey;
  readonly binding_revision: number;
  readonly wallet_continuity_sequence: number;
  readonly identity_root_observation_id: Sha256Id;
  readonly wallet_descriptor_observation_id: Sha256Id;
  readonly wallet_continuity_observation_id: Sha256Id;
  readonly verifier_id: string;
  readonly verified_at: string;
  /** Resolver-asserted expiry; it is not authenticated by a host clock or registry. */
  readonly valid_until: string;
  readonly wallet_revocation_nonce: number;
  readonly lifecycle_status: "active";
  readonly currentness: "attested_by_configured_identity_wallet_resolver";
  readonly effects_performed: false;
}

export interface BindingCurrentnessAssertion extends BindingCurrentnessAssertionCore {
  readonly currentness_id: Sha256Id;
}

export interface CreateBindingCurrentnessAssertionInput {
  readonly external_verification_id: Sha256Id;
  readonly binding_id: Sha256Id;
  readonly proof_id: Sha256Id;
  readonly owner_identity_id: string;
  readonly wallet_id: string;
  readonly wallet_descriptor_id: Sha256Id;
  readonly identity_authority: Ed25519PublicKey;
  readonly binding_revision: number;
  readonly wallet_continuity_sequence: number;
  readonly identity_root_observation_id: Sha256Id;
  readonly wallet_descriptor_observation_id: Sha256Id;
  readonly wallet_continuity_observation_id: Sha256Id;
  readonly verifier_id: string;
  readonly verified_at: string;
  readonly valid_until: string;
  readonly wallet_revocation_nonce: number;
}

export interface BindingCurrentnessResolver {
  resolveCurrentness(
    proof: VerifiedWalletIdentityBindingProof,
  ): Promise<BindingCurrentnessAssertion>;
}

/** Immutable configured trust epoch for an injected binding-currentness verifier. */
export interface TrustedBindingCurrentnessVerifierAssertionCore {
  readonly format: "agenttool.zerone-binding-currentness-verifier-trust/0.1";
  readonly external_verification_id: Sha256Id;
  readonly verifier_id: string;
  readonly verified_at: string;
  readonly valid_until: string;
  readonly trust: "configured_host_allowlist";
  readonly effects_performed: false;
}

export interface TrustedBindingCurrentnessVerifierAssertion
  extends TrustedBindingCurrentnessVerifierAssertionCore {
  readonly trust_id: Sha256Id;
}

export interface CreateTrustedBindingCurrentnessVerifierAssertionInput {
  readonly external_verification_id: Sha256Id;
  readonly verifier_id: string;
  readonly verified_at: string;
  readonly valid_until: string;
}

/**
 * Content-addressed evidence from an injected activation-currentness resolver.
 * The store also requires `verifier_id` in its immutable configured allowlist.
 * Neither boundary makes an RPC or establishes chain truth by itself.
 */
export interface ZeroneEconomyActivationCurrentnessAssertionCore {
  readonly format: "agenttool.zerone-activation-currentness-assertion/0.1";
  readonly external_verification_id: Sha256Id;
  readonly verifier_id: string;
  readonly network: "mainnet" | "testnet";
  readonly chain_id: ZeroneCaip2;
  readonly zerone_core_commit: "a5b82e82b2a32be2b75bd11575964b0a69aa34ac";
  readonly cosmos_sdk: "v0.53.8";
  readonly sponsorship_consensus_version: 2;
  readonly knowledge_consensus_version: 7;
  readonly activation_observation_hash: Sha256Id;
  readonly observed_at_height: string;
  readonly block_hash: string;
  readonly verified_at: string;
  readonly valid_until: string;
  readonly currentness: "asserted_by_injected_resolver";
  readonly effects_performed: false;
}

export interface ZeroneEconomyActivationCurrentnessAssertion
  extends ZeroneEconomyActivationCurrentnessAssertionCore {
  readonly currentness_id: Sha256Id;
}

export interface CreateZeroneEconomyActivationCurrentnessAssertionInput {
  readonly external_verification_id: Sha256Id;
  readonly verifier_id: string;
  readonly network: "mainnet" | "testnet";
  readonly chain_id: ZeroneCaip2;
  readonly activation_observation_hash: Sha256Id;
  readonly observed_at_height: string;
  readonly block_hash: string;
  readonly verified_at: string;
  readonly valid_until: string;
}

export interface ZeroneEconomyActivationCurrentnessResolver {
  resolveCurrentness(input: Readonly<{
    activation_observation: ZeroneEconomyActivationObservation;
    plan: ZeroneEconomyDirectSignPlan;
  }>): Promise<ZeroneEconomyActivationCurrentnessAssertion>;
}

/** Immutable exact adapter-key trust entry installed in store configuration. */
export interface TrustedSimulationAdapterAssertionCore {
  readonly format: "agenttool.zerone-simulation-adapter-trust/0.1";
  readonly external_verification_id: Sha256Id;
  readonly verifier_id: string;
  readonly chain_id: ZeroneCaip2;
  readonly adapter: Ed25519PublicKey;
  readonly verified_at: string;
  readonly valid_until: string;
  readonly trust: "configured_host_allowlist";
  readonly effects_performed: false;
}

export interface TrustedSimulationAdapterAssertion
  extends TrustedSimulationAdapterAssertionCore {
  readonly trust_id: Sha256Id;
}

export interface CreateTrustedSimulationAdapterAssertionInput {
  readonly external_verification_id: Sha256Id;
  readonly verifier_id: string;
  readonly chain_id: ZeroneCaip2;
  readonly adapter: Ed25519PublicKey;
  readonly verified_at: string;
  readonly valid_until: string;
}

export interface BindingHead {
  readonly wallet_id: string;
  readonly head_version: number;
  readonly binding: WalletIdentityBinding;
  /** Reverified and runtime-branded every time it is loaded from SQLite. */
  readonly proof: VerifiedWalletIdentityBindingProof;
  readonly currentness: BindingCurrentnessAssertion;
  readonly updated_at: string;
}

export interface BindingHeadExpectation {
  readonly wallet_id: string;
  readonly binding_id: Sha256Id;
  readonly proof_id: Sha256Id;
  readonly currentness_id: Sha256Id;
  readonly head_version: number;
}

export interface CapabilityBudget {
  readonly capability_record_id: Sha256Id;
  readonly descriptor_id: Sha256Id;
  /** Must equal the exact TreasuryPolicy.treasury_policy_id in this v0 host. */
  readonly policy_hash: Sha256Id;
  readonly revocation_nonce: number;
  readonly max_intents: number;
  /** Cumulative non-fee Zerone spend ceiling represented by this host ledger. */
  readonly max_spend_uzrn: string;
  /** Per-operation network-fee ceiling; Wallet 0.1 has no cumulative fee field. */
  readonly max_fee_per_intent_uzrn: string;
}

export interface CapabilityUsageSnapshot {
  readonly capability_record_id: Sha256Id;
  readonly reserved_intents: number;
  readonly consumed_intents: number;
  readonly reserved_spend_uzrn: string;
  readonly consumed_spend_uzrn: string;
  readonly version: number;
}

/** A single injected canonical-chain account and native-balance observation. */
export interface ZeroneAccountSnapshot {
  readonly chain_id: ZeroneCaip2;
  readonly account: ZeroneAccountId;
  readonly account_number: string;
  readonly sequence: string;
  readonly balance_uzrn: string;
  readonly observed_at_height: string;
  readonly block_hash: string;
  readonly observed_at: string;
  readonly public_key_type_url: "/cosmos.crypto.secp256k1.PubKey" | null;
  readonly public_key_b64u: string | null;
  /** Injected observation freshness bound; host `now()` must be before it. */
  readonly valid_until: string;
}

export interface ZeroneStateObserver {
  observeAccount(account: ZeroneAccountId): Promise<ZeroneAccountSnapshot>;
}

export interface PurposeReservation {
  readonly purpose: TreasuryPurpose;
  readonly amount_uzrn: string;
}

/**
 * Legacy/test-only IDs and ceilings produced by an injected verifier. This
 * opaque generic path is disabled by default and is never an economy-plan
 * authorization path; the typed method verifies branded Wallet records.
 */
export interface TrustedInjectedAuthorizationProjection {
  readonly trust_boundary: typeof AUTHORIZATION_PROJECTION_BOUNDARY;
  readonly external_verification_id: Sha256Id;
  readonly intent_record_id: Sha256Id;
  readonly simulation_record_id: Sha256Id;
  /** Opaque legacy reference only; its bytes are not decoded or classified. */
  readonly plan_reference_id: Sha256Id;
}

export interface ReserveOperationInput {
  readonly operation_id: string;
  readonly binding_head: BindingHeadExpectation;
  readonly authorization: TrustedInjectedAuthorizationProjection;
  readonly capability: CapabilityBudget;
  readonly treasury_policy: TreasuryPolicy;
  readonly account_snapshot: ZeroneAccountSnapshot;
  readonly signer_key_id: Sha256Id;
  readonly reservations: readonly PurposeReservation[];
  readonly created_at: string;
}

export interface OperationSnapshot {
  readonly operation_id: string;
  readonly operation_kind: OperationKind;
  readonly revision: number;
  readonly status: OperationStatus;
  readonly wallet_id: string;
  readonly binding_id: Sha256Id;
  readonly proof_id: Sha256Id;
  readonly currentness_id: Sha256Id;
  readonly binding_head_version: number;
  readonly descriptor_id: Sha256Id;
  readonly capability_record_id: Sha256Id;
  readonly capability_revocation_nonce: number;
  readonly authorization_verification_id: Sha256Id;
  readonly intent_record_id: Sha256Id;
  readonly simulation_record_id: Sha256Id;
  readonly plan_reference_id: Sha256Id;
  readonly treasury_policy_id: Sha256Id;
  readonly chain_id: ZeroneCaip2;
  readonly source_account: ZeroneAccountId;
  readonly account_number: string;
  readonly sequence: string;
  readonly signer_key_id: Sha256Id;
  /**
   * Conservative exposure flag set before a possible external signer call.
   * It does not prove that the signer actually ran.
   */
  readonly signer_invoked: boolean;
  readonly tx_hash: string | null;
  readonly signed_payload_hash: Sha256Id | null;
  readonly signed_verification_id: Sha256Id | null;
  readonly inclusion_height: string | null;
  readonly inclusion_block_hash: string | null;
  readonly inclusion_code: number | null;
  /** Exact canonical-reorg event still awaiting positive sequence advancement. */
  readonly unresolved_reorg_event_sequence: number | null;
  readonly unresolved_reorg_evidence_id: Sha256Id | null;
  readonly event_count: number;
  readonly event_head_hash: Sha256Id;
  readonly created_at: string;
  readonly updated_at: string;
  readonly execution_support: typeof EXECUTION_SUPPORT;
  readonly reservations: readonly (PurposeReservation & { readonly state: ReservationState })[];
}

export interface ZeroneEconomyOperationCommitment {
  readonly format: "agenttool.zerone-economy-operation-commitment/0.1";
  readonly operation_id: string;
  readonly plan_id: Sha256Id;
  readonly plan_content_id: Sha256Id;
  readonly message_kind: EconomyMessageKind;
  readonly message_type_url: ZeroneEconomyPlannedMessage["type_url"];
  readonly wallet_method: ZeroneEconomyPlannedMessage["wallet_method"];
  readonly projection_hash: Sha256Id;
  readonly value_b64u: string;
  readonly value_hash: Sha256Id;
  readonly actor_address: string;
  readonly module_account: ZeroneAccountId;
  readonly reserved_spend_uzrn: string;
  readonly economic_effect_json: string;
  readonly authorization_verification_id: Sha256Id;
  /** Exact pre-reservation Wallet usage input; approvals are closed to empty. */
  readonly authorization_usage_json: string;
  readonly binding_currentness_id: Sha256Id;
  readonly binding_currentness_json: string;
  readonly binding_verifier_trust_id: Sha256Id;
  readonly binding_verifier_external_verification_id: Sha256Id;
  readonly binding_verifier_id: string;
  readonly binding_verifier_verified_at: string;
  readonly binding_verifier_valid_until: string;
  readonly binding_verifier_trust_json: string;
  readonly intent_record_id: Sha256Id;
  readonly simulation_record_id: Sha256Id;
  readonly simulation_evidence_content_id: Sha256Id;
  readonly simulation_evidence_record_id: Sha256Id;
  /** Canonical, signed planner evidence; its Ed25519 proof is rerun on reopen. */
  readonly simulation_evidence_json: string;
  readonly simulation_tx_bytes_hash: Sha256Id;
  readonly simulation_adapter_trust_id: Sha256Id;
  readonly simulation_adapter_external_verification_id: Sha256Id;
  readonly simulation_adapter_verifier_id: string;
  readonly simulation_adapter_public_key: string;
  readonly simulation_adapter_verified_at: string;
  readonly simulation_adapter_valid_until: string;
  readonly simulation_adapter_trust_json: string;
  readonly simulation_simulated_at: string;
  readonly simulation_valid_until: string;
  readonly simulation_observed_at_height: string;
  readonly simulation_block_ref: string;
  readonly simulation_block_hash: string;
  readonly sign_doc_bytes_hash: Sha256Id;
  readonly activation_currentness_id: Sha256Id;
  readonly activation_external_verification_id: Sha256Id;
  readonly activation_verifier_id: string;
  readonly activation_observation_hash: Sha256Id;
  readonly zerone_core_commit: "a5b82e82b2a32be2b75bd11575964b0a69aa34ac";
  readonly cosmos_sdk: "v0.53.8";
  readonly sponsorship_consensus_version: 2;
  readonly knowledge_consensus_version: 7;
  readonly activation_observed_at_height: string;
  readonly activation_block_hash: string;
  readonly activation_verified_at: string;
  readonly activation_valid_until: string;
  readonly activation_currentness_json: string;
  readonly chain_id: ZeroneCaip2;
  readonly source_account: ZeroneAccountId;
  readonly account_number: string;
  readonly account_sequence: string;
  readonly account_observed_at_height: string;
  readonly account_block_hash: string;
  readonly account_observed_at: string;
  readonly account_public_key_type_url: "/cosmos.crypto.secp256k1.PubKey" | null;
  readonly account_public_key_b64u: string | null;
  readonly account_valid_until: string;
  readonly network_fee_uzrn: string;
  readonly request_id: string;
  readonly requested_at: string;
  readonly network_effects_performed: false;
  readonly local_durable_effects: "reservation_and_possible_signer_boundary_committed";
  readonly commitment_id: Sha256Id;
}

export interface ReserveAndEnterZeroneEconomySigningBoundaryInput {
  readonly operation_id: string;
  readonly request_id: string;
  readonly proof: WalletIdentityBindingProofEnvelope;
  readonly expected_binding_head: BindingHeadExpectation | null;
  readonly activation_observation: ZeroneEconomyActivationObservation;
  readonly descriptor: Verified<WalletDescriptor>;
  readonly capability: Verified<WalletCapability>;
  readonly intent: Verified<TransactionIntent>;
  readonly simulation: Verified<SimulationReceipt>;
  /** Portable signed evidence; reverified inside the SQLite transaction. */
  readonly simulation_evidence: ZeroneEconomySimulationEvidence;
  /** Must retain or reconstruct the planner's runtime brand before entry. */
  readonly plan: ZeroneEconomyDirectSignPlan;
  readonly treasury_policy: TreasuryPolicy;
}

export interface ZeroneEconomySigningBoundaryResult {
  readonly operation: OperationSnapshot;
  readonly commitment: ZeroneEconomyOperationCommitment;
  readonly signing_request: Readonly<SigningRequest>;
}

export interface SignerInvocationBoundary {
  readonly operation_id: string;
  readonly expected_revision: number;
  readonly account_snapshot: ZeroneAccountSnapshot;
  readonly request_id: string;
  readonly unsigned_payload_hash: Sha256Id;
  readonly external_verification_id: Sha256Id;
  readonly at: string;
}

export interface VerifiedSignedEvidence {
  readonly operation_id: string;
  readonly expected_revision: number;
  readonly tx_hash: string;
  readonly signed_payload_hash: Sha256Id;
  readonly external_verification_id: Sha256Id;
  readonly at: string;
}

export interface BroadcastInvocationBoundary {
  readonly operation_id: string;
  readonly expected_revision: number;
  readonly at: string;
}

export type BroadcastEvidence =
  | {
      readonly status: "accepted";
      readonly operation_id: string;
      readonly expected_revision: number;
      readonly tx_hash: string;
      readonly evidence_id: Sha256Id;
      readonly at: string;
    }
  | {
      readonly status: "rejected_pre_submit";
      readonly operation_id: string;
      readonly expected_revision: number;
      readonly tx_hash: string;
      readonly evidence_id: Sha256Id;
      readonly code: string;
      readonly at: string;
    }
  | {
      readonly status: "ambiguous";
      readonly operation_id: string;
      readonly expected_revision: number;
      readonly tx_hash: string;
      readonly evidence_id: Sha256Id;
      readonly code: string;
      readonly at: string;
    };

export type TransactionEvidence =
  | {
      readonly status: "found";
      readonly operation_id: string;
      readonly expected_revision: number;
      readonly evidence_id: Sha256Id;
      readonly tx_hash: string;
      readonly height: string;
      readonly observed_at_height: string;
      readonly block_hash: string;
      readonly code: number;
      readonly codespace: string;
      readonly confirmation_depth: number;
      readonly observed_at: string;
    }
  | {
      readonly status: "absent" | "unavailable";
      readonly operation_id: string;
      readonly expected_revision: number;
      readonly evidence_id: Sha256Id;
      readonly tx_hash: string;
      readonly observed_at: string;
      readonly code?: string;
    };

export interface SequenceAdvanceEvidence {
  readonly operation_id: string;
  readonly expected_revision: number;
  readonly evidence_id: Sha256Id;
  readonly snapshot: ZeroneAccountSnapshot;
  readonly observed_at: string;
}

export interface CanonicalReorgEvidence {
  readonly operation_id: string;
  readonly expected_revision: number;
  readonly evidence_id: Sha256Id;
  readonly tx_hash: string;
  readonly prior_inclusion_height: string;
  readonly prior_inclusion_block_hash: string;
  readonly canonical_block_hash_at_height: string;
  readonly observed_at_height: string;
  readonly observed_at: string;
}

export interface OperationEvent {
  readonly ledger_sequence: number;
  readonly operation_id: string;
  readonly sequence: number;
  readonly kind: string;
  readonly at: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly previous_event_hash: Sha256Id;
  readonly event_hash: Sha256Id;
}

export interface HostVerificationReport {
  readonly ok: true;
  readonly binding_head_count: number;
  readonly operation_count: number;
  readonly held_sequence_fence_count: number;
  readonly event_count: number;
  readonly file_modes_ok: true;
  readonly execution_support: typeof EXECUTION_SUPPORT;
}
