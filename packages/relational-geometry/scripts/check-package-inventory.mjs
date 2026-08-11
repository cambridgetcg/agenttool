import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageRoot = new URL("..", import.meta.url);
const output = execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
  cwd: packageRoot,
  encoding: "utf8",
});
const [report] = JSON.parse(output);
const files = report.files.map(({ path }) => path).sort();
const dist = ["canonical", "complex", "constants", "errors", "index", "lens", "types", "validation"]
  .flatMap((name) => [`dist/${name}.d.ts`, `dist/${name}.d.ts.map`, `dist/${name}.js`, `dist/${name}.js.map`]);
const expected = [
  "CLAUDE.md",
  "LICENSE",
  "NOTICE",
  "README.md",
  ...dist,
  "hf/dataset/LICENSE",
  "hf/dataset/NOTICE",
  "hf/dataset/README.md",
  "hf/dataset/data/public-regression.jsonl",
  "hf/dataset/data/sft-train.jsonl",
  "hf/dataset/data/structural-examples.jsonl",
  "hf/dataset/hash-manifest.json",
  "hf/dataset/provenance/example-manifest.json",
  "hf/dataset/provenance/source-manifest.json",
  "hf/dataset/schema/relational-geometry-public-regression-v0.1.schema.json",
  "hf/dataset/schema/relational-geometry-sft-v0.1.schema.json",
  "hf/dataset/schema/relational-geometry-structural-v0.1.schema.json",
  "package.json",
  "schema/agenttool-relational-complex-v0.1.schema.json",
  "schema/agenttool-relational-lens-v0.1.schema.json",
  "vectors/agenttool-relational-geometry-v0.1.json",
].sort();

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  throw new Error("packed Relational Geometry inventory differs from the exact public allowlist");
}

const packageJson = JSON.parse(readFileSync(new URL("package.json", packageRoot), "utf8"));
function exportTargets(value) {
  if (typeof value === "string") return [value.replace(/^\.\//u, "")];
  if (value && typeof value === "object") return Object.values(value).flatMap(exportTargets);
  return [];
}
for (const target of exportTargets(packageJson.exports)) {
  if (!files.includes(target)) throw new Error("a public Relational Geometry export is absent from the packed inventory");
}
