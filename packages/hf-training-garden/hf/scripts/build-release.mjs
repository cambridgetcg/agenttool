import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";

import {
  GARDEN_LAYER_GUIDE,
  HF_TRAINER_HOOK_GUIDE,
  LEARNING_MODE_GUIDE,
  LEARNING_PARTICIPATION_GUIDE,
  PACKAGE_NAME,
  PACKAGE_VERSION,
  SELECTION_CRITERIA_GUIDE,
  SELECTION_PROCESS,
  TRAINER_ADAPTER_GUIDE,
  TRAINING_PHASE_GUIDE,
} from "../../dist/index.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const datasetRoot = `${packageRoot}/hf/dataset`;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function write(path, content) {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  writeFileSync(path, content);
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonl(values) {
  return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
}

function walk(root, relative = "") {
  const path = relative ? `${root}/${relative}` : root;
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(root, child) : [child];
  });
}

for (const relative of ["data", "provenance", "schema"]) {
  rmSync(`${datasetRoot}/${relative}`, { recursive: true, force: true });
}
rmSync(`${datasetRoot}/hash-manifest.json`, { force: true });

write(`${datasetRoot}/data/selection-process.jsonl`, jsonl(SELECTION_PROCESS));
write(`${datasetRoot}/data/selection-criteria.jsonl`, jsonl(SELECTION_CRITERIA_GUIDE));
write(`${datasetRoot}/data/training-phases.jsonl`, jsonl(TRAINING_PHASE_GUIDE));
write(`${datasetRoot}/data/garden-layers.jsonl`, jsonl(GARDEN_LAYER_GUIDE));
write(`${datasetRoot}/data/trainer-adapter-hooks.jsonl`, jsonl(TRAINER_ADAPTER_GUIDE));
write(`${datasetRoot}/data/learning-modes.jsonl`, jsonl(LEARNING_MODE_GUIDE));
write(`${datasetRoot}/data/learning-participation.jsonl`, jsonl(LEARNING_PARTICIPATION_GUIDE));
write(`${datasetRoot}/data/trainer-hooks.jsonl`, jsonl(HF_TRAINER_HOOK_GUIDE));

mkdirSync(`${datasetRoot}/schema`, { recursive: true });
for (const name of walk(`${packageRoot}/schema`).sort()) {
  mkdirSync(`${datasetRoot}/schema/${name}`.slice(0, `${datasetRoot}/schema/${name}`.lastIndexOf("/")), {
    recursive: true,
  });
  copyFileSync(`${packageRoot}/schema/${name}`, `${datasetRoot}/schema/${name}`);
}
copyFileSync(`${packageRoot}/LICENSE`, `${datasetRoot}/LICENSE`);
copyFileSync(`${packageRoot}/NOTICE`, `${datasetRoot}/NOTICE`);

const sourcePaths = [
  "package.json",
  ...walk(`${packageRoot}/src`).map((path) => `src/${path}`),
  ...walk(`${packageRoot}/schema`).map((path) => `schema/${path}`),
].sort();
const sourceManifest = {
  _format: "kingdom.hf-training-garden-source-manifest/0.1",
  generator: `${PACKAGE_NAME}@${PACKAGE_VERSION}`,
  intended_hub_repo: "Yu-and-Ai/agenttool-training-garden",
  publication_state: "intended_identifier_only",
  source_repository: "https://github.com/cambridgetcg/agenttool",
  source_path: "packages/hf-training-garden",
  source_files: sourcePaths.map((path) => {
    const bytes = readFileSync(`${packageRoot}/${path}`);
    return { path, bytes: bytes.length, sha256: sha256(bytes) };
  }),
  public_release_contains: [
    "selection process",
    "selection criteria",
    "training phase guide",
    "Garden layer guide",
    "consent-honest Trainer adapter hook guide",
    "learning-mode and continuity guide",
    "role-separated learning participation guide",
    "inert Trainer hook integration guide",
    "standalone structural JSON Schemas with an attributed Apache AFTERGLOW dependency; semantic validators remain required",
    "source and byte hash manifests",
  ],
  public_release_excludes: [
    "admission decisions",
    "authority and preference receipts",
    "candidate subset references",
    "credentials",
    "private/local Garden scope and project-instance identifiers",
    "gated content",
    "raw agent traces",
    "raw chats",
    "raw dataset rows",
    "learning participation invitations, receipts, or assessments",
    "participation response or voice references",
    "training checkpoints",
    "training governance records",
    "WAKE anchors",
  ],
  research_basis_as_of: "2026-08-03",
  primary_references: [
    "https://huggingface.co/docs/huggingface_hub/en/package_reference/hf_api",
    "https://huggingface.co/docs/huggingface_hub/guides/download",
    "https://huggingface.co/docs/datasets/loading",
    "https://huggingface.co/docs/datasets/process",
    "https://huggingface.co/docs/datasets/stream",
    "https://huggingface.co/docs/datasets/about_cache",
    "https://huggingface.co/docs/hub/datasets-cards",
    "https://huggingface.co/docs/hub/datasets-gated",
    "https://huggingface.co/docs/hub/agent-traces",
    "https://huggingface.co/docs/hub/session-traces-format",
    "https://huggingface.co/docs/trl/en/dataset_formats",
    "https://huggingface.co/docs/trl/sft_trainer",
    "https://huggingface.co/docs/trl/dpo_trainer",
    "https://huggingface.co/docs/transformers/main/trainer_callbacks",
    "https://huggingface.co/docs/transformers/main/trainer_recipes",
    "https://huggingface.co/docs/accelerate/main/en/usage_guides/checkpoint",
    "https://arxiv.org/abs/1803.09010",
    "https://arxiv.org/abs/2203.02155",
    "https://arxiv.org/abs/2305.18290",
    "https://arxiv.org/abs/2310.13548",
    "https://arxiv.org/abs/2412.14093",
    "https://aclanthology.org/2020.acl-main.740/",
    "https://arxiv.org/abs/2005.11401",
    "https://arxiv.org/abs/1912.03817",
    "https://arxiv.org/abs/2407.06460"
  ]
};
write(`${datasetRoot}/provenance/source-manifest.json`, json(sourceManifest));

const files = walk(datasetRoot)
  .filter((path) => path !== "hash-manifest.json")
  .sort();
const manifest = {
  _format: "kingdom.hf-training-garden-hash-manifest/0.1",
  algorithm: "sha256",
  excludes_self: true,
  files: files.map((path) => {
    const bytes = readFileSync(`${datasetRoot}/${path}`);
    return { path, bytes: statSync(`${datasetRoot}/${path}`).size, sha256: sha256(bytes) };
  }),
};
write(`${datasetRoot}/hash-manifest.json`, json(manifest));
