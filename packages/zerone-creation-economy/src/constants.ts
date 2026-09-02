export const PACKAGE_NAME = "@agenttool/zerone-creation-economy" as const;
export const PACKAGE_VERSION = "0.1.0-dev.0" as const;

export const CREATION_ECONOMY_FORMATS = Object.freeze({
  message_projection: "agenttool.zerone-creation-economy-message-projection/0.1",
  handoff: "agenttool.zerone-creation-economy-handoff/0.1",
} as const);

export const CREATION_ECONOMY_HASH_DOMAINS = Object.freeze({
  handoff: "agenttool.zerone-creation-economy-handoff/v1",
} as const);

export const CREATION_ECONOMY_SOURCE_PINS = Object.freeze({
  zerone_core_commit: "a5b82e82b2a32be2b75bd11575964b0a69aa34ac",
  agenttool_economy_candidate_commit: "63627d24cf9076a6904892112a225714d0759aea",
  agenttool_creation_candidate_commit: "62b43dd52d1180681e5ebed15f39a5b35b733526",
  cosmos_sdk: "v0.53.8",
  knowledge_consensus_version: 7,
  sponsorship_consensus_version: 2,
  chain_reference_prefix: "zerone-creation-private-",
  reserved_chain_references: Object.freeze(["zerone-1", "zerone-testnet-1"] as const),
} as const);

export const CREATION_ECONOMY_COMPATIBILITY = Object.freeze({
  source_creation_projection: "NOT_CONSENSUS_ADMISSIBLE",
  source_creation_work_spec_hash: "preserved_exactly",
  legacy_agent_economy_projection: "not_coerced",
  wallet_zerone_version: "0.1.2",
  wallet_zerone_message_support: "unsupported",
  wallet_zerone_economy_support: "blocked_pending_private_chain_profile",
  protobuf_value_bytes: "exact_candidate_shape",
  candidate_upgrade_path: "blocked_unproven_exclusive_v6_to_v7_and_v1_to_v2_handler",
  candidate_verifier_selection: "blocked_ordinary_account_sybil_quorum",
  shared_agenttool_zerone_vector: "exact_value_and_any_bytes_pinned_at_a5b82e82",
  authenticated_stored_state_roundtrip: "blocked_pending_private_chain_evidence",
  private_testnet_scope: "mechanics_only_not_economic_security",
  sequential_one_message_plans_required: true,
  signer_required: true,
  authenticated_activation_required: true,
  durable_reservation_required: true,
  simulation_required: true,
  broadcast_required: true,
  effects_performed: false,
} as const);

export const CREATION_ECONOMY_BOUNDARY = Object.freeze({
  source_only: true,
  private_disposable_testnet_profile_required: true,
  chain_reference_uniqueness_proven: false,
  chain_privacy_proven: false,
  chain_disposability_proven: false,
  source_bundle_recomputed: true,
  key_control_proof_required: true,
  identity_root_currentness_proven: false,
  wallet_binding_head_currentness_proven: false,
  custody_proven: false,
  chain_activation_currentness_proven: false,
  chain_parameter_admissibility_proven: false,
  chain_domain_observed: false,
  method_registry_currentness_proven: false,
  tree_base_root_currentness_proven: false,
  parent_facts_exist_proven: false,
  parent_facts_citable_proven: false,
  target_tree_transition_enforced_on_chain: false,
  base_root_compare_and_swap_available: false,
  review_stake_admissibility_proven: false,
  funding_reservations_current: false,
  named_upgrade_boundary_proven: false,
  verifier_selection_integrity_proven: false,
  agent_controlled_sybil_resistance_proven: false,
  authenticated_chain_roundtrip_proven: false,
  economic_security_proven: false,
  mainnet_admissible: false,
  transaction_authority_proven: false,
  wallet_planner_admissible: false,
  verification_set_complete: false,
  chain_maturity_observed: false,
  settlement_authorized: false,
  earnings_observed: false,
  treasury_availability_proven: false,
} as const);

export const CREATION_ECONOMY_EFFECTS = Object.freeze({
  reads_network: false,
  holds_key: false,
  signs: false,
  simulates: false,
  reserves_funds: false,
  broadcasts: false,
  writes_chain: false,
  moves_funds: false,
  settles: false,
  publishes: false,
  deploys: false,
} as const);
