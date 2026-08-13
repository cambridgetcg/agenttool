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
  "analogy",
  "brainrot",
  "canonical",
  "constants",
  "errors",
  "index",
  "landscape",
  "projection",
  "reachability-shift",
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
  "examples/brainrot.landscape.json",
  "examples/brainrot.reachability-shift.json",
  "examples/projections/en.lesson.json",
  "examples/projections/yue-Hant.lesson.json",
  "examples/projections/zh-Hans.lesson.json",
  "examples/projections/zh-Hant.lesson.json",
  "examples/ritonavir.analogy.json",
  "hf/dataset/LICENSE",
  "hf/dataset/NOTICE",
  "hf/dataset/README.md",
  "hf/dataset/data/brainrot-landscape.jsonl",
  "hf/dataset/data/lessons.jsonl",
  "hf/dataset/data/polymorph-analogies.jsonl",
  "hf/dataset/data/reachability-shifts.jsonl",
  "hf/dataset/hash-manifest.json",
  "hf/dataset/reference/agenttool-memetic-landscape-v0.1.schema.json",
  "hf/dataset/reference/agenttool-memetic-lesson-v0.1.schema.json",
  "hf/dataset/reference/agenttool-memetic-reachability-shift-v0.1.schema.json",
  "hf/dataset/reference/agenttool-polymorph-memetic-analogy-v0.1.schema.json",
  "hf/dataset/source-manifest.json",
  "kingdom.extension.json",
  "package.json",
  "schema/agenttool-memetic-landscape-v0.1.schema.json",
  "schema/agenttool-memetic-lesson-v0.1.schema.json",
  "schema/agenttool-memetic-reachability-shift-v0.1.schema.json",
  "schema/agenttool-polymorph-memetic-analogy-v0.1.schema.json",
].sort();

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  const missing = expected.filter((path) => !files.includes(path));
  const unexpected = files.filter((path) => !expected.includes(path));
  throw new Error(`packed Memetic Landscape inventory differs from the exact allowlist; missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)}`);
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
