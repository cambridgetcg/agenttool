import type { RECORD_SCHEMAS, WALLET_ACTIONS } from "./constants.js";

export type Sha256Id = `sha256:${string}`;
export type WalletAction = (typeof WALLET_ACTIONS)[number];

export interface Ed25519PublicKey {
  algorithm: "Ed25519";
  key_id: Sha256Id;
  public_key: string;
}

export interface RecordSignature {
  algorithm: "Ed25519";
  value: string;
}

export interface SignedRecordFields {
  record_id: Sha256Id;
  signature: RecordSignature;
}

export interface WalletAccount {
  account_id: string;
  account_kind: "eoa" | "smart_account" | "program_account" | "unknown";
}

export interface WalletDescriptorCore {
  schema: (typeof RECORD_SCHEMAS)["descriptor"];
  wallet_id: string;
  owner_identity_id: string;
  authority: Ed25519PublicKey;
  custody_mode:
    | "self_custodied"
    | "delegated_signer"
    | "platform_custodied"
    | "watch_only";
  accounts: WalletAccount[];
  recovery_mode: "none" | "owner_rotation" | "guardian" | "provider";
  created_at: string;
}

export type WalletDescriptor = WalletDescriptorCore & SignedRecordFields;

export interface CallRule {
  target_account: string;
  actions: WalletAction[];
  methods: string[];
  requires_approval: boolean;
}

export interface AssetAmount {
  asset_id: string;
  amount_atomic: string;
}

export interface SpendLimit {
  asset_id: string;
  max_per_intent: string;
  max_total: string;
}

export interface FeeLimit {
  asset_id: string;
  max_per_intent: string;
}

export interface WalletCapabilityCore {
  schema: (typeof RECORD_SCHEMAS)["capability"];
  grant_id: string;
  wallet_id: string;
  descriptor_id: Sha256Id;
  issuer: Ed25519PublicKey;
  delegate: Ed25519PublicKey;
  accounts: string[];
  call_rules: CallRule[];
  spend_limits: SpendLimit[];
  fee_limits: FeeLimit[];
  max_intents: number;
  approval_threshold: number;
  issued_at: string;
  not_before: string;
  expires_at: string;
  revocation_nonce: number;
  policy_hash: Sha256Id;
  purpose: string;
}

export type WalletCapability = WalletCapabilityCore & SignedRecordFields;

export interface IntentCall {
  action: WalletAction;
  target_account: string;
  method: string | null;
  payload_b64u: string;
  payload_hash: Sha256Id;
  native_value: AssetAmount | null;
}

export interface TransactionIntentCore {
  schema: (typeof RECORD_SCHEMAS)["intent"];
  intent_id: string;
  wallet_id: string;
  descriptor_id: Sha256Id;
  grant_id: string;
  capability_record_id: Sha256Id;
  delegate: Ed25519PublicKey;
  chain_id: string;
  source_account: string;
  calls: IntentCall[];
  declared_spends: AssetAmount[];
  max_fee: AssetAmount;
  issued_at: string;
  expires_at: string;
  nonce: string;
}

export type TransactionIntent = TransactionIntentCore & SignedRecordFields;

export interface SimulationEffect {
  action: WalletAction;
  target_account: string;
  method: string | null;
  asset_id: string | null;
  amount_atomic: string;
}

export interface SimulationReceiptCore {
  schema: (typeof RECORD_SCHEMAS)["simulation"];
  simulation_id: string;
  intent_id: string;
  intent_record_id: Sha256Id;
  chain_id: string;
  source_account: string;
  adapter: Ed25519PublicKey;
  block_ref: string;
  block_hash: string | null;
  success: boolean;
  effects: SimulationEffect[];
  estimated_fee: AssetAmount;
  simulated_at: string;
  valid_until: string;
}

export type SimulationReceipt = SimulationReceiptCore & SignedRecordFields;

export interface SigningReceiptCore {
  schema: (typeof RECORD_SCHEMAS)["signing_receipt"];
  receipt_id: string;
  request_id: string;
  wallet_id: string;
  descriptor_id: Sha256Id;
  grant_id: string;
  capability_record_id: Sha256Id;
  intent_id: string;
  intent_record_id: Sha256Id;
  simulation_record_id: Sha256Id;
  source_account: string;
  signer_key_id: Sha256Id;
  receipt_authority: Ed25519PublicKey;
  unsigned_payload_hash: Sha256Id;
  signed_payload_hash: Sha256Id;
  policy_hash: Sha256Id;
  operation_id: string | null;
  signed_at: string;
}

export type SigningReceipt = SigningReceiptCore & SignedRecordFields;

export type ContinuityEventKind =
  | "authority_rotated"
  | "signer_rotated"
  | "capability_revoked"
  | "recovery_changed"
  | "account_migrated";

export interface ContinuityEventCore {
  schema: (typeof RECORD_SCHEMAS)["continuity"];
  event_id: string;
  wallet_id: string;
  sequence: number;
  previous_record_id: Sha256Id | null;
  event_kind: ContinuityEventKind;
  previous_value: string | null;
  next_value: string | null;
  revocation_nonce: number;
  actor: Ed25519PublicKey;
  reason: string;
  effective_at: string;
}

export type ContinuityEvent = ContinuityEventCore & SignedRecordFields;

export interface CapabilityUsage {
  revocation_nonce: number;
  intent_count: number;
  spent: AssetAmount[];
  host_verified_approval_ids: string[];
}

export interface AuthorizationContext {
  now: string;
  usage: CapabilityUsage;
}

export interface AuthorizedIntentFields {
  wallet_id: string;
  grant_id: string;
  capability_record_id: Sha256Id;
  intent_record_id: Sha256Id;
  simulation_record_id: Sha256Id;
  policy_hash: Sha256Id;
  checked_at: string;
}

declare const authorizedIntentBrand: unique symbol;
export type AuthorizedIntent = Readonly<AuthorizedIntentFields> & {
  readonly [authorizedIntentBrand]: true;
};

declare const verifiedRecordBrand: unique symbol;
export type Verified<T> = Readonly<T> & { readonly [verifiedRecordBrand]: true };

export interface RecordSigner {
  readonly public_key: string;
  sign_digest(digest: Uint8Array): Promise<string> | string;
}

export interface SignerDescription {
  signer_key_id: Sha256Id;
  algorithm: string;
  provider: string;
  exportable: false;
}

export interface SigningRequest {
  request_id: string;
  authorization: AuthorizedIntent;
  signer_key_id: Sha256Id;
  unsigned_payload_b64u: string;
  unsigned_payload_hash: Sha256Id;
}

export interface SignedPayload {
  request_id: string;
  signer_key_id: Sha256Id;
  unsigned_payload_hash: Sha256Id;
  signed_payload_b64u: string;
  signed_payload_hash: Sha256Id;
  operation_id: string | null;
}

export interface WalletSigner {
  describe(): Promise<SignerDescription>;
  sign_exact(request: SigningRequest): Promise<SignedPayload>;
}

export type BroadcastResult =
  | { status: "accepted"; operation_id: string }
  | { status: "rejected"; code: string }
  | { status: "ambiguous"; operation_id: string | null };

export type BroadcastLookup =
  | { status: "found"; operation_id: string; confirmed: boolean }
  | { status: "absent" }
  | { status: "unavailable"; code: string };

export type SigningLookup =
  | { status: "found"; payload: SignedPayload }
  | { status: "absent" }
  | { status: "unavailable"; code: string };

export interface WalletBroadcaster {
  broadcast_once(payload: SignedPayload): Promise<BroadcastResult>;
  get_status(operationId: string): Promise<BroadcastLookup>;
}

export type OperationStatus =
  | "reserved"
  | "signing"
  | "signing_unknown"
  | "signed"
  | "submitting"
  | "submission_unknown"
  | "submitted"
  | "confirmed"
  | "rejected_pre_submit"
  | "reorged";

export interface OperationState {
  status: OperationStatus;
  updated_at: string;
  operation_id: string | null;
}
