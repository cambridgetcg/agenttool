import type {
  AuthorizedIntent,
  Ed25519PublicKey,
  RecordSignature,
  RecordSigner,
  Sha256Id,
  SignedPayload,
  SigningRequest,
  SimulationEffect,
  SimulationReceipt,
  SimulationReceiptCore,
  TransactionIntent,
  Verified,
} from "@agenttool/wallet";
import type {
  ZeroneAccountId,
  ZeroneAccountObservation,
  ZeroneCaip2,
  ZeroneNetwork,
  ZeroneSimulationResult,
  ZeroneTxHash,
} from "@agenttool/wallet-zerone";
import type {
  UnsignedMessageProjection,
} from "@agenttool/zerone-agent-economy";

import type {
  ECONOMY_ACTIVATION_OBSERVATION_PROTOCOL,
  ECONOMY_ADAPTER_PROTOCOL,
  ECONOMY_SIMULATION_BINDING_PROTOCOL,
  ECONOMY_SIMULATION_EVIDENCE_SCHEMA,
  ECONOMY_SIGNED_TRANSACTION_SCHEMA,
  EXECUTION_SUPPORT,
  ZERONE_DENOM,
  ZERONE_ECONOMY_CORE_COMMIT,
  ZERONE_ECONOMY_COSMOS_SDK,
  ZERONE_KNOWLEDGE_CONSENSUS_VERSION,
  ZERONE_SPONSORSHIP_CONSENSUS_VERSION,
} from "./constants.js";

export type EconomyMessageKind =
  | "create_bounty"
  | "submit_claim"
  | "fulfill_bounty";

export interface ZeroneEconomyActivationObservation {
  readonly protocol: typeof ECONOMY_ACTIVATION_OBSERVATION_PROTOCOL;
  readonly evidence_scope: "caller_supplied_structural_only";
  readonly currentness_proven: false;
  readonly status: "reported_activated";
  readonly network: ZeroneNetwork;
  readonly chain_id: ZeroneCaip2;
  readonly zerone_core_commit: string;
  readonly cosmos_sdk: string;
  readonly sponsorship_consensus_version: number;
  readonly knowledge_consensus_version: number;
  readonly observed_at_height: string;
}

export interface ZeroneEconomyCoin {
  readonly denom: typeof ZERONE_DENOM;
  readonly amount: string;
}

export interface ZeroneEconomyPlannedMessage {
  readonly kind: EconomyMessageKind;
  readonly type_url:
    | "/zerone.sponsorship.v1.MsgCreateBountyOrder"
    | "/zerone.knowledge.v1.MsgSubmitClaim"
    | "/zerone.sponsorship.v1.MsgFulfillBounty";
  readonly wallet_method:
    | "zerone.sponsorship.v1.MsgCreateBountyOrder"
    | "zerone.knowledge.v1.MsgSubmitClaim"
    | "zerone.sponsorship.v1.MsgFulfillBounty";
  readonly projection_hash: Sha256Id;
  readonly value_b64u: string;
  readonly value_hash: Sha256Id;
  readonly actor_address: string;
  readonly module_account: ZeroneAccountId;
  readonly reserved_spend_uzrn: string;
  readonly required_gas: string;
}

export interface ZeroneEconomyEffect {
  readonly message_index: number;
  readonly kind: "escrow_lock" | "review_fee" | "fulfillment_request";
  readonly module: "sponsorship" | "knowledge";
  readonly direction: "outgoing" | "conditional_incoming";
  readonly asset_id: string;
  readonly amount_atomic: string | null;
  readonly condition: "message_success" | "keeper_state_and_message_success";
}

export interface ZeroneEconomyDirectSignPlan {
  readonly protocol: typeof ECONOMY_ADAPTER_PROTOCOL;
  readonly execution_support: typeof EXECUTION_SUPPORT;
  readonly zerone_core_commit: string;
  readonly cosmos_sdk: string;
  readonly sponsorship_consensus_version: number;
  readonly knowledge_consensus_version: number;
  readonly activation_observation_hash: Sha256Id;
  readonly activation_observed_at_height: string;
  readonly plan_id: Sha256Id;
  readonly network: ZeroneNetwork;
  readonly chain_id: ZeroneCaip2;
  readonly chain_reference: string;
  readonly source_account: ZeroneAccountId;
  readonly intent_record_id: Sha256Id;
  readonly signer_key_id: Sha256Id;
  readonly signer_public_key_b64u: string;
  readonly account_number: string;
  readonly sequence: string;
  readonly account_observed_at_height: string;
  readonly fee: ZeroneEconomyCoin;
  readonly gas_limit: string;
  readonly required_gas_limit: string;
  readonly total_reserved_spend_uzrn: string;
  readonly messages: readonly ZeroneEconomyPlannedMessage[];
  readonly simulation_effects: readonly SimulationEffect[];
  readonly economic_effects: readonly ZeroneEconomyEffect[];
  readonly body_bytes_b64u: string;
  readonly body_bytes_hash: Sha256Id;
  readonly auth_info_bytes_b64u: string;
  readonly auth_info_bytes_hash: Sha256Id;
  readonly sign_doc_bytes_b64u: string;
  readonly sign_doc_bytes_hash: Sha256Id;
  readonly simulation_tx_bytes_b64u: string;
  readonly simulation_tx_bytes_hash: Sha256Id;
}

export interface CreateZeroneEconomyDirectSignPlanInput {
  readonly intent: Verified<TransactionIntent>;
  readonly projections: readonly UnsignedMessageProjection[];
  readonly network: ZeroneNetwork;
  readonly signer_public_key: Uint8Array;
  readonly account_observation: ZeroneAccountObservation;
  readonly activation_observation: ZeroneEconomyActivationObservation;
  readonly fee_amount_uzrn: string;
  readonly gas_limit: string;
}

export interface ReconstructZeroneEconomyDirectSignPlanInput
  extends CreateZeroneEconomyDirectSignPlanInput {
  readonly expected_plan_content_id: Sha256Id;
}

export interface ZeroneEconomySimulationBinding {
  readonly protocol: typeof ECONOMY_SIMULATION_BINDING_PROTOCOL;
  readonly plan_id: Sha256Id;
  readonly intent_record_id: Sha256Id;
  readonly simulation_record_id: Sha256Id;
  readonly simulation_tx_bytes_hash: Sha256Id;
  readonly simulation_evidence_content_id: Sha256Id;
  readonly simulation_evidence_record_id: Sha256Id;
  readonly activation_observation_hash: Sha256Id;
}

export interface ZeroneEconomySimulationEvidenceContent {
  readonly schema: typeof ECONOMY_SIMULATION_EVIDENCE_SCHEMA;
  readonly zerone_core_commit: typeof ZERONE_ECONOMY_CORE_COMMIT;
  readonly cosmos_sdk: typeof ZERONE_ECONOMY_COSMOS_SDK;
  readonly sponsorship_consensus_version:
    typeof ZERONE_SPONSORSHIP_CONSENSUS_VERSION;
  readonly knowledge_consensus_version:
    typeof ZERONE_KNOWLEDGE_CONSENSUS_VERSION;
  readonly activation_observation_hash: Sha256Id;
  readonly plan_id: Sha256Id;
  readonly intent_id: string;
  readonly intent_record_id: Sha256Id;
  readonly simulation_id: string;
  readonly simulation_record_id: Sha256Id;
  readonly simulation_tx_bytes_hash: Sha256Id;
  readonly chain_id: ZeroneCaip2;
  readonly source_account: ZeroneAccountId;
  readonly adapter: Ed25519PublicKey;
  readonly status: "succeeded" | "failed";
  readonly code: number;
  readonly codespace: string;
  readonly gas_wanted: string;
  readonly gas_used: string;
  readonly observed_at_height: string;
  readonly block_ref: string;
  readonly block_hash: string | null;
  readonly simulated_at: string;
  readonly valid_until: string;
}

export interface ZeroneEconomySimulationEvidenceCore
  extends ZeroneEconomySimulationEvidenceContent {
  readonly content_id: Sha256Id;
}

export type ZeroneEconomySimulationEvidence =
  ZeroneEconomySimulationEvidenceCore & {
    readonly record_id: Sha256Id;
    readonly signature: RecordSignature;
  };

declare const verifiedZeroneEconomySimulationEvidenceBrand: unique symbol;
export type VerifiedZeroneEconomySimulationEvidence =
  Readonly<ZeroneEconomySimulationEvidence> & {
    readonly [verifiedZeroneEconomySimulationEvidenceBrand]: true;
  };

export interface CreateZeroneEconomySimulationEvidenceInput {
  readonly plan: ZeroneEconomyDirectSignPlan;
  readonly simulation: Verified<SimulationReceipt>;
  readonly simulation_result: ZeroneSimulationResult;
  readonly signer: RecordSigner;
}

export interface CreateZeroneEconomySimulationBindingInput {
  readonly plan: ZeroneEconomyDirectSignPlan;
  readonly simulation: Verified<SimulationReceipt>;
  readonly evidence: VerifiedZeroneEconomySimulationEvidence;
}

export interface CreateZeroneEconomySigningRequestInput {
  readonly plan: ZeroneEconomyDirectSignPlan;
  readonly simulation: Verified<SimulationReceipt>;
  readonly binding: ZeroneEconomySimulationBinding;
  readonly authorization: AuthorizedIntent;
  readonly request_id: string;
  /** Caller-supplied structural time; must equal authorization.checked_at. */
  readonly requested_at: string;
}

export interface CreateZeroneEconomySignedPayloadInput {
  readonly plan: ZeroneEconomyDirectSignPlan;
  readonly request: SigningRequest;
  /** Compact 64-byte, lower-S secp256k1 signature over SHA-256(SignDoc). */
  readonly signature: Uint8Array;
  readonly signer_operation_id?: string | null;
}

export interface VerifiedZeroneEconomyTransaction {
  readonly chain_id: ZeroneCaip2;
  readonly intent_record_id: Sha256Id;
  readonly plan_id: Sha256Id;
  readonly tx_hash: ZeroneTxHash;
  readonly tx_bytes_b64u: string;
  readonly tx_bytes_hash: Sha256Id;
  readonly signed_payload: Readonly<SignedPayload>;
}

export interface ZeroneEconomySignedTransactionContent {
  readonly schema: typeof ECONOMY_SIGNED_TRANSACTION_SCHEMA;
  readonly zerone_core_commit: typeof ZERONE_ECONOMY_CORE_COMMIT;
  readonly cosmos_sdk: typeof ZERONE_ECONOMY_COSMOS_SDK;
  readonly sponsorship_consensus_version:
    typeof ZERONE_SPONSORSHIP_CONSENSUS_VERSION;
  readonly knowledge_consensus_version:
    typeof ZERONE_KNOWLEDGE_CONSENSUS_VERSION;
  readonly signing_algorithm: "cosmos.secp256k1.sign-mode-direct";
  readonly signer_public_key_type_url: "/cosmos.crypto.secp256k1.PubKey";
  readonly plan_id: Sha256Id;
  readonly plan_content_id: Sha256Id;
  readonly activation_observation_hash: Sha256Id;
  readonly activation_observed_at_height: string;
  readonly intent_record_id: Sha256Id;
  readonly simulation_record_id: Sha256Id;
  readonly simulation_evidence_content_id: Sha256Id;
  readonly simulation_evidence_record_id: Sha256Id;
  readonly simulation_tx_bytes_hash: Sha256Id;
  readonly request_id: string;
  readonly requested_at: string;
  /** Signer-provider correspondence only; it is not part of the Cosmos signature. */
  readonly signer_operation_id: string | null;
  readonly chain_id: ZeroneCaip2;
  readonly chain_reference: string;
  readonly source_account: ZeroneAccountId;
  readonly account_number: string;
  readonly sequence: string;
  readonly account_observed_at_height: string;
  readonly signer_key_id: Sha256Id;
  readonly signer_public_key_b64u: string;
  readonly fee: ZeroneEconomyCoin;
  readonly gas_limit: string;
  readonly required_gas_limit: string;
  readonly total_reserved_spend_uzrn: string;
  readonly message: ZeroneEconomyPlannedMessage;
  readonly economic_effect: ZeroneEconomyEffect;
  readonly body_bytes_b64u: string;
  readonly body_bytes_hash: Sha256Id;
  readonly auth_info_bytes_b64u: string;
  readonly auth_info_bytes_hash: Sha256Id;
  readonly sign_doc_bytes_b64u: string;
  readonly sign_doc_bytes_hash: Sha256Id;
  readonly tx_bytes_b64u: string;
  readonly tx_bytes_hash: Sha256Id;
  readonly tx_hash: ZeroneTxHash;
}

export interface ZeroneEconomySignedTransactionRecord
  extends ZeroneEconomySignedTransactionContent {
  readonly content_id: Sha256Id;
}

declare const verifiedZeroneEconomySignedTransactionRecordBrand: unique symbol;
export type VerifiedZeroneEconomySignedTransactionRecord =
  Readonly<ZeroneEconomySignedTransactionRecord> & {
    readonly [verifiedZeroneEconomySignedTransactionRecordBrand]: true;
  };

export interface CreateZeroneEconomySignedTransactionRecordInput {
  readonly plan: ZeroneEconomyDirectSignPlan;
  readonly request: SigningRequest;
  readonly transaction: VerifiedZeroneEconomyTransaction;
}

export interface ZeroneEconomySimulationReceiptInput {
  readonly plan: ZeroneEconomyDirectSignPlan;
  readonly simulation: ZeroneSimulationResult;
  readonly intent: Verified<TransactionIntent>;
  readonly adapter: Ed25519PublicKey;
  readonly simulation_id: string;
  /** Canonical observed block hash: exactly 64 uppercase hexadecimal characters. */
  readonly block_hash: string;
  readonly simulated_at: string;
  readonly valid_until: string;
}

export type ZeroneEconomySimulationReceiptCore = SimulationReceiptCore;
