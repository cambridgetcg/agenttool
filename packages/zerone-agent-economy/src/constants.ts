export const PACKAGE_NAME = "@agenttool/zerone-agent-economy" as const;
export const PACKAGE_VERSION = "0.1.0-dev.0" as const;

export const FORMATS = Object.freeze({
  wallet_binding: "agenttool.zerone-wallet-binding/0.1",
  work_spec: "agenttool.zerone-work-spec/0.1",
  artifact: "agenttool.zerone-computational-artifact/0.1",
  evidence: "agenttool.zerone-evidence-receipt/0.1",
  settlement: "agenttool.zerone-settlement-intent/0.1",
  treasury: "agenttool.zerone-treasury-policy/0.1",
  unsigned_message: "agenttool.zerone-unsigned-message-projection/0.1",
} as const);

export const HASH_DOMAINS = Object.freeze({
  wallet_binding: "agenttool.zerone-wallet-binding/v1",
  source_work: "agenttool.zerone-source-work/v1",
  work_spec: "agenttool.zerone-work-spec/v1",
  artifact: "agenttool.zerone-computational-artifact/v1",
  evidence: "agenttool.zerone-evidence-receipt/v1",
  settlement: "agenttool.zerone-settlement-intent/v1",
  treasury: "agenttool.zerone-treasury-policy/v1",
  message_projection: "agenttool.zerone-message-projection/v1",
} as const);

export const CHAIN_WORK_RECEIPT_DOMAIN = "ZRN.work.receipt.v1\0" as const;
export const CHAIN_SETTLEMENT_NULLIFIER_DOMAIN =
  "ZRN.sponsorship.settlement.v2\0" as const;

export const ZERONE_NATIVE_DENOM = "uzrn" as const;

export const MESSAGE_TYPE_URLS = Object.freeze({
  create_bounty: "/zerone.sponsorship.v1.MsgCreateBountyOrder",
  submit_claim: "/zerone.knowledge.v1.MsgSubmitClaim",
  fulfill_bounty: "/zerone.sponsorship.v1.MsgFulfillBounty",
} as const);

export const WALLET_METHODS = Object.freeze({
  create_bounty: "zerone.sponsorship.v1.MsgCreateBountyOrder",
  submit_claim: "zerone.knowledge.v1.MsgSubmitClaim",
  fulfill_bounty: "zerone.sponsorship.v1.MsgFulfillBounty",
} as const);

export const CLAIM_TYPE_COMPUTATIONAL = 7 as const;
export const RELATION_TYPE_REQUIRES = 3 as const;
export const INFERENCE_TYPE_UNSPECIFIED = 0 as const;

export const SEMANTIC_BOUNDARY = Object.freeze({
  zrn_role: "settlement_and_compute_asset_only",
  creates_identity: false,
  determines_truth: false,
  creates_karma: false,
  grants_governance: false,
} as const);

export const LIMITS = Object.freeze({
  max_text_bytes: 2_048,
  max_fact_content_bytes: 16_384,
  max_array_items: 64,
  max_claim_relations: 16,
  max_target_count: 10_000,
  max_min_corroborations: 1_000,
  max_uint64: (1n << 64n) - 1n,
  max_uint32: (1n << 32n) - 1n,
  max_policy_window_blocks: 10_000_000n,
} as const);

export const WALLET_ZERONE_SUPPORT = Object.freeze({
  agent_wallet_core: "record_shape_requires_host_authorization",
  wallet_zerone_version: "0.1.2",
  wallet_zerone_message_support: "unsupported",
  payload_encoding: "canonical_protobuf_value_available",
  protobuf_encoder_required: false,
  signer_required: true,
  simulation_required: true,
  durable_reservation_required: true,
  sticky_unknown_accounting_required: true,
  broadcast_required: true,
  effects_performed: false,
} as const);
