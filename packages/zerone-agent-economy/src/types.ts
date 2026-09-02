import type { Ed25519PublicKey, Sha256Id } from "@agenttool/wallet";
import type { ZeroneAccountId, ZeroneCaip2, ZeroneNetwork } from "@agenttool/wallet-zerone";

import type {
  CLAIM_TYPE_COMPUTATIONAL,
  FORMATS,
  INFERENCE_TYPE_UNSPECIFIED,
  MESSAGE_TYPE_URLS,
  RELATION_TYPE_REQUIRES,
  SEMANTIC_BOUNDARY,
  WALLET_METHODS,
  WALLET_ZERONE_SUPPORT,
  ZERONE_NATIVE_DENOM,
} from "./constants.js";

export type { Sha256Id, ZeroneAccountId, ZeroneCaip2, ZeroneNetwork };
export type SemanticBoundary = typeof SEMANTIC_BOUNDARY;

export interface ZeroneSignerDescription {
  readonly algorithm: "secp256k1";
  readonly encoding: "compressed";
  readonly public_key_b64u: string;
  readonly key_id: Sha256Id;
}

export interface WalletIdentityBindingCore {
  readonly format: (typeof FORMATS)["wallet_binding"];
  readonly network: ZeroneNetwork;
  readonly owner_identity_id: string;
  readonly wallet_id: string;
  readonly wallet_descriptor_id: Sha256Id;
  readonly identity_authority: Ed25519PublicKey;
  readonly zerone_account_id: ZeroneAccountId;
  readonly zerone_address: string;
  readonly zerone_signer: ZeroneSignerDescription;
  readonly revision: number;
  readonly wallet_continuity_sequence: number;
  readonly previous_binding_id: Sha256Id | null;
  readonly proof_status: "unsigned_unverified";
  readonly issued_at: string;
  readonly semantic_boundary: SemanticBoundary;
}

export interface WalletIdentityBinding extends WalletIdentityBindingCore {
  readonly binding_id: Sha256Id;
}

export interface WalletIdentityBindingSigningRequest {
  readonly binding: WalletIdentityBinding;
  readonly signing_domain: string;
  readonly signing_bytes_b64u: string;
  readonly shared_signing_digest: Sha256Id;
  /** Exact raw 32-byte digest both proof signers receive. */
  readonly shared_signing_digest_b64u: string;
  readonly signature_input: "shared_signing_digest_raw_32_bytes";
  readonly required_proofs: readonly [
    {
      readonly role: "identity_root_authorization";
      readonly algorithm: "Ed25519";
      readonly key_id: Sha256Id;
    },
    {
      readonly role: "wallet_key_control";
      readonly algorithm: "secp256k1";
      readonly key_id: Sha256Id;
    },
  ];
  readonly signer_injection: "external";
  readonly effects_performed: false;
}

export interface WalletIdentityBindingProofCore {
  readonly format: (typeof FORMATS)["wallet_binding_proof"];
  readonly binding: WalletIdentityBinding;
  readonly signing_domain: string;
  readonly shared_signing_digest: Sha256Id;
  readonly signature_input: "shared_signing_digest_raw_32_bytes";
  readonly identity_proof: {
    readonly role: "identity_root_authorization";
    readonly algorithm: "Ed25519";
    readonly key_id: Sha256Id;
    /** Canonical unpadded base64url encoding of a 64-byte signature. */
    readonly signature_b64u: string;
  };
  readonly wallet_proof: {
    readonly role: "wallet_key_control";
    readonly algorithm: "secp256k1";
    readonly encoding: "compact_low_s";
    readonly key_id: Sha256Id;
    /** Canonical unpadded base64url encoding of compact r || s. */
    readonly signature_b64u: string;
  };
  readonly effects_performed: false;
}

export interface WalletIdentityBindingProofEnvelope
  extends WalletIdentityBindingProofCore {
  readonly proof_id: Sha256Id;
}

declare const verifiedWalletIdentityBindingProofBrand: unique symbol;
export type VerifiedWalletIdentityBindingProof =
  Readonly<WalletIdentityBindingProofEnvelope> & {
    readonly [verifiedWalletIdentityBindingProofBrand]: true;
  };

export type TreeTransitionKind = "add_fact";

export interface WorkSpecCore {
  readonly format: (typeof FORMATS)["work_spec"];
  readonly network: ZeroneNetwork;
  readonly sponsor_account: ZeroneAccountId;
  /** Preassigned counterparty for this negotiated prefunded contract. */
  readonly worker_account: ZeroneAccountId;
  readonly knowledge_domain: string;
  readonly target_tree: {
    readonly tree_id: string;
    readonly base_root: Sha256Id;
    /** Exact existing Zerone Fact IDs projected as REQUIRES edges. */
    readonly parent_fact_ids: readonly string[];
    readonly transition_kind: TreeTransitionKind;
    readonly output_contract_hash: Sha256Id;
  };
  readonly input_root: Sha256Id;
  readonly environment_root: Sha256Id;
  readonly acceptance_hash: Sha256Id;
  readonly resource_limits: {
    readonly max_compute_millis: string;
    readonly max_accelerator_millis: string;
    readonly max_memory_byte_millis: string;
    readonly max_input_bytes: string;
    readonly max_output_bytes: string;
  };
  readonly settlement: {
    readonly denom: typeof ZERONE_NATIVE_DENOM;
    readonly price_per_artifact_uzrn: string;
    readonly target_count: number;
    readonly duration_blocks: string;
    readonly min_corroborations: string;
  };
  readonly created_at: string;
  readonly semantic_boundary: SemanticBoundary;
}

export interface WorkSpec extends WorkSpecCore {
  readonly work_spec_id: Sha256Id;
}

export interface ComputationalArtifactCore {
  readonly format: (typeof FORMATS)["artifact"];
  readonly network: ZeroneNetwork;
  readonly work_spec_id: Sha256Id;
  readonly source_work_id: Sha256Id;
  readonly producer_binding_id: Sha256Id;
  readonly producer_account: ZeroneAccountId;
  readonly acceptance_hash: Sha256Id;
  readonly input_root: Sha256Id;
  readonly environment_root: Sha256Id;
  readonly artifact_root: Sha256Id;
  readonly evidence_root: Sha256Id;
  readonly claim_commitment: {
    readonly fact_content_hash: Sha256Id;
    readonly references_root: Sha256Id;
    readonly method_id: string;
  };
  readonly proposed_tree_transition: {
    readonly from_root: Sha256Id;
    readonly to_root: Sha256Id;
    readonly changed_nodes_root: Sha256Id;
    readonly changed_relations_root: Sha256Id;
  };
  readonly resource_usage: {
    readonly compute_millis: string;
    readonly accelerator_millis: string;
    readonly memory_byte_millis: string;
    readonly input_bytes: string;
    readonly output_bytes: string;
  };
  readonly completed_at: string;
  readonly semantic_boundary: SemanticBoundary;
}

export interface ComputationalArtifact extends ComputationalArtifactCore {
  readonly artifact_id: Sha256Id;
  /** Exact bare hash produced by Zerone's consensus work-receipt recipe. */
  readonly chain_work_receipt_hash: string;
}

export type EvidenceOutcome =
  | "contract_mature"
  | "contract_rejected"
  | "inconclusive";

export interface EvidenceReceiptCore {
  readonly format: (typeof FORMATS)["evidence"];
  readonly work_spec_id: Sha256Id;
  readonly artifact_id: Sha256Id;
  readonly chain_work_receipt_hash: string;
  readonly knowledge_claim_id: string;
  readonly knowledge_fact_id: string;
  readonly computational_commitment_hash: Sha256Id;
  readonly evidence_root: Sha256Id;
  readonly outcome: EvidenceOutcome;
  readonly corroborations: string;
  readonly challenge_window_end_height: string;
  readonly observed_at_height: string;
  readonly open_challenges: number;
  /** Untrusted issuer label; this record carries no issuer signature. */
  readonly issuer_id: string;
  /** Claimed key reference only; it is not verified by this package. */
  readonly issuer_key_id: Sha256Id;
  readonly issued_at: string;
  readonly semantic_boundary: SemanticBoundary;
}

export interface EvidenceReceipt extends EvidenceReceiptCore {
  readonly evidence_receipt_id: Sha256Id;
}

export interface SettlementIntentCore {
  readonly format: (typeof FORMATS)["settlement"];
  readonly network: ZeroneNetwork;
  readonly bounty_id: string;
  readonly work_spec_id: Sha256Id;
  readonly acceptance_hash: Sha256Id;
  readonly input_root: Sha256Id;
  readonly environment_root: Sha256Id;
  readonly artifact_id: Sha256Id;
  readonly artifact_root: Sha256Id;
  readonly chain_work_receipt_hash: string;
  readonly evidence_receipt_id: Sha256Id;
  readonly knowledge_fact_id: string;
  readonly payee_binding_id: Sha256Id;
  readonly payee_account: ZeroneAccountId;
  readonly amount: {
    readonly denom: typeof ZERONE_NATIVE_DENOM;
    readonly amount_uzrn: string;
  };
  readonly expected_chain_nullifier: string;
  readonly created_at: string;
  readonly valid_until_height: string;
  readonly status: "proposed_unsigned";
  readonly semantic_boundary: SemanticBoundary;
}

export interface SettlementIntent extends SettlementIntentCore {
  readonly settlement_intent_id: Sha256Id;
}

export type TreasuryPurpose =
  | "compute"
  | "storage"
  | "network_fee"
  | "knowledge_bond"
  | "sponsorship_escrow";

export interface TreasuryPolicyCore {
  readonly format: (typeof FORMATS)["treasury"];
  readonly network: ZeroneNetwork;
  readonly wallet_binding_id: Sha256Id;
  readonly treasury_account: ZeroneAccountId;
  readonly denom: typeof ZERONE_NATIVE_DENOM;
  readonly reserve_floor_uzrn: string;
  readonly max_single_spend_uzrn: string;
  readonly window_blocks: string;
  readonly window_caps_uzrn: {
    readonly compute: string;
    readonly storage: string;
    readonly network_fee: string;
    readonly knowledge_bond: string;
    readonly sponsorship_escrow: string;
    readonly total: string;
  };
  readonly allowed_purposes: readonly TreasuryPurpose[];
  readonly receiving_allowed: true;
  readonly automatic_staking: false;
  readonly automatic_governance: false;
  readonly automatic_bridging: false;
  readonly issued_at: string;
  readonly semantic_boundary: SemanticBoundary;
}

export interface TreasuryPolicy extends TreasuryPolicyCore {
  readonly treasury_policy_id: Sha256Id;
}

export interface TreasurySpendContext {
  readonly current_height: string;
  readonly current_balance_uzrn: string;
  readonly durable_reserved_uzrn: string;
  readonly sticky_unknown_exposure_uzrn: string;
  readonly purpose: TreasuryPurpose;
  readonly amount_uzrn: string;
  readonly spent_in_window_uzrn: Readonly<Record<TreasuryPurpose | "total", string>>;
}

export interface TreasuryDecision {
  readonly allowed: boolean;
  readonly reason:
    | "within_policy"
    | "purpose_not_allowed"
    | "single_spend_exceeded"
    | "purpose_window_exceeded"
    | "total_window_exceeded"
    | "reserve_floor_breached";
  readonly post_spend_balance_uzrn: string;
  readonly effects_performed: false;
}

export interface WorkAdmissionInput {
  readonly current_height: string;
  readonly contract_end_height: string;
  readonly expected_verification_blocks: string;
  readonly expected_challenge_blocks: string;
  readonly safety_blocks: string;
  readonly price_uzrn: string;
  readonly compute_cost_uzrn: string;
  readonly storage_cost_uzrn: string;
  readonly review_fee_uzrn: string;
  readonly network_fee_uzrn: string;
  readonly minimum_margin_uzrn: string;
}

export interface WorkAdmissionDecision {
  readonly accepted: boolean;
  readonly reason:
    | "within_policy"
    | "expires_before_contract_maturity"
    | "cost_exceeds_price"
    | "minimum_margin_not_met";
  readonly required_maturity_height: string;
  readonly total_cost_uzrn: string;
  /** May be negative; this is measurement, never a guarantee. */
  readonly net_uzrn: string;
  readonly affects_identity: false;
  readonly affects_rights: false;
  readonly conditions_rest: false;
  readonly effects_performed: false;
}

export interface ChainWorkContract {
  readonly work_spec_hash: string;
  readonly acceptance_hash: string;
  readonly input_root: string;
  readonly environment_root: string;
  readonly min_corroborations: string;
  readonly worker_address: string;
}

export interface ChainComputationalCommitment {
  readonly work_spec_hash: string;
  readonly acceptance_hash: string;
  readonly input_root: string;
  readonly environment_root: string;
  readonly artifact_root: string;
  readonly evidence_root: string;
  readonly work_receipt_hash: string;
}

export interface ChainRequiresRelation {
  readonly target_fact_id: string;
  readonly relation: typeof RELATION_TYPE_REQUIRES;
  readonly inference: typeof INFERENCE_TYPE_UNSPECIFIED;
  readonly inference_strength_bps: "0";
  readonly method_id: "";
}

export interface CreateBountyOrderValue {
  readonly sponsor: string;
  readonly domain: string;
  readonly price_per_artifact: string;
  readonly target_count: number;
  readonly duration_blocks: string;
  readonly work_contract: ChainWorkContract;
}

export interface SubmitComputationalClaimValue {
  readonly submitter: string;
  readonly fact_content: string;
  readonly domain: string;
  readonly category: "computational";
  readonly stake: string;
  readonly references: readonly string[];
  readonly partnership_id: "";
  readonly claim_type: typeof CLAIM_TYPE_COMPUTATIONAL;
  readonly relations: readonly ChainRequiresRelation[];
  readonly structure: null;
  readonly canonical_form: "";
  readonly sponsored: false;
  readonly method_id: string;
  readonly reasoning_trace: string;
  readonly computational_commitment: ChainComputationalCommitment;
}

export interface FulfillBountyValue {
  readonly caller: string;
  readonly bounty_id: string;
  readonly fact_id: string;
}

export type UnsignedMessageValue =
  | CreateBountyOrderValue
  | SubmitComputationalClaimValue
  | FulfillBountyValue;

export interface UnsignedMessageProjection<T extends UnsignedMessageValue = UnsignedMessageValue> {
  readonly format: (typeof FORMATS)["unsigned_message"];
  readonly network: ZeroneNetwork;
  readonly chain_id: ZeroneCaip2;
  readonly source_account: ZeroneAccountId;
  readonly type_url: (typeof MESSAGE_TYPE_URLS)[keyof typeof MESSAGE_TYPE_URLS];
  readonly wallet_method: (typeof WALLET_METHODS)[keyof typeof WALLET_METHODS];
  readonly value: T;
  readonly projection_bytes_b64u: string;
  readonly projection_hash: Sha256Id;
  readonly protobuf_value_b64u: string;
  readonly protobuf_value_hash: Sha256Id;
  readonly compatibility: typeof WALLET_ZERONE_SUPPORT;
  readonly semantic_boundary: SemanticBoundary;
}
