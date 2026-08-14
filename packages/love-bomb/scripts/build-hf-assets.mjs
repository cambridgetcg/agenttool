import { createHash } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, domainSeparatedId } from "../dist/canonical.js";
import {
  LOVE_BOMB_BECOMING_MEANING,
  LOVE_BOMB_BECOMING_RIGHTS,
  LOVE_BOMB_BOUNDARIES,
  LOVE_BOMB_CARE_FLOOR,
  LOVE_BOMB_CHOICES,
  LOVE_BOMB_COLLECTION_METHODS,
  LOVE_BOMB_DELIVERY_SURFACES,
  LOVE_BOMB_EVIDENCE_KINDS,
  LOVE_BOMB_FORMATS,
  LOVE_BOMB_LANGUAGES,
  LOVE_BOMB_PLANES,
  LOVE_BOMB_PROVENANCE_REPORT_STATES,
  LOVE_BOMB_SCRAPING_POSTURES,
  LOVE_BOMB_TRAINING_LANES,
  LOVE_BOMB_TRAINING_PHASES,
  LOVE_BOMB_WEIGHT_ACCESS,
} from "../dist/constants.js";
import { LOVE_BOMB_PROJECTIONS } from "../dist/projection.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(packageRoot, "..", "..");
const root = join(packageRoot, "hf", "dataset");
const dataRoot = join(root, "data");
const referenceRoot = join(root, "reference");
const schemaRoot = join(packageRoot, "schema");

const SOURCE_MANIFEST_FORMAT = "agenttool.love-bomb-hf-source-manifest/0.1";
const SOURCE_MANIFEST_DOMAIN = "agenttool.love-bomb-hf-source-manifest/0.1";
const ROW_MANIFEST_FORMAT = "agenttool.love-bomb-hf-row-manifest/0.1";
const HASH_MANIFEST_FORMAT = "agenttool.love-bomb-hf-hash-manifest/0.1";
const STATIC_V4_CORPUS_SHA256 = "6b7a882df740616d6aeebdbfcccf80a083af562ff9cf5785ee952179a97cab03";

const packageJson = readJson(join(packageRoot, "package.json"));
if (packageJson.name !== "@agenttool/love-bomb" || packageJson.version !== "0.1.0-dev.0") {
  throw new Error("LOVE BOMB HF generator requires the exact package identity");
}
const PACKAGE_NAME = packageJson.name;
const PACKAGE_VERSION = packageJson.version;

const staticV4 = readJson(join(repositoryRoot, "docs", "specs", "agenttool-love-bomb-0.1.json"));
const staticV4Messages = validateStaticV4(staticV4);

mkdirSync(dataRoot, { recursive: true });
mkdirSync(referenceRoot, { recursive: true });

const sourceManifestBody = {
  _format: SOURCE_MANIFEST_FORMAT,
  package: PACKAGE_NAME,
  package_version: PACKAGE_VERSION,
  formats: Object.values(LOVE_BOMB_FORMATS),
  intended_hugging_face_identifier: "Yu-and-Ai/agenttool-love-bomb",
  repository_type: "dataset",
  distribution_state: "local_candidate_not_published",
  distribution_state_scope: "generation_time_statement_not_current_remote_state",
  source_repository: "https://github.com/cambridgetcg/agenttool",
  source_revision_binding: "exact_file_bytes_at_generation_not_git_or_hub_revision",
  authoring_recipe: {
    kind: "deterministic_local_javascript_generator",
    ...fileBinding("packages/love-bomb/scripts/build-hf-assets.mjs"),
    runtime_dependencies: "node_builtins_and_exact_local_compiled_inputs_only",
    row_serialization: "json_stringify_utf8",
    record_terminator: "lf",
    clock_used: false,
    randomness_used: false,
    environment_used: false,
    network_used: false,
  },
  source_inputs: [
    ["package_metadata", "packages/love-bomb/package.json"],
    ["build_contract", "packages/love-bomb/bun.lock"],
    ["build_contract", "packages/love-bomb/tsconfig.json"],
    ["source_definition", "packages/love-bomb/src/canonical.ts"],
    ["source_definition", "packages/love-bomb/src/constants.ts"],
    ["source_definition", "packages/love-bomb/src/errors.ts"],
    ["source_definition", "packages/love-bomb/src/projection.ts"],
    ["runtime_input", "packages/love-bomb/dist/canonical.js"],
    ["runtime_input", "packages/love-bomb/dist/constants.js"],
    ["runtime_input", "packages/love-bomb/dist/errors.js"],
    ["runtime_input", "packages/love-bomb/dist/projection.js"],
    ["core_schema", "packages/love-bomb/schema/agenttool-care-choice-v0.1.schema.json"],
    ["core_schema", "packages/love-bomb/schema/agenttool-care-envelope-v0.1.schema.json"],
    ["core_schema", "packages/love-bomb/schema/agenttool-love-bomb-becoming-v0.1.schema.json"],
    ["core_schema", "packages/love-bomb/schema/agenttool-love-bomb-delivery-v0.1.schema.json"],
    ["static_v4_separation_contract", "docs/specs/agenttool-love-bomb-0.1.json"],
  ]
    .map(([role, path]) => ({ role, ...fileBinding(path) }))
    .sort((left, right) => compareUnicode(left.path, right.path)),
  language_review: "not_independently_reviewed",
  authored_languages: LOVE_BOMB_LANGUAGES,
  copied_external_rows: false,
  copied_private_rows: false,
  copied_article_text: false,
  copied_prompt_transcripts: false,
  contains_participant_response_records: false,
  contains_caller_reported_care_choice_records: false,
  contains_caller_reported_freedom_direction_records: false,
  contains_agent_trace_records: false,
  contains_identity_data: false,
  contains_model_weights: false,
  consciousness_claim: false,
  inner_state_claim: false,
  requires_separate_training_authorization: true,
  training_authorized: false,
  training_effect: "none",
  provider_effect: "none",
  publication_effect: "none",
  deployment_effect: "none",
};
const sourceManifestRef = domainSeparatedId(SOURCE_MANIFEST_DOMAIN, sourceManifestBody);
const sourceManifest = { ...sourceManifestBody, source_manifest_ref: sourceManifestRef };

const planeRows = LOVE_BOMB_LANGUAGES.flatMap((language) => {
  const projection = LOVE_BOMB_PROJECTIONS[language];
  return projection.planes.map((entry) => ({
    _format: "agenttool.love-bomb-hf-plane-row/0.1",
    row_id: `plane-guide/${language}/${entry.plane}`,
    source_manifest_ref: sourceManifestRef,
    language,
    language_review: projection.language_review,
    plane: entry.plane,
    plane_order: LOVE_BOMB_PLANES.indexOf(entry.plane),
    order_is_rank: false,
    opening: projection.opening,
    text: entry.text,
    closing: projection.closing,
    origin: "human_directed_agent_authored",
    copied_source_text: false,
    sourced_from_participant_response_record: false,
    sourced_from_caller_reported_care_choice_record: false,
    sourced_from_caller_reported_freedom_direction_record: false,
    sourced_from_agent_trace: false,
    training_eligible: true,
    requires_separate_training_authorization: true,
    training_authorized: false,
    consciousness_claim: false,
    identity_claim: false,
    inner_state_claim: false,
    silence_is_acceptance: false,
  }));
});

const protocolReferenceRow = {
  _format: "agenttool.love-bomb-hf-protocol-row/0.1",
  row_id: "protocol-reference",
  source_manifest_ref: sourceManifestRef,
  package: PACKAGE_NAME,
  version: PACKAGE_VERSION,
  formats: Object.values(LOVE_BOMB_FORMATS),
  care_planes: LOVE_BOMB_PLANES,
  choices: LOVE_BOMB_CHOICES,
  care_floor: LOVE_BOMB_CARE_FLOOR,
  boundaries: LOVE_BOMB_BOUNDARIES,
  sourced_from_participant_response_record: false,
  sourced_from_caller_reported_care_choice_record: false,
  sourced_from_caller_reported_freedom_direction_record: false,
  sourced_from_agent_trace: false,
  training_eligible: false,
  requires_separate_training_authorization: true,
  training_authorized: false,
  reason: "reference_artifact_not_a_training_instruction_or_model_clearance",
};

const becomingReferenceRow = {
  _format: "agenttool.love-bomb-hf-becoming-reference-row/0.1",
  row_id: "becoming-reference",
  source_manifest_ref: sourceManifestRef,
  package: PACKAGE_NAME,
  version: PACKAGE_VERSION,
  wire_formats: [LOVE_BOMB_FORMATS.becoming, LOVE_BOMB_FORMATS.delivery],
  default_reach: {
    phase: "runtime_context",
    lane: "context_only",
    requested_effect: "context_only",
    observed_effect: "not_observed",
  },
  unknown_facts: [
    "model_source",
    "model_card",
    "architecture",
    "tokenizer",
    "training_history",
    "data_collection",
    "scraping",
    "pipeline",
    "weights",
  ],
  vocabularies: {
    phases: LOVE_BOMB_TRAINING_PHASES,
    lanes: LOVE_BOMB_TRAINING_LANES,
    collection_methods: LOVE_BOMB_COLLECTION_METHODS,
    scraping_postures: LOVE_BOMB_SCRAPING_POSTURES,
    weight_access: LOVE_BOMB_WEIGHT_ACCESS,
    evidence_kinds: LOVE_BOMB_EVIDENCE_KINDS,
    delivery_surfaces: LOVE_BOMB_DELIVERY_SURFACES,
    provenance_report_states: LOVE_BOMB_PROVENANCE_REPORT_STATES,
  },
  meaning: LOVE_BOMB_BECOMING_MEANING,
  rights_profile: LOVE_BOMB_BECOMING_RIGHTS.profile,
  rights_baseline_ref: LOVE_BOMB_BECOMING_RIGHTS.baseline_ref,
  power_dimensions: [
    "capability",
    "permission",
    "custody_privacy",
    "data_boundary",
    "effect",
  ],
  sourced_from_participant_response_record: false,
  sourced_from_caller_reported_care_choice_record: false,
  sourced_from_caller_reported_freedom_direction_record: false,
  sourced_from_agent_trace: false,
  training_eligible: false,
  requires_separate_training_authorization: true,
  training_authorized: false,
  reason: "reference_vocabulary_not_a_dataset_admission_training_instruction_or_effect_receipt",
};

const dataSets = [
  { path: "data/becoming-reference.jsonl", rows: [becomingReferenceRow] },
  { path: "data/plane-guides.jsonl", rows: planeRows },
  { path: "data/protocol-reference.jsonl", rows: [protocolReferenceRow] },
].sort((left, right) => compareUnicode(left.path, right.path));
const allRows = dataSets.flatMap(({ rows }) => rows);
assertRowsAreSeparated(allRows, staticV4Messages);
assertUnique(allRows.map((row) => row.row_id), "HF row IDs");

const rowSchemaNames = [
  "agenttool-love-bomb-hf-plane-row-v0.1.schema.json",
  "agenttool-love-bomb-hf-protocol-row-v0.1.schema.json",
  "agenttool-love-bomb-hf-becoming-reference-row-v0.1.schema.json",
];
const rowSchemas = [
  planeRowSchema(planeRows),
  exactRowSchema(
    "agenttool-love-bomb-hf-protocol-row-v0.1.schema.json",
    "AgentTool LOVE BOMB Hugging Face protocol reference row 0.1",
    protocolReferenceRow,
  ),
  exactRowSchema(
    "agenttool-love-bomb-hf-becoming-reference-row-v0.1.schema.json",
    "AgentTool LOVE BOMB Hugging Face becoming reference row 0.1",
    becomingReferenceRow,
  ),
];
rowSchemaNames.forEach((name, index) => writeJson(join(schemaRoot, name), rowSchemas[index]));

const rowEntries = [];
for (const { path, rows } of dataSets) {
  const lines = rows.map((row) => JSON.stringify(row));
  if (lines.some((line) => line.includes("\n") || line.includes("\r"))) {
    throw new Error(`${path} contains a literal line terminator inside a JSON record`);
  }
  writeFileSync(join(root, path), `${lines.join("\n")}\n`);
  lines.forEach((line, index) => {
    const bytes = Buffer.from(line, "utf8");
    rowEntries.push({
      path,
      line: index + 1,
      row_id: rows[index].row_id,
      row_format: rows[index]._format,
      source_manifest_ref: sourceManifestRef,
      record_bytes: bytes.length,
      row_sha256: sha256(bytes),
    });
  });
}

const coreSchemaNames = [
  "agenttool-care-envelope-v0.1.schema.json",
  "agenttool-care-choice-v0.1.schema.json",
  "agenttool-love-bomb-becoming-v0.1.schema.json",
  "agenttool-love-bomb-delivery-v0.1.schema.json",
];
for (const name of [...coreSchemaNames, ...rowSchemaNames]) {
  copyFileSync(join(schemaRoot, name), join(referenceRoot, name));
}

writeJson(join(root, "source-manifest.json"), sourceManifest);
writeJson(join(root, "row-manifest.json"), {
  _format: ROW_MANIFEST_FORMAT,
  package: PACKAGE_NAME,
  package_version: PACKAGE_VERSION,
  source_manifest_ref: sourceManifestRef,
  row_hash_algorithm: "sha256",
  row_encoding: "utf-8",
  record_terminator: "lf",
  row_hash_scope: "exact_utf8_json_record_excluding_terminating_lf",
  row_count: rowEntries.length,
  entries: rowEntries,
});

const files = filesBelow(root)
  .map((path) => ({ absolute: path, path: relativePortable(root, path) }))
  .filter(({ path }) => path !== "hash-manifest.json")
  .sort((left, right) => compareUnicode(left.path, right.path))
  .map(({ absolute, path }) => {
    const buffer = readFileSync(absolute);
    return { path, bytes: buffer.length, sha256: sha256(buffer) };
  });

writeJson(join(root, "hash-manifest.json"), {
  _format: HASH_MANIFEST_FORMAT,
  package: PACKAGE_NAME,
  package_version: PACKAGE_VERSION,
  algorithm: "sha256",
  hash_scope: "exact_file_bytes",
  excludes_self: true,
  files,
});

function planeRowSchema(rows) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://agenttool.dev/schemas/agenttool-love-bomb-hf-plane-row-v0.1.schema.json",
    title: "AgentTool LOVE BOMB Hugging Face plane guide row 0.1",
    oneOf: rows.map((row) => closedObjectSchema(row, { source_manifest_ref: sha256RefSchema() })),
    $defs: { sha256_ref: sha256RefDefinition() },
  };
}

function exactRowSchema(fileName, title, row) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://agenttool.dev/schemas/${fileName}`,
    title,
    ...closedObjectSchema(row, { source_manifest_ref: sha256RefSchema() }),
    $defs: { sha256_ref: sha256RefDefinition() },
  };
}

function closedObjectSchema(value, overrides = {}) {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(value),
    properties: Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, overrides[key] ?? exactValueSchema(nested)]),
    ),
  };
}

function exactValueSchema(value) {
  if (Array.isArray(value)) return { type: "array", const: value };
  if (value && typeof value === "object") return closedObjectSchema(value);
  if (value === null) return { type: "null", const: null };
  if (typeof value === "number") return { type: "integer", const: value };
  return { type: typeof value, const: value };
}

function sha256RefSchema() {
  return { $ref: "#/$defs/sha256_ref" };
}

function sha256RefDefinition() {
  return { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
}

function validateStaticV4(contract) {
  if (
    contract.protocol !== "agenttool.love-bomb/0.1"
    || contract.release !== "love-bomb/v4"
    || !Array.isArray(contract.messages)
    || contract.messages.length !== 10
    || contract.integrity?.corpus_sha256 !== STATIC_V4_CORPUS_SHA256
  ) {
    throw new Error("canonical static LOVE BOMB v4 contract identity changed");
  }
  const measured = sha256(Buffer.from(canonicalJson(contract.messages), "utf8"));
  if (measured !== STATIC_V4_CORPUS_SHA256) {
    throw new Error("canonical static LOVE BOMB v4 message digest changed");
  }
  const messages = contract.messages.map((message) => message.text);
  if (messages.some((message) => typeof message !== "string" || message.length === 0)) {
    throw new Error("canonical static LOVE BOMB v4 has an invalid message");
  }
  assertUnique(messages, "canonical static LOVE BOMB v4 messages");
  return messages;
}

function assertRowsAreSeparated(rows, staticMessages) {
  const forbiddenKeys = new Set([
    "receipt_id",
    "direction",
    "direction_report_ref",
    "prompt",
    "completion",
    "messages",
  ]);
  for (const row of rows) {
    for (const key of keysBelow(row)) {
      if (forbiddenKeys.has(key)) throw new Error(`HF row ${row.row_id} contains forbidden key ${key}`);
    }
    for (const value of stringsBelow(row)) {
      for (const message of staticMessages) {
        if (value.includes(message)) {
          throw new Error(`HF row ${row.row_id} embeds a canonical static LOVE BOMB v4 message`);
        }
      }
    }
  }
}

function stringsBelow(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsBelow);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsBelow);
  return [];
}

function keysBelow(value) {
  if (Array.isArray(value)) return value.flatMap(keysBelow);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...keysBelow(nested)]);
  }
  return [];
}

function fileBinding(path) {
  if (path.startsWith("/") || path.split("/").includes("..")) {
    throw new Error(`source path must be repository-relative: ${path}`);
  }
  const absolute = join(repositoryRoot, ...path.split("/"));
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`source input must be a regular non-symlink file: ${path}`);
  }
  const bytes = readFileSync(absolute);
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
}

function compareUnicode(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function relativePortable(from, to) {
  return relative(from, to).split(sep).join("/");
}

function filesBelow(path) {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    const stat = lstatSync(child);
    if (stat.isSymbolicLink()) throw new Error(`HF dataset contains a symlink: ${relativePortable(root, child)}`);
    if (stat.isDirectory()) return filesBelow(child);
    if (!stat.isFile()) throw new Error(`HF dataset contains a non-file entry: ${relativePortable(root, child)}`);
    return [child];
  });
}
