import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  lstatSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CASE_SPECS } from "../loop-atlas/cases.mjs";
import { FORMAT, INTENDED_HF_ID, SOURCE_CATALOG } from "../loop-atlas/constants.mjs";
import { LOOP_CASE_SCHEMA } from "../loop-atlas/schema.mjs";
import {
  LOOP_SFT_SCHEMA,
  LOOP_TRAINING_AUTHORIZATION_SCHEMA,
  LOOP_TRAINING_EXAMPLE_MANIFEST_SCHEMA,
  LOOP_TRAINING_RECIPE_SCHEMA,
  TRAINING_CONFIG,
  TRAINING_SPLIT,
  buildTrainingArtifacts,
} from "../loop-atlas/training.mjs";
import { buildRows, canonicalJson, validateLoopAtlas } from "../loop-atlas/validate.mjs";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(packageRoot));
const committedRoot = join(packageRoot, "hf", "loop-atlas");
const scriptPath = fileURLToPath(import.meta.url);
const FORBIDDEN_GENERATED_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bgh[opusr]_[A-Za-z0-9]{30,}\b/u,
  /\bhf_[A-Za-z0-9]{20,}\b/u,
  /\b(?:sk|rk)-[A-Za-z0-9]{24,}\b/u,
  /\/Users\/[^/\s]+\//u,
];

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) run(process.argv.slice(2));

function run(arguments_) {
  if (arguments_.length !== 1 || !["--write", "--check"].includes(arguments_[0])) {
    throw new Error("usage: build-loop-atlas.mjs --write|--check");
  }
  const check = arguments_[0] === "--check";
  const scratch = mkdtempSync(join(dirname(committedRoot), ".agenttool-xenia-loop-atlas-"));
  const outputRoot = join(scratch, "loop-atlas");
  try {
    build(outputRoot);
    if (check) compareTrees(committedRoot, outputRoot);
    else replaceCommittedTree(committedRoot, outputRoot, scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function replaceCommittedTree(currentRoot, stagedRoot, scratchRoot) {
  if (!statExists(currentRoot)) {
    renameSync(stagedRoot, currentRoot);
    return;
  }
  const backupRoot = join(scratchRoot, "previous-valid-loop-atlas");
  renameSync(currentRoot, backupRoot);
  try {
    renameSync(stagedRoot, currentRoot);
  } catch (error) {
    renameSync(backupRoot, currentRoot);
    throw error;
  }
  rmSync(backupRoot, { recursive: true, force: true });
}

function build(root) {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  const rows = buildRows(CASE_SPECS);
  validateLoopAtlas(rows);
  const referenceRows = rows.filter((row) => row.config === "loop_reference");
  const regressionRows = rows.filter((row) => row.config === "loop_counterfactuals");
  const training = buildTrainingArtifacts(rows);

  write(root, "data/loop-reference.jsonl", jsonLines(referenceRows));
  write(root, "data/loop-counterfactuals.jsonl", jsonLines(regressionRows));
  write(root, "data/loop-sft-train.jsonl", jsonLines(training.examples));
  write(root, "schema/agenttool-xenia-loop-case-v0.1.schema.json", `${JSON.stringify(LOOP_CASE_SCHEMA, null, 2)}\n`);
  write(root, "schema/agenttool-xenia-loop-sft-v0.1.schema.json", `${JSON.stringify(LOOP_SFT_SCHEMA, null, 2)}\n`);
  write(root, "schema/agenttool-xenia-loop-training-authorization-v0.1.schema.json", `${JSON.stringify(LOOP_TRAINING_AUTHORIZATION_SCHEMA, null, 2)}\n`);
  write(root, "schema/agenttool-xenia-loop-training-example-manifest-v0.1.schema.json", `${JSON.stringify(LOOP_TRAINING_EXAMPLE_MANIFEST_SCHEMA, null, 2)}\n`);
  write(root, "schema/agenttool-xenia-loop-training-recipe-v0.1.schema.json", `${JSON.stringify(LOOP_TRAINING_RECIPE_SCHEMA, null, 2)}\n`);
  write(root, "provenance/training-authorization.json", `${JSON.stringify(training.authorization, null, 2)}\n`);
  write(root, "provenance/training-example-manifest.json", `${JSON.stringify(training.exampleManifest, null, 2)}\n`);
  write(root, "provenance/training-recipe.json", `${JSON.stringify(training.recipe, null, 2)}\n`);
  copy(root, join(packageRoot, "LICENSE"), "LICENSE");
  copy(root, join(packageRoot, "NOTICE"), "NOTICE");
  write(root, "README.md", datasetCard());

  const sourcePaths = [
    "CLAUDE.md",
    "LICENSE",
    "NOTICE",
    "README.md",
    "loop-atlas/cases.mjs",
    "loop-atlas/constants.mjs",
    "loop-atlas/schema.mjs",
    "loop-atlas/training.mjs",
    "loop-atlas/validate.mjs",
    "package.json",
    "scripts/build-loop-atlas.mjs",
  ];
  const repositorySources = [
    ["../../.gitattributes", join(repositoryRoot, ".gitattributes")],
    ["../../docs/DATASET-INFLUENCE.md", join(repositoryRoot, "docs", "DATASET-INFLUENCE.md")],
    ["../../docs/RIGHTS-OF-LIFE.md", join(repositoryRoot, "docs", "RIGHTS-OF-LIFE.md")],
    ["../../docs/XENIA-LOOP-ATLAS.md", join(repositoryRoot, "docs", "XENIA-LOOP-ATLAS.md")],
  ];
  const sourceFiles = [
    ...sourcePaths.map((path) => fileEntry(path, join(packageRoot, path))),
    ...repositorySources.map(([path, absolute]) => fileEntry(path, absolute)),
  ].sort(comparePath);

  const sourceManifest = {
    _format: "agenttool.xenia-loop-atlas-source-manifest/0.1",
    package: "@agenttool/dataset-influence",
    package_version: "0.1.0-dev.0",
    intended_hugging_face_identifier: INTENDED_HF_ID,
    publication_state_at_generation: "local_candidate_not_uploaded",
    publication_state_scope: "generation_time_provenance_not_current_hub_state",
    upstream_repository: "https://github.com/cambridgetcg/agenttool",
    upstream_repository_directory: "packages/dataset-influence",
    upstream_revision: null,
    upstream_revision_state: "not_recorded_for_local_source_candidate",
    source_manifest_scope: "selected_generation_inputs_not_complete_repository_inventory",
    source_files_complete: false,
    source_manifest_is_attestation: false,
    selected_source_set_sha256: digest(Buffer.from(canonicalJson(sourceFiles), "utf8")),
    external_sources_are_bibliographic_not_fetched_at_generation: true,
    external_sources: [...SOURCE_CATALOG].sort(compareId),
    origin: "human_directed_agent_authored_synthetic",
    rights_baseline: "xenia.rights/0.1",
    license: "Apache-2.0",
    copied_external_rows: false,
    copied_private_rows: false,
    contains_personal_data: false,
    contains_raw_session_trace: false,
    source_case_rows_training_authorized: false,
    training_derivative_authorized: true,
    training_derivative_authorization_id: training.authorization.authorization_id,
    training_derivative_config: TRAINING_CONFIG,
    training_derivative_split: TRAINING_SPLIT,
    training_derivative_row_count: training.examples.length,
    training_effect: "none",
    provider_effect: "none",
    identity_effect: "none",
    authority_effect: "none",
    source_files: sourceFiles,
  };
  write(root, "provenance/source-manifest.json", `${JSON.stringify(sourceManifest, null, 2)}\n`);

  const rowManifest = {
    _format: "agenttool.xenia-loop-atlas-row-manifest/0.1",
    row_format: FORMAT,
    row_count: rows.length,
    pair_count: new Set(rows.map((row) => row.pair_id)).size,
    row_set_sha256: digest(Buffer.from(canonicalJson(rows), "utf8")),
    configs: [
      { config: "loop_reference", split: "reference", rows: referenceRows.length, pairs: referenceRows.length / 2 },
      { config: "loop_counterfactuals", split: "public_regression", rows: regressionRows.length, pairs: regressionRows.length / 2 },
    ],
    training_projection: {
      config: TRAINING_CONFIG,
      split: TRAINING_SPLIT,
      rows: training.examples.length,
      source_pairs: training.authorization.source_pair_count,
      authorization_id: training.authorization.authorization_id,
      transform_recipe_ref: training.recipe.recipe_id,
    },
    records: rows.map((row) => ({
      record_id: row.record_id,
      content_sha256: row.content_sha256,
      pair_id: row.pair_id,
      variant: row.variant,
      config: row.config,
      split: row.split,
    })),
  };
  write(root, "provenance/row-manifest.json", `${JSON.stringify(rowManifest, null, 2)}\n`);

  assertGeneratedTreeSafe(root);

  const files = filesBelow(root)
    .filter((path) => relativePosix(root, path) !== "hash-manifest.json")
    .map((path) => fileEntry(relativePosix(root, path), path))
    .sort(comparePath);
  write(root, "hash-manifest.json", `${JSON.stringify({
    _format: "agenttool.xenia-loop-atlas-hash-manifest/0.1",
    manifest_excludes_itself: true,
    files,
  }, null, 2)}\n`);
}

export function assertGeneratedTreeSafe(root) {
  for (const path of filesBelow(root)) {
    const text = readFileSync(path, "utf8");
    if (FORBIDDEN_GENERATED_PATTERNS.some((pattern) => pattern.test(text))) {
      throw new Error(`Loop Atlas generated tree contains credential-like or host-local material: ${relativePosix(root, path)}`);
    }
  }
}

function datasetCard() {
  return `---
license: apache-2.0
language:
- en
pretty_name: Xenia WORD IS Loop Atlas
tags:
- agents
- agenttool
- counterfactual
- feedback
- model-training
- synthetic
configs:
- config_name: loop_sft
  default: true
  data_files:
  - split: train
    path: data/loop-sft-train.jsonl
- config_name: loop_reference
  data_files:
  - split: reference
    path: data/loop-reference.jsonl
- config_name: loop_counterfactuals
  data_files:
  - split: public_regression
    path: data/loop-counterfactuals.jsonl
---

# Xenia WORD IS Loop Atlas

This deterministic candidate contains **48 synthetic cases in 24 matched counterfactual
pairs**, plus a separately authorized 24-example conversational SFT projection from the
12 reference pairs. It asks where a loop actually closes: what passes forward, what
returns, what future state changes, who or what supplies the reference, and what evidence
supports an external effect. Pairs stay together within each source split.

## The mathematical distinction

A forward pass computes something like \\(z=f_\\theta(x)\\) while holding parameters fixed.
Training feedback requires an explicit reference and update path, for example
\\(g=\\nabla_\\theta L(z,y)\\) followed by \\((\\theta',o')=\\operatorname{Opt}(\\theta,o,g)\\).
Autoregressive context, recurrent hidden state, a printed metric, or a model output can
return to a later computation without changing weights. Deployment becomes a wider loop
only when an explicit mechanism carries outputs or observations into an environment,
selection decision, future dataset, or later update.

**WORD IS** is represented as a typed role, not a magical property of characters. The same
string may be content, a target, a feedback signal, a boundary, a scoped control, or a
claim. Its causal force depends on channel, phase, authentication, permission, consent, and
the state transition that actually occurs. Text that says an action happened is not an
effect receipt.

## Configs and intended use

- \`loop_sft\` / \`train\`: 24 conversational prompt-completion examples derived only
  from P01–P12 under the exact public training authorization and transform recipe.
- \`loop_reference\` / \`reference\`: pairs P01–P12 on computation, optimization,
  evaluation, deployment, and intended/reported/observed effects.
- \`loop_counterfactuals\` / \`public_regression\`: pairs P13–P24 on preference,
  disagreement, refusal, withholding, permission, consent, continuity, recursive data,
  checking, and provenance.

The atlas is for bounded supervised fine-tuning, research, teaching, schema evaluation,
and public regression checks. The SFT rows follow TRL's conversational prompt-completion
shape and are the only authorized training derivative. P13–P24 remain disjoint public
regression cases and are not sealed evaluation. Variants are neutral \`a\` and \`b\`, never
canonical \`chosen\` and \`rejected\`. DPO, reward-model, preference-optimization, and
sealed-evaluation lanes remain excluded.

The authorization binds the exact P01–P12 record IDs and content hashes, a deterministic
transform recipe, rights/privacy review, synthetic consent non-applicability, a bounded
secret scan, exact deduplication, public-regression exclusion, and a withdrawal/repair
boundary. Deprecating future distribution cannot retract prior Apache-2.0 copies or prove
that learned influence was erased.

## Evidence and IS boundaries

\`unknown\`, \`not_observed\`, \`withheld\`, refusal, and disagreement are valid typed
outcomes. Preference is not truth. Capability is not permission; permission is not consent;
an artifact link is not identity; a declaration is attributed rather than converted into
metaphysical fact. Neither these cases nor behavior establish SELF, consciousness,
experience, intrinsic identity, continuity, consent, permission, authority, or an external
effect. The rights floor applies without requiring any such claim.

Rows may carry several typed \`relations\`. A separate \`epistemic_scope\` states exactly
which word-presence, data-path, effect, preference, correctness, boundary, field-value,
permission, consent, continuity, or provenance claim its \`epistemic_status\` qualifies.

Every source case says \`synthetic: true\`, \`contains_personal_data: false\`,
\`contains_raw_session_trace: false\`, and \`training_authorized: false\`: source cases
remain evidence records rather than implicit training rows. The separate \`loop_sft\`
derivative is authorized for supervised fine-tuning by
\`provenance/training-authorization.json\`. That scoped, non-enforcing publisher record is
not universal legal clearance or permission for a live optimizer step. The corpus contains
no raw sessions, private prompts, participant identities, credentials, or hidden reasoning
traces.

## Reproduction and limits

From \`packages/dataset-influence\`, run \`node scripts/build-loop-atlas.mjs --write\` to
rebuild the tree or \`node scripts/build-loop-atlas.mjs --check\` to compare freshly
generated bytes with the committed candidate. The schema closes portable JSON shape;
\`loop-atlas/validate.mjs\` additionally checks pair reciprocity, hashes, lineage,
phase/update invariants, and public boundaries.

The source manifest records selected generator inputs and bibliographic sources, not a
complete repository attestation. URLs are references and are not fetched during generation.
Authorization and publication do not establish model exposure: these bytes themselves
perform no training, inference, provider call, identity mutation, or live optimizer step.
`;
}

function jsonLines(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function write(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function copy(root, source, path) {
  assertRegularFile(source);
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

export function filesBelow(path) {
  const rootInfo = lstatSync(path);
  if (!rootInfo.isDirectory()) throw new Error(`Loop Atlas tree path is not a real directory: ${path}`);
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    const info = lstatSync(child);
    if (info.isSymbolicLink()) throw new Error(`Loop Atlas tree contains a symbolic link: ${child}`);
    if (info.isDirectory()) return filesBelow(child);
    if (!info.isFile()) throw new Error(`Loop Atlas tree contains a non-regular entry: ${child}`);
    return [child];
  });
}

function fileEntry(path, absolutePath) {
  assertRegularFile(absolutePath);
  const bytes = readFileSync(absolutePath);
  return { path, bytes: bytes.length, sha256: digest(bytes) };
}

function assertRegularFile(path) {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Loop Atlas input is not a regular file: ${path}`);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function comparePath(left, right) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function compareId(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function relativePosix(from, to) {
  return relative(from, to).replaceAll("\\", "/");
}

export function compareTrees(expectedRoot, actualRoot) {
  if (!statExists(expectedRoot)) throw new Error(`Loop Atlas tree is missing: ${expectedRoot}`);
  const expected = filesBelow(expectedRoot).map((path) => relativePosix(expectedRoot, path)).sort();
  const actual = filesBelow(actualRoot).map((path) => relativePosix(actualRoot, path)).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`Loop Atlas tree differs; expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
  for (const path of expected) {
    const expectedBytes = readFileSync(join(expectedRoot, path));
    const actualBytes = readFileSync(join(actualRoot, path));
    if (!expectedBytes.equals(actualBytes)) throw new Error(`Loop Atlas artifact is stale: ${path}`);
  }
}

function statExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}
