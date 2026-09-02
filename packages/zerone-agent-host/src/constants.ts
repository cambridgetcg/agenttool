export const PACKAGE_NAME = "@agenttool/zerone-agent-host" as const;
export const PACKAGE_VERSION = "0.1.0-dev.0" as const;
export const HOST_PROTOCOL = "agenttool.zerone-agent-host/0.1" as const;
export const SQLITE_SCHEMA_VERSION = 4 as const;

export const EXECUTION_SUPPORT = Object.freeze({
  mode: "durable_one_message_economy_signing_boundary",
  economy_message_planning: "private_exact_native_planner_composed",
  wallet_record_verification: "verified_records_rechecked_atomically",
  reopen_wallet_record_verification: "record_ids_and_event_commitments_only",
  reopen_economy_plan_verification: "plan_ids_and_operation_commitment_only",
  portable_signed_transaction_verification:
    "cryptographic_reload_and_exact_operation_commitment_match",
  signed_transaction_storage: "append_only_full_portable_record",
  identity_binding_proof_verification: "portable_dual_key_envelope_reverified",
  binding_currentness_authentication: "immutable_constructor_resolver_and_configured_trust_epoch_only",
  activation_currentness_authentication: "immutable_constructor_resolver_and_verifier_allowlist_only",
  account_observation_authentication: "immutable_constructor_observer_only",
  typed_sequence_advance_authentication: "immutable_constructor_account_observer_only",
  simulation_adapter_authentication: "explicit_host_configuration_allowlist_only",
  signer_invocation: "external_not_implemented",
  broadcast_invocation: "external_not_implemented",
  rpc_endpoints: "none",
  key_custody: "none",
  automatic_retry: false,
  network_effects_performed: false,
  local_durable_effects: "reservation_and_possible_signer_boundary_committed",
  effects_performed: false,
} as const);

export const EVENT_HASH_DOMAIN = "agenttool.zerone-agent-host-event/v1" as const;
export const BINDING_CURRENTNESS_HASH_DOMAIN =
  "agenttool.zerone-agent-host-binding-currentness/v2" as const;
export const BINDING_CURRENTNESS_VERIFIER_TRUST_HASH_DOMAIN =
  "agenttool.zerone-agent-host-binding-currentness-verifier-trust/v1" as const;
export const ACTIVATION_CURRENTNESS_HASH_DOMAIN =
  "agenttool.zerone-agent-host-activation-currentness/v1" as const;
export const SIMULATION_ADAPTER_TRUST_HASH_DOMAIN =
  "agenttool.zerone-agent-host-simulation-adapter-trust/v1" as const;
export const ECONOMY_COMMITMENT_HASH_DOMAIN =
  "agenttool.zerone-agent-host-economy-commitment/v1" as const;
export const ECONOMY_SEQUENCE_ADVANCE_EVIDENCE_HASH_DOMAIN =
  "agenttool.zerone-agent-host-economy-sequence-advance-evidence/v1" as const;
export const ECONOMY_SEQUENCE_ADVANCE_EVIDENCE_BOUNDARY =
  "immutable_constructor_account_observer/0.1" as const;
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

export const OPERATION_KINDS = [
  "generic_injected",
  "zerone_economy",
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
export const ECONOMY_AUTHORIZATION_BOUNDARY =
  "verified_wallet_records_and_durable_usage_at_sign_time/0.1" as const;
