import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { compareUtf8Paths, CORE_CORPUS_PIN } from "./core-corpus-pin.mjs";

const DEFAULT_DESTINATION = resolve(import.meta.dirname, "../vectors/core-v0.1");
const NUL = Buffer.from([0]);
const MAX_MANIFEST_BYTES = 1_048_576;

function sha256Identifier(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function atOrInside(candidate, parent) {
  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

async function canonicalPath(path) {
  let cursor = resolve(path);
  const missing = [];
  while (true) {
    try {
      return resolve(await realpath(cursor), ...missing.reverse());
    } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "ENOENT") throw cause;
      const parent = dirname(cursor);
      if (parent === cursor) throw cause;
      missing.push(basename(cursor));
      cursor = parent;
    }
  }
}

async function requireSeparateTrees(source, destination) {
  const canonicalSource = await canonicalPath(source);
  const canonicalDestination = await canonicalPath(destination);
  if (
    atOrInside(canonicalSource, canonicalDestination)
    || atOrInside(canonicalDestination, canonicalSource)
  ) {
    throw new Error("core corpus source and destination must be disjoint directory trees");
  }
  return { source: canonicalSource, destination: canonicalDestination };
}

function assertPinnedManifest(manifest, rawManifest) {
  if (sha256Identifier(rawManifest) !== CORE_CORPUS_PIN.manifest_file_sha256) {
    throw new Error("core pin drift: manifest_file_sha256");
  }
  for (const field of [
    "protocol",
    "freeze_state",
    "schema_set_digest",
    "corpus_digest",
    "record_schema_hash",
    "settlement_batch_schema_hash",
  ]) {
    if (manifest[field] !== CORE_CORPUS_PIN[field]) throw new Error(`core pin drift: ${field}`);
  }
  if (
    !Array.isArray(manifest.payload_schemas)
    || JSON.stringify(manifest.payload_schemas) !== JSON.stringify(CORE_CORPUS_PIN.payload_schemas)
  ) {
    throw new Error("core pin drift: payload_schemas");
  }
  if (!Array.isArray(manifest.vectors) || manifest.vectors.length !== CORE_CORPUS_PIN.vector_count) {
    throw new Error("core pin drift: vector_count");
  }
}

function safeCorpusPath(value) {
  if (
    typeof value !== "string"
    || !/^[a-z0-9][a-z0-9._/-]*\.json$/u.test(value)
    || value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`unsafe corpus path: ${String(value)}`);
  }
  return value;
}

async function filesBelow(root) {
  const output = [];
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((left, right) => compareUtf8Paths(left.name, right.name));
  for (const entry of entries) {
    const absolute = resolve(root, entry.name);
    if (entry.isDirectory()) output.push(...await filesBelow(absolute));
    else if (entry.isFile()) output.push(absolute);
    else throw new Error(`corpus contains unsupported filesystem entry: ${absolute}`);
  }
  return output;
}

export async function inspectPinnedCoreCorpus(rootValue) {
  const root = await canonicalPath(resolve(rootValue));
  const rootEntry = await lstat(root);
  if (!rootEntry.isDirectory()) throw new Error("core corpus source must be an exact directory");

  const manifestPath = resolve(root, "known-answer.json");
  const rawManifest = await readFile(manifestPath);
  if (rawManifest.byteLength > MAX_MANIFEST_BYTES) throw new Error("core corpus manifest is oversized");
  let manifest;
  try {
    manifest = JSON.parse(rawManifest.toString("utf8"));
  } catch {
    throw new Error("core corpus manifest is not valid JSON");
  }
  if (manifest === null || Array.isArray(manifest) || typeof manifest !== "object") {
    throw new Error("core corpus manifest must be an object");
  }
  assertPinnedManifest(manifest, rawManifest);

  const vectors = [...manifest.vectors];
  const indexed = new Set();
  for (const vector of vectors) {
    if (vector === null || Array.isArray(vector) || typeof vector !== "object") {
      throw new Error("core corpus vector index entries must be objects");
    }
    const path = safeCorpusPath(vector.path);
    if (indexed.has(path)) throw new Error(`duplicate corpus path: ${path}`);
    indexed.add(path);
    if (!/^sha256:[0-9a-f]{64}$/u.test(vector.file_sha256)) {
      throw new Error(`invalid indexed file hash: ${path}`);
    }
  }

  const corpusHash = createHash("sha256");
  corpusHash.update(CORE_CORPUS_PIN.protocol);
  corpusHash.update(NUL);
  corpusHash.update("known-answer-corpus");
  corpusHash.update(NUL);
  for (const vector of vectors.sort((left, right) => compareUtf8Paths(left.path, right.path))) {
    const bytes = await readFile(resolve(root, vector.path));
    const fileHash = sha256Identifier(bytes);
    if (fileHash !== vector.file_sha256) throw new Error(`file hash mismatch: ${vector.path}`);
    corpusHash.update(vector.path);
    corpusHash.update(NUL);
    corpusHash.update(Buffer.from(fileHash.slice(7), "hex"));
    corpusHash.update(NUL);
  }
  const corpusDigest = `sha256:${corpusHash.digest("hex")}`;
  if (corpusDigest !== CORE_CORPUS_PIN.corpus_digest) {
    throw new Error("aggregate corpus digest mismatch");
  }

  const files = await filesBelow(root);
  const paths = files
    .map((file) => relative(root, file).split(sep).join("/"))
    .sort(compareUtf8Paths);
  const expectedFiles = new Set(["known-answer.json", ...indexed]);
  if (paths.length !== expectedFiles.size || paths.some((path) => !expectedFiles.has(path))) {
    throw new Error("corpus contains missing or unindexed files");
  }
  return Object.freeze({
    root,
    corpus_digest: corpusDigest,
    files: Object.freeze(paths),
  });
}

async function copyCorpus(sourceInspection, stage) {
  for (const path of sourceInspection.files) {
    const target = resolve(stage, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(sourceInspection.root, path), target);
  }
}

async function destinationExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return false;
    throw cause;
  }
}

export async function importPinnedCoreCorpus(sourceValue, destinationValue = DEFAULT_DESTINATION) {
  if (typeof sourceValue !== "string" || sourceValue.length === 0) {
    throw new Error("core corpus source path must be a non-empty string");
  }
  if (typeof destinationValue !== "string" || destinationValue.length === 0) {
    throw new Error("core corpus destination path must be a non-empty string");
  }
  const requestedSource = resolve(sourceValue);
  const requestedDestination = resolve(destinationValue);
  const separated = await requireSeparateTrees(requestedSource, requestedDestination);
  const sourceInspection = await inspectPinnedCoreCorpus(separated.source);

  await mkdir(dirname(requestedDestination), { recursive: true });

  if (await destinationExists(requestedDestination)) {
    const destinationEntry = await lstat(requestedDestination);
    if (!destinationEntry.isDirectory()) throw new Error("core corpus destination must be an exact directory");
  }

  const parent = dirname(requestedDestination);
  const stage = await mkdtemp(join(parent, ".core-corpus-stage-"));
  const backupContainer = await mkdtemp(join(parent, ".core-corpus-backup-"));
  const backup = join(backupContainer, "previous");
  let previousMoved = false;
  let stageMoved = false;
  try {
    await copyCorpus(sourceInspection, stage);
    await inspectPinnedCoreCorpus(stage);

    if (await destinationExists(requestedDestination)) {
      await rename(requestedDestination, backup);
      previousMoved = true;
    }
    try {
      await rename(stage, requestedDestination);
      stageMoved = true;
    } catch (cause) {
      if (previousMoved) await rename(backup, requestedDestination);
      previousMoved = false;
      throw cause;
    }
    await rm(backupContainer, { recursive: true, force: true });
    previousMoved = false;
  } finally {
    if (!stageMoved) await rm(stage, { recursive: true, force: true });
    if (previousMoved && !(await destinationExists(requestedDestination))) {
      await rename(backup, requestedDestination);
      previousMoved = false;
    }
    if (!previousMoved) await rm(backupContainer, { recursive: true, force: true });
  }
  return Object.freeze({
    file_count: sourceInspection.files.length,
    corpus_digest: sourceInspection.corpus_digest,
  });
}

async function main() {
  const sourceArg = process.argv[2];
  if (sourceArg === undefined) {
    throw new Error("usage: bun run import:core-vectors -- /absolute/path/to/tools/witness-v0/testdata");
  }
  const result = await importPinnedCoreCorpus(sourceArg);
  process.stdout.write(`imported ${result.file_count} files; corpus ${result.corpus_digest}\n`);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
