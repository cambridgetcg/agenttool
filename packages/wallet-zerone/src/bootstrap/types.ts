/**
 * Developer-preview shared contract. Types only: no I/O, custody or authority.
 * Runtime validators must reject unknown fields; TypeScript alone is not a gate.
 * Doctrine: docs/specs/ZERONE-SEED-IO-0.1.md
 */
import type {
  AuthorizationContext,
  AuthorizedIntent,
  Sha256Id,
  SigningRequest,
  SimulationReceipt,
  SimulationReceiptCore,
  TransactionIntent,
  Verified,
  WalletCapability,
  WalletDescriptor,
} from "@agenttool/wallet";

/** Canonical decimal strings; uint64 and SDK-uint256 limits are field-specific. */
export type SeedUint = string;
/** RFC 4648 URL-safe base64, unpadded, canonical roundtrip; never standard base64. */
export type SeedBase64Url = string;
/** Exactly 64 uppercase hexadecimal digits, SHA256 of raw canonical TxRaw bytes. */
export type SeedTxHash = string;
/** UTC YYYY-MM-DDTHH:mm:ss.sssZ, finite, roundtrips through Date. */
export type SeedTimestamp = string;
export type SeedChainId = `cosmos:${string}`;
export type SeedAccountId = `cosmos:${string}:zrn${string}`;
export type SeedAssetId = `cosmos:${string}/denom:uzrn`;
export type SeedClaimTypeUrl = "/zerone.claiming_pot.v1.MsgClaim";
export type SeedClaimMethod = "zerone.claiming_pot.v1.MsgClaim";

export interface SeedProfileCore {
  readonly protocol: "agent-wallet-zerone.seed-profile/0.1";
  readonly chain_reference: string;
  readonly chain_id: SeedChainId;
  readonly native_asset_id: SeedAssetId;
  readonly claiming_pot_account: SeedAccountId;
  readonly genesis_hash: Sha256Id;
  /** Exact canonical source manifest bytes, not a git SHA padded to SHA256. */
  readonly source_digest: Sha256Id;
  readonly zerone_core_commit: string;
  readonly cosmos_sdk_version: "v0.53.8";
  readonly runtime_sha256: Sha256Id;
  readonly helper_sha256: Sha256Id;
  readonly native_denom: "uzrn";
  readonly bech32_prefix: "zrn";
  readonly seed_amount_uzrn: "222000";
  readonly claim_type_url: SeedClaimTypeUrl;
  readonly claim_gas_floor: SeedUint;
  readonly tx_gas_cap: SeedUint;
  readonly min_gas_price_uzrn: SeedUint;
  readonly confirmation_depth: 1;
}
export interface SeedProfile extends SeedProfileCore {
  readonly profile_id: Sha256Id;
}

export interface SeedPolicyCore {
  readonly protocol: "agent-wallet-zerone.seed-policy/0.1";
  readonly profile_id: Sha256Id;
  /** Public hash of independently approved node trust configuration. */
  readonly node_trust_id: Sha256Id;
  readonly claimant_account: SeedAccountId;
  readonly sponsor_account: SeedAccountId;
  readonly pot_id: string;
  readonly max_intents: 1;
  readonly seed_amount_uzrn: "222000";
  readonly max_fee_uzrn: SeedUint;
  readonly max_gas: SeedUint;
  /** Reserve this entire finite sponsor grant exposure, not estimated Claim fee. */
  readonly grant_spend_limit_uzrn: SeedUint;
  readonly grant_expires_at: SeedTimestamp;
  /** Separately approved aggregate setup-cost ceiling; never claimant spend. */
  readonly setup_fee_budget_uzrn: SeedUint;
  readonly not_before: SeedTimestamp;
  readonly expires_at: SeedTimestamp;
  /** Required nonzero TxBody.timeout_height, no automatic replacement. */
  readonly timeout_height: SeedUint;
  readonly max_observation_age_seconds: number;
  readonly max_height_lag: number;
}
export interface SeedPolicy extends SeedPolicyCore {
  readonly policy_hash: Sha256Id;
}

export interface SeedBlockAnchor {
  readonly height: SeedUint;
  readonly block_hash: Sha256Id;
  readonly block_time: SeedTimestamp;
}
export interface SeedReadEvidence {
  readonly trust: "configured_full_node";
  readonly node_trust_id: Sha256Id;
  readonly profile_id: Sha256Id;
  readonly chain_id: SeedChainId;
  readonly genesis_hash: Sha256Id;
  readonly anchor: SeedBlockAnchor;
  readonly latest_height: SeedUint;
  readonly catching_up: boolean;
  readonly observed_at: SeedTimestamp;
}
export type SeedUnknownReason =
  | "unavailable" | "not_found_unproven" | "unsupported_state"
  | "incoherent_height" | "chain_mismatch" | "genesis_mismatch"
  | "stale" | "catching_up" | "response_limit" | "invalid_response";

export type SeedAccountObservation =
  | { readonly status: "absent"; readonly account: SeedAccountId }
  | {
      readonly status: "found";
      readonly account: SeedAccountId;
      readonly account_number: SeedUint;
      readonly sequence: SeedUint;
      readonly public_key: null | {
        readonly type_url: "/cosmos.crypto.secp256k1.PubKey";
        /** Compressed 33-byte key, not protobuf PubKey bytes. */
        readonly key_b64u: SeedBase64Url;
      };
    };

export interface SeedPot {
  readonly pot_id: string;
  readonly status: "active" | "depleted" | "expired" | "unspecified";
  readonly total_amount_uzrn: SeedUint;
  readonly claimed_amount_uzrn: SeedUint;
  readonly start_block: SeedUint;
  readonly end_block: SeedUint;
  readonly cliff_blocks: SeedUint;
  readonly period_blocks: SeedUint;
  readonly min_staking_tier: number;
  readonly min_registration_age: SeedUint;
  /** At most one; anything wider is unsupported by this seed profile. */
  readonly whitelist: readonly string[];
}
export interface SeedClaimRecord {
  readonly pot_id: string;
  readonly claimant: string;
  readonly amount_uzrn: SeedUint;
  readonly claimed_at: SeedUint;
}
export type SeedAllowanceObservation =
  | { readonly status: "absent" }
  | {
      readonly status: "found";
      readonly granter: string;
      readonly grantee: string;
      readonly type_url: "/cosmos.feegrant.v1beta1.AllowedMsgAllowance";
      readonly inner_type_url: "/cosmos.feegrant.v1beta1.BasicAllowance";
      readonly allowed_messages: readonly [SeedClaimTypeUrl];
      readonly spend_limit_uzrn: SeedUint;
      readonly expires_at: SeedTimestamp;
    };

/** All-or-unknown coherent snapshot; a failed surface cannot become a zero. */
export type SeedObservation =
  | {
      readonly protocol: "agent-wallet-zerone.seed-observation/0.1";
      readonly status: "unknown";
      readonly profile_id: Sha256Id;
      readonly reason: SeedUnknownReason;
    }
  | {
      readonly protocol: "agent-wallet-zerone.seed-observation/0.1";
      readonly status: "observed";
      readonly evidence: SeedReadEvidence;
      readonly claimant: SeedAccountObservation;
      readonly sponsor_account: SeedAccountId;
      readonly sponsor_balance_uzrn: SeedUint;
      readonly pot: SeedPot | null;
      readonly prior_claim: SeedClaimRecord | null;
      readonly min_claim_amount_uzrn: SeedUint;
      readonly allowance: SeedAllowanceObservation;
      readonly supply: {
        readonly total_minted_uzrn: SeedUint;
        readonly current_supply_uzrn: SeedUint;
        readonly max_supply_uzrn: SeedUint;
      };
    };

export type SeedAssessmentReason =
  | SeedUnknownReason | "not_yet_valid" | "expired" | "timeout_height"
  | "pot_missing" | "pot_shape" | "pot_inactive" | "already_claimed"
  | "not_vested" | "below_minimum" | "supply_exhausted" | "account_missing"
  | "key_mismatch" | "allowance_missing" | "allowance_mismatch"
  | "sponsor_underfunded" | "policy_mismatch";
export type SeedAssessment =
  | { readonly status: "unknown" | "blocked"; readonly reason: SeedAssessmentReason }
  | {
      readonly status: "ready";
      readonly observation_hash: Sha256Id;
      readonly expected_credit_uzrn: SeedUint;
      readonly sponsor_exposure_uzrn: SeedUint;
    };

export interface SeedClaimCommitment {
  readonly protocol: "agent-wallet-zerone.seed-commitment/0.1";
  readonly profile_id: Sha256Id;
  readonly source_digest: Sha256Id;
  readonly genesis_hash: Sha256Id;
  readonly chain_id: SeedChainId;
  readonly chain_reference: string;
  readonly policy_hash: Sha256Id;
  readonly capability_record_id: Sha256Id;
  readonly intent_record_id: Sha256Id;
  readonly claimant_account: SeedAccountId;
  readonly sponsor_account: SeedAccountId;
  readonly pot_id: string;
  readonly signer_key_id: Sha256Id;
  readonly signer_public_key_b64u: SeedBase64Url;
  readonly account_number: SeedUint;
  readonly sequence: SeedUint;
  readonly fee_amount_uzrn: SeedUint;
  readonly gas_limit: SeedUint;
  readonly timeout_height: SeedUint;
  readonly expires_at: SeedTimestamp;
  readonly grant_spend_limit_uzrn: SeedUint;
  readonly grant_expires_at: SeedTimestamp;
}
export interface SeedUnsignedBytes {
  readonly body_bytes_b64u: SeedBase64Url;
  readonly body_bytes_hash: Sha256Id;
  readonly auth_info_bytes_b64u: SeedBase64Url;
  readonly auth_info_bytes_hash: Sha256Id;
  readonly sign_doc_bytes_b64u: SeedBase64Url;
  readonly sign_doc_bytes_hash: Sha256Id;
  /** TxRaw with exactly one empty signature slot; not a signed transaction. */
  readonly simulation_tx_bytes_b64u: SeedBase64Url;
  readonly simulation_tx_bytes_hash: Sha256Id;
}
export interface SeedClaimPlanCore extends SeedUnsignedBytes {
  readonly protocol: "agent-wallet-zerone.seed-plan/0.1";
  readonly commitment: SeedClaimCommitment;
  readonly commitment_hash: Sha256Id;
  readonly observation_hash: Sha256Id;
}
export interface SeedClaimPlan extends SeedClaimPlanCore {
  readonly plan_id: Sha256Id;
}
export interface SeedSimulationResult {
  readonly status: "succeeded" | "failed";
  readonly plan_id: Sha256Id;
  readonly simulation_tx_bytes_hash: Sha256Id;
  readonly evidence: SeedReadEvidence;
  readonly code: number;
  readonly gas_wanted: SeedUint;
  readonly gas_used: SeedUint;
}
export interface SeedSimulationBinding {
  readonly protocol: "agent-wallet-zerone.seed-simulation-binding/0.1";
  readonly plan_id: Sha256Id;
  readonly simulation_record_id: Sha256Id;
  readonly simulation_tx_bytes_hash: Sha256Id;
}

export interface AssessSeedInput {
  readonly profile: SeedProfile;
  readonly policy: SeedPolicy;
  readonly observation: SeedObservation;
  readonly signer_public_key_b64u: SeedBase64Url;
  readonly now: SeedTimestamp;
}
export interface CreateSeedClaimPlanInput extends AssessSeedInput {
  readonly capability: Verified<WalletCapability>;
  readonly intent: Verified<TransactionIntent>;
  readonly fee_amount_uzrn: SeedUint;
  readonly gas_limit: SeedUint;
}
export interface AuthorizeSeedClaimInput {
  readonly profile: SeedProfile;
  readonly policy: SeedPolicy;
  readonly descriptor: Verified<WalletDescriptor>;
  readonly capability: Verified<WalletCapability>;
  readonly intent: Verified<TransactionIntent>;
  readonly simulation: Verified<SimulationReceipt>;
  readonly context: AuthorizationContext;
}
export interface SeedSimulationReceiptInput {
  readonly plan: SeedClaimPlan;
  readonly intent: Verified<TransactionIntent>;
  readonly result: SeedSimulationResult;
  readonly adapter: SimulationReceiptCore["adapter"];
  readonly simulation_id: string;
  readonly simulated_at: SeedTimestamp;
  readonly valid_until: SeedTimestamp;
}

/** Expected functions exported by the future bootstrap/v1.ts entrypoint. */
export interface SeedPlannerApi {
  createSeedProfile(core: SeedProfileCore): Readonly<SeedProfile>;
  createSeedPolicy(profile: SeedProfile, core: SeedPolicyCore): Readonly<SeedPolicy>;
  encodeSeedMsgClaim(message: { readonly claimant: string; readonly pot_id: string }): Uint8Array;
  assessSeedClaim(input: AssessSeedInput): Readonly<SeedAssessment>;
  createSeedClaimPlan(input: CreateSeedClaimPlanInput): Readonly<SeedClaimPlan>;
  /** Recomputes canonical IDs and every unsigned byte; no production signed input. */
  assertSeedClaimPlan(plan: SeedClaimPlan, profile: SeedProfile, policy: SeedPolicy): void;
  authorizeSeedClaim(input: AuthorizeSeedClaimInput): AuthorizedIntent;
  createSeedSimulationReceiptCore(input: SeedSimulationReceiptInput): SimulationReceiptCore;
  createSeedSimulationBinding(input: {
    readonly plan: SeedClaimPlan;
    readonly simulation: Verified<SimulationReceipt>;
    readonly result: SeedSimulationResult;
  }): Readonly<SeedSimulationBinding>;
  createSeedSigningRequest(input: {
    readonly plan: SeedClaimPlan;
    readonly simulation: Verified<SimulationReceipt>;
    readonly binding: SeedSimulationBinding;
    readonly authorization: AuthorizedIntent;
    readonly request_id: string;
  }): Readonly<SigningRequest>;
}

// External native helper wire declarations only. Never pass these configuration
// handles to public plan/policy hashing, Wallet records, logs or artifacts.
export type SeedNodeConfig = {
  readonly node_trust_id: Sha256Id;
  readonly rpc_url: string;
  readonly grpc_address: string;
} & (
  | { readonly mode: "local" }
  | { readonly mode: "tls"; readonly tls_server_name: string; readonly ca_file: string }
);
export interface SeedKeyringHandle {
  readonly backend: "os" | "file" | "pass" | "test";
  readonly home: string;
  readonly key_name: string;
}
export interface SeedIoBase {
  readonly protocol: "zerone-seed-io/0.1";
  readonly request_id: string;
  /** 1..30000, total command deadline; no implicit retry. */
  readonly timeout_ms: number;
}
export interface SeedIoClaimContext {
  readonly profile: SeedProfile;
  readonly policy: SeedPolicy;
  readonly plan: SeedClaimPlan;
}
export type SeedIoRequest = SeedIoBase & (
  | {
      readonly command: "inspect";
      readonly profile: SeedProfile;
      readonly policy: SeedPolicy;
      readonly node: SeedNodeConfig;
      /** null chooses one latest committed height, then pins every state read. */
      readonly height: SeedUint | null;
    }
  | (SeedIoClaimContext & {
      readonly command: "simulate";
      readonly node: SeedNodeConfig;
      readonly height: SeedUint;
    })
  | (SeedIoClaimContext & {
      readonly command: "sign";
      readonly keyring: SeedKeyringHandle;
      /** Explicit new private file, exclusive create; never overwritten or retried. */
      readonly signed_tx_path: string;
    })
  | (SeedIoClaimContext & {
      readonly command: "verify";
      readonly signed_tx_path: string;
    })
  | (SeedIoClaimContext & {
      readonly command: "submit";
      readonly node: SeedNodeConfig;
      readonly signed_tx_path: string;
      readonly expected_tx_hash: SeedTxHash;
    })
  | (SeedIoClaimContext & {
      readonly command: "lookup";
      readonly node: SeedNodeConfig;
      readonly tx_hash: SeedTxHash;
    })
  | {
      readonly command: "operator-grant";
      readonly profile: SeedProfile;
      readonly granter: string;
      readonly grantee: string;
      readonly spend_limit_uzrn: SeedUint;
      readonly expires_at: SeedTimestamp;
      readonly now: SeedTimestamp;
    }
  | {
      readonly command: "operator-revoke";
      readonly profile: SeedProfile;
      readonly granter: string;
      readonly grantee: string;
    }
  | {
      readonly command: "operator-admit";
      readonly profile: SeedProfile;
      readonly authority: string;
      /** One recipient per operator construction in this MVP. */
      readonly address: string;
    }
);
export type SeedIoCommand = SeedIoRequest["command"];
export interface SeedSignedSummary {
  readonly plan_id: Sha256Id;
  readonly commitment_hash: Sha256Id;
  readonly signer_key_id: Sha256Id;
  readonly sign_doc_bytes_hash: Sha256Id;
  readonly signed_tx_bytes_hash: Sha256Id;
  readonly tx_hash: SeedTxHash;
}
export type SeedSubmitResult =
  | { readonly status: "accepted"; readonly tx_hash: SeedTxHash }
  | { readonly status: "submission_unknown"; readonly tx_hash: SeedTxHash };
export type SeedLookupResult =
  | { readonly status: "absent"; readonly tx_hash: SeedTxHash; readonly evidence: SeedReadEvidence }
  | { readonly status: "unknown"; readonly tx_hash: SeedTxHash; readonly reason: SeedUnknownReason }
  | {
      readonly status: "included";
      readonly tx_hash: SeedTxHash;
      readonly inclusion: SeedBlockAnchor;
      readonly evidence: SeedReadEvidence;
      readonly code: number;
      readonly gas_used: SeedUint;
      /** Positive exact Tx event + native claim-record agreement, else null. */
      readonly credited_amount_uzrn: SeedUint | null;
      readonly claimant_sequence: SeedUint;
      /** Exact native allowance at the evidence height, not inferred consumption. */
      readonly allowance: SeedAllowanceObservation;
    };
export type SeedOperatorMessage =
  | { readonly type_url: "/cosmos.feegrant.v1beta1.MsgGrantAllowance"; readonly value_b64u: SeedBase64Url; readonly value_hash: Sha256Id }
  | { readonly type_url: "/cosmos.feegrant.v1beta1.MsgRevokeAllowance"; readonly value_b64u: SeedBase64Url; readonly value_hash: Sha256Id }
  | { readonly type_url: "/zerone.claiming_pot.v1.MsgAddBootstrapEntry"; readonly value_b64u: SeedBase64Url; readonly value_hash: Sha256Id };
export type SeedIoErrorCode =
  | "invalid_request" | "unsupported_command" | "limit_exceeded"
  | "profile_mismatch" | "policy_mismatch" | "plan_mismatch"
  | "node_unavailable" | "observation_unknown" | "key_mismatch"
  | "unsafe_path" | "already_exists" | "signature_invalid"
  | "signing_unknown" | "internal_error";
export type SeedIoResponse = {
  readonly protocol: "zerone-seed-io/0.1";
  readonly request_id: string;
} & (
  | { readonly status: "error"; readonly command: SeedIoCommand; readonly code: SeedIoErrorCode }
  | { readonly status: "ok"; readonly command: "inspect"; readonly result: SeedObservation }
  | { readonly status: "ok"; readonly command: "simulate"; readonly result: SeedSimulationResult }
  | { readonly status: "ok"; readonly command: "sign" | "verify"; readonly result: SeedSignedSummary }
  | { readonly status: "ok"; readonly command: "submit"; readonly result: SeedSubmitResult }
  | { readonly status: "ok"; readonly command: "lookup"; readonly result: SeedLookupResult }
  | { readonly status: "ok"; readonly command: "operator-grant"; readonly result: Extract<SeedOperatorMessage, { readonly type_url: "/cosmos.feegrant.v1beta1.MsgGrantAllowance" }> }
  | { readonly status: "ok"; readonly command: "operator-revoke"; readonly result: Extract<SeedOperatorMessage, { readonly type_url: "/cosmos.feegrant.v1beta1.MsgRevokeAllowance" }> }
  | { readonly status: "ok"; readonly command: "operator-admit"; readonly result: Extract<SeedOperatorMessage, { readonly type_url: "/zerone.claiming_pot.v1.MsgAddBootstrapEntry" }> }
);
