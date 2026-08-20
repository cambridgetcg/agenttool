export const PACKAGE_NAME = "@agenttool/zerone-agent-host" as const;
export const PACKAGE_VERSION = "0.1.0-dev.0" as const;
export const HOST_PROTOCOL = "agenttool.zerone-agent-host/0.1" as const;
export const SQLITE_SCHEMA_VERSION = 2 as const;

export const EXECUTION_SUPPORT = Object.freeze({
  mode: "durable_ledger_only",
  economy_message_planning: "blocked_pending_reviewed_native_planner",
  wallet_record_verification: "trusted_injected_projection_only",
  identity_binding_proof_verification: "portable_dual_key_envelope_reverified",
  binding_currentness_authentication: "trusted_injected_resolver_only",
  signer_invocation: "external_not_implemented",
  broadcast_invocation: "external_not_implemented",
  rpc_endpoints: "none",
  key_custody: "none",
  automatic_retry: false,
  effects_performed: false,
} as const);

export const EVENT_HASH_DOMAIN = "agenttool.zerone-agent-host-event/v1" as const;
export const BINDING_CURRENTNESS_HASH_DOMAIN =
  "agenttool.zerone-agent-host-binding-currentness/v1" as const;
export const GENESIS_EVENT_HASH = `sha256:${"0".repeat(64)}` as const;

export const OPERATION_STATUSES = [
  "reserved",
  "signing",
  "signing_unknown",
  "signed",
  "submitting",
  "submission_unknown",
  "submitted",
  "rejected_pre_submit_sticky",
  "confirmed_success",
  "confirmed_failed",
  "reorged",
  "sequence_superseded",
  "released_pre_sign",
] as const;

export const RESERVATION_STATES = [
  "reserved",
  "sticky",
  "settled",
  "released",
] as const;

export const TREASURY_PURPOSES = [
  "compute",
  "knowledge_bond",
  "network_fee",
  "sponsorship_escrow",
  "storage",
] as const;

export const AUTHORIZATION_PROJECTION_BOUNDARY =
  "trusted_injected_wallet_authorization_projection/0.1" as const;
