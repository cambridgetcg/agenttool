import type { Sha256Id } from "@agenttool/wallet";
import type {
  TreasuryPolicy,
  TreasuryPurpose,
  VerifiedWalletIdentityBindingProof,
  WalletIdentityBinding,
  ZeroneAccountId,
  ZeroneCaip2,
} from "@agenttool/zerone-agent-economy";

import type {
  AUTHORIZATION_PROJECTION_BOUNDARY,
  EXECUTION_SUPPORT,
  OPERATION_STATUSES,
  RESERVATION_STATES,
} from "./constants.js";

export type { Sha256Id, TreasuryPurpose, ZeroneAccountId, ZeroneCaip2 };

export type OperationStatus = (typeof OPERATION_STATUSES)[number];
export type ReservationState = (typeof RESERVATION_STATES)[number];

/**
 * A closed, content-addressed observation asserted by an injected currentness
 * resolver. The host verifies its shape, ID, chronology, and exact linkage to
 * a cryptographically verified dual-key proof. It does not authenticate the
 * resolver's off-host currentness claim and this record grants no authority.
 */
export interface BindingCurrentnessAssertionCore {
  readonly format: "agenttool.zerone-binding-currentness-assertion/0.1";
  readonly binding_id: Sha256Id;
  readonly proof_id: Sha256Id;
  readonly verifier_id: string;
  readonly verified_at: string;
  /** Resolver-asserted expiry; it is not authenticated by a host clock or registry. */
  readonly valid_until: string;
  readonly wallet_revocation_nonce: number;
  readonly currentness: "asserted_by_injected_resolver";
  readonly effects_performed: false;
}

export interface BindingCurrentnessAssertion extends BindingCurrentnessAssertionCore {
  readonly currentness_id: Sha256Id;
}

export interface CreateBindingCurrentnessAssertionInput {
  readonly binding_id: Sha256Id;
  readonly proof_id: Sha256Id;
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
}

export interface ZeroneStateObserver {
  observeAccount(account: ZeroneAccountId): Promise<ZeroneAccountSnapshot>;
}

export interface PurposeReservation {
  readonly purpose: TreasuryPurpose;
  readonly amount_uzrn: string;
}

/**
 * IDs and ceilings produced by an injected verifier after it authenticates
 * Wallet descriptor/capability/intent/simulation records and performs the
 * pure static authorization check. The ledger cannot recreate Wallet's
 * process-local brands and does not itself validate those signed records.
 */
export interface TrustedInjectedAuthorizationProjection {
  readonly trust_boundary: typeof AUTHORIZATION_PROJECTION_BOUNDARY;
  readonly external_verification_id: Sha256Id;
  readonly intent_record_id: Sha256Id;
  readonly simulation_record_id: Sha256Id;
  /** Opaque reviewed-plan reference only. No economy native planner exists here. */
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
