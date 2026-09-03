import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageRoot = new URL("../", import.meta.url);
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
  "constants",
  "index",
  "internal",
  "json-source",
  "runner",
  "types",
  "vectors",
];
const dist = modules.flatMap((name) => [
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
  "hf/dataset/data/conformance-reference.jsonl",
  "hf/dataset/data/training-lessons.jsonl",
  "hf/dataset/hash-manifest.json",
  "hf/dataset/reference/CONFORMANCE.md",
  "hf/dataset/reference/KERNEL.md",
  "hf/dataset/reference/economic-kernel-v0.1.json",
  "hf/dataset/reference/manifest.json",
  "hf/dataset/source-manifest.json",
  "hf/dataset/training-authorization.json",
  "hf/dataset/verification/verify.py",
  "package.json",
  "vectors/economic-kernel-v0.1.json",
  "vectors/manifest.json",
].sort();
const files = report.files.map(({ path }) => path).sort();
if (JSON.stringify(files) !== JSON.stringify(expected)) {
  const missing = expected.filter((path) => !files.includes(path));
  const unexpected = files.filter((path) => !expected.includes(path));
  throw new Error(
    `packed economic-conformance inventory differs; missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)}`,
  );
}

const packageJson = JSON.parse(readFileSync(new URL("package.json", packageRoot), "utf8"));
const runtimeDependencyFields = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundledDependencies",
  "bundleDependencies",
];
if (
  packageJson.private !== undefined
  || packageJson.license !== "Apache-2.0"
  || packageJson.publishConfig?.access !== "public"
  || packageJson.publishConfig?.tag !== "next"
  || packageJson.sideEffects !== false
  || runtimeDependencyFields.some((field) => packageJson[field] !== undefined)
) {
  throw new Error("package must remain public, Apache-2.0, next-tagged, dependency-free, and side-effect-free");
}
for (const target of exportTargets(packageJson.exports)) {
  if (!files.includes(target)) throw new Error(`public export ${target} is absent from the package`);
}

function exportTargets(value) {
  if (typeof value === "string") return [value.replace(/^\.\//u, "")];
  if (value && typeof value === "object") return Object.values(value).flatMap(exportTargets);
  return [];
}
