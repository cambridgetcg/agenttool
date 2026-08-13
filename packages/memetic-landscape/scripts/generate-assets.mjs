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

import { canonicalJson, createBrainrotTeachingCase } from "../dist/index.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const exampleRoot = `${packageRoot}/examples`;
const hfRoot = `${packageRoot}/hf/dataset`;
const packageJson = JSON.parse(readFileSync(`${packageRoot}/package.json`, "utf8"));

rmSync(exampleRoot, { recursive: true, force: true });
rmSync(hfRoot, { recursive: true, force: true });
mkdirSync(`${exampleRoot}/projections`, { recursive: true });
mkdirSync(`${hfRoot}/data`, { recursive: true });
mkdirSync(`${hfRoot}/reference`, { recursive: true });

const brainrot = createBrainrotTeachingCase();
write(`${exampleRoot}/brainrot.landscape.json`, pretty(brainrot.landscape));
write(`${exampleRoot}/brainrot.reachability-shift.json`, pretty(brainrot.shift));
write(`${exampleRoot}/ritonavir.analogy.json`, pretty(brainrot.analogy));
for (const lesson of brainrot.lessons) {
  write(`${exampleRoot}/projections/${lesson.language}.lesson.json`, pretty(lesson));
}

write(`${hfRoot}/data/brainrot-landscape.jsonl`, line({
  _format: "agenttool.memetic-landscape-hf-record/0.1",
  training_eligible: false,
  reason: "reference_artifact_with_source_bounded_sociotechnical_claims",
  artifact: brainrot.landscape,
}));
write(`${hfRoot}/data/reachability-shifts.jsonl`, line({
  _format: "agenttool.memetic-reachability-shift-hf-record/0.1",
  training_eligible: false,
  reason: "reference_artifact_with_source_bounded_sociotechnical_claims",
  artifact: brainrot.shift,
}));
write(`${hfRoot}/data/polymorph-analogies.jsonl`, line({
  _format: "agenttool.polymorph-memetic-analogy-hf-record/0.1",
  training_eligible: false,
  reason: "reference_artifact_with_cross_domain_boundary_claims",
  artifact: brainrot.analogy,
}));
write(`${hfRoot}/data/lessons.jsonl`, brainrot.lessons.map((lesson) => line({
  _format: "agenttool.memetic-lesson-hf-record/0.1",
  training_eligible: true,
  license: "Apache-2.0",
  origin: "human_directed_agent_authored_paraphrase",
  copied_source_text: false,
  language_review: "not_independently_reviewed",
  artifact: lesson,
})).join(""));

const schemaNames = [
  "agenttool-memetic-landscape-v0.1.schema.json",
  "agenttool-memetic-reachability-shift-v0.1.schema.json",
  "agenttool-polymorph-memetic-analogy-v0.1.schema.json",
  "agenttool-memetic-lesson-v0.1.schema.json",
];
for (const name of schemaNames) {
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
pretty_name: AgentTool Memetic Landscape
task_categories:
- text-generation
configs:
- config_name: lessons
  default: true
  data_files:
  - split: train
    path: data/lessons.jsonl
- config_name: memetic_landscape
  data_files:
  - split: train
    path: data/brainrot-landscape.jsonl
- config_name: reachability_shifts
  data_files:
  - split: train
    path: data/reachability-shifts.jsonl
- config_name: polymorph_analogies
  data_files:
  - split: train
    path: data/polymorph-analogies.jsonl
tags:
- agenttool
- brainrot
- memes
- reachability
---

# AgentTool Memetic Landscape

A deterministic public teaching companion for \`${packageJson.name}@${packageJson.version}\`.

The four lesson rows are original Apache-2.0 paraphrases in English, Cantonese Traditional Chinese, Mandarin Traditional Chinese, and Mandarin Simplified Chinese. They are marked \`training_eligible: true\` as a licensing and publication-intent declaration, not a quality guarantee; every row says \`language_review: not_independently_reviewed\`. The landscape, reachability-shift, and polymorph-analogy rows are reference artifacts marked \`training_eligible: false\` because they contain bounded source-linked claims or cross-domain boundaries rather than copied paper text.

The Hub exposes four intentional configurations. \`lessons\` is the default teaching projection. The other configurations are source-bounded reference records; their \`train\` split name is a loader convention and does not override each row's \`training_eligible: false\` value.

“Brainrot” is represented only as a sourced cultural or playful expression, never a diagnosis or a label assigned to a person. Less observed does not mean erased. Exposure does not prove adoption, timing does not prove causation, and popularity does not prove truth, value, harm, health, or rank.

The ritonavir crossover transfers a route-landscape shape only. It transfers no crystal physics, infection model, cognition, intent, consent, dignity, identity, authority, medical effect, or value judgment. Participants are not hosts, vectors, substrates, barriers, or optimization targets; refusal, rest, play, privacy, and nonparticipation remain valid.

Those fixed fields describe inference and model effects the package does not perform. Generic caller text is preserved under \`caller_text_semantics_verified: false\`; structural validation is not semantic verification or content moderation. The generated built-in case is separately authored to respect the stated boundaries.

This dataset performs no provider call, upload, training, inference, tracking, diagnosis, moderation, persistence, publication, or deployment.
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
  _format: "agenttool.memetic-landscape-hf-source-manifest/0.1",
  package: packageJson.name,
  package_version: packageJson.version,
  intended_hugging_face_identifier: "Yu-and-Ai/agenttool-memetic-landscape",
  publication_state_at_generation: "intended_identifier_only_not_uploaded_at_generation",
  publication_state_scope: "generation_time_provenance_not_current_hub_state",
  origin: "human_directed_agent_authored_teaching_artifacts",
  rights_baseline: "xenia.rights/0.1",
  license: "Apache-2.0",
  copied_external_rows: false,
  copied_private_rows: false,
  copied_article_text: false,
  copied_prompt_transcripts: false,
  contains_identity_data: false,
  provider_effect: "none",
  training_effect: "none",
  publication_effect: "none",
  language_review: "not_independently_reviewed",
  caller_text_semantics_verified: false,
  sources: brainrot.landscape.sources.map(({ label, kind, url, published_year }) => ({
    label,
    kind,
    url,
    published_year,
  })),
  source_files: sourceFiles.map((path) => {
    const bytes = readFileSync(`${packageRoot}/${path}`);
    return { path, bytes: bytes.length, sha256: hash(bytes) };
  }),
};
write(`${hfRoot}/source-manifest.json`, pretty(sourceManifest));

const hashFiles = walk(hfRoot)
  .filter((path) => path !== "hash-manifest.json")
  .sort(compareUnicode);
const hashManifest = {
  _format: "agenttool.memetic-landscape-hf-hash-manifest/0.1",
  files: hashFiles.map((path) => {
    const bytes = readFileSync(`${hfRoot}/${path}`);
    return { path, bytes: bytes.length, sha256: hash(bytes) };
  }),
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
    return entry.isDirectory()
      ? walk(root, child)
      : statSync(`${root}/${child}`).isFile()
        ? [child]
        : [];
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
