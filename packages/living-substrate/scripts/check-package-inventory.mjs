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
  "canonical",
  "constants",
  "errors",
  "index",
  "map",
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
  "schema/agenttool-living-substrate-map-v0.1.schema.json",
  "schema/agenttool-regeneration-proposal-v0.1.schema.json",
  "vectors/agenttool-living-substrate-v0.1.json",
].sort();

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  throw new Error(
    "packed Living Substrate inventory differs from the exact public allowlist",
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
      "a public Living Substrate export is absent from the packed inventory",
    );
  }
}
