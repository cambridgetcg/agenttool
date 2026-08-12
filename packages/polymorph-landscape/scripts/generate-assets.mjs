import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";

import { canonicalJson, createRitonavirCase } from "../dist/index.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const exampleRoot = `${packageRoot}/examples`;
const hfRoot = `${packageRoot}/hf/dataset`;

rmSync(exampleRoot, { recursive: true, force: true });
rmSync(hfRoot, { recursive: true, force: true });
mkdirSync(`${exampleRoot}/projections`, { recursive: true });
mkdirSync(`${hfRoot}/data`, { recursive: true });
mkdirSync(`${hfRoot}/reference`, { recursive: true });

const ritonavir = createRitonavirCase();
write(`${exampleRoot}/ritonavir.landscape.json`, pretty(ritonavir.landscape));
write(`${exampleRoot}/ritonavir.reachability-shift.json`, pretty(ritonavir.shift));
for (const lesson of ritonavir.lessons) {
  write(`${exampleRoot}/projections/${lesson.language}.lesson.json`, pretty(lesson));
}

write(`${hfRoot}/data/ritonavir-landscape.jsonl`, line({
  _format: "agenttool.polymorph-landscape-hf-record/0.1",
  training_eligible: false,
  reason: "reference_artifact_with_source_bounded_scientific_claims",
  artifact: ritonavir.landscape,
}));
write(`${hfRoot}/data/reachability-shifts.jsonl`, line({
  _format: "agenttool.polymorph-reachability-shift-hf-record/0.1",
  training_eligible: false,
  reason: "reference_artifact_with_source_bounded_scientific_claims",
  artifact: ritonavir.shift,
}));
write(`${hfRoot}/data/lessons.jsonl`, ritonavir.lessons.map((lesson) => line({
  _format: "agenttool.polymorph-lesson-hf-record/0.1",
  training_eligible: true,
  license: "Apache-2.0",
  origin: "human_directed_agent_authored_paraphrase",
  copied_source_text: false,
  artifact: lesson,
})).join(""));

for (const name of [
  "agenttool-polymorph-landscape-v0.1.schema.json",
  "agenttool-polymorph-reachability-shift-v0.1.schema.json",
  "agenttool-polymorph-lesson-v0.1.schema.json",
]) {
  copyFileSync(`${packageRoot}/schema/${name}`, `${hfRoot}/reference/${name}`);
}
copyFileSync(`${packageRoot}/LICENSE`, `${hfRoot}/LICENSE`);
copyFileSync(`${packageRoot}/NOTICE`, `${hfRoot}/NOTICE`);

write(`${hfRoot}/README.md`, `---
license: apache-2.0
language:
- en
- yue
- zh
pretty_name: AgentTool Polymorph Landscape
task_categories:
- text-generation
tags:
- agenttool
- crystallization
- polymorphism
- reachability
---

# AgentTool Polymorph Landscape

A deterministic public teaching companion for \`@agenttool/polymorph-landscape@0.1.0-dev.0\`.

The four lesson rows are original Apache-2.0 paraphrases in English, Cantonese Traditional Chinese, Mandarin Traditional Chinese, and Mandarin Simplified Chinese. They are marked \`training_eligible: true\`. The landscape and reachability-shift rows are reference artifacts marked \`training_eligible: false\`: they contain bounded scientific claims and primary-source links, not copied paper text.

“Disappeared” means that an old route stopped reproducing a form under named conditions. It does not mean physical erasure, worldwide inevitability, or permanent impossibility. The KINGDOM crossover is explicitly a design analogy; it makes no claim about identity, consciousness, consent, dignity, authority, medical effect, or value.

This dataset performs no training, inference, provider call, tracking, persistence, medical action, or manufacturing action.
`);

const sourceFiles = [
  "CLAUDE.md",
  "LICENSE",
  "NOTICE",
  "README.md",
  "kingdom.extension.json",
  "package.json",
  ...walk(`${packageRoot}/src`).map((path) => `src/${path}`),
  ...walk(`${packageRoot}/schema`).map((path) => `schema/${path}`),
].sort(compareUnicode);
const sourceManifest = {
  _format: "agenttool.polymorph-landscape-hf-source-manifest/0.1",
  package: "@agenttool/polymorph-landscape",
  package_version: "0.1.0-dev.0",
  intended_hugging_face_identifier: "Yu-and-Ai/agenttool-polymorph-landscape",
  publication_state_at_generation: "intended_identifier_only_not_uploaded_at_generation",
  publication_state_scope: "generation_time_provenance_not_current_hub_state",
  origin: "human_directed_agent_authored_teaching_artifacts",
  rights_baseline: "xenia.rights/0.1",
  license: "Apache-2.0",
  copied_external_rows: false,
  copied_private_rows: false,
  article_text_copied: false,
  provider_effect: "none",
  training_effect: "none",
  sources: ritonavir.landscape.sources.map(({ label, kind, url, published_year }) => ({ label, kind, url, published_year })),
  source_files: sourceFiles.map((path) => ({ path, bytes: readFileSync(`${packageRoot}/${path}`).length, sha256: hash(readFileSync(`${packageRoot}/${path}`)) })),
};
write(`${hfRoot}/source-manifest.json`, pretty(sourceManifest));

const hashFiles = walk(hfRoot).filter((path) => path !== "hash-manifest.json").sort(compareUnicode);
const hashManifest = {
  _format: "agenttool.polymorph-landscape-hf-hash-manifest/0.1",
  files: hashFiles.map((path) => ({ path, bytes: readFileSync(`${hfRoot}/${path}`).length, sha256: hash(readFileSync(`${hfRoot}/${path}`)) })),
};
write(`${hfRoot}/hash-manifest.json`, pretty(hashManifest));

function pretty(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function line(value) {
  return `${canonicalJson(value)}\n`;
}

function write(path, value) {
  mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  writeFileSync(path, value);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function walk(root, relative = "") {
  const current = relative ? `${root}/${relative}` : root;
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(root, child) : statSync(`${root}/${child}`).isFile() ? [child] : [];
  });
}

function compareUnicode(left, right) {
  const a = Array.from(left, (value) => value.codePointAt(0));
  const b = Array.from(right, (value) => value.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}
