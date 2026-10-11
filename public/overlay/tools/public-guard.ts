#!/usr/bin/env bun
/**
 * Public guard for the one-way projection of AgentTool's package source.
 *
 *   bun tools/public-guard.ts [--rev <commit>] [--gitleaks <binary>]
 *                             [--projection-commit] [--expect-parent <sha>|none]
 *                             [--history]
 *
 * It reads the committed tree of <rev> (default HEAD) through Git plumbing,
 * never the working tree, and fails closed:
 *
 * - integrity: PROJECTION.json is canonical and every path and overlay entry
 *   it lists matches the tree object or blob that is actually committed;
 * - path layer: every file sits under a PROJECTION.json path, is an overlay
 *   file, or is PROJECTION.json itself; no symlinks, submodules, files over
 *   5 MiB, credential-shaped names, dependency or test-output directories, or
 *   nested gitleaks configuration;
 * - secret layer: credential signatures shared with the npm release tool and
 *   the public doors guard, plus gitleaks when a pinned binary is given;
 * - personal layer: home-directory and device paths, email addresses outside
 *   reserved and project domains, and local keychain slot names;
 * - history (--history): every ancestor of <rev> is itself a projection
 *   commit whose tree matches its own PROJECTION.json, so no private commit,
 *   tree, or message can sit anywhere in the public parent chain.
 *
 * Allowed exceptions live in tools/public-guard-allow.json. Each entry names a
 * path, a rule, the SHA-256 of the whole line (never its text), a reason, and
 * an approver. An unused entry is itself a finding, so the list cannot rot.
 * Findings print path, line, and rule only; matched text is never echoed.
 *
 * The private projector imports this module and adds layers that cannot be
 * published. This copy cannot prevent anything; it detects drift after the
 * fact.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const GUARD_VERSION = "agenttool.public-guard/1";
export const PROJECTION_SCHEMA = "agenttool.public-projection/1";
export const GUARD_ALLOW_SCHEMA = "agenttool.public-guard-allow/1";
export const PROJECTION_FILE = "PROJECTION.json";
export const GUARD_FILE = "tools/public-guard.ts";
export const GUARD_ALLOW_FILE = "tools/public-guard-allow.json";
export const GITLEAKS_IGNORE_FILE = ".gitleaksignore";
export const GITLEAKS_VERSION = "8.30.1";
export const MAX_BLOB_BYTES = 5 * 1024 * 1024;
export const PROJECTION_AUTHOR_NAME = "AgentTool projection";
export const PROJECTION_AUTHOR_EMAIL = "contact@cambridgetcg.com";

export type Layer = "integrity" | "path" | "secret" | "personal" | "relational" | "gitleaks";

export interface TreeEntry {
  mode: string;
  type: string;
  oid: string;
  /** Blob size in bytes; -1 for trees and submodules. */
  size: number;
  path: string;
}

export interface Finding {
  layer: Layer;
  rule: string;
  path: string;
  line?: number;
  lineSha256?: string;
  /** Never matched text. Paths, object ids, and counts only. */
  detail?: string;
}

export interface AllowEntry {
  path: string;
  rule: string;
  line_sha256: string;
  reason: string;
  approver: string;
}

export interface ContentRule {
  id: string;
  layer: "secret" | "personal" | "relational";
  pattern: RegExp;
  /** Returns true when this particular match is a documented placeholder. */
  permit?: (match: RegExpExecArray) => boolean;
}

export interface ProjectionPath {
  path: string;
  tree?: string;
  blob?: string;
}

export interface ProjectionOverlay {
  path: string;
  blob: string;
}

export interface Projection {
  schema: typeof PROJECTION_SCHEMA;
  source_commit: string;
  allowlist_sha256: string;
  paths: ProjectionPath[];
  excluded: string[];
  overlay: ProjectionOverlay[];
  guard: { gitleaks: string; public_guard: string };
}

// ---------------------------------------------------------------------------
// Small utilities

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const HEX64 = /^[0-9a-f]{64}$/;

export function isOid(value: unknown): value is string {
  return typeof value === "string" && OID.test(value);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 8000);
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) return true;
  }
  return false;
}

/** Safe relative POSIX path: no empty, ".", or ".." segment and no control characters. */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || path.endsWith("/")) return false;
  if (/[\u0000-\u001f\u007f\\]/u.test(path)) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** True when `path` equals `prefix` or lies inside the directory `prefix`. */
export function isWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

// ---------------------------------------------------------------------------
// Git plumbing (read-only)

export interface GitResult {
  status: number;
  stdout: Buffer;
  stderr: string;
}

/** Variables that would silently redirect Git to another repository, index, or object store. */
const REDIRECTING_GIT_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_REPLACE_REF_BASE",
];

export function repositoryEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !REDIRECTING_GIT_ENV.includes(key)) env[key] = value;
  }
  return { ...env, GIT_NO_REPLACE_OBJECTS: "1" };
}

export function git(
  cwd: string,
  args: readonly string[],
  options: { input?: Uint8Array | string; env?: Record<string, string | undefined>; allowFailure?: boolean } = {},
): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    input: options.input,
    env: options.env ?? repositoryEnv(),
    maxBuffer: 1 << 30,
  });
  if (result.error) throw result.error;
  const out: GitResult = {
    status: result.status ?? 1,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString("utf8"),
  };
  if (out.status !== 0 && !options.allowFailure) {
    throw new Error(`git ${args.join(" ")} failed (${out.status}): ${out.stderr.trim()}`);
  }
  return out;
}

export function gitText(cwd: string, args: readonly string[], options: Parameters<typeof git>[2] = {}): string {
  return git(cwd, args, options).stdout.toString("utf8");
}

/** Recursive listing of a tree-ish, including tree entries, with blob sizes. */
export function listTree(cwd: string, treeish: string): TreeEntry[] {
  const raw = git(cwd, ["ls-tree", "-r", "-t", "-l", "-z", "--full-tree", treeish]).stdout.toString("utf8");
  const entries: TreeEntry[] = [];
  for (const record of raw.split("\0")) {
    if (record.length === 0) continue;
    const tab = record.indexOf("\t");
    const [mode, type, oid, size] = record.slice(0, tab).split(/\s+/u);
    if (tab < 0 || mode === undefined || type === undefined || oid === undefined || size === undefined) {
      throw new Error(`unexpected ls-tree record ${JSON.stringify(record.slice(0, 80))}`);
    }
    entries.push({
      mode,
      type,
      oid,
      size: size === "-" ? -1 : Number(size),
      path: record.slice(tab + 1),
    });
  }
  return entries;
}

/** Reads many objects in one `git cat-file --batch` round trip. */
export function readObjects(cwd: string, oids: readonly string[]): Map<string, Buffer> {
  const unique = [...new Set(oids)];
  const objects = new Map<string, Buffer>();
  if (unique.length === 0) return objects;
  const output = git(cwd, ["cat-file", "--batch"], { input: `${unique.join("\n")}\n` }).stdout;
  let offset = 0;
  for (const oid of unique) {
    const newline = output.indexOf(0x0a, offset);
    if (newline < 0) throw new Error(`truncated cat-file output at ${oid}`);
    const header = output.subarray(offset, newline).toString("utf8");
    const [gotOid, , sizeText] = header.split(" ");
    if (gotOid !== oid || sizeText === undefined) throw new Error(`unexpected cat-file header for ${oid}`);
    const size = Number(sizeText);
    const start = newline + 1;
    objects.set(oid, output.subarray(start, start + size));
    offset = start + size + 1;
  }
  return objects;
}

// ---------------------------------------------------------------------------
// Path layer

const SENSITIVE_BASENAME =
  /^(?:\.env(?:\..*)?|\.envrc|\.npmrc|\.netrc|\.pypirc|credentials(?:\..*)?|id_rsa|id_ed25519|id_ecdsa|id_dsa|.+\.(?:pem|key|p12|pfx|jks|keystore)|\.DS_Store)$/iu;
const DENIED_SEGMENTS = new Set(["node_modules", "test-results", ".git"]);

export function pathRuleFindings(entries: readonly TreeEntry[], isAllowedPath: (path: string) => boolean): Finding[] {
  const findings: Finding[] = [];
  for (const entry of entries) {
    const path = entry.path;
    const finding = (rule: string, detail?: string) =>
      findings.push({ layer: "path", rule: `path/${rule}`, path, ...(detail ? { detail } : {}) });
    if (!isSafeRelativePath(path)) finding("unsafe-path");
    if (entry.mode === "120000") finding("symlink");
    if (entry.mode === "160000" || entry.type === "commit") finding("submodule");
    if (entry.type === "tree") continue;
    if (entry.type !== "blob") {
      finding("unexpected-object", entry.type);
      continue;
    }
    if (entry.mode !== "100644" && entry.mode !== "100755" && entry.mode !== "120000") finding("unexpected-mode", entry.mode);
    if (entry.size > MAX_BLOB_BYTES) finding("oversize", `${entry.size} bytes`);
    const segments = path.split("/");
    const basename = segments[segments.length - 1] ?? "";
    if (SENSITIVE_BASENAME.test(basename)) finding("sensitive-name");
    if (segments.slice(0, -1).some((segment) => DENIED_SEGMENTS.has(segment))) finding("denied-directory");
    if (basename === ".gitleaks.toml" || basename === ".gitleaksrc") finding("gitleaks-config");
    if (basename === GITLEAKS_IGNORE_FILE && path !== GITLEAKS_IGNORE_FILE) finding("nested-gitleaksignore");
    if (!isAllowedPath(path)) finding("not-allowlisted");
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Content layers

const PLACEHOLDER_HOMES = new Set(["nobody", "test", "example", "person", "you"]);
const PERMITTED_EMAIL = new Set(["contact@cambridgetcg.com"]);
const RESERVED_EMAIL_DOMAINS = new Set(["example.com", "example.net", "example.org"]);
const RESERVED_EMAIL_TLDS = new Set(["example", "invalid", "test", "localhost"]);

export function isPermittedEmail(address: string): boolean {
  const lower = address.toLowerCase();
  if (PERMITTED_EMAIL.has(lower)) return true;
  const domain = lower.slice(lower.lastIndexOf("@") + 1);
  for (const reserved of RESERVED_EMAIL_DOMAINS) {
    if (domain === reserved || domain.endsWith(`.${reserved}`)) return true;
  }
  return RESERVED_EMAIL_TLDS.has(domain.slice(domain.lastIndexOf(".") + 1));
}

/**
 * Credential signatures: the release tool's SECRET_SIGNATURES
 * (bin/npm-release.ts) merged with the public doors guard's rules. Where the
 * two differed, the broader pattern is kept. The doors guard's
 * "private key with body" rule is covered by the header rule below.
 */
export const SECRET_RULES: readonly ContentRule[] = [
  { id: "secret/private-key-block", layer: "secret", pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/gu },
  { id: "secret/aws-access-key", layer: "secret", pattern: /\bAKIA[0-9A-Z]{16}\b/gu },
  { id: "secret/github-token", layer: "secret", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/gu },
  { id: "secret/github-fine-grained-token", layer: "secret", pattern: /\bgithub_pat_[A-Za-z0-9_]{60,}/gu },
  { id: "secret/npm-token", layer: "secret", pattern: /\bnpm_[A-Za-z0-9]{36,}\b/gu },
  { id: "secret/slack-token", layer: "secret", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/gu },
  { id: "secret/stripe-live-key", layer: "secret", pattern: /\b[sr]k_live_[A-Za-z0-9]{16,}/gu },
];

export const PERSONAL_RULES: readonly ContentRule[] = [
  {
    id: "personal/home-path",
    layer: "personal",
    pattern: /\/Users\/([^/\s"'`<>()\\]+)\//gu,
    permit: (match) => PLACEHOLDER_HOMES.has(match[1] ?? ""),
  },
  {
    id: "personal/windows-home-path",
    layer: "personal",
    pattern: /\b[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)([^\\/\s"'`<>()]+)(?:\\|\/)/gu,
    permit: (match) => PLACEHOLDER_HOMES.has(match[1] ?? ""),
  },
  {
    id: "personal/device-path",
    layer: "personal",
    pattern: /~\/\.config\/sol\b|~\/Desktop\b|~\/love-unlimited\/|love-unlimited\/(?:HALT|tools\/)/gu,
  },
  {
    id: "personal/email",
    layer: "personal",
    pattern:
      /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/gu,
    permit: (match) => isPermittedEmail(match[0]),
  },
  {
    id: "personal/keychain-slot",
    layer: "personal",
    pattern: /\bagenttool-[a-z0-9]+(?:-[a-z0-9]+)*-bearer\b/gu,
  },
];

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) starts.push(index + 1);
  return starts;
}

function lineIndexOf(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((starts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** The SHA-256 of one line's UTF-8 text, without its line ending. */
export function lineSha256(line: string): string {
  return sha256Hex(line.replace(/\r$/u, ""));
}

export function scanText(path: string, text: string, rules: readonly ContentRule[]): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  let starts: number[] | undefined;
  for (const rule of rules) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
        continue;
      }
      if (rule.permit?.(match)) continue;
      starts ??= lineStarts(text);
      const index = lineIndexOf(starts, match.index);
      const start = starts[index] ?? 0;
      const next = starts[index + 1];
      const line = text.slice(start, next === undefined ? text.length : next - 1);
      const key = `${rule.id}\0${index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ layer: rule.layer, rule: rule.id, path, line: index + 1, lineSha256: lineSha256(line) });
    }
  }
  return findings;
}

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function contentFindings(
  blobs: ReadonlyArray<{ path: string; bytes: Uint8Array }>,
  rules: readonly ContentRule[],
): Finding[] {
  const findings: Finding[] = [];
  for (const { path, bytes } of blobs) {
    if (isBinary(bytes)) continue;
    findings.push(...scanText(path, decodeText(bytes), rules));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Allow entries

const ALLOWABLE_RULE = /^(?:secret|personal|relational)\/[A-Za-z0-9._-]+$/u;

export function parseAllowEntries(value: unknown, source: string, rulePrefix?: string): AllowEntry[] {
  const fail = (message: string): never => {
    throw new Error(`${source}: ${message}`);
  };
  if (!Array.isArray(value)) fail("allow entries must be an array");
  const entries: AllowEntry[] = [];
  const keys = new Set<string>();
  for (const [index, raw] of (value as unknown[]).entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail(`entry ${index} must be an object`);
    const entry = raw as Record<string, unknown>;
    const fields = Object.keys(entry).sort();
    if (fields.join(",") !== "approver,line_sha256,path,reason,rule") {
      fail(`entry ${index} must have exactly path, rule, line_sha256, reason, approver`);
    }
    for (const field of ["path", "rule", "line_sha256", "reason", "approver"] as const) {
      if (typeof entry[field] !== "string" || (entry[field] as string).trim().length === 0) {
        fail(`entry ${index} field ${field} must be a non-empty string`);
      }
    }
    const typed = entry as unknown as AllowEntry;
    if (!isSafeRelativePath(typed.path)) fail(`entry ${index} path is not a safe relative path`);
    if (!ALLOWABLE_RULE.test(typed.rule)) fail(`entry ${index} rule ${typed.rule} cannot be allowed`);
    if (rulePrefix !== undefined && !typed.rule.startsWith(rulePrefix)) fail(`entry ${index} rule must start with ${rulePrefix}`);
    if (!HEX64.test(typed.line_sha256)) fail(`entry ${index} line_sha256 must be 64 lowercase hex characters`);
    const key = allowKey(typed.path, typed.rule, typed.line_sha256);
    if (keys.has(key)) fail(`entry ${index} duplicates an earlier entry`);
    keys.add(key);
    entries.push(typed);
  }
  return entries;
}

export function parseGuardAllowFile(bytes: Uint8Array, source = GUARD_ALLOW_FILE): AllowEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeText(bytes));
  } catch (error) {
    throw new Error(`${source}: invalid JSON (${(error as Error).message})`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`${source}: must be an object`);
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "entries,schema") throw new Error(`${source}: must have exactly schema and entries`);
  if (record.schema !== GUARD_ALLOW_SCHEMA) throw new Error(`${source}: schema must be ${GUARD_ALLOW_SCHEMA}`);
  const entries = parseAllowEntries(record.entries, source);
  for (const entry of entries) {
    if (entry.rule.startsWith("relational/")) throw new Error(`${source}: relational entries belong in the private denylist`);
  }
  return entries;
}

function allowKey(path: string, rule: string, line: string): string {
  return `${path}\0${rule}\0${line}`;
}

/**
 * Removes findings covered by an allow entry. Entries that cover nothing are
 * reported as integrity findings so stale exceptions fail closed.
 */
export function applyAllowEntries(findings: readonly Finding[], entries: readonly AllowEntry[], source: string): Finding[] {
  const byKey = new Map(entries.map((entry) => [allowKey(entry.path, entry.rule, entry.line_sha256), entry]));
  const used = new Set<string>();
  const remaining: Finding[] = [];
  for (const finding of findings) {
    const key = finding.lineSha256 === undefined ? undefined : allowKey(finding.path, finding.rule, finding.lineSha256);
    if (key !== undefined && byKey.has(key) && (finding.layer === "secret" || finding.layer === "personal" || finding.layer === "relational")) {
      used.add(key);
      continue;
    }
    remaining.push(finding);
  }
  for (const [key, entry] of byKey) {
    if (!used.has(key)) {
      remaining.push({ layer: "integrity", rule: "integrity/unused-allow-entry", path: entry.path, detail: `${source}: ${entry.rule} ${entry.line_sha256.slice(0, 12)}` });
    }
  }
  return remaining;
}

// ---------------------------------------------------------------------------
// PROJECTION.json

export function canonicalProjectionBytes(projection: Projection): string {
  return `${JSON.stringify(projection, null, 2)}\n`;
}

/**
 * Parses PROJECTION.json strictly. `anyGuardVersion` accepts any well-formed
 * guard record instead of only the current versions, for reading projections
 * made by earlier guard or gitleaks versions in the history.
 */
export function parseProjection(bytes: Uint8Array, options: { anyGuardVersion?: boolean } = {}): Projection {
  const text = decodeText(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${PROJECTION_FILE}: invalid JSON (${(error as Error).message})`);
  }
  const fail = (message: string): never => {
    throw new Error(`${PROJECTION_FILE}: ${message}`);
  };
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) fail("must be an object");
  const record = parsed as Record<string, unknown>;
  const expectedKeys = ["schema", "source_commit", "allowlist_sha256", "paths", "excluded", "overlay", "guard"];
  if (Object.keys(record).join(",") !== expectedKeys.join(",")) fail(`must have exactly ${expectedKeys.join(", ")}, in that order`);
  if (record.schema !== PROJECTION_SCHEMA) fail(`schema must be ${PROJECTION_SCHEMA}`);
  if (!isOid(record.source_commit)) fail("source_commit must be a full object id");
  if (typeof record.allowlist_sha256 !== "string" || !HEX64.test(record.allowlist_sha256)) fail("allowlist_sha256 must be 64 hex characters");
  const guard = record.guard as Record<string, unknown> | null;
  if (typeof guard !== "object" || guard === null || Object.keys(guard).join(",") !== "gitleaks,public_guard") {
    fail("guard must have exactly gitleaks and public_guard, in that order");
  }
  if (options.anyGuardVersion) {
    const versioned = typeof guard!.gitleaks === "string" && /^\d+\.\d+\.\d+$/u.test(guard!.gitleaks);
    if (!versioned || typeof guard!.public_guard !== "string" || !/^agenttool\.public-guard\/\d+$/u.test(guard!.public_guard)) {
      fail("guard must record a gitleaks version and an agenttool.public-guard version");
    }
  } else if (guard!.gitleaks !== GITLEAKS_VERSION || guard!.public_guard !== GUARD_VERSION) {
    fail(`guard must record gitleaks ${GITLEAKS_VERSION} and ${GUARD_VERSION}`);
  }
  const paths = record.paths;
  if (!Array.isArray(paths) || paths.length === 0) fail("paths must be a non-empty array");
  for (const [index, raw] of (paths as unknown[]).entries()) {
    const entry = raw as Record<string, unknown>;
    if (typeof entry !== "object" || entry === null) fail(`paths[${index}] must be an object`);
    const keys = Object.keys(entry).join(",");
    if (keys !== "path,tree" && keys !== "path,blob") fail(`paths[${index}] must have path, then exactly one of tree or blob`);
    if (typeof entry.path !== "string" || !isSafeRelativePath(entry.path)) fail(`paths[${index}].path is unsafe`);
    if (!isOid(entry.tree ?? entry.blob)) fail(`paths[${index}] object id is invalid`);
  }
  const overlay = record.overlay;
  if (!Array.isArray(overlay)) fail("overlay must be an array");
  for (const [index, raw] of (overlay as unknown[]).entries()) {
    const entry = raw as Record<string, unknown>;
    if (typeof entry !== "object" || entry === null || Object.keys(entry).join(",") !== "path,blob") fail(`overlay[${index}] must have exactly path, then blob`);
    if (typeof entry.path !== "string" || !isSafeRelativePath(entry.path)) fail(`overlay[${index}].path is unsafe`);
    if (!isOid(entry.blob)) fail(`overlay[${index}].blob is invalid`);
  }
  const excluded = record.excluded;
  if (!Array.isArray(excluded) || !excluded.every((path) => typeof path === "string" && isSafeRelativePath(path))) fail("excluded must be an array of safe paths");
  const projection = parsed as Projection;
  const sortedUnique = (values: readonly string[]) =>
    values.every((value, index) => index === 0 || compareStrings(values[index - 1] as string, value) < 0);
  if (!sortedUnique(projection.paths.map((entry) => entry.path))) fail("paths must be sorted and unique");
  if (!sortedUnique(projection.overlay.map((entry) => entry.path))) fail("overlay must be sorted and unique");
  if (!sortedUnique(projection.excluded)) fail("excluded must be sorted and unique");
  const roots = [...projection.paths.map((entry) => entry.path), ...projection.overlay.map((entry) => entry.path), PROJECTION_FILE];
  for (const a of roots) {
    for (const b of roots) {
      if (a !== b && isWithin(b, a)) fail(`${b} overlaps ${a}`);
    }
  }
  if (canonicalProjectionBytes(projection) !== text) fail("bytes are not canonical (2-space JSON with a final newline)");
  return projection;
}

export function projectionMembership(projection: Projection): (path: string) => boolean {
  const trees = projection.paths.filter((entry) => entry.tree !== undefined).map((entry) => entry.path);
  const exact = new Set([
    PROJECTION_FILE,
    ...projection.paths.filter((entry) => entry.blob !== undefined).map((entry) => entry.path),
    ...projection.overlay.map((entry) => entry.path),
  ]);
  return (path) => exact.has(path) || trees.some((tree) => path.startsWith(`${tree}/`));
}

/** Every PROJECTION.json path and overlay entry must name the committed object. */
export function projectionIntegrityFindings(projection: Projection, entries: readonly TreeEntry[]): Finding[] {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const findings: Finding[] = [];
  const check = (path: string, type: "tree" | "blob", oid: string) => {
    const entry = byPath.get(path);
    if (entry === undefined) findings.push({ layer: "integrity", rule: "integrity/missing-path", path });
    else if (entry.type !== type) findings.push({ layer: "integrity", rule: "integrity/wrong-type", path, detail: `${entry.type} != ${type}` });
    else if (entry.oid !== oid) findings.push({ layer: "integrity", rule: "integrity/object-mismatch", path, detail: `${entry.oid} != ${oid}` });
  };
  for (const entry of projection.paths) check(entry.path, entry.tree ? "tree" : "blob", (entry.tree ?? entry.blob) as string);
  for (const entry of projection.overlay) check(entry.path, "blob", entry.blob);
  for (const required of [GUARD_FILE, GUARD_ALLOW_FILE, GITLEAKS_IGNORE_FILE]) {
    if (!projection.overlay.some((entry) => entry.path === required)) {
      findings.push({ layer: "integrity", rule: "integrity/missing-overlay", path: required });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// gitleaks

function sanitizedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith("GITLEAKS")) continue;
    env[key] = value;
  }
  return env;
}

export function gitleaksVersion(binary: string): string {
  const result = spawnSync(binary, ["version"], { env: sanitizedEnv(), encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`cannot run gitleaks at ${binary}`);
  return result.stdout.trim().replace(/^v/u, "");
}

/** Writes blobs into a fresh directory so gitleaks scans exactly the committed bytes. */
export function materialize(blobs: ReadonlyArray<{ path: string; bytes: Uint8Array; mode: string }>, root: string): void {
  for (const blob of blobs) {
    if (!isSafeRelativePath(blob.path)) throw new Error(`refusing to materialize unsafe path ${JSON.stringify(blob.path)}`);
    if (blob.mode === "120000") continue;
    const target = join(root, blob.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, blob.bytes);
  }
}

/**
 * Runs gitleaks over materialized committed bytes. `gitleaks:allow` comments
 * are ignored, no repository config is honoured (the path layer forbids one),
 * and the only ignore file is the root .gitleaksignore. Any exit status other
 * than "clean" or "leaks found" is an operational failure and throws.
 */
export function gitleaksFindings(binary: string, blobs: ReadonlyArray<{ path: string; bytes: Uint8Array; mode: string }>): Finding[] {
  const version = gitleaksVersion(binary);
  if (version !== GITLEAKS_VERSION) throw new Error(`gitleaks ${GITLEAKS_VERSION} is required; found ${version}`);
  const work = mkdtempSync(join(tmpdir(), "agenttool-public-guard-"));
  try {
    const scan = join(work, "tree");
    mkdirSync(scan);
    materialize(blobs, scan);
    const report = join(work, "report.json");
    const ignore = join(scan, GITLEAKS_IGNORE_FILE);
    const args = [
      "dir",
      ".",
      "--no-banner",
      "--no-color",
      "--redact",
      "--ignore-gitleaks-allow",
      "--exit-code",
      "99",
      "--log-level",
      "error",
      "--report-format",
      "json",
      "--report-path",
      report,
      "--gitleaks-ignore-path",
      blobs.some((blob) => blob.path === GITLEAKS_IGNORE_FILE) ? ignore : join(work, "no-ignore"),
    ];
    const result = spawnSync(binary, args, { cwd: scan, env: sanitizedEnv(), encoding: "utf8", maxBuffer: 1 << 28 });
    if (result.error) throw result.error;
    if (result.status !== 0 && result.status !== 99) {
      throw new Error(`gitleaks failed with status ${result.status}: ${(result.stderr ?? "").trim()}`);
    }
    const parsed = JSON.parse(readFileSync(report, "utf8")) as Array<{ RuleID: string; File: string; StartLine: number }>;
    if (result.status === 0 && parsed.length > 0) throw new Error("gitleaks reported findings with a clean exit status");
    if (result.status === 99 && parsed.length === 0) throw new Error("gitleaks reported leaks without findings");
    return parsed.map((leak) => ({
      layer: "gitleaks" as const,
      rule: `gitleaks/${leak.RuleID}`,
      path: leak.File.replace(/^\.\//u, ""),
      line: leak.StartLine,
    }));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Commit shape

export interface CommitShape {
  tree: string;
  parents: string[];
  author: string;
  committer: string;
  message: string;
}

/**
 * Parses a raw commit object. Strict mode (the default, for projection
 * commits) refuses any header beyond tree, parent, author, and committer, so
 * a signature, encoding, or extra header fails the shape check. Non-strict
 * mode skips them, for reading private source commits that may be signed.
 */
export function parseCommit(raw: string, options: { strict?: boolean } = {}): CommitShape {
  const strict = options.strict ?? true;
  const split = raw.indexOf("\n\n");
  const headers = (split < 0 ? raw : raw.slice(0, split)).split("\n");
  const message = split < 0 ? "" : raw.slice(split + 2);
  const shape: CommitShape = { tree: "", parents: [], author: "", committer: "", message };
  for (const header of headers) {
    const space = header.indexOf(" ");
    const key = header.slice(0, space);
    const value = header.slice(space + 1);
    if (key === "tree") shape.tree = value;
    else if (key === "parent") shape.parents.push(value);
    else if (key === "author") shape.author = value;
    else if (key === "committer") shape.committer = value;
    else if (strict) throw new Error(`unexpected commit header ${JSON.stringify(key)}`);
  }
  return shape;
}

export function projectionMessage(source: string): string {
  return `Project ${source} (public projection)\n\nProjection-Source: ${source}\n`;
}

export function commitShapeFindings(shape: CommitShape, projection: Projection, expectedParents?: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  const identity = `${PROJECTION_AUTHOR_NAME} <${PROJECTION_AUTHOR_EMAIL}> `;
  const add = (rule: string, detail: string) => findings.push({ layer: "integrity", rule: `integrity/${rule}`, path: "(commit)", detail });
  if (!shape.author.startsWith(identity)) add("author", "author is not the projection identity");
  if (!shape.committer.startsWith(identity)) add("committer", "committer is not the projection identity");
  if (shape.author.slice(identity.length) !== shape.committer.slice(identity.length)) add("dates", "author and committer dates differ");
  if (shape.message !== projectionMessage(projection.source_commit)) add("message", "message is not the projection message for PROJECTION.json source_commit");
  if (expectedParents !== undefined && shape.parents.join(",") !== expectedParents.join(",")) {
    add("parents", `parents ${shape.parents.join(",") || "(none)"} != ${expectedParents.join(",") || "(none)"}`);
  }
  if (shape.parents.length > 1) add("parents", "a projection commit has at most one parent");
  return findings;
}

// ---------------------------------------------------------------------------
// History: every commit in the parent chain is a projection

export interface HistoryCommit {
  commit: string;
  parents: string[];
  /** Present when the commit carries a well-formed PROJECTION.json. */
  projection?: Projection;
}

/**
 * Walks every commit reachable from `rev` (only its ancestors with
 * `skipHead`). Each must be a projection commit: strict headers, at most one
 * parent, the fixed identity and dates, the projection message for its own
 * PROJECTION.json source_commit, and a tree that matches that PROJECTION.json
 * and holds nothing else (integrity and path layers). Content layers are not
 * re-run here. Findings are reported as `<commit>:<path>`.
 */
export function projectionHistory(cwd: string, rev: string, options: { skipHead?: boolean } = {}): { commits: HistoryCommit[]; findings: Finding[] } {
  const head = gitText(cwd, ["rev-parse", "--verify", `${rev}^{commit}`]).trim();
  const findings: Finding[] = [];
  const commits: HistoryCommit[] = [];
  for (const line of gitText(cwd, ["rev-list", "--parents", head]).split("\n")) {
    if (line.length === 0) continue;
    const [commit, ...parents] = line.split(" ") as [string, ...string[]];
    if (options.skipHead && commit === head) continue;
    const record: HistoryCommit = { commit, parents };
    commits.push(record);
    const at = (finding: Finding) => findings.push({ ...finding, path: `${commit}:${finding.path}` });
    let shape: CommitShape;
    try {
      shape = parseCommit(gitText(cwd, ["cat-file", "commit", commit]));
    } catch (error) {
      at({ layer: "integrity", rule: "integrity/commit-header", path: "(commit)", detail: (error as Error).message });
      continue;
    }
    const blob = git(cwd, ["cat-file", "blob", `${commit}:${PROJECTION_FILE}`], { allowFailure: true });
    if (blob.status !== 0) {
      at({ layer: "integrity", rule: "integrity/missing-projection", path: PROJECTION_FILE });
      continue;
    }
    let projection: Projection;
    try {
      projection = parseProjection(blob.stdout, { anyGuardVersion: true });
    } catch (error) {
      at({ layer: "integrity", rule: "integrity/invalid-projection", path: PROJECTION_FILE, detail: (error as Error).message });
      continue;
    }
    record.projection = projection;
    for (const finding of commitShapeFindings(shape, projection, parents)) at(finding);
    const entries = listTree(cwd, commit);
    for (const finding of projectionIntegrityFindings(projection, entries)) at(finding);
    for (const finding of pathRuleFindings(entries, projectionMembership(projection))) at(finding);
  }
  return { commits, findings };
}

// ---------------------------------------------------------------------------
// Whole-tree check used by the public CI

export interface TreeFile {
  path: string;
  mode: string;
  oid: string;
  bytes: Uint8Array;
}

/** Lists a tree and reads every blob in it. Symlink targets are read too but never materialized. */
export function readTree(cwd: string, treeish: string): { entries: TreeEntry[]; files: TreeFile[] } {
  const entries = listTree(cwd, treeish);
  const blobs = entries.filter((entry) => entry.type === "blob");
  const contents = readObjects(cwd, blobs.map((entry) => entry.oid));
  const files = blobs.map((entry) => ({
    path: entry.path,
    mode: entry.mode,
    oid: entry.oid,
    bytes: contents.get(entry.oid) ?? Buffer.alloc(0),
  }));
  return { entries, files };
}

/**
 * The layers that may be published: integrity, path, secret, personal, and
 * (when a binary is given) gitleaks. The private projector runs these plus
 * its own private layers; the public CI runs only these.
 */
export function publicLayerFindings(
  entries: readonly TreeEntry[],
  files: readonly TreeFile[],
  options: { gitleaks?: string } = {},
): { projection?: Projection; findings: Finding[] } {
  const projectionBlob = files.find((file) => file.path === PROJECTION_FILE);
  if (projectionBlob === undefined) {
    return { findings: [{ layer: "integrity", rule: "integrity/missing-projection", path: PROJECTION_FILE }] };
  }
  const projection = parseProjection(projectionBlob.bytes);
  const findings: Finding[] = [];
  findings.push(...projectionIntegrityFindings(projection, entries));
  findings.push(...pathRuleFindings(entries, projectionMembership(projection)));
  const allowBlob = files.find((file) => file.path === GUARD_ALLOW_FILE);
  const allow = allowBlob ? parseGuardAllowFile(allowBlob.bytes) : [];
  const scannable = files.filter((file) => file.mode !== "120000");
  const raw = contentFindings(scannable, [...SECRET_RULES, ...PERSONAL_RULES]);
  findings.push(...applyAllowEntries(raw, allow, GUARD_ALLOW_FILE));
  if (options.gitleaks !== undefined) findings.push(...gitleaksFindings(options.gitleaks, scannable));
  return { projection, findings };
}

export interface TreeCheckOptions {
  cwd: string;
  rev: string;
  gitleaks?: string;
  projectionCommit?: boolean;
  expectedParents?: string[];
  /** Also check every ancestor of `rev` (see projectionHistory). */
  history?: boolean;
}

export function checkCommittedTree(options: TreeCheckOptions): Finding[] {
  const commit = gitText(options.cwd, ["rev-parse", "--verify", `${options.rev}^{commit}`]).trim();
  const { entries, files } = readTree(options.cwd, commit);
  const { projection, findings } = publicLayerFindings(entries, files, { gitleaks: options.gitleaks });
  if ((options.projectionCommit || options.history) && projection !== undefined) {
    const shape = parseCommit(gitText(options.cwd, ["cat-file", "commit", commit]));
    findings.push(...commitShapeFindings(shape, projection, options.expectedParents));
  }
  if (options.history) findings.push(...projectionHistory(options.cwd, commit, { skipHead: true }).findings);
  return sortFindings(findings);
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      compareStrings(a.path, b.path) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      compareStrings(a.rule, b.rule),
  );
}

export function formatFinding(finding: Finding): string {
  const location = finding.line === undefined ? finding.path : `${finding.path}:${finding.line}`;
  const line = finding.lineSha256 === undefined ? "" : ` line_sha256=${finding.lineSha256}`;
  const detail = finding.detail === undefined ? "" : ` (${finding.detail})`;
  return `${location}: ${finding.rule}${line}${detail}`;
}

// ---------------------------------------------------------------------------
// CLI

function usage(): never {
  console.error(
    "usage: bun tools/public-guard.ts [--rev <commit>] [--gitleaks <binary>] [--projection-commit] [--expect-parent <sha>|none] [--history]",
  );
  process.exit(2);
}

function main(argv: readonly string[]): number {
  let rev = "HEAD";
  let gitleaks: string | undefined;
  let projectionCommit = false;
  let expectedParents: string[] | undefined;
  let history = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => argv[++index] ?? usage();
    if (arg === "--rev") rev = value();
    else if (arg === "--gitleaks") gitleaks = value();
    else if (arg === "--projection-commit") projectionCommit = true;
    else if (arg === "--history") history = true;
    else if (arg === "--expect-parent") {
      const parent = value();
      expectedParents = parent === "none" || /^0+$/u.test(parent) ? [] : [parent];
    } else usage();
  }
  if (expectedParents !== undefined && !projectionCommit && !history) usage();
  const findings = checkCommittedTree({ cwd: process.cwd(), rev, gitleaks, projectionCommit, expectedParents, history });
  for (const finding of findings) console.log(formatFinding(finding));
  if (findings.length > 0) {
    console.error(`public guard: ${findings.length} finding(s); nothing here may be published as-is.`);
    return 1;
  }
  console.error(`public guard: clean (${GUARD_VERSION}${gitleaks ? `, gitleaks ${GITLEAKS_VERSION}` : ""}).`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`public guard: ${(error as Error).message}`);
    process.exit(2);
  }
}
