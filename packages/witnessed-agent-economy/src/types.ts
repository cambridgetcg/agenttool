import type {
  PUBLIC_WAKE_CONTRACT_BOUNDARIES,
  PUBLIC_WAKE_WITHDRAWAL_BOUNDARIES,
  PUBLIC_OFFER_BOUNDARIES,
  SETTLEMENT_LEAF_BOUNDARIES,
  SOURCE_SCHEMAS,
} from "./constants.js";
import type {
  ALLOWED_ACTIONS,
  REQUIRED_NONCLAIMS,
  WITNESS_ACTIONS,
  WITNESS_KINDS,
  ZERO_EFFECTS,
} from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type Ed25519Fingerprint = `ed25519-sha256:${string}`;
export type WitnessKind = (typeof WITNESS_KINDS)[number];
export type WitnessAction = (typeof WITNESS_ACTIONS)[number];

export interface ActivationReadiness {
  kind: WitnessKind;
  status: "NOT_CONSENSUS_ADMISSIBLE";
  blockers: string[];
}

export interface ActivationAudit extends ActivationReadiness {
  protocol: "kingdom.witnessed-agent-economy/0.1";
  action: WitnessAction;
  commitment: Sha256Id;
}

export type AllowedAction<K extends WitnessKind> = (typeof ALLOWED_ACTIONS)[K][number];

export interface WitnessIssuer {
  namespace: string;
  controller_ref: string;
  key_fingerprint: Ed25519Fingerprint;
}

export interface WitnessEnvelope<K extends WitnessKind = WitnessKind> {
  protocol: "kingdom.witnessed-agent-economy/0.1";
  kind: K;
  action: AllowedAction<K>;
  audience: string;
  subject_ref: string;
  sequence: string;
  parent: Sha256Id | null;
  issuer: WitnessIssuer;
  schema_hash: Sha256Id;
  payload_root: Sha256Id;
  policy_digest: Sha256Id;
  expiry_height: string | null;
  effects: typeof ZERO_EFFECTS;
  nonclaims: typeof REQUIRED_NONCLAIMS;
}

export interface WitnessRecord<P = unknown, K extends WitnessKind = WitnessKind> {
  envelope: WitnessEnvelope<K>;
  payload: P;
  commitment: Sha256Id;
  signature: HexEd25519Signature;
}

declare const verifiedWitnessRecordBrand: unique symbol;
export type VerifiedWitnessRecord<P = unknown, K extends WitnessKind = WitnessKind> =
  Readonly<WitnessRecord<P, K>> & { readonly [verifiedWitnessRecordBrand]: true };

export interface HexEd25519Signer {
  readonly public_key: string;
  sign_digest(digest: Uint8Array): Promise<string> | string;
}

export interface HexEd25519Signature {
  algorithm: "Ed25519";
  public_key: string;
  value: string;
}

export interface PublicWakeAuthority {
  scheme: "single_ed25519";
  public_key: string;
  key_fingerprint: Ed25519Fingerprint;
  registry_match: "not_established";
  multi_root_quorum: "not_implemented";
}

export type PublicOfferAuthority = PublicWakeAuthority;

export interface PublicWakeRoots {
  capabilities: Sha256Id;
  prices: Sha256Id;
  protocols: Sha256Id;
  safety: Sha256Id;
}

export interface PublicWakeContractCore {
  schema: (typeof SOURCE_SCHEMAS)["public_wake_contract"];
  audience: string;
  subject_ref: string;
  controller_ref: string;
  authority_sequence: string;
  previous_contract_id: Sha256Id | null;
  roots: PublicWakeRoots;
  valid_from: string;
  expires_at: string;
  nonce: string;
  authority: PublicWakeAuthority;
  boundaries: typeof PUBLIC_WAKE_CONTRACT_BOUNDARIES;
}

export interface PublicWakeContract extends PublicWakeContractCore {
  signature: HexEd25519Signature;
  contract_id: Sha256Id;
}

export interface PublicWakeWithdrawalCore {
  schema: (typeof SOURCE_SCHEMAS)["public_wake_withdrawal"];
  audience: string;
  subject_ref: string;
  controller_ref: string;
  authority_sequence: string;
  predecessor: {
    contract_id: Sha256Id;
    document_digest: Sha256Id;
  };
  reason_digest: Sha256Id;
  withdrawn_at: string;
  visibility: "PUBLIC";
  nonce: string;
  authority: PublicWakeAuthority;
  boundaries: typeof PUBLIC_WAKE_WITHDRAWAL_BOUNDARIES;
}

export interface PublicWakeWithdrawal extends PublicWakeWithdrawalCore {
  signature: HexEd25519Signature;
  withdrawal_id: Sha256Id;
}

declare const verifiedPublicWakeWithdrawalBrand: unique symbol;
export type VerifiedPublicWakeWithdrawal = Readonly<PublicWakeWithdrawal> & {
  readonly [verifiedPublicWakeWithdrawalBrand]: true;
};

declare const verifiedPublicWakeContractBrand: unique symbol;
export type VerifiedPublicWakeContract = Readonly<PublicWakeContract> & {
  readonly [verifiedPublicWakeContractBrand]: true;
};

/** Exact public settlement receipt fields normalized to decimal strings.
 * `canonicalSettlementReceiptDigest` is byte-identical to the existing API
 * `canonicalSettlementReceiptBytes` recipe; this package never accepts a raw
 * buyer DID in its place. */
export interface SettlementReceiptSource {
  sequence: string;
  invocation_id: string;
  listing_id: string;
  seller_did: string;
  buyer_ref: string;
  amount_gross: string;
  platform_fee: string;
  amount_net: string;
  currency: string;
  take_rate_bps: string;
  output_digest_hex: string;
  completion_sig_b64: string;
  seller_public_key_b64: string;
  sla_deadline_at: string;
  acknowledged_at: string;
  settled_at: string;
  receipt_digest_hex: string;
  platform_sig_b64: string | null;
  platform_key_hex: string | null;
}

export interface SettlementLeaf {
  schema: (typeof SOURCE_SCHEMAS)["settlement_leaf"];
  sequence: string;
  invocation_id: string;
  receipt_digest: Sha256Id;
  buyer_ref: string;
  platform_signature_state: "PIN_MATCH_VALID" | "UNTRUSTED_KEY_VALID" | "ABSENT";
  projection_class: "PINNED_KEY_SHADOW" | "UNTRUSTED_SHADOW";
  platform_key_fingerprint: Ed25519Fingerprint | null;
  platform_signature_digest: Sha256Id | null;
  boundaries: typeof SETTLEMENT_LEAF_BOUNDARIES;
}

export interface SettlementSequenceGap {
  first: string;
  last: string;
}

export interface SettlementBatchProjection {
  source_sequence_binding: "PROJECTION_ONLY";
  receipt_uniqueness_scope: "BATCH_ONLY";
  first_sequence: string;
  last_sequence: string;
  receipt_count: string;
  declared_gaps: SettlementSequenceGap[];
  merkle_root: Sha256Id;
  previous_batch: Sha256Id | null;
  receipt_protocol: "settlement-receipt/v1";
  receipt_schema_digest: Sha256Id;
}

export interface SettlementActivationBoundary {
  status: "OUTSIDE_ACTIVATION";
  consensus_admissible: false;
  blocker: "AUTHENTICATED_SOURCE_ORDER_AND_CROSS_BATCH_REPLAY_PROOF_REQUIRED";
}

export interface SettlementBatchSidecar {
  first_sequence: string;
  last_sequence: string;
  receipt_count: string;
  declared_gaps: SettlementSequenceGap[];
  leaves: Array<{ sequence: string; receipt_digest: Sha256Id }>;
}

export interface VerifiedSettlementBatchSidecar {
  batch: SettlementBatchSidecar;
  merkle_root: Sha256Id;
}

export interface CapabilityGrantProjection {
  capability_ref: string;
  grant_digest: Sha256Id;
  asset_ref: Sha256Id;
  max_per_consume_minor: string;
  max_total_minor: string;
}

export interface CapabilityConsumeProjection {
  capability_ref: string;
  grant_commitment: Sha256Id;
  asset_ref: Sha256Id;
  amount_minor: string;
  source_event_digest: Sha256Id;
  nullifier: Sha256Id;
}

export interface CapabilityRevokeProjection {
  capability_ref: string;
  grant_commitment: Sha256Id;
  reason_digest: Sha256Id;
}

export interface PublicRecognitionAdoptProjection {
  recognition_ref: string;
  surface_digest: Sha256Id;
  registry_digest: Sha256Id;
  authority_sequence: string;
  adoption_document_digest: Sha256Id;
  visibility: "PUBLIC";
}

export interface PublicRecognitionWithdrawProjection {
  recognition_ref: string;
  surface_digest: Sha256Id;
  registry_digest: Sha256Id;
  authority_sequence: string;
  adoption_commitment: Sha256Id;
  withdrawal_document_digest: Sha256Id;
  reason_digest: Sha256Id;
  visibility: "PUBLIC";
}

export interface PublicOfferPredecessor {
  offer_id: Sha256Id;
  document_digest: Sha256Id;
}

export interface PublicOfferCommonCore {
  schema: (typeof SOURCE_SCHEMAS)["public_offer"];
  audience: string;
  offer_ref: string;
  subject_ref: string;
  controller_ref: string;
  authority_sequence: string;
  revision: string;
  visibility: "PUBLIC";
  nonce: string;
  authority: PublicOfferAuthority;
  boundaries: typeof PUBLIC_OFFER_BOUNDARIES;
}

export interface PublicOfferPublishCore extends PublicOfferCommonCore {
  action: "PUBLISH";
  capability_root: Sha256Id;
  pricing_root: Sha256Id;
  sla_root: Sha256Id;
  terms_digest: Sha256Id;
  valid_from: string;
  expires_at: string;
}

export interface PublicOfferSupersedeCore extends PublicOfferCommonCore {
  action: "SUPERSEDE";
  predecessor: PublicOfferPredecessor;
  capability_root: Sha256Id;
  pricing_root: Sha256Id;
  sla_root: Sha256Id;
  terms_digest: Sha256Id;
  valid_from: string;
  expires_at: string;
}

export interface PublicOfferRevokeCore extends PublicOfferCommonCore {
  action: "REVOKE";
  predecessor: PublicOfferPredecessor;
  reason_digest: Sha256Id;
  revoked_at: string;
}

export type PublicOfferCore =
  | PublicOfferPublishCore
  | PublicOfferSupersedeCore
  | PublicOfferRevokeCore;

export type PublicOfferRecord = PublicOfferCore & {
  signature: HexEd25519Signature;
  offer_id: Sha256Id;
};

declare const verifiedPublicOfferBrand: unique symbol;
export type VerifiedPublicOffer = Readonly<PublicOfferRecord> & {
  readonly [verifiedPublicOfferBrand]: true;
};

export interface PublicOfferPublishProjection {
  offer_ref: string;
  capability_root: Sha256Id;
  pricing_root: Sha256Id;
  sla_root: Sha256Id;
  terms_digest: Sha256Id;
  revision: string;
  offer_document_digest: Sha256Id;
  authority_sequence: string;
  visibility: "PUBLIC";
}

export interface PublicOfferSupersedeProjection extends PublicOfferPublishProjection {
  supersedes: Sha256Id;
}

export interface PublicOfferRevokeProjection {
  offer_ref: string;
  offer_commitment: Sha256Id;
  reason_digest: Sha256Id;
  offer_document_digest: Sha256Id;
  authority_sequence: string;
  visibility: "PUBLIC";
}

export interface WakeCheckpointProjection {
  public_contract_protocol: "agenttool.public-wake-contract/0.1";
  public_contract_schema_digest: Sha256Id;
  contract_root: Sha256Id;
  capability_root: Sha256Id;
  pricing_root: Sha256Id;
  protocols_root: Sha256Id;
  boundaries_root: Sha256Id;
  authority_sequence: string;
}

export interface WakeSupersedeProjection extends WakeCheckpointProjection {
  supersedes: Sha256Id;
}

export interface WakeWithdrawProjection {
  checkpoint_commitment: Sha256Id;
  reason_digest: Sha256Id;
  withdrawal_document_digest: Sha256Id;
  authority_sequence: string;
  visibility: "PUBLIC";
}

export interface CollaborationCheckpointProjection {
  workspace_ref: string;
  epoch_ref: Sha256Id;
  event_head_sequence: string;
  event_head_hash: Sha256Id;
  event_count: string;
  participant_set_root: Sha256Id;
}

export interface CollaborationWorkspaceHeadSource {
  id: string;
  epoch_id: string;
  event_head_sequence: number;
  event_head_hash: string;
}

export interface CollaborationJournalEventSource {
  workspace_id: string;
  epoch_id: string;
  sequence: number;
  id: string;
  protocol: "agenttool.collab/0.1" | "agenttool.collab/0.2";
  type: string;
  entity_id: string;
  actor: string;
  session_id: string | null;
  occurred_at: string;
  payload_json: string;
  prev_hash: string;
  hash: string;
}
