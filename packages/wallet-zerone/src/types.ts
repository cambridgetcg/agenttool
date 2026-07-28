import type {
  AssetAmount,
  AuthorizedIntent,
  Ed25519PublicKey,
  SignedPayload,
  SigningRequest,
  SimulationEffect,
  SimulationReceipt,
  TransactionIntent,
  Verified,
} from "@agenttool/wallet";

import type {
  AGENTTOOL_ADAPTER_ID,
  AGENTTOOL_WORK_CLASS_ID,
  ZERONE_MSG_SEND_TYPE_URL,
  ZERONE_MSG_SUBMIT_EXTERNAL_ATTESTATION_TYPE_URL,
} from "./constants.js";

export type ZeroneNetwork = "mainnet" | "testnet";
export type ZeroneCaip2 =
  | "cosmos:zerone-1"
  | "cosmos:zerone-testnet-1";
export type ZeroneNativeAsset =
  | "cosmos:zerone-1/denom:uzrn"
  | "cosmos:zerone-testnet-1/denom:uzrn";
export type ZeroneAccountId = `${ZeroneCaip2}:zrn${string}`;
export type ZeroneTxHash = string;

export interface AgentToolInvocationProjection {
  readonly amount: number;
  readonly buyer_did: string;
  readonly completed_at: string | null;
  readonly completion_sig: string | null;
  readonly created_at: string;
  readonly currency: string;
  readonly id: string;
  readonly listing_id: string;
  readonly settled_at: string | null;
  readonly status: string;
}

export interface ZeroneChainProfile {
  readonly network: ZeroneNetwork;
  readonly chain_reference: "zerone-1" | "zerone-testnet-1";
  readonly chain_id: ZeroneCaip2;
  readonly native_asset_id: ZeroneNativeAsset;
  readonly native_denom: "uzrn";
  readonly display_denom: "ZRN";
  readonly decimals: 6;
  readonly bech32_prefix: "zrn";
  readonly bip44_coin_type: 118;
  readonly substrate_bridge_account: ZeroneAccountId;
  /**
   * One block committed after inclusion is the adapter's conservative
   * confirmation-depth threshold. This is not proof of application settlement.
   */
  readonly confirmation_depth: 1;
}

export interface ZeroneCoin {
  readonly denom: "uzrn";
  readonly amount: string;
}

export interface ZeroneMsgSend {
  readonly from_address: string;
  readonly to_address: string;
  readonly amount: readonly [ZeroneCoin];
}

export interface ZeroneExternalSource {
  /**
   * Empty in the pinned live relay. Non-empty values are rejected because the
   * keeper's ComputeLinkHash does not bind this field.
   */
  readonly adapter_id: "";
  readonly source_id: string;
  readonly source_url: string;
  readonly content_hash: Uint8Array;
  readonly fetched_at_block: string;
}

export interface ZeroneWitnessSubstrateLink {
  readonly adapter_id: typeof AGENTTOOL_ADAPTER_ID;
  readonly source: ZeroneExternalSource;
  readonly link_hash: Uint8Array;
}

export interface ZeroneMsgSubmitExternalAttestation {
  readonly submitter: string;
  readonly adapter_id: typeof AGENTTOOL_ADAPTER_ID;
  readonly work_class_id: typeof AGENTTOOL_WORK_CLASS_ID;
  readonly link: ZeroneWitnessSubstrateLink;
  readonly bond_uzrn: string;
}

export type ZeroneAllowedMessage =
  | {
      readonly type_url: typeof ZERONE_MSG_SEND_TYPE_URL;
      readonly value_b64u: string;
      readonly value_hash: `sha256:${string}`;
    }
  | {
      readonly type_url: typeof ZERONE_MSG_SUBMIT_EXTERNAL_ATTESTATION_TYPE_URL;
      readonly value_b64u: string;
      readonly value_hash: `sha256:${string}`;
    };

export interface ZeroneAdapterSnapshot {
  readonly chain_id: ZeroneCaip2;
  readonly adapter_id: typeof AGENTTOOL_ADAPTER_ID;
  readonly version: string;
  readonly status: "active" | "suspended" | "tombstoned";
  readonly min_attestation_bond_uzrn: string;
  readonly allowed_work_class_ids: readonly string[];
  readonly required_qualification_domain: string | null;
  readonly observed_at_height: string;
}

export interface ZeroneDirectSignPlan {
  readonly protocol: "agent-wallet-zerone/0.1";
  readonly zerone_core_commit: string;
  readonly plan_id: `sha256:${string}`;
  readonly network: ZeroneNetwork;
  readonly chain_id: ZeroneCaip2;
  readonly chain_reference: string;
  readonly source_account: ZeroneAccountId;
  readonly intent_record_id: `sha256:${string}`;
  readonly signer_key_id: `sha256:${string}`;
  readonly signer_public_key_b64u: string;
  readonly account_number: string;
  readonly sequence: string;
  readonly fee: ZeroneCoin;
  readonly gas_limit: string;
  /** Pinned ZRNGasDecorator floor for this exact ordered message list. */
  readonly required_gas_limit: string;
  readonly messages: readonly ZeroneAllowedMessage[];
  readonly simulation_effects: readonly SimulationEffect[];
  readonly body_bytes_b64u: string;
  readonly body_bytes_hash: `sha256:${string}`;
  readonly auth_info_bytes_b64u: string;
  readonly auth_info_bytes_hash: `sha256:${string}`;
  readonly sign_doc_bytes_b64u: string;
  readonly sign_doc_bytes_hash: `sha256:${string}`;
  readonly simulation_tx_bytes_b64u: string;
  readonly simulation_tx_bytes_hash: `sha256:${string}`;
  readonly adapter_snapshot_height: string | null;
}

export interface CreateZeroneDirectSignPlanInput {
  readonly intent: Verified<TransactionIntent>;
  readonly network: ZeroneNetwork;
  readonly signer_public_key: Uint8Array;
  readonly account_observation: ZeroneAccountObservation;
  readonly fee_amount_uzrn: string;
  readonly gas_limit: string;
  readonly adapter_snapshot?: ZeroneAdapterSnapshot;
}

export interface ZeroneSimulationBinding {
  readonly protocol: "agent-wallet-zerone.simulation-binding/0.1";
  readonly plan_id: `sha256:${string}`;
  readonly intent_record_id: `sha256:${string}`;
  readonly simulation_record_id: `sha256:${string}`;
  readonly simulation_tx_bytes_hash: `sha256:${string}`;
}

export interface CreateZeroneSimulationBindingInput {
  readonly plan: ZeroneDirectSignPlan;
  readonly simulation: Verified<SimulationReceipt>;
  readonly simulation_result: ZeroneSimulationResult;
}

export interface CreateZeroneSigningRequestInput {
  readonly plan: ZeroneDirectSignPlan;
  readonly simulation: Verified<SimulationReceipt>;
  readonly binding: ZeroneSimulationBinding;
  readonly authorization: AuthorizedIntent;
  readonly request_id: string;
}

export interface CreateZeroneSignedPayloadInput {
  readonly plan: ZeroneDirectSignPlan;
  readonly request: SigningRequest;
  /** Compact 64-byte lower-S secp256k1 signature returned by a signer host. */
  readonly signature: Uint8Array;
  /** Optional signer-provider operation reference, never a transaction hash. */
  readonly signer_operation_id?: string | null;
}

export interface VerifiedZeroneTransaction {
  readonly chain_id: ZeroneCaip2;
  readonly intent_record_id: `sha256:${string}`;
  readonly tx_hash: ZeroneTxHash;
  readonly tx_bytes_b64u: string;
  readonly tx_bytes_hash: `sha256:${string}`;
  readonly signed_payload: Readonly<SignedPayload>;
}

export interface ZeroneSimulationReceiptInput {
  readonly plan: ZeroneDirectSignPlan;
  readonly simulation: ZeroneSimulationResult;
  readonly intent: Verified<TransactionIntent>;
  readonly adapter: Ed25519PublicKey;
  readonly simulation_id: string;
  readonly simulated_at: string;
  readonly valid_until: string;
}

export interface ZeroneAccountObservation {
  readonly status: "found";
  readonly account: ZeroneAccountId;
  readonly account_number: string;
  readonly sequence: string;
  /** Both public-key fields are null for a chain account with no key set. */
  readonly public_key_type_url:
    | "/cosmos.crypto.secp256k1.PubKey"
    | string
    | null;
  readonly public_key_b64u: string | null;
  readonly observed_at_height: string;
}

export interface ZeroneSimulationResult {
  readonly status: "succeeded" | "failed";
  readonly simulation_tx_bytes_hash: `sha256:${string}`;
  readonly code: number;
  readonly codespace: string;
  readonly gas_wanted: string;
  readonly gas_used: string;
  readonly observed_at_height: string;
}

export type ZeroneBroadcastResult =
  | {
      readonly status: "accepted";
      readonly tx_hash: ZeroneTxHash;
    }
  | {
      /**
       * The injected transport asserts the bytes were rejected before any
       * possible mempool admission. Ambiguous provider errors must not use it.
       */
      readonly status: "rejected_pre_submit";
      readonly tx_hash: ZeroneTxHash;
      readonly code: string;
    }
  | {
      readonly status: "ambiguous";
      readonly tx_hash: ZeroneTxHash;
      readonly code: string;
    };

export type ZeroneTransactionLookup =
  | {
      readonly status: "found";
      readonly tx_hash: ZeroneTxHash;
      readonly height: string;
      readonly observed_at_height: string;
      readonly code: number;
      readonly codespace: string;
      readonly block_hash: string;
    }
  | {
      readonly status: "absent";
      readonly tx_hash: ZeroneTxHash;
      readonly observed_at_height: string;
    }
  | {
      readonly status: "unavailable";
      readonly tx_hash: ZeroneTxHash;
      readonly code: string;
    };

export interface ZeroneTransportContext {
  readonly protocol: "agent-wallet-zerone.transport/0.1";
  readonly operation_id: number;
  readonly network: ZeroneNetwork;
  readonly chain_id: ZeroneCaip2;
  readonly chain_reference: string;
  readonly signal: AbortSignal;
  readonly deadline_at_ms: number;
  readonly max_response_bytes: number;
}

export interface ZeroneQueryTransport {
  query_account(
    request: ZeroneTransportContext & {
      readonly operation: "query_account";
      readonly account: ZeroneAccountId;
    },
  ): Promise<ZeroneAccountObservation>;

  query_agenttool_adapter(
    request: ZeroneTransportContext & {
      readonly operation: "query_agenttool_adapter";
      readonly adapter_id: typeof AGENTTOOL_ADAPTER_ID;
    },
  ): Promise<ZeroneAdapterSnapshot>;

  lookup_transaction(
    request: ZeroneTransportContext & {
      readonly operation: "lookup_transaction";
      readonly tx_hash: ZeroneTxHash;
    },
  ): Promise<ZeroneTransactionLookup>;
}

export interface ZeroneSimulationTransport {
  simulate(
    request: ZeroneTransportContext & {
      readonly operation: "simulate";
      readonly simulation_tx_bytes_b64u: string;
      readonly simulation_tx_bytes_hash: `sha256:${string}`;
    },
  ): Promise<ZeroneSimulationResult>;
}

export interface ZeroneBroadcastTransport {
  broadcast_once(
    request: ZeroneTransportContext & {
      readonly operation: "broadcast_once";
      readonly tx_hash: ZeroneTxHash;
      readonly tx_bytes_b64u: string;
      readonly tx_bytes_hash: `sha256:${string}`;
    },
  ): Promise<ZeroneBroadcastResult>;
}

export interface ZeroneAdapterClient {
  queryAccount(
    account: ZeroneAccountId,
    options?: ZeroneCallOptions,
  ): Promise<Readonly<ZeroneAccountObservation>>;
  queryAgenttoolAdapter(
    options?: ZeroneCallOptions,
  ): Promise<Readonly<ZeroneAdapterSnapshot>>;
  simulate(
    plan: ZeroneDirectSignPlan,
    options?: ZeroneCallOptions,
  ): Promise<Readonly<ZeroneSimulationResult>>;
  broadcastOnce(
    transaction: VerifiedZeroneTransaction,
    options?: ZeroneCallOptions,
  ): Promise<Readonly<ZeroneBroadcastResult>>;
  lookupTransaction(
    txHash: ZeroneTxHash,
    options?: ZeroneCallOptions,
  ): Promise<Readonly<ZeroneTransactionLookup>>;
}

export interface ZeroneCallOptions {
  readonly signal?: AbortSignal;
  readonly deadline_at_ms?: number;
}

export interface CreateZeroneAdapterClientInput {
  readonly network: ZeroneNetwork;
  readonly query: ZeroneQueryTransport;
  readonly simulation: ZeroneSimulationTransport;
  readonly broadcast: ZeroneBroadcastTransport;
  readonly now?: () => number;
}

export interface ZeroneIntentFixture {
  readonly intent: Verified<TransactionIntent>;
  readonly expected_spend: AssetAmount;
}
