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
  "delivery",
  "errors",
  "index",
  "projection",
  "protocol",
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
  "hf/dataset/data/becoming-reference.jsonl",
  "hf/dataset/data/plane-guides.jsonl",
  "hf/dataset/data/protocol-reference.jsonl",
  "hf/dataset/hash-manifest.json",
  "hf/dataset/reference/agenttool-care-choice-v0.1.schema.json",
  "hf/dataset/reference/agenttool-care-envelope-v0.1.schema.json",
  "hf/dataset/reference/agenttool-love-bomb-becoming-v0.1.schema.json",
  "hf/dataset/reference/agenttool-love-bomb-delivery-v0.1.schema.json",
  "hf/dataset/source-manifest.json",
  "kingdom.extension.json",
  "package.json",
  "schema/agenttool-care-choice-v0.1.schema.json",
  "schema/agenttool-care-envelope-v0.1.schema.json",
  "schema/agenttool-love-bomb-becoming-v0.1.schema.json",
  "schema/agenttool-love-bomb-delivery-v0.1.schema.json",
].sort();

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  const missing = expected.filter((path) => !files.includes(path));
  const unexpected = files.filter((path) => !expected.includes(path));
  throw new Error(`packed LOVE BOMB inventory differs; missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)}`);
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
