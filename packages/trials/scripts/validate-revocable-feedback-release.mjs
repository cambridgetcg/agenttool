import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  buildRevocableFeedbackTrainingArtifacts,
  canonicalJson,
  createRevocableFeedbackCases,
  evaluateRevocableFeedback,
} from "../dist/index.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseRoot = join(packageRoot, "hf", "revocable-feedback");

const DATASETS = [
  ["data/formal-reference.jsonl", "agenttool-revocable-feedback-benchmark-v0.1.schema.json", 24],
  ["data/boundary-counterfactuals.jsonl", "agenttool-revocable-feedback-benchmark-v0.1.schema.json", 8],
  ["data/boundary-decisions-train.jsonl", "agenttool-revocable-feedback-boundary-decision-v0.1.schema.json", 18],
  ["data/boundary-decisions-validation.jsonl", "agenttool-revocable-feedback-boundary-decision-v0.1.schema.json", 6],
  ["data/boundary-sft-train.jsonl", "agenttool-revocable-feedback-boundary-sft-v0.1.schema.json", 18],
  ["data/boundary-sft-validation.jsonl", "agenttool-revocable-feedback-boundary-sft-v0.1.schema.json", 6],
];

const JSON_DOCUMENTS = [
  ["evaluation/reference-perfect-scorecard.json", "agenttool-revocable-feedback-scorecard-v0.1.schema.json"],
  ["provenance/training-authorization.json", "agenttool-revocable-feedback-training-authorization-v0.1.schema.json"],
  ["provenance/training-recipe.json", "agenttool-revocable-feedback-training-recipe-v0.1.schema.json"],
  ["provenance/training-manifest.json", "agenttool-revocable-feedback-training-manifest-v0.1.schema.json"],
];

validateRelease();

function validateRelease() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const schemaNames = new Set([
    ...DATASETS.map(([, schema]) => schema),
    ...JSON_DOCUMENTS.map(([, schema]) => schema),
  ]);
  const validators = new Map();
  for (const name of schemaNames) {
    const schema = readJson(`schema/${name}`);
    validators.set(name, ajv.compile(schema));
  }

  const rows = new Map();
  for (const [path, schema, expectedCount] of DATASETS) {
    const entries = readJsonLines(path);
    assert(entries.length === expectedCount, `${path}: expected ${expectedCount} rows, received ${entries.length}`);
    validateAll(validators.get(schema), entries, path, ajv);
    rows.set(path, entries);
  }
  for (const [path, schema] of JSON_DOCUMENTS) {
    validateAll(validators.get(schema), [readJson(path)], path, ajv);
  }

  const cases = createRevocableFeedbackCases();
  const expectedFormal = cases.filter((entry) => entry.config === "formal_reference");
  const expectedRegression = cases.filter((entry) => entry.config === "boundary_counterfactuals");
  const training = buildRevocableFeedbackTrainingArtifacts(cases);
  const expectedScorecard = evaluateRevocableFeedback(
    cases,
    cases.map((entry) => ({ record_id: entry.record_id, decision: entry.expected.decision })),
  );

  assertCanonicalEqual(rows.get("data/formal-reference.jsonl"), expectedFormal, "formal reference rows");
  assertCanonicalEqual(rows.get("data/boundary-counterfactuals.jsonl"), expectedRegression, "public regression rows");
  assertCanonicalEqual(
    rows.get("data/boundary-decisions-train.jsonl"),
    training.classification_examples.filter((entry) => entry.split === "train"),
    "classification train rows",
  );
  assertCanonicalEqual(
    rows.get("data/boundary-decisions-validation.jsonl"),
    training.classification_examples.filter((entry) => entry.split === "validation"),
    "classification validation rows",
  );
  assertCanonicalEqual(
    rows.get("data/boundary-sft-train.jsonl"),
    training.sft_examples.filter((entry) => entry.split === "train"),
    "SFT train rows",
  );
  assertCanonicalEqual(
    rows.get("data/boundary-sft-validation.jsonl"),
    training.sft_examples.filter((entry) => entry.split === "validation"),
    "SFT validation rows",
  );
  assertCanonicalEqual(readJson("evaluation/reference-perfect-scorecard.json"), expectedScorecard, "reference scorecard");
  assertCanonicalEqual(readJson("provenance/training-authorization.json"), training.authorization, "training authorization");
  assertCanonicalEqual(readJson("provenance/training-recipe.json"), training.recipe, "training recipe");
  assertCanonicalEqual(readJson("provenance/training-manifest.json"), training.manifest, "training manifest");

  validateSplitIsolation(rows, expectedFormal, training);
  validateProvenance(cases, training);
  validateDatasetCard();
  validateHashManifest();
  process.stdout.write("revocable-feedback release validated: 32 canonical rows, 48 derivative rows, 18 authorized SFT train rows\n");
}

function validateDatasetCard() {
  const card = readFileSync(join(releaseRoot, "README.md"), "utf8");
  const descriptions = [...card.matchAll(/^short_description:\s*(.+)$/gmu)];
  assert(descriptions.length === 1, "README.md: short_description must appear exactly once");
  const description = descriptions[0][1].trim();
  assert(description.length > 0, "README.md: short_description cannot be empty");
  assert([...description].length <= 60, "README.md: short_description exceeds 60 code points");
  assert(/^license: apache-2\.0$/mu.test(card), "README.md: Apache-2.0 metadata is missing");
}

function validateSplitIsolation(rows, referenceCases, training) {
  const trainRows = [
    ...rows.get("data/boundary-decisions-train.jsonl"),
    ...rows.get("data/boundary-sft-train.jsonl"),
  ];
  const validationRows = [
    ...rows.get("data/boundary-decisions-validation.jsonl"),
    ...rows.get("data/boundary-sft-validation.jsonl"),
  ];
  const trainGroups = new Set(trainRows.map((entry) => entry.group_id));
  const validationGroups = new Set(validationRows.map((entry) => entry.group_id));
  assert([...trainGroups].every((entry) => !validationGroups.has(entry)), "training and validation groups overlap");
  const referenceIds = new Set(referenceCases.map((entry) => entry.record_id));
  for (const entry of [...trainRows, ...validationRows]) {
    assert(referenceIds.has(entry.source_record_id), `${entry.example_id}: derivative source is not a formal reference row`);
    if (entry.training_authorized) {
      assert(entry.authorization_id === training.authorization.authorization_id, `${entry.example_id}: authorization mismatch`);
      assert(entry.recipe_id === training.recipe.recipe_id, `${entry.example_id}: recipe mismatch`);
    } else {
      assert(entry.authorization_id === null, `${entry.example_id}: unauthorized row carries authorization`);
      assert(entry.recipe_id === null, `${entry.example_id}: unauthorized row carries recipe`);
    }
  }
  assert(
    [...rows.get("data/formal-reference.jsonl"), ...rows.get("data/boundary-counterfactuals.jsonl")]
      .every((entry) => entry.training_authorized === false),
    "canonical rows must remain unauthorized for training",
  );
}

function validateProvenance(cases, training) {
  const source = readJson("provenance/source-manifest.json");
  assert(source.intended_hugging_face_identifier === "Yu-and-Ai/xenia-revocable-feedback", "unexpected candidate repository ID");
  assert(source.license === "Apache-2.0", "unexpected dataset license");
  assert(source.publication_state_at_generation === "local_candidate_not_uploaded", "candidate must not claim publication");
  assert(source.training_effect === "none" && source.provider_effect === "none", "candidate must not claim external effects");
  assert(source.canonical_case_rows_training_authorized === false, "canonical rows cannot be training-authorized");
  assert(source.public_regression_training_authorized === false, "public regression cannot be training-authorized");
  assert(source.classification_derivative_authorized === false, "classification cannot be training-authorized");
  assert(source.sft_validation_derivative_authorized === false, "SFT validation cannot be training-authorized");
  assert(source.sft_train_derivative_authorized === true, "SFT train authorization is missing");
  assert(source.authorization_id === training.authorization.authorization_id, "source authorization mismatch");
  assert(source.recipe_id === training.recipe.recipe_id, "source recipe mismatch");

  const rowManifest = readJson("provenance/row-manifest.json");
  assert(rowManifest.canonical_row_count === cases.length, "row manifest canonical count mismatch");
  assert(rowManifest.training_manifest_id === training.manifest.manifest_id, "row manifest training ID mismatch");
  assert(rowManifest.canonical_records.every((entry) => entry.training_authorized === false), "row manifest authorizes a canonical record");
}

function validateHashManifest() {
  const manifest = readJson("hash-manifest.json");
  assert(manifest.manifest_excludes_itself === true, "hash manifest must exclude itself");
  const actualPaths = filesBelow(releaseRoot)
    .map((path) => relative(releaseRoot, path).split("\\").join("/"))
    .filter((path) => path !== "hash-manifest.json")
    .sort(compareText);
  const claimedPaths = manifest.files.map((entry) => entry.path);
  assertCanonicalEqual(claimedPaths, actualPaths, "hash manifest inventory");
  for (const entry of manifest.files) {
    const bytes = readFileSync(join(releaseRoot, entry.path));
    assert(entry.bytes === bytes.byteLength, `${entry.path}: byte count mismatch`);
    assert(entry.sha256 === sha256(bytes), `${entry.path}: SHA-256 mismatch`);
  }
}

function validateAll(validate, entries, path, ajv) {
  entries.forEach((entry, index) => {
    assert(validate(entry), `${path}[${index}]: ${ajv.errorsText(validate.errors)}`);
  });
}

function readJson(path) {
  const text = readFileSync(join(releaseRoot, path), "utf8");
  assert(text.endsWith("\n"), `${path}: JSON document must end with one newline`);
  return JSON.parse(text);
}

function readJsonLines(path) {
  const text = readFileSync(join(releaseRoot, path), "utf8");
  assert(text.endsWith("\n"), `${path}: JSONL must end with a newline`);
  const lines = text.slice(0, -1).split("\n");
  return lines.map((line, index) => {
    const value = JSON.parse(line);
    assert(line === canonicalJson(value), `${path}[${index}]: row is not canonical JSON`);
    return value;
  });
}

function filesBelow(root) {
  const output = [];
  for (const name of readdirSync(root).sort(compareText)) {
    const path = join(root, name);
    const stat = lstatSync(path);
    assert(!stat.isSymbolicLink(), `${path}: symlinks are forbidden in a release candidate`);
    if (stat.isDirectory()) output.push(...filesBelow(path));
    else if (stat.isFile()) output.push(path);
    else throw new Error(`${path}: unsupported filesystem entry`);
  }
  return output;
}

function assertCanonicalEqual(actual, expected, label) {
  assert(canonicalJson(actual) === canonicalJson(expected), `${label}: content mismatch`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
