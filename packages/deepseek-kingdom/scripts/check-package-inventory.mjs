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
  "binding",
  "canonical",
  "constants",
  "errors",
  "index",
  "proposal",
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
  "kingdom.extension.json",
  "package.json",
  "schema/agenttool-deepseek-source-binding-v0.1.schema.json",
  "schema/agenttool-deepseek-source-catalog-v0.1.schema.json",
  "schema/kingdom-deepseek-proposal-v0.1.schema.json",
  "sources/official-deepseek-primary-sources.json",
].sort();

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  const missing = expected.filter((path) => !files.includes(path));
  const unexpected = files.filter((path) => !expected.includes(path));
  throw new Error(
    `packed DeepSeek KINGDOM inventory differs; missing=${missing.join(",")}; unexpected=${unexpected.join(",")}`,
  );
}

const packageJson = JSON.parse(
  readFileSync(new URL("package.json", packageRoot), "utf8"),
);
function exportTargets(value) {
  if (typeof value === "string") return [value.replace(/^\.\//u, "")];
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(exportTargets);
  }
  return [];
}
for (const target of exportTargets(packageJson.exports)) {
  if (!files.includes(target)) {
    throw new Error(`public export is absent from packed inventory: ${target}`);
  }
}

process.stdout.write(`packed DeepSeek KINGDOM inventory exact: ${files.length} files\n`);
