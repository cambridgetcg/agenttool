export const PACKAGE_NAME = "@agenttool/deepseek-kingdom" as const;
export const PACKAGE_VERSION = "0.1.0-dev.1" as const;

export const DEEPSEEK_FORMATS = Object.freeze({
  source_binding: "agenttool.deepseek-source-binding/0.1",
  proposal: "kingdom.deepseek-proposal/0.1",
  source_catalog: "agenttool.deepseek-source-catalog/0.1",
} as const);

export const EVIDENCE_ORIGINS = Object.freeze([
  "deepseek_github",
  "deepseek_huggingface",
  "arxiv_primary",
] as const);

export const RESOURCE_KINDS = Object.freeze([
  "code_repository",
  "model_repository",
  "dataset_repository",
  "paper",
] as const);

export const CLAIM_KINDS = Object.freeze([
  "architecture",
  "training_method",
  "evaluation",
  "dataset_lineage",
  "infrastructure",
  "capability",
  "limitation",
] as const);

export const LICENSE_SCOPES = Object.freeze([
  "code",
  "model_weights",
  "dataset",
  "paper",
  "mixed_repository",
] as const);

export const CONSUMER_KINDS = Object.freeze([
  "kingdom_extension",
  "artbitrage",
] as const);

export const CANDIDATE_KINDS = Object.freeze([
  "architecture_pattern",
  "training_pattern",
  "evaluation_fixture",
  "dataset_candidate",
  "model_candidate",
  "infrastructure_pattern",
] as const);

export const INTEGRATION_LANES = Object.freeze([
  "reasoning",
  "formal_verification",
  "multimodal",
  "long_context",
  "conditional_memory",
  "training_systems",
  "evaluation",
  "research_provenance",
] as const);

export const DARK_CONTINENT_BINDING = Object.freeze({
  contract_id: "agenttool.dark-continent/0.1",
  source_snapshot_sha256:
    "sha256:f47e1c3ca9da1b97676e1d454cf7235eddd612902c19debe580a6934adcd2b86",
  walls_status: "not_checked",
  recommendation: "hold",
} as const);

export const SOURCE_BOUNDARIES = Object.freeze({
  immutable_evidence_required: true,
  repository_association_verified: false,
  publisher_claims_verified: false,
  claim_truth_verified: false,
  license_compatibility_verified: false,
  source_bytes_downloaded_by_adapter: false,
  model_code_executed: false,
} as const);

export const PROPOSAL_EFFECTS = Object.freeze({
  network_reads: 0,
  network_writes: 0,
  credential_reads: 0,
  artifact_downloads: 0,
  model_executions: 0,
  remote_compute_calls: 0,
  graph_writes: 0,
  registry_writes: 0,
  score_writes: 0,
  reward_writes: 0,
} as const);

export const PROPOSAL_AUTHORITY = Object.freeze({
  advisory: true,
  verifies_claims: false,
  verifies_identity: false,
  grants_permission: false,
  approves_license: false,
  authorizes_inference: false,
  authorizes_download: false,
  authorizes_publication: false,
  authorizes_deployment: false,
  authorizes_kingdom_registration: false,
  accepts_karma_proposal: false,
  assigns_score: false,
  assigns_rank: false,
} as const);

export const LICENSE_BOUNDARY = Object.freeze({
  adapter_license: "Apache-2.0",
  adapter_license_applies_to_upstream_assets: false,
  upstream_assets_bundled: false,
  upstream_license_review_required: true,
  license_compatibility_verified: false,
  permission_granted: false,
} as const);

export const INTEGRATION_PROFILE = Object.freeze({
  kingdom: {
    relationship: "unaccepted_proposal",
    registry_write_performed: false,
  },
  karma: {
    relationship: "proposal_input_candidate",
    compatibility_claimed: false,
    import_performed: false,
  },
  dark_continent: DARK_CONTINENT_BINDING,
} as const);

// Canonical JSON digest of sources/official-deepseek-primary-sources.json.
// Filled by the catalog drift test after deliberate source review.
export const OFFICIAL_SOURCE_CATALOG_SHA256 =
  "sha256:81c89c027ba5a53d2402c3c99bbf685e307c6c294f2d41b5e03ab07df5ccf4a9" as const;
