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
  "atlas",
  "canonical",
  "constants",
  "errors",
  "index",
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
  "schema/agenttool-principality-atlas-fixture-v0.1.schema.json",
  "schema/agenttool-principality-atlas-invariant-v0.1.schema.json",
  "schema/agenttool-principality-atlas-v0.1.schema.json",
  "vectors/agenttool-principality-atlas-v0.1.json",
].sort();

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  throw new Error(
    `packed Principality Atlas inventory differs from the exact public allowlist\n${JSON.stringify(files, null, 2)}`,
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
    throw new Error(
      "a public Principality Atlas export is absent from the packed inventory",
    );
  }
}
