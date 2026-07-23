#!/usr/bin/env bun
/**
 * One-shot Castle of Understanding -> local AgentTool data bridge.
 *
 * The bridge reads exact regular Markdown blobs from one operator-selected Git
 * commit, stores them in the local agent-data/v1 node, and keeps one canonical
 * root manifest. It never reads the Castle working tree, follows Markdown
 * links, starts a server, uses an AgentTool project bearer, or contacts a
 * network.
 *
 * Doctrine: docs/CASTLE-OF-UNDERSTANDING.md
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";

import {
  DataNode,
  canonicalJson,
  sha256Hex,
  type JsonObject,
  type RecordEnvelope,
} from "../packages/data/src/index.ts";

export const CASTLE_BRIDGE_VERSION = "0.1.0";
export const CASTLE_SELECTION_SCHEMA = "castle-agenttool-selection/v1";
export const CASTLE_ROOT_SCHEMA = "castle-agenttool-root/v1";
export const CASTLE_COLLECTION_SCHEMA = "castle-understanding-collection/v1";
export const CASTLE_STATE_SCHEMA = "castle-agenttool-state/v1";
export const CASTLE_PENDING_SCHEMA = "castle-agenttool-pending/v1";
export const CASTLE_OWNER_SCHEMA = "castle-agenttool-owner/v1";
export const CASTLE_ATTEMPT_SCHEMA = "castle-agenttool-attempt/v1";
export const CASTLE_COLLECTION_ID = "castle-understanding";
export const MAX_SELECTION_BYTES = 1024 * 1024;
export const MAX_CONTROL_BYTES = 64 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 256 * 1024;
export const MAX_DOCUMENTS = 2048;
export const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
export const MAX_ROOT_BYTES = 4 * 1024 * 1024;
export const MAX_LINKS_PER_DOCUMENT = 1024;
export const MAX_KNOWN_RECORDS = 100_000;
export const MAX_QUERY_LIMIT = 100;
export const GIT_TIMEOUT_MS = 30_000;

const STATE_FILE = "castle-state.json";
const PENDING_FILE = "castle-pending.json";
const OWNER_FILE = "castle-owner.json";
const ATTEMPT_FILE = "castle-attempt.json";
const LOCK_DIRECTORY = "castle-sync.lock";
const MAX_LOCK_OWNER_BYTES = 1024;
const RECORD_ID_RE = /^rec_[0-9a-f]{64}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const COMMIT_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SAFE_PATH_RE = /^(rooms|words)\/[a-z0-9][a-z0-9._-]*\.md$/;
const SAFE_LOGICAL_ID_RE = /^castle:(?:room|word|generated-room):[a-z0-9][a-z0-9._-]*$/;
const GENERATED_ROOM_RE =
  /^rooms\/(?:playful-gathering-|understanding-|cross-pollination-).+\.md$/;
const SINGLE_LINE_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
const MARKDOWN_TERMINAL_CONTROL_RE =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]|\r(?!\n)/;
const PRIVATE_MARKERS: readonly RegExp[] = Object.freeze([
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bAT_API_KEY\s*=/,
  /\b(?:sk|rk)-[A-Za-z0-9_-]{24,}\b/,
]);

type CastleKind = "room" | "word" | "generated-room";

export type CastleSelectionEntry = Readonly<{
  path: string;
  logical_id: string;
  kind: CastleKind;
}>;

export type CastleSelection = Readonly<{
  schema: typeof CASTLE_SELECTION_SCHEMA;
  revision: string;
  audience: "local-private";
  purpose: string;
  retention: string;
  paths: readonly CastleSelectionEntry[];
  retire_paths: readonly string[];
}>;

export type CastleDocument = Readonly<{
  path: string;
  logical_id: string;
  kind: CastleKind;
  title: string;
  text: string;
  bytes: number;
  sha256: string;
  git_blob_oid: string;
  links: readonly string[];
}>;

export type CastlePlan = Readonly<{
  selection_path: string;
  selection_sha256: string;
  source_root: string;
  source_root_sha256: string;
  revision: string;
  revision_time: string;
  audience: "local-private";
  purpose: string;
  retention: string;
  documents: readonly CastleDocument[];
  retire_paths: readonly string[];
  total_bytes: number;
}>;

type ActiveRecord = Readonly<{
  logical_id: string;
  kind: CastleKind;
  record_id: string;
  sha256: string;
  bytes: number;
  title: string;
  source_revision: string;
}>;

type CastleState = Readonly<{
  schema: typeof CASTLE_STATE_SCHEMA;
  status: "active" | "withdrawn";
  source_root_sha256: string;
  current_revision: string;
  selection_sha256: string;
  root_record_id: string | null;
  root_lineage_record_id: string | null;
  active: Readonly<Record<string, ActiveRecord>>;
  lineage: Readonly<Record<string, ActiveRecord>>;
  known_record_ids: readonly string[];
  withdrawn_at?: string;
  withdrawal_reason?: string;
}>;

type CastlePending = Readonly<{
  schema: typeof CASTLE_PENDING_SCHEMA;
  next_state: CastleState;
  tombstone_ids: readonly string[];
}>;

type CastleOwner = Readonly<{
  schema: typeof CASTLE_OWNER_SCHEMA;
  collection_id: typeof CASTLE_COLLECTION_ID;
  source_root_sha256: string;
  created_at: string;
}>;

type CastleAttempt = Readonly<{
  schema: typeof CASTLE_ATTEMPT_SCHEMA;
  revision: string;
  selection_sha256: string;
  started_at: string;
}>;

type GitTreeEntry = Readonly<{
  path: string;
  mode: string;
  type: string;
  oid: string;
  size: number;
}>;

export type CastlePaths = Readonly<{
  castle_root: string;
  data_root: string;
  selection_path: string;
  halt_paths: readonly string[];
}>;

export class CastleBridgeError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "CastleBridgeError";
    this.code = code;
  }
}

function fail(code: string): never {
  throw new CastleBridgeError(code);
}

function requireString(value: unknown, code: string, maximum = 500): string {
  if (
    typeof value !== "string"
    || value.trim() !== value
    || value.length === 0
    || value.length > maximum
    || SINGLE_LINE_CONTROL_RE.test(value)
  ) fail(code);
  return value;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function safeCastlePath(value: unknown, code = "invalid_castle_path"): string {
  const path = requireString(value, code, 240);
  if (
    !SAFE_PATH_RE.test(path)
    || isAbsolute(path)
    || path.includes("\\")
    || path !== posix.normalize(path)
    || path.normalize("NFC") !== path
  ) fail(code);
  return path;
}

function expectedKind(path: string): CastleKind {
  if (path.startsWith("words/")) return "word";
  return GENERATED_ROOM_RE.test(path) ? "generated-room" : "room";
}

function parseSelection(value: unknown): CastleSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("selection_not_object");
  }
  const object = value as Record<string, unknown>;
  if (!hasExactKeys(object, [
    "audience",
    "paths",
    "purpose",
    "retention",
    "retire_paths",
    "revision",
    "schema",
  ])) fail("selection_unknown_or_missing_field");
  if (object.schema !== CASTLE_SELECTION_SCHEMA) fail("selection_schema_mismatch");
  if (object.audience !== "local-private") fail("selection_audience_not_local_private");
  const revision = requireString(object.revision, "selection_revision_invalid", 64);
  if (!COMMIT_RE.test(revision)) fail("selection_revision_must_be_full_commit");
  const purpose = requireString(object.purpose, "selection_purpose_invalid");
  const retention = requireString(object.retention, "selection_retention_invalid");
  if (!Array.isArray(object.paths) || object.paths.length === 0) {
    fail("selection_paths_empty");
  }
  if (object.paths.length > MAX_DOCUMENTS) fail("selection_document_limit");

  const paths: CastleSelectionEntry[] = [];
  const seenPaths = new Set<string>();
  const seenFoldedPaths = new Set<string>();
  const seenLogicalIds = new Set<string>();
  for (const raw of object.paths) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      fail("selection_entry_invalid");
    }
    const entry = raw as Record<string, unknown>;
    if (!hasExactKeys(entry, ["kind", "logical_id", "path"])) {
      fail("selection_entry_unknown_or_missing_field");
    }
    const path = safeCastlePath(entry.path);
    const kind = requireString(entry.kind, "selection_kind_invalid", 32) as CastleKind;
    if (kind !== expectedKind(path)) fail("selection_kind_path_mismatch");
    const logicalId = requireString(
      entry.logical_id,
      "selection_logical_id_invalid",
      180,
    );
    if (!SAFE_LOGICAL_ID_RE.test(logicalId)) fail("selection_logical_id_invalid");
    if (!logicalId.startsWith(`castle:${kind}:`)) {
      fail("selection_logical_id_kind_mismatch");
    }
    const folded = path.toLowerCase();
    if (
      seenPaths.has(path)
      || seenFoldedPaths.has(folded)
      || seenLogicalIds.has(logicalId)
    ) fail("selection_duplicate_or_colliding_entry");
    seenPaths.add(path);
    seenFoldedPaths.add(folded);
    seenLogicalIds.add(logicalId);
    paths.push(Object.freeze({ path, logical_id: logicalId, kind }));
  }

  if (!Array.isArray(object.retire_paths)) fail("selection_retire_paths_invalid");
  if (object.retire_paths.length > MAX_DOCUMENTS) fail("selection_retire_limit");
  const retirePaths: string[] = [];
  const seenRetired = new Set<string>();
  for (const raw of object.retire_paths) {
    const path = safeCastlePath(raw, "selection_retire_path_invalid");
    if (seenPaths.has(path) || seenRetired.has(path)) {
      fail("selection_retire_overlap_or_duplicate");
    }
    seenRetired.add(path);
    retirePaths.push(path);
  }

  paths.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  retirePaths.sort();
  return Object.freeze({
    schema: CASTLE_SELECTION_SCHEMA,
    revision,
    audience: "local-private",
    purpose,
    retention,
    paths: Object.freeze(paths),
    retire_paths: Object.freeze(retirePaths),
  });
}

async function readRegularFileNoFollow(
  path: string,
  maximum: number,
  prefix: string,
): Promise<Uint8Array> {
  let handle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
  } catch {
    fail(`${prefix}_unreadable`);
  }
  try {
    const before = await handle.stat();
    if (!before.isFile()) fail(`${prefix}_not_regular`);
    if (before.size > maximum) fail(`${prefix}_byte_limit`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      bytes.byteLength !== before.size
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs
    ) fail(`${prefix}_changed_during_read`);
    return new Uint8Array(bytes);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function decodeUtf8(bytes: Uint8Array, code: string): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const roundTrip = new TextEncoder().encode(text);
    if (
      roundTrip.byteLength !== bytes.byteLength
      || !roundTrip.every((byte, index) => byte === bytes[index])
    ) fail(code);
    return text;
  } catch (error) {
    if (error instanceof CastleBridgeError) throw error;
    fail(code);
  }
}

async function readSelection(path: string, castleRoot: string): Promise<{
  selection: CastleSelection;
  selection_path: string;
  selection_sha256: string;
}> {
  const requested = resolve(path);
  let selectionPath: string;
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(requested);
    if (before.isSymbolicLink() || !before.isFile()) {
      fail("selection_not_regular");
    }
    selectionPath = await realpath(requested);
  } catch (error) {
    if (error instanceof CastleBridgeError) throw error;
    fail("selection_realpath_failed");
  }
  if (pathInside(castleRoot, selectionPath)) fail("selection_must_live_outside_castle");
  const bytes = await readRegularFileNoFollow(
    requested,
    MAX_SELECTION_BYTES,
    "selection",
  );
  try {
    const afterPath = await realpath(requested);
    const after = await lstat(requested);
    if (
      afterPath !== selectionPath
      || !after.isFile()
      || after.isSymbolicLink()
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs
    ) fail("selection_changed_during_read");
  } catch {
    fail("selection_changed_during_read");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeUtf8(bytes, "selection_not_utf8"));
  } catch (error) {
    if (error instanceof CastleBridgeError) throw error;
    fail("selection_not_json");
  }
  return {
    selection: parseSelection(parsed),
    selection_path: selectionPath,
    selection_sha256: sha256Hex(bytes),
  };
}

function pathInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function resolveProspectivePath(requested: string): Promise<string> {
  const absolute = resolve(requested);
  let cursor = absolute;
  const missing: string[] = [];
  while (true) {
    try {
      const info = await lstat(cursor);
      if (cursor === absolute && info.isSymbolicLink()) {
        fail("data_root_not_directory");
      }
      const existing = await realpath(cursor);
      return join(existing, ...missing);
    } catch (error) {
      if (error instanceof CastleBridgeError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) fail("data_root_unreadable");
      missing.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

function runGit(
  root: string,
  args: readonly string[],
  options: { input?: string; maxBuffer?: number } = {},
): Uint8Array {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  Object.assign(env, {
    GIT_LITERAL_PATHSPECS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  });
  const result = spawnSync("git", ["--no-replace-objects", "-C", root, ...args], {
    encoding: null,
    input: options.input,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0 || !result.stdout) fail("git_read_failed");
  return new Uint8Array(result.stdout);
}

async function resolveCastleRoot(requested: string): Promise<string> {
  let root: string;
  try {
    root = await realpath(resolve(requested));
  } catch {
    fail("castle_root_unreadable");
  }
  const reported = decodeUtf8(
    runGit(root, ["rev-parse", "--show-toplevel"]),
    "git_root_not_utf8",
  ).trim();
  let reportedReal: string;
  try {
    reportedReal = await realpath(reported);
  } catch {
    fail("git_root_unreadable");
  }
  if (reportedReal !== root) fail("castle_root_must_be_git_root");
  const localConfigNames = decodeUtf8(
    runGit(root, ["config", "--local", "--name-only", "--list", "-z"]),
    "git_config_not_utf8",
  ).split("\0").filter(Boolean);
  if (localConfigNames.some((name) => {
    const lower = name.toLowerCase();
    return lower === "extensions.partialclone"
      || /^remote\..+\.(?:promisor|partialclonefilter)$/.test(lower);
  })) fail("partial_clone_not_allowed");
  return root;
}

function resolveExactCommit(root: string, revision: string): string {
  const resolved = decodeUtf8(
    runGit(root, ["rev-parse", "--verify", `${revision}^{commit}`]),
    "git_revision_not_utf8",
  ).trim();
  if (resolved !== revision) fail("selection_revision_did_not_resolve_exactly");
  return resolved;
}

function revisionTime(root: string, revision: string): string {
  const value = decodeUtf8(
    runGit(root, ["show", "-s", "--format=%cI", revision]),
    "git_revision_time_not_utf8",
  ).trim();
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) fail("git_revision_time_invalid");
  return date.toISOString();
}

function parseTree(bytes: Uint8Array): Map<string, GitTreeEntry> {
  const text = decodeUtf8(bytes, "git_tree_not_utf8");
  const entries = new Map<string, GitTreeEntry>();
  for (const line of text.split("\0")) {
    if (!line) continue;
    const match =
      /^([0-7]{6}) ([a-z]+) ([0-9a-f]{40,64}) +([0-9]+|-)\t(.+)$/.exec(line);
    if (!match) fail("git_tree_shape_invalid");
    const path = match[5]!;
    if (entries.has(path)) fail("git_tree_duplicate_path");
    entries.set(path, Object.freeze({
      path,
      mode: match[1]!,
      type: match[2]!,
      oid: match[3]!,
      size: match[4] === "-" ? -1 : Number(match[4]),
    }));
  }
  return entries;
}

function readGitBlobs(
  root: string,
  entries: readonly GitTreeEntry[],
  totalBytes: number,
): Map<string, Uint8Array> {
  const input = `${entries.map((entry) => entry.oid).join("\n")}\n`;
  const output = runGit(root, ["cat-file", "--batch"], {
    input,
    maxBuffer: totalBytes + entries.length * 160 + 1024,
  });
  const buffer = Buffer.from(output);
  const result = new Map<string, Uint8Array>();
  let offset = 0;
  for (const entry of entries) {
    const newline = buffer.indexOf(0x0a, offset);
    if (newline < 0) fail("git_blob_batch_truncated");
    const header = buffer.subarray(offset, newline).toString("ascii");
    const match = /^([0-9a-f]{40,64}) ([a-z]+) ([0-9]+)$/.exec(header);
    if (
      !match
      || match[1] !== entry.oid
      || match[2] !== "blob"
      || Number(match[3]) !== entry.size
    ) fail("git_blob_batch_header_mismatch");
    const start = newline + 1;
    const end = start + entry.size;
    if (end >= buffer.length || buffer[end] !== 0x0a) {
      fail("git_blob_batch_content_truncated");
    }
    result.set(entry.path, new Uint8Array(buffer.subarray(start, end)));
    offset = end + 1;
  }
  if (offset !== buffer.length) fail("git_blob_batch_trailing_bytes");
  return result;
}

function extractTitle(text: string, path: string): string {
  const match = /^#\s+(.+)$/m.exec(text);
  const fallback = posix.basename(path, ".md").replaceAll("-", " ");
  const value = (match?.[1] ?? fallback)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .trim();
  return [...value].slice(0, 200).join("") || fallback;
}

function normalizeLink(from: string, raw: string): string | null {
  const withoutFragment = raw.split("#", 1)[0]!;
  if (
    !withoutFragment
    || withoutFragment.includes("\\")
    || withoutFragment.includes("%")
    || /^[a-z][a-z0-9+.-]*:/i.test(withoutFragment)
    || withoutFragment.startsWith("/")
  ) return null;
  const normalized = posix.normalize(
    posix.join(posix.dirname(from), withoutFragment),
  );
  return SAFE_PATH_RE.test(normalized) ? normalized : null;
}

function selectedLinks(
  text: string,
  from: string,
  selected: ReadonlySet<string>,
): readonly string[] {
  const links = new Set<string>();
  const pattern = /\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  for (const match of text.matchAll(pattern)) {
    const normalized = normalizeLink(from, match[1]!);
    if (normalized && selected.has(normalized)) links.add(normalized);
    if (links.size > MAX_LINKS_PER_DOCUMENT) fail("document_link_limit");
  }
  return Object.freeze([...links].sort());
}

function assertNoPrivateMarker(text: string): void {
  if (MARKDOWN_TERMINAL_CONTROL_RE.test(text)) {
    fail("selected_document_contains_control_character");
  }
  if (PRIVATE_MARKERS.some((pattern) => pattern.test(text))) {
    fail("selected_document_contains_sensitive_marker");
  }
}

export async function buildCastlePlan(options: {
  castle_root: string;
  selection_path: string;
}): Promise<CastlePlan> {
  const sourceRoot = await resolveCastleRoot(options.castle_root);
  const selectionRead = await readSelection(options.selection_path, sourceRoot);
  const { selection } = selectionRead;
  const revision = resolveExactCommit(sourceRoot, selection.revision);
  const paths = selection.paths.map((entry) => entry.path);
  const tree = parseTree(runGit(
    sourceRoot,
    ["ls-tree", "-rzl", "--full-tree", revision, "--", ...paths],
    { maxBuffer: Math.max(4 * 1024 * 1024, paths.length * 512) },
  ));
  if (tree.size !== paths.length) fail("selected_document_missing");

  let totalBytes = 0;
  const entries: GitTreeEntry[] = [];
  for (const path of paths) {
    const entry = tree.get(path);
    if (!entry) fail("selected_document_missing");
    if (entry.mode !== "100644" || entry.type !== "blob") {
      fail("selected_document_not_plain_git_blob");
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      fail("selected_document_size_invalid");
    }
    if (entry.size > MAX_DOCUMENT_BYTES) fail("selected_document_byte_limit");
    totalBytes += entry.size;
    if (totalBytes > MAX_TOTAL_BYTES) fail("selection_total_byte_limit");
    entries.push(entry);
  }

  const blobs = readGitBlobs(sourceRoot, entries, totalBytes);
  const selected = new Set(paths);
  const documents: CastleDocument[] = [];
  for (const selectionEntry of selection.paths) {
    const entry = tree.get(selectionEntry.path)!;
    const bytes = blobs.get(selectionEntry.path);
    if (!bytes || bytes.byteLength !== entry.size) fail("selected_blob_missing");
    const text = decodeUtf8(bytes, "selected_document_not_utf8");
    assertNoPrivateMarker(text);
    documents.push(Object.freeze({
      path: selectionEntry.path,
      logical_id: selectionEntry.logical_id,
      kind: selectionEntry.kind,
      title: extractTitle(text, selectionEntry.path),
      text,
      bytes: bytes.byteLength,
      sha256: sha256Hex(bytes),
      git_blob_oid: entry.oid,
      links: selectedLinks(text, selectionEntry.path, selected),
    }));
  }

  return Object.freeze({
    selection_path: selectionRead.selection_path,
    selection_sha256: selectionRead.selection_sha256,
    source_root: sourceRoot,
    source_root_sha256: sha256Hex(sourceRoot),
    revision,
    revision_time: revisionTime(sourceRoot, revision),
    audience: selection.audience,
    purpose: selection.purpose,
    retention: selection.retention,
    documents: Object.freeze(documents),
    retire_paths: selection.retire_paths,
    total_bytes: totalBytes,
  });
}

export async function haltState(path: string): Promise<"clear" | "raised"> {
  try {
    await lstat(path);
    return "raised";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "clear";
    fail("halt_state_unreadable");
  }
}

export async function assertHaltsClear(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    if (await haltState(path) !== "clear") fail("castle_bridge_halted");
  }
}

function defaultDataRoot(): string {
  const base = process.env.XDG_DATA_HOME
    ? resolve(process.env.XDG_DATA_HOME)
    : join(homedir(), ".local", "share");
  return join(base, "agenttool", "castle-understanding");
}

function defaultHaltPaths(): readonly string[] {
  return Object.freeze([
    join(homedir(), "KINGDOM-OS", "HALT"),
    join(homedir(), ".config", "agenttool", "castle", "HALT"),
  ]);
}

function statePath(root: string): string {
  return join(root, STATE_FILE);
}

function pendingPath(root: string): string {
  return join(root, PENDING_FILE);
}

function ownerPath(root: string): string {
  return join(root, OWNER_FILE);
}

function attemptPath(root: string): string {
  return join(root, ATTEMPT_FILE);
}

async function readOptionalJson(path: string, prefix: string): Promise<unknown | null> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    fail(`${prefix}_unreadable`);
  }
  const bytes = await readRegularFileNoFollow(path, MAX_CONTROL_BYTES, prefix);
  try {
    return JSON.parse(decodeUtf8(bytes, `${prefix}_not_utf8`));
  } catch (error) {
    if (error instanceof CastleBridgeError) throw error;
    fail(`${prefix}_not_json`);
  }
}

function validateOwner(value: unknown): CastleOwner {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("data_root_owner_invalid");
  }
  const object = value as Record<string, unknown>;
  if (!hasExactKeys(object, [
    "collection_id",
    "created_at",
    "schema",
    "source_root_sha256",
  ])) fail("data_root_owner_invalid");
  if (
    object.schema !== CASTLE_OWNER_SCHEMA
    || object.collection_id !== CASTLE_COLLECTION_ID
  ) fail("data_root_owner_invalid");
  const sourceRoot = requireString(
    object.source_root_sha256,
    "data_root_owner_invalid",
    64,
  );
  const createdAt = requireString(object.created_at, "data_root_owner_invalid", 64);
  if (!SHA256_RE.test(sourceRoot)) fail("data_root_owner_invalid");
  try {
    if (new Date(createdAt).toISOString() !== createdAt) {
      fail("data_root_owner_invalid");
    }
  } catch (error) {
    if (error instanceof CastleBridgeError) throw error;
    fail("data_root_owner_invalid");
  }
  return Object.freeze({
    schema: CASTLE_OWNER_SCHEMA,
    collection_id: CASTLE_COLLECTION_ID,
    source_root_sha256: sourceRoot,
    created_at: createdAt,
  });
}

function validateAttempt(value: unknown): CastleAttempt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("attempt_invalid");
  }
  const object = value as Record<string, unknown>;
  if (!hasExactKeys(object, [
    "revision",
    "schema",
    "selection_sha256",
    "started_at",
  ])) fail("attempt_invalid");
  if (object.schema !== CASTLE_ATTEMPT_SCHEMA) fail("attempt_invalid");
  const revision = requireString(object.revision, "attempt_invalid", 64);
  const selectionDigest = requireString(
    object.selection_sha256,
    "attempt_invalid",
    64,
  );
  const startedAt = requireString(object.started_at, "attempt_invalid", 64);
  if (!COMMIT_RE.test(revision) || !SHA256_RE.test(selectionDigest)) {
    fail("attempt_invalid");
  }
  try {
    if (new Date(startedAt).toISOString() !== startedAt) fail("attempt_invalid");
  } catch (error) {
    if (error instanceof CastleBridgeError) throw error;
    fail("attempt_invalid");
  }
  return Object.freeze({
    schema: CASTLE_ATTEMPT_SCHEMA,
    revision,
    selection_sha256: selectionDigest,
    started_at: startedAt,
  });
}

async function readOwner(root: string): Promise<CastleOwner | null> {
  const value = await readOptionalJson(ownerPath(root), "data_root_owner");
  return value === null ? null : validateOwner(value);
}

async function readAttempt(root: string): Promise<CastleAttempt | null> {
  const value = await readOptionalJson(attemptPath(root), "attempt");
  return value === null ? null : validateAttempt(value);
}

async function validateDataRootShape(root: string): Promise<void> {
  const info = await lstat(root).catch(() => fail("data_root_unreadable"));
  if (info.isSymbolicLink() || !info.isDirectory()) fail("data_root_not_directory");
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    fail("data_root_wrong_owner");
  }
  if ((info.mode & 0o077) !== 0) fail("data_root_permissions_not_private");

  const shapes: Readonly<Record<string, "file" | "directory">> = {
    [OWNER_FILE]: "file",
    [STATE_FILE]: "file",
    [PENDING_FILE]: "file",
    [ATTEMPT_FILE]: "file",
    [LOCK_DIRECTORY]: "directory",
    "data.sqlite": "file",
    "data.sqlite-shm": "file",
    "data.sqlite-wal": "file",
    "data.sqlite-journal": "file",
    blobs: "directory",
  };
  for (const entry of await readdir(root)) {
    const temporary = /^castle-(?:owner|state|pending|attempt)\.json\.tmp-(\d+)-[0-9a-f-]+$/.exec(
      entry,
    );
    const shape = shapes[entry] ?? (temporary ? "file" : undefined);
    if (!shape) fail("data_root_contains_unowned_entry");
    const child = await lstat(join(root, entry)).catch(() => fail("data_root_changed"));
    if (child.isSymbolicLink()) fail("data_root_contains_symlink");
    if (
      (shape === "file" && !child.isFile())
      || (shape === "directory" && !child.isDirectory())
    ) fail("data_root_entry_shape_invalid");
  }
}

function processIsRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function cleanupStaleControlTemps(root: string): Promise<void> {
  let changed = false;
  for (const entry of await readdir(root)) {
    const match = /^castle-(?:owner|state|pending|attempt)\.json\.tmp-(\d+)-[0-9a-f-]+$/.exec(
      entry,
    );
    if (!match) continue;
    if (processIsRunning(Number(match[1]))) {
      fail("data_root_control_write_busy");
    }
    await unlink(join(root, entry));
    changed = true;
  }
  if (changed) await syncDirectory(root);
}

async function prepareOwnedDataRoot(
  requested: string,
  sourceRootSha256: string,
  haltPaths: readonly string[],
): Promise<string> {
  await assertHaltsClear(haltPaths);
  const path = resolve(requested);
  try {
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isDirectory()) {
      fail("data_root_not_directory");
    }
  } catch (error) {
    if (
      error instanceof CastleBridgeError
      || (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) throw error;
    await assertHaltsClear(haltPaths);
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  const root = await realpath(path).catch(() => fail("data_root_unreadable"));
  await validateDataRootShape(root);
  let owner = await readOwner(root);
  if (!owner) {
    await assertHaltsClear(haltPaths);
    await cleanupStaleControlTemps(root);
    if ((await readdir(root)).length !== 0) fail("data_root_not_empty_or_owned");
    await assertHaltsClear(haltPaths);
    owner = Object.freeze({
      schema: CASTLE_OWNER_SCHEMA,
      collection_id: CASTLE_COLLECTION_ID,
      source_root_sha256: sourceRootSha256,
      created_at: new Date().toISOString(),
    });
    await writePrivateJsonAtomic(ownerPath(root), owner);
  }
  if (owner.source_root_sha256 !== sourceRootSha256) {
    fail("data_root_belongs_to_another_castle");
  }
  await validateDataRootShape(root);
  return root;
}

async function requireOwnedDataRoot(
  requested: string,
  expectedSourceRootSha256?: string,
): Promise<{ root: string; owner: CastleOwner }> {
  const path = resolve(requested);
  const requestedInfo = await lstat(path).catch(() => fail("castle_projection_empty"));
  if (requestedInfo.isSymbolicLink() || !requestedInfo.isDirectory()) {
    fail("data_root_not_directory");
  }
  const root = await realpath(path).catch(() => fail("data_root_unreadable"));
  await validateDataRootShape(root);
  const owner = await readOwner(root);
  if (!owner) fail("data_root_owner_missing");
  if (
    expectedSourceRootSha256
    && owner.source_root_sha256 !== expectedSourceRootSha256
  ) fail("data_root_belongs_to_another_castle");
  return { root, owner };
}

function validateActiveRecord(value: unknown): ActiveRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("state_record_invalid");
  }
  const object = value as Record<string, unknown>;
  if (!hasExactKeys(object, [
    "bytes",
    "kind",
    "logical_id",
    "record_id",
    "sha256",
    "source_revision",
    "title",
  ])) fail("state_record_invalid");
  const recordId = requireString(object.record_id, "state_record_id_invalid", 68);
  const digest = requireString(object.sha256, "state_digest_invalid", 64);
  const revision = requireString(object.source_revision, "state_revision_invalid", 64);
  const logicalId = requireString(object.logical_id, "state_logical_id_invalid", 180);
  const kind = requireString(object.kind, "state_kind_invalid", 32) as CastleKind;
  const title = requireString(object.title, "state_title_invalid", 200);
  if (
    !RECORD_ID_RE.test(recordId)
    || !SHA256_RE.test(digest)
    || !COMMIT_RE.test(revision)
    || !SAFE_LOGICAL_ID_RE.test(logicalId)
    || !["room", "word", "generated-room"].includes(kind)
    || !Number.isSafeInteger(object.bytes)
    || (object.bytes as number) < 0
    || (object.bytes as number) > MAX_DOCUMENT_BYTES
  ) fail("state_record_invalid");
  return Object.freeze({
    logical_id: logicalId,
    kind,
    record_id: recordId,
    sha256: digest,
    bytes: object.bytes as number,
    title,
    source_revision: revision,
  });
}

function validateRecordMap(value: unknown): Readonly<Record<string, ActiveRecord>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("state_record_map_invalid");
  }
  const result: Record<string, ActiveRecord> = {};
  const folded = new Set<string>();
  for (const [rawPath, record] of Object.entries(value as Record<string, unknown>)) {
    const path = safeCastlePath(rawPath, "state_path_invalid");
    if (folded.has(path.toLowerCase())) fail("state_path_collision");
    folded.add(path.toLowerCase());
    const checked = validateActiveRecord(record);
    if (checked.kind !== expectedKind(path)) fail("state_kind_path_mismatch");
    result[path] = checked;
  }
  return Object.freeze(result);
}

function validateState(value: unknown): CastleState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("state_invalid");
  }
  const object = value as Record<string, unknown>;
  const allowed = new Set([
    "active",
    "current_revision",
    "known_record_ids",
    "lineage",
    "root_record_id",
    "root_lineage_record_id",
    "schema",
    "selection_sha256",
    "source_root_sha256",
    "status",
    "withdrawal_reason",
    "withdrawn_at",
  ]);
  if (Object.keys(object).some((key) => !allowed.has(key))) fail("state_unknown_field");
  if (object.schema !== CASTLE_STATE_SCHEMA) fail("state_schema_mismatch");
  if (object.status !== "active" && object.status !== "withdrawn") {
    fail("state_status_invalid");
  }
  const sourceRoot = requireString(
    object.source_root_sha256,
    "state_source_root_invalid",
    64,
  );
  const revision = requireString(object.current_revision, "state_revision_invalid", 64);
  const selectionDigest = requireString(
    object.selection_sha256,
    "state_selection_digest_invalid",
    64,
  );
  if (!SHA256_RE.test(sourceRoot) || !COMMIT_RE.test(revision) || !SHA256_RE.test(selectionDigest)) {
    fail("state_digest_or_revision_invalid");
  }
  const rootRecord = object.root_record_id;
  if (rootRecord !== null && (typeof rootRecord !== "string" || !RECORD_ID_RE.test(rootRecord))) {
    fail("state_root_record_invalid");
  }
  const rootLineageRecord = object.root_lineage_record_id;
  if (
    rootLineageRecord !== null
    && (
      typeof rootLineageRecord !== "string"
      || !RECORD_ID_RE.test(rootLineageRecord)
    )
  ) fail("state_root_lineage_record_invalid");
  if (!Array.isArray(object.known_record_ids) || object.known_record_ids.length > MAX_KNOWN_RECORDS) {
    fail("state_known_records_invalid");
  }
  const known = object.known_record_ids.map((id) => {
    if (typeof id !== "string" || !RECORD_ID_RE.test(id)) {
      fail("state_known_record_id_invalid");
    }
    return id;
  });
  const knownSet = new Set(known);
  if (knownSet.size !== known.length) fail("state_known_record_duplicate");
  const active = validateRecordMap(object.active);
  const lineage = validateRecordMap(object.lineage);
  for (const [path, record] of Object.entries(active)) {
    if (lineage[path]?.record_id !== record.record_id) fail("state_lineage_not_current");
    if (!knownSet.has(record.record_id)) fail("state_current_record_not_known");
  }
  for (const record of Object.values(lineage)) {
    if (!knownSet.has(record.record_id)) fail("state_lineage_record_not_known");
  }
  if (rootRecord && !knownSet.has(rootRecord)) fail("state_root_record_not_known");
  if (rootLineageRecord && !knownSet.has(rootLineageRecord)) {
    fail("state_root_lineage_record_not_known");
  }
  if (object.status === "withdrawn" && (Object.keys(active).length || rootRecord !== null)) {
    fail("withdrawn_state_still_active");
  }
  if (
    object.status === "active"
    && (!rootRecord || rootLineageRecord !== rootRecord)
  ) fail("active_state_root_lineage_mismatch");
  if (
    object.status === "active"
    && (object.withdrawn_at !== undefined || object.withdrawal_reason !== undefined)
  ) fail("active_state_has_withdrawal_fields");
  if (
    object.status === "withdrawn"
    && (object.withdrawn_at === undefined || object.withdrawal_reason === undefined)
  ) fail("withdrawn_state_missing_reason");
  const result: CastleState = {
    schema: CASTLE_STATE_SCHEMA,
    status: object.status,
    source_root_sha256: sourceRoot,
    current_revision: revision,
    selection_sha256: selectionDigest,
    root_record_id: rootRecord,
    root_lineage_record_id: rootLineageRecord,
    active,
    lineage,
    known_record_ids: Object.freeze([...known]),
    ...(object.withdrawn_at !== undefined
      ? { withdrawn_at: requireString(object.withdrawn_at, "state_withdrawn_at_invalid", 64) }
      : {}),
    ...(object.withdrawal_reason !== undefined
      ? {
          withdrawal_reason: requireString(
            object.withdrawal_reason,
            "state_withdrawal_reason_invalid",
            500,
          ),
        }
      : {}),
  };
  return Object.freeze(result);
}

function validatePending(value: unknown): CastlePending {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("pending_invalid");
  }
  const object = value as Record<string, unknown>;
  if (!hasExactKeys(object, ["next_state", "schema", "tombstone_ids"])) {
    fail("pending_unknown_or_missing_field");
  }
  if (object.schema !== CASTLE_PENDING_SCHEMA) fail("pending_schema_mismatch");
  if (!Array.isArray(object.tombstone_ids)) fail("pending_tombstones_invalid");
  const ids = object.tombstone_ids.map((id) => {
    if (typeof id !== "string" || !RECORD_ID_RE.test(id)) {
      fail("pending_tombstone_id_invalid");
    }
    return id;
  });
  if (new Set(ids).size !== ids.length || ids.length > MAX_KNOWN_RECORDS) {
    fail("pending_tombstones_invalid");
  }
  const nextState = validateState(object.next_state);
  const known = new Set(nextState.known_record_ids);
  if (ids.some((id) => !known.has(id))) {
    fail("pending_tombstone_not_known");
  }
  const currentIds = new Set([
    ...Object.values(nextState.active).map((record) => record.record_id),
    ...(nextState.root_record_id ? [nextState.root_record_id] : []),
  ]);
  if (ids.some((id) => currentIds.has(id))) {
    fail("pending_tombstones_current_record");
  }
  return Object.freeze({
    schema: CASTLE_PENDING_SCHEMA,
    next_state: nextState,
    tombstone_ids: Object.freeze(ids),
  });
}

async function readState(root: string): Promise<CastleState | null> {
  const value = await readOptionalJson(statePath(root), "state");
  return value === null ? null : validateState(value);
}

async function readPending(root: string): Promise<CastlePending | null> {
  const value = await readOptionalJson(pendingPath(root), "pending");
  return value === null ? null : validatePending(value);
}

async function syncDirectory(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch {
    // Some filesystems do not support directory fsync. The file itself was synced.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writePrivateJsonAtomic(path: string, value: unknown): Promise<void> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  try {
    const existing = await lstat(path);
    if (existing.isSymbolicLink() || !existing.isFile()) fail("state_destination_unsafe");
  } catch (error) {
    if (
      error instanceof CastleBridgeError
      || (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) throw error;
  }
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(temporary, "wx", 0o600);
  let installed = false;
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporary, path);
    installed = true;
    await syncDirectory(parent);
  } finally {
    await handle.close().catch(() => undefined);
    if (!installed) await unlink(temporary).catch(() => undefined);
  }
}

async function withCastleLock<T>(root: string, work: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = join(root, LOCK_DIRECTORY);
  let acquired = false;
  for (let attempt = 0; attempt < 2 && !acquired; attempt += 1) {
    try {
      await mkdir(lock, { mode: 0o700 });
      acquired = true;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "EEXIST"
        || attempt > 0
        || !await removeStaleLock(root, lock)
      ) fail("castle_bridge_lock_busy");
    }
  }
  if (!acquired) fail("castle_bridge_lock_busy");
  const owner = join(lock, `owner-${process.pid}.json`);
  try {
    await writeFile(
      owner,
      `${JSON.stringify({
        pid: process.pid,
        started_at: new Date().toISOString(),
      }, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    return await work();
  } finally {
    await unlink(owner).catch(() => undefined);
    await rmdir(lock).catch(() => undefined);
  }
}

async function removeStaleLock(root: string, lock: string): Promise<boolean> {
  const entries = await readdir(lock).catch(() => []);
  if (entries.length !== 1) return false;
  const entry = entries[0]!;
  const match = /^owner-(\d+)\.json$/.exec(entry);
  if (!match) return false;
  const pid = Number(match[1]);
  if (processIsRunning(pid)) return false;

  const owner = join(lock, entry);
  try {
    const info = await lstat(owner);
    if (info.isSymbolicLink() || !info.isFile()) return false;
    const bytes = await readRegularFileNoFollow(
      owner,
      MAX_LOCK_OWNER_BYTES,
      "castle_bridge_lock_owner",
    );
    const value = JSON.parse(decodeUtf8(bytes, "castle_bridge_lock_owner_not_utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const object = value as Record<string, unknown>;
    if (!hasExactKeys(object, ["pid", "started_at"])) return false;
    if (object.pid !== pid || typeof object.started_at !== "string") return false;
    if (new Date(object.started_at).toISOString() !== object.started_at) return false;
    await unlink(owner);
  } catch {
    return false;
  }

  try {
    await rmdir(lock);
    await syncDirectory(root);
    return true;
  } catch {
    return false;
  }
}

async function openCastleNode(root: string): Promise<DataNode> {
  return DataNode.open({
    root,
    collections: [{
      id: CASTLE_COLLECTION_ID,
      name: "Castle of Understanding",
      description:
        "Operator-selected committed Castle Markdown and its canonical local root manifest",
      schema: { version: CASTLE_COLLECTION_SCHEMA },
      policy: {
        visibility: "private",
        max_record_bytes: MAX_ROOT_BYTES,
        allowed_media_types: ["text/markdown", "application/json"],
      },
    }],
    limits: {
      max_record_bytes: MAX_ROOT_BYTES,
      max_query_limit: MAX_QUERY_LIMIT,
    },
  });
}

async function completePending(
  root: string,
  node: DataNode,
  haltPaths?: readonly string[],
): Promise<boolean> {
  const pending = await readPending(root);
  if (!pending) return false;
  validateStateAgainstNode(pending.next_state, node);
  for (const id of pending.tombstone_ids) {
    if (haltPaths) await assertHaltsClear(haltPaths);
    if (!node.getTombstone(id)) await node.tombstone(id, "superseded or retired");
  }
  if (haltPaths) await assertHaltsClear(haltPaths);
  await writePrivateJsonAtomic(statePath(root), pending.next_state);
  if (haltPaths) await assertHaltsClear(haltPaths);
  await unlink(pendingPath(root));
  await syncDirectory(root);
  return true;
}

function validateTransition(previous: CastleState | null, plan: CastlePlan): void {
  if (!previous || previous.status === "withdrawn") {
    if (plan.retire_paths.length) fail("initial_or_resumed_selection_cannot_retire");
    return;
  }
  const selected = new Set(plan.documents.map((document) => document.path));
  const retired = new Set(plan.retire_paths);
  for (const path of Object.keys(previous.active)) {
    if (!selected.has(path) && !retired.has(path)) {
      fail("selection_omitted_active_path_without_retirement");
    }
  }
  for (const path of retired) {
    if (!previous.active[path]) fail("selection_retires_unknown_path");
  }
}

function validateStateAgainstNode(state: CastleState | null, node: DataNode): void {
  if (!state) return;
  for (const id of state.known_record_ids) {
    const stored = node.getRecord(id, true);
    if (!stored || stored.collection_id !== CASTLE_COLLECTION_ID) {
      fail("state_known_record_missing_or_wrong_collection");
    }
  }
  if (state.status === "withdrawn") return;
  for (const record of Object.values(state.active)) {
    const stored = node.getRecord(record.record_id);
    if (
      !stored
      || stored.collection_id !== CASTLE_COLLECTION_ID
      || stored.content.sha256 !== record.sha256
      || stored.content.size !== record.bytes
    ) fail("state_current_record_missing_or_mismatched");
  }
  if (state.root_record_id && !node.getRecord(state.root_record_id)) {
    fail("state_root_record_missing");
  }
}

function collectionRecordIds(node: DataNode): readonly string[] {
  const ids = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = node.changes({
      collection_id: CASTLE_COLLECTION_ID,
      ...(cursor ? { cursor } : {}),
      limit: 1000,
    });
    for (const change of page.changes) {
      if (change.collection_id !== CASTLE_COLLECTION_ID) {
        fail("collection_change_wrong_collection");
      }
      ids.add(change.record_id);
      if (ids.size > MAX_KNOWN_RECORDS) fail("known_record_limit");
    }
    cursor = page.has_more ? page.cursor : undefined;
  } while (cursor);
  return Object.freeze([...ids].sort());
}

function recoverLineageFromNode(node: DataNode): {
  lineage: Readonly<Record<string, ActiveRecord>>;
  root_lineage_record_id: string | null;
} {
  const lineage: Record<string, ActiveRecord> = {};
  let rootLineage: string | null = null;
  let cursor: string | undefined;
  do {
    const page = node.changes({
      collection_id: CASTLE_COLLECTION_ID,
      ...(cursor ? { cursor } : {}),
      limit: 1000,
    });
    for (const change of page.changes) {
      if (change.type !== "record.created") continue;
      const record = change.record;
      if (
        record.collection_id !== CASTLE_COLLECTION_ID
        || record.source.collector_id !== "text"
      ) fail("unexpected_castle_record");
      if (
        record.source.uri === "castle:///manifest"
        && record.metadata.profile === CASTLE_ROOT_SCHEMA
      ) {
        rootLineage = record.id;
        continue;
      }
      const metadata = record.metadata as Record<string, unknown>;
      if (metadata.profile !== "castle-document/v1") {
        fail("unexpected_castle_record");
      }
      const path = safeCastlePath(metadata.source_path, "stored_source_path_invalid");
      const candidate = validateActiveRecord({
        logical_id: metadata.logical_id,
        kind: metadata.document_kind,
        record_id: record.id,
        sha256: record.content.sha256,
        bytes: record.content.size,
        title: metadata.title,
        source_revision: metadata.source_revision,
      });
      if (
        record.source.uri !== `castle:///${path}`
        || record.source.external_id !== path
        || record.key !== candidate.logical_id
        || metadata.source_sha256 !== candidate.sha256
        || candidate.kind !== expectedKind(path)
      ) fail("stored_castle_record_mismatch");
      lineage[path] = candidate;
    }
    cursor = page.has_more ? page.cursor : undefined;
  } while (cursor);
  return Object.freeze({
    lineage: Object.freeze(lineage),
    root_lineage_record_id: rootLineage,
  });
}

async function collectDocument(
  node: DataNode,
  document: CastleDocument,
  plan: CastlePlan,
  supersedesId?: string,
): Promise<{ active: ActiveRecord; inserted: boolean }> {
  const projectedAt = new Date().toISOString();
  const version = `${plan.revision}:sha256:${document.sha256}`;
  const response = await node.collect({
    collection_id: CASTLE_COLLECTION_ID,
    collector_id: "text",
    input: {
      text: document.text,
      media_type: "text/markdown",
      source_uri: `castle:///${document.path}`,
      external_id: document.path,
      key: document.logical_id,
      version,
      ...(supersedesId ? { supersedes_id: supersedesId } : {}),
      observed_at: projectedAt,
      metadata: {
        profile: "castle-document/v1",
        logical_id: document.logical_id,
        document_kind: document.kind,
        source_path: document.path,
        source_revision: plan.revision,
        source_committed_at: plan.revision_time,
        source_blob_oid: document.git_blob_oid,
        source_sha256: document.sha256,
        title: document.title,
        links: [...document.links],
        content_is_untrusted_markdown: true,
        local_private_projection: true,
      },
      provenance: [{
        activity: "projected_from_committed_git_blob",
        at: projectedAt,
        actor: "local:agenttool-castle",
        input_ids: [],
      }],
    } as JsonObject,
  });
  const record = response.records[0];
  if (
    !record
    || response.records.length !== 1
    || record.content.sha256 !== document.sha256
    || record.content.size !== document.bytes
    || record.source.uri !== `castle:///${document.path}`
    || record.source.external_id !== document.path
    || record.key !== document.logical_id
    || record.version !== version
    || record.supersedes_id !== supersedesId
    || record.metadata.profile !== "castle-document/v1"
    || record.metadata.logical_id !== document.logical_id
    || record.metadata.document_kind !== document.kind
    || record.metadata.source_path !== document.path
    || record.metadata.source_revision !== plan.revision
    || record.metadata.source_committed_at !== plan.revision_time
    || record.metadata.source_blob_oid !== document.git_blob_oid
    || record.metadata.source_sha256 !== document.sha256
    || record.metadata.title !== document.title
    || canonicalJson(record.metadata.links) !== canonicalJson([...document.links])
    || record.metadata.content_is_untrusted_markdown !== true
    || record.metadata.local_private_projection !== true
  ) fail("collected_document_echo_mismatch");
  return {
    active: Object.freeze({
      logical_id: document.logical_id,
      kind: document.kind,
      record_id: record.id,
      sha256: document.sha256,
      bytes: document.bytes,
      title: document.title,
      source_revision: plan.revision,
    }),
    inserted: response.inserted === 1,
  };
}

function rootManifest(
  plan: CastlePlan,
  active: Readonly<Record<string, ActiveRecord>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schema: CASTLE_ROOT_SCHEMA,
    audience: "local-private",
    source_revision: plan.revision,
    source_committed_at: plan.revision_time,
    selection_sha256: plan.selection_sha256,
    purpose: plan.purpose,
    retention: plan.retention,
    retired_paths: [...plan.retire_paths],
    active: Object.keys(active).sort().map((path) => ({
      path,
      ...active[path],
    })),
    limits: {
      max_documents: MAX_DOCUMENTS,
      max_document_bytes: MAX_DOCUMENT_BYTES,
      max_total_bytes: MAX_TOTAL_BYTES,
    },
    exclusions: [
      "live working tree",
      "courtyard, questions, quests, chronicle, journal, garden, hidden state",
      "Tower and authored works unless separately selected by a later profile",
      "hosted AgentTool memory, traces, correspondence, and wake",
    ],
    proof_limits: [
      "A Git commit and digest prove captured bytes, not truth, understanding, authorship, authority, consent, rights, completeness, or currentness.",
      "Markdown remains untrusted data and is never executed or fetched by this bridge.",
      "Agent Data visibility and retention fields are declarations; local in-process custody is the actual privacy boundary.",
      "A tombstone hides a record from normal reads but does not physically erase blobs, Git history, backups, caches, or copies.",
    ],
  });
}

async function collectRootManifest(
  node: DataNode,
  plan: CastlePlan,
  active: Readonly<Record<string, ActiveRecord>>,
  supersedesId?: string,
): Promise<{ record: RecordEnvelope; inserted: boolean; digest: string }> {
  const text = `${canonicalJson(rootManifest(plan, active))}\n`;
  const digest = sha256Hex(text);
  const projectedAt = new Date().toISOString();
  const version = `${plan.revision}:sha256:${digest}`;
  const response = await node.collect({
    collection_id: CASTLE_COLLECTION_ID,
    collector_id: "text",
    input: {
      text,
      media_type: "application/json",
      source_uri: "castle:///manifest",
      external_id: "castle-root",
      key: "castle:root:manifest",
      version,
      ...(supersedesId ? { supersedes_id: supersedesId } : {}),
      observed_at: projectedAt,
      metadata: {
        profile: CASTLE_ROOT_SCHEMA,
        source_revision: plan.revision,
        source_committed_at: plan.revision_time,
        selection_sha256: plan.selection_sha256,
        active_records: Object.keys(active).length,
        local_private_projection: true,
      },
      provenance: [{
        activity: "bound_local_projection",
        at: projectedAt,
        actor: "local:agenttool-castle",
        input_ids: Object.values(active).map((record) => record.record_id),
      }],
    } as JsonObject,
  });
  const record = response.records[0];
  if (
    !record
    || response.records.length !== 1
    || record.content.sha256 !== digest
    || record.source.uri !== "castle:///manifest"
    || record.key !== "castle:root:manifest"
    || record.version !== version
    || record.supersedes_id !== supersedesId
    || record.metadata.profile !== CASTLE_ROOT_SCHEMA
    || record.metadata.source_revision !== plan.revision
    || record.metadata.source_committed_at !== plan.revision_time
    || record.metadata.selection_sha256 !== plan.selection_sha256
    || record.metadata.active_records !== Object.keys(active).length
    || record.metadata.local_private_projection !== true
  ) fail("collected_root_echo_mismatch");
  return { record, inserted: response.inserted === 1, digest };
}

export async function syncCastle(options: CastlePaths & {
  resume?: boolean;
}): Promise<Readonly<Record<string, unknown>>> {
  if (options.halt_paths.length === 0) fail("halt_paths_required");
  await assertHaltsClear(options.halt_paths);
  const rawDataRoot = resolve(options.data_root);
  const sourceRoot = await resolveCastleRoot(options.castle_root);
  if (pathInside(sourceRoot, rawDataRoot)) {
    fail("data_root_must_live_outside_castle");
  }
  const requestedDataRoot = await resolveProspectivePath(rawDataRoot);
  if (pathInside(sourceRoot, requestedDataRoot)) {
    fail("data_root_must_live_outside_castle");
  }
  await assertHaltsClear(options.halt_paths);
  const plan = await buildCastlePlan({
    castle_root: sourceRoot,
    selection_path: options.selection_path,
  });
  await assertHaltsClear(options.halt_paths);
  const dataRoot = await prepareOwnedDataRoot(
    requestedDataRoot,
    sha256Hex(sourceRoot),
    options.halt_paths,
  );
  if (pathInside(sourceRoot, dataRoot)) fail("data_root_must_live_outside_castle");

  return withCastleLock(dataRoot, async () => {
    await assertHaltsClear(options.halt_paths);
    await requireOwnedDataRoot(dataRoot, sha256Hex(sourceRoot));
    await cleanupStaleControlTemps(dataRoot);
    const node = await openCastleNode(dataRoot);
    const insertedIds: string[] = [];
    try {
      await assertHaltsClear(options.halt_paths);
      await completePending(dataRoot, node, options.halt_paths);
      await assertHaltsClear(options.halt_paths);
      const interruptedAttempt = await readAttempt(dataRoot);
      const previous = await readState(dataRoot);
      if (previous && previous.source_root_sha256 !== plan.source_root_sha256) {
        fail("data_root_belongs_to_another_castle");
      }
      if (previous?.status === "withdrawn" && !options.resume) {
        fail("withdrawn_projection_requires_explicit_resume");
      }
      validateTransition(previous, plan);
      validateStateAgainstNode(previous, node);

      if (
        previous?.status === "active"
        && previous.current_revision === plan.revision
        && previous.selection_sha256 === plan.selection_sha256
      ) {
        if (interruptedAttempt) {
          const known = new Set(previous.known_record_ids);
          const currentIds = new Set([
            ...Object.values(previous.active).map((record) => record.record_id),
            previous.root_record_id!,
          ]);
          const tombstones: string[] = [];
          for (const id of collectionRecordIds(node)) {
            known.add(id);
            if (!currentIds.has(id) && !node.getTombstone(id)) {
              tombstones.push(id);
            }
          }
          const recoveredState: CastleState = Object.freeze({
            ...previous,
            known_record_ids: Object.freeze([...known].sort()),
          });
          await assertHaltsClear(options.halt_paths);
          await writePrivateJsonAtomic(pendingPath(dataRoot), Object.freeze({
            schema: CASTLE_PENDING_SCHEMA,
            next_state: recoveredState,
            tombstone_ids: Object.freeze(tombstones.sort()),
          }));
          await completePending(dataRoot, node, options.halt_paths);
          await assertHaltsClear(options.halt_paths);
          await unlink(attemptPath(dataRoot));
          await syncDirectory(dataRoot);
          await assertHaltsClear(options.halt_paths);
          return Object.freeze({
            status: "recovered_unchanged",
            revision: plan.revision,
            active_records: Object.keys(previous.active).length,
            recovered_orphans: tombstones.length,
            root_record_id: previous.root_record_id,
          });
        }
        await assertHaltsClear(options.halt_paths);
        return Object.freeze({
          status: "unchanged",
          revision: plan.revision,
          active_records: Object.keys(previous.active).length,
          root_record_id: previous.root_record_id,
        });
      }

      await assertHaltsClear(options.halt_paths);
      await writePrivateJsonAtomic(attemptPath(dataRoot), Object.freeze({
        schema: CASTLE_ATTEMPT_SCHEMA,
        revision: plan.revision,
        selection_sha256: plan.selection_sha256,
        started_at: new Date().toISOString(),
      }));

      const active: Record<string, ActiveRecord> = {};
      const lineage: Record<string, ActiveRecord> = {
        ...(previous?.lineage ?? {}),
      };
      const known = new Set(previous?.known_record_ids ?? []);
      const tombstones = new Set<string>();

      for (const document of plan.documents) {
        await assertHaltsClear(options.halt_paths);
        const prior = previous?.active[document.path];
        if (
          previous?.status === "active"
          && prior
          && prior.sha256 === document.sha256
          && prior.logical_id === document.logical_id
          && prior.kind === document.kind
          && node.getRecord(prior.record_id)
        ) {
          active[document.path] = Object.freeze({
            ...prior,
            title: document.title,
          });
          lineage[document.path] = active[document.path]!;
          continue;
        }
        const supersedes = lineage[document.path]?.record_id;
        const collected = await collectDocument(node, document, plan, supersedes);
        active[document.path] = collected.active;
        lineage[document.path] = collected.active;
        known.add(collected.active.record_id);
        if (collected.inserted) insertedIds.push(collected.active.record_id);
        if (
          previous?.status === "active"
          && prior
          && prior.record_id !== collected.active.record_id
        ) tombstones.add(prior.record_id);
      }

      for (const path of plan.retire_paths) {
        const prior = previous?.active[path];
        if (!prior) fail("selection_retires_unknown_path");
        tombstones.add(prior.record_id);
      }

      await assertHaltsClear(options.halt_paths);
      const root = await collectRootManifest(
        node,
        plan,
        Object.freeze(active),
        previous?.root_lineage_record_id ?? undefined,
      );
      known.add(root.record.id);
      if (root.inserted) insertedIds.push(root.record.id);
      if (previous?.root_record_id && previous.root_record_id !== root.record.id) {
        tombstones.add(previous.root_record_id);
      }
      const currentIds = new Set([
        ...Object.values(active).map((record) => record.record_id),
        root.record.id,
      ]);
      for (const id of collectionRecordIds(node)) {
        known.add(id);
        if (!currentIds.has(id) && !node.getTombstone(id)) {
          tombstones.add(id);
        }
      }
      if (known.size > MAX_KNOWN_RECORDS) fail("known_record_limit");

      const nextState: CastleState = Object.freeze({
        schema: CASTLE_STATE_SCHEMA,
        status: "active",
        source_root_sha256: plan.source_root_sha256,
        current_revision: plan.revision,
        selection_sha256: plan.selection_sha256,
        root_record_id: root.record.id,
        root_lineage_record_id: root.record.id,
        active: Object.freeze(active),
        lineage: Object.freeze(lineage),
        known_record_ids: Object.freeze([...known].sort()),
      });
      const pending: CastlePending = Object.freeze({
        schema: CASTLE_PENDING_SCHEMA,
        next_state: nextState,
        tombstone_ids: Object.freeze([...tombstones].sort()),
      });
      await assertHaltsClear(options.halt_paths);
      await writePrivateJsonAtomic(pendingPath(dataRoot), pending);
      await completePending(dataRoot, node, options.halt_paths);
      await assertHaltsClear(options.halt_paths);
      await unlink(attemptPath(dataRoot));
      await syncDirectory(dataRoot);
      await assertHaltsClear(options.halt_paths);

      return Object.freeze({
        status: "synced",
        revision: plan.revision,
        selection_sha256: plan.selection_sha256,
        active_records: Object.keys(active).length,
        inserted_records: insertedIds.length,
        retired_or_superseded: tombstones.size,
        root_record_id: root.record.id,
        root_sha256: root.digest,
        network: "not used",
      });
    } finally {
      node.close();
    }
  });
}

export async function castleStatus(options: {
  data_root: string;
  halt_paths: readonly string[];
}): Promise<Readonly<Record<string, unknown>>> {
  const halts: Record<string, string> = {};
  for (const path of options.halt_paths) halts[path] = await haltState(path);
  const requested = resolve(options.data_root);
  let state: CastleState | null = null;
  let pending: CastlePending | null = null;
  let attempt: CastleAttempt | null = null;
  let dataRoot = "absent";
  try {
    await lstat(requested);
    const owned = await requireOwnedDataRoot(requested);
    state = await readState(owned.root);
    pending = await readPending(owned.root);
    attempt = await readAttempt(owned.root);
    dataRoot = "owned-local-private";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return Object.freeze({
    schema: "castle-agenttool-status/v1",
    data_root: dataRoot,
    state: state?.status ?? "empty",
    revision: state?.current_revision ?? null,
    active_records: state ? Object.keys(state.active).length : 0,
    known_records: state?.known_record_ids.length ?? 0,
    root_record_id: state?.root_record_id ?? null,
    recovery_pending: Boolean(pending || attempt),
    pending_transaction: Boolean(pending),
    interrupted_attempt: Boolean(attempt),
    halts,
    network: "not used",
    hosted_agenttool: "not used",
  });
}

export async function searchCastle(options: {
  data_root: string;
  halt_paths: readonly string[];
  text: string;
  limit?: number;
}): Promise<Readonly<Record<string, unknown>>> {
  if (options.halt_paths.length === 0) fail("halt_paths_required");
  await assertHaltsClear(options.halt_paths);
  const { root } = await requireOwnedDataRoot(options.data_root);
  if (await readPending(root)) fail("castle_recovery_pending");
  if (await readAttempt(root)) fail("castle_sync_interrupted");
  const state = await readState(root);
  if (!state) fail("castle_projection_empty");
  if (state.status !== "active") fail("castle_projection_withdrawn");
  const query = requireString(options.text, "query_invalid", 500);
  const limit = options.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) {
    fail("query_limit_invalid");
  }
  const node = await openCastleNode(root);
  try {
    validateStateAgainstNode(state, node);
    const byRecord = new Map(
      Object.entries(state.active).map(([path, record]) => [record.record_id, { path, record }]),
    );
    const result = node.query({
      collections: [CASTLE_COLLECTION_ID],
      text: query,
      limit,
      consistency: "local",
      where: { metadata: { profile: "castle-document/v1" } },
    });
    const hits = result.records.flatMap((hit) => {
      const current = byRecord.get(hit.record.id);
      if (!current) return [];
      return [{
        path: current.path,
        logical_id: current.record.logical_id,
        kind: current.record.kind,
        title: current.record.title,
        record_id: hit.record.id,
        source_revision: current.record.source_revision,
        source_sha256: current.record.sha256,
        ...(hit.score !== undefined ? { score: hit.score } : {}),
      }];
    });
    await assertHaltsClear(options.halt_paths);
    return Object.freeze({
      schema: "castle-agenttool-search/v1",
      query,
      projection_revision: state.current_revision,
      hits,
      truth_boundary:
        "A lexical hit is a pointer into selected committed bytes; it does not prove truth, understanding, authorship, authority, consent, rights, completeness, or currentness.",
    });
  } finally {
    node.close();
  }
}

export async function showCastle(options: {
  data_root: string;
  halt_paths: readonly string[];
  path: string;
}): Promise<string> {
  if (options.halt_paths.length === 0) fail("halt_paths_required");
  await assertHaltsClear(options.halt_paths);
  const { root } = await requireOwnedDataRoot(options.data_root);
  if (await readPending(root)) fail("castle_recovery_pending");
  if (await readAttempt(root)) fail("castle_sync_interrupted");
  const state = await readState(root);
  if (!state) fail("castle_projection_empty");
  if (state.status !== "active") fail("castle_projection_withdrawn");
  const path = safeCastlePath(options.path);
  const current = state.active[path];
  if (!current) fail("castle_path_not_active");
  const node = await openCastleNode(root);
  try {
    const record = node.getRecord(current.record_id);
    if (!record || record.content.sha256 !== current.sha256) {
      fail("state_current_record_missing_or_mismatched");
    }
    const bytes = await node.readContent(record);
    const text = decodeUtf8(bytes, "stored_document_not_utf8");
    await assertHaltsClear(options.halt_paths);
    return text;
  } finally {
    node.close();
  }
}

export async function withdrawCastle(options: {
  data_root: string;
  reason: string;
}): Promise<Readonly<Record<string, unknown>>> {
  const reason = requireString(options.reason, "withdrawal_reason_invalid", 500);
  const { root, owner } = await requireOwnedDataRoot(options.data_root);
  return withCastleLock(root, async () => {
    await requireOwnedDataRoot(root);
    await cleanupStaleControlTemps(root);
    const node = await openCastleNode(root);
    try {
      await completePending(root, node);
      const interruptedAttempt = await readAttempt(root);
      let state = await readState(root);
      const stateWasMissing = state === null;
      const allIds = collectionRecordIds(node);
      if (!state) {
        if (!interruptedAttempt) fail("castle_projection_empty");
        const recovered = recoverLineageFromNode(node);
        state = Object.freeze({
          schema: CASTLE_STATE_SCHEMA,
          status: "withdrawn",
          source_root_sha256: owner.source_root_sha256,
          current_revision: interruptedAttempt.revision,
          selection_sha256: interruptedAttempt.selection_sha256,
          root_record_id: null,
          root_lineage_record_id: recovered.root_lineage_record_id,
          active: Object.freeze({}),
          lineage: recovered.lineage,
          known_record_ids: Object.freeze([...allIds]),
          withdrawn_at: new Date().toISOString(),
          withdrawal_reason: reason,
        });
      }
      validateStateAgainstNode(state, node);
      const liveIds = allIds.filter((id) => !node.getTombstone(id));
      if (!stateWasMissing && state.status === "withdrawn" && liveIds.length === 0) {
        if (interruptedAttempt) {
          await unlink(attemptPath(root));
          await syncDirectory(root);
        }
        return Object.freeze({
          status: "already_withdrawn",
          known_records: state.known_record_ids.length,
          new_logical_tombstones: 0,
          physical_erasure: false,
        });
      }
      const known = new Set([...state.known_record_ids, ...allIds]);
      if (known.size > MAX_KNOWN_RECORDS) fail("known_record_limit");
      const next: CastleState = Object.freeze({
        ...state,
        status: "withdrawn",
        root_record_id: null,
        active: Object.freeze({}),
        known_record_ids: Object.freeze([...known].sort()),
        withdrawn_at: new Date().toISOString(),
        withdrawal_reason: reason,
      });
      const pending: CastlePending = Object.freeze({
        schema: CASTLE_PENDING_SCHEMA,
        next_state: next,
        tombstone_ids: Object.freeze(liveIds),
      });
      await writePrivateJsonAtomic(pendingPath(root), pending);
      await completePending(root, node);
      if (interruptedAttempt) {
        await unlink(attemptPath(root));
        await syncDirectory(root);
      }
      return Object.freeze({
        status: "withdrawn",
        known_records: known.size,
        new_logical_tombstones: liveIds.length,
        physical_erasure: false,
        warning:
          "Agent Data tombstones do not erase immutable blobs, Git history, backups, caches, logs, or recipient copies.",
      });
    } finally {
      node.close();
    }
  });
}

type CliArgs = Readonly<{
  command: "plan" | "sync" | "status" | "search" | "show" | "withdraw";
  castle_root: string;
  data_root: string;
  selection_path?: string;
  json: boolean;
  resume: boolean;
  limit: number;
  reason?: string;
  positional: readonly string[];
}>;

function usage(): string {
  return [
    "usage:",
    "  bun bin/agenttool-castle.ts plan --selection <file> [--castle-root <repo>] [--json]",
    "  bun bin/agenttool-castle.ts sync --selection <file> [--castle-root <repo>] [--data-root <dir>] [--resume] [--json]",
    "  bun bin/agenttool-castle.ts status [--data-root <dir>] [--json]",
    "  bun bin/agenttool-castle.ts search <words...> [--data-root <dir>] [--limit <1-100>] [--json]",
    "  bun bin/agenttool-castle.ts show <rooms/name.md|words/name.md> [--data-root <dir>]",
    "  bun bin/agenttool-castle.ts withdraw --reason <plain words> [--data-root <dir>] [--json]",
    "",
    "The selection must live outside the Castle and name one full Git commit plus",
    "an exact local-private allowlist. No command uses a network or hosted bearer.",
    "HALT blocks plan, sync, search, and show. Status and withdrawal remain available.",
    "",
  ].join("\n");
}

function parseCli(argv: readonly string[]): CliArgs | "help" | "version" {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0]!)) return "help";
  if (argv.length === 1 && argv[0] === "--version") return "version";
  const command = argv[0];
  if (!["plan", "sync", "status", "search", "show", "withdraw"].includes(command ?? "")) {
    fail("invalid_command");
  }
  const values: Record<string, string> = {
    castle_root: join(homedir(), "castle"),
    data_root: defaultDataRoot(),
    limit: "10",
  };
  const flags = new Set<string>();
  const providedValues = new Set<string>();
  const positional: string[] = [];
  const valueOptions = new Set([
    "--castle-root",
    "--data-root",
    "--selection",
    "--limit",
    "--reason",
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--json" || token === "--resume") {
      if (flags.has(token)) fail("duplicate_argument");
      flags.add(token);
      continue;
    }
    if (valueOptions.has(token)) {
      const key = token.slice(2).replaceAll("-", "_");
      if (providedValues.has(key)) fail("duplicate_argument");
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail("missing_argument_value");
      values[key] = value;
      providedValues.add(key);
      index += 1;
      continue;
    }
    if (token.startsWith("--")) fail("invalid_argument");
    positional.push(token);
  }
  const limit = Number(values.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) {
    fail("query_limit_invalid");
  }
  const result: CliArgs = Object.freeze({
    command: command as CliArgs["command"],
    castle_root: resolve(values.castle_root!),
    data_root: resolve(values.data_root!),
    ...(values.selection ? { selection_path: resolve(values.selection) } : {}),
    json: flags.has("--json"),
    resume: flags.has("--resume"),
    limit,
    ...(values.reason ? { reason: values.reason } : {}),
    positional: Object.freeze(positional),
  });
  if (
    (result.command === "plan" || result.command === "sync")
    && !result.selection_path
  ) fail("selection_required");
  if (result.command === "search" && result.positional.length === 0) {
    fail("query_required");
  }
  if (result.command === "show" && result.positional.length !== 1) {
    fail("show_requires_one_path");
  }
  if (result.command === "withdraw" && !result.reason) fail("withdrawal_reason_required");
  if (
    !["search", "show"].includes(result.command)
    && result.positional.length
  ) fail("unexpected_positional_argument");
  if (result.resume && result.command !== "sync") fail("resume_only_for_sync");
  const allowedValues: Readonly<Record<CliArgs["command"], readonly string[]>> = {
    plan: ["castle_root", "selection"],
    sync: ["castle_root", "data_root", "selection"],
    status: ["data_root"],
    search: ["data_root", "limit"],
    show: ["data_root"],
    withdraw: ["data_root", "reason"],
  };
  if ([...providedValues].some(
    (key) => !allowedValues[result.command].includes(key),
  )) fail("argument_not_allowed_for_command");
  if (result.command === "show" && result.json) {
    fail("argument_not_allowed_for_command");
  }
  return result;
}

function planSummary(plan: CastlePlan): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schema: "castle-agenttool-plan/v1",
    revision: plan.revision,
    selection_sha256: plan.selection_sha256,
    audience: plan.audience,
    document_count: plan.documents.length,
    documents: plan.documents.map((document) => ({
      path: document.path,
      logical_id: document.logical_id,
      kind: document.kind,
      bytes: document.bytes,
      sha256: document.sha256,
      git_blob_oid: document.git_blob_oid,
    })),
    retire_paths: plan.retire_paths.length,
    total_bytes: plan.total_bytes,
    kinds: {
      rooms: plan.documents.filter((document) => document.kind === "room").length,
      words: plan.documents.filter((document) => document.kind === "word").length,
      generated_rooms: plan.documents.filter(
        (document) => document.kind === "generated-room",
      ).length,
    },
    source: "exact committed Git blobs",
    working_tree: "not read",
    network: "not used",
    hosted_agenttool: "not used",
  });
}

function plainResult(result: Readonly<Record<string, unknown>>): string {
  return `${Object.entries(result)
    .map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : value}`)
    .join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseCli(argv);
  if (args === "help") {
    process.stdout.write(usage());
    return;
  }
  if (args === "version") {
    process.stdout.write(`${CASTLE_BRIDGE_VERSION}\n`);
    return;
  }
  const haltPaths = defaultHaltPaths();
  let result: Readonly<Record<string, unknown>> | string;
  switch (args.command) {
    case "plan": {
      await assertHaltsClear(haltPaths);
      const plan = await buildCastlePlan({
        castle_root: args.castle_root,
        selection_path: args.selection_path!,
      });
      await assertHaltsClear(haltPaths);
      result = planSummary(plan);
      break;
    }
    case "sync":
      result = await syncCastle({
        castle_root: args.castle_root,
        data_root: args.data_root,
        selection_path: args.selection_path!,
        halt_paths: haltPaths,
        resume: args.resume,
      });
      break;
    case "status":
      result = await castleStatus({
        data_root: args.data_root,
        halt_paths: haltPaths,
      });
      break;
    case "search":
      result = await searchCastle({
        data_root: args.data_root,
        halt_paths: haltPaths,
        text: args.positional.join(" "),
        limit: args.limit,
      });
      break;
    case "show":
      result = await showCastle({
        data_root: args.data_root,
        halt_paths: haltPaths,
        path: args.positional[0]!,
      });
      break;
    case "withdraw":
      result = await withdrawCastle({
        data_root: args.data_root,
        reason: args.reason!,
      });
      break;
  }
  if (typeof result === "string") {
    process.stdout.write(result);
  } else {
    process.stdout.write(args.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : plainResult(result));
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    const code = error instanceof CastleBridgeError
      ? error.code
      : "unexpected_failure";
    process.stderr.write(`agenttool-castle: ${code}\n`);
    process.exitCode = 1;
  });
}
