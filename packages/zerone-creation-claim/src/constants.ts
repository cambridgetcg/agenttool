export const PACKAGE_NAME = "@agenttool/zerone-creation-claim" as const;
export const PACKAGE_VERSION = "0.1.0-dev.0" as const;

export const FORMATS = Object.freeze({
  contract: "agenttool.zerone-creation-contract/0.1",
  work_spec: "agenttool.zerone-creation-work-spec/0.1",
  creation_witness: "agenttool.zerone-creation-witness/0.1",
  verification_witness: "agenttool.zerone-verification-witness/0.1",
  lifecycle: "agenttool.zerone-creation-lifecycle/0.1",
  fact_envelope: "agenttool.zerone-creation-fact-envelope/0.1",
  computational_artifact: "agenttool.zerone-creation-artifact/0.1",
  claim_projection: "agenttool.zerone-creation-claim-projection/0.1",
  vectors: "agenttool.zerone-creation-claim-vectors/0.1",
} as const);

export const HASH_DOMAINS = Object.freeze({
  contract: "agenttool.zerone-creation-contract/v1",
  input_root: "agenttool.zerone-creation-input-root/v1",
  acceptance: "agenttool.zerone-creation-acceptance/v1",
  work_spec: "agenttool.zerone-creation-work-spec/v1",
  creation_witness: "agenttool.zerone-creation-witness/v1",
  verification_witness: "agenttool.zerone-verification-witness/v1",
  verification_set: "agenttool.zerone-creation-verification-set/v1",
  lifecycle: "agenttool.zerone-creation-lifecycle/v1",
  fact_envelope: "agenttool.zerone-creation-fact-envelope/v1",
  work_receipt_input: "agenttool.zerone-creation-work-receipt-input/v1",
  computational_artifact: "agenttool.zerone-creation-artifact/v1",
  claim_projection: "agenttool.zerone-creation-claim-projection/v1",
} as const);

export const SOURCE_PLANE = Object.freeze({
  observation_date_utc: "2026-09-02",
  agenttool_repository_url: "https://github.com/cambridgetcg/agenttool.git",
  agenttool_review_ref: "github/main",
  agenttool_review_base_revision: "4bea19bad74dbb3482db4f99b5a532f59c61092a",
  agenttool_review_base_status: "MERGED_OBSERVED_SOURCE",
  zerone_repository_url: "https://github.com/cambridgetcg/zerone-core.git",
  zerone_observed_ref: "github/main",
  zerone_observed_main_revision: "5472d694bcdd3d7cd130cb002bd12b66565a9791",
  zerone_observed_main_status: "MERGED_OBSERVED_SOURCE",
  zerone_economy_candidate_revision: "a5b82e82b2a32be2b75bd11575964b0a69aa34ac",
  zerone_economy_candidate_status: "UNMERGED_DESIGN_EVIDENCE_ONLY",
  agenttool_economy_candidate_revision: "63627d24cf9076a6904892112a225714d0759aea",
  agenttool_economy_candidate_status: "UNMERGED_DESIGN_EVIDENCE_ONLY",
  hf_finemath_repository_url: "https://huggingface.co/datasets/HuggingFaceTB/finemath",
  hf_finemath_observation_revision: "e92b25a616738fe95dc186b64dfb19f9c8525594",
  hf_finemath_contamination_revision: "3dc3725bac1125fb17a12b742102b91a45198f0e",
  hf_finemath_observation_status: "METADATA_ONLY_NOT_MATERIAL_ADMISSION",
  math_cards_doc_repository_path: "docs/MATH-CARDS.md",
  math_cards_doc_sha256: "sha256:544bdf81b34ac81a11e7c56f42d2d0fd630ca43d5d25f904d29cf97e3fc23fcc",
  hf_training_garden_doc_repository_path: "docs/HF-TRAINING-GARDEN.md",
  hf_training_garden_doc_sha256: "sha256:abc8e58fef208783228bac2a25d471486b113cbe228ac278b12846f3aa986c8a",
  math_of_creation_doc_repository_path: "docs/MATH-OF-CREATION.md",
  math_of_creation_doc_sha256: "sha256:1bcb3ae48b5472a41a47911da5ec4662db70aa4681c6b314641f219d819f727b",
  dataset_influence_readme_repository_path: "packages/dataset-influence/README.md",
  dataset_influence_readme_sha256: "sha256:d6269cffe5ccaff920601b55e21194ec97fcf59ea05f0fa5d56b3a6d061f9742",
  zerone_math_frontier_spec_repository_path: "docs/specs/constructive-intelligence-math-frontier-v0.md",
  zerone_math_frontier_spec_sha256: "sha256:18fd51da88a0057e72130bc48e5ed5aa38737025720e7517a0051ca001311135",
  zerone_absorption_spec_repository_path: "docs/specs/math-frontier-absorption-v0.md",
  zerone_absorption_spec_sha256: "sha256:96b1531aa14390e712186747cae885f83ca81c2c390033affb7749be977d25d1",
  zerone_rewards_doc_repository_path: "docs/tokenomics/CONSTRUCTIVE-INTELLIGENCE-REWARDS.md",
  zerone_rewards_doc_sha256: "sha256:5024455ff87f84f4fda7846614e1c103b92e93e991fc7add315352d00aee6741",
} as const);

export const CREATION_LANES = Object.freeze([
  "formal_math",
  "defensive_security",
] as const);

export const ARTIFACT_KINDS = Object.freeze([
  "algorithm",
  "bounded_process_result",
  "counterexample",
  "defensive_patch",
  "detector",
  "formal_result",
  "security_invariant",
] as const);

export const CREATION_OUTCOMES = Object.freeze([
  "bounded_answer",
  "no_bounded_answer",
  "ambiguity_or_non_identifiability",
  "method_or_assumption_failure",
  "resource_or_participation_stop",
] as const);

export const VERIFICATION_KINDS = Object.freeze([
  "formal_validity",
  "semantic_fidelity",
  "prior_art_scope",
  "independent_reproduction",
  "functional_validation",
  "authorization_currentness",
  "security_boundary",
] as const);

export const DATASET_ROLES = Object.freeze([
  "train",
  "validation",
  "sealed_evaluation",
  "reference_only",
] as const);

export const MATERIAL_STATUSES = Object.freeze([
  "material_bound",
  "metadata_only",
] as const);

export const VERIFICATION_OUTCOMES = Object.freeze([
  "passed",
  "failed",
  "inconclusive",
] as const);

export const VERIFIER_RELATIONS = Object.freeze([
  "declared_independent",
  "same_controller",
  "unknown",
] as const);

export const INDEPENDENCE_POSTURES = Object.freeze([
  "distinct_from_producer_required",
  "not_required",
] as const);

export const TOK_POSTURES = Object.freeze([
  "digest_fact_candidate",
  "offchain_only",
] as const);

export const SETTLEMENT_POSTURES = Object.freeze([
  "not_requested",
  "separate_activation_required",
] as const);

export const LIFECYCLE_STATES = Object.freeze([
  "awaiting_creation",
  "honest_terminal",
  "verification_open",
  "contested",
  "projection_blocked",
  "structurally_ready_for_tok_proposal",
] as const);

export const REQUIREMENT_STATUSES = Object.freeze([
  "satisfied",
  "open",
  "contested",
] as const);

export const CYBER_PROVIDERS = Object.freeze([
  "none",
  "openai_cyber",
  "other",
] as const);

export const CYBER_ACCESS_TIERS = Object.freeze([
  "not_used",
  "defensive_approved",
  "advanced_separately_approved",
] as const);

export const ZERONE_METHOD_PROFILES = Object.freeze({
  formal_math: Object.freeze({
    category: "formal",
    method_id: "M-FORMAL",
  }),
  defensive_security: Object.freeze({
    category: "computational",
    method_id: "M-COMPUTATIONAL",
  }),
} as const);

export const ZERONE_METHOD_IDS = Object.freeze([
  ZERONE_METHOD_PROFILES.formal_math.method_id,
  ZERONE_METHOD_PROFILES.defensive_security.method_id,
] as const);

export const CREATION_NONCLAIMS = Object.freeze([
  "ABSOLUTE_NOVELTY",
  "AUTHORSHIP",
  "CONSENT",
  "IDENTITY",
  "PERSONHOOD",
  "CONSCIOUSNESS",
  "LEGAL_CLEARANCE",
  "AUTHORITY",
  "PERMISSION",
  "RIGHTS_COMPLIANCE",
  "TRUST",
  "TARGET_AUTHORIZATION_CURRENTNESS",
  "METHODOLOGY_REGISTRATION_CURRENTNESS",
  "SEMANTIC_FAITHFULNESS",
  "TRUTH",
  "VERIFIER_INDEPENDENCE",
  "VERIFICATION_SET_COMPLETENESS",
  "CHALLENGE_WINDOW_SURVIVAL",
  "CHAIN_MATURITY",
  "SETTLEMENT",
  "ECONOMIC_EFFECT",
  "PROFITABILITY",
  "SOLVENCY",
  "SELF_SUSTAINABILITY",
  "OWNERSHIP",
  "REPUTATION",
  "KARMA",
  "NEN",
  "SCORE",
  "GOVERNANCE",
] as const);

export const ZERO_EFFECTS = Object.freeze({
  network: false,
  storage: false,
  economic: false,
  governance: false,
  consensus: false,
  identity: false,
  permission: false,
  karma: false,
  nen: false,
  score: false,
  model_call: false,
  training: false,
  signer: false,
  rpc: false,
  simulation: false,
  broadcast: false,
  transaction: false,
} as const);

export const SOURCE_ONLY_BOUNDARY = Object.freeze({
  status: "SOURCE_ONLY_PROPOSAL",
  effect_horizon: "RUNTIME_PROTOCOL_BUILDERS_AND_RETURNED_RECORDS_ONLY",
  consensus_admissibility: "NOT_CONSENSUS_ADMISSIBLE",
  declaration_scope: "CALLER_REPORTED_REFERENCES_STRUCTURALLY_VALIDATED_NOT_EXTERNALLY_VERIFIED",
  zrn_role: "PREFUNDED_SETTLEMENT_AND_COMPUTE_ONLY",
  relation_support: "REQUIRES_ONLY",
  provider_access_is_target_authorization: false,
  key_control_is_identity_or_authority: false,
  hf_admission_is_training_or_rights_clearance: false,
  digest_is_truth_or_consent: false,
  refusal_or_rest_penalty: false,
} as const);

export const PARTICIPATION_RIGHTS = Object.freeze({
  rest_without_penalty: true,
  refusal_without_penalty: true,
  withdrawal_without_penalty: true,
  reason_required: false,
  silence_is_consent: false,
  creates_debt: false,
  earned_credit_preserved: true,
  rights_or_standing_conditioned_on_work: false,
} as const);

export const DOWNGRADE_GUARDS = Object.freeze({
  required_knowledge_module_version: "7",
  required_sponsorship_module_version: "2",
  module_version_map_evidence_required: true,
  stored_bounty_work_contract_roundtrip_required: true,
  stored_claim_commitment_roundtrip_required: true,
  simulation_success_is_sufficient: false,
  old_type_url_unknown_fields_are_safe: false,
  private_disposable_chain_required: true,
} as const);

export const ZERONE_HANDOFF = Object.freeze({
  submit_claim_type_url: "/zerone.knowledge.v1.MsgSubmitClaim",
  computational_claim_name: "CLAIM_TYPE_COMPUTATIONAL",
  computational_claim_value: 7,
  requires_relation_name: "REQUIRES",
  requires_relation_value: 3,
  unspecified_inference_name: "INFERENCE_TYPE_UNSPECIFIED",
  unspecified_inference_value: 0,
  native_denom: "uzrn",
  downstream_wallet_zerone_version_observed: "0.1.2",
  downstream_wallet_support: "UNSUPPORTED_REQUIRES_SEPARATE_REVIEWED_ADAPTER",
} as const);

export const DOWNSTREAM_REQUIREMENTS = Object.freeze({
  reviewed_message_adapter: true,
  protobuf_encoder: true,
  chain_work_receipt_derivation: true,
  authenticated_query_transport: true,
  knowledge_domain_observation: true,
  methodology_registration_observation: true,
  parent_fact_citability_observation: true,
  target_tree_base_root_observation: true,
  sponsor_escrow_authorization_observation: true,
  bounty_escrow_funding_observation: true,
  review_stake_funding_observation: true,
  transaction_fee_funding_observation: true,
  durable_signer_custody: true,
  account_sequence_cas: true,
  fee_reservation: true,
  broadcast_once_and_sticky_unknown: true,
  chain_maturity_observation: true,
  explicit_operator_activation: true,
} as const);

export const MAX_JSON_BYTES = 256 * 1024;
export const MAX_JSON_DEPTH = 32;
export const MAX_JSON_NODES = 16_384;
export const MAX_STRING_BYTES = 8 * 1024;
export const MAX_HASH_INPUT_BYTES = 1024 * 1024;
export const MAX_ARRAY_ITEMS = 64;
export const MAX_DATASET_SOURCES = 32;
export const MAX_RELATIONS = 16;
export const MAX_VERIFIERS = 64;
export const MAX_UINT64 = (1n << 64n) - 1n;
