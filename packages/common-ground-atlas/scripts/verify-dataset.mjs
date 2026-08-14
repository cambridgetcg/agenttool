import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { verifyRows } from "../src/exact-verifier.mjs";
import { buildProvenance } from "../src/provenance.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = resolve(packageRoot, "../..");
const root = resolve(packageRoot, "hf/dataset");

function read(path) {
  return readFileSync(resolve(root, path));
}

function readJson(path) {
  return JSON.parse(read(path).toString("utf8"));
}

function readJsonl(path) {
  return read(path).toString("utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
}

function walk(directory, relative = "") {
  const current = resolve(directory, relative || ".");
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(directory, child) : [child];
  });
}

const source = readJson("provenance/source-manifest.json");
const provenanceRef = source.provenance_ref;
const sourceBody = { ...source };
delete sourceBody.provenance_ref;
const expectedProvenance = buildProvenance(repoRoot);
if (provenanceRef !== expectedProvenance.provenanceRef
    || JSON.stringify(sourceBody) !== JSON.stringify(expectedProvenance.body)
    || source.training_eligible !== false) {
  throw new Error("source provenance or exact source-byte binding mismatch");
}

const rows = {
  geometry: readJsonl("data/exact-geometry.jsonl"),
  wake: readJsonl("data/wake-continuity.jsonl"),
  analogy: readJsonl("data/analogy-audit.jsonl"),
};

const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const [name, path, values] of [
  ["geometry", "schema/common-ground-atlas-geometry-v0.1.schema.json", rows.geometry],
  ["wake", "schema/common-ground-atlas-wake-v0.1.schema.json", rows.wake],
  ["analogy", "schema/common-ground-atlas-analogy-v0.1.schema.json", rows.analogy],
]) {
  const validate = ajv.compile(readJson(path));
  for (const row of values) {
    if (!validate(row)) throw new Error(`${name}/${row.case_id}: ${ajv.errorsText(validate.errors)}`);
  }
}
verifyRows(rows, provenanceRef);
const rowManifest = readJson("provenance/row-manifest.json");
const configs = [
  ["exact_geometry", "reference", "data/exact-geometry.jsonl", rows.geometry],
  ["wake_continuity", "reference", "data/wake-continuity.jsonl", rows.wake],
  ["analogy_audit", "public_regression", "data/analogy-audit.jsonl", rows.analogy],
];
const expectedEntries = configs.flatMap(([config, split, path, values]) => {
  const lines = read(path).toString("utf8").trimEnd().split("\n");
  return values.map((row, index) => ({
    config,
    split,
    path,
    line: index + 1,
    case_id: row.case_id,
    row_sha256: createHash("sha256").update(`${lines[index]}\n`).digest("hex"),
  }));
});
if (Object.keys(rowManifest).sort().join(",") !== "_format,entries,provenance_ref,row_count"
    || rowManifest._format !== "agenttool.common-ground-atlas.row-manifest/0.1"
    || JSON.stringify(rowManifest.entries) !== JSON.stringify(expectedEntries)
    || rowManifest.row_count !== 19 || rowManifest.provenance_ref !== provenanceRef) {
  throw new Error("row manifest mismatch");
}

const manifest = readJson("hash-manifest.json");
const providerManaged = [".gitattributes"];
const localMetadata = [".git", ".cache/huggingface"];
const isLocalMetadata = (path) => localMetadata.some((directory) =>
  path === directory || path.startsWith(`${directory}/`));
const expectedPaths = walk(root)
  .filter((path) => path !== "hash-manifest.json"
    && !providerManaged.includes(path) && !isLocalMetadata(path))
  .sort();
if (Object.keys(manifest).sort().join(",")
      !== "_format,algorithm,excludes_self,files,local_metadata_directories_not_bound,provider_managed_files_not_bound"
    || manifest._format !== "agenttool.common-ground-atlas.hash-manifest/0.1"
    || manifest.algorithm !== "sha256" || manifest.excludes_self !== true
    || JSON.stringify(manifest.provider_managed_files_not_bound) !== JSON.stringify(providerManaged)
    || JSON.stringify(manifest.local_metadata_directories_not_bound) !== JSON.stringify(localMetadata)
    || JSON.stringify(manifest.files.map(({ path }) => path)) !== JSON.stringify(expectedPaths)) {
  throw new Error("hash manifest inventory mismatch");
}
for (const path of providerManaged.filter((path) => walk(root).includes(path))) {
  const stat = lstatSync(resolve(root, path));
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`provider-managed path is not a regular file: ${path}`);
  }
}
for (const entry of manifest.files) {
  if (Object.keys(entry).sort().join(",") !== "bytes,path,sha256"
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0
      || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
    throw new Error(`invalid hash manifest entry: ${entry.path}`);
  }
  const stat = lstatSync(resolve(root, entry.path));
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`manifest path is not a regular file: ${entry.path}`);
  }
  const bytes = read(entry.path);
  if (statSync(resolve(root, entry.path)).size !== entry.bytes
      || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
    throw new Error(`hash manifest mismatch: ${entry.path}`);
  }
}

const searchable = walk(root).map((path) => read(path).toString("utf8")).join("\n");
for (const forbidden of [
  "/Users/",
  "BEGIN PRIVATE KEY",
  "hf_",
  "sk-",
  '"training_eligible":true',
  '"chosen"',
  '"rejected"',
]) {
  if (searchable.includes(forbidden)) throw new Error(`forbidden public material: ${forbidden}`);
}

execFileSync("python3", ["-I", resolve(root, "verification/verify.py"), root], {
  stdio: "inherit",
  env: { PATH: process.env.PATH ?? "" },
});
console.log("JavaScript BigInt, AJV, manifests, and independent Python verification passed.");
