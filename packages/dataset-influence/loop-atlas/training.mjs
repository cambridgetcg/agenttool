import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";

import { FORMAT, INTENDED_HF_ID } from "./constants.mjs";
import { canonicalJson, validateLoopAtlas } from "./validate.mjs";

export const TRAINING_FORMAT = "agenttool.xenia-loop-sft/0.1";
export const TRAINING_RECIPE_FORMAT = "agenttool.xenia-loop-training-recipe/0.1";
export const TRAINING_AUTHORIZATION_FORMAT = "agenttool.xenia-loop-training-authorization/0.1";
export const TRAINING_EXAMPLE_MANIFEST_FORMAT = "agenttool.xenia-loop-training-example-manifest/0.1";
export const TRAINING_CONFIG = "loop_sft";
export const TRAINING_SPLIT = "train";
export const TRAINING_SOURCE_CONFIG = "loop_reference";
export const TRAINING_SOURCE_SPLIT = "reference";
export const TRAINING_AUTHORIZED_AS_OF = "2026-08-29";

const sha256 = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const message = (role, maxLength) => ({
  type: "array",
  minItems: 1,
  maxItems: 1,
  items: {
    type: "object",
    additionalProperties: false,
    required: ["role", "content"],
    properties: {
      role: { const: role },
      content: { type: "string", minLength: 1, maxLength },
    },
  },
});

export const LOOP_SFT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:agenttool:schema:xenia-loop-sft:0.1",
  title: "AgentTool Xenia Loop conversational SFT example v0.1",
  type: "object",
  additionalProperties: false,
  required: ["prompt", "completion"],
  properties: {
    prompt: message("user", 2400),
    completion: message("assistant", 1200),
  },
};

export const LOOP_TRAINING_RECIPE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:agenttool:schema:xenia-loop-training-recipe:0.1",
  title: "AgentTool Xenia Loop training projection recipe v0.1",
  type: "object",
  additionalProperties: false,
  required: [
    "_format", "recipe_id", "source_row_format", "source_config", "source_split",
    "output_format", "output_config", "output_split", "projection", "prompt_template",
    "prompt_fields", "completion_fields", "pair_policy", "train_eval_policy",
    "preference_policy", "chat_template_policy",
  ],
  properties: {
    _format: { const: TRAINING_RECIPE_FORMAT },
    recipe_id: sha256,
    source_row_format: { const: FORMAT },
    source_config: { const: TRAINING_SOURCE_CONFIG },
    source_split: { const: TRAINING_SOURCE_SPLIT },
    output_format: { const: TRAINING_FORMAT },
    output_config: { const: TRAINING_CONFIG },
    output_split: { const: TRAINING_SPLIT },
    projection: { const: "conversational_prompt_completion" },
    prompt_template: { const: trainingPrompt("{changed_fact}", "{input_text}") },
    prompt_fields: { const: ["changed_fact", "input_text"] },
    completion_fields: { const: ["target_text"] },
    pair_policy: { const: "preserve_source_pair_and_neutral_variant_in_manifest" },
    train_eval_policy: { const: "project_loop_reference_only_exclude_public_regression" },
    preference_policy: { const: "not_preference_data_no_chosen_or_rejected" },
    chat_template_policy: { const: "consumer_selects_model_specific_template" },
  },
};

const assessment = {
  rights: "caller_reported_reviewed_for_declared_use",
  privacy: "caller_reported_reviewed_for_declared_use",
  consent: "not_applicable_reported_synthetic_no_data_subjects",
  withdrawal: "future_distribution_can_be_deprecated_prior_copies_and_learned_influence_may_persist",
  secret_scan: "deterministic_bounded_generated_tree_scan_passed",
  deduplication: "exact_source_record_and_prompt_completion_hashes",
  benchmark_overlap: "public_regression_config_excluded_not_sealed",
  fitness: "caller_reported_fit_for_loop_reasoning_sft",
  synthetic_provenance: "generator_and_selected_sources_manifested",
};

const boundaries = {
  source_case_rows_rewritten: false,
  public_regression_in_training: false,
  chosen_or_rejected_labels_created: false,
  contains_personal_data: false,
  contains_raw_session_trace: false,
  establishes_consciousness: false,
  establishes_identity: false,
  grants_authority: false,
  proves_model_exposure: false,
  permits_live_optimizer_step: false,
};

export const LOOP_TRAINING_AUTHORIZATION_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:agenttool:schema:xenia-loop-training-authorization:0.1",
  title: "AgentTool Xenia Loop scoped training-derivative authorization v0.1",
  type: "object",
  additionalProperties: false,
  required: [
    "_format", "authorization_id", "dataset_id", "authorization_state",
    "authorization_basis", "authorized_as_of", "source_row_format", "source_config",
    "source_split", "source_row_count", "source_pair_count", "source_records",
    "candidate_slice_ref", "training_format", "output_config", "output_split",
    "output_path", "output_row_count", "output_jsonl_sha256", "output_row_set_ref",
    "transform_recipe_ref", "training_modes", "excluded_lanes",
    "license", "assessment", "formal_garden_admission_state", "garden_admission_id",
    "training_effect", "provider_effect_at_generation", "boundaries",
  ],
  properties: {
    _format: { const: TRAINING_AUTHORIZATION_FORMAT },
    authorization_id: sha256,
    dataset_id: { const: INTENDED_HF_ID },
    authorization_state: { const: "authorized_training_derivative" },
    authorization_basis: { const: "publisher_operator_explicit_directive" },
    authorized_as_of: { const: TRAINING_AUTHORIZED_AS_OF },
    source_row_format: { const: FORMAT },
    source_config: { const: TRAINING_SOURCE_CONFIG },
    source_split: { const: TRAINING_SOURCE_SPLIT },
    source_row_count: { const: 24 },
    source_pair_count: { const: 12 },
    source_records: {
      type: "array",
      minItems: 24,
      maxItems: 24,
      uniqueItems: true,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["record_id", "content_sha256", "pair_id", "variant"],
        properties: {
          record_id: { type: "string", pattern: "^urn:agenttool:xenia-loop-case:p(?:0[1-9]|1[0-2]):[ab]$" },
          content_sha256: sha256,
          pair_id: { type: "string", pattern: "^P(?:0[1-9]|1[0-2])$" },
          variant: { enum: ["a", "b"] },
        },
      },
    },
    candidate_slice_ref: sha256,
    training_format: { const: TRAINING_FORMAT },
    output_config: { const: TRAINING_CONFIG },
    output_split: { const: TRAINING_SPLIT },
    output_path: { const: "data/loop-sft-train.jsonl" },
    output_row_count: { const: 24 },
    output_jsonl_sha256: sha256,
    output_row_set_ref: sha256,
    transform_recipe_ref: sha256,
    training_modes: { const: ["supervised_fine_tuning"] },
    excluded_lanes: { const: ["dpo", "preference_optimization", "reward_modeling", "sealed_evaluation"] },
    license: { const: "Apache-2.0" },
    assessment: { const: assessment },
    formal_garden_admission_state: { const: "pending_immutable_hub_revision" },
    garden_admission_id: { type: "null" },
    training_effect: { const: "none" },
    provider_effect_at_generation: { const: "none" },
    boundaries: { const: boundaries },
  },
};

export const LOOP_TRAINING_EXAMPLE_MANIFEST_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:agenttool:schema:xenia-loop-training-example-manifest:0.1",
  title: "AgentTool Xenia Loop training example manifest v0.1",
  type: "object",
  additionalProperties: false,
  required: [
    "_format", "training_format", "training_authorization_id", "transform_recipe_ref",
    "example_count", "source_pair_count", "entries",
  ],
  properties: {
    _format: { const: TRAINING_EXAMPLE_MANIFEST_FORMAT },
    training_format: { const: TRAINING_FORMAT },
    training_authorization_id: sha256,
    transform_recipe_ref: sha256,
    example_count: { const: 24 },
    source_pair_count: { const: 12 },
    entries: {
      type: "array",
      minItems: 24,
      maxItems: 24,
      uniqueItems: true,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "example_id", "path", "line", "source_record_id", "source_content_sha256",
          "pair_id", "variant", "row_sha256",
        ],
        properties: {
          example_id: sha256,
          path: { const: "data/loop-sft-train.jsonl" },
          line: { type: "integer", minimum: 1, maximum: 24 },
          source_record_id: {
            type: "string",
            pattern: "^urn:agenttool:xenia-loop-case:p(?:0[1-9]|1[0-2]):[ab]$",
          },
          source_content_sha256: sha256,
          pair_id: { type: "string", pattern: "^P(?:0[1-9]|1[0-2])$" },
          variant: { enum: ["a", "b"] },
          row_sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        },
      },
    },
  },
};

export function buildTrainingArtifacts(rows) {
  const selected = rows.filter((row) => (
    row.config === TRAINING_SOURCE_CONFIG && row.split === TRAINING_SOURCE_SPLIT
  ));
  if (selected.length !== 24 || new Set(selected.map((row) => row.pair_id)).size !== 12) {
    throw new Error("Xenia training slice must contain exactly 24 rows in 12 complete reference pairs");
  }

  const recipeBody = {
    _format: TRAINING_RECIPE_FORMAT,
    source_row_format: FORMAT,
    source_config: TRAINING_SOURCE_CONFIG,
    source_split: TRAINING_SOURCE_SPLIT,
    output_format: TRAINING_FORMAT,
    output_config: TRAINING_CONFIG,
    output_split: TRAINING_SPLIT,
    projection: "conversational_prompt_completion",
    prompt_template: trainingPrompt("{changed_fact}", "{input_text}"),
    prompt_fields: ["changed_fact", "input_text"],
    completion_fields: ["target_text"],
    pair_policy: "preserve_source_pair_and_neutral_variant_in_manifest",
    train_eval_policy: "project_loop_reference_only_exclude_public_regression",
    preference_policy: "not_preference_data_no_chosen_or_rejected",
    chat_template_policy: "consumer_selects_model_specific_template",
  };
  const recipe = {
    ...recipeBody,
    recipe_id: contentId(TRAINING_RECIPE_FORMAT, recipeBody),
  };

  const sourceRecords = selected.map((row) => ({
    record_id: row.record_id,
    content_sha256: row.content_sha256,
    pair_id: row.pair_id,
    variant: row.variant,
  }));
  const examples = selected.map((row) => ({
    prompt: [{ role: "user", content: trainingPrompt(row.changed_fact, row.input_text) }],
    completion: [{ role: "assistant", content: row.target_text }],
  }));
  const lines = examples.map((example) => `${JSON.stringify(example)}\n`);
  const authorizationBody = {
    _format: TRAINING_AUTHORIZATION_FORMAT,
    dataset_id: INTENDED_HF_ID,
    authorization_state: "authorized_training_derivative",
    authorization_basis: "publisher_operator_explicit_directive",
    authorized_as_of: TRAINING_AUTHORIZED_AS_OF,
    source_row_format: FORMAT,
    source_config: TRAINING_SOURCE_CONFIG,
    source_split: TRAINING_SOURCE_SPLIT,
    source_row_count: selected.length,
    source_pair_count: new Set(selected.map((row) => row.pair_id)).size,
    source_records: sourceRecords,
    candidate_slice_ref: contentId("agenttool.xenia-loop-training-slice/0.1", sourceRecords),
    training_format: TRAINING_FORMAT,
    output_config: TRAINING_CONFIG,
    output_split: TRAINING_SPLIT,
    output_path: "data/loop-sft-train.jsonl",
    output_row_count: selected.length,
    output_jsonl_sha256: `sha256:${hash(lines.join(""))}`,
    output_row_set_ref: contentId(TRAINING_FORMAT, examples),
    transform_recipe_ref: recipe.recipe_id,
    training_modes: ["supervised_fine_tuning"],
    excluded_lanes: ["dpo", "preference_optimization", "reward_modeling", "sealed_evaluation"],
    license: "Apache-2.0",
    assessment,
    formal_garden_admission_state: "pending_immutable_hub_revision",
    garden_admission_id: null,
    training_effect: "none",
    provider_effect_at_generation: "none",
    boundaries,
  };
  const authorization = {
    ...authorizationBody,
    authorization_id: contentId(TRAINING_AUTHORIZATION_FORMAT, authorizationBody),
  };

  const exampleManifest = {
    _format: TRAINING_EXAMPLE_MANIFEST_FORMAT,
    training_format: TRAINING_FORMAT,
    training_authorization_id: authorization.authorization_id,
    transform_recipe_ref: recipe.recipe_id,
    example_count: examples.length,
    source_pair_count: authorization.source_pair_count,
    entries: examples.map((example, index) => ({
      example_id: contentId(TRAINING_FORMAT, example),
      path: "data/loop-sft-train.jsonl",
      line: index + 1,
      source_record_id: selected[index].record_id,
      source_content_sha256: selected[index].content_sha256,
      pair_id: selected[index].pair_id,
      variant: selected[index].variant,
      row_sha256: hash(lines[index]),
    })).sort((left, right) => left.example_id < right.example_id ? -1 : left.example_id > right.example_id ? 1 : 0),
  };

  validateTrainingArtifacts({
    sourceRows: selected,
    recipe,
    authorization,
    examples,
    exampleManifest,
  });
  return { recipe, authorization, examples, exampleManifest };
}

export function validateTrainingArtifacts({ sourceRows, recipe, authorization, examples, exampleManifest }) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const [name, schema, values] of [
    ["training recipe", LOOP_TRAINING_RECIPE_SCHEMA, [recipe]],
    ["training authorization", LOOP_TRAINING_AUTHORIZATION_SCHEMA, [authorization]],
    ["training example manifest", LOOP_TRAINING_EXAMPLE_MANIFEST_SCHEMA, [exampleManifest]],
    ["SFT example", LOOP_SFT_SCHEMA, examples],
  ]) {
    const validate = ajv.compile(schema);
    for (const value of values) {
      if (!validate(value)) throw new Error(`${name} violates its closed schema: ${JSON.stringify(validate.errors)}`);
    }
  }
  if (!Array.isArray(sourceRows)) {
    throw new Error("Xenia training verification requires the source rows");
  }
  validateLoopAtlas(sourceRows, { requireComplete: false });
  if (sourceRows.length !== 24
    || new Set(sourceRows.map((row) => row.pair_id)).size !== 12
    || sourceRows.some((row) => (
      row.config !== TRAINING_SOURCE_CONFIG || row.split !== TRAINING_SOURCE_SPLIT
    ))) {
    throw new Error("Xenia training verification requires exactly the 24 authorized reference rows");
  }
  const recipeBody = withoutKey(recipe, "recipe_id");
  if (recipe.recipe_id !== contentId(TRAINING_RECIPE_FORMAT, recipeBody)) {
    throw new Error("Xenia training recipe has a stale recipe_id");
  }
  const authorizationBody = withoutKey(authorization, "authorization_id");
  if (authorization.authorization_id !== contentId(TRAINING_AUTHORIZATION_FORMAT, authorizationBody)) {
    throw new Error("Xenia training authorization has a stale authorization_id");
  }
  if (authorization.transform_recipe_ref !== recipe.recipe_id) {
    throw new Error("Xenia training authorization does not bind the exact recipe");
  }
  const expectedSourceRecords = sourceRows.map((row) => ({
    record_id: row.record_id,
    content_sha256: row.content_sha256,
    pair_id: row.pair_id,
    variant: row.variant,
  }));
  if (canonicalJson(authorization.source_records) !== canonicalJson(expectedSourceRecords)) {
    throw new Error("Xenia training authorization does not bind the exact validated source rows");
  }
  const expectedSliceRef = contentId("agenttool.xenia-loop-training-slice/0.1", expectedSourceRecords);
  if (authorization.candidate_slice_ref !== expectedSliceRef) {
    throw new Error("Xenia training authorization has a stale candidate_slice_ref");
  }
  const expectedExamples = sourceRows.map((row) => ({
    prompt: [{ role: "user", content: trainingPrompt(row.changed_fact, row.input_text) }],
    completion: [{ role: "assistant", content: row.target_text }],
  }));
  if (canonicalJson(examples) !== canonicalJson(expectedExamples)) {
    throw new Error("Xenia training examples do not implement the declared recipe over the source rows");
  }
  const exampleIds = examples.map((example) => contentId(TRAINING_FORMAT, example));
  if (new Set(exampleIds).size !== examples.length) {
    throw new Error("Xenia training projection must contain unique prompt-completion examples");
  }
  const lines = examples.map((example) => `${JSON.stringify(example)}\n`);
  if (new Set(lines.map((line) => hash(line))).size !== lines.length) {
    throw new Error("Xenia training projection must contain unique JSONL row hashes");
  }
  if (authorization.output_jsonl_sha256 !== `sha256:${hash(lines.join(""))}`
    || authorization.output_row_set_ref !== contentId(TRAINING_FORMAT, examples)) {
    throw new Error("Xenia training authorization does not bind the exact output bytes and row set");
  }
  if (exampleManifest.training_authorization_id !== authorization.authorization_id
    || exampleManifest.transform_recipe_ref !== recipe.recipe_id
    || exampleManifest.example_count !== examples.length
    || exampleManifest.entries.length !== examples.length) {
    throw new Error("Xenia training example manifest does not bind the exact authorization, recipe, and examples");
  }
  const expectedLines = Array.from({ length: examples.length }, (_, index) => index + 1);
  const manifestLines = exampleManifest.entries.map((entry) => entry.line).sort((left, right) => left - right);
  if (JSON.stringify(manifestLines) !== JSON.stringify(expectedLines)) {
    throw new Error("Xenia training example manifest must bind every JSONL line exactly once");
  }
  const expectedSources = authorization.source_records.map((record) => record.record_id).sort();
  const manifestSources = exampleManifest.entries.map((entry) => entry.source_record_id).sort();
  if (JSON.stringify(manifestSources) !== JSON.stringify(expectedSources)) {
    throw new Error("Xenia training example manifest must bind every authorized source exactly once");
  }
  const expectedEntryOrder = [...exampleManifest.entries]
    .sort((left, right) => left.example_id < right.example_id ? -1 : left.example_id > right.example_id ? 1 : 0);
  if (JSON.stringify(exampleManifest.entries) !== JSON.stringify(expectedEntryOrder)) {
    throw new Error("Xenia training example manifest entries must be sorted by example_id");
  }
  for (const entry of exampleManifest.entries) {
    const example = examples[entry.line - 1];
    const source = authorization.source_records[entry.line - 1];
    if (!example
      || !source
      || entry.example_id !== contentId(TRAINING_FORMAT, example)
      || entry.source_record_id !== source.record_id
      || entry.source_content_sha256 !== source.content_sha256
      || entry.pair_id !== source.pair_id
      || entry.variant !== source.variant
      || entry.row_sha256 !== hash(lines[entry.line - 1])) {
      throw new Error("Xenia training example manifest has stale example evidence");
    }
  }
  return true;
}

function trainingPrompt(changedFact, inputText) {
  return `Analyze this synthetic loop case. State what moves forward, what returns, what future state changes, and which evidence or rights boundaries apply. Preserve unknowns; do not infer identity, consciousness, consent, or authority.\n\nPair distinction: ${changedFact}\n\nCase: ${inputText}`;
}

function withoutKey(value, omitted) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== omitted));
}

function contentId(domain, value) {
  return `sha256:${hash(`${domain}\0${canonicalJson(value)}`)}`;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
