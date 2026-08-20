import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { compareUtf8Paths, CORE_CORPUS_PIN } from "./core-corpus-pin.mjs";

import {
  EXPECTED_SCHEMA_HASHES,
  SETTLEMENT_BATCH_SIDECAR_SCHEMA,
  WITNESS_PROTOCOL,
  WITNESS_RECORD_SCHEMA,
  scopedHash,
} from "../src/index.js";

const root = resolve(import.meta.dir, "../vectors/core-v0.1");
const manifestBytes = await readFile(resolve(root, "known-answer.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
  protocol: string;
  freeze_state: string;
  schema_set_digest: string;
  corpus_digest: string;
  record_schema_hash: string;
  settlement_batch_schema_hash: string;
  payload_schemas: Array<{ kind: keyof typeof EXPECTED_SCHEMA_HASHES; schema_hash: string }>;
  vectors: Array<{ path: string; file_sha256: string }>;
};

for (const [field, expected] of Object.entries(CORE_CORPUS_PIN).filter(([field]) =>
  !["manifest_file_sha256", "payload_schemas", "vector_count"].includes(field))) {
  if (manifest[field as keyof typeof manifest] !== expected) throw new Error(`core pin drift: ${field}`);
}
const manifestFileHash = `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`;
if (manifestFileHash !== CORE_CORPUS_PIN.manifest_file_sha256) {
  throw new Error("core pin drift: manifest_file_sha256");
}
if (JSON.stringify(manifest.payload_schemas) !== JSON.stringify(CORE_CORPUS_PIN.payload_schemas)) {
  throw new Error("core pin drift: payload_schemas");
}
if (manifest.vectors.length !== CORE_CORPUS_PIN.vector_count) throw new Error("core pin drift: vector_count");
if (manifest.protocol !== WITNESS_PROTOCOL) throw new Error("core protocol drift");
if (scopedHash("schema", WITNESS_RECORD_SCHEMA) !== CORE_CORPUS_PIN.record_schema_hash) {
  throw new Error("local record schema hash drift");
}
if (scopedHash("schema", SETTLEMENT_BATCH_SIDECAR_SCHEMA) !== CORE_CORPUS_PIN.settlement_batch_schema_hash) {
  throw new Error("local settlement batch schema hash drift");
}
for (const entry of manifest.payload_schemas) {
  if (EXPECTED_SCHEMA_HASHES[entry.kind] !== entry.schema_hash) {
    throw new Error(`local payload schema hash drift: ${entry.kind}`);
  }
}

const nul = Buffer.from([0]);
const corpusHash = createHash("sha256");
corpusHash.update(WITNESS_PROTOCOL);
corpusHash.update(nul);
corpusHash.update("known-answer-corpus");
corpusHash.update(nul);
for (const vector of [...manifest.vectors].sort((left, right) => compareUtf8Paths(left.path, right.path))) {
  if (!/^[a-z0-9][a-z0-9._/-]*\.json$/u.test(vector.path) || vector.path.split("/").includes("..")) {
    throw new Error(`unsafe vector path: ${vector.path}`);
  }
  const bytes = await readFile(resolve(root, vector.path));
  const fileHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (fileHash !== vector.file_sha256) throw new Error(`vector file hash drift: ${vector.path}`);
  corpusHash.update(vector.path);
  corpusHash.update(nul);
  corpusHash.update(Buffer.from(fileHash.slice(7), "hex"));
  corpusHash.update(nul);
}
if (`sha256:${corpusHash.digest("hex")}` !== CORE_CORPUS_PIN.corpus_digest) {
  throw new Error("aggregate local corpus digest drift");
}

async function filesBelow(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) output.push(...await filesBelow(absolute));
    else if (entry.isFile()) output.push(absolute);
    else throw new Error(`unsupported vector filesystem entry: ${absolute}`);
  }
  return output;
}
const files = (await filesBelow(root)).map((file) => relative(root, file).split(sep).join("/"));
const indexed = new Set(["known-answer.json", ...manifest.vectors.map((vector) => vector.path)]);
if (files.length !== indexed.size || files.some((file) => !indexed.has(file))) {
  throw new Error("local corpus contains missing or unindexed files");
}

process.stdout.write(`verified ${manifest.vectors.length} Core vectors; corpus ${CORE_CORPUS_PIN.corpus_digest}\n`);
