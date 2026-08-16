import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageRoot = new URL("..", import.meta.url);
const output = execFileSync(
  "npm",
  ["pack", "--dry-run", "--ignore-scripts", "--json"],
  { cwd: packageRoot, encoding: "utf8" },
);
const reports = JSON.parse(output);
if (!Array.isArray(reports) || reports.length !== 1) {
  throw new Error("npm pack returned an unexpected report shape");
}
const [report] = reports;
if (!Array.isArray(report.files) || !Array.isArray(report.bundled) || report.bundled.length !== 0) {
  throw new Error("packed dependency inventory is malformed or unexpectedly bundled");
}

const modules = [
  "bytes",
  "canonical",
  "constants",
  "crypto",
  "errors",
  "index",
  "protocol",
  "types",
  "validation",
];
const dist = modules.flatMap((name) => [
  `dist/${name}.d.ts`,
  `dist/${name}.d.ts.map`,
  `dist/${name}.js`,
  `dist/${name}.js.map`,
]);
const expected = [
  "CLAUDE.md",
  "README.md",
  ...dist,
  "kingdom.extension.json",
  "package.json",
  "schema/agenttool-public-surface-assessment-v0.1.schema.json",
  "schema/agenttool-public-surface-binding-v0.1.schema.json",
  "schema/agenttool-public-surface-observation-v0.1.schema.json",
  "schema/agenttool-public-surface-revocation-v0.1.schema.json",
  "vectors/agenttool-public-surface-binding-v0.1-vectors.json",
].sort();
const files = report.files.map(({ path }) => path).sort();

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  const missing = expected.filter((path) => !files.includes(path));
  const unexpected = files.filter((path) => !expected.includes(path));
  throw new Error(
    `packed public-surface-binding inventory differs; missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)}`,
  );
}

const packageJson = JSON.parse(readFileSync(new URL("package.json", packageRoot), "utf8"));
if (packageJson.private !== true || packageJson.license !== "UNLICENSED") {
  throw new Error("package must remain private and UNLICENSED");
}
for (const target of exportTargets(packageJson.exports)) {
  if (!files.includes(target)) {
    throw new Error(`public export ${target} is absent from the packed inventory`);
  }
}

function exportTargets(value) {
  if (typeof value === "string") return [value.replace(/^\.\//u, "")];
  if (value && typeof value === "object") return Object.values(value).flatMap(exportTargets);
  return [];
}
