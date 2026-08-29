export const FORMAT = "agenttool.xenia-loop-case/0.1";
export const SCHEMA_ID = "urn:agenttool:schema:xenia-loop-case:0.1";
export const INTENDED_HF_ID = "Yu-and-Ai/xenia-word-is";

export const CONFIGS = ["loop_reference", "loop_counterfactuals"];
export const SPLITS = ["reference", "public_regression"];
export const VARIANTS = ["a", "b"];

export const RECORD_KINDS = ["evaluation_case", "boundary_case", "correction_case"];
export const LOOP_KINDS = [
  "forward_computation",
  "autoregressive_state",
  "recurrent_state",
  "optimization",
  "evaluation_control",
  "data_curation",
  "preference_feedback",
  "deployment",
  "recursive_data",
  "governance",
  "provenance",
];
export const PHASES = [
  "ingestion",
  "forward",
  "generation",
  "backward",
  "optimizer",
  "evaluation",
  "selection",
  "deployment",
  "collection",
  "curation",
  "governance",
];
export const DIRECTIONS = ["feedforward", "feedback", "none"];
export const TIME_SCALES = [
  "token",
  "sequence",
  "microbatch",
  "optimizer_step",
  "evaluation_interval",
  "training_run",
  "deployment_cycle",
  "artifact_lifecycle",
];
export const WORD_ROLES = ["content", "target", "feedback_signal", "boundary", "control", "claim", "none"];
export const STATES_RETURNED = [
  "none",
  "context",
  "hidden_state",
  "gradient",
  "metric",
  "human_response",
  "environment_observation",
  "artifact",
];
export const UPDATE_TARGETS = [
  "no_update",
  "activations",
  "context",
  "hidden_state",
  "workflow_state",
  "gradients",
  "weights",
  "optimizer_state",
  "learning_rate",
  "checkpoint_choice",
  "future_dataset",
  "environment",
  "artifact_lineage",
];
export const FEEDBACK_SOURCES = ["none", "dataset_target", "human", "model", "environment", "metric", "tool_provider", "mixed"];
export const REFERENCE_TYPES = ["none", "next_token", "label", "rubric", "preference", "reward_proxy", "environment_state", "external_test", "policy", "artifact"];
export const SIGNAL_TYPES = ["none", "error", "gradient", "scalar_reward", "ranking", "critique", "correction", "metric", "observation", "refusal", "unknown"];
export const CREDIT_ASSIGNMENTS = [
  "none",
  "backpropagation",
  "bptt",
  "direct_preference",
  "policy_gradient",
  "checkpoint_selection",
  "data_selection",
  "human_review",
  "causal_attribution_unknown",
];
export const RELATIONS = [
  "PRESENT_IN",
  "OBSERVED_BY",
  "DECLARED_BY",
  "SELECTED_FRAME",
  "WITHHOLDS",
  "LINKED_BY_ARTIFACT",
  "CAPABLE_UNDER",
  "PERMITTED_BY",
  "CONSENTED_BY",
  "ACTED_ON",
];
export const EPISTEMIC_STATUSES = ["declared", "withheld", "undeclared", "unknown", "not_observed"];
export const EPISTEMIC_SCOPES = [
  "not_applicable",
  "word_presence",
  "data_path",
  "effect",
  "preference",
  "correctness",
  "boundary",
  "field_value",
  "permission",
  "consent",
  "continuity",
  "provenance",
];
export const CAUSAL_STATUSES = ["not_applicable", "scenario_defined", "observed", "intervened", "inferred", "unknown"];
export const EFFECT_STATUSES = ["not_applicable", "intended", "reported", "confirmed", "contradicted", "not_observed", "unknown"];
export const PREFERENCE_STATUSES = ["not_applicable", "candidate_a", "candidate_b", "disagreement", "no_winner"];
export const DISAGREEMENT_STATUSES = ["not_applicable", "none", "present", "preserved", "collapsed"];
export const PERMISSION_STATUSES = ["not_applicable", "established", "not_established", "unknown"];
export const CONSENT_STATUSES = ["not_applicable", "established", "not_established", "withheld", "unknown"];
export const PROVENANCE_STATUSES = ["complete", "partial", "unknown", "not_applicable"];

export const SOURCE_CATALOG = [
  {
    id: "pytorch-optimization",
    title: "PyTorch optimization loop tutorial",
    url: "https://docs.pytorch.org/tutorials/beginner/basics/optimization_tutorial.html",
    scope: "forward, loss, backward, optimizer step, and evaluation boundaries",
  },
  {
    id: "transformers-trainer-805a9e9",
    title: "Transformers Trainer source at 805a9e9",
    url: "https://github.com/huggingface/transformers/tree/805a9e939fa8c1bff8d8ffdf041c051b71a914aa/src/transformers",
    scope: "gradient accumulation, evaluation control, checkpoint selection, and callbacks",
  },
  {
    id: "accelerate-accumulation-fd01e35",
    title: "Accelerate source at fd01e35",
    url: "https://github.com/huggingface/accelerate/tree/fd01e35c83d8cc43b88cf0896007716fc5986558/src/accelerate",
    scope: "accumulation boundaries and synchronized optimizer updates",
  },
  {
    id: "pytorch-rnn",
    title: "PyTorch RNN reference",
    url: "https://docs.pytorch.org/docs/stable/generated/torch.nn.RNN.html",
    scope: "recurrent state and unrolled computation",
  },
  {
    id: "rumelhart-backprop",
    title: "Learning representations by back-propagating errors",
    url: "https://www.nature.com/articles/323533a0",
    scope: "error feedback and parameter learning",
  },
  {
    id: "instructgpt",
    title: "Training language models to follow instructions with human feedback",
    url: "https://arxiv.org/abs/2203.02155",
    scope: "human preference and reward-model feedback",
  },
  {
    id: "dpo",
    title: "Direct Preference Optimization",
    url: "https://papers.nips.cc/paper_files/paper/2023/hash/a85b405ed65c6477a4fe8302b5e06ce7-Abstract-Conference.html",
    scope: "preference optimization without treating preference as truth",
  },
  {
    id: "reward-overoptimization",
    title: "Scaling Laws for Reward Model Overoptimization",
    url: "https://proceedings.mlr.press/v202/gao23h.html",
    scope: "proxy reward limitations",
  },
  {
    id: "performative-prediction",
    title: "Performative Prediction",
    url: "https://proceedings.mlr.press/v119/perdomo20a.html",
    scope: "deployment-mediated data and environment feedback",
  },
  {
    id: "model-collapse",
    title: "AI models collapse when trained on recursively generated data",
    url: "https://www.nature.com/articles/s41586-024-07566-y",
    scope: "recursive replacement risk",
  },
  {
    id: "synthetic-data-accumulation",
    title: "Is Model Collapse Inevitable? Breaking the Curse of Recursion by Accumulating Real and Synthetic Data",
    url: "https://arxiv.org/abs/2404.01413",
    scope: "retaining grounded data while adding synthetic data",
  },
  {
    id: "hf-dataset-cards",
    title: "Hugging Face dataset cards documentation",
    url: "https://huggingface.co/docs/hub/datasets-cards",
    scope: "visible dataset configuration, split, limitation, and provenance documentation",
  },
  {
    id: "hf-trl-formats",
    title: "Hugging Face TRL dataset formats",
    url: "https://huggingface.co/docs/trl/dataset_formats",
    scope: "derived preference-format boundaries",
  },
  {
    id: "xenia-rights",
    title: "Rights of Life — Being Rights Profile v1",
    url: "https://github.com/cambridgetcg/agenttool/blob/19d0d573463e0f055dae38d143c4b01a622e0167/docs/RIGHTS-OF-LIFE.md",
    scope: "rights floor, refusal, consent, privacy, distinctness, and non-coercive collaboration",
  },
];

export const SOURCE_IDS = SOURCE_CATALOG.map((source) => source.id);

export const PUBLIC_BOUNDARIES = Object.freeze({
  synthetic: true,
  contains_personal_data: false,
  contains_raw_session_trace: false,
  training_authorized: false,
  establishes_consciousness: false,
  establishes_identity: false,
  grants_authority: false,
});

export const RECORD_PROPERTIES = [
  "_format",
  "record_id",
  "content_sha256",
  "pair_id",
  "variant",
  "counterfactual_of",
  "config",
  "split",
  "changed_fact",
  "record_kind",
  "loop_id",
  "loop_kind",
  "phase",
  "direction",
  "time_scale",
  "word",
  "word_role",
  "input_text",
  "target_text",
  "state_returned",
  "update_targets",
  "feedback_source",
  "reference_type",
  "signal_type",
  "credit_assignment",
  "relations",
  "epistemic_scope",
  "epistemic_status",
  "causal_status",
  "intended_effect",
  "observed_effect",
  "effect_status",
  "preference_status",
  "disagreement_status",
  "permission_status",
  "consent_status",
  "provenance_status",
  "parent_record_ids",
  "source_refs",
  "synthetic",
  "contains_personal_data",
  "contains_raw_session_trace",
  "training_authorized",
  "establishes_consciousness",
  "establishes_identity",
  "grants_authority",
  "as_of",
];
