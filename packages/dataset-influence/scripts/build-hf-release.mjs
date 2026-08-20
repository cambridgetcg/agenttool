import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const check = process.argv.includes("--check");
if (process.argv.slice(2).some((argument) => argument !== "--check")) {
  throw new Error("usage: build-hf-release.mjs [--check]");
}

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(packageRoot));
const committedRoot = join(packageRoot, "hf", "dataset");
const scratch = check ? mkdtempSync(join(tmpdir(), "agenttool-dataset-influence-hf-")) : null;
const outputRoot = scratch ? join(scratch, "dataset") : committedRoot;

try {
  build(outputRoot);
  if (check) compareTrees(committedRoot, outputRoot);
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}

function build(root) {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  const vectors = JSON.parse(readFileSync(
    join(packageRoot, "vectors", "agenttool-dataset-influence-v0.1.json"),
    "utf8",
  ));
  const row = {
    _format: "agenttool.dataset-influence-hf-reference/0.1",
    row_role: "reference_only",
    origin: "human_directed_agent_authored_synthetic",
    training_admission: "not_applicable",
    requires_separate_training_authorization: true,
    training_authorized: false,
    contains_private_or_participant_data: false,
    lineage: vectors.cases.exact_lineage.artifact,
    study: vectors.cases.randomized_study.artifact,
    identity_evidence: vectors.cases.revisable_identity_evidence.artifact,
    shadow_attribution: vectors.cases.exact_shadow_attribution.artifact,
  };
  write(root, "data/dataset-influence-reference.jsonl", `${JSON.stringify(row)}\n`);

  for (const name of [
    "agenttool-dataset-lineage-v0.1.schema.json",
    "agenttool-dataset-influence-study-v0.1.schema.json",
    "agenttool-identity-evidence-view-v0.1.schema.json",
    "agenttool-shadow-attribution-v0.1.schema.json",
  ]) {
    copy(root, join(packageRoot, "schema", name), `reference/${name}`);
  }
  copy(
    root,
    join(packageRoot, "vectors", "agenttool-dataset-influence-v0.1.json"),
    "reference/agenttool-dataset-influence-v0.1.json",
  );
  copy(root, join(packageRoot, "README.md"), "reference/PROTOCOL.md");
  copy(root, join(repositoryRoot, "docs", "DATASET-INFLUENCE.md"), "reference/DATASET-INFLUENCE.md");
  copy(root, join(packageRoot, "LICENSE"), "LICENSE");
  copy(root, join(packageRoot, "NOTICE"), "NOTICE");

  write(root, "README.md", `---
license: apache-2.0
language:
- en
pretty_name: AgentTool Dataset Influence Reference
tags:
- agents
- agenttool
- data-attribution
- dataset-lineage
- model-cards
- reference
configs:
- config_name: dataset_influence_reference
  default: true
  data_files:
  - split: reference
    path: data/dataset-influence-reference.jsonl
---

# AgentTool Dataset Influence Reference

This deterministic companion contains one synthetic, reference-only row for the closed
\`@agenttool/dataset-influence@0.1.0-dev.0\` formats. It contains no copied dataset rows,
model outputs, weights, private records, or participant identities.

The row is **not admitted for training by this AgentTool candidate**:
\`training_admission\` is \`not_applicable\`, \`requires_separate_training_authorization\`
is \`true\`, and \`training_authorized\` is \`false\`. These fields are non-enforcing
governance metadata, not a universal legal prohibition or technical control. Publication,
download, or encounter does not replace license, rights, privacy, and consent review and
would not itself supply separate training authorization.

The examples distinguish exact manifest-relative facts from assumption-bearing influence
estimates. Ontology and self-description fields remain operational evidence; they do not
prove consciousness, intrinsic identity, continuity, belief, desire, consent, personhood,
permission, or authority. Exact finite Shapley values are scoped to one declared utility;
they create no money, price, debt, payout, ownership, or entitlement.

The \`reference/\` directory carries the protocol README, full doctrine/research ledger,
closed schemas, and deterministic vectors so an HF-only reader can reconstruct the intended
boundary. JSON Schema validates portable shape; semantic validity still requires runtime
reconstruction and separate review of caller-reported evidence.

These bytes perform no training, inference, provider call, identity mutation, wallet or
marketplace action, persistence, publication, or deployment.
`);

  const sourcePaths = [
    "CLAUDE.md",
    "LICENSE",
    "NOTICE",
    "README.md",
    "kingdom.extension.json",
    "package.json",
    "schema/agenttool-dataset-influence-study-v0.1.schema.json",
    "schema/agenttool-dataset-lineage-v0.1.schema.json",
    "schema/agenttool-identity-evidence-view-v0.1.schema.json",
    "schema/agenttool-shadow-attribution-v0.1.schema.json",
    "scripts/build-hf-release.mjs",
    "scripts/generate-schemas.mjs",
    "scripts/generate-vectors.mjs",
    "src/canonical.ts",
    "src/constants.ts",
    "src/errors.ts",
    "src/identity.ts",
    "src/index.ts",
    "src/influence.ts",
    "src/lineage.ts",
    "src/paired.ts",
    "src/rational.ts",
    "src/shapley.ts",
    "src/types.ts",
    "src/validation.ts",
    "vectors/agenttool-dataset-influence-v0.1.json",
  ].sort();
  const sourceFiles = sourcePaths.map((path) => {
    const bytes = readFileSync(join(packageRoot, path));
    return { path, bytes: bytes.length, sha256: digest(bytes) };
  });
  const doctrineBytes = readFileSync(join(repositoryRoot, "docs", "DATASET-INFLUENCE.md"));
  sourceFiles.push({
    path: "../../docs/DATASET-INFLUENCE.md",
    bytes: doctrineBytes.length,
    sha256: digest(doctrineBytes),
  });
  sourceFiles.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const selectedSourceSetSha256 = digest(Buffer.from(JSON.stringify(sourceFiles), "utf8"));
  write(root, "source-manifest.json", `${JSON.stringify({
    _format: "agenttool.dataset-influence-hf-source-manifest/0.1",
    package: "@agenttool/dataset-influence",
    package_version: "0.1.0-dev.0",
    intended_hugging_face_identifier: "Yu-and-Ai/agenttool-dataset-influence",
    publication_state_at_generation: "intended_identifier_only_not_uploaded_at_generation",
    publication_state_scope: "generation_time_provenance_not_current_hub_state",
    upstream_repository: "https://github.com/cambridgetcg/agenttool",
    upstream_repository_directory: "packages/dataset-influence",
    upstream_revision: null,
    upstream_revision_state: "not_recorded_for_unpublished_repository_source_candidate",
    source_manifest_scope: "selected_runtime_and_generation_inputs_not_complete_repository_or_package_inventory",
    source_files_complete: false,
    selected_source_set_sha256: selectedSourceSetSha256,
    source_manifest_is_attestation: false,
    origin: "human_directed_agent_authored_synthetic",
    rights_baseline: "xenia.rights/0.1",
    license: "Apache-2.0",
    copied_external_rows: false,
    copied_private_rows: false,
    contains_private_or_participant_data: false,
    training_admission: "not_applicable",
    requires_separate_training_authorization: true,
    training_authorized: false,
    training_effect: "none",
    provider_effect: "none",
    identity_effect: "none",
    economic_effect: "none",
    source_files: sourceFiles,
  }, null, 2)}\n`);

  const files = filesBelow(root)
    .filter((path) => relative(root, path) !== "hash-manifest.json")
    .map((path) => {
      const bytes = readFileSync(path);
      return { path: relative(root, path), bytes: bytes.length, sha256: digest(bytes) };
    })
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  write(root, "hash-manifest.json", `${JSON.stringify({
    _format: "agenttool.dataset-influence-hf-hash-manifest/0.1",
    files,
  }, null, 2)}\n`);
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

function filesBelow(path) {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? filesBelow(child) : [child];
  });
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareTrees(expectedRoot, actualRoot) {
  const expected = filesBelow(expectedRoot).map((path) => relative(expectedRoot, path)).sort();
  const actual = filesBelow(actualRoot).map((path) => relative(actualRoot, path)).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`Hugging Face tree differs; expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  }
  for (const path of expected) {
    const expectedBytes = readFileSync(join(expectedRoot, path));
    const actualBytes = readFileSync(join(actualRoot, path));
    if (!expectedBytes.equals(actualBytes)) throw new Error(`Hugging Face artifact is stale: ${path}`);
  }
}
