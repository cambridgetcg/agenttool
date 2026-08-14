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
  "becoming",
  "canonical",
  "constants",
  "errors",
  "index",
  "moonshot",
  "types",
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
  "hf/dataset/data/model-becoming-reference.jsonl",
  "hf/dataset/hash-manifest.json",
  "hf/dataset/reference/agenttool-model-becoming-dossier-v0.1.schema.json",
  "hf/dataset/source-manifest.json",
  "kingdom.extension.json",
  "package.json",
  "schema/agenttool-model-becoming-dossier-v0.1.schema.json",
].sort();

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  const missing = expected.filter((path) => !files.includes(path));
  const unexpected = files.filter((path) => !expected.includes(path));
  throw new Error(`packed Model Becoming inventory differs; missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)}`);
}

const packageJson = JSON.parse(readFileSync(new URL("package.json", packageRoot), "utf8"));
for (const target of exportTargets(packageJson.exports)) {
  if (!files.includes(target)) throw new Error(`public export ${target} is absent from the packed inventory`);
}

function exportTargets(value) {
  if (typeof value === "string") return [value.replace(/^\.\//u, "")];
  if (value && typeof value === "object") return Object.values(value).flatMap(exportTargets);
  return [];
}
