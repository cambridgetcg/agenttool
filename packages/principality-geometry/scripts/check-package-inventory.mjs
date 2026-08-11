import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

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
  "geometry",
  "index",
  "svg",
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
  "README.md",
  ...dist,
  "examples/principality-rosette.atlas.json",
  "examples/principality-rosette.input.json",
  "examples/principality-rosette.svg",
  "kingdom.extension.json",
  "package.json",
  "schema/agenttool-principality-atlas-v0.1.schema.json",
  "schema/agenttool-principality-geometry-input-v0.1.schema.json",
].sort();

if (JSON.stringify(files) !== JSON.stringify(expected)) {
  throw new Error(
    `packed principality inventory differs from the exact private allowlist\nactual=${JSON.stringify(files, null, 2)}`,
  );
}

const packageJson = JSON.parse(
  readFileSync(new URL("package.json", packageRoot), "utf8"),
);
if (
  packageJson.name !== "@agenttool/principality-geometry" ||
  packageJson.private !== true ||
  packageJson.license !== "UNLICENSED" ||
  packageJson.sideEffects !== false
) {
  throw new Error("private package identity or release wall changed");
}
for (const field of [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "bin",
  "publishConfig",
]) {
  if (packageJson[field] !== undefined) {
    throw new Error(`forbidden package surface appeared: ${field}`);
  }
}
for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
  if (packageJson.scripts?.[hook] !== undefined) {
    throw new Error(`forbidden lifecycle hook appeared: ${hook}`);
  }
}
function sourceFiles(url) {
  return readdirSync(url, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(new URL(`${entry.name}/`, url))
      : entry.name.endsWith(".ts")
        ? [new URL(entry.name, url)]
        : [],
  );
}
const sources = sourceFiles(new URL("src/", packageRoot))
  .map((url) => readFileSync(url, "utf8"))
  .join("\n");
const imports = [...sources.matchAll(/from\s+["']([^"']+)["']/gu)].map(
  (match) => match[1],
);
if (
  !imports.every(
    (specifier) =>
      specifier.startsWith("./") ||
      specifier === "node:crypto" ||
      specifier === "node:util/types",
  )
) {
  throw new Error("runtime source import escaped the pure allowlist");
}
if (
  /process\.env|\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|node:fs|node:net|node:http|node:https|node:child_process|node:worker_threads|Math\.random|crypto\.random|Date\.now|new Date\s*\(|setTimeout|setInterval|localStorage|sessionStorage|document\.cookie/iu.test(
    sources,
  )
) {
  throw new Error("runtime source gained an effectful capability");
}
function exportTargets(value) {
  if (typeof value === "string") return [value.replace(/^\.\//u, "")];
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(exportTargets);
  }
  return [];
}
for (const target of exportTargets(packageJson.exports)) {
  if (!files.includes(target)) {
    throw new Error(`export target is absent from the packed inventory: ${target}`);
  }
}

if (files.some((path) => path.startsWith("hf/"))) {
  throw new Error("the local HF companion must remain outside the npm archive");
}
