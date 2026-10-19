#!/usr/bin/env bun
/**
 * Export of shared-scope files from this private repository into a clone of
 * the public development repository, as plain files. Read private/README.md
 * first.
 *
 *   bun private/bin/public-export.ts --init --source <commit> --into <dir>
 *       (--gitleaks <gitleaks 8.30.1> | --no-gitleaks) [--commit]
 *   bun private/bin/public-export.ts --upstream --branch <name> --source <commit> --into <clone>
 *       --paths <path>... (--gitleaks <binary> | --no-gitleaks) [--commit --message <subject>]
 *   common: [--repo <private checkout>] [--guard-dir <dir>] [--require-ancestor <ref>]
 *           [--allow-unmerged-source]
 *
 * Everything is read from the source commit's objects: the allowlist and its
 * export section (private/projection/allowlist.json), the listing (`git
 * ls-tree`), and every blob (`git cat-file`). Nothing is checked out, no
 * symlink is followed or written, and the public clone never fetches from
 * this repository: it receives files and hashes them itself.
 *
 * Before anything is written the export refuses symlinks (120000),
 * submodules (160000), any path under private/, any
 * .github/workflows/private-* workflow, a PROJECTION.json, a path that is
 * not in the shared scope, and a path whose name hits the relational
 * denylist or a literal digest; the export section's exclude entries
 * (packages/wallet today) are left out. It then runs the published layers of
 * tools/public-guard.ts (path, binary, secret, personal, and gitleaks 8.30.1
 * with the tree's own allow file and .gitleaksignore) and the private layers
 * of private/bin/relational-scan.ts (relational terms, literal digests,
 * withheld files, the denylist's own bytes, and the canary). Any finding
 * refuses the export and nothing is written.
 *
 * After writing and `git add`, the identity proof requires the clone's index
 * to hold exactly the source's (mode, blob, path) entries for the exported
 * paths: --init requires the whole index to equal the export; --upstream
 * writes only the named paths (the public clone may be ahead), requires each
 * exported entry in the index, and deletes a named file the source no longer
 * holds. --commit commits with the public identity and an
 * Exported-From trailer, and refuses when gitleaks was skipped. The tool
 * never pushes, never adds a remote, and prints only paths, rule ids, and
 * line hashes.
 */
import { closeSync, existsSync, fchmodSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, unlinkSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  applyAllowEntries,
  applyGitleaksIgnore,
  binaryFindings,
  contentFindings,
  type Finding,
  formatFinding,
  git,
  GITLEAKS_IGNORE_FILE,
  GITLEAKS_VERSION,
  gitleaksFindings,
  GUARD_ALLOW_FILE,
  isSafeRelativePath,
  isWithin,
  parseGitleaksIgnore,
  parseGuardAllow,
  pathRuleFindings,
  PERSONAL_RULES,
  PROJECTION_AUTHOR_EMAIL,
  readObjects,
  SECRET_RULES,
  sharedTreeRefusal,
  sortFindings,
  type TreeFile,
} from "../../tools/public-guard.ts";
import { loadPrivateGuard, DEFAULT_GUARD_DIR, scanFiles } from "./relational-scan.ts";
import { exportMatcher, readExportConfig, type ExportConfig } from "./shared-scope.ts";
import { PRIVATE_REPOSITORY } from "../public-repository.ts";

export const PUBLIC_AUTHOR_NAME = "AgentTool";
export const PUBLIC_AUTHOR_EMAIL = PROJECTION_AUTHOR_EMAIL;
export const DEFAULT_REQUIRED_ANCESTOR = "refs/remotes/origin/main";
const REPO_ROOT = resolve(import.meta.dir, "..", "..");

export class ExportRefused extends Error {
  constructor(
    message: string,
    readonly findings: readonly Finding[] = [],
  ) {
    super(message);
  }
}

/** Git's environment without variables that redirect it or override identity, dates, or the index. */
export function exportGitEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  const dropped = /^GIT_(?:DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|NAMESPACE|REPLACE_REF_BASE|AUTHOR_\w+|COMMITTER_\w+|EDITOR|SEQUENCE_EDITOR)$/u;
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !dropped.test(key)) env[key] = value;
  }
  return { ...env, GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0", ...extra };
}

function run(cwd: string, args: readonly string[], options: { input?: string; allowFailure?: boolean; env?: Record<string, string> } = {}) {
  return git(cwd, args, { input: options.input, allowFailure: options.allowFailure, env: options.env ?? exportGitEnv() });
}

export interface ExportEntry {
  mode: string;
  oid: string;
  path: string;
}

/**
 * Every shared-scope entry of the source, listed through `git ls-tree`.
 * Symlinks, submodules, and non-blob entries refuse the export.
 */
export function sourceEntries(repo: string, source: string, config: ExportConfig, within?: readonly string[]): { entries: ExportEntry[]; findings: Finding[] } {
  const inScope = exportMatcher(config);
  const roots = [...config.allowlist.include.map((entry) => entry.path), ...config.rootFiles];
  const findings: Finding[] = [];
  const entries: ExportEntry[] = [];
  const seen = new Set<string>();
  const listing = run(repo, ["ls-tree", "-r", "-z", "--full-tree", source, "--", ...(within ?? roots)]).stdout.toString("utf8");
  for (const record of listing.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    const [mode, type, oid] = record.slice(0, tab).split(" ") as [string, string, string];
    const path = record.slice(tab + 1);
    if (!inScope(path) || seen.has(path)) continue;
    seen.add(path);
    if (mode === "120000") findings.push({ layer: "path", rule: "path/symlink", path });
    else if (mode === "160000" || type === "commit") findings.push({ layer: "path", rule: "path/submodule", path });
    else if (type !== "blob") findings.push({ layer: "path", rule: "path/unexpected-object", path, detail: type });
    else entries.push({ mode, oid, path });
  }
  for (const root of within === undefined ? roots : []) {
    if (config.exclude.some((entry) => isWithin(root, entry.path))) continue;
    if (!entries.some((entry) => isWithin(entry.path, root)) && !findings.some((finding) => isWithin(finding.path, root))) {
      throw new ExportRefused(`shared path ${root} does not exist in ${source}`);
    }
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { entries, findings };
}

export interface GuardResult {
  findings: Finding[];
  gitleaks: string;
}

/**
 * Every layer over the exported files. Allow entries and gitleaks
 * fingerprints apply to the files exported; with `wholeScope` an entry that
 * matches nothing among them is a finding, so a stale exception fails closed.
 */
export function guardExport(
  files: readonly TreeFile[],
  allowSource: { allow?: Uint8Array; gitleaksIgnore?: Uint8Array },
  options: { gitleaks?: string; guardDir: string; wholeScope: boolean },
): GuardResult {
  const findings: Finding[] = [];
  const paths = new Set(files.map((file) => file.path));
  findings.push(...pathRuleFindings(files.map((file) => ({ mode: file.mode, type: "blob", oid: file.oid, size: file.bytes.length, path: file.path })), () => true));
  for (const file of files) {
    const refusal = sharedTreeRefusal(file.path);
    if (refusal !== undefined) findings.push({ layer: "path", rule: refusal, path: file.path });
  }
  const allow = allowSource.allow === undefined ? { entries: [], binaries: [] } : parseGuardAllow(allowSource.allow);
  const scoped = <T extends { path: string }>(entries: readonly T[]) => (options.wholeScope ? [...entries] : entries.filter((entry) => paths.has(entry.path)));
  findings.push(...binaryFindings(files, scoped(allow.binaries), GUARD_ALLOW_FILE));
  findings.push(...applyAllowEntries(contentFindings(files, [...SECRET_RULES, ...PERSONAL_RULES]), scoped(allow.entries), GUARD_ALLOW_FILE));
  let gitleaks = "skipped";
  if (options.gitleaks !== undefined) {
    const fingerprints = allowSource.gitleaksIgnore === undefined ? [] : parseGitleaksIgnore(allowSource.gitleaksIgnore);
    findings.push(...applyGitleaksIgnore(gitleaksFindings(options.gitleaks, files), scoped(fingerprints)));
    gitleaks = GITLEAKS_VERSION;
  }
  const guard = loadPrivateGuard(options.guardDir);
  const relational = scanFiles(files, guard, { wholeTree: options.wholeScope });
  findings.push(...relational.findings, ...relational.allowMisses);
  return { findings: sortFindings(findings), gitleaks };
}

// ---------------------------------------------------------------------------
// Writing files without following links

function assertRealDirectory(path: string): void {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined) {
    mkdirSync(path);
    return;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ExportRefused(`${path} is not a plain directory; refusing to write through it`);
}

/** Writes one file inside `root`, creating plain directories and refusing any symlink on the way. */
export function writeExportFile(root: string, path: string, bytes: Uint8Array, mode: string): void {
  if (!isSafeRelativePath(path)) throw new ExportRefused(`unsafe path ${JSON.stringify(path)}`);
  const segments = path.split("/");
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    assertRealDirectory(current);
  }
  const target = join(root, path);
  const existing = lstatSync(target, { throwIfNoEntry: false });
  if (existing !== undefined && (existing.isSymbolicLink() || !existing.isFile())) throw new ExportRefused(`${path} exists and is not a plain file`);
  if (existing !== undefined) unlinkSync(target);
  const permissions = mode === "100755" ? 0o755 : 0o644;
  const fd = openSync(target, "wx", permissions);
  try {
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
    fchmodSync(fd, permissions);
  } finally {
    closeSync(fd);
  }
}

function removeExportFile(root: string, path: string): void {
  if (!isSafeRelativePath(path)) throw new ExportRefused(`unsafe path ${JSON.stringify(path)}`);
  let current = root;
  for (const segment of path.split("/").slice(0, -1)) {
    current = join(current, segment);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat === undefined) return;
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ExportRefused(`${current} is not a plain directory`);
  }
  const target = join(root, path);
  const stat = lstatSync(target, { throwIfNoEntry: false });
  if (stat !== undefined) {
    if (!stat.isFile() && !stat.isSymbolicLink()) throw new ExportRefused(`${path} is not a file`);
    unlinkSync(target);
  }
}

// ---------------------------------------------------------------------------
// The public clone

function indexEntriesUnder(clone: string, paths?: readonly string[]): Map<string, string> {
  const raw = run(clone, ["ls-files", "-s", "-z", "--", ...(paths ?? [])]).stdout.toString("utf8");
  const entries = new Map<string, string>();
  for (const record of raw.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    const [mode, oid, stage] = record.slice(0, tab).split(" ");
    if (stage !== "0") throw new ExportRefused("the public clone's index has unmerged entries");
    entries.set(record.slice(tab + 1), `${mode} ${oid}`);
  }
  return entries;
}

/** Whether a remote URL names the private repository itself (not a repository whose name only starts with it). */
export function namesPrivateRepository(url: string): boolean {
  const escaped = PRIVATE_REPOSITORY.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&");
  return new RegExp(`(?:^|[/:])${escaped}(?:\\.git)?/?$`, "iu").test(url.trim());
}

/** The clone must be a plain repository of its own: no alternates, no remote naming the private repository. */
function assertIsolatedClone(clone: string, privateRepo: string): void {
  const gitDir = resolve(clone, run(clone, ["rev-parse", "--git-dir"]).stdout.toString("utf8").trim());
  if (existsSync(join(gitDir, "objects", "info", "alternates"))) throw new ExportRefused("the public clone borrows objects through alternates; use a plain clone");
  if (run(clone, ["rev-parse", "--is-shallow-repository"]).stdout.toString("utf8").trim() === "true") throw new ExportRefused("the public clone is shallow");
  const privatePaths = [resolve(privateRepo), resolve(privateRepo, run(privateRepo, ["rev-parse", "--git-common-dir"]).stdout.toString("utf8").trim())];
  const remotes = run(clone, ["config", "--get-regexp", "^remote\\..*\\.(url|pushurl)$"], { allowFailure: true }).stdout.toString("utf8");
  for (const line of remotes.split("\n").filter(Boolean)) {
    const url = line.slice(line.indexOf(" ") + 1);
    const local = url.replace(/^file:\/\//u, "");
    if (namesPrivateRepository(url)) throw new ExportRefused("the public clone has a remote that names the private repository");
    if (privatePaths.some((path) => resolve(local) === path || resolve(local) === join(path, ".git"))) throw new ExportRefused("the public clone has a remote that is the private repository");
  }
}

function unbornHead(clone: string): boolean {
  return run(clone, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], { allowFailure: true }).status !== 0;
}

function cleanWorktree(clone: string): boolean {
  return run(clone, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=no"]).stdout.length === 0;
}

export interface ExportOptions {
  mode: "init" | "upstream";
  repo?: string;
  source: string;
  into: string;
  branch?: string;
  paths?: string[];
  gitleaks?: string;
  noGitleaks?: boolean;
  guardDir?: string;
  requireAncestor?: string;
  allowUnmergedSource?: boolean;
  commit?: boolean;
  message?: string;
}

export interface ExportReceipt {
  mode: "init" | "upstream";
  source_commit: string;
  into: string;
  branch: string | null;
  files: number;
  deleted: number;
  excluded: string[];
  index_tree: string;
  identity: "proven";
  gitleaks: string;
  commit: string | null;
}

export function runExport(options: ExportOptions): ExportReceipt {
  const repo = resolve(options.repo ?? REPO_ROOT);
  const into = resolve(options.into);
  if (options.gitleaks === undefined && !options.noGitleaks) throw new ExportRefused("pass --gitleaks <gitleaks 8.30.1>, or --no-gitleaks for a dry export that cannot commit");
  if (options.gitleaks !== undefined && options.noGitleaks) throw new ExportRefused("--gitleaks and --no-gitleaks exclude each other");
  if (options.commit && options.gitleaks === undefined) throw new ExportRefused("--commit needs the gitleaks layer");
  if (options.mode === "upstream" && (options.branch === undefined || !/^[A-Za-z0-9._/-]+$/u.test(options.branch))) throw new ExportRefused("--upstream needs --branch <name>");
  if (options.mode === "upstream" && options.commit && (options.message === undefined || options.message.trim() === "")) throw new ExportRefused("--commit in upstream mode needs --message");
  if (options.mode === "upstream" && (options.paths === undefined || options.paths.length === 0)) {
    throw new ExportRefused("--upstream needs --paths: the public clone may be ahead of this repository, so only named paths are written");
  }
  const sourceCheck = run(repo, ["rev-parse", "--verify", "--quiet", `${options.source}^{commit}`], { allowFailure: true });
  if (sourceCheck.status !== 0) throw new ExportRefused(`cannot resolve ${options.source} to a commit`);
  const source = sourceCheck.stdout.toString("utf8").trim();
  if (!options.allowUnmergedSource) {
    const ancestor = options.requireAncestor ?? DEFAULT_REQUIRED_ANCESTOR;
    if (run(repo, ["merge-base", "--is-ancestor", source, ancestor], { allowFailure: true }).status !== 0) {
      throw new ExportRefused(`${source} is not contained in ${ancestor} (pass --allow-unmerged-source to export a widening branch)`);
    }
  }
  const config = readExportConfig(repo, source);
  const inScope = exportMatcher(config);

  // The public clone.
  if (options.mode === "init") {
    if (!existsSync(into)) {
      mkdirSync(into, { recursive: true });
      run(into, ["init", "--quiet", "--initial-branch=main"]);
    }
    const stat = lstatSync(into);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ExportRefused(`${into} is not a plain directory`);
    if (run(into, ["rev-parse", "--show-toplevel"], { allowFailure: true }).stdout.toString("utf8").trim() !== realpathSync(into)) {
      throw new ExportRefused(`${into} is not the top of its own repository`);
    }
    if (!unbornHead(into)) throw new ExportRefused("--init needs a repository without commits");
    if (readdirSync(into).some((name) => name !== ".git")) throw new ExportRefused("--init needs an empty working tree");
    if (indexEntriesUnder(into).size > 0) throw new ExportRefused("--init needs an empty index");
  } else {
    if (!existsSync(join(into, ".git"))) throw new ExportRefused(`${into} is not a clone`);
    if (unbornHead(into)) throw new ExportRefused("--upstream needs a clone with the public history");
    if (!cleanWorktree(into)) throw new ExportRefused("the public clone has uncommitted or untracked files");
    if (run(into, ["rev-parse", "--verify", "--quiet", `refs/heads/${options.branch}`], { allowFailure: true }).status === 0) {
      throw new ExportRefused(`branch ${options.branch} already exists in the public clone`);
    }
  }
  assertIsolatedClone(into, repo);

  // The listing and the guard, before anything is written.
  const requested = options.mode === "upstream" ? options.paths : undefined;
  const scopeRoots = [...config.allowlist.include.map((entry) => entry.path), ...config.rootFiles];
  for (const path of requested ?? []) {
    if (!isSafeRelativePath(path)) throw new ExportRefused(`unsafe path ${JSON.stringify(path)}`);
    if (sharedTreeRefusal(path) !== undefined) throw new ExportRefused(`${path} can never be shared`);
    if (!scopeRoots.some((root) => isWithin(path, root) || isWithin(root, path))) throw new ExportRefused(`${path} is outside the shared scope`);
    if (config.exclude.some((entry) => isWithin(path, entry.path))) throw new ExportRefused(`${path} is withheld by the export section's exclude list`);
  }
  const { entries, findings: listingFindings } = sourceEntries(repo, source, config, requested);
  const contents = readObjects(repo, entries.map((entry) => entry.oid));
  const files: TreeFile[] = entries.map((entry) => ({ ...entry, bytes: contents.get(entry.oid) ?? Buffer.alloc(0) }));
  const rootBlob = (path: string) => {
    const result = run(repo, ["cat-file", "blob", `${source}:${path}`], { allowFailure: true });
    return result.status === 0 ? result.stdout : undefined;
  };
  const guardResult = guardExport(files, { allow: rootBlob(GUARD_ALLOW_FILE), gitleaksIgnore: rootBlob(GITLEAKS_IGNORE_FILE) }, {
    gitleaks: options.gitleaks,
    guardDir: options.guardDir ?? DEFAULT_GUARD_DIR,
    wholeScope: requested === undefined,
  });
  const findings = sortFindings([...listingFindings, ...guardResult.findings]);
  if (findings.length > 0) throw new ExportRefused(`the guard found ${findings.length} problem(s); nothing was written`, findings);

  // Write, then let the clone hash the files itself. In upstream mode a
  // named path that the source no longer holds is deleted; a named directory
  // is written file by file and keeps whatever else the public side added.
  if (options.mode === "upstream") run(into, ["switch", "--quiet", "--create", options.branch as string]);
  const expected = new Map(entries.map((entry) => [entry.path, `${entry.mode} ${entry.oid}`]));
  const before = options.mode === "upstream" ? indexEntriesUnder(into, requested) : new Map<string, string>();
  const removed = (requested ?? []).filter((path) => before.has(path) && !expected.has(path));
  for (const path of removed) {
    if (!inScope(path)) throw new ExportRefused(`${path} is outside this repository's shared scope; delete it in the public repository`);
    removeExportFile(into, path);
  }
  for (const file of files) {
    if (before.get(file.path) === `${file.mode} ${file.oid}`) continue;
    writeExportFile(into, file.path, file.bytes, file.mode);
  }
  const addArgs = ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "add", "--all", "--"];
  if (options.mode === "init") run(into, [...addArgs, "."]);
  else {
    const present = (requested ?? []).filter((path) => expected.has(path) || removed.includes(path) || entries.some((entry) => isWithin(entry.path, path)));
    if (present.length === 0) throw new ExportRefused("none of the named paths exists in the source or the public clone");
    run(into, [...addArgs, ...present]);
  }

  // Identity proof. --init: the index is exactly the exported entries.
  // --upstream: every exported entry is in the index with its mode and blob,
  // and every deleted path is gone.
  const got = indexEntriesUnder(into, requested);
  const mismatch: Finding[] = [];
  const proofPaths = options.mode === "init" ? new Set([...got.keys(), ...expected.keys()]) : new Set([...expected.keys(), ...removed]);
  for (const path of proofPaths) {
    if (got.get(path) !== expected.get(path)) {
      const detail = got.has(path) ? (expected.has(path) ? "different blob or mode" : "not in the source") : "missing from the index";
      mismatch.push({ layer: "integrity", rule: "integrity/export-identity", path, detail });
    }
  }
  if (mismatch.length > 0) {
    throw new ExportRefused("the public clone's index does not equal the exported entries; nothing was committed", sortFindings(mismatch));
  }
  const indexTree = run(into, ["write-tree"]).stdout.toString("utf8").trim();

  let commit: string | null = null;
  if (options.commit) {
    const message =
      options.mode === "init"
        ? `AgentTool public root\n\nExported-From: ${source}\n`
        : `${(options.message as string).trim()}\n\nExported-From: ${source}\n`;
    run(into, ["-c", "commit.gpgSign=false", "commit", "--quiet", "--no-verify", "--allow-empty-message", "--file", "-"], {
      input: message,
      env: exportGitEnv({
        GIT_AUTHOR_NAME: PUBLIC_AUTHOR_NAME,
        GIT_AUTHOR_EMAIL: PUBLIC_AUTHOR_EMAIL,
        GIT_COMMITTER_NAME: PUBLIC_AUTHOR_NAME,
        GIT_COMMITTER_EMAIL: PUBLIC_AUTHOR_EMAIL,
      }),
    });
    commit = run(into, ["rev-parse", "HEAD"]).stdout.toString("utf8").trim();
    if (run(into, ["rev-parse", "HEAD^{tree}"]).stdout.toString("utf8").trim() !== indexTree) throw new ExportRefused("the commit's tree is not the proven index");
    if (options.mode === "init" && run(into, ["rev-list", "--count", "--all"]).stdout.toString("utf8").trim() !== "1") {
      throw new ExportRefused("the public root must be the clone's only commit");
    }
  }
  return {
    mode: options.mode,
    source_commit: source,
    into,
    branch: options.mode === "upstream" ? (options.branch as string) : null,
    files: entries.length,
    deleted: removed.length,
    excluded: config.exclude.map((entry) => entry.path),
    index_tree: indexTree,
    identity: "proven",
    gitleaks: guardResult.gitleaks,
    commit,
  };
}

// ---------------------------------------------------------------------------
// CLI

function usage(): never {
  console.error(
    "usage: bun private/bin/public-export.ts --init --source <commit> --into <dir> (--gitleaks <bin> | --no-gitleaks) [--commit]\n" +
      "       bun private/bin/public-export.ts --upstream --branch <name> --source <commit> --into <clone> [--paths <path>...]\n" +
      "              (--gitleaks <bin> | --no-gitleaks) [--commit --message <subject>]\n" +
      "       [--repo <dir>] [--guard-dir <dir>] [--require-ancestor <ref>] [--allow-unmerged-source]",
  );
  process.exit(2);
}

export function parseArgs(argv: readonly string[]): ExportOptions {
  const options: Partial<ExportOptions> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    const value = () => {
      const next = argv[++index];
      if (next === undefined || next.startsWith("--")) usage();
      return next;
    };
    if (arg === "--init" || arg === "--upstream") {
      if (options.mode !== undefined) usage();
      options.mode = arg === "--init" ? "init" : "upstream";
    } else if (arg === "--source") options.source = value();
    else if (arg === "--into") options.into = value();
    else if (arg === "--repo") options.repo = value();
    else if (arg === "--branch") options.branch = value();
    else if (arg === "--gitleaks") options.gitleaks = value();
    else if (arg === "--no-gitleaks") options.noGitleaks = true;
    else if (arg === "--guard-dir") options.guardDir = value();
    else if (arg === "--require-ancestor") options.requireAncestor = value();
    else if (arg === "--allow-unmerged-source") options.allowUnmergedSource = true;
    else if (arg === "--commit") options.commit = true;
    else if (arg === "--message") options.message = value();
    else if (arg === "--paths") {
      options.paths = [];
      while (argv[index + 1] !== undefined && !(argv[index + 1] as string).startsWith("--")) options.paths.push(argv[++index] as string);
      if (options.paths.length === 0) usage();
    } else usage();
  }
  if (options.mode === undefined || options.source === undefined || options.into === undefined) usage();
  if (options.mode === "init" && (options.paths !== undefined || options.branch !== undefined || options.message !== undefined)) usage();
  return options as ExportOptions;
}

if (import.meta.main) {
  try {
    const receipt = runExport(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(receipt, null, 2));
  } catch (error) {
    if (error instanceof ExportRefused) {
      for (const finding of error.findings) console.error(formatFinding(finding));
      console.error(`public export: refused: ${error.message}`);
      process.exit(1);
    }
    console.error(`public export: ${(error as Error).message}`);
    process.exit(2);
  }
}
