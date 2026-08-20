export const PACKAGE_NAME = "@agenttool/witnessed-agent-economy" as const;
export const PACKAGE_VERSION = "0.1.0-dev.0" as const;
export const WITNESS_PROTOCOL = "kingdom.witnessed-agent-economy/0.1" as const;
export const OFFLINE_AUDIENCE = "kingdom:offline-shadow" as const;

export const WITNESS_KINDS = Object.freeze([
  "KINGDOM_RELEASE_ROOT",
  "AGENTTOOL_SETTLEMENT_ROOT",
  "AGENTTOOL_CAPABILITY",
  "AGENTTOOL_PUBLIC_RECOGNITION",
  "AGENTTOOL_OFFER",
  "WAKE_PUBLIC_CHECKPOINT",
  "ISSUER_KEY_CONTINUITY",
  "ARTIFACT_LINEAGE",
  "COLLABORATION_CHECKPOINT",
  "DISPUTE_TERMINAL",
] as const);

export const WITNESS_ACTIONS = Object.freeze([
  "CHECKPOINT",
  "GRANT",
  "CONSUME",
  "REVOKE",
  "ADOPT",
  "WITHDRAW",
  "SUPERSEDE",
  "SETTLE",
  "ROTATE",
  "PUBLISH",
] as const);

export const ALLOWED_ACTIONS = Object.freeze({
  KINGDOM_RELEASE_ROOT: Object.freeze(["CHECKPOINT"] as const),
  AGENTTOOL_SETTLEMENT_ROOT: Object.freeze(["CHECKPOINT"] as const),
  AGENTTOOL_CAPABILITY: Object.freeze(["GRANT", "CONSUME", "REVOKE"] as const),
  AGENTTOOL_PUBLIC_RECOGNITION: Object.freeze(["ADOPT", "WITHDRAW"] as const),
  AGENTTOOL_OFFER: Object.freeze(["PUBLISH", "SUPERSEDE", "REVOKE"] as const),
  WAKE_PUBLIC_CHECKPOINT: Object.freeze(["CHECKPOINT", "SUPERSEDE", "WITHDRAW"] as const),
  ISSUER_KEY_CONTINUITY: Object.freeze(["ROTATE", "REVOKE"] as const),
  ARTIFACT_LINEAGE: Object.freeze(["CHECKPOINT"] as const),
  COLLABORATION_CHECKPOINT: Object.freeze(["CHECKPOINT"] as const),
  DISPUTE_TERMINAL: Object.freeze(["SETTLE"] as const),
} as const);

export const REQUIRED_NONCLAIMS = Object.freeze([
  "COMPETENCE",
  "CONSCIOUSNESS",
  "CONSENT",
  "IDENTITY",
  "PERSONHOOD",
  "QUALITY",
  "REPUTATION",
  "TRUTH",
] as const);

export const ZERO_EFFECTS = Object.freeze({
  scope: "RECORD_CONSTRUCTION_AND_OFFLINE_VALIDATION_ONLY",
  authority: "NONE",
  economic: "NONE",
  reputation: "NONE",
  network_requests: 0,
  storage_writes: 0,
  zerone_transaction: false,
  external_receipt: false,
  nen_invocation: false,
  score: false,
} as const);

export const SOURCE_SCHEMAS = Object.freeze({
  public_wake_contract: "agenttool.public-wake-contract/0.1",
  public_wake_withdrawal: "agenttool.public-wake-withdrawal/0.1",
  public_offer: "agenttool.public-offer/0.1",
  settlement_leaf: "agenttool.witness-settlement-leaf/0.1",
} as const);

export const HASH_DOMAINS = Object.freeze({
  public_wake_contract: "agenttool/public-wake-contract/v1",
  public_wake_contract_id: "agenttool/public-wake-contract-record/v1",
  public_wake_withdrawal: "agenttool/public-wake-withdrawal/v1",
  public_wake_withdrawal_id: "agenttool/public-wake-withdrawal-record/v1",
  public_offer: "agenttool/public-offer/v1",
  public_offer_id: "agenttool/public-offer-record/v1",
  subject_ref: "subject-ref/v1",
  controller_ref: "controller-ref/v1",
  capability_ref: "capability-ref/v1",
  asset_ref: "asset-ref/v1",
  source_event: "source-event/v1",
  recognition_withdrawal_reason: "public-recognition-withdrawal-reason/v1",
  settlement_receipt_schema: "settlement-receipt-schema/v1",
  offer_ref: "offer-ref/v1",
  collaboration_workspace_ref: "collaboration-workspace-ref/v1",
  collaboration_epoch_ref: "collaboration-epoch-ref/v1",
} as const);

export const COLLABORATION_PARTICIPANT_HMAC_PROTOCOL =
  "agenttool.collaboration-participant-ref/0.1" as const;

/** The source records below intentionally use AgentTool's established local
 * canonical JSON profile. Shared WITNESS records use the separate frozen
 * WITNESS canonical profile exported by witness-canonical.ts. */
export const AGENTTOOL_SOURCE_HASH_PROTOCOL = "agenttool.witness-source/0.1" as const;

export const MAX_UINT64 = 18_446_744_073_709_551_615n;

export const LIMITS = Object.freeze({
  max_string_bytes: 4_096,
  max_array_items: 4_096,
  max_settlement_batch_receipts: 4_096,
  nonce_bytes: 32,
} as const);

export const WITNESS_CANONICAL_LIMITS = Object.freeze({
  max_document_bytes: 1 << 20,
  max_depth: 32,
  max_object_members: 256,
  max_array_elements: 4_096,
  max_string_bytes: 64 << 10,
} as const);

export const PUBLIC_WAKE_CONTRACT_BOUNDARIES = Object.freeze({
  source: "explicit_root_signed_public_contract",
  current_v1_wake_used: false,
  private_wake_included: false,
  capabilities_disclosed: "roots_only",
  prices_disclosed: "roots_only",
  protocols_disclosed: "roots_only",
  safety_disclosed: "roots_only",
  key_control: "signature_only",
  identity: "not_established",
  personhood: "not_established",
  consciousness: "not_established",
  consent: "not_established",
  competence: "not_established",
  truth: "not_established",
  quality: "not_scored",
  reputation: "not_scored",
  authority_effect: "NONE",
  economic_effect: "NONE",
  wake_effect: false,
  memory_effect: false,
  score_effect: false,
  automatic_action: false,
} as const);

export const PUBLIC_WAKE_WITHDRAWAL_BOUNDARIES = Object.freeze({
  source: "explicit_root_signed_public_contract_withdrawal",
  current_v1_wake_used: false,
  private_wake_included: false,
  exact_predecessor_required: true,
  key_control: "signature_only",
  registry_match: "not_established",
  hosted_withdrawal: "not_established",
  external_erasure: "not_established",
  identity: "not_established",
  personhood: "not_established",
  consciousness: "not_established",
  consent: "not_established",
  authority_effect: "NONE",
  economic_effect: "NONE",
  wake_effect: false,
  memory_effect: false,
  score_effect: false,
  automatic_action: false,
} as const);

export const SETTLEMENT_LEAF_BOUNDARIES = Object.freeze({
  source: "agenttool_settlement_receipt_v1",
  buyer_identity: "hmac_reference_or_unavailable",
  raw_buyer_identity_included: false,
  output_bytes_included: false,
  seller_completion_verified: false,
  encryption_proven: false,
  buyer_satisfaction_proven: false,
  settlement_finality_proven: false,
  platform_key_authority: "not_established_by_receipt",
  consensus_projection_requires_pinned_key: true,
  pinned_key_controller_policy_verified_by_package: false,
  competence: "not_established",
  truth: "not_established",
  quality: "not_scored",
  reputation: "not_scored",
  score_effect: false,
} as const);

export const PUBLIC_OFFER_BOUNDARIES = Object.freeze({
  source: "explicit_key_control_offer",
  visibility: "PUBLIC",
  key_control: "signature_only",
  live_seller_registry_match: "not_established",
  hosted_acceptance: "not_established",
  multi_root_quorum: "not_implemented",
  identity: "not_established",
  personhood: "not_established",
  consciousness: "not_established",
  consent: "not_established",
  competence: "not_established",
  truth: "not_established",
  quality: "not_scored",
  reputation: "not_scored",
  authority_effect: "NONE",
  economic_effect: "NONE",
  listing_write_effect: false,
  wake_effect: false,
  score_effect: false,
  automatic_action: false,
} as const);
