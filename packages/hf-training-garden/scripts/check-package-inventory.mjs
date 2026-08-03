import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageRoot = new URL("..", import.meta.url);
const output = execFileSync(
  "npm",
  ["pack", "--dry-run", "--ignore-scripts", "--json"],
  { cwd: packageRoot, encoding: "utf8" },
);
const [report] = JSON.parse(output);
const files = report.files.map(({ path }) => path).sort();
const dist = [
  "admission",
  "canonical",
  "checkpoint",
  "constants",
  "errors",
  "governance",
  "index",
  "tending",
  "types",
  "validation",
].flatMap((name) => [
  `dist/${name}.d.ts`,
  `dist/${name}.d.ts.map`,
  `dist/${name}.js`,
  `dist/${name}.js.map`,
]);
const expected = [
  "CLAUDE.md",
  "LICENSE",
  "NOTICE",
  "README.md",
  ...dist,
  "hf/dataset/LICENSE",
  "hf/dataset/NOTICE",
  "hf/dataset/README.md",
  "hf/dataset/data/garden-layers.jsonl",
  "hf/dataset/data/selection-criteria.jsonl",
  "hf/dataset/data/selection-process.jsonl",
  "hf/dataset/data/training-phases.jsonl",
  "hf/dataset/data/trainer-adapter-hooks.jsonl",
  "hf/dataset/hash-manifest.json",
  "hf/dataset/provenance/source-manifest.json",
  "hf/dataset/schema/hf-dataset-admission-v0.1.schema.json",
  "hf/dataset/schema/hf-training-checkpoint-v0.1.schema.json",
  "hf/dataset/schema/hf-training-governance-v0.1.schema.json",
  "hf/dataset/schema/hf-training-garden-tending-v0.1.schema.json",
  "hf/dataset/schema/dependencies/agenttool-afterglow-capsule-v0.1.schema.json",
  "package.json",
  "schema/hf-dataset-admission-v0.1.schema.json",
  "schema/hf-training-checkpoint-v0.1.schema.json",
  "schema/hf-training-governance-v0.1.schema.json",
  "schema/hf-training-garden-tending-v0.1.schema.json",
  "schema/dependencies/agenttool-afterglow-capsule-v0.1.schema.json",
].sort();

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  throw new Error(
    `packed HF Training Garden inventory differs from its exact private allowlist\n${JSON.stringify(files, null, 2)}`,
  );
}

const packageJson = JSON.parse(
  readFileSync(new URL("package.json", packageRoot), "utf8"),
);
function exportTargets(value) {
  if (typeof value === "string") return [value.replace(/^\.\//u, "")];
  if (value && typeof value === "object") return Object.values(value).flatMap(exportTargets);
  return [];
}
for (const target of exportTargets(packageJson.exports)) {
  if (!files.includes(target)) throw new Error(`package export ${target} is absent from the packed inventory`);
}
