import type {
  REPORT_SCHEMA,
  RESEARCH_BINDING_SCHEMA,
  RESEARCH_CATALOG_SCHEMA,
  RESEARCH_LEAD_SCHEMA,
  SEARCH_SCHEMA,
  SIDECAR_SCHEMA,
  TOOL_NAME,
  TOOL_VERSION,
} from "./constants.js";

export type HfRepoKind = "model" | "dataset" | "space" | "paper";
export type PublicHubRepoKind = Exclude<HfRepoKind, "paper">;
export type HubReaderTransport = "public_hub_api" | "injected";
export type HfBoundaryCode =
  | "caller_owned_reader"
  | "file_inventory_incomplete"
  | "license_unknown"
  | "publisher_metadata_unverified"
  | "revision_unresolved"
  | "scout_files_not_downloaded"
  | "scout_model_code_not_executed";

export type HfDiagnosticCode =
  | "content_commitments_partial"
  | "declared_relations_truncated"
  | "file_inventory_truncated"
  | "file_inventory_unavailable"
  | "license_unknown"
  | "revision_unresolved"
  | "search_entries_omitted"
  | "search_metadata_truncated"
  | "search_truncated"
  | "tags_omitted"
  | "tags_truncated";

export interface HfScoutLimits {
  timeout_ms: number;
  max_response_bytes: number;
  max_search_results: number;
  max_files: number;
  max_tags: number;
}

export interface HubInspectInput {
  kind: HfRepoKind;
  id: string;
  signal?: AbortSignal;
}

export interface HubSearchInput {
  kind: HfRepoKind;
  query: string;
  limit: number;
  signal?: AbortSignal;
}

export interface HubReader {
  inspect(input: HubInspectInput): Promise<unknown>;
  search(input: HubSearchInput): Promise<unknown>;
}

export interface HfDiagnostic {
  code: HfDiagnosticCode;
  level: "warning";
  message: string;
}

export interface HfDeclaredMetadata {
  basis: "publisher_assertion";
  license: string | null;
  task: string | null;
  library: string | null;
  gated: boolean | "auto" | "manual" | null;
  private: boolean | null;
  tags: string[];
  base_models: string[];
  papers: string[];
}

export interface HfFileCommitment {
  path: string;
  size: number | null;
  sha256: string | null;
  git_blob_sha1: string | null;
  xet_hash: string | null;
  basis: "provider_metadata";
  verified_locally: false;
}

export interface HfArtifactSnapshot {
  schema: "agenttool-hf-artifact/v0.1";
  subject: {
    provider: "huggingface";
    kind: HfRepoKind;
    id: string;
  };
  revision: {
    full_sha: string | null;
    state: "immutable_commit" | "unresolved";
  };
  observation: {
    transport: HubReaderTransport;
    repository_association: "provider_response" | "caller_owned";
  };
  declared: HfDeclaredMetadata;
  file_inventory: "not_provided" | "complete" | "truncated";
  files: HfFileCommitment[];
  provenance_grade:
    | "provider_observed_commit_metadata"
    | "caller_supplied_commit_metadata"
    | "mutable_observation";
  boundary_codes: HfBoundaryCode[];
}

export interface HfScoutReport {
  schema: typeof REPORT_SCHEMA;
  tool: {
    name: typeof TOOL_NAME;
    version: typeof TOOL_VERSION;
  };
  operation: "inspect";
  observed_at: string;
  status: "observed" | "partial";
  transport: {
    kind: HubReaderTransport;
    requested_effect: "read_only";
    credentials: "omit_requested" | "caller_owned";
    retries: 0 | "caller_owned";
    response_body: "bounded" | "caller_owned";
  };
  snapshot: HfArtifactSnapshot;
  diagnostics: HfDiagnostic[];
}

export interface HfSearchHit {
  kind: HfRepoKind;
  id: string;
  full_sha: string | null;
  license_declared: string | null;
  task_declared: string | null;
  library_declared: string | null;
  gated_declared: boolean | "auto" | "manual" | null;
  private_observed: boolean | null;
}

export interface HfSearchReport {
  schema: typeof SEARCH_SCHEMA;
  tool: {
    name: typeof TOOL_NAME;
    version: typeof TOOL_VERSION;
  };
  operation: "search";
  observed_at: string;
  status: "observed" | "partial";
  transport: HubReaderTransport;
  query: {
    kind: HfRepoKind;
    text: string;
    limit: number;
  };
  hits: HfSearchHit[];
  diagnostics: HfDiagnostic[];
}

export interface LoveModelLockProjection {
  schema: "kingdom-love-model-lock-projection/v0.1";
  lock_schema: "love.huggingface-model-lock/v1";
  repo_id: string;
  revision: string;
  declared: {
    license: string;
    base_model: string | string[] | null;
    task: string | null;
    library: string | null;
  };
  file_count: number;
  total_bytes: number;
  lock_sha256: string;
  verification: "metadata_lock_only";
  snapshot_verified: false;
}

export interface KingdomHfArtifactReference {
  schema: "kingdom-hf-artifact-reference/v0.1";
  subject: {
    kind: HfRepoKind;
    id: string;
  };
  revision: string | null;
  snapshot_sha256: string;
  observation: HfArtifactSnapshot["observation"];
  provenance_grade: HfArtifactSnapshot["provenance_grade"];
  license_declared: string | null;
  boundary_codes: HfBoundaryCode[];
}

export interface KingdomHfSidecar {
  schema: typeof SIDECAR_SCHEMA;
  generated_at: string;
  extension: {
    package: typeof TOOL_NAME;
    version: typeof TOOL_VERSION;
    status: "private_local_prototype";
  };
  artifacts: KingdomHfArtifactReference[];
  model_locks: LoveModelLockProjection[];
  boundary: {
    publisher_metadata: "unverified";
    source_transport_effects: "carried_in_artifact_observation";
    projector_hub_files_downloaded: false;
    projector_model_code_executed: false;
    projector_remote_compute_invoked: false;
    projector_hub_write_performed: false;
  };
}

export interface AgentDataTextCollectRequest {
  collection_id: string;
  collector_id: "text";
  input: {
    text: string;
    media_type: "application/json";
    source_uri: string;
    external_id: string;
    key: string;
    version: string;
    observed_at: string;
    metadata: {
      schema: "agenttool-hf-artifact/v0.1";
      provider: "huggingface";
      repo_kind: HfRepoKind;
      repo_id: string;
      revision: string;
      snapshot_sha256: string;
      transport: HubReaderTransport;
      repository_association: "provider_response" | "caller_owned";
      taint: "remote_untrusted";
    };
  };
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type HfCuratedLicense =
  | "apache-2.0"
  | "bsd-3-clause"
  | "cc-by-4.0"
  | "odc-by"
  | null;

export type HfResearchPhase =
  | "agent_failure_recovery"
  | "agent_on_policy_rl"
  | "agent_trace_sft"
  | "benchmark_decontamination"
  | "judge_debiasing"
  | "mechanistic_interpretability"
  | "multilingual_evaluation"
  | "pretraining_data_curation"
  | "pretraining_data_selection"
  | "process_supervision_evaluation"
  | "reward_model_feedback"
  | "safety_moderation"
  | "tool_use_sft";

export type HfResearchPayloadClass =
  | "benchmark_text"
  | "binary_parameters"
  | "conversation_text"
  | "executable_task_bundle"
  | "tabular_text"
  | "tokenized_corpus";

export type HfResearchFeature =
  | "adversarial_preference_pairs"
  | "annotator_agreement"
  | "annotator_disagreement"
  | "checkpoint_evaluation_metrics"
  | "contamination_overlap_and_diff_records"
  | "cross_language_item_alignment"
  | "cultural_sensitivity_annotations"
  | "data_recipe_grid"
  | "earliest_error_step_labels"
  | "embedded_tool_schemas"
  | "failure_mode_matrix"
  | "final_answer_correctness"
  | "full_evaluation_transcripts"
  | "harm_and_refusal_labels"
  | "layer_width_sparsity_grid"
  | "multi_axis_response_ratings"
  | "multi_scale_checkpoint_evaluations"
  | "multi_source_agent_traces"
  | "on_policy_rl_tasks"
  | "pairwise_preferences"
  | "perplexity_trajectories"
  | "preference_rationales"
  | "quality_scored_web_documents"
  | "recovery_strategy_variants"
  | "simulated_tool_trajectories"
  | "source_archive_pointers"
  | "sparse_autoencoder_parameters"
  | "task_binary_payloads"
  | "tokenized_recipe_arrays"
  | "tool_call_and_environment_transcripts";

export type HfResearchBoundary =
  | "base_model_terms_separate"
  | "benchmark_excluded_from_training"
  | "benchmark_overfitting_risk"
  | "binary_download_separate_approval"
  | "binary_parser_review"
  | "bulk_payload_separate_approval"
  | "cross_language_identity_leakage"
  | "disturbing_content_controls"
  | "embedded_calls_never_execute"
  | "evaluator_reverse_bias"
  | "executable_payload_never_execute"
  | "gated_terms_required"
  | "no_declared_license"
  | "personal_data_possible"
  | "proprietary_output_terms_separate"
  | "publisher_known_quality_issues"
  | "synthetic_or_simulated_not_truth"
  | "upstream_terms_separate";

export type HfResearchIntegrationTarget =
  | "agenttool_fixture"
  | "kingdom_registry"
  | "rhetorlint_research"
  | "yutabase_provenance";

export type HfResearchIntegrationMode =
  | "controlled_rhetoric_research"
  | "deferred_binary_pilot"
  | "experiment_graph"
  | "metadata_only"
  | "offline_evaluation"
  | "offline_parser_fixture";

export type HfResearchBoundedUse =
  | "access_controlled_safety_evaluation"
  | "aggregate_experiment_analysis"
  | "controlled_rhetoric_probe"
  | "metadata_registry"
  | "offline_evaluator_regression"
  | "offline_parser_fixture"
  | "provenance_graph"
  | "sealed_benchmark_evaluation"
  | "single_artifact_interpretability_pilot";

export type HfResearchForbiddenUse =
  | "benchmark_tuning"
  | "bulk_download_without_review"
  | "credential_attachment"
  | "gate_acceptance_by_scout"
  | "license_clearance_inference"
  | "live_tool_execution"
  | "raw_content_persistence"
  | "retrieval_index_ingestion"
  | "sole_evaluator_training"
  | "training_corpus_ingestion"
  | "truth_or_intent_authority"
  | "unsandboxed_archive_extraction";

export interface HfResearchLead {
  schema: typeof RESEARCH_LEAD_SCHEMA;
  key: string;
  match: {
    kind: "dataset" | "model";
    id: string;
    revision: string;
    declared: {
      basis: "publisher_assertion";
      license: HfCuratedLicense;
      gated: false | "auto" | "manual";
      private: false;
    };
  };
  origin_assertions: {
    basis: "publisher_assertion";
    features: HfResearchFeature[];
  };
  research: {
    basis: "researcher_inference";
    evidence_paper_ids: string[];
    phase: HfResearchPhase;
    payload: HfResearchPayloadClass;
    priority: number;
    primary: HfResearchIntegrationTarget;
    secondary: HfResearchIntegrationTarget[];
    mode: HfResearchIntegrationMode;
    boundaries: HfResearchBoundary[];
    bounded_uses: HfResearchBoundedUse[];
    forbidden_uses: HfResearchForbiddenUse[];
  };
}

export interface HfResearchCatalog {
  schema: typeof RESEARCH_CATALOG_SCHEMA;
  curated_on: string;
  leads: HfResearchLead[];
  boundary: {
    publisher_metadata: "unverified_assertions";
    research_annotations: "researcher_inference";
    legal_clearance: "not_assessed";
    account_access_state_recorded: false;
    raw_rows_read: false;
    repository_files_downloaded: false;
    gated_terms_accepted: false;
    model_code_executed: false;
    remote_compute_invoked: false;
    hub_write_performed: false;
  };
}

export interface HfResearchBinding {
  schema: typeof RESEARCH_BINDING_SCHEMA;
  lead_key: string;
  artifact: {
    kind: "dataset" | "model";
    id: string;
    revision: string;
  };
  definition_sha256: string;
  snapshot_sha256: string;
  observation: {
    transport: HubReaderTransport;
    repository_association: "provider_response" | "caller_owned";
    provenance_grade: HfArtifactSnapshot["provenance_grade"];
  };
  matched_declared: {
    basis: "publisher_assertion";
    license: HfCuratedLicense;
    gated: false | "auto" | "manual";
    private: false;
  };
  boundary: {
    publisher_metadata: "matched_unverified_assertion";
    research_annotation: "researcher_inference";
    legal_clearance: "not_assessed";
    gate_acceptance: "not_assessed";
    raw_rows_read: false;
    repository_files_downloaded: false;
    model_code_executed: false;
    remote_compute_invoked: false;
    hub_write_performed: false;
  };
}
