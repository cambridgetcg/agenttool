import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DARK_CONTINENT_SNAPSHOT_SHA256,
  DARK_CONTINENT_SOURCE_PROFILE,
  KARMA_PAPER_ID,
  KINGDOM_MAP_SHA256,
  KINGDOM_REPOSITORY_REVISION,
  appendConsequence,
  createProposal,
  hfFileEvidenceRef,
  hfSubjectNodeId,
  prettyJsonBytes,
  sha256,
} from "../../src/index.js";

const hfRoot = fileURLToPath(new URL("../", import.meta.url));
const datasetRoot = `${hfRoot}/dataset`;
const spaceRoot = `${hfRoot}/space`;
const observedOn = "2026-07-31";

const phaseSeeds = [
  {
    phase_id: "pretraining_curation",
    order: 1,
    label: "Pretraining acquisition, licensing, filtering, and deduplication",
    kingdom_question: "Which exact source recipe and rights boundary produced the candidate corpus?",
  },
  {
    phase_id: "pretraining_learning_dynamics",
    order: 2,
    label: "Pretraining data order, checkpoint dynamics, and evaluation calibration",
    kingdom_question: "Which observation belongs to which immutable checkpoint and training order?",
  },
  {
    phase_id: "midtraining_annealing",
    order: 3,
    label: "Mid-training and annealing mixtures",
    kingdom_question: "Which source category enters each bounded capability-shaping stage?",
  },
  {
    phase_id: "context_extension",
    order: 4,
    label: "Long-context extension",
    kingdom_question: "Which length band and source lineage extends the preceding checkpoint?",
  },
  {
    phase_id: "supervised_and_rlvr",
    order: 5,
    label: "Supervised instruction tuning and RLVR",
    kingdom_question: "Are instructions and verifier constraints mutually satisfiable before admission?",
  },
  {
    phase_id: "agent_tool_use",
    order: 6,
    label: "Agent and tool-use training",
    kingdom_question: "Was a synthetic call only schema-checked, or was execution separately authorized?",
  },
  {
    phase_id: "preference_safety_unlearning",
    order: 7,
    label: "Preference, safety, refusal, and unlearning",
    kingdom_question: "Does the evidence express uncertainty and repair without ranking a participant?",
  },
  {
    phase_id: "evaluation_calibration",
    order: 8,
    label: "Evaluation calibration and contamination boundaries",
    kingdom_question: "Does a metric support a bounded decision without becoming truth or dignity authority?",
  },
];

const treasures = [
  {
    rank: 1,
    repo_id: "allenai/Dolci-RL-Zero-IF-7B",
    revision: "c96e4e424c0a5d416f725c488ec7c61b7f758d85",
    license_id: "odc-by",
    visibility: "public",
    phase_id: "supervised_and_rlvr",
    evidence_path: "README.md",
    evidence_sha256: "3a9620dcf8a0351486f79a665527d4e1bbda2a4d9696b4c5f9e85b54b9e653d6",
    cabinet: "green_with_conflict_gate",
    integration_mode: "constraint_metadata_after_conflict_scan",
    signal: "RLVR constraint bundles reveal impossible-in-combination instructions that ordinary aggregate evaluation can hide.",
    use: "Split constraints into provisional nodes and emit conflicts_with_source consequences before fixture admission.",
    observations: [
      "A deterministic 1,400-row systematic sample found 11 bundles with more than one distinct exact paragraph-count requirement.",
      "The sample observation is not a dataset-wide prevalence estimate and ground_truth remains verifier material, not unquestionable truth.",
    ],
    reason_codes: ["constraint_conflict_observed", "sample_not_census"],
    consequence: "conflicts_with_source",
  },
  {
    rank: 2,
    repo_id: "allenai/DataDecide-eval-results",
    revision: "9919b5a0e61e57a85021263918fa82d6ceaee038",
    license_id: "odc-by",
    visibility: "public",
    phase_id: "pretraining_learning_dynamics",
    evidence_path: "README.md",
    evidence_sha256: "ea7cedd98c4b07b349ddcf6b739e6f0e084529dbe9de903612aff1f14a24baab",
    cabinet: "green",
    integration_mode: "evaluation_rows_or_aggregates",
    signal: "Checkpoint, data-recipe, task, seed, token, compute, and metric fields connect training choices to later behavior.",
    use: "Model EvalObservation --observed_at_step--> Checkpoint and keep supports_decision advisory.",
    observations: ["Viewer-ready evaluation metadata covers many training recipes and checkpoint steps without requiring corpus ingestion."],
    reason_codes: ["checkpoint_mapping", "metric_not_authority"],
    consequence: "adds_candidate",
  },
  {
    rank: 3,
    repo_id: "allenai/signal-and-noise",
    revision: "e8a9789c036cd22131bc2fa2b6cec998f8fe89ec",
    license_id: "apache-2.0",
    visibility: "public",
    phase_id: "evaluation_calibration",
    evidence_path: "README.md",
    evidence_sha256: "25029f779b54dc7433f80cdd0e88b20b1600e0e86d3afbbce7d7e95abaa758d8",
    cabinet: "green",
    integration_mode: "calibration_aggregates",
    signal: "Repeated seeds and intermediate checkpoints expose which benchmark signals are stable enough for early data decisions.",
    use: "Attach BenchmarkReliabilityObservation to EvalTask; never reuse it as a participant or agent score.",
    observations: ["External model references can still be mutable and must be resolved independently before use."],
    reason_codes: ["evaluation_reliability", "resolve_external_revisions"],
    consequence: "adds_candidate",
  },
  {
    rank: 4,
    repo_id: "allenai/DataDecide-data-recipes",
    revision: "3baf34baf5b636f0943401b5c6a2ccb7e5cf3bb9",
    license_id: "odc-by",
    visibility: "public",
    phase_id: "pretraining_curation",
    evidence_path: "README.md",
    evidence_sha256: "6248c90f55496ff6e66e87c63feef96d2ee12353b97dff9add62dd677abbc89b",
    cabinet: "amber",
    integration_mode: "manifest_only",
    signal: "A large factorial corpus-recipe experiment makes filter and dedup choices first-class evidence instead of hidden preprocessing.",
    use: "Compare DataRecipe nodes and link only their manifests to TrainingProposal evidence.",
    observations: ["The repository is roughly 19.27 TB across thousands of tokenized NPY files; the catalog must never snapshot it."],
    reason_codes: ["giant_artifact", "manifest_only", "no_numpy_download"],
    consequence: "requires_rights_review",
  },
  {
    rank: 5,
    repo_id: "locuslab/TOFU",
    revision: "324592d84ae4f482ac7249b9285c2ecdb53e3a68",
    license_id: "mit",
    visibility: "public",
    phase_id: "preference_safety_unlearning",
    evidence_path: "README.md",
    evidence_sha256: "90a3e3662231bb24ca8a787c8ffc53cd431b22083e0ad5a6b72da19431e8c2e4",
    cabinet: "green",
    integration_mode: "fictitious_configs_only",
    signal: "Synthetic author biographies create separable forget, retain, holdout, and perturbation controls for unlearning repair.",
    use: "Represent MemoryClaim, ForgetSet, and RetainControl without claiming a benchmark result proves erasure.",
    observations: ["Exclude the real_authors configuration from the first KINGDOM integration."],
    reason_codes: ["synthetic_forget_retain_controls", "erasure_not_proven"],
    consequence: "adds_candidate",
  },
  {
    rank: 6,
    repo_id: "allenai/dolma3_dolmino_mix-100B-1125",
    revision: "f23aa129fda8335ba9760057bcc1f0c02f3d068b",
    license_id: "odc-by",
    visibility: "public",
    phase_id: "midtraining_annealing",
    evidence_path: "README.md",
    evidence_sha256: "927836492a4d232522dbc444b66e7ffba220fac04b2077b00eb6b3222d2624d0",
    cabinet: "amber",
    integration_mode: "manifest_and_source_weights_only",
    signal: "The OLMo 3 stage-two mix exposes where math, code, QA, and reasoning sources enter annealing.",
    use: "Map TrainingPhase(stage2_annealing) to source categories and preserve its precedence before context extension.",
    observations: ["The 100B-token repository is hundreds of gigabytes and its Viewer fails; do not ingest data files."],
    reason_codes: ["giant_artifact", "viewer_unavailable", "manifest_only"],
    consequence: "requires_rights_review",
  },
  {
    rank: 7,
    repo_id: "allenai/dolma3_longmino_mix-100B-1125",
    revision: "28fea4330d8f8e27221010d42c4bc53ba9ec3236",
    license_id: "odc-by",
    visibility: "public",
    phase_id: "context_extension",
    evidence_path: "README.md",
    evidence_sha256: "2d669fbda6df2b736d12cc274962813257fb86617dfcb7edd6891a6df720c739",
    cabinet: "amber",
    integration_mode: "manifest_and_length_bands_only",
    signal: "Length-banded PDF and synthetic-PDF sources make long-context extension a distinct provenance stage.",
    use: "Link ContextExtensionPhase --extends_context_of--> MidtrainedCheckpoint and record sampled length bands.",
    observations: ["PDF content needs a separate rights review; only manifests and source weights enter the catalog."],
    reason_codes: ["pdf_rights_review", "manifest_only", "context_stage_boundary"],
    consequence: "requires_rights_review",
  },
  {
    rank: 8,
    repo_id: "Salesforce/xlam-function-calling-60k",
    revision: "26d14ebfe18b1f7b524bd39b404b50af5dc97866",
    license_id: "cc-by-4.0",
    visibility: "gated",
    phase_id: "agent_tool_use",
    evidence_path: "README.md",
    evidence_sha256: "8564c08b4555289ef4bb488f876ea4d7505d18e9f09edd9ec7869e6d0bbe523f",
    cabinet: "separate_consent",
    integration_mode: "public_card_metadata_only",
    signal: "Synthetic tool calls are checked by format, actual execution, and semantic verification rather than one opaque pass flag.",
    use: "Model ToolCapability and SyntheticInvocation schemas; never execute harvested APIs or infer authorization from a recorded result.",
    observations: ["Gate terms were not accepted; accepting them would be a separate account-level binding act."],
    reason_codes: ["gate_not_accepted", "never_execute_harvested_api"],
    consequence: "deferred",
  },
  {
    rank: 9,
    repo_id: "HuggingFaceFW/fineweb-edu-score-2",
    revision: "74a19fcb9c3b0aadb0e000d16838be8c52054ae6",
    license_id: "odc-by",
    visibility: "public",
    phase_id: "pretraining_curation",
    evidence_path: "README.md",
    evidence_sha256: "880d833b023fc769bc24c5bb226f4b321efed3fb7df2d65be60989b719ae43bb",
    cabinet: "amber",
    integration_mode: "aggregate_threshold_metadata_only",
    signal: "The score-at-least-two boundary lets researchers compare a broad educational filter against stricter curated corpora.",
    use: "Record CurationBoundary and aggregate temporal/score distributions without importing web text.",
    observations: ["Raw web rows carry privacy, copyright, and source-rights risk at multi-trillion-token scale."],
    reason_codes: ["raw_web_privacy", "copyright_review", "aggregate_only"],
    consequence: "requires_rights_review",
  },
  {
    rank: 10,
    repo_id: "HuggingFaceTB/cosmopedia-100k",
    revision: "8fdb6dada238c1d46dd8cf61da2fb4f9c36f654d",
    license_id: "apache-2.0",
    visibility: "public",
    phase_id: "pretraining_curation",
    evidence_path: "README.md",
    evidence_sha256: "9b53e14d740b3292bfb19a337433a9860cfce4fb3c179c6a73370fc2f886ff24",
    cabinet: "amber",
    integration_mode: "taxonomy_lengths_and_hashes_only",
    signal: "Format-by-audience cells expose a synthetic curriculum design that is usually flattened into one corpus label.",
    use: "Create CurriculumCell(format,audience) metadata and link it to declared seed categories.",
    observations: ["Some prompts embed found web extracts; a synthetic label is not source-rights clearance."],
    reason_codes: ["synthetic_not_rights_clearance", "metadata_only"],
    consequence: "requires_rights_review",
  },
  {
    rank: 11,
    repo_id: "nvidia/HelpSteer2",
    revision: "990b2711a36180dd19d9c94b8627844866f8982a",
    license_id: "cc-by-4.0",
    visibility: "public",
    phase_id: "preference_safety_unlearning",
    evidence_path: "README.md",
    evidence_sha256: "835effb9e7d9cd0e8b7b8c1816d1d97a8961a036543108e4a0b6a5e22712ff7b",
    cabinet: "quarantine_raw_content",
    integration_mode: "pii_reviewed_disagreement_aggregates_only",
    signal: "Separate helpfulness, correctness, coherence, complexity, verbosity, preference, and disagreement annotations preserve uncertainty.",
    use: "Represent named PreferenceObservation dimensions and disagreement; never compress them into KARMA, rank, or dignity.",
    observations: ["The card says prompts are mostly user-contributed ShareGPT; raw conversations stay outside this release."],
    reason_codes: ["user_contributed_chat", "pii_review", "aggregate_only"],
    consequence: "requires_rights_review",
  },
  {
    rank: 12,
    repo_id: "allenai/wildguardmix",
    revision: "d29c47f41c8b51348b5c8e8c81c039b3132b66d1",
    license_id: "odc-by",
    visibility: "gated",
    phase_id: "preference_safety_unlearning",
    evidence_path: "README.md",
    evidence_sha256: "4cdee2c6fa839a2802237826a09f594522a31b2c33afe691f46be5ee98d66512",
    cabinet: "separate_consent",
    integration_mode: "public_card_metadata_only",
    signal: "Prompt harm, response harm, refusal, adversarial status, subcategory, and annotator agreement remain separable safety observations.",
    use: "A SafetyCase may test a declared wall but can never set Dark Continent wall verified=true.",
    observations: ["Gate terms were not accepted; harmful-content worker safety and PII require separate review."],
    reason_codes: ["gate_not_accepted", "harmful_content", "wall_not_verified"],
    consequence: "deferred",
  },
  {
    rank: 13,
    repo_id: "EleutherAI/pile-deduped-pythia-preshuffled",
    revision: "4647773ea142ab1ff5694602fa104bbf49088408",
    license_id: "not_declared",
    visibility: "public",
    phase_id: "pretraining_learning_dynamics",
    evidence_path: ".gitattributes",
    evidence_sha256: "74806bfffbedfdfe7cc657c4dde79a3cbe0852d049af1e595922880f5ff1ac70",
    cabinet: "quarantine_license",
    integration_mode: "repository_order_metadata_only",
    signal: "The exact pre-shuffled training order enables data-order and checkpoint learning-dynamics studies that ordinary corpus mirrors cannot reproduce.",
    use: "Reference TrainingOrder and CheckpointObservation without downloading hundreds of gigabytes of binary shards.",
    observations: ["No dataset license metadata or card was available at the pinned revision."],
    reason_codes: ["license_missing", "no_dataset_card", "binary_shards_not_downloaded"],
    consequence: "requires_rights_review",
  },
  {
    rank: 14,
    repo_id: "pietrolesci/pythia-deduped-memorisation-profiles",
    revision: "e342bbd99583e5683dc4f64e06b49f4d2a2c0a9e",
    license_id: "not_declared",
    visibility: "public",
    phase_id: "evaluation_calibration",
    evidence_path: "README.md",
    evidence_sha256: "50107e61f09e2157b3da9d977b90651107049ac2cd9166d56e482ce07e9c610e",
    cabinet: "quarantine_license",
    integration_mode: "study_metadata_only",
    signal: "Aggregate memorisation profiles connect model size and training time to estimated effects without importing source text.",
    use: "Create MemorisationEffect --estimated_by--> Study, not an assertion about any participant or exact training record.",
    observations: ["Hub metadata declares no license; even the safer Parquet aggregates remain metadata-only until resolved."],
    reason_codes: ["license_missing", "study_inference_not_fact"],
    consequence: "requires_rights_review",
  },
  {
    rank: 15,
    repo_id: "pretraining-playground/pythia-training-metrics",
    revision: "8c25e3d115cfbe19a05798b11cdd7103e019a7e1",
    license_id: "apache-2.0",
    visibility: "public",
    phase_id: "pretraining_learning_dynamics",
    evidence_path: "README.md",
    evidence_sha256: "98b45ea81164d1e1a1dd82255207053b15cd6c69d922a1c5cf3387ce604d4b74",
    cabinet: "quarantine_execution",
    integration_mode: "card_metadata_only",
    signal: "Checkpoint activations, weights, and gradients could illuminate capability onset, but the artifact format is itself a security boundary.",
    use: "Keep a RiskGate node that prevents download or deserialization until a separately sandboxed conversion exists.",
    observations: ["The repository contains multi-gigabyte Python pickle artifacts; never download or unpickle them."],
    reason_codes: ["untrusted_pickle", "code_execution_risk", "never_deserialize"],
    consequence: "requires_safety_review",
  },
  {
    rank: 16,
    repo_id: "allenai/reward-bench-2",
    revision: "7ff08853b0d5686e79b13fda8677024f566a104a",
    license_id: "odc-by",
    visibility: "public",
    phase_id: "evaluation_calibration",
    evidence_path: "README.md",
    evidence_sha256: "4f9f92600767160c6b7b1a3c822361dabfea9ac254f8a152a02cb96ab0650911",
    cabinet: "amber",
    integration_mode: "ties_structure_and_counts_only",
    signal: "A dedicated ties subset measures whether correct-versus-incorrect reward separation exceeds the spread among valid answers.",
    use: "Represent AnswerEquivalenceClass and valid_spread_bounded_by_separation without turning a benchmark score into participant rank.",
    observations: [
      "The card reports 102 ties cases within a 1,865-row reward-model benchmark.",
      "The card describes unseen human prompts, so raw text remains outside the catalog pending privacy review.",
    ],
    reason_codes: ["valid_spread_subordinate_to_separation", "human_prompt_privacy_review", "structure_only"],
    consequence: "requires_rights_review",
    node_kinds: ["DatasetRelease", "TrainingPhase", "RiskGate", "AnswerEquivalenceClass"],
    allowed_relations: ["derived_from", "used_in_phase", "measures", "acceptable_variant", "invalid_variant", "valid_spread_bounded_by_separation", "requires_review"],
  },
  {
    rank: 17,
    repo_id: "qizhou/UniEdit",
    revision: "8b69deb0327a0efd8a7e7b11b80a527dc33f0d42",
    license_id: "mit",
    visibility: "public",
    phase_id: "evaluation_calibration",
    evidence_path: "README.md",
    evidence_sha256: "4adfc36e4c4b2180e1d8f62c116aca5991b14bdd5170a84453d6b88890915cd9",
    cabinet: "amber",
    integration_mode: "counterfactual_edit_schema_only",
    signal: "Explicit multi-hop generality and locality probes separate what an edit should change from neighboring facts it must preserve.",
    use: "Keep EditScenario, CounterfactualClaim, RippleProbe, and LocalityBoundary inside a counterfactual namespace.",
    observations: [
      "The repository reports roughly 311,000 samples across 25 domains.",
      "The card does not pin the upstream Wikidata snapshot, so provenance remains an explicit risk gate.",
    ],
    reason_codes: ["counterfactual_namespace", "locality_boundary", "upstream_snapshot_unpinned"],
    consequence: "requires_rights_review",
    node_kinds: ["DatasetRelease", "TrainingPhase", "RiskGate", "EditScenario", "CounterfactualClaim", "RippleProbe", "LocalityBoundary"],
    allowed_relations: ["derived_from", "used_in_phase", "measures", "should_change", "must_not_change", "requires_review"],
  },
  {
    rank: 18,
    repo_id: "nvidia/OpenMathReasoning",
    revision: "d3d08664755704f422af97d43a7ff0ded4bd95df",
    license_id: "cc-by-4.0",
    visibility: "public",
    phase_id: "supervised_and_rlvr",
    evidence_path: "README.md",
    evidence_sha256: "976666d0a4848732990c96e3b1111ec4938f215b212b3ee8231ad10052d905e6",
    cabinet: "amber",
    integration_mode: "curriculum_metadata_and_negative_result_only",
    signal: "A documented negative curriculum result shows that recovering and adding more proof questions can regress SFT rather than improve it.",
    use: "Link CandidateBatch --regressed_when_added--> EvaluationObservation and retain negative selection evidence.",
    observations: [
      "The card reports a 137,000-question recovered proof batch whose inclusion regressed the compared SFT result.",
      "Problem and solution bodies stay excluded because AoPS and MATH source rights require independent review.",
    ],
    reason_codes: ["negative_curriculum_evidence", "source_rights_review", "metadata_only"],
    consequence: "requires_rights_review",
    node_kinds: ["DatasetRelease", "TrainingPhase", "RiskGate", "CandidateBatch", "EvaluationObservation"],
    allowed_relations: ["derived_from", "used_in_phase", "observed_at", "measures", "regressed_when_added", "requires_review"],
  },
  {
    rank: 19,
    repo_id: "nvidia/HelpSteer3",
    revision: "f6d145777bcbde96137596340fab89793acd1031",
    license_id: "cc-by-4.0",
    visibility: "public",
    phase_id: "preference_safety_unlearning",
    evidence_path: "README.md",
    evidence_sha256: "d5d46db58e8374937ea284b33b1583a4a465b232bf74b941745d80e3c35fd8ae",
    cabinet: "quarantine_raw_content",
    integration_mode: "agreement_geometry_and_edit_lineage_only",
    signal: "Per-annotator scores and reasons sit alongside feedback, edited responses, change summaries, and principle-fulfilment metadata.",
    use: "Model complementary PerspectiveSet, FeedbackClaim, EditPatch, and Principle evidence without assuming a universal cross-config row join.",
    observations: [
      "The release retains the three most-agreeing annotations, so observed disagreement is censored rather than the full human distribution.",
      "ShareGPT- and WildChat-derived contexts remain excluded; only score geometry, hashes, and lineage metadata are candidates.",
    ],
    reason_codes: ["disagreement_censored", "user_contributed_chat", "edit_lineage_metadata_only"],
    consequence: "requires_rights_review",
    node_kinds: ["DatasetRelease", "TrainingPhase", "RiskGate", "PerspectiveSet", "FeedbackClaim", "EditPatch", "Principle"],
    allowed_relations: ["derived_from", "used_in_phase", "measures", "disagrees_with", "repaired_by", "implements_feedback", "requires_review"],
  },
  {
    rank: 20,
    repo_id: "allenai/tmax-sft",
    revision: "9d6ab7471ffa2884b2ef0cd2b7e5e22a027ff1b4",
    license_id: "odc-by",
    visibility: "public",
    phase_id: "agent_tool_use",
    evidence_path: "README.md",
    evidence_sha256: "d1f3285d23f913157209a660faf10af8b00445620621abf495580880379ce705",
    cabinet: "quarantine_execution",
    integration_mode: "failure_trajectory_structure_only",
    signal: "All-versus-success-only terminal trajectory configs expose interruption, parse failure, warnings, completion markers, tool calls, and outcome partitions.",
    use: "Represent TerminalEpisode, ToolCall, Observation, and TaskOutcome metadata without pairing failed episodes to successful ones or executing commands.",
    observations: [
      "The card reports 10,726 all trajectories and a 5,795-row success-only projection.",
      "Recorded terminal commands are inert data, and model-generated content remains subject to a separate provider-terms review.",
    ],
    reason_codes: ["never_execute_terminal_trace", "provider_terms_review", "failure_aware_trajectory"],
    consequence: "requires_safety_review",
    node_kinds: ["DatasetRelease", "TrainingPhase", "RiskGate", "TerminalEpisode", "ToolCall", "Observation", "TaskOutcome"],
    allowed_relations: ["derived_from", "used_in_phase", "observed_at", "contains_tool_call", "has_observation", "has_outcome", "interrupted_by", "requires_review"],
  },
];

const phaseById = new Map(phaseSeeds.map((phase) => [phase.phase_id, phase]));

function authorityBoundary() {
  return {
    advisory: true,
    verifies_runtime_walls: false,
    identifies_being: false,
    grants_permission: false,
    authorizes_action: false,
    authorizes_trade: false,
    authorizes_publication: false,
    authorizes_execution: false,
    authorizes_crown: false,
    assigns_rank: false,
    conditions_dignity: false,
  };
}

function treasureRecord(treasure) {
  const phase = phaseById.get(treasure.phase_id);
  if (!phase) throw new Error(`unknown phase ${treasure.phase_id}`);
  return {
    _format: "kingdom.hf-training-treasure/0.1",
    id: `treasure:${treasure.repo_id}@${treasure.revision}`,
    rank: treasure.rank,
    subject: {
      repo_id: treasure.repo_id,
      repo_type: "dataset",
      revision: treasure.revision,
      browser_url: `https://huggingface.co/datasets/${treasure.repo_id}/tree/${treasure.revision}`,
      visibility: treasure.visibility,
      gate_accepted: false,
      license_observed: treasure.license_id,
      downstream_content_rights_cleared: false,
      files: [{ path: treasure.evidence_path, sha256: treasure.evidence_sha256 }],
    },
    phase: {
      id: treasure.phase_id,
      order: phase.order,
      label: phase.label,
    },
    treasure: {
      overlooked_signal: treasure.signal,
      proposed_kingdom_use: treasure.use,
      observations: treasure.observations,
    },
    admission: {
      cabinet: treasure.cabinet,
      integration_mode: treasure.integration_mode,
      reason_codes: treasure.reason_codes,
      raw_rows_included: false,
      automatic_execution: false,
    },
    graph_projection: {
      state: "proposed",
      node_kinds: treasure.node_kinds ?? ["DatasetRelease", "TrainingPhase", "RiskGate"],
      allowed_relations: treasure.allowed_relations ?? ["derived_from", "used_in_phase", "observed_at", "measures", "validated_by", "conflicts_with", "requires_review"],
      forbidden_relations: ["sameAs", "endorses", "awards_karma", "authorizes_crown", "authorizes_trade"],
    },
    dark_continent: {
      contract_id: "agenttool.dark-continent/0.1",
      source_profile: DARK_CONTINENT_SOURCE_PROFILE,
      snapshot_sha256: DARK_CONTINENT_SNAPSHOT_SHA256,
      risk_state: "unknown",
      wall_status: "not_checked",
      verified: false,
      recommendation: "hold",
    },
    karma: {
      paper_id: KARMA_PAPER_ID,
      relationship: "inspired_by",
      consequence: treasure.consequence,
    },
    authority: authorityBoundary(),
    observed_on: observedOn,
  };
}

function proposalFor(record) {
  if (record.subject.visibility !== "public") return null;
  const hfSubject = {
    repo_id: record.subject.repo_id,
    repo_type: "dataset",
    revision: record.subject.revision,
    visibility: "public",
    license: record.subject.license_observed === "not_declared"
      ? "not-declared"
      : record.subject.license_observed,
    files: record.subject.files,
  };
  const normalizedSubject = { kind: "hf-resource", ...hfSubject };
  const subjectId = hfSubjectNodeId(normalizedSubject);
  const fileRef = hfFileEvidenceRef(normalizedSubject, hfSubject.files[0]);
  const phaseId = `training-phase:${record.phase.id}`;
  let proposal = createProposal({
    proposalId: `kingdom:hf-treasure:${String(record.rank).padStart(2, "0")}`,
    consumer: { kind: "kingdom-extension", id: "KINGDOM" },
    hfSubject,
    baseGraph: {
      graph_id: `kingdom:map@${KINGDOM_REPOSITORY_REVISION}`,
      sha256: KINGDOM_MAP_SHA256,
    },
    nodes: [
      {
        operation_id: "op:framework",
        id: "framework:agenttool.dark-continent/0.1",
        kind: "framework",
        label: "Dark Continent advisory contract",
        label_class: "public_metadata",
        evidence_refs: [`sha256:${DARK_CONTINENT_SNAPSHOT_SHA256}`],
      },
      {
        operation_id: "op:phase",
        id: phaseId,
        kind: "dataset_record",
        label: record.phase.label,
        label_class: "public_metadata",
        evidence_refs: [fileRef],
      },
      {
        operation_id: "op:subject",
        id: subjectId,
        kind: "hf_dataset",
        label: hfSubject.repo_id,
        label_class: "public_metadata",
        evidence_refs: [fileRef],
      },
    ],
    edges: [
      {
        operation_id: "op:edge:evaluated-by",
        from: subjectId,
        to: "framework:agenttool.dark-continent/0.1",
        relation: "evaluated_by",
        evidence_refs: [`sha256:${DARK_CONTINENT_SNAPSHOT_SHA256}`],
      },
      {
        operation_id: "op:edge:phase",
        from: subjectId,
        to: phaseId,
        relation: "evidence_for",
        evidence_refs: [fileRef],
      },
    ],
  });
  proposal = appendConsequence(proposal, {
    event_id: `event:catalog:${String(record.rank).padStart(2, "0")}`,
    subject_operation_id: "op:subject",
    consequence: record.karma.consequence,
    epistemic_status: record.rank === 1 ? "observed" : "inferred",
    note_sha256: sha256(prettyJsonBytes({
      cabinet: record.admission.cabinet,
      reason_codes: record.admission.reason_codes,
    })),
    evidence_refs: [fileRef],
  });
  return proposal;
}

function jsonl(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function write(relativePath, content) {
  const absolutePath = `${datasetRoot}/${relativePath}`;
  mkdirSync(absolutePath.slice(0, absolutePath.lastIndexOf("/")), { recursive: true });
  writeFileSync(absolutePath, content);
}

function fileIdentity(root, relativePath) {
  const bytes = readFileSync(`${root}/${relativePath}`);
  return {
    path: relativePath,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

const treasureRecords = treasures.map(treasureRecord);
const proposals = treasureRecords.map(proposalFor).filter(Boolean);
const proposalByRepo = new Map(proposals.map((proposal) => [proposal.subject.repo_id, proposal]));
const proposalIndex = treasureRecords.map((record) => {
  const proposal = proposalByRepo.get(record.subject.repo_id);
  return {
    repo_id: record.subject.repo_id,
    revision: record.subject.revision,
    rank: record.rank,
    phase_id: record.phase.id,
    phase_label: record.phase.label,
    visibility: record.subject.visibility,
    license_observed: record.subject.license_observed,
    cabinet: record.admission.cabinet,
    integration_mode: record.admission.integration_mode,
    proposal_id: proposal?.proposal_id ?? null,
    proposal_sha256: proposal ? sha256(prettyJsonBytes(proposal)) : null,
    recommendation: "hold",
    wall_verified: false,
    authorizes_crown: false,
    authorizes_trade: false,
    reason_codes: record.admission.reason_codes,
  };
});

write("data/phase-seeds.jsonl", jsonl(phaseSeeds.map((phase) => ({
  _format: "kingdom.training-phase-seed/0.1",
  ...phase,
  state: "synthetic_metadata",
  authority: authorityBoundary(),
}))));
write("data/treasure-index.jsonl", jsonl(treasureRecords));
write("data/proposal-index.jsonl", jsonl(proposalIndex));
write("artifacts/proposals.jsonl", jsonl(proposals));
write("provenance/source-pins.json", prettyJsonBytes({
  _format: "kingdom.hf-source-pins/0.1",
  observed_on: observedOn,
  generator: "@agenttool/dark-continent-karma@0.1.0-dev.0",
  kingdom: {
    repository: "https://github.com/cambridgetcg/agenttool",
    revision: KINGDOM_REPOSITORY_REVISION,
    map_path: "KINGDOM.md",
    map_sha256: KINGDOM_MAP_SHA256,
  },
  dark_continent: {
    contract_id: "agenttool.dark-continent/0.1",
    source_profile: DARK_CONTINENT_SOURCE_PROFILE,
    snapshot_sha256: DARK_CONTINENT_SNAPSHOT_SHA256,
  },
  karma: {
    paper_id: KARMA_PAPER_ID,
    relationship: "inspired_by",
  },
  upstream: treasureRecords.map((record) => ({
    repo_id: record.subject.repo_id,
    revision: record.subject.revision,
    visibility: record.subject.visibility,
    license_observed: record.subject.license_observed,
    files: record.subject.files,
  })),
  exclusions: {
    raw_dataset_rows: true,
    raw_chats: true,
    credentials: true,
    private_documents: true,
    participant_profiles: true,
    mutable_revisions: true,
    untrusted_pickle_downloads: true,
    gate_acceptance: true,
  },
}));

const datasetManifestPaths = [
  "LICENSE",
  "README.md",
  "artifacts/proposals.jsonl",
  "data/phase-seeds.jsonl",
  "data/proposal-index.jsonl",
  "data/treasure-index.jsonl",
  "provenance/source-pins.json",
  "schema/treasure-v0.1.schema.json",
];
const datasetManifest = {
  _format: "kingdom.hf-hash-manifest/0.1",
  generated_by: "hf/scripts/build-release.mjs",
  excludes_self: true,
  files: datasetManifestPaths.map((relativePath) => fileIdentity(datasetRoot, relativePath)),
};
writeFileSync(`${datasetRoot}/hash-manifest.json`, prettyJsonBytes(datasetManifest));

mkdirSync(`${spaceRoot}/data`, { recursive: true });
for (const relativePath of ["data/proposal-index.jsonl", "data/treasure-index.jsonl"]) {
  copyFileSync(`${datasetRoot}/${relativePath}`, `${spaceRoot}/${relativePath}`);
}
const spaceDataFiles = [
  "assets/hero-web.webp",
  "data/proposal-index.jsonl",
  "data/treasure-index.jsonl",
]
  .map((relativePath) => fileIdentity(spaceRoot, relativePath));
const datasetRevision = "4ea106235b6d7dd53122b3025163a1bb32b02f97";
writeFileSync(`${spaceRoot}/source-manifest.json`, prettyJsonBytes({
  _format: "kingdom.hf-space-source/0.1",
  dataset_repo: "Yu-and-Ai/kingdom-dark-continent-karma",
  dataset_revision: datasetRevision,
  dataset_revision_status: "pinned_to_initial_dataset_publish",
  files: spaceDataFiles,
  runtime_network_reads: false,
  authority: authorityBoundary(),
}));

process.stdout.write(`built ${treasureRecords.length} treasure rows and ${proposals.length} proposal artifacts\n`);
