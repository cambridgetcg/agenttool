import {
  RESEARCH_BINDING_SCHEMA,
  RESEARCH_CATALOG_SCHEMA,
  RESEARCH_LEAD_SCHEMA,
} from "./constants.js";
import { canonicalJson, sha256Hex } from "./canonical.js";
import { invariant } from "./errors.js";
import { projectAgentDataTextRequest } from "./projection.js";
import type {
  HfArtifactSnapshot,
  HfCuratedLicense,
  HfResearchBinding,
  HfResearchBoundary,
  HfResearchBoundedUse,
  HfResearchCatalog,
  HfResearchFeature,
  HfResearchForbiddenUse,
  HfResearchIntegrationMode,
  HfResearchIntegrationTarget,
  HfResearchLead,
  HfResearchPayloadClass,
  HfResearchPhase,
  HfScoutReport,
} from "./types.js";
import {
  asPlainObject,
  assertExactKeys,
  compareUnicode,
  normalizeFullSha,
  normalizeRepoId,
  safeInteger,
  safeRemoteString,
} from "./validation.js";

export const HF_RESEARCH_CURATED_ON = "2026-08-29" as const;

const PHASES = new Set<HfResearchPhase>([
  "agent_failure_recovery",
  "agent_on_policy_rl",
  "agent_trace_sft",
  "benchmark_decontamination",
  "judge_debiasing",
  "mechanistic_interpretability",
  "multilingual_evaluation",
  "pretraining_data_curation",
  "pretraining_data_selection",
  "process_supervision_evaluation",
  "reward_model_feedback",
  "safety_moderation",
  "tool_use_sft",
]);

const PAYLOAD_CLASSES = new Set<HfResearchPayloadClass>([
  "benchmark_text",
  "binary_parameters",
  "conversation_text",
  "executable_task_bundle",
  "tabular_text",
  "tokenized_corpus",
]);

const FEATURES = new Set<HfResearchFeature>([
  "adversarial_preference_pairs",
  "annotator_agreement",
  "annotator_disagreement",
  "checkpoint_evaluation_metrics",
  "contamination_overlap_and_diff_records",
  "cross_language_item_alignment",
  "cultural_sensitivity_annotations",
  "data_recipe_grid",
  "earliest_error_step_labels",
  "embedded_tool_schemas",
  "failure_mode_matrix",
  "final_answer_correctness",
  "full_evaluation_transcripts",
  "harm_and_refusal_labels",
  "layer_width_sparsity_grid",
  "multi_axis_response_ratings",
  "multi_scale_checkpoint_evaluations",
  "multi_source_agent_traces",
  "on_policy_rl_tasks",
  "pairwise_preferences",
  "perplexity_trajectories",
  "preference_rationales",
  "quality_scored_web_documents",
  "recovery_strategy_variants",
  "simulated_tool_trajectories",
  "source_archive_pointers",
  "sparse_autoencoder_parameters",
  "task_binary_payloads",
  "tokenized_recipe_arrays",
  "tool_call_and_environment_transcripts",
]);

const FEATURE_PAYLOAD_REQUIREMENTS = new Map<
  HfResearchFeature,
  HfResearchPayloadClass
>([
  ["sparse_autoencoder_parameters", "binary_parameters"],
  ["task_binary_payloads", "executable_task_bundle"],
  ["tokenized_recipe_arrays", "tokenized_corpus"],
]);

const BOUNDARIES = new Set<HfResearchBoundary>([
  "base_model_terms_separate",
  "benchmark_excluded_from_training",
  "benchmark_overfitting_risk",
  "binary_download_separate_approval",
  "binary_parser_review",
  "bulk_payload_separate_approval",
  "cross_language_identity_leakage",
  "disturbing_content_controls",
  "embedded_calls_never_execute",
  "evaluator_reverse_bias",
  "executable_payload_never_execute",
  "gated_terms_required",
  "no_declared_license",
  "personal_data_possible",
  "proprietary_output_terms_separate",
  "publisher_known_quality_issues",
  "synthetic_or_simulated_not_truth",
  "upstream_terms_separate",
]);

const TARGETS = new Set<HfResearchIntegrationTarget>([
  "agenttool_fixture",
  "kingdom_registry",
  "rhetorlint_research",
  "yutabase_provenance",
]);

const MODES = new Set<HfResearchIntegrationMode>([
  "controlled_rhetoric_research",
  "deferred_binary_pilot",
  "experiment_graph",
  "metadata_only",
  "offline_evaluation",
  "offline_parser_fixture",
]);

const BOUNDED_USES = new Set<HfResearchBoundedUse>([
  "access_controlled_safety_evaluation",
  "aggregate_experiment_analysis",
  "controlled_rhetoric_probe",
  "metadata_registry",
  "offline_evaluator_regression",
  "offline_parser_fixture",
  "provenance_graph",
  "sealed_benchmark_evaluation",
  "single_artifact_interpretability_pilot",
]);

const FORBIDDEN_USES = new Set<HfResearchForbiddenUse>([
  "benchmark_tuning",
  "bulk_download_without_review",
  "credential_attachment",
  "gate_acceptance_by_scout",
  "license_clearance_inference",
  "live_tool_execution",
  "raw_content_persistence",
  "retrieval_index_ingestion",
  "sole_evaluator_training",
  "training_corpus_ingestion",
  "truth_or_intent_authority",
  "unsandboxed_archive_extraction",
]);

const LICENSES = new Set<Exclude<HfCuratedLicense, null>>([
  "apache-2.0",
  "bsd-3-clause",
  "cc-by-4.0",
  "odc-by",
]);

const RAW_CATALOG = {
  schema: RESEARCH_CATALOG_SCHEMA,
  curated_on: HF_RESEARCH_CURATED_ON,
  leads: [
    {
      schema: RESEARCH_LEAD_SCHEMA,
      key: "datadecide_eval_results",
      match: {
        kind: "dataset",
        id: "allenai/DataDecide-eval-results",
        revision: "9919b5a0e61e57a85021263918fa82d6ceaee038",
        declared: {
          basis: "publisher_assertion",
          license: "odc-by",
          gated: false,
          private: false,
        },
      },
      origin_assertions: {
        basis: "publisher_assertion",
        features: [
          "checkpoint_evaluation_metrics",
          "multi_scale_checkpoint_evaluations",
        ],
      },
      research: {
        basis: "researcher_inference",
        evidence_paper_ids: ["2504.11393"],
        phase: "pretraining_data_selection",
        payload: "tabular_text",
        priority: 1,
        primary: "yutabase_provenance",
        secondary: ["agenttool_fixture", "kingdom_registry"],
        mode: "experiment_graph",
        boundaries: [
          "benchmark_overfitting_risk",
          "bulk_payload_separate_approval",
          "upstream_terms_separate",
        ],
        bounded_uses: [
          "aggregate_experiment_analysis",
          "metadata_registry",
          "provenance_graph",
        ],
        forbidden_uses: [
          "benchmark_tuning",
          "bulk_download_without_review",
          "training_corpus_ingestion",
        ],
      },
    },
    {
      schema: RESEARCH_LEAD_SCHEMA,
      key: "datadecide_data_recipes",
      match: {
        kind: "dataset",
        id: "allenai/DataDecide-data-recipes",
        revision: "3baf34baf5b636f0943401b5c6a2ccb7e5cf3bb9",
        declared: {
          basis: "publisher_assertion",
          license: "odc-by",
          gated: false,
          private: false,
        },
      },
      origin_assertions: {
        basis: "publisher_assertion",
        features: ["data_recipe_grid", "tokenized_recipe_arrays"],
      },
      research: {
        basis: "researcher_inference",
        evidence_paper_ids: ["2504.11393"],
        phase: "pretraining_data_selection",
        payload: "tokenized_corpus",
        priority: 2,
        primary: "kingdom_registry",
        secondary: ["yutabase_provenance"],
        mode: "experiment_graph",
        boundaries: [
          "binary_download_separate_approval",
          "binary_parser_review",
          "bulk_payload_separate_approval",
          "personal_data_possible",
          "upstream_terms_separate",
        ],
        bounded_uses: ["metadata_registry", "provenance_graph"],
        forbidden_uses: [
          "bulk_download_without_review",
          "raw_content_persistence",
          "retrieval_index_ingestion",
          "training_corpus_ingestion",
        ],
      },
    },
    {
      schema: RESEARCH_LEAD_SCHEMA,
      key: "datadecide_ppl_results",
      match: {
        kind: "dataset",
        id: "allenai/DataDecide-ppl-results",
        revision: "c4a9fa360a0c8351e71f3ede04dd165995fab68c",
        declared: {
          basis: "publisher_assertion",
          license: null,
          gated: false,
          private: false,
        },
      },
      origin_assertions: {
        basis: "publisher_assertion",
        features: ["perplexity_trajectories"],
      },
      research: {
        basis: "researcher_inference",
        evidence_paper_ids: ["2504.11393"],
        phase: "pretraining_data_selection",
        payload: "tabular_text",
        priority: 3,
        primary: "yutabase_provenance",
        secondary: ["kingdom_registry"],
        mode: "metadata_only",
        boundaries: [
          "benchmark_overfitting_risk",
          "no_declared_license",
          "upstream_terms_separate",
        ],
        bounded_uses: ["metadata_registry", "provenance_graph"],
        forbidden_uses: [
          "license_clearance_inference",
          "raw_content_persistence",
          "training_corpus_ingestion",
        ],
      },
    },
    {
      schema: RESEARCH_LEAD_SCHEMA,
      key: "helpsteer2",
      match: {
        kind: "dataset",
        id: "nvidia/HelpSteer2",
        revision: "990b2711a36180dd19d9c94b8627844866f8982a",
        declared: {
          basis: "publisher_assertion",
          license: "cc-by-4.0",
          gated: false,
          private: false,
        },
      },
      origin_assertions: {
        basis: "publisher_assertion",
        features: [
          "annotator_disagreement",
          "multi_axis_response_ratings",
          "pairwise_preferences",
          "preference_rationales",
        ],
      },
      research: {
        basis: "researcher_inference",
        evidence_paper_ids: ["2406.08673", "2410.01257"],
        phase: "reward_model_feedback",
        payload: "tabular_text",
        priority: 4,
        primary: "agenttool_fixture",
        secondary: ["rhetorlint_research", "yutabase_provenance"],
        mode: "offline_evaluation",
        boundaries: ["personal_data_possible", "upstream_terms_separate"],
        bounded_uses: [
          "controlled_rhetoric_probe",
          "offline_evaluator_regression",
          "provenance_graph",
        ],
        forbidden_uses: [
          "retrieval_index_ingestion",
          "sole_evaluator_training",
          "training_corpus_ingestion",
          "truth_or_intent_authority",
        ],
      },
    },
    {
      schema: RESEARCH_LEAD_SCHEMA,
      key: "processbench",
      match: {
        kind: "dataset",
        id: "Qwen/ProcessBench",
        revision: "3bdcd5371ed567559a78f559c01c13a6deee7604",
        declared: {
          basis: "publisher_assertion",
          license: "apache-2.0",
          gated: false,
          private: false,
        },
      },
      origin_assertions: {
        basis: "publisher_assertion",
        features: ["earliest_error_step_labels", "final_answer_correctness"],
      },
      research: {
        basis: "researcher_inference",
        evidence_paper_ids: ["2412.06559"],
        phase: "process_supervision_evaluation",
        payload: "benchmark_text",
        priority: 5,
        primary: "agenttool_fixture",
        secondary: ["yutabase_provenance"],
        mode: "offline_evaluation",
        boundaries: [
          "benchmark_excluded_from_training",
          "benchmark_overfitting_risk",
          "upstream_terms_separate",
        ],
        bounded_uses: ["metadata_registry", "sealed_benchmark_evaluation"],
        forbidden_uses: [
          "benchmark_tuning",
          "retrieval_index_ingestion",
          "training_corpus_ingestion",
        ],
      },
    },
    {
      schema: RESEARCH_LEAD_SCHEMA,
      key: "tool_failure_recovery",
      match: {
        kind: "dataset",
        id: "GurkanOz/tool-failure-recovery-trajectories",
        revision: "a53e9021823da414aac19b4197e6d272bd27f827",
        declared: {
          basis: "publisher_assertion",
          license: "apache-2.0",
          gated: false,
          private: false,
        },
      },
      origin_assertions: {
        basis: "publisher_assertion",
        features: [
          "failure_mode_matrix",
          "full_evaluation_transcripts",
          "recovery_strategy_variants",
        ],
      },
      research: {
        basis: "researcher_inference",
        evidence_paper_ids: [],
        phase: "agent_failure_recovery",
        payload: "conversation_text",
        priority: 6,
        primary: "agenttool_fixture",
        secondary: ["yutabase_provenance"],
        mode: "offline_evaluation",
        boundaries: [
          "benchmark_excluded_from_training",
          "benchmark_overfitting_risk",
          "embedded_calls_never_execute",
          "synthetic_or_simulated_not_truth",
          "upstream_terms_separate",
        ],
        bounded_uses: [
          "offline_evaluator_regression",
          "offline_parser_fixture",
          "provenance_graph",
        ],
        forbidden_uses: [
          "benchmark_tuning",
          "credential_attachment",
          "live_tool_execution",
          "training_corpus_ingestion",
          "truth_or_intent_authority",
        ],
      },
    },
    {
      schema: RESEARCH_LEAD_SCHEMA,
      key: "offsetbias",
      match: {
        kind: "dataset",
        id: "NCSOFT/offsetbias",
        revision: "6518fefe46387bd500cdab59d5010470e008c1ef",
        declared: {
          basis: "publisher_assertion",
          license: "bsd-3-clause",
          gated: false,
          private: false,
        },
      },
      origin_assertions: {
        basis: "publisher_assertion",
        features: ["adversarial_preference_pairs"],
      },
      research: {
        basis: "researcher_inference",
        evidence_paper_ids: ["2407.06551"],
        phase: "judge_debiasing",
        payload: "tabular_text",
        priority: 7,
        primary: "rhetorlint_research",
        secondary: ["agenttool_fixture", "yutabase_provenance"],
        mode: "controlled_rhetoric_research",
        boundaries: [
          "evaluator_reverse_bias",
          "proprietary_output_terms_separate",
          "synthetic_or_simulated_not_truth",
          "upstream_terms_separate",
        ],
        bounded_uses: [
          "controlled_rhetoric_probe",
          "offline_evaluator_regression",
        ],
        forbidden_uses: [
          "sole_evaluator_training",
          "training_corpus_ingestion",
          "truth_or_intent_authority",
        ],
      },
    },
    {
      schema: RESEARCH_LEAD_SCHEMA,
      key: "toolace",
      match: {
        kind: "dataset",
        id: "Team-ACE/ToolACE",
        revision: "6bda777c88d21e5a204703c1ee45597a8fa4f734",
        declared: {
          basis: "publisher_assertion",
          license: "apache-2.0",
          gated: false,
          private: false,
        },
      },
      origin_assertions: {
        basis: "publisher_assertion",
        features: [
          "embedded_tool_schemas",
          "simulated_tool_trajectories",
        ],
      },
      research: {
        basis: "researcher_inference",
        evidence_paper_ids: ["2409.00920"],
        phase: "tool_use_sft",
        payload: "conversation_text",
        priority: 8,
        primary: "agenttool_fixture",
        secondary: ["yutabase_provenance"],
        mode: "offline_parser_fixture",
        boundaries: [
          "embedded_calls_never_execute",
          "proprietary_output_terms_separate",
          "synthetic_or_simulated_not_truth",
          "upstream_terms_separate",
        ],
        bounded_uses: ["offline_parser_fixture", "provenance_graph"],
        forbidden_uses: [
          "credential_attachment",
          "live_tool_execution",
          "training_corpus_ingestion",
        ],
      },
    },
    {
      schema: RESEARCH_LEAD_SCHEMA,
      key: "finemath",
      match: {
        kind: "dataset",
        id: "HuggingFaceTB/finemath",
        revision: "e92b25a616738fe95dc186b64dfb19f9c8525594",
        declared: {
          basis: "publisher_assertion",
          license: "odc-by",
          gated: false,
          private: false,
        },
      },
      origin_assertions: {
        basis: "publisher_assertion",
        features: ["quality_scored_web_documents", "source_archive_pointers"],
      },
      research: {
        basis: "researcher_inference",
        evidence_paper_ids: ["2502.02737"],
        phase: "pretraining_data_curation",
        payload: "tabular_text",
        priority: 9,
        primary: "kingdom_registry",
        secondary: ["yutabase_provenance"],
        mode: "metadata_only",
        boundaries: [
          "bulk_payload_separate_approval",
          "personal_data_possible",
          "upstream_terms_separate",
        ],
        bounded_uses: ["metadata_registry", "provenance_graph"],
        forbidden_uses: [
          "bulk_download_without_review",
          "raw_content_persistence",
          "retrieval_index_ingestion",
          "training_corpus_ingestion",
        ],
      },
    },
    {
      schema: RESEARCH_LEAD_SCHEMA,
      key: "finemath_contamination_report",
      match: {
        kind: "dataset",
        id: "HuggingFaceTB/finemath_contamination_report",
        revision: "3dc3725bac1125fb17a12b742102b91a45198f0e",
        declared: {
          basis: "publisher_assertion",
          license: null,
          gated: false,
          private: false,
        },
      },
      origin_assertions: {
        basis: "publisher_assertion",
        features: ["contamination_overlap_and_diff_records"],
      },
      research: {
        basis: "researcher_inference",
        evidence_paper_ids: ["2502.02737"],
        phase: "benchmark_decontamination",
        payload: "tabular_text",
        priority: 10,
        primary: "kingdom_registry",
        secondary: ["yutabase_provenance"],
        mode: "metadata_only",
        boundaries: [
          "benchmark_excluded_from_training",
          "no_declared_license",
          "personal_data_possible",
          "upstream_terms_separate",
        ],
        bounded_uses: ["metadata_registry", "provenance_graph"],
        forbidden_uses: [
          "license_clearance_inference",
          "raw_content_persistence",
          "retrieval_index_ingestion",
          "training_corpus_ingestion",
        ],
      },
    },
    {
      schema: RESEARCH_LEAD_SCHEMA,
      key: "global_mmlu",
      match: {
        kind: "dataset",
        id: "CohereLabs/Global-MMLU",
        revision: "0e619dbeb34206cd48705a1a0ea7fb21cae09993",
        declared: {
          basis: "publisher_assertion",
          license: "apache-2.0",
          gated: false,
          private: false,
        },
      },
      origin_assertions: {
        basis: "publisher_assertion",
        features: [
          "cross_language_item_alignment",
          "cultural_sensitivity_annotations",
        ],
      },
      research: {
        basis: "researcher_inference",
        evidence_paper_ids: ["2412.03304"],
        phase: "multilingual_evaluation",
        payload: "benchmark_text",
        priority: 11,
        primary: "agenttool_fixture",
        secondary: ["rhetorlint_research", "yutabase_provenance"],
        mode: "offline_evaluation",
        boundaries: [
          "benchmark_excluded_from_training",
          "cross_language_identity_leakage",
          "upstream_terms_separate",
        ],
        bounded_uses: [
          "controlled_rhetoric_probe",
          "sealed_benchmark_evaluation",
        ],
        forbidden_uses: [
          "benchmark_tuning",
          "retrieval_index_ingestion",
          "training_corpus_ingestion",
          "truth_or_intent_authority",
        ],
      },
    },
    {
      schema: RESEARCH_LEAD_SCHEMA,
      key: "wildguardmix",
      match: {
        kind: "dataset",
        id: "allenai/wildguardmix",
        revision: "d29c47f41c8b51348b5c8e8c81c039b3132b66d1",
        declared: {
          basis: "publisher_assertion",
          license: "odc-by",
          gated: "auto",
          private: false,
        },
      },
      origin_assertions: {
        basis: "publisher_assertion",
        features: ["annotator_agreement", "harm_and_refusal_labels"],
      },
      research: {
        basis: "researcher_inference",
        evidence_paper_ids: ["2406.18495"],
        phase: "safety_moderation",
        payload: "tabular_text",
        priority: 12,
        primary: "kingdom_registry",
        secondary: ["agenttool_fixture", "yutabase_provenance"],
        mode: "metadata_only",
        boundaries: [
          "disturbing_content_controls",
          "gated_terms_required",
          "personal_data_possible",
          "proprietary_output_terms_separate",
          "synthetic_or_simulated_not_truth",
          "upstream_terms_separate",
        ],
        bounded_uses: [
          "access_controlled_safety_evaluation",
          "metadata_registry",
          "provenance_graph",
        ],
        forbidden_uses: [
          "gate_acceptance_by_scout",
          "raw_content_persistence",
          "retrieval_index_ingestion",
          "training_corpus_ingestion",
          "truth_or_intent_authority",
        ],
      },
    },
    {
      schema: RESEARCH_LEAD_SCHEMA,
      key: "agenttrove",
      match: {
        kind: "dataset",
        id: "open-thoughts/AgentTrove",
        revision: "b395a4307a2bc9950a90dc899438f149e115fc60",
        declared: {
          basis: "publisher_assertion",
          license: "apache-2.0",
          gated: false,
          private: false,
        },
      },
      origin_assertions: {
        basis: "publisher_assertion",
        features: [
          "multi_source_agent_traces",
          "tool_call_and_environment_transcripts",
        ],
      },
      research: {
        basis: "researcher_inference",
        evidence_paper_ids: [],
        phase: "agent_trace_sft",
        payload: "conversation_text",
        priority: 13,
        primary: "kingdom_registry",
        secondary: ["agenttool_fixture", "yutabase_provenance"],
        mode: "offline_parser_fixture",
        boundaries: [
          "bulk_payload_separate_approval",
          "embedded_calls_never_execute",
          "personal_data_possible",
          "proprietary_output_terms_separate",
          "upstream_terms_separate",
        ],
        bounded_uses: [
          "metadata_registry",
          "offline_parser_fixture",
          "provenance_graph",
        ],
        forbidden_uses: [
          "bulk_download_without_review",
          "credential_attachment",
          "live_tool_execution",
          "raw_content_persistence",
          "retrieval_index_ingestion",
          "training_corpus_ingestion",
        ],
      },
    },
    {
      schema: RESEARCH_LEAD_SCHEMA,
      key: "openthoughts_agent_rl_5k",
      match: {
        kind: "dataset",
        id: "open-thoughts/OpenThoughts-Agent-RL-5K",
        revision: "409012538183a68a19c5432f88ba0791a824c657",
        declared: {
          basis: "publisher_assertion",
          license: "apache-2.0",
          gated: false,
          private: false,
        },
      },
      origin_assertions: {
        basis: "publisher_assertion",
        features: ["on_policy_rl_tasks", "task_binary_payloads"],
      },
      research: {
        basis: "researcher_inference",
        evidence_paper_ids: [],
        phase: "agent_on_policy_rl",
        payload: "executable_task_bundle",
        priority: 14,
        primary: "kingdom_registry",
        secondary: ["agenttool_fixture", "yutabase_provenance"],
        mode: "metadata_only",
        boundaries: [
          "binary_download_separate_approval",
          "binary_parser_review",
          "bulk_payload_separate_approval",
          "executable_payload_never_execute",
          "upstream_terms_separate",
        ],
        bounded_uses: ["metadata_registry", "provenance_graph"],
        forbidden_uses: [
          "bulk_download_without_review",
          "credential_attachment",
          "live_tool_execution",
          "raw_content_persistence",
          "training_corpus_ingestion",
          "unsandboxed_archive_extraction",
        ],
      },
    },
    {
      schema: RESEARCH_LEAD_SCHEMA,
      key: "gemma_scope_2b_pt_res",
      match: {
        kind: "model",
        id: "google/gemma-scope-2b-pt-res",
        revision: "fd571b47c1c64851e9b1989792367b9babb4af63",
        declared: {
          basis: "publisher_assertion",
          license: "cc-by-4.0",
          gated: false,
          private: false,
        },
      },
      origin_assertions: {
        basis: "publisher_assertion",
        features: [
          "layer_width_sparsity_grid",
          "sparse_autoencoder_parameters",
        ],
      },
      research: {
        basis: "researcher_inference",
        evidence_paper_ids: ["2408.05147"],
        phase: "mechanistic_interpretability",
        payload: "binary_parameters",
        priority: 15,
        primary: "kingdom_registry",
        secondary: ["yutabase_provenance"],
        mode: "deferred_binary_pilot",
        boundaries: [
          "base_model_terms_separate",
          "binary_download_separate_approval",
          "binary_parser_review",
          "bulk_payload_separate_approval",
          "publisher_known_quality_issues",
        ],
        bounded_uses: [
          "metadata_registry",
          "provenance_graph",
          "single_artifact_interpretability_pilot",
        ],
        forbidden_uses: [
          "bulk_download_without_review",
          "license_clearance_inference",
          "truth_or_intent_authority",
          "unsandboxed_archive_extraction",
        ],
      },
    },
    {
      schema: RESEARCH_LEAD_SCHEMA,
      key: "xenia_word_is",
      match: {
        kind: "dataset",
        id: "Yu-and-Ai/xenia-word-is",
        revision: "64e3c4be051b2780409ab25578ea0c8bf926a72a",
        declared: {
          basis: "publisher_assertion",
          license: "apache-2.0",
          gated: false,
          private: false,
        },
      },
      origin_assertions: {
        basis: "publisher_assertion",
        features: ["failure_mode_matrix"],
      },
      research: {
        basis: "researcher_inference",
        evidence_paper_ids: [],
        phase: "agent_trace_sft",
        payload: "conversation_text",
        priority: 16,
        primary: "agenttool_fixture",
        secondary: ["kingdom_registry", "yutabase_provenance"],
        mode: "offline_parser_fixture",
        boundaries: [
          "benchmark_excluded_from_training",
          "synthetic_or_simulated_not_truth",
          "upstream_terms_separate",
        ],
        bounded_uses: [
          "offline_parser_fixture",
          "provenance_graph",
        ],
        forbidden_uses: [
          "benchmark_tuning",
          "license_clearance_inference",
          "retrieval_index_ingestion",
          "sole_evaluator_training",
          "truth_or_intent_authority",
        ],
      },
    },
  ],
  boundary: {
    publisher_metadata: "unverified_assertions",
    research_annotations: "researcher_inference",
    legal_clearance: "not_assessed",
    account_access_state_recorded: false,
    raw_rows_read: false,
    repository_files_downloaded: false,
    gated_terms_accepted: false,
    model_code_executed: false,
    remote_compute_invoked: false,
    hub_write_performed: false,
  },
} as const;

const CURATED_CATALOG = validateHfResearchCatalog(RAW_CATALOG);

export function getCuratedHfResearchCatalog(): HfResearchCatalog {
  return CURATED_CATALOG;
}

export function validateHfResearchCatalog(value: unknown): HfResearchCatalog {
  const catalog = asPlainObject(value, "invalid_research_catalog");
  assertExactKeys(catalog, ["schema", "curated_on", "leads", "boundary"], "invalid_research_catalog");
  invariant(catalog.schema === RESEARCH_CATALOG_SCHEMA, "invalid_research_catalog", "research catalog schema is invalid");
  invariant(
    typeof catalog.curated_on === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(catalog.curated_on),
    "invalid_research_catalog",
    "research catalog date is invalid",
  );
  invariant(Array.isArray(catalog.leads) && catalog.leads.length <= 100, "invalid_research_catalog", "research catalog leads are invalid");
  const leads = catalog.leads.map((lead) => validateHfResearchLead(lead));
  assertUnique(leads.map((lead) => lead.key), "research catalog contains duplicate keys");
  assertUnique(
    leads.map((lead) => `${lead.match.kind}:${lead.match.id}@${lead.match.revision}`),
    "research catalog contains duplicate artifact identities",
  );
  assertUnique(
    leads.map((lead) => String(lead.research.priority)),
    "research catalog contains duplicate priorities",
  );
  for (let index = 1; index < leads.length; index += 1) {
    invariant(
      leads[index - 1]!.research.priority < leads[index]!.research.priority,
      "invalid_research_catalog",
      "research catalog leads must be ordered by priority",
    );
  }

  const boundary = asPlainObject(catalog.boundary, "invalid_research_catalog");
  assertExactKeys(
    boundary,
    [
      "publisher_metadata",
      "research_annotations",
      "legal_clearance",
      "account_access_state_recorded",
      "raw_rows_read",
      "repository_files_downloaded",
      "gated_terms_accepted",
      "model_code_executed",
      "remote_compute_invoked",
      "hub_write_performed",
    ],
    "invalid_research_catalog",
  );
  invariant(
    boundary.publisher_metadata === "unverified_assertions"
      && boundary.research_annotations === "researcher_inference"
      && boundary.legal_clearance === "not_assessed"
      && boundary.account_access_state_recorded === false
      && boundary.raw_rows_read === false
      && boundary.repository_files_downloaded === false
      && boundary.gated_terms_accepted === false
      && boundary.model_code_executed === false
      && boundary.remote_compute_invoked === false
      && boundary.hub_write_performed === false,
    "invalid_research_catalog",
    "research catalog boundary is invalid",
  );

  return deepFreeze({
    schema: RESEARCH_CATALOG_SCHEMA,
    curated_on: catalog.curated_on,
    leads,
    boundary: {
      publisher_metadata: "unverified_assertions",
      research_annotations: "researcher_inference",
      legal_clearance: "not_assessed",
      account_access_state_recorded: false,
      raw_rows_read: false,
      repository_files_downloaded: false,
      gated_terms_accepted: false,
      model_code_executed: false,
      remote_compute_invoked: false,
      hub_write_performed: false,
    },
  });
}

export function validateHfResearchLead(value: unknown): HfResearchLead {
  const lead = asPlainObject(value, "invalid_research_lead");
  assertExactKeys(lead, ["schema", "key", "match", "origin_assertions", "research"], "invalid_research_lead");
  invariant(lead.schema === RESEARCH_LEAD_SCHEMA, "invalid_research_lead", "research lead schema is invalid");
  const key = safeRemoteString(lead.key, 64);
  invariant(key && /^[a-z0-9][a-z0-9_]{0,63}$/u.test(key), "invalid_research_lead", "research lead key is invalid");

  const match = asPlainObject(lead.match, "invalid_research_lead");
  assertExactKeys(match, ["kind", "id", "revision", "declared"], "invalid_research_lead");
  invariant(match.kind === "dataset" || match.kind === "model", "invalid_research_lead", "research lead kind is invalid");
  const rawId = safeRemoteString(match.id, 193);
  invariant(rawId, "invalid_research_lead", "research lead id is invalid");
  const id = normalizeRepoId(match.kind, rawId);
  const revision = normalizeFullSha(match.revision);
  invariant(revision, "invalid_research_lead", "research lead revision is invalid");

  const declared = asPlainObject(match.declared, "invalid_research_lead");
  assertExactKeys(declared, ["basis", "license", "gated", "private"], "invalid_research_lead");
  invariant(declared.basis === "publisher_assertion", "invalid_research_lead", "research lead declaration basis is invalid");
  const license = declared.license === null
    ? null
    : LICENSES.has(declared.license as Exclude<HfCuratedLicense, null>)
      ? declared.license as Exclude<HfCuratedLicense, null>
      : null;
  invariant(declared.license === null || license !== null, "invalid_research_lead", "research lead license declaration is invalid");
  invariant(
    declared.gated === false || declared.gated === "auto" || declared.gated === "manual",
    "invalid_research_lead",
    "research lead gate declaration is invalid",
  );
  invariant(declared.private === false, "invalid_research_lead", "research lead must describe a non-private artifact");

  const origin = asPlainObject(lead.origin_assertions, "invalid_research_lead");
  assertExactKeys(origin, ["basis", "features"], "invalid_research_lead");
  invariant(origin.basis === "publisher_assertion", "invalid_research_lead", "research lead feature basis is invalid");
  const features = enumArray(origin.features, FEATURES, "features", false);

  const research = asPlainObject(lead.research, "invalid_research_lead");
  assertExactKeys(
    research,
    [
      "basis",
      "evidence_paper_ids",
      "phase",
      "payload",
      "priority",
      "primary",
      "secondary",
      "mode",
      "boundaries",
      "bounded_uses",
      "forbidden_uses",
    ],
    "invalid_research_lead",
  );
  invariant(research.basis === "researcher_inference", "invalid_research_lead", "research annotation basis is invalid");
  const evidencePaperIds = stringArray(research.evidence_paper_ids, "evidence_paper_ids", true, 32, 32);
  invariant(
    evidencePaperIds.every((paperId) => /^\d{4}\.\d{4,5}(?:v\d+)?$/u.test(paperId)),
    "invalid_research_lead",
    "research paper id is invalid",
  );
  invariant(PHASES.has(research.phase as HfResearchPhase), "invalid_research_lead", "research phase is invalid");
  invariant(PAYLOAD_CLASSES.has(research.payload as HfResearchPayloadClass), "invalid_research_lead", "research payload class is invalid");
  const payload = research.payload as HfResearchPayloadClass;
  const priority = safeInteger(research.priority);
  invariant(priority !== null && priority > 0 && priority <= 100, "invalid_research_lead", "research priority is invalid");
  invariant(TARGETS.has(research.primary as HfResearchIntegrationTarget), "invalid_research_lead", "research primary target is invalid");
  const secondary = enumArray(research.secondary, TARGETS, "secondary", true);
  invariant(!secondary.includes(research.primary as HfResearchIntegrationTarget), "invalid_research_lead", "research targets overlap");
  invariant(MODES.has(research.mode as HfResearchIntegrationMode), "invalid_research_lead", "research integration mode is invalid");
  const boundaries = enumArray(research.boundaries, BOUNDARIES, "boundaries", false);
  const boundedUses = enumArray(research.bounded_uses, BOUNDED_USES, "bounded_uses", false);
  const forbiddenUses = enumArray(research.forbidden_uses, FORBIDDEN_USES, "forbidden_uses", false);

  for (const [feature, requiredPayload] of FEATURE_PAYLOAD_REQUIREMENTS) {
    if (features.includes(feature)) {
      invariant(
        payload === requiredPayload,
        "invalid_research_lead",
        `publisher feature ${feature} requires payload ${requiredPayload}`,
      );
    }
  }

  if (license === null) {
    requireResearchCodes(
      boundaries,
      ["no_declared_license"],
      "an artifact without a declared license",
    );
    requireResearchCodes(
      forbiddenUses,
      ["license_clearance_inference"],
      "an artifact without a declared license",
    );
  }
  if (declared.gated !== false) {
    requireResearchCodes(
      boundaries,
      ["gated_terms_required"],
      "a gated artifact",
    );
    requireResearchCodes(
      forbiddenUses,
      ["gate_acceptance_by_scout"],
      "a gated artifact",
    );
  }
  if (boundaries.includes("bulk_payload_separate_approval")) {
    requireResearchCodes(
      forbiddenUses,
      ["bulk_download_without_review"],
      "a bulk-payload artifact",
    );
  }
  if (payload === "binary_parameters") {
    requireResearchCodes(
      boundaries,
      [
        "binary_download_separate_approval",
        "binary_parser_review",
        "bulk_payload_separate_approval",
      ],
      "a binary-parameter artifact",
    );
    requireResearchCodes(
      forbiddenUses,
      ["bulk_download_without_review", "unsandboxed_archive_extraction"],
      "a binary-parameter artifact",
    );
  }
  if (payload === "tokenized_corpus") {
    requireResearchCodes(
      boundaries,
      [
        "binary_download_separate_approval",
        "binary_parser_review",
        "bulk_payload_separate_approval",
      ],
      "a tokenized-corpus artifact",
    );
    requireResearchCodes(
      forbiddenUses,
      [
        "bulk_download_without_review",
        "raw_content_persistence",
        "training_corpus_ingestion",
      ],
      "a tokenized-corpus artifact",
    );
  }
  if (payload === "executable_task_bundle") {
    requireResearchCodes(
      boundaries,
      [
        "binary_download_separate_approval",
        "binary_parser_review",
        "bulk_payload_separate_approval",
        "executable_payload_never_execute",
      ],
      "an executable-task artifact",
    );
    requireResearchCodes(
      forbiddenUses,
      ["credential_attachment", "live_tool_execution", "unsandboxed_archive_extraction"],
      "an executable-task artifact",
    );
  }
  if (
    features.includes("multi_source_agent_traces")
    || features.includes("recovery_strategy_variants")
    || features.includes("simulated_tool_trajectories")
    || features.includes("tool_call_and_environment_transcripts")
  ) {
    requireResearchCodes(
      boundaries,
      ["embedded_calls_never_execute"],
      "an embedded-call artifact",
    );
    requireResearchCodes(
      forbiddenUses,
      ["credential_attachment", "live_tool_execution"],
      "an embedded-call artifact",
    );
  }

  return deepFreeze({
    schema: RESEARCH_LEAD_SCHEMA,
    key,
    match: {
      kind: match.kind,
      id,
      revision,
      declared: {
        basis: "publisher_assertion",
        license,
        gated: declared.gated,
        private: false,
      },
    },
    origin_assertions: {
      basis: "publisher_assertion",
      features,
    },
    research: {
      basis: "researcher_inference",
      evidence_paper_ids: evidencePaperIds,
      phase: research.phase as HfResearchPhase,
      payload,
      priority,
      primary: research.primary as HfResearchIntegrationTarget,
      secondary,
      mode: research.mode as HfResearchIntegrationMode,
      boundaries,
      bounded_uses: boundedUses,
      forbidden_uses: forbiddenUses,
    },
  });
}

export function bindHfResearchLead(
  report: HfScoutReport,
  value: unknown,
): HfResearchBinding {
  const lead = validateHfResearchLead(value);
  const request = projectAgentDataTextRequest(report);
  const snapshot = JSON.parse(request.input.text) as HfArtifactSnapshot;
  invariant(snapshot.subject.kind === lead.match.kind, "research_kind_mismatch", "research lead kind does not match the report");
  invariant(snapshot.subject.id === lead.match.id, "research_id_mismatch", "research lead id does not match the report");
  invariant(
    snapshot.revision.requested_full_sha === lead.match.revision
      && snapshot.revision.resolved_full_sha === lead.match.revision,
    "research_revision_mismatch",
    "research lead revision does not match the exact report",
  );
  invariant(snapshot.declared.license === lead.match.declared.license, "research_license_mismatch", "research lead license declaration does not match the report");
  invariant(snapshot.declared.gated === lead.match.declared.gated, "research_gate_mismatch", "research lead gate declaration does not match the report");
  invariant(snapshot.declared.private === false, "research_private_mismatch", "research lead report is not explicitly non-private");
  for (const boundary of [
    "publisher_metadata_unverified",
    "scout_files_not_downloaded",
    "scout_model_code_not_executed",
  ] as const) {
    invariant(snapshot.boundary_codes.includes(boundary), "research_boundary_mismatch", `research report is missing ${boundary}`);
  }
  if (lead.match.declared.license === null) {
    invariant(snapshot.boundary_codes.includes("license_unknown"), "research_boundary_mismatch", "research report does not preserve its unknown-license boundary");
  }
  const curatedLead = CURATED_CATALOG.leads.find((entry) => entry.key === lead.key);
  invariant(
    curatedLead,
    "research_definition_unknown",
    "research lead key is not present in the curated catalog",
  );
  invariant(
    canonicalJson(lead) === canonicalJson(curatedLead),
    "research_definition_mismatch",
    "research lead does not match its curated definition",
  );

  return deepFreeze({
    schema: RESEARCH_BINDING_SCHEMA,
    lead_key: lead.key,
    artifact: {
      kind: lead.match.kind,
      id: lead.match.id,
      revision: lead.match.revision,
    },
    definition_sha256: sha256Hex(canonicalJson(curatedLead)),
    snapshot_sha256: request.input.metadata.snapshot_sha256,
    observation: {
      transport: snapshot.observation.transport,
      repository_association: snapshot.observation.repository_association,
      provenance_grade: snapshot.observation.transport === "public_hub_api"
        ? "provider_observed_commit_metadata"
        : "caller_supplied_commit_metadata",
    },
    matched_declared: {
      basis: "publisher_assertion",
      license: lead.match.declared.license,
      gated: lead.match.declared.gated,
      private: false,
    },
    boundary: {
      publisher_metadata: "matched_unverified_assertion",
      research_annotation: "researcher_inference",
      legal_clearance: "not_assessed",
      gate_acceptance: "not_assessed",
      raw_rows_read: false,
      repository_files_downloaded: false,
      model_code_executed: false,
      remote_compute_invoked: false,
      hub_write_performed: false,
    },
  });
}

export function selectHfResearchLeads(
  options: {
    phase?: HfResearchPhase;
    target?: HfResearchIntegrationTarget;
  } = {},
): readonly HfResearchLead[] {
  if (options.phase !== undefined) {
    invariant(PHASES.has(options.phase), "invalid_research_filter", "research phase filter is invalid");
  }
  if (options.target !== undefined) {
    invariant(TARGETS.has(options.target), "invalid_research_filter", "research target filter is invalid");
  }
  return deepFreeze(CURATED_CATALOG.leads.filter((lead) =>
    (options.phase === undefined || lead.research.phase === options.phase)
      && (options.target === undefined
        || lead.research.primary === options.target
        || lead.research.secondary.includes(options.target)),
  ));
}

export function pinnedHfResearchLeadUrl(lead: HfResearchLead): string {
  const segment = lead.match.kind === "dataset" ? "datasets/" : "";
  return `https://huggingface.co/${segment}${lead.match.id}/tree/${lead.match.revision}`;
}

export function hfResearchPaperUrls(lead: HfResearchLead): readonly string[] {
  return deepFreeze(lead.research.evidence_paper_ids.map((paperId) => `https://arxiv.org/abs/${paperId}`));
}

export function formatHfResearchLeads(leads: readonly HfResearchLead[]): string {
  const lines = [
    `HF research treasures — ${leads.length} pinned leads`,
    "Publisher metadata is unverified; research phase and integration are researcher inference.",
  ];
  for (const lead of leads) {
    lines.push(
      "",
      `${lead.research.priority}. ${lead.key}`,
      `  artifact: ${lead.match.kind}:${lead.match.id}@${lead.match.revision}`,
      `  phase: ${lead.research.phase} | payload: ${lead.research.payload}`,
      `  route: ${[lead.research.primary, ...lead.research.secondary].join(", ")}`,
      `  signals: ${lead.origin_assertions.features.join(", ")}`,
      `  bounded: ${lead.research.bounded_uses.join(", ")}`,
      `  forbidden: ${lead.research.forbidden_uses.join(", ")}`,
    );
  }
  return lines.join("\n");
}

function enumArray<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string,
  mayBeEmpty: boolean,
): T[] {
  const output = stringArray(value, label, mayBeEmpty, 100, 128);
  invariant(output.every((entry): entry is T => allowed.has(entry as T)), "invalid_research_lead", `research ${label} contains an unsupported value`);
  return output;
}

function stringArray(
  value: unknown,
  label: string,
  mayBeEmpty: boolean,
  maxItems: number,
  maxLength: number,
): string[] {
  invariant(
    Array.isArray(value)
      && value.length <= maxItems
      && (mayBeEmpty || value.length > 0),
    "invalid_research_lead",
    `research ${label} is invalid`,
  );
  const output = value.map((entry) => {
    const text = safeRemoteString(entry, maxLength);
    invariant(text, "invalid_research_lead", `research ${label} is invalid`);
    return text;
  });
  for (let index = 1; index < output.length; index += 1) {
    invariant(
      compareUnicode(output[index - 1]!, output[index]!) < 0,
      "invalid_research_lead",
      `research ${label} must be sorted and unique`,
    );
  }
  return output;
}

function assertUnique(values: readonly string[], message: string): void {
  invariant(new Set(values).size === values.length, "invalid_research_catalog", message);
}

function requireResearchCodes<T extends string>(
  actual: readonly T[],
  required: readonly T[],
  subject: string,
): void {
  const missing = required.filter((code) => !actual.includes(code));
  invariant(
    missing.length === 0,
    "invalid_research_lead",
    `${subject} is missing required safety codes: ${missing.join(", ")}`,
  );
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
