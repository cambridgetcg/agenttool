#!/usr/bin/env bun
/**
 * Public guard for AgentTool's public trees. One copy of this file runs in
 * both: the package projection, whose commits carry a PROJECTION.json, and
 * the shared development tree, which has no projection record.
 *
 *   bun tools/public-guard.ts [--rev <commit>] [--gitleaks <binary>]
 *                             [--projection-commit] [--expect-parent <sha>|none]
 *                             [--history]
 *   bun tools/public-guard.ts --tree [--rev <commit>] [--gitleaks <binary>]
 *   bun tools/public-guard.ts --watch [--rev <commit>]
 *
 * Every mode takes --repo <dir> (default: the working directory). A hook or
 * tool that checks a clone it does not trust runs this file from its own
 * pinned directory with --repo: Bun applies the TypeScript configuration
 * (tsconfig.json or jsconfig.json) of its working directory and that
 * directory's parents to whatever it runs, so a checkout's own file could
 * otherwise change how this guard loads.
 *
 * It reads the committed tree of <rev> (default HEAD) through Git plumbing,
 * never the working tree, and fails closed. Projection mode (the default):
 *
 * - integrity: PROJECTION.json is canonical and every path and overlay entry
 *   it lists matches the tree object or blob that is actually committed;
 * - path layer: every file sits under a PROJECTION.json path, is an overlay
 *   file, or is PROJECTION.json itself; no symlinks, submodules, files over
 *   5 MiB, credential-shaped names, dependency or test-output directories,
 *   nested gitleaks configuration, or binary files (a NUL byte, including
 *   UTF-16 without a byte-order mark) unless their content digest is allowed;
 * - secret layer: credential signatures shared with the npm release tool and
 *   the public doors guard, AgentTool's own token shapes and published
 *   provider token formats, plus gitleaks when a pinned binary is given; the
 *   guard applies .gitleaksignore itself, and each fingerprint must record
 *   the flagged line's SHA-256 and still match;
 * - personal layer: home-directory and device paths, email addresses outside
 *   reserved and project domains, hosted database project references, and
 *   local keychain slot names;
 * - history (--history): every ancestor of <rev> is itself a projection
 *   commit whose tree matches its own PROJECTION.json, so no private commit,
 *   tree, or message can sit anywhere in the public parent chain.
 *
 * Tree mode (--tree) checks a development tree with no PROJECTION.json. It
 * runs the same path, secret, personal, binary, and gitleaks layers over
 * every committed file and adds shape rules: no file under `private/`, no
 * `.github/workflows/private-*` workflow, and no PROJECTION.json, in the tree
 * or added anywhere in its history; the history behind <rev> has exactly one
 * root commit (the one tools/public-root.txt names, once the tree has that
 * file) and is not shallow; and no reachable object is a canary listed in
 * tools/leak-canaries.txt, which the tree must carry.
 *
 * Watch mode (--watch) runs only those history shape rules, over every ref
 * in the repository, for a scheduled job that fetches all branches, pull
 * request heads, and tags, and checks that an annotated tag's tagger address
 * is a public one. Refs listed in tools/public-watch-ack.txt (or the --ack
 * file) at their current commit are skipped. It needs no private value, so it
 * can run in public.
 *
 * Path shape rules compare a path case-insensitively (NFKC, lower case): on a
 * case-insensitive file system `Private/` is `private/`.
 *
 * Every rule here is a shape: a pattern that needs no private value to be
 * written down. Checks that need a literal (a name, a project reference, a
 * private word list) belong to private tooling, never to this file.
 *
 * Content layers read UTF-8 text, BOM-marked UTF-16 text, and the printable
 * strings of binary files. Each line is also read with JSON/JavaScript
 * \u escapes, HTML entities, and percent-encoding decoded, and in NFC and
 * NFKC form; a hit in any reading is reported on the original line.
 *
 * Allowed exceptions live in tools/public-guard-allow.json. Each entry names a
 * path, a rule, the SHA-256 of the whole line (never its text), a reason, and
 * an approver; a binary entry names a path, the SHA-256 of the file's bytes, a
 * reason, and an approver. An unused entry is itself a finding, so the list
 * cannot rot. Findings print path, line, and rule only; matched text is never
 * echoed.
 *
 * The private projector imports this module and adds layers that cannot be
 * published. This copy cannot prevent anything; it detects drift after the
 * fact.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

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

/** Allows one binary file, identified by its path and the SHA-256 of its bytes. */
export interface BinaryAllowEntry {
  path: string;
  sha256: string;
  reason: string;
  approver: string;
}

export interface GuardAllow {
  entries: AllowEntry[];
  binaries: BinaryAllowEntry[];
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

export type BlobKind = "text" | "utf-16le" | "utf-16be" | "binary";

/**
 * UTF-8 text, BOM-marked UTF-16 text, or binary: a NUL byte in the first 8000
 * bytes, or a NUL in BOM-marked "UTF-16" (as UTF-32 would decode).
 */
export function blobKind(bytes: Uint8Array): BlobKind {
  const little = bytes[0] === 0xff && bytes[1] === 0xfe;
  if (little || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    const encoding = little ? "utf-16le" : "utf-16be";
    const head = new TextDecoder(encoding).decode(bytes.subarray(0, Math.min(bytes.length, 16000)));
    return head.includes("\u0000") ? "binary" : encoding;
  }
  return isBinary(bytes) ? "binary" : "text";
}

const MIN_STRING = 6;

/**
 * Printable strings of a binary file, one per line: runs of at least six
 * printable characters in its UTF-8 reading, and ASCII runs in its UTF-16LE
 * and UTF-16BE readings at either byte alignment.
 */
export function printableStrings(bytes: Uint8Array): string {
  const runs = new Set<string>();
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  for (const match of utf8.matchAll(/[\t\x20-\x7e\u00a0-\ufffc\u{10000}-\u{10ffff}]{6,}/gu)) runs.add(match[0]);
  for (const little of [true, false]) {
    for (const start of [0, 1]) {
      let run = "";
      const flush = () => {
        if (run.length >= MIN_STRING) runs.add(run);
        run = "";
      };
      for (let index = start; index + 1 < bytes.length; index += 2) {
        const char = (little ? bytes[index] : bytes[index + 1]) as number;
        const high = little ? bytes[index + 1] : bytes[index];
        if (high === 0 && (char === 0x09 || (char >= 0x20 && char <= 0x7e))) run += String.fromCharCode(char);
        else flush();
      }
      flush();
    }
  }
  return [...runs].join("\n");
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

/** A documented placeholder home name, or a variable or template such as $USER or {name}. */
function isPlaceholderHome(name: string): boolean {
  return PLACEHOLDER_HOMES.has(name) || !/^[A-Za-z0-9]/u.test(name);
}
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
  ...TOKEN_SHAPE_RULES(),
];

/**
 * Whether a token body looks random rather than like a name: it mixes lower-
 * and upper-case letters. 32 random bytes in base64url lack one of the two
 * with probability about 1e-10; snake_case and kebab-case names never mix them.
 */
export function mixedCase(body: string): boolean {
  return /[a-z]/u.test(body) && /[A-Z]/u.test(body);
}

/**
 * A documented fixture: a body spelling out a run like 0123456 or abcdef, or a
 * word such as SECRET or EXAMPLE. The words are matched case-insensitively
 * anywhere in the body, so a random 43-character body contains one by chance
 * with probability about 4e-5 (almost all of it `fake`), more for longer
 * bodies. That miss rate is what readable fixtures cost; gitleaks and the
 * private scan run beside this layer.
 */
export function placeholderBody(body: string): boolean {
  return /0123456|abcdef|secret|example|placeholder|dummy|fake|redacted|x{6}/iu.test(body);
}

/**
 * Credential shapes that need no private value: AgentTool's own bearer,
 * mission, local-context, and runtime-control tokens (a prefix plus 43
 * base64url characters, api/src/auth/keys.ts and the collaboration and
 * local-context routes), and the published formats of provider tokens this
 * project's operators hold. A match whose body does not look random is a
 * name or a placeholder and is permitted.
 */
function TOKEN_SHAPE_RULES(): ContentRule[] {
  const randomBody = (group: number) => (match: RegExpExecArray) => !mixedCase(match[group] ?? "") || placeholderBody(match[group] ?? "");
  return [
    {
      id: "secret/agenttool-token",
      layer: "secret",
      pattern: /(?<![A-Za-z0-9_-])(?:at|atcm|atlc)_([A-Za-z0-9_-]{40,})(?![A-Za-z0-9_-])/gu,
      permit: randomBody(1),
    },
    { id: "secret/huggingface-token", layer: "secret", pattern: /(?<![A-Za-z0-9_])hf_([A-Za-z0-9]{30,})(?![A-Za-z0-9_])/gu, permit: randomBody(1) },
    { id: "secret/anthropic-key", layer: "secret", pattern: /\bsk-ant-(?:api|admin|oat)\d{2}-([A-Za-z0-9_-]{20,})/gu, permit: randomBody(1) },
    { id: "secret/openai-key", layer: "secret", pattern: /\bsk-(?:proj|svcacct|admin)-([A-Za-z0-9_-]{20,})/gu, permit: randomBody(1) },
    { id: "secret/fly-token", layer: "secret", pattern: /(?<![A-Za-z0-9_])(?:FlyV1 )?f[mo]\d_([A-Za-z0-9+/=_-]{40,})/gu, permit: randomBody(1) },
    { id: "secret/cloudflare-key", layer: "secret", pattern: /(?<![A-Za-z0-9_])cfk_([A-Za-z0-9_-]{30,})(?![A-Za-z0-9_-])/gu, permit: randomBody(1) },
    {
      id: "secret/url-password",
      layer: "secret",
      // A database or broker URL whose password is 16+ characters mixing
      // cases and digits; placeholders and local test passwords do not.
      pattern: /\b(?:postgres(?:ql)?|mysql|redis|rediss|amqps?|mongodb(?:\+srv)?):\/\/[^\s:/@'"`]+:([^\s@/'"`]{16,})@/gu,
      permit: (match) => !(mixedCase(match[1] ?? "") && /[0-9]/u.test(match[1] ?? "")),
    },
  ];
}

/**
 * Home-directory paths need no trailing separator: a bare `/Users/<name>`,
 * `/home/<name>`, or `C:\Users\<name>` is enough. Percent-encoded and
 * entity-encoded spellings are caught through decodedVariants.
 */
export const PERSONAL_RULES: readonly ContentRule[] = [
  {
    id: "personal/home-path",
    layer: "personal",
    pattern: /\/Users\/([^/\s"'`<>()\\,;:]+)/gu,
    permit: (match) => isPlaceholderHome(match[1] ?? ""),
  },
  {
    id: "personal/unix-home-path",
    layer: "personal",
    pattern: /(?<![\w.-])\/home\/([^/\s"'`<>()\\,;:]+)/gu,
    permit: (match) => isPlaceholderHome(match[1] ?? ""),
  },
  {
    id: "personal/windows-home-path",
    layer: "personal",
    pattern: /\b[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)([^\\/\s"'`<>(),;:]+)/gu,
    permit: (match) => isPlaceholderHome(match[1] ?? ""),
  },
  {
    id: "personal/device-path",
    layer: "personal",
    pattern: /(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%)[\\/](?:Desktop\b|love-unlimited[\\/])|\.config[\\/]sol\b|love-unlimited\/(?:HALT|tools\/)/gu,
  },
  {
    id: "personal/supabase-project",
    layer: "personal",
    pattern: /\b([a-z0-9]{20})\.supabase\.(?:co|com|in)\b|\bpooler\.supabase\.com\b/giu,
    permit: (match) => match[1] !== undefined && /^(.)\1*$/u.test(match[1]),
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
    pattern: /\bagenttool-[a-z0-9]+(?:-[a-z0-9]+)*-(?:bearer|url|key|token|secret|password)(?![\w-])/gu,
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

const MAY_DECODE = /\\u|&#|&(?:amp|lt|gt|quot|apos|nbsp);|%[0-9A-Fa-f]{2}|[^\x00-\x7f]/u;
const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

function codePointOr(value: number, original: string): string {
  return value > 0 && value <= 0x10ffff && (value < 0xd800 || value > 0xdfff) ? String.fromCodePoint(value) : original;
}

/**
 * Other readings of one line that a rule must also see: JSON and JavaScript
 * \uXXXX / \u{X} escapes (surrogate pairs included), HTML numeric and basic
 * named entities, and percent-encoded UTF-8 decoded, each with NFC and NFKC
 * forms. Returns only readings that differ from the line.
 */
export function decodedVariants(line: string): string[] {
  if (!MAY_DECODE.test(line)) return [];
  const decoded = line
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})/gu, (match, point?: string, unit?: string) =>
      point !== undefined ? codePointOr(Number.parseInt(point, 16), match) : String.fromCharCode(Number.parseInt(unit as string, 16)),
    )
    .replace(/&#(?:([0-9]{1,7})|[xX]([0-9a-fA-F]{1,6}));|&(amp|lt|gt|quot|apos|nbsp);/gu, (match, decimal?: string, hex?: string, name?: string) =>
      name !== undefined
        ? (NAMED_ENTITIES[name] ?? match)
        : codePointOr(decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex as string, 16), match),
    )
    .replace(/(?:%[0-9A-Fa-f]{2})+/gu, (match) =>
      new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(match.slice(1).split("%"), (byte) => Number.parseInt(byte, 16))),
    );
  const variants = new Set<string>();
  for (const base of [line, decoded]) {
    variants.add(base);
    variants.add(base.normalize("NFC"));
    variants.add(base.normalize("NFKC"));
  }
  variants.delete(line);
  return [...variants];
}

/**
 * Applies `rules` to the raw text, then to the decoded and normalised
 * readings of each line (decodedVariants). Every finding names the original
 * line and that line's SHA-256, so allow entries work the same either way.
 */
export function scanText(path: string, text: string, rules: readonly ContentRule[]): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  let starts: number[] | undefined;
  const compiled = rules.map((rule) => ({
    rule,
    pattern: new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`),
  }));
  for (const { rule, pattern } of compiled) {
    pattern.lastIndex = 0;
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
  if (!MAY_DECODE.test(text)) return findings;
  starts ??= lineStarts(text);
  for (let index = 0; index < starts.length; index += 1) {
    const next = starts[index + 1];
    const line = text.slice(starts[index] ?? 0, next === undefined ? text.length : next - 1);
    const variants = decodedVariants(line);
    if (variants.length === 0) continue;
    for (const { rule, pattern } of compiled) {
      const key = `${rule.id}\0${index}`;
      if (seen.has(key)) continue;
      for (const variant of variants) {
        pattern.lastIndex = 0;
        let hit = false;
        for (let match = pattern.exec(variant); match !== null; match = pattern.exec(variant)) {
          if (match[0].length === 0) {
            pattern.lastIndex += 1;
            continue;
          }
          if (rule.permit?.(match)) continue;
          hit = true;
          break;
        }
        if (hit) {
          seen.add(key);
          findings.push({ layer: rule.layer, rule: rule.id, path, line: index + 1, lineSha256: lineSha256(line) });
          break;
        }
      }
    }
  }
  return findings;
}

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** The text a content layer scans: decoded text, or a binary file's printable strings. */
export function scannableText(bytes: Uint8Array): string {
  const kind = blobKind(bytes);
  if (kind === "text") return decodeText(bytes);
  if (kind === "binary") return printableStrings(bytes);
  return new TextDecoder(kind).decode(bytes);
}

export function contentFindings(
  blobs: ReadonlyArray<{ path: string; bytes: Uint8Array }>,
  rules: readonly ContentRule[],
): Finding[] {
  const findings: Finding[] = [];
  for (const { path, bytes } of blobs) findings.push(...scanText(path, scannableText(bytes), rules));
  return findings;
}

/**
 * Every binary file is a path finding unless an entry allows exactly its path
 * and content digest. Unused entries are integrity findings.
 */
export function binaryFindings(
  blobs: ReadonlyArray<{ path: string; bytes: Uint8Array }>,
  allowed: readonly BinaryAllowEntry[],
  source: string,
): Finding[] {
  const byKey = new Map(allowed.map((entry) => [`${entry.path}\0${entry.sha256}`, entry]));
  const used = new Set<string>();
  const findings: Finding[] = [];
  for (const { path, bytes } of blobs) {
    if (blobKind(bytes) !== "binary") continue;
    const digest = sha256Hex(bytes);
    const key = `${path}\0${digest}`;
    if (byKey.has(key)) used.add(key);
    else findings.push({ layer: "path", rule: "path/binary", path, detail: `sha256 ${digest}` });
  }
  for (const [key, entry] of byKey) {
    if (!used.has(key)) {
      findings.push({ layer: "integrity", rule: "integrity/unused-binary-entry", path: entry.path, detail: `${source}: ${entry.sha256.slice(0, 12)}` });
    }
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

export function parseBinaryAllowEntries(value: unknown, source: string): BinaryAllowEntry[] {
  const fail = (message: string): never => {
    throw new Error(`${source}: ${message}`);
  };
  if (!Array.isArray(value)) fail("binaries must be an array");
  const entries: BinaryAllowEntry[] = [];
  const keys = new Set<string>();
  for (const [index, raw] of (value as unknown[]).entries()) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail(`binaries[${index}] must be an object`);
    const entry = raw as Record<string, unknown>;
    if (Object.keys(entry).sort().join(",") !== "approver,path,reason,sha256") fail(`binaries[${index}] must have exactly path, sha256, reason, approver`);
    for (const field of ["path", "sha256", "reason", "approver"] as const) {
      if (typeof entry[field] !== "string" || (entry[field] as string).trim().length === 0) fail(`binaries[${index}] field ${field} must be a non-empty string`);
    }
    const typed = entry as unknown as BinaryAllowEntry;
    if (!isSafeRelativePath(typed.path)) fail(`binaries[${index}] path is not a safe relative path`);
    if (!HEX64.test(typed.sha256)) fail(`binaries[${index}] sha256 must be 64 lowercase hex characters`);
    const key = `${typed.path}\0${typed.sha256}`;
    if (keys.has(key)) fail(`binaries[${index}] duplicates an earlier entry`);
    keys.add(key);
    entries.push(typed);
  }
  return entries;
}

/** Parses tools/public-guard-allow.json: schema, entries, and optionally binaries. */
export function parseGuardAllow(bytes: Uint8Array, source = GUARD_ALLOW_FILE): GuardAllow {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeText(bytes));
  } catch (error) {
    throw new Error(`${source}: invalid JSON (${(error as Error).message})`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`${source}: must be an object`);
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (keys !== "entries,schema" && keys !== "binaries,entries,schema") throw new Error(`${source}: must have exactly schema, entries, and optionally binaries`);
  if (record.schema !== GUARD_ALLOW_SCHEMA) throw new Error(`${source}: schema must be ${GUARD_ALLOW_SCHEMA}`);
  const entries = parseAllowEntries(record.entries, source);
  for (const entry of entries) {
    if (entry.rule.startsWith("relational/")) throw new Error(`${source}: relational entries belong in the private denylist`);
  }
  return { entries, binaries: parseBinaryAllowEntries(record.binaries ?? [], source) };
}

export function parseGuardAllowFile(bytes: Uint8Array, source = GUARD_ALLOW_FILE): AllowEntry[] {
  return parseGuardAllow(bytes, source).entries;
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

export interface GitleaksFingerprint {
  path: string;
  rule: string;
  line: number;
  /** SHA-256 of the flagged line, from the `# line_sha256=` comment directly above. */
  lineSha256: string;
}

/**
 * Parses the root .gitleaksignore. Each `path:rule:line` fingerprint (the
 * form `gitleaks dir` uses) must have a `# line_sha256=<hex>` comment on the
 * line directly above it, holding the SHA-256 of the flagged line. Other
 * comments and blank lines are allowed elsewhere. Plain gitleaks skips the
 * comments, so the file still works on its own.
 */
export function parseGitleaksIgnore(bytes: Uint8Array, source = GITLEAKS_IGNORE_FILE): GitleaksFingerprint[] {
  const fingerprints: GitleaksFingerprint[] = [];
  const seen = new Set<string>();
  let pending: string | undefined;
  const lines = decodeText(bytes).replace(/\n$/u, "").split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\r$/u, "").trim();
    const where = `${source}:${index + 1}`;
    const hash = /^#\s*line_sha256=([0-9a-f]{64})$/u.exec(line);
    if (pending !== undefined && (line === "" || (line.startsWith("#") && hash === null))) {
      throw new Error(`${where}: a line_sha256 comment must directly precede its fingerprint`);
    }
    if (line === "") continue;
    if (hash !== null) {
      if (pending !== undefined) throw new Error(`${where}: a line_sha256 comment must directly precede its fingerprint`);
      pending = hash[1];
      continue;
    }
    if (line.startsWith("#")) continue;
    const match = /^(.+):([A-Za-z0-9._-]+):([1-9][0-9]*)$/u.exec(line);
    if (match === null || !isSafeRelativePath(match[1] as string)) throw new Error(`${where}: expected a path:rule:line fingerprint`);
    if (pending === undefined) throw new Error(`${where}: the fingerprint needs a "# line_sha256=<hex>" comment on the line above`);
    if (seen.has(line)) throw new Error(`${where}: duplicates an earlier fingerprint`);
    seen.add(line);
    fingerprints.push({ path: match[1] as string, rule: match[2] as string, line: Number(match[3]), lineSha256: pending });
    pending = undefined;
  }
  if (pending !== undefined) throw new Error(`${source}: a line_sha256 comment without a fingerprint`);
  return fingerprints;
}

/**
 * Removes gitleaks findings covered by a fingerprint for the same path, rule,
 * and line whose recorded hash equals the flagged line's. Fingerprints that
 * cover nothing are integrity findings, so a moved or edited line fails
 * closed instead of silencing whatever lands at its old position.
 */
export function applyGitleaksIgnore(findings: readonly Finding[], fingerprints: readonly GitleaksFingerprint[]): Finding[] {
  const byKey = new Map(fingerprints.map((entry) => [`${entry.path}:${entry.rule}:${entry.line}`, entry]));
  const used = new Set<string>();
  const remaining: Finding[] = [];
  for (const finding of findings) {
    const key = `${finding.path}:${finding.rule.replace(/^gitleaks\//u, "")}:${finding.line ?? 0}`;
    const entry = byKey.get(key);
    if (finding.layer === "gitleaks" && entry !== undefined && finding.lineSha256 === entry.lineSha256) {
      used.add(key);
      continue;
    }
    remaining.push(finding);
  }
  for (const [key, entry] of byKey) {
    if (!used.has(key)) {
      remaining.push({ layer: "integrity", rule: "integrity/unused-gitleaksignore", path: entry.path, line: entry.line, detail: `${GITLEAKS_IGNORE_FILE}: ${entry.rule}` });
    }
  }
  return remaining;
}

/**
 * Runs gitleaks over materialized committed bytes. `gitleaks:allow` comments
 * are ignored and no repository config is honoured (the path layer forbids
 * one). The root .gitleaksignore is never materialized and gitleaks gets an
 * empty ignore file, so every raw finding comes back; applyGitleaksIgnore
 * applies the fingerprints. Each finding carries the flagged line's SHA-256.
 * Any exit status other than "clean" or "leaks found" is an operational
 * failure and throws.
 */
export function gitleaksFindings(binary: string, blobs: ReadonlyArray<{ path: string; bytes: Uint8Array; mode: string }>): Finding[] {
  const version = gitleaksVersion(binary);
  if (version !== GITLEAKS_VERSION) throw new Error(`gitleaks ${GITLEAKS_VERSION} is required; found ${version}`);
  const work = mkdtempSync(join(tmpdir(), "agenttool-public-guard-"));
  try {
    const scan = join(work, "tree");
    mkdirSync(scan);
    materialize(blobs.filter((blob) => blob.path !== GITLEAKS_IGNORE_FILE), scan);
    const report = join(work, "report.json");
    const ignore = join(work, "empty.gitleaksignore");
    writeFileSync(ignore, "");
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
      ignore,
    ];
    const result = spawnSync(binary, args, { cwd: scan, env: sanitizedEnv(), encoding: "utf8", maxBuffer: 1 << 28 });
    if (result.error) throw result.error;
    if (result.status !== 0 && result.status !== 99) {
      throw new Error(`gitleaks failed with status ${result.status}: ${(result.stderr ?? "").trim()}`);
    }
    const parsed = JSON.parse(readFileSync(report, "utf8")) as Array<{ RuleID: string; File: string; StartLine: number }>;
    if (result.status === 0 && parsed.length > 0) throw new Error("gitleaks reported findings with a clean exit status");
    if (result.status === 99 && parsed.length === 0) throw new Error("gitleaks reported leaks without findings");
    const lines = new Map<string, string[]>();
    const lineOf = (path: string, line: number): string | undefined => {
      if (!lines.has(path)) {
        const blob = blobs.find((entry) => entry.path === path);
        const kind = blob === undefined ? "text" : blobKind(blob.bytes);
        lines.set(path, blob === undefined ? [] : (kind === "utf-16le" || kind === "utf-16be" ? scannableText(blob.bytes) : decodeText(blob.bytes)).split("\n"));
      }
      return lines.get(path)?.[line - 1];
    };
    return parsed.map((leak) => {
      const path = leak.File.replace(/^\.\//u, "");
      const text = lineOf(path, leak.StartLine);
      return {
        layer: "gitleaks" as const,
        rule: `gitleaks/${leak.RuleID}`,
        path,
        line: leak.StartLine,
        ...(text === undefined ? {} : { lineSha256: lineSha256(text) }),
      };
    });
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
  findings.push(...contentLayerFindings(files, options));
  return { projection, findings };
}

/**
 * The binary, secret, personal, and (when a binary is given) gitleaks layers
 * over every committed file, with the tree's own allow file and
 * .gitleaksignore applied.
 */
export function contentLayerFindings(files: readonly TreeFile[], options: { gitleaks?: string } = {}): Finding[] {
  const findings: Finding[] = [];
  const allowBlob = files.find((file) => file.path === GUARD_ALLOW_FILE);
  const allow: GuardAllow = allowBlob ? parseGuardAllow(allowBlob.bytes) : { entries: [], binaries: [] };
  const scannable = files.filter((file) => file.mode !== "120000");
  findings.push(...binaryFindings(scannable, allow.binaries, GUARD_ALLOW_FILE));
  const raw = contentFindings(scannable, [...SECRET_RULES, ...PERSONAL_RULES]);
  findings.push(...applyAllowEntries(raw, allow.entries, GUARD_ALLOW_FILE));
  const ignoreBlob = files.find((file) => file.path === GITLEAKS_IGNORE_FILE);
  const fingerprints = ignoreBlob ? parseGitleaksIgnore(ignoreBlob.bytes) : [];
  if (options.gitleaks !== undefined) findings.push(...applyGitleaksIgnore(gitleaksFindings(options.gitleaks, scannable), fingerprints));
  return findings;
}

/** The namespace that holds private-only files; a shared tree never contains it. */
export const PRIVATE_NAMESPACE = "private";
const PRIVATE_WORKFLOW = /^\.github\/workflows\/private-[^/]+$/u;
/** Where the private projection inputs lived before 2026-10-19; a shared tree never holds it either. */
const RETIRED_PRIVATE_GUARD = "public/private-guard";

/**
 * A path as a case-insensitive file system sees it: NFKC, lower case. On such
 * a file system (macOS by default) `Private/x` and `private/x` are one file,
 * so a shape rule that compares only the exact spelling can be walked around.
 */
export function foldPath(path: string): string {
  return path.normalize("NFKC").toLowerCase();
}

/** Whether a path may sit in the shared development tree at all, compared case-insensitively. */
export function sharedTreeRefusal(path: string): string | undefined {
  const folded = foldPath(path);
  if (isWithin(folded, PRIVATE_NAMESPACE)) return "path/private-namespace";
  if (PRIVATE_WORKFLOW.test(folded)) return "path/private-workflow";
  if (folded === PROJECTION_FILE.toLowerCase()) return "path/projection-record";
  if (isWithin(folded, RETIRED_PRIVATE_GUARD)) return "path/retired-private-guard";
  return undefined;
}

/**
 * Commit and tag addresses that may appear in the shared tree's history: the
 * project contact, GitHub's noreply address, and an account's users.noreply
 * address. A shape, so it names no private value.
 */
export function isPublicAddress(address: string): boolean {
  const lower = address.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at <= 0 || lower.indexOf("@") !== at) return false;
  const local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  if (domain === "users.noreply.github.com") return local.length > 0;
  if (domain === "github.com") return local === "noreply";
  return lower === PROJECTION_AUTHOR_EMAIL;
}

/**
 * Tree mode: every layer that needs no PROJECTION.json. The path layer runs
 * over every entry, and a file in the private namespace, a private-only
 * workflow, or a projection record is a finding.
 */
export function sharedTreeFindings(entries: readonly TreeEntry[], files: readonly TreeFile[], options: { gitleaks?: string } = {}): Finding[] {
  const findings = pathRuleFindings(entries, () => true);
  for (const entry of entries) {
    if (entry.type !== "blob") continue;
    const rule = sharedTreeRefusal(entry.path);
    if (rule !== undefined) findings.push({ layer: "path", rule, path: entry.path });
  }
  findings.push(...contentLayerFindings(files, options));
  return findings;
}

/** The history behind a shared tree's commit is complete and has exactly one root. */
export function singleRootFindings(cwd: string, commit: string): Finding[] {
  if (gitText(cwd, ["rev-parse", "--is-shallow-repository"]).trim() === "true") {
    return [{ layer: "integrity", rule: "integrity/shallow-history", path: "(history)", detail: "fetch the full history" }];
  }
  const roots = gitText(cwd, ["rev-list", "--max-parents=0", commit]).split("\n").filter(Boolean);
  if (roots.length === 1) return [];
  return [{ layer: "integrity", rule: "integrity/root-count", path: "(history)", detail: `${roots.length} root commits` }];
}

/** Blob ids of private canary files, one per line; the shared tree carries this list, never the canaries. */
export const LEAK_CANARIES_FILE = "tools/leak-canaries.txt";
/** The shared tree's root commit id, added by the first change after the root exists. */
export const PUBLIC_ROOT_FILE = "tools/public-root.txt";

/** Parses tools/leak-canaries.txt: one full object id per line; blank lines and `#` comments are skipped. */
export function parseLeakCanaries(bytes: Uint8Array, source = LEAK_CANARIES_FILE): string[] {
  const ids: string[] = [];
  for (const [index, raw] of decodeText(bytes).split("\n").entries()) {
    const line = raw.replace(/\r$/u, "").trim();
    if (line === "" || line.startsWith("#")) continue;
    if (!isOid(line)) throw new Error(`${source}:${index + 1}: expected one full object id per line`);
    ids.push(line);
  }
  if (ids.length === 0) throw new Error(`${source}: lists no canary`);
  return ids;
}

/** Parses tools/public-root.txt: exactly one full commit id. */
export function parsePublicRoot(bytes: Uint8Array, source = PUBLIC_ROOT_FILE): string {
  const lines = decodeText(bytes).split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
  if (lines.length !== 1 || !isOid(lines[0])) throw new Error(`${source}: expected exactly one full commit id`);
  return lines[0] as string;
}

/**
 * History shape behind one or more shared-tree commits, with no private value
 * needed: no reachable object is a listed canary, no commit anywhere in the
 * history adds a path the shared tree may not hold (private namespace,
 * private-only workflow, projection record), and when `files` carries
 * tools/public-root.txt every root commit is the one it names. A shared tree
 * without tools/leak-canaries.txt is itself a finding.
 */
export function sharedHistoryFindings(cwd: string, commits: readonly string[], files: readonly TreeFile[]): Finding[] {
  const findings: Finding[] = [];
  const canaryFile = files.find((file) => file.path === LEAK_CANARIES_FILE);
  if (canaryFile === undefined) {
    findings.push({ layer: "integrity", rule: "integrity/missing-canaries", path: LEAK_CANARIES_FILE });
  } else {
    const canaries = new Set(parseLeakCanaries(canaryFile.bytes));
    const objects = gitText(cwd, ["rev-list", "--objects", ...commits, "--"]).split("\n");
    for (const line of objects) {
      const oid = line.slice(0, line.indexOf(" ") < 0 ? line.length : line.indexOf(" "));
      if (canaries.has(oid)) findings.push({ layer: "integrity", rule: "integrity/leak-canary", path: "(history)", detail: `object ${oid.slice(0, 12)}` });
    }
  }
  const touched = new Set(
    git(cwd, ["-c", "core.quotePath=false", "log", "-z", "--format=", "--name-only", "--no-renames", "--diff-merges=separate", ...commits, "--"])
      .stdout.toString("utf8")
      .split("\0")
      .map((path) => path.replace(/^\n+/u, ""))
      .filter(Boolean),
  );
  for (const path of [...touched].sort()) {
    const rule = sharedTreeRefusal(path);
    if (rule !== undefined) findings.push({ layer: "path", rule: rule.replace(/^path\//u, "path/history-"), path });
  }
  const rootFile = files.find((file) => file.path === PUBLIC_ROOT_FILE);
  if (rootFile !== undefined) {
    const expected = parsePublicRoot(rootFile.bytes);
    for (const root of gitText(cwd, ["rev-list", "--max-parents=0", ...commits, "--"]).split("\n").filter(Boolean)) {
      if (root !== expected) findings.push({ layer: "integrity", rule: "integrity/public-root", path: "(history)", detail: `root ${root.slice(0, 12)} is not ${PUBLIC_ROOT_FILE}` });
    }
  }
  return findings;
}

/** Refs a maintainer has handled (a closed pull request head the owner cannot delete): the watch skips them while they stay at the listed commit. */
export const WATCH_ACK_FILE = "tools/public-watch-ack.txt";

/** A ref's watch key: heads/<branch>, pull/<number>, or tags/<name>, whatever namespace a fetch put it in. */
export function watchRefKey(ref: string): string {
  for (const [prefix, replacement] of [
    ["refs/remotes/origin/", "heads/"],
    ["refs/remotes/pull/", "pull/"],
    ["refs/public-scan/", ""],
    ["refs/public-scanned/", ""],
    ["refs/heads/", "heads/"],
    ["refs/tags/", "tags/"],
  ] as const) {
    if (ref.startsWith(prefix)) return `${replacement}${ref.slice(prefix.length)}`.replace(/^pull\/(\d+)\/head$/u, "pull/$1");
  }
  return ref;
}

/**
 * Parses an acknowledgement list: `<key> <full commit id>` per line, where
 * the key is heads/<branch>, pull/<number>, or tags/<name>; blank lines and
 * `#` comments are skipped. An acknowledgement covers that commit only: a ref
 * that moves is checked again.
 */
export function parseWatchAck(bytes: Uint8Array, source = WATCH_ACK_FILE): Map<string, string> {
  const ack = new Map<string, string>();
  for (const [index, raw] of decodeText(bytes).split("\n").entries()) {
    const line = raw.replace(/#.*$/u, "").trim();
    if (line === "") continue;
    const [key, oid, ...rest] = line.split(/\s+/u);
    if (rest.length > 0 || key === undefined || !/^(?:heads|pull|tags)\/[A-Za-z0-9._\/-]+$/u.test(key) || !isOid(oid)) {
      throw new Error(`${source}:${index + 1}: expected <heads/…|pull/…|tags/…> <full commit id>`);
    }
    if (ack.has(key)) throw new Error(`${source}:${index + 1}: ${key} is listed twice`);
    ack.set(key, oid as string);
  }
  return ack;
}

/**
 * Watch mode: the public-safe shape checks over every ref in the repository
 * (a scheduled job fetches all branches, pull-request heads, and tags first).
 * Each ref must peel to a commit; together they must have exactly one root,
 * which tools/public-root.txt in `rev` names when present; the history shape
 * of sharedHistoryFindings holds for all of them; and an annotated tag's
 * tagger address is a public one. A ref the acknowledgement list names at its
 * current commit is skipped; the list is tools/public-watch-ack.txt in `rev`
 * unless the caller passes its own (the private daily scan passes its own, so
 * the public list never silences it). No content layer runs, so this needs no
 * private value and no gitleaks.
 */
export function watchFindings(cwd: string, rev = "HEAD", options: { ack?: Map<string, string> } = {}): Finding[] {
  if (gitText(cwd, ["rev-parse", "--is-shallow-repository"]).trim() === "true") {
    return [{ layer: "integrity", rule: "integrity/shallow-history", path: "(history)", detail: "fetch the full history" }];
  }
  const findings: Finding[] = [];
  const head = gitText(cwd, ["rev-parse", "--verify", `${rev}^{commit}`]).trim();
  const config = listTree(cwd, head).filter(
    (entry) => entry.type === "blob" && (entry.path === LEAK_CANARIES_FILE || entry.path === PUBLIC_ROOT_FILE || entry.path === WATCH_ACK_FILE),
  );
  const contents = readObjects(cwd, config.map((entry) => entry.oid));
  const files = config.map((entry) => ({ path: entry.path, mode: entry.mode, oid: entry.oid, bytes: contents.get(entry.oid) ?? Buffer.alloc(0) }));
  const ackFile = files.find((file) => file.path === WATCH_ACK_FILE);
  const ack = options.ack ?? (ackFile === undefined ? new Map<string, string>() : parseWatchAck(ackFile.bytes));
  const commits = new Set<string>();
  const refs = gitText(cwd, ["for-each-ref", "--format=%(refname)%00%(objecttype)%00%(taggeremail)"]).split("\n").filter(Boolean);
  for (const record of refs) {
    const [line, type, tagger] = record.split("\0") as [string, string, string];
    const peeled = git(cwd, ["rev-parse", "--verify", "--quiet", `${line}^{commit}`], { allowFailure: true });
    if (peeled.status !== 0) {
      findings.push({ layer: "integrity", rule: "integrity/ref-not-commit", path: line });
      continue;
    }
    const commit = peeled.stdout.toString("utf8").trim();
    if (ack.get(watchRefKey(line)) === commit) continue;
    commits.add(commit);
    if (type === "tag" && !isPublicAddress(tagger.replace(/^<|>$/gu, ""))) {
      findings.push({ layer: "personal", rule: "personal/tagger-address", path: line });
    }
    const roots = gitText(cwd, ["rev-list", "--max-parents=0", commit, "--"]).split("\n").filter(Boolean);
    if (roots.length !== 1) findings.push({ layer: "integrity", rule: "integrity/root-count", path: line, detail: `${roots.length} root commits` });
  }
  commits.add(head);
  const roots = new Set(gitText(cwd, ["rev-list", "--max-parents=0", ...commits, "--"]).split("\n").filter(Boolean));
  if (roots.size !== 1) findings.push({ layer: "integrity", rule: "integrity/root-count", path: "(all refs)", detail: `${roots.size} root commits` });
  findings.push(...sharedHistoryFindings(cwd, [...commits].sort(), files));
  return sortFindings(findings);
}

export interface TreeCheckOptions {
  cwd: string;
  rev: string;
  gitleaks?: string;
  projectionCommit?: boolean;
  expectedParents?: string[];
  /** Also check every ancestor of `rev` (see projectionHistory). */
  history?: boolean;
  /** Check a shared development tree, which has no PROJECTION.json. */
  tree?: boolean;
}

export function checkCommittedTree(options: TreeCheckOptions): Finding[] {
  const commit = gitText(options.cwd, ["rev-parse", "--verify", `${options.rev}^{commit}`]).trim();
  const { entries, files } = readTree(options.cwd, commit);
  if (options.tree) {
    if (options.projectionCommit || options.history || options.expectedParents !== undefined) {
      throw new Error("--tree checks a shared tree; it takes no projection options");
    }
    const root = singleRootFindings(options.cwd, commit);
    const history = root.some((finding) => finding.rule === "integrity/shallow-history") ? [] : sharedHistoryFindings(options.cwd, [commit], files);
    return sortFindings([...sharedTreeFindings(entries, files, { gitleaks: options.gitleaks }), ...root, ...history]);
  }
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
    "usage: bun tools/public-guard.ts [--repo <dir>] [--rev <commit>] [--gitleaks <binary>] [--projection-commit] [--expect-parent <sha>|none] [--history]\n" +
      "       bun tools/public-guard.ts --tree [--repo <dir>] [--rev <commit>] [--gitleaks <binary>]\n" +
      "       bun tools/public-guard.ts --watch [--repo <dir>] [--rev <commit>] [--ack <file>]",
  );
  process.exit(2);
}

function main(argv: readonly string[]): number {
  let rev = "HEAD";
  let gitleaks: string | undefined;
  let projectionCommit = false;
  let expectedParents: string[] | undefined;
  let history = false;
  let tree = false;
  let watch = false;
  let ackFile: string | undefined;
  let repo = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => argv[++index] ?? usage();
    if (arg === "--rev") rev = value();
    else if (arg === "--repo") repo = resolve(value());
    else if (arg === "--gitleaks") gitleaks = value();
    else if (arg === "--projection-commit") projectionCommit = true;
    else if (arg === "--history") history = true;
    else if (arg === "--tree") tree = true;
    else if (arg === "--watch") watch = true;
    else if (arg === "--ack") ackFile = value();
    else if (arg === "--expect-parent") {
      const parent = value();
      expectedParents = parent === "none" || /^0+$/u.test(parent) ? [] : [parent];
    } else usage();
  }
  if (expectedParents !== undefined && !projectionCommit && !history) usage();
  if (tree && (projectionCommit || history || expectedParents !== undefined)) usage();
  if (watch && (tree || projectionCommit || history || expectedParents !== undefined || gitleaks !== undefined)) usage();
  if (ackFile !== undefined && !watch) usage();
  const findings = watch
    ? watchFindings(repo, rev, { ack: ackFile === undefined ? undefined : parseWatchAck(readFileSync(ackFile), ackFile) })
    : checkCommittedTree({ cwd: repo, rev, gitleaks, projectionCommit, expectedParents, history, tree });
  for (const finding of findings) console.log(formatFinding(finding));
  if (findings.length > 0) {
    console.error(`public guard: ${findings.length} finding(s); nothing here may be published as-is.`);
    return 1;
  }
  console.error(`public guard: clean (${GUARD_VERSION}${tree ? ", tree mode" : ""}${watch ? ", watch mode" : ""}${gitleaks ? `, gitleaks ${GITLEAKS_VERSION}` : ""}).`);
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
