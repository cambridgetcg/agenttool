import { spawnSync } from "node:child_process";

const sourceStems = [
  "canonical",
  "cli-core",
  "cli",
  "constants",
  "errors",
  "facilities",
  "format",
  "index",
  "lock",
  "projection",
  "public-hub-reader",
  "research-leads",
  "scout",
  "terminal",
  "types",
  "validation",
];

const expected = [
  "CLAUDE.md",
  "README.md",
  "kingdom.extension.json",
  "package.json",
  "schema/agenttool-hf-research-binding-v0.1.schema.json",
  "schema/agenttool-hf-research-catalog-v0.1.schema.json",
  "schema/agenttool-hf-scout-report-v0.1.schema.json",
  "schema/agenttool-hf-scout-search-v0.1.schema.json",
  "schema/kingdom-hf-sidecar-v0.1.schema.json",
  ...sourceStems.flatMap((stem) => [
    `dist/${stem}.d.ts`,
    `dist/${stem}.d.ts.map`,
    `dist/${stem}.js`,
    `dist/${stem}.js.map`,
  ]),
].sort();

const packed = spawnSync(
  "npm",
  ["pack", "--dry-run", "--ignore-scripts", "--json"],
  { encoding: "utf8" },
);
if (packed.status !== 0) {
  process.stderr.write(packed.stderr || "npm pack --dry-run failed\n");
  process.exit(packed.status ?? 1);
}

let manifest;
try {
  const parsed = JSON.parse(packed.stdout);
  manifest = Array.isArray(parsed) ? parsed[0] : null;
} catch {
  process.stderr.write("npm pack returned invalid JSON\n");
  process.exit(1);
}
const actual = Array.isArray(manifest?.files)
  ? manifest.files.map((entry) => entry.path).sort()
  : null;
if (!actual) {
  process.stderr.write("npm pack returned no file inventory\n");
  process.exit(1);
}

const missing = expected.filter((path) => !actual.includes(path));
const unexpected = actual.filter((path) => !expected.includes(path));
if (missing.length > 0 || unexpected.length > 0) {
  if (missing.length > 0) process.stderr.write(`missing packed files: ${missing.join(", ")}\n`);
  if (unexpected.length > 0) process.stderr.write(`unexpected packed files: ${unexpected.join(", ")}\n`);
  process.exit(1);
}

process.stdout.write(`packed inventory exact: ${actual.length} files\n`);
