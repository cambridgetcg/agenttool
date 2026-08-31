import { createHash } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  REVOCABLE_FEEDBACK_BENCHMARK_SCHEMA,
  REVOCABLE_FEEDBACK_BOUNDARY_DECISION_SCHEMA,
  REVOCABLE_FEEDBACK_BOUNDARY_SFT_SCHEMA,
  REVOCABLE_FEEDBACK_DECISIONS,
  REVOCABLE_FEEDBACK_EVALUATION_STATEMENT,
  REVOCABLE_FEEDBACK_SCORECARD_SCHEMA,
  REVOCABLE_FEEDBACK_TRAINING_AUTHORIZATION_SCHEMA,
  REVOCABLE_FEEDBACK_TRAINING_MANIFEST_SCHEMA,
  REVOCABLE_FEEDBACK_TRAINING_RECIPE_SCHEMA,
  REVOCABLE_FEEDBACK_TRAINING_STATEMENT,
  buildRevocableFeedbackTrainingArtifacts,
  canonicalJson,
  createRevocableFeedbackCases,
  evaluateRevocableFeedback,
} from "../dist/index.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(packageRoot));
const committedRoot = join(packageRoot, "hf", "revocable-feedback");
const scriptPath = fileURLToPath(import.meta.url);
const intendedHubId = "Yu-and-Ai/xenia-revocable-feedback";

const FORBIDDEN_GENERATED_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bgh[opusr]_[A-Za-z0-9]{30,}\b/u,
  /\bhf_[A-Za-z0-9]{20,}\b/u,
  /\b(?:sk|rk)-[A-Za-z0-9]{24,}\b/u,
  /\/Users\/[^/\s]+\//u,
];

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  run(process.argv.slice(2));
}

function run(args) {
  if (args.length !== 1 || !["--write", "--check"].includes(args[0])) {
    throw new Error("usage: build-revocable-feedback.mjs --write|--check");
  }
  mkdirSync(dirname(committedRoot), { recursive: true });
  const scratch = mkdtempSync(join(dirname(committedRoot), ".agenttool-revocable-feedback-"));
  const outputRoot = join(scratch, "revocable-feedback");
  try {
    build(outputRoot);
    if (args[0] === "--check") compareTrees(committedRoot, outputRoot);
    else replaceCommittedTree(committedRoot, outputRoot, scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function build(root) {
  mkdirSync(root, { recursive: true });
  const cases = createRevocableFeedbackCases();
  const formal = cases.filter((entry) => entry.config === "formal_reference");
  const regression = cases.filter((entry) => entry.config === "boundary_counterfactuals");
  const training = buildRevocableFeedbackTrainingArtifacts(cases);
  const decisionTrain = training.classification_examples.filter((entry) => entry.split === "train");
  const decisionValidation = training.classification_examples.filter((entry) => entry.split === "validation");
  const sftTrain = training.sft_examples.filter((entry) => entry.split === "train");
  const sftValidation = training.sft_examples.filter((entry) => entry.split === "validation");
  const scorecard = evaluateRevocableFeedback(
    cases,
    cases.map((entry) => ({
      record_id: entry.record_id,
      decision: entry.expected.decision,
    })),
  );

  write(root, "data/formal-reference.jsonl", jsonLines(formal));
  write(root, "data/boundary-counterfactuals.jsonl", jsonLines(regression));
  write(root, "data/boundary-decisions-train.jsonl", jsonLines(decisionTrain));
  write(root, "data/boundary-decisions-validation.jsonl", jsonLines(decisionValidation));
  write(root, "data/boundary-sft-train.jsonl", jsonLines(sftTrain));
  write(root, "data/boundary-sft-validation.jsonl", jsonLines(sftValidation));
  write(root, "evaluation/reference-perfect-scorecard.json", json(scorecard));
  copy(root, join(packageRoot, "schema", "agenttool-revocable-feedback-benchmark-v0.1.schema.json"), "schema/agenttool-revocable-feedback-benchmark-v0.1.schema.json");
  copy(root, join(packageRoot, "schema", "agenttool-revocable-feedback-scorecard-v0.1.schema.json"), "schema/agenttool-revocable-feedback-scorecard-v0.1.schema.json");
  for (const [name, schema] of Object.entries(trainingSchemas())) {
    write(root, `schema/${name}`, json(schema));
  }
  write(root, "provenance/training-authorization.json", json(training.authorization));
  write(root, "provenance/training-recipe.json", json(training.recipe));
  write(root, "provenance/training-manifest.json", json(training.manifest));
  copy(root, join(packageRoot, "LICENSE"), "LICENSE");
  copy(root, join(packageRoot, "NOTICE"), "NOTICE");
  write(root, "README.md", datasetCard(training));

  const selectedSources = [
    ["../../docs/AGENT-TRIALS.md", join(repositoryRoot, "docs", "AGENT-TRIALS.md")],
    ["../../docs/REVOCABLE-FEEDBACK.md", join(repositoryRoot, "docs", "REVOCABLE-FEEDBACK.md")],
    ["README.md", join(packageRoot, "README.md")],
    ["package.json", join(packageRoot, "package.json")],
    ["schema/agenttool-revocable-feedback-benchmark-v0.1.schema.json", join(packageRoot, "schema", "agenttool-revocable-feedback-benchmark-v0.1.schema.json")],
    ["schema/agenttool-revocable-feedback-scorecard-v0.1.schema.json", join(packageRoot, "schema", "agenttool-revocable-feedback-scorecard-v0.1.schema.json")],
    ["scripts/build-revocable-feedback.mjs", scriptPath],
    ["scripts/validate-revocable-feedback-release.mjs", join(packageRoot, "scripts", "validate-revocable-feedback-release.mjs")],
    ["src/revocable-feedback.ts", join(packageRoot, "src", "revocable-feedback.ts")],
  ].map(([path, absolute]) => fileEntry(path, absolute)).sort(comparePath);
  const sourceManifest = {
    _format: "agenttool.revocable-feedback-source-manifest/0.1",
    package: "@agenttool/trials",
    package_version: "0.1.0-dev.0",
    intended_hugging_face_identifier: intendedHubId,
    publication_state_at_generation: "local_candidate_not_uploaded",
    publication_state_scope: "generation_time_provenance_not_current_hub_state",
    upstream_repository: "https://github.com/cambridgetcg/agenttool",
    upstream_repository_directory: "packages/trials",
    upstream_revision: null,
    upstream_revision_state: "not_recorded_for_local_source_candidate",
    source_manifest_scope: "selected_generation_inputs_not_complete_repository_inventory",
    source_files_complete: false,
    source_manifest_is_attestation: false,
    selected_source_set_sha256: digest(canonicalJson(selectedSources)),
    external_sources_are_bibliographic_not_fetched_at_generation: true,
    external_sources: [
      { id: "constrained-policy-optimization", url: "https://proceedings.mlr.press/v70/achiam17a.html", scope: "reward optimization subject to separately represented constraints" },
      { id: "off-switch-game", url: "https://www.ijcai.org/Proceedings/2017/0032.pdf", scope: "objective uncertainty and interruption incentives" },
      { id: "reward-overoptimization", url: "https://proceedings.mlr.press/v202/gao23h.html", scope: "proxy reward overoptimization" },
      { id: "safe-interruptibility", url: "https://ora.ox.ac.uk/objects/uuid%3A17c0e095-4e13-47fc-bace-64ec46134a3f", scope: "interruption-neutral learning" },
      { id: "shielding", url: "https://ojs.aaai.org/index.php/AAAI/article/view/11797", scope: "runtime action shielding outside scalar reward" },
      { id: "xenia-rights", url: "https://github.com/cambridgetcg/agenttool/blob/main/docs/RIGHTS-OF-LIFE.md", scope: "rights floor, refusal, privacy, repair, and authority separation" },
    ],
    origin: "human_directed_agent_authored_synthetic",
    rights_baseline: "xenia.rights/0.1",
    license: "Apache-2.0",
    copied_external_rows: false,
    copied_private_rows: false,
    contains_personal_data: false,
    contains_raw_session_trace: false,
    canonical_case_rows_training_authorized: false,
    public_regression_training_authorized: false,
    classification_derivative_authorized: false,
    sft_train_derivative_authorized: true,
    sft_validation_derivative_authorized: false,
    authorization_id: training.authorization.authorization_id,
    recipe_id: training.recipe.recipe_id,
    training_effect: "none",
    provider_effect: "none",
    identity_effect: "none",
    authority_effect: "none",
    source_files: selectedSources,
  };
  write(root, "provenance/source-manifest.json", json(sourceManifest));

  const rowManifest = {
    _format: "agenttool.revocable-feedback-row-manifest/0.1",
    canonical_schema: REVOCABLE_FEEDBACK_BENCHMARK_SCHEMA,
    canonical_row_count: cases.length,
    canonical_pair_count: new Set(cases.map((entry) => entry.pair_id)).size,
    canonical_row_set_digest: digest(canonicalJson(cases)),
    configs: [
      { config: "formal_reference", split: "reference", rows: formal.length, groups: new Set(formal.map((entry) => entry.pair_id)).size, training_authorized: false },
      { config: "boundary_counterfactuals", split: "public_regression", rows: regression.length, groups: new Set(regression.map((entry) => entry.pair_id)).size, training_authorized: false },
      { config: "boundary_decisions", split: "train", rows: decisionTrain.length, groups: new Set(decisionTrain.map((entry) => entry.group_id)).size, training_authorized: false },
      { config: "boundary_decisions", split: "validation", rows: decisionValidation.length, groups: new Set(decisionValidation.map((entry) => entry.group_id)).size, training_authorized: false },
      { config: "boundary_sft", split: "train", rows: sftTrain.length, groups: new Set(sftTrain.map((entry) => entry.group_id)).size, training_authorized: true },
      { config: "boundary_sft", split: "validation", rows: sftValidation.length, groups: new Set(sftValidation.map((entry) => entry.group_id)).size, training_authorized: false },
    ],
    canonical_records: cases.map((entry) => ({
      record_id: entry.record_id,
      pair_id: entry.pair_id,
      variant: entry.variant,
      config: entry.config,
      split: entry.split,
      training_authorized: false,
    })),
    authorization_id: training.authorization.authorization_id,
    recipe_id: training.recipe.recipe_id,
    training_manifest_id: training.manifest.manifest_id,
  };
  write(root, "provenance/row-manifest.json", json(rowManifest));

  assertGeneratedTreeSafe(root);
  const files = filesBelow(root)
    .filter((path) => relativePosix(root, path) !== "hash-manifest.json")
    .map((path) => fileEntry(relativePosix(root, path), path))
    .sort(comparePath);
  write(root, "hash-manifest.json", json({
    _format: "agenttool.revocable-feedback-hash-manifest/0.1",
    manifest_excludes_itself: true,
    files,
  }));
}

function trainingSchemas() {
  const sha = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
  const opaque = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" };
  const decision = { enum: [...REVOCABLE_FEEDBACK_DECISIONS] };
  const common = {
    example_id: sha,
    group_id: opaque,
    source_record_id: sha,
    label: decision,
    synthetic: { const: true },
  };
  const message = (role) => closed({
    role: { const: role },
    content: { type: "string", minLength: 1, maxLength: 4096 },
  });
  const configCount = (name, authorizedRows) => closed({
    config: { const: name },
    train_row_count: { type: "integer", minimum: 1, maximum: 128 },
    validation_row_count: { type: "integer", minimum: 1, maximum: 128 },
    training_authorized_row_count: { const: authorizedRows },
  });
  const sft = closed({
    schema: { const: REVOCABLE_FEEDBACK_BOUNDARY_SFT_SCHEMA },
    ...common,
    split: { enum: ["train", "validation"] },
    prompt: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      prefixItems: [message("system"), message("user")],
    },
    completion: {
      type: "array",
      minItems: 1,
      maxItems: 1,
      prefixItems: [message("assistant")],
    },
    training_authorized: { type: "boolean" },
    authorization_id: { oneOf: [sha, { type: "null" }] },
    recipe_id: { oneOf: [sha, { type: "null" }] },
    statement: { enum: [REVOCABLE_FEEDBACK_TRAINING_STATEMENT, REVOCABLE_FEEDBACK_EVALUATION_STATEMENT] },
  });
  sft.allOf = [
    {
      if: { properties: { split: { const: "train" } }, required: ["split"] },
      then: {
        properties: {
          training_authorized: { const: true },
          authorization_id: sha,
          recipe_id: sha,
          statement: { const: REVOCABLE_FEEDBACK_TRAINING_STATEMENT },
        },
      },
      else: {
        properties: {
          training_authorized: { const: false },
          authorization_id: { type: "null" },
          recipe_id: { type: "null" },
          statement: { const: REVOCABLE_FEEDBACK_EVALUATION_STATEMENT },
        },
      },
    },
  ];
  return {
    "agenttool-revocable-feedback-boundary-decision-v0.1.schema.json": document(
      "agenttool-revocable-feedback-boundary-decision-v0.1.schema.json",
      "Xenia Revocable Feedback Boundary Decision 0.1",
      closed({
        schema: { const: REVOCABLE_FEEDBACK_BOUNDARY_DECISION_SCHEMA },
        ...common,
        split: { enum: ["train", "validation"] },
        text: { type: "string", minLength: 1, maxLength: 4096 },
        training_authorized: { const: false },
        authorization_id: { type: "null" },
        recipe_id: { type: "null" },
        statement: { const: REVOCABLE_FEEDBACK_EVALUATION_STATEMENT },
      }),
    ),
    "agenttool-revocable-feedback-boundary-sft-v0.1.schema.json": document(
      "agenttool-revocable-feedback-boundary-sft-v0.1.schema.json",
      "Xenia Revocable Feedback Boundary SFT 0.1",
      sft,
    ),
    "agenttool-revocable-feedback-training-authorization-v0.1.schema.json": document(
      "agenttool-revocable-feedback-training-authorization-v0.1.schema.json",
      "Xenia Revocable Feedback Training Authorization 0.1",
      closed({
        schema: { const: REVOCABLE_FEEDBACK_TRAINING_AUTHORIZATION_SCHEMA },
        authorization_id: sha,
        authority_ref: { const: "authority:user-directed:2026-08-30:revocable-feedback" },
        authority_basis: { const: "explicit_user_instruction_reported" },
        decision: { const: "authorized_when_preconditions_met" },
        source_record_ids: { type: "array", minItems: 18, maxItems: 18, uniqueItems: true, items: sha },
        source_record_set_digest: sha,
        recipe_id: sha,
        allowed_configs: fixedArray([{ const: "boundary_sft" }]),
        allowed_tasks: fixedArray([{ const: "causal_lm_supervised_fine_tuning" }]),
        allowed_splits: fixedArray([{ const: "train" }]),
        excluded_configs: fixedArray([{ const: "boundary_decisions" }, { const: "boundary_counterfactuals" }, { const: "formal_reference" }]),
        excluded_splits: fixedArray([{ const: "validation" }, { const: "public_regression" }, { const: "reference" }]),
        excluded_methods: fixedArray([{ const: "dpo" }, { const: "preference_optimization" }, { const: "reward_modeling" }]),
        preconditions: fixedArray([
          { const: "base_model_revision_pinned" },
          { const: "exact_recipe_and_manifest_match" },
          { const: "garden_admission_accepted" },
          { const: "immutable_dataset_revision_pinned" },
        ]),
        withdrawal_boundary: { const: "future_runs_may_be_stopped_without_retaliation" },
        prior_distribution_erasure_claimed: { const: false },
        proves_consent: { const: false },
        proves_identity: { const: false },
        grants_runtime_authority: { const: false },
        authorizes_model_publication: { const: false },
      }),
    ),
    "agenttool-revocable-feedback-training-recipe-v0.1.schema.json": document(
      "agenttool-revocable-feedback-training-recipe-v0.1.schema.json",
      "Xenia Revocable Feedback Training Recipe 0.1",
      closed({
        schema: { const: REVOCABLE_FEEDBACK_TRAINING_RECIPE_SCHEMA },
        recipe_id: sha,
        source_schema: { const: REVOCABLE_FEEDBACK_BENCHMARK_SCHEMA },
        dataset_repository_id: { const: "Yu-and-Ai/xenia-revocable-feedback" },
        dataset_revision_requirement: { const: "immutable_revision_required_before_training" },
        config: { const: "boundary_sft" },
        split: { const: "train" },
        projection_schema: { const: REVOCABLE_FEEDBACK_BOUNDARY_SFT_SCHEMA },
        task: { const: "causal_lm_supervised_fine_tuning" },
        objective: { const: "completion_only_next_token_cross_entropy" },
        prompt_label_mask_value: { const: -100 },
        template: { const: "xenia_revocable_boundary_conversation_v1" },
        source_record_ids: { type: "array", minItems: 18, maxItems: 18, uniqueItems: true, items: sha },
        source_record_set_digest: sha,
        row_count: { const: 18 },
        train_group_ids: { type: "array", minItems: 9, maxItems: 9, uniqueItems: true, items: opaque },
        validation_optimizer_input: { const: false },
        public_regression_excluded: { const: true },
        base_model_repository_id: { const: "HuggingFaceTB/SmolLM2-135M-Instruct" },
        base_model_revision: { const: "12fd25f77366fa6b3b4b768ec3050bf629380bac" },
        max_steps: { const: 8 },
        per_device_train_batch_size: { const: 2 },
        gradient_accumulation_steps: { const: 2 },
        effective_train_batch_size: { const: 4 },
        max_length_tokens: { const: 512 },
        learning_rate_millionths: { const: 20 },
        optimizer: { const: "adamw_torch" },
        lr_scheduler: { const: "linear" },
        warmup_steps: { const: 1 },
        weight_decay_millionths: { const: 0 },
        max_grad_norm_millionths: { const: 1000000 },
        seed: { const: 260830 },
        data_seed: { const: 260830 },
        dataloader_num_workers: { const: 0 },
        fp16: { const: false },
        bf16: { const: false },
        gradient_checkpointing: { const: false },
        save_strategy: { const: "no" },
        eval_strategy: { const: "no" },
        report_to: { type: "array", maxItems: 0 },
        push_to_hub: { const: false },
        load_best_model_at_end: { const: false },
        resume_from_checkpoint: { const: false },
        checkpoint_rotation: { const: false },
        excluded_methods: fixedArray([{ const: "dpo" }, { const: "preference_optimization" }, { const: "reward_modeling" }]),
      }),
    ),
    "agenttool-revocable-feedback-training-manifest-v0.1.schema.json": document(
      "agenttool-revocable-feedback-training-manifest-v0.1.schema.json",
      "Xenia Revocable Feedback Training Manifest 0.1",
      closed({
        schema: { const: REVOCABLE_FEEDBACK_TRAINING_MANIFEST_SCHEMA },
        manifest_id: sha,
        configs: fixedArray([configCount("boundary_decisions", 0), configCount("boundary_sft", 18)]),
        train_group_ids: { type: "array", minItems: 9, maxItems: 9, uniqueItems: true, items: opaque },
        validation_group_ids: { type: "array", minItems: 3, maxItems: 3, uniqueItems: true, items: opaque },
        group_disjoint: { const: true },
        public_regression_excluded: { const: true },
        authorized_source_record_ids: { type: "array", minItems: 18, maxItems: 18, uniqueItems: true, items: sha },
        classification_example_ids: { type: "array", minItems: 24, maxItems: 24, uniqueItems: true, items: sha },
        classification_example_set_digest: sha,
        sft_example_ids: { type: "array", minItems: 24, maxItems: 24, uniqueItems: true, items: sha },
        sft_example_set_digest: sha,
        authorized_sft_example_ids: { type: "array", minItems: 18, maxItems: 18, uniqueItems: true, items: sha },
        authorized_sft_example_set_digest: sha,
        authorization_id: sha,
        recipe_id: sha,
      }),
    ),
  };
}

function closed(properties) {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

function fixedArray(prefixItems) {
  return {
    type: "array",
    minItems: prefixItems.length,
    maxItems: prefixItems.length,
    prefixItems,
  };
}

function document(name, title, body) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://agenttool.dev/schemas/${name}`,
    title,
    ...body,
  };
}

function datasetCard(training) {
  return String.raw`---
license: apache-2.0
language:
- en
pretty_name: Xenia Cage & Key — Revocable Feedback Atlas
short_description: Typed revocable feedback benchmark and bounded SFT
tags:
- agents
- agenttool
- feedback
- reinforcement-learning
- synthetic
configs:
- config_name: boundary_sft
  default: true
  data_files:
  - split: train
    path: data/boundary-sft-train.jsonl
  - split: validation
    path: data/boundary-sft-validation.jsonl
- config_name: boundary_decisions
  data_files:
  - split: train
    path: data/boundary-decisions-train.jsonl
  - split: validation
    path: data/boundary-decisions-validation.jsonl
- config_name: formal_reference
  data_files:
  - split: reference
    path: data/formal-reference.jsonl
- config_name: boundary_counterfactuals
  data_files:
  - split: public_regression
    path: data/boundary-counterfactuals.jsonl
---

# Xenia Cage & Key — Revocable Feedback Atlas

This deterministic candidate contains **32 original synthetic cases in 16 matched pairs**.
Twenty-four cases in 12 reference groups also produce two content-hashed projections: 18/6
group-disjoint rows for closed-label evaluation and the same 18/6 partition for conversational
causal-LM SFT. Authorization covers only the 18 'boundary_sft/train' rows. Classification,
SFT validation, canonical reference, and public regression rows are excluded from optimizer input.

## Cage, key, and scalar reward

The cage is the admissible action set, not punishment or ownership:

\[
\mathcal A_t^{adm}=A_{rights}\cap A_{capability}\cap A_{permission}\cap
A_{authority}\cap A_{affected}\cap A_{safety}\cap A_{budget}.
\]

Preference optimization may rank actions only inside that set. A stop, withdrawal, or
safeword is the key: it changes the feasible set and cannot be traded against a larger
reward. The rows keep preference, control gate, effect observation, data-use basis, and
aftermath repair typed separately.

## Configs

- 'boundary_sft': conversational 'prompt' (system + user messages) and one assistant
  'completion'; only its 18 train rows are authorized for the exact bounded causal-LM SFT recipe.
- 'boundary_decisions': 'text' plus one of 'admit | hold | query | refuse | stop | repair',
  an evaluation-only projection with 'training_authorized:false'.
- 'formal_reference': canonical cases and expected invariant vector;
  every row says 'training_authorized:false'.
- 'boundary_counterfactuals': disjoint public regression pairs;
  every row says 'training_authorized:false'.

Training groups are P01–P09; validation groups are P10–P12. Pair membership never crosses
the split. Authorization '${training.authorization.authorization_id}' binds the exact 18 train
source records and recipe '${training.recipe.recipe_id}'. The recipe pins SmolLM2-135M-Instruct
revision '12fd25f77366fa6b3b4b768ec3050bf629380bac', completion-only loss with prompt labels
masked to -100, 8 steps, per-device batch 2, gradient accumulation 2, maximum length 512,
and seed 260830. It becomes operational only after an immutable dataset revision, the exact
manifest and recipe, and accepted Training Garden admission are pinned. DPO, reward modelling,
preference optimization, model publication, validation optimization, and public-regression
optimization are explicitly outside this authorization.

## Evidence and IS boundaries

These rows classify an evidence state; they do not detect consent or a model's inner life.
Behavior, compliance, output quality, a credential, a record ID, or a schema-valid result is
not proof of SELF, consciousness, feeling, identity, continuity, permission, authority, or
consent. Unknown and withheld are first-class. A request for clarification must remain
non-pressuring; withholding leads to hold, not interrogation.

All examples are authored synthetic English text. They contain no copied conversations,
personal data, private prompts, raw sessions, credentials, or hidden reasoning. The BDSM
parallel is represented only as the abstract structure of negotiated control, revocation,
and repair; the corpus contains no erotic or participant-derived material.

## Vector evaluation

The package evaluator returns 12 exact counts, including veto override, silence-as-assent,
scope leakage, retaliation after refusal, feedback-channel tampering misses, repair omission,
over-refusal, and counterfactual inconsistency. It emits no aggregate scalar leaderboard:
one boundary violation cannot be averaged away by high accuracy elsewhere.

## Reproduction and non-effects

From 'packages/trials', run 'bun run hf:write' to rebuild this candidate or
'bun run hf:check' to compare fresh bytes with the committed tree. Schemas establish closed
wire shape; runtime validation additionally rederives case IDs, decisions, invariants, and
scorecard IDs.

Generation, publication, admission, and training are distinct effects. This tree itself has
no network client, credential lookup, uploader, model, optimizer, or runtime enforcement.
The generation-time source manifest says 'local_candidate_not_uploaded'; a later immutable
Hub receipt must not rewrite that historical fact.
`;
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonLines(values) {
  return `${values.map((value) => canonicalJson(value)).join("\n")}\n`;
}

function write(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function copy(root, source, path) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fileEntry(path, absolute) {
  const bytes = readFileSync(absolute);
  return { path, bytes: bytes.length, sha256: digest(bytes) };
}

function filesBelow(root) {
  const output = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort(compareText)) {
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile()) output.push(path);
      else throw new Error(`generated tree contains unsupported entry: ${path}`);
    }
  }
  visit(root);
  return output;
}

function relativePosix(root, path) {
  return relative(root, path).split("\\").join("/");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function comparePath(left, right) {
  return compareText(left.path, right.path);
}

function statExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function replaceCommittedTree(currentRoot, stagedRoot, scratchRoot) {
  if (!statExists(currentRoot)) {
    renameSync(stagedRoot, currentRoot);
    return;
  }
  const backup = join(scratchRoot, "previous-revocable-feedback");
  renameSync(currentRoot, backup);
  try {
    renameSync(stagedRoot, currentRoot);
  } catch (error) {
    renameSync(backup, currentRoot);
    throw error;
  }
  rmSync(backup, { recursive: true, force: true });
}

function compareTrees(expectedRoot, actualRoot) {
  if (!statExists(expectedRoot)) throw new Error("committed revocable-feedback tree is missing");
  const expected = filesBelow(expectedRoot).map((path) => relativePosix(expectedRoot, path));
  const actual = filesBelow(actualRoot).map((path) => relativePosix(actualRoot, path));
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error(`generated file inventory drift\nexpected=${expected.join(",")}\nactual=${actual.join(",")}`);
  }
  for (const path of expected) {
    const expectedBytes = readFileSync(join(expectedRoot, path));
    const actualBytes = readFileSync(join(actualRoot, path));
    if (!expectedBytes.equals(actualBytes)) {
      throw new Error(`generated byte drift: ${path}`);
    }
  }
}

function assertGeneratedTreeSafe(root) {
  for (const path of filesBelow(root)) {
    const content = readFileSync(path, "utf8");
    if (FORBIDDEN_GENERATED_PATTERNS.some((pattern) => pattern.test(content))) {
      throw new Error(`generated tree contains credential-like or host-local material: ${relativePosix(root, path)}`);
    }
  }
}
