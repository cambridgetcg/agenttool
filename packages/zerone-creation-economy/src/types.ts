import type { Sha256Id } from "@agenttool/wallet";
import type {
  ChainComputationalCommitment,
  ChainRequiresRelation,
  CreateBountyOrderValue,
} from "@agenttool/zerone-agent-economy";
import type {
  CreationArtifact,
  CreationClaimProjection,
  CreationContract,
  CreationLifecycle,
  CreationWitness,
  CreationWorkSpec,
  VerificationWitness,
  ZeroneClaimCategory,
} from "@agenttool/zerone-creation-claim";
import type {
  CREATION_ECONOMY_BOUNDARY,
  CREATION_ECONOMY_COMPATIBILITY,
  CREATION_ECONOMY_EFFECTS,
  CREATION_ECONOMY_FORMATS,
  CREATION_ECONOMY_SOURCE_PINS,
} from "./constants.js";
import type { VerifiedWalletIdentityBindingProof } from "@agenttool/zerone-agent-economy";

export interface CreationSubmitClaimValue {
  readonly submitter: string;
  readonly fact_content: string;
  readonly domain: string;
  readonly category: ZeroneClaimCategory;
  readonly stake: string;
  readonly references: readonly [];
  readonly partnership_id: "";
  readonly claim_type: 7;
  readonly relations: readonly ChainRequiresRelation[];
  readonly structure: null;
  readonly canonical_form: string;
  readonly sponsored: false;
  readonly method_id: "M-FORMAL" | "M-COMPUTATIONAL";
  readonly reasoning_trace: Sha256Id;
  readonly computational_commitment: ChainComputationalCommitment;
}

export type CreationPrivateCaip2 = `cosmos:zerone-creation-private-${string}`;
export type CreationPrivateAccountId = `${CreationPrivateCaip2}:${string}`;

export type CreationEconomyMessageValue =
  | CreateBountyOrderValue
  | CreationSubmitClaimValue;

export interface CreationEconomyMessageProjection<
  T extends CreationEconomyMessageValue = CreationEconomyMessageValue,
> {
  readonly format: (typeof CREATION_ECONOMY_FORMATS)["message_projection"];
  readonly network: "requested_private_disposable_testnet";
  readonly chain_id: CreationPrivateCaip2;
  readonly source_account: CreationPrivateAccountId;
  readonly type_url:
    | "/zerone.sponsorship.v1.MsgCreateBountyOrder"
    | "/zerone.knowledge.v1.MsgSubmitClaim";
  readonly wallet_method:
    | "zerone.sponsorship.v1.MsgCreateBountyOrder"
    | "zerone.knowledge.v1.MsgSubmitClaim";
  readonly value: T;
  readonly projection_bytes_b64u: string;
  readonly projection_hash: Sha256Id;
  readonly protobuf_value_b64u: string;
  readonly protobuf_value_hash: Sha256Id;
  readonly protobuf_any_b64u: string;
  readonly protobuf_any_hash: Sha256Id;
  readonly compatibility: typeof CREATION_ECONOMY_COMPATIBILITY;
  readonly semantic_boundary: {
    readonly zrn_role: "settlement_and_compute_asset_only";
    readonly creates_identity: false;
    readonly determines_truth: false;
    readonly creates_karma: false;
    readonly grants_governance: false;
  };
}

export interface CreationEconomyHandoffCore {
  readonly format: (typeof CREATION_ECONOMY_FORMATS)["handoff"];
  readonly source: {
    readonly contract_id: Sha256Id;
    readonly creation_work_spec_id: Sha256Id;
    readonly creation_witness_id: Sha256Id;
    readonly lifecycle_id: Sha256Id;
    readonly creation_artifact_id: Sha256Id;
    readonly creation_claim_projection_id: Sha256Id;
    readonly source_claim_status: "NOT_CONSENSUS_ADMISSIBLE";
  };
  readonly creation_scope: {
    readonly lane: CreationContract["lane"];
    readonly artifact_kind: CreationContract["artifact_kind"];
    readonly cyber_provider: "none" | "openai_cyber";
    readonly cyber_access_tier: "not_used" | "defensive_approved";
    readonly provider_access_ref: Sha256Id | null;
    readonly provider_policy_ref: Sha256Id | null;
    readonly target_authorization_ref: Sha256Id | null;
    readonly engagement_scope_ref: Sha256Id | null;
    readonly publication_authority_ref: Sha256Id;
    readonly evidence_scope: "SOURCE_CONTRACT_RECOMPUTED_CALLER_DECLARATIONS_NOT_CURRENTNESS_PROOF";
    readonly provider_access_is_target_authorization: false;
    readonly target_authorization_currentness_proven: false;
    readonly engagement_scope_currentness_proven: false;
  };
  readonly activation_evidence: {
    readonly zerone_core_commit: (typeof CREATION_ECONOMY_SOURCE_PINS)["zerone_core_commit"];
    readonly cosmos_sdk: (typeof CREATION_ECONOMY_SOURCE_PINS)["cosmos_sdk"];
    readonly chain_reference: string;
    readonly chain_id: CreationPrivateCaip2;
    readonly knowledge_consensus_version: 7;
    readonly sponsorship_consensus_version: 2;
    readonly binary_ref: Sha256Id;
    readonly genesis_ref: Sha256Id;
    readonly version_map_ref: Sha256Id;
    readonly migration_evidence_ref: Sha256Id;
    readonly bounty_roundtrip_evidence_ref: Sha256Id;
    readonly claim_roundtrip_evidence_ref: Sha256Id;
    readonly evidence_scope: "caller_declared_structural_only";
    readonly chain_reference_uniqueness_proven: false;
    readonly chain_privacy_proven: false;
    readonly chain_disposability_proven: false;
    readonly currentness_proven: false;
  };
  readonly wallet_identity: {
    readonly worker_account: CreationPrivateAccountId;
    readonly worker_address: string;
    readonly wallet_binding_id: Sha256Id;
    readonly wallet_binding_proof_id: Sha256Id;
    readonly wallet_descriptor_id: Sha256Id;
    readonly signer_key_id: Sha256Id;
    readonly producer_identity_ref: Sha256Id;
    readonly key_control_proof_scope_chain_id: "cosmos:zerone-testnet-1";
    readonly key_control_verified_in_process: true;
    readonly identity_root_currentness_proven: false;
    readonly wallet_binding_head_currentness_proven: false;
    readonly custody_proven: false;
    readonly transaction_authority_proven: false;
  };
  readonly sponsor_authority: {
    readonly sponsor_account: CreationPrivateAccountId;
    readonly sponsor_address: string;
    readonly wallet_controller_ref: Sha256Id;
    readonly bounty_escrow_authorization_ref: Sha256Id;
    readonly role_separation: "DISTINCT_ACCOUNT_AND_WALLET_CONTROLLER_REQUIRED";
    readonly key_control_proof_id: null;
    readonly key_control_verified_in_process: false;
    readonly custody_proven: false;
    readonly transaction_authority_proven: false;
  };
  readonly funding_evidence: {
    readonly denom: "uzrn";
    readonly bounty_prefunding_uzrn: string;
    readonly bounty_escrow_reservation_ref: Sha256Id;
    readonly review_stake_uzrn: string;
    readonly review_stake_payer_address: string;
    readonly review_stake_funding_ref: Sha256Id;
    readonly transaction_fee_payer_address: string;
    readonly transaction_fee_reservation_ref: Sha256Id;
    readonly observation_status: "caller_declared_reserved_not_verified";
    readonly balances_observed: false;
    readonly reservations_current: false;
    readonly minting_allowed: false;
  };
  readonly knowledge_context: {
    readonly tree_id: string;
    readonly base_root: Sha256Id;
    readonly parent_fact_ids: readonly string[];
    readonly transition_kind: "add_fact";
    readonly relation_support: "requires_only";
    readonly domain: string;
    readonly category: ZeroneClaimCategory;
    readonly method_id: "M-FORMAL" | "M-COMPUTATIONAL";
    readonly methodology_registry_evidence_ref: Sha256Id;
    readonly chain_domain_observed: false;
    readonly method_registry_currentness_proven: false;
    readonly tree_base_root_currentness_proven: false;
    readonly parent_facts_exist_proven: false;
    readonly parent_facts_citable_proven: false;
  };
  readonly receipt_binding: {
    readonly chain_work_spec_hash: Sha256Id;
    readonly mapping: "SOURCE_CREATION_WORK_SPEC_ID_PRESERVED_EXACTLY";
    readonly acceptance_hash: Sha256Id;
    readonly input_root: Sha256Id;
    readonly environment_root: Sha256Id;
    readonly artifact_root: Sha256Id;
    readonly evidence_root: Sha256Id;
    readonly payee_address: string;
    readonly source_work_receipt_input_root: Sha256Id;
    readonly chain_work_receipt_hash: string;
  };
  readonly messages: {
    readonly lifecycle: "SEQUENTIAL_ONE_MESSAGE_PLANS_ONLY";
    readonly create_bounty: CreationEconomyMessageProjection<CreateBountyOrderValue>;
    readonly submit_claim: CreationEconomyMessageProjection<CreationSubmitClaimValue>;
    readonly fulfill_bounty: null;
    readonly fulfillment_status: "BLOCKED_PENDING_AUTHENTICATED_CHAIN_MATURITY";
  };
  readonly boundary: typeof CREATION_ECONOMY_BOUNDARY;
  readonly effects: typeof CREATION_ECONOMY_EFFECTS;
}

export interface CreationEconomyHandoff extends CreationEconomyHandoffCore {
  readonly handoff_id: Sha256Id;
}

export interface CreateCreationEconomyHandoffInput {
  readonly contract: CreationContract;
  readonly work_spec: CreationWorkSpec;
  readonly creation_witness: CreationWitness;
  readonly verification_witnesses: readonly VerificationWitness[];
  readonly lifecycle: CreationLifecycle;
  readonly creation_artifact: CreationArtifact;
  readonly creation_claim_projection: CreationClaimProjection;
  readonly worker_binding_proof: VerifiedWalletIdentityBindingProof;
}

export type CreationEconomyBoundary = typeof CREATION_ECONOMY_BOUNDARY;
export type CreationEconomyEffects = typeof CREATION_ECONOMY_EFFECTS;
