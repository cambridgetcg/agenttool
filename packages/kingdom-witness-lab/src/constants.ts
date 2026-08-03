export const PACKAGE_NAME = "@agenttool/kingdom-witness-lab" as const;
export const PACKAGE_VERSION = "0.1.0-dev.0" as const;

export const RESEARCH_PASSPORT_SCHEMA =
  "kingdom.research-passport/0.1" as const;
export const EXECUTION_ROUTE_BINDING_SCHEMA =
  "kingdom.execution-route-binding/0.1" as const;
export const WITNESS_DOSSIER_SCHEMA =
  "kingdom.witness-dossier/0.1" as const;
export const SPECULATIVE_TRIAL_SCHEMA =
  "kingdom.speculative-decoding-trial/0.1" as const;
export const DEEPSEEK_ATLAS_SCHEMA =
  "kingdom.deepseek-atlas/0.1" as const;

export const RESEARCH_PASSPORT_STATEMENT =
  "Exact-revision research reference only. Publisher assertions and researcher proposals are separated and unverified. This passport is not proof of authorship, safety, legal clearance, truth, identity, representation, authority, or permission to execute." as const;

export const EXECUTION_ROUTE_BINDING_STATEMENT =
  "Caller-supplied route description only. Artifact identity and execution route are distinct; compatibility is not semantic equivalence. This binding performs no provider call, receives no credential, and grants no authority or permission to dispatch." as const;

export const WITNESS_DOSSIER_STATEMENT =
  "Digest-only caller-reported observations. Sources and independence are not revalidated; agreement is not truth and disagreement is not falsity. This dossier has no score, quorum, consensus, verdict, trust, representation, or authority." as const;

export const SPECULATIVE_TRIAL_STATEMENT =
  "Digest-only caller-reported speculative-decoding trial description. It contains no prompts or outputs, runs nothing, and does not prove matched settings, performance, safety, equivalence, or permission to retry." as const;

export const RESEARCH_PROVIDERS = ["arxiv", "github", "huggingface"] as const;
export const RESEARCH_KINDS = ["code", "dataset", "model", "paper"] as const;
export const DECLARED_LICENSES = ["apache-2.0", "mit", "other"] as const;
export const LICENSE_SCOPES = ["artifact", "code_only", "repository", "unknown"] as const;
export const RESEARCH_CAPABILITIES = [
  "conditional_static_memory",
  "distributed_training_storage",
  "document_ocr",
  "formal_proof_benchmark",
  "long_context_text_generation",
  "multilingual_visual_interpretation",
  "reasoning_text_generation",
  "self_verification_research",
  "speculative_decoding",
] as const;
export const RESEARCH_ROLES = [
  "benchmark_fixture",
  "document_interpreter_candidate",
  "long_context_interpreter_candidate",
  "reasoning_research_lead",
  "speculative_decoding_research_lead",
  "static_memory_research_lead",
  "storage_research_lead",
] as const;
export const RESEARCH_TARGETS = [
  "browser",
  "kingdom",
  "repo_archive",
  "rhetorlint",
  "trials",
  "trusted_runtime",
  "yutabase",
] as const;
export const RESEARCH_STAGES = [
  "deferred_design_reference",
  "metadata_only",
  "offline_trial_candidate",
] as const;
export const RESEARCH_BOUNDARY_CODES = [
  "benchmark_excluded_from_training",
  "binary_download_separate_approval",
  "bulk_cache_separate_approval",
  "caller_injected_execution_only",
  "code_execution_separate_review",
  "custom_code_never_auto_execute",
  "demo_not_production_implementation",
  "license_clearance_not_assessed",
  "model_output_not_truth",
  "model_terms_separate",
  "no_declared_license",
  "not_decentralized_archive",
  "provider_api_separate",
  "raw_content_not_admitted",
  "third_party_terms_separate",
  "visual_input_disclosure_separate",
  "weights_not_downloaded",
  "workflow_not_executed",
] as const;

export const ROUTE_PROVIDERS = [
  "deepseek_api",
  "huggingface_inference",
  "local_injected",
  "other_injected",
] as const;
export const API_DIALECTS = [
  "anthropic_messages",
  "deepseek_responses",
  "local_adapter",
  "openai_chat_completions",
  "other",
] as const;
export const ROUTE_EQUIVALENCE = [
  "publisher_asserted",
  "unknown",
  "verified",
] as const;
export const ROUTE_FEATURES = [
  "context_length",
  "logprobs",
  "multimodal_input",
  "prefix_completion",
  "reasoning_controls",
  "response_format",
  "sampling_controls",
  "tool_use",
] as const;
export const ROUTE_FEATURE_STATUSES = [
  "ignored",
  "remapped",
  "supported",
  "unknown",
] as const;
export const ROUTE_FEATURE_NOTES = [
  "provider_specific_semantics",
  "silently_ignored",
  "version_dependent",
] as const;
export const RETENTION_BASES = [
  "caller_reported",
  "contractual",
  "provider_policy_observed",
  "unknown",
] as const;
export const INPUT_DISCLOSURES = ["local_only", "remote_provider", "unknown"] as const;
export const TRAINING_USES = [
  "allowed_by_general_policy",
  "not_applicable",
  "opted_out_reported",
  "unknown",
] as const;

export const WITNESS_KINDS = [
  "browser_material",
  "collab_report",
  "dataset_label",
  "human_review",
  "model_interpreter",
  "publisher_assertion",
  "rhetorlint",
  "trial_receipt",
] as const;
export const WITNESS_STANCES = [
  "contradicts",
  "insufficient",
  "not_applicable",
  "supports",
  "unknown",
] as const;
export const WITNESS_INDEPENDENCE = ["independent", "shared_source", "unknown"] as const;
export const WITNESS_EXECUTION = [
  "local_reported",
  "not_applicable",
  "not_started_reported",
  "remote_reported",
  "unknown",
] as const;
export const WITNESS_DISCLOSURE = [
  "content_disclosed_reported",
  "digest_only_reported",
  "none_reported",
  "unknown",
] as const;
export const HUMAN_REVIEW_STATUSES = [
  "completed_reported",
  "not_requested",
  "pending_reported",
] as const;
export const DOSSIER_RELATIONSHIPS = [
  "cross_source_agreement_observed",
  "disagreement_observed",
  "no_directional_observation",
  "one_sided_observation",
] as const;

export const TRIAL_STATUSES = [
  "completed_reported",
  "failed_reported",
  "not_started_reported",
  "planned",
] as const;
export const THINKING_MODES = ["disabled", "enabled", "unknown"] as const;
export const SAMPLING_MODES = ["deterministic", "sampled", "unknown"] as const;
