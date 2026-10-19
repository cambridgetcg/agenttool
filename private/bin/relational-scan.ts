#!/usr/bin/env bun
/**
 * The private relational scanner: every check that needs a literal private
 * value. Read private/README.md first.
 *
 *   bun private/bin/relational-scan.ts [scan] [--repo <dir>] [--guard-dir <dir> | --guard-rev <commit>] [--json]
 *       [--tree <commit>]                          every blob of a tree, its path names, and its allow misses
 *       [--diff] [--messages] [--names] [--objects] [--shapes] [--addresses] [-- <rev-list arguments>]
 *       [--ref-name <name>]... [--tag <ref>]...
 *       [--github <owner/name> [--since <ISO 8601 time>]]
 *       [--text <label>]                           text on standard input
 *   bun private/bin/relational-scan.ts add-literal --kind email|word --id l<NN> --reason <text>
 *                                                  (the value on standard input, never echoed)
 *   bun private/bin/relational-scan.ts add-literal --github-account
 *                                                  (every private address of the signed-in GitHub account)
 *
 * The shared tools/public-guard.ts holds shape rules only (MUST 1 of the
 * 2026-10-19 plan). Rules that need a literal live here and load their terms
 * at run time from the guard directory (default: private/guard next to this
 * file; hooks pass the private checkout's):
 *
 * - relational-denylist.json: the relational terms (regular expressions), the
 *   SHA-256 of whole files that must never be published, and allow entries;
 *   the terms are applied to file text, commit and tag messages, ref names,
 *   pull request and issue text, and path names, both as written and with
 *   `-`, `_`, `.`, and `/` read as spaces, so joined words are caught too;
 * - literal-sha256.json: SHA-256 digests of literal values (owner addresses,
 *   machine-account names, the database project reference) that no rule may
 *   spell out. Text is split into lower-case email tokens and alphanumeric
 *   word tokens, and each token's digest is compared, so the values appear
 *   nowhere, not even here;
 * - ../CANARY: random bytes whose blob id must never leave this repository;
 *   the denylist's own bytes are checked the same way.
 *
 * --diff reads added lines (merges against their first parent; Git
 * attributes cannot hide them), --messages commit messages and identity
 * headers, --names added path names, --objects every new blob's identity and
 * the whole text of every new blob that is not UTF-8 text (binary printable
 * strings, decoded UTF-16). --shapes also applies the public secret and
 * personal shapes, with the tree's tools/public-guard-allow.json (shape
 * entries only). --addresses, for a push of new commits, also refuses
 * non-public addresses in commit and tag messages and a non-public tagger.
 * --guard-rev reads the guard from a commit of the private repository
 * instead of a directory. A copy of the denylist or of the literal digest
 * list is a finding too. Findings print a location, a rule id,
 * and the flagged line's SHA-256; never matched text. A path or ref name that
 * hits is printed only as its SHA-256. Exit 0 clean, 1 findings, 2 error
 * (including a missing guard file: the scanner fails closed).
 */
// First: refuse before the shared guard module runs unless it is the reviewed copy.
import "./reviewed-shared.ts";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseDenylist, type Denylist } from "../../bin/project-public.ts";
import {
  type AllowEntry,
  applyAllowEntries,
  blobKind,
  type ContentRule,
  decodedVariants,
  decodeText,
  type Finding,
  formatFinding,
  git,
  GUARD_ALLOW_FILE,
  isPermittedEmail,
  isPublicAddress,
  lineSha256,
  parseAllowEntries,
  parseCommit,
  parseGuardAllow,
  PERSONAL_RULES,
  readObjects,
  readTree,
  repositoryEnv,
  scannableText,
  scanText,
  SECRET_RULES,
  sha256Hex,
  sharedTreeRefusal,
  sortFindings,
  type TreeFile,
} from "../../tools/public-guard.ts";

export const DENYLIST_FILE = "relational-denylist.json";
export const LITERALS_FILE = "literal-sha256.json";
export const LITERALS_SCHEMA = "agenttool.private-literal-sha256/1";
export const CANARY_FILE = "CANARY";
export const DEFAULT_GUARD_DIR = resolve(import.meta.dir, "..", "guard");
/** The guard directory's path inside a commit of the private repository. */
export const GUARD_PATH = "private/guard";
/** Addresses a commit or tag message may name besides the public ones: the co-author trailer of the coding agent. */
const MESSAGE_ADDRESSES = new Set(["noreply@anthropic.com"]);
/** Below this many remaining core requests the GitHub reader stops instead of spending the budget. */
export const GITHUB_MIN_REMAINING = 500;

export class GuardMissing extends Error {}

export interface LiteralSet {
  email: Map<string, string>;
  word: Map<string, string>;
  allow: AllowEntry[];
}

export interface PrivateGuard {
  dir: string;
  denylist: Denylist;
  /** Git blob ids (SHA-1 and SHA-256 object formats) of the denylist's bytes. */
  denylistBlobIds: Set<string>;
  literals: LiteralSet;
  /** Git blob ids (both formats) and the SHA-256 of literal-sha256.json: its digests are a guess-confirm surface, so a copy is a leak too. */
  literalListIds: Set<string>;
  literalListSha256: string;
  /** Git blob ids of the canary file. */
  canaryIds: Set<string>;
  /** The denylist's and the literal file's allow entries together. */
  allow: AllowEntry[];
}

/** A Git blob id for bytes, in either object format. */
export function gitBlobId(bytes: Uint8Array, format: "sha1" | "sha256" = "sha1"): string {
  return createHash(format).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function readRequired(path: string, what: string): Buffer {
  if (!existsSync(path)) throw new GuardMissing(`${what} is missing (${path}); the private scan cannot run, so it refuses`);
  return readFileSync(path);
}

export function parseLiterals(bytes: Uint8Array, source = LITERALS_FILE): LiteralSet {
  const fail = (message: string): never => {
    throw new Error(`${source}: ${message}`);
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeText(bytes));
  } catch (error) {
    fail(`invalid JSON (${(error as Error).message})`);
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record !== "object" || record === null || Object.keys(record).join(",") !== "schema,note,literals,allow") {
    fail("must have exactly schema, note, literals, allow in that order");
  }
  if (record.schema !== LITERALS_SCHEMA) fail(`schema must be ${LITERALS_SCHEMA}`);
  if (!Array.isArray(record.literals) || record.literals.length === 0) fail("literals must be a non-empty array");
  const set: LiteralSet = { email: new Map(), word: new Map(), allow: [] };
  const ids = new Set<string>();
  for (const [index, raw] of (record.literals as unknown[]).entries()) {
    const entry = raw as Record<string, unknown>;
    if (typeof entry !== "object" || entry === null || Object.keys(entry).join(",") !== "id,kind,sha256,reason") {
      fail(`literals[${index}] must have exactly id, kind, sha256, reason`);
    }
    if (typeof entry.id !== "string" || !/^l\d{2,}$/u.test(entry.id) || ids.has(entry.id)) fail(`literals[${index}].id must be a unique l<number>`);
    if (entry.kind !== "email" && entry.kind !== "word") fail(`literals[${index}].kind must be email or word`);
    if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(entry.sha256)) fail(`literals[${index}].sha256 must be 64 hex characters`);
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") fail(`literals[${index}].reason must say what kind of value it is`);
    ids.add(entry.id as string);
    set[entry.kind as "email" | "word"].set(entry.sha256 as string, entry.id as string);
  }
  try {
    set.allow = parseAllowEntries(record.allow, source, "relational/");
  } catch (error) {
    fail((error as Error).message);
  }
  for (const entry of set.allow) {
    if (!ids.has(entry.rule.slice("relational/".length))) fail(`allow entry for unknown literal ${entry.rule}`);
  }
  return set;
}

/** Builds the private guard from the three files' bytes; `where` names their source in errors. */
export function privateGuardFromBytes(files: { denylist: Buffer; literals: Buffer; canary: Buffer }, where: string): PrivateGuard {
  const denylist = parseDenylist(files.denylist);
  const literals = parseLiterals(files.literals);
  for (const id of [...literals.email.values(), ...literals.word.values()]) {
    if (denylist.rules.some((rule) => rule.id === `relational/${id}`) || denylist.blobs.some((blob) => blob.id === id)) {
      throw new Error(`${LITERALS_FILE}: id ${id} collides with the denylist`);
    }
  }
  if (files.canary.length < 16) throw new Error(`${CANARY_FILE} must hold at least 16 random bytes`);
  return {
    dir: where,
    denylist,
    denylistBlobIds: new Set([gitBlobId(files.denylist), gitBlobId(files.denylist, "sha256")]),
    literals,
    literalListIds: new Set([gitBlobId(files.literals), gitBlobId(files.literals, "sha256")]),
    literalListSha256: sha256Hex(files.literals),
    canaryIds: new Set([gitBlobId(files.canary), gitBlobId(files.canary, "sha256")]),
    allow: [...denylist.allow, ...literals.allow],
  };
}

/** Loads the denylist, the literal digests, and the canary from a directory; any missing file refuses. */
export function loadPrivateGuard(dir = DEFAULT_GUARD_DIR): PrivateGuard {
  const guardDir = resolve(dir);
  return privateGuardFromBytes(
    {
      denylist: readRequired(join(guardDir, DENYLIST_FILE), "the relational denylist"),
      literals: readRequired(join(guardDir, LITERALS_FILE), "the literal digest list"),
      canary: readRequired(join(dirname(guardDir), CANARY_FILE), "the private canary"),
    },
    guardDir,
  );
}

/**
 * Loads the private guard from a commit's objects (private/guard/* and
 * private/CANARY), never from a working tree: a working tree can hold bytes
 * a merge or a case-folding file system put there.
 */
export function loadPrivateGuardFromRev(repo: string, rev: string): PrivateGuard {
  const blob = (path: string, what: string): Buffer => {
    const result = git(repo, ["cat-file", "blob", `${rev}:${path}`], { allowFailure: true });
    if (result.status !== 0) throw new GuardMissing(`${what} is missing from ${rev} (${path}); the private scan cannot run, so it refuses`);
    return result.stdout;
  };
  return privateGuardFromBytes(
    {
      denylist: blob(`${GUARD_PATH}/${DENYLIST_FILE}`, "the relational denylist"),
      literals: blob(`${GUARD_PATH}/${LITERALS_FILE}`, "the literal digest list"),
      canary: blob(`private/${CANARY_FILE}`, "the private canary"),
    },
    `${rev}:${GUARD_PATH}`,
  );
}

// ---------------------------------------------------------------------------
// Text, names, and blob identity

const EMAIL_PATTERN = (PERSONAL_RULES.find((rule) => rule.id === "personal/email") as ContentRule).pattern;
const WORD = /[a-z0-9]+/gu;
const tokenDigests = new Map<string, string>();

function digestOf(token: string): string {
  let digest = tokenDigests.get(token);
  if (digest === undefined) {
    digest = sha256Hex(token);
    if (tokenDigests.size < 2_000_000) tokenDigests.set(token, digest);
  }
  return digest;
}

/** The literal ids whose digest matches a token of `text` (emails and words, lower-cased, NFKC). */
export function literalHits(text: string, literals: LiteralSet): Set<string> {
  const hits = new Set<string>();
  const lower = text.normalize("NFKC").toLowerCase();
  if (literals.email.size > 0 && lower.includes("@")) {
    for (const match of lower.matchAll(new RegExp(EMAIL_PATTERN.source, "gu"))) {
      const id = literals.email.get(digestOf(match[0]));
      if (id !== undefined) hits.add(id);
    }
  }
  if (literals.word.size > 0) {
    for (const match of lower.matchAll(WORD)) {
      const id = literals.word.get(digestOf(match[0]));
      if (id !== undefined) hits.add(id);
    }
  }
  return hits;
}

function literalFindings(path: string, text: string, literals: LiteralSet): Finding[] {
  if (literals.email.size === 0 && literals.word.size === 0) return [];
  const findings: Finding[] = [];
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    const ids = new Set<string>();
    for (const variant of [line, ...decodedVariants(line)]) for (const id of literalHits(variant, literals)) ids.add(id);
    for (const id of [...ids].sort()) {
      findings.push({ layer: "relational", rule: `relational/${id}`, path, line: index + 1, lineSha256: lineSha256(line) });
    }
  }
  return findings;
}

export type ShapeSet = "none" | "secret" | "all";

function shapeRules(shapes: ShapeSet): readonly ContentRule[] {
  return shapes === "all" ? [...SECRET_RULES, ...PERSONAL_RULES] : shapes === "secret" ? SECRET_RULES : [];
}

/** Relational terms and literal digests over one text, optionally with the public shapes. */
export function privateTextFindings(path: string, text: string, guard: PrivateGuard, shapes: ShapeSet = "none"): Finding[] {
  return [...scanText(path, text, [...guard.denylist.rules, ...shapeRules(shapes)]), ...literalFindings(path, text, guard.literals)];
}

/** A name's printable stand-in: its SHA-256, so a name that hits is never echoed. */
export function nameLabel(kind: "path" | "ref", name: string): string {
  return `${kind}-sha256:${sha256Hex(name).slice(0, 12)}`;
}

/**
 * Relational terms and literal digests over a path or ref name, as written,
 * with `-`, `_`, `.`, and `/` read as spaces, and with camelCase split.
 */
export function nameFindings(kind: "path" | "ref", name: string, guard: PrivateGuard): Finding[] {
  const joined = name.replace(/[-_./]+/gu, " ");
  const variants = [...new Set([name, joined, joined.replace(/([a-z0-9])([A-Z])/gu, "$1 $2")])];
  const rules = new Set<string>();
  for (const rule of guard.denylist.rules) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", ""));
    if (variants.some((variant) => pattern.test(variant))) rules.add(rule.id);
  }
  for (const variant of variants) for (const id of literalHits(variant, guard.literals)) rules.add(`relational/${id}`);
  const label = nameLabel(kind, name);
  return [...rules].sort().map((rule) => ({ layer: "relational" as const, rule, path: label, detail: `${kind} name` }));
}

/** Canary and denylist copies by blob id, and whole files the denylist withholds by SHA-256. */
export function blobIdentityFindings(blobs: ReadonlyArray<{ path: string; oid: string; bytes: Uint8Array }>, guard: PrivateGuard): Finding[] {
  const findings: Finding[] = [];
  const withheld = new Map(guard.denylist.blobs.map((blob) => [blob.sha256, `relational/${blob.id}`]));
  for (const blob of blobs) {
    const digest = sha256Hex(blob.bytes);
    if (guard.canaryIds.has(blob.oid)) findings.push({ layer: "relational", rule: "relational/canary", path: blob.path });
    if (guard.denylistBlobIds.has(blob.oid) || digest === guard.denylist.sha256) {
      findings.push({ layer: "relational", rule: "relational/denylist-copy", path: blob.path });
    }
    if (guard.literalListIds.has(blob.oid) || digest === guard.literalListSha256) {
      findings.push({ layer: "relational", rule: "relational/literal-list-copy", path: blob.path });
    }
    const rule = withheld.get(digest);
    if (rule !== undefined) findings.push({ layer: "relational", rule, path: blob.path });
  }
  return findings;
}

export interface ScanResult {
  findings: Finding[];
  /** Allow entries that matched nothing in a whole-tree scan: reported apart from new hits. */
  allowMisses: Finding[];
}

function dedupe(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.path}\0${finding.rule}\0${finding.lineSha256 ?? finding.line ?? ""}\0${finding.detail ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitAllowMisses(findings: readonly Finding[]): ScanResult {
  const allowMisses = findings.filter((finding) => finding.rule === "integrity/unused-allow-entry");
  return { findings: sortFindings(findings.filter((finding) => finding.rule !== "integrity/unused-allow-entry")), allowMisses: sortFindings(allowMisses) };
}

/**
 * Every private layer over a set of files: text (binary files by their
 * printable strings), path names, and blob identity. Allow entries apply to
 * the files given; with `wholeTree`, an entry for one of those paths that
 * matches nothing is an allow miss.
 */
export function scanFiles(files: readonly TreeFile[], guard: PrivateGuard, options: { wholeTree?: boolean; shapes?: ShapeSet; publicAllow?: AllowEntry[] } = {}): ScanResult {
  const raw: Finding[] = [];
  const regular = files.filter((file) => file.mode !== "120000");
  for (const file of regular) raw.push(...privateTextFindings(file.path, scannableText(file.bytes), guard, options.shapes ?? "none"));
  for (const file of files) raw.push(...nameFindings("path", file.path, guard));
  raw.push(...blobIdentityFindings(regular, guard));
  const paths = new Set(files.map((file) => file.path));
  const allow = [...guard.allow, ...(options.publicAllow ?? [])].filter((entry) => paths.has(entry.path));
  const applied = applyAllowEntries(dedupe(raw), allow, "private guard");
  if (options.wholeTree) return splitAllowMisses(applied);
  return { findings: sortFindings(applied.filter((finding) => finding.rule !== "integrity/unused-allow-entry")), allowMisses: [] };
}

/** Whole-tree scan of one commit (the daily scan of public main, and the export). */
export function scanTree(repo: string, rev: string, guard: PrivateGuard, shapes: ShapeSet = "none"): ScanResult {
  const { files } = readTree(repo, rev);
  return scanFiles(files, guard, { wholeTree: true, shapes, publicAllow: shapes === "none" ? [] : publicAllowEntries(files) });
}

/**
 * The shared tree's own allow entries, for the public shapes only. The
 * shared file is edited in public, so an entry for a relational rule is
 * dropped here whatever the shared parser accepts.
 */
function publicAllowEntries(files: readonly TreeFile[]): AllowEntry[] {
  const allow = files.find((file) => file.path === GUARD_ALLOW_FILE);
  return allow === undefined ? [] : shapeOnly(parseGuardAllow(allow.bytes).entries);
}

function shapeOnly(entries: readonly AllowEntry[]): AllowEntry[] {
  return entries.filter((entry) => !entry.rule.startsWith("relational/"));
}

/**
 * Email addresses in a message that are not public ones (the project
 * contact, GitHub noreply addresses, reserved example domains, and the coding
 * agent's co-author address). Only the push of new commits applies it:
 * merged contributions carry their authors' own sign-off lines.
 */
export function messageAddressFindings(path: string, text: string): Finding[] {
  const findings: Finding[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    for (const match of line.matchAll(new RegExp(EMAIL_PATTERN.source, "gu"))) {
      const address = match[0].toLowerCase();
      if (isPublicAddress(address) || isPermittedEmail(address) || MESSAGE_ADDRESSES.has(address)) continue;
      findings.push({ layer: "personal", rule: "personal/message-address", path, line: index + 1, lineSha256: lineSha256(line) });
      break;
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Commits: added lines, messages, added names, new objects

function unquoteGitPath(raw: string): string {
  if (!raw.startsWith('"')) return raw;
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] as string;
    if (char !== "\\") {
      bytes.push(...Buffer.from(char, "utf8"));
      continue;
    }
    const next = body[index + 1] as string;
    if (/[0-7]/u.test(next)) {
      bytes.push(Number.parseInt(body.slice(index + 1, index + 4), 8));
      index += 3;
    } else {
      bytes.push(({ n: 10, t: 9, r: 13, '"': 34, "\\": 92, a: 7, b: 8, f: 12, v: 11 } as Record<string, number>)[next] ?? next.charCodeAt(0));
      index += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

export interface AddedLine {
  commit: string;
  path: string;
  line: number;
  text: string;
}

/**
 * Added lines of every commit the rev-list arguments select; merges against
 * their first parent. Git attributes cannot hide a line: the diff is forced
 * to text (`--text`), no attributes file outside the repository is read, and
 * no textconv or external diff runs, so a `-diff` or `binary` attribute in
 * .gitattributes, $GIT_DIR/info/attributes, or core.attributesFile changes
 * nothing. Whether a file is binary is decided by its new blob's bytes
 * instead: lines of a blob that is not UTF-8 text are left to the object
 * scan, which reads its whole decoded text or printable strings.
 */
export function addedLines(repo: string, revArgs: readonly string[]): AddedLine[] {
  const output = git(
    repo,
    [
      "-c",
      "core.quotePath=false",
      "-c",
      "core.attributesFile=/dev/null",
      "-c",
      "diff.relative=false",
      "log",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--text",
      "--full-index",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--no-renames",
      "--diff-merges=first-parent",
      "-p",
      "-U0",
      "--format=%x00%H",
      ...revArgs,
      "--",
    ],
    { env: { ...repositoryEnv(), GIT_ATTR_NOSYSTEM: "1", GIT_CONFIG_NOSYSTEM: "1" } },
  ).stdout.toString("utf8");
  const lines: Array<AddedLine & { blob: string }> = [];
  let commit = "";
  let path: string | undefined;
  let blob = "";
  let next = 0;
  let inHunk = false;
  for (const raw of output.split("\n")) {
    if (raw.startsWith("\0")) {
      commit = raw.slice(1).trim();
      path = undefined;
      inHunk = false;
      continue;
    }
    if (raw.startsWith("diff --git ")) {
      path = undefined;
      blob = "";
      inHunk = false;
      continue;
    }
    if (!inHunk) {
      const index = /^index [0-9a-f]+\.\.([0-9a-f]+)/u.exec(raw);
      if (index !== null) {
        blob = index[1] as string;
        continue;
      }
    }
    if (!inHunk && raw.startsWith("+++ ")) {
      const target = raw.slice(4);
      path = target === "/dev/null" ? undefined : unquoteGitPath(target).replace(/^b\//u, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(raw);
    if (hunk !== null) {
      next = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || path === undefined) continue;
    if (raw.startsWith("+")) {
      lines.push({ commit, path, line: next, text: raw.slice(1), blob });
      next += 1;
    }
  }
  const blobs = [...new Set(lines.map((line) => line.blob).filter((oid) => /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(oid)))];
  const contents = readObjects(repo, blobs);
  const textBlobs = new Set(blobs.filter((oid) => blobKind(contents.get(oid) ?? Buffer.alloc(0)) === "text"));
  return lines.filter((line) => textBlobs.has(line.blob)).map(({ blob: _blob, ...line }) => line);
}

function commitList(repo: string, revArgs: readonly string[]): string[] {
  return git(repo, ["rev-list", ...revArgs, "--"]).stdout.toString("utf8").split("\n").filter(Boolean);
}

export interface CommitScanOptions {
  diff?: boolean;
  messages?: boolean;
  names?: boolean;
  objects?: boolean;
  shapes?: boolean;
  /** Also refuse non-public email addresses in commit messages (the push of new commits; see messageAddressFindings). */
  addresses?: boolean;
}

/** Private layers (and, with `shapes`, the public shapes) over the commits a rev-list selects. */
export function scanCommits(repo: string, revArgs: readonly string[], guard: PrivateGuard, options: CommitScanOptions): Finding[] {
  const findings: Finding[] = [];
  const commits = commitList(repo, revArgs);
  if (commits.length === 0) return [];
  let publicAllow: AllowEntry[] = [];
  if (options.shapes) {
    const tip = git(repo, ["cat-file", "blob", `${commits[0]}:${GUARD_ALLOW_FILE}`], { allowFailure: true });
    if (tip.status === 0) publicAllow = shapeOnly(parseGuardAllow(tip.stdout).entries);
  }
  if (options.messages) {
    const objects = readObjects(repo, commits);
    for (const commit of commits) {
      const shape = parseCommit(decodeText(objects.get(commit) ?? Buffer.alloc(0)), { strict: false });
      const where = `commit:${commit.slice(0, 12)}`;
      findings.push(...privateTextFindings(`${where}:message`, shape.message, guard, options.shapes ? "secret" : "none"));
      if (options.addresses) findings.push(...messageAddressFindings(`${where}:message`, shape.message));
      for (const [label, header] of [["author", shape.author], ["committer", shape.committer]] as const) {
        const identity = header.replace(/ \d+ [+-]\d{4}$/u, "");
        findings.push(...literalFindings(`${where}:${label}`, identity, guard.literals));
        findings.push(...scanText(`${where}:${label}`, identity, guard.denylist.rules));
      }
    }
  }
  if (options.diff) {
    const raw: Finding[] = [];
    for (const added of addedLines(repo, revArgs)) {
      for (const finding of privateTextFindings(added.path, added.text, guard, options.shapes ? "all" : "none")) {
        raw.push({ ...finding, line: added.line, detail: `commit ${added.commit.slice(0, 12)}` });
      }
    }
    const allowed = applyAllowEntries(
      dedupe(raw.map(({ detail: _detail, ...rest }) => rest)),
      [...guard.allow, ...publicAllow],
      "private guard",
    ).filter((finding) => finding.rule !== "integrity/unused-allow-entry");
    findings.push(...allowed);
  }
  if (options.names) {
    const added = git(repo, ["-c", "core.quotePath=false", "log", "-z", "--format=", "--name-only", "--no-renames", "--diff-filter=A", "--diff-merges=first-parent", ...revArgs, "--"])
      .stdout.toString("utf8")
      .split("\0")
      .map((path) => path.replace(/^\n+/u, ""))
      .filter(Boolean);
    for (const path of [...new Set(added)].sort()) {
      findings.push(...nameFindings("path", path, guard));
      const refusal = sharedTreeRefusal(path);
      if (refusal !== undefined) findings.push({ layer: "path", rule: refusal, path: nameLabel("path", path) });
    }
  }
  if (options.objects) {
    const listed = git(repo, ["rev-list", "--objects", ...revArgs, "--"]).stdout.toString("utf8").split("\n").filter(Boolean);
    const candidates = listed.map((line) => {
      const space = line.indexOf(" ");
      return { oid: space < 0 ? line : line.slice(0, space), path: space < 0 ? "" : line.slice(space + 1) };
    });
    const types = git(repo, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], { input: `${candidates.map((entry) => entry.oid).join("\n")}\n` })
      .stdout.toString("utf8")
      .split("\n");
    const blobs = candidates.filter((_, index) => (types[index] ?? "").endsWith(" blob"));
    const contents = readObjects(repo, blobs.map((blob) => blob.oid));
    const files = blobs.map((blob) => ({ path: blob.path || `(object ${blob.oid.slice(0, 12)})`, oid: blob.oid, bytes: contents.get(blob.oid) ?? Buffer.alloc(0) }));
    findings.push(...blobIdentityFindings(files, guard));
    // A blob that is not UTF-8 text (binary, or BOM-marked UTF-16) has no
    // added lines above; its whole decoded text or printable strings are read.
    for (const file of files) {
      if (blobKind(file.bytes) === "text") continue;
      findings.push(...privateTextFindings(file.path, scannableText(file.bytes), guard, options.shapes ? "secret" : "none"));
    }
  }
  return sortFindings(dedupe(findings));
}

/** An annotated tag's message and tagger (a lightweight tag has neither); with `addresses`, both must hold public addresses only. */
export function tagFindings(repo: string, ref: string, guard: PrivateGuard, options: { addresses?: boolean } = {}): Finding[] {
  const type = git(repo, ["cat-file", "-t", ref], { allowFailure: true });
  if (type.status !== 0) throw new Error(`cannot read ${nameLabel("ref", ref)}`);
  if (type.stdout.toString("utf8").trim() !== "tag") return [];
  const raw = decodeText(git(repo, ["cat-file", "tag", ref]).stdout);
  const split = raw.indexOf("\n\n");
  const oid = git(repo, ["rev-parse", ref]).stdout.toString("utf8").trim();
  const where = `tag:${oid.slice(0, 12)}`;
  const headers = split < 0 ? raw : raw.slice(0, split);
  const tagger = /^tagger (.*) \d+ [+-]\d{4}$/mu.exec(headers)?.[1] ?? "";
  const message = split < 0 ? "" : raw.slice(split + 2);
  const findings = [
    ...privateTextFindings(`${where}:message`, message, guard, "secret"),
    ...literalFindings(`${where}:tagger`, tagger, guard.literals),
    ...scanText(`${where}:tagger`, tagger, guard.denylist.rules),
  ];
  if (options.addresses) {
    const address = /<([^>]*)>\s*$/u.exec(tagger)?.[1] ?? "";
    if (!isPublicAddress(address)) findings.push({ layer: "personal", rule: "personal/tagger-address", path: `${where}:tagger` });
    findings.push(...messageAddressFindings(`${where}:message`, message));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Pull request and issue text (GitHub GET only)

export interface GithubText {
  label: string;
  text: string;
}

type GhRunner = (args: readonly string[]) => string;

function defaultGh(args: readonly string[]): string {
  const result = spawnSync("gh", ["api", "--method", "GET", ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`gh api GET ${args.find((arg) => !arg.startsWith("-")) ?? ""} failed (${result.status})`);
  return result.stdout;
}

function jsonLines(output: string): Array<Record<string, unknown>> {
  return output.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * Titles, bodies, reviews, and comments of a repository's issues and pull
 * requests, read with `gh api --method GET` only. Stops before reading when
 * fewer than GITHUB_MIN_REMAINING core requests remain.
 */
export function githubTexts(slug: string, options: { since?: string; gh?: GhRunner } = {}): GithubText[] {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/u.test(slug)) throw new Error("--github takes owner/name");
  if (options.since !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(options.since)) throw new Error("--since takes an ISO 8601 UTC time");
  const gh = options.gh ?? defaultGh;
  const remaining = Number(gh(["rate_limit", "--jq", ".resources.core.remaining"]).trim());
  if (!Number.isFinite(remaining) || remaining < GITHUB_MIN_REMAINING) {
    throw new Error(`GitHub core requests remaining (${remaining}) are below ${GITHUB_MIN_REMAINING}; stopping`);
  }
  const since = options.since === undefined ? "" : `&since=${options.since}`;
  const texts: GithubText[] = [];
  const read = (endpoint: string) => jsonLines(gh(["--paginate", endpoint, "--jq", ".[] | @json"]));
  for (const issue of read(`repos/${slug}/issues?state=all&per_page=100${since}`)) {
    const kind = issue.pull_request ? "pr" : "issue";
    const label = `${kind}#${issue.number}`;
    texts.push({ label: `${label}:title`, text: String(issue.title ?? "") }, { label: `${label}:body`, text: String(issue.body ?? "") });
    if (kind === "pr") {
      for (const review of read(`repos/${slug}/pulls/${issue.number}/reviews?per_page=100`)) {
        texts.push({ label: `${label}:review:${review.id}`, text: String(review.body ?? "") });
      }
    }
  }
  for (const comment of read(`repos/${slug}/issues/comments?per_page=100${since}`)) {
    texts.push({ label: `issue-comment:${comment.id}`, text: String(comment.body ?? "") });
  }
  for (const comment of read(`repos/${slug}/pulls/comments?per_page=100${since}`)) {
    texts.push({ label: `review-comment:${comment.id}`, text: String(comment.body ?? "") });
  }
  return texts;
}

export function githubFindings(texts: readonly GithubText[], guard: PrivateGuard): Finding[] {
  return sortFindings(texts.flatMap((entry) => privateTextFindings(entry.label, entry.text, guard, "secret")));
}

// ---------------------------------------------------------------------------
// add-literal: append a value's digest without echoing it

export function addLiteral(guardDir: string, options: { kind: "email" | "word"; id: string; reason: string; value: string }): void {
  const path = join(resolve(guardDir), LITERALS_FILE);
  const current = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as { schema: string; note: string; literals: Array<Record<string, string>>; allow: unknown[] })
    : { schema: LITERALS_SCHEMA, note: "", literals: [], allow: [] };
  const value = options.value.normalize("NFKC").trim().toLowerCase();
  if (value === "" || /\s/u.test(value)) throw new Error("the value must be one non-empty token");
  if (options.kind === "word" && !/^[a-z0-9]+$/u.test(value)) throw new Error("a word literal is letters and digits only");
  if (options.kind === "email" && !value.includes("@")) throw new Error("an email literal must hold @");
  const sha256 = sha256Hex(value);
  if (current.literals.some((entry) => entry.sha256 === sha256)) throw new Error("that value is already listed");
  if (current.literals.some((entry) => entry.id === options.id)) throw new Error(`${options.id} is already used`);
  current.literals.push({ id: options.id, kind: options.kind, sha256, reason: options.reason });
  current.literals.sort((a, b) => Number((a.id ?? "").slice(1)) - Number((b.id ?? "").slice(1)));
  const text = `${JSON.stringify({ schema: current.schema, note: current.note, literals: current.literals, allow: current.allow }, null, 2)}\n`;
  parseLiterals(Buffer.from(text));
  writeFileSync(path, text);
}

/**
 * Adds every address of the signed-in GitHub account (`gh api --method GET
 * user/emails`, which needs the user:email scope) that is not a public one
 * and not yet listed. Returns counts only; no address is printed.
 */
export function addGithubAccountLiterals(guardDir: string, gh: GhRunner = defaultGh): { listed: number; public: number; added: number } {
  const addresses = [...new Set(gh(["user/emails", "--jq", ".[].email"]).split("\n").map((line) => line.normalize("NFKC").trim().toLowerCase()).filter(Boolean))];
  const counts = { listed: 0, public: 0, added: 0 };
  for (const address of addresses) {
    if (isPublicAddress(address)) {
      counts.public += 1;
      continue;
    }
    const path = join(resolve(guardDir), LITERALS_FILE);
    const current = JSON.parse(readFileSync(path, "utf8")) as { literals: Array<{ id: string; sha256: string }> };
    if (current.literals.some((entry) => entry.sha256 === sha256Hex(address))) {
      counts.listed += 1;
      continue;
    }
    const next = Math.max(0, ...current.literals.map((entry) => Number(entry.id.slice(1)))) + 1;
    addLiteral(guardDir, {
      kind: "email",
      id: `l${String(next).padStart(2, "0")}`,
      reason: "an address of the owner's GitHub account (user/emails): never in a public commit, tag, message, file, or pull request text",
      value: address,
    });
    counts.added += 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// CLI

function usage(): never {
  console.error(
    "usage: bun private/bin/relational-scan.ts [scan] [--repo <dir>] [--guard-dir <dir> | --guard-rev <commit>] [--json] [--tree <commit>]\n" +
      "         [--diff] [--messages] [--names] [--objects] [--shapes] [--addresses] [--ref-name <name>]... [--tag <ref>]...\n" +
      "         [--github <owner/name> [--since <time>]] [--text <label>] [-- <rev-list arguments>]\n" +
      "       bun private/bin/relational-scan.ts add-literal --kind email|word --id l<NN> --reason <text> [--guard-dir <dir>]\n" +
      "       bun private/bin/relational-scan.ts add-literal --github-account [--guard-dir <dir>]   (needs gh's user:email scope)",
  );
  process.exit(2);
}

async function main(argv: readonly string[]): Promise<number> {
  const args = [...argv];
  const command = args[0] === "scan" || args[0] === "add-literal" ? (args.shift() as string) : "scan";
  let repo = ".";
  let guardDir = DEFAULT_GUARD_DIR;
  let guardRev: string | undefined;
  let json = false;
  let tree: string | undefined;
  const commitOptions: CommitScanOptions = {};
  const refNames: string[] = [];
  const tags: string[] = [];
  let github: string | undefined;
  let since: string | undefined;
  let textLabel: string | undefined;
  let revArgs: string[] = [];
  let kind: string | undefined;
  let id: string | undefined;
  let reason: string | undefined;
  let githubAccount = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    const value = () => {
      const next = args[++index];
      if (next === undefined) usage();
      return next;
    };
    if (arg === "--") {
      revArgs = args.slice(index + 1);
      break;
    } else if (arg === "--repo") repo = value();
    else if (arg === "--guard-dir") guardDir = value();
    else if (arg === "--guard-rev") guardRev = value();
    else if (arg === "--addresses") commitOptions.addresses = true;
    else if (arg === "--json") json = true;
    else if (arg === "--tree") tree = value();
    else if (arg === "--diff") commitOptions.diff = true;
    else if (arg === "--messages") commitOptions.messages = true;
    else if (arg === "--names") commitOptions.names = true;
    else if (arg === "--objects") commitOptions.objects = true;
    else if (arg === "--shapes") commitOptions.shapes = true;
    else if (arg === "--ref-name") refNames.push(value());
    else if (arg === "--tag") tags.push(value());
    else if (arg === "--github") github = value();
    else if (arg === "--since") since = value();
    else if (arg === "--text") textLabel = value();
    else if (arg === "--kind") kind = value();
    else if (arg === "--id") id = value();
    else if (arg === "--reason") reason = value();
    else if (arg === "--github-account") githubAccount = true;
    else usage();
  }
  if (command === "add-literal" && githubAccount) {
    const counts = addGithubAccountLiterals(guardDir);
    console.error(`relational scan: account addresses: ${counts.added} added, ${counts.listed} already listed, ${counts.public} public; no address was printed`);
    return 0;
  }
  if (command === "add-literal") {
    if ((kind !== "email" && kind !== "word") || id === undefined || reason === undefined) usage();
    const value = await new Response(Bun.stdin.stream()).text();
    addLiteral(guardDir, { kind, id, reason, value });
    console.error(`relational scan: added ${id} (${kind}); the value was not printed`);
    return 0;
  }
  const guard = guardRev === undefined ? loadPrivateGuard(guardDir) : loadPrivateGuardFromRev(resolve(repo), guardRev);
  const wantsCommits = commitOptions.diff || commitOptions.messages || commitOptions.names || commitOptions.objects;
  if (wantsCommits && revArgs.length === 0) usage();
  if (!wantsCommits && revArgs.length > 0) usage();
  if (tree === undefined && !wantsCommits && refNames.length === 0 && tags.length === 0 && github === undefined && textLabel === undefined) usage();
  const repoDir = resolve(repo);
  const findings: Finding[] = [];
  let allowMisses: Finding[] = [];
  if (tree !== undefined) {
    const result = scanTree(repoDir, tree, guard, commitOptions.shapes ? "all" : "none");
    findings.push(...result.findings);
    allowMisses = result.allowMisses;
  }
  if (wantsCommits) findings.push(...scanCommits(repoDir, revArgs, guard, commitOptions));
  for (const name of refNames) findings.push(...nameFindings("ref", name, guard));
  for (const tag of tags) findings.push(...tagFindings(repoDir, tag, guard, { addresses: commitOptions.addresses }));
  if (github !== undefined) findings.push(...githubFindings(githubTexts(github, { since }), guard));
  if (textLabel !== undefined) {
    const text = await new Response(Bun.stdin.stream()).text();
    findings.push(...privateTextFindings(textLabel, text, guard, "secret"));
  }
  const sorted = sortFindings(dedupe(findings));
  if (json) {
    console.log(JSON.stringify({ findings: sorted, allow_misses: allowMisses }, null, 2));
  } else {
    for (const finding of sorted) console.log(formatFinding(finding));
    for (const miss of allowMisses) console.log(`allow-miss ${formatFinding(miss)}`);
  }
  if (sorted.length > 0 || allowMisses.length > 0) {
    console.error(`relational scan: ${sorted.length} finding(s), ${allowMisses.length} allow miss(es); rule ids and line hashes only`);
    return 1;
  }
  console.error("relational scan: clean");
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`relational scan: ${(error as Error).message}`);
      process.exit(2);
    },
  );
}
