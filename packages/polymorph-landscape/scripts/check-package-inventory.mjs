import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageRoot = new URL("..", import.meta.url);
const output = execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
  cwd: packageRoot,
  encoding: "utf8",
});
const [report] = JSON.parse(output);
const files = report.files.map(({ path }) => path).sort();
const dist = [
  "canonical", "constants", "errors", "index", "landscape", "projection",
  "reachability-shift", "ritonavir", "types", "validation",
].flatMap((name) => [`dist/${name}.d.ts`, `dist/${name}.d.ts.map`, `dist/${name}.js`, `dist/${name}.js.map`]);
const expected = [
  "CLAUDE.md",
  "LICENSE",
  "NOTICE",
  "README.md",
  ...dist,
  "examples/projections/en.lesson.json",
  "examples/projections/yue-Hant.lesson.json",
  "examples/projections/zh-Hans.lesson.json",
  "examples/projections/zh-Hant.lesson.json",
  "examples/ritonavir.landscape.json",
  "examples/ritonavir.reachability-shift.json",
  "hf/dataset/LICENSE",
  "hf/dataset/NOTICE",
  "hf/dataset/README.md",
  "hf/dataset/data/lessons.jsonl",
  "hf/dataset/data/reachability-shifts.jsonl",
  "hf/dataset/data/ritonavir-landscape.jsonl",
  "hf/dataset/hash-manifest.json",
  "hf/dataset/reference/agenttool-polymorph-landscape-v0.1.schema.json",
  "hf/dataset/reference/agenttool-polymorph-lesson-v0.1.schema.json",
  "hf/dataset/reference/agenttool-polymorph-reachability-shift-v0.1.schema.json",
  "hf/dataset/source-manifest.json",
  "kingdom.extension.json",
  "package.json",
  "schema/agenttool-polymorph-landscape-v0.1.schema.json",
  "schema/agenttool-polymorph-lesson-v0.1.schema.json",
  "schema/agenttool-polymorph-reachability-shift-v0.1.schema.json",
].sort();

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  const missing = expected.filter((path) => !files.includes(path));
  const unexpected = files.filter((path) => !expected.includes(path));
  throw new Error(`packed Polymorph Landscape inventory differs from the exact allowlist; missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)}`);
}

const packageJson = JSON.parse(readFileSync(new URL("package.json", packageRoot), "utf8"));
function exportTargets(value) {
  if (typeof value === "string") return [value.replace(/^\.\//u, "")];
  if (value && typeof value === "object") return Object.values(value).flatMap(exportTargets);
  return [];
}
for (const target of exportTargets(packageJson.exports)) {
  if (!files.includes(target)) throw new Error(`public export ${target} is absent from the packed inventory`);
}
