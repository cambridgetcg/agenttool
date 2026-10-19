#!/usr/bin/env bun
/**
 * The shared scope: the paths whose bytes this private repository and the
 * public development repository hold alike, and which change only in the
 * public one. Read private/README.md first.
 *
 *   bun private/bin/shared-scope.ts list   [--repo <dir>] [--rev <commit>]
 *   bun private/bin/shared-scope.ts drift  --public <commit> --private <commit> [--base <commit>] [--repo <dir>]
 *   bun private/bin/shared-scope.ts staged --public <ref> [--repo <dir>]
 *   bun private/bin/shared-scope.ts merged --base <commit> --public <commit> --private <before> --rev <after>
 *   bun private/bin/shared-scope.ts check-push --rev <commit> --sync <commit> [--base-config <commit>]
 *   bun private/bin/shared-scope.ts check-sync --sync <commit> --root-from <commit> [--previous <commit>] [--main <commit>]
 *   bun private/bin/shared-scope.ts casefold --public <commit> --private <commit>
 *
 * One allowlist file, private/projection/allowlist.json, drives the npm
 * projection and the export alike. The projection reads `include`, `exclude`,
 * and `held`; the export reads `include` and the `export` section, which adds
 * the shared root files and withholds the paths in `export.exclude`. A path is
 * in the shared scope when
 *
 *   - it is under an include entry or is an export root file, is under no
 *     export exclude, and matches no exclude glob; or
 *   - it exists in the public tree it is compared against.
 *
 * The first clause makes an ADD in this repository under a shared tree visible
 * (it is in scope although the public tree lacks it); the second makes a path
 * the public repository added shared even before the allowlist names it.
 *
 * `drift` compares the private commit with the public one inside that scope.
 * With --base (the last merged public tip, as merge-back.sh uses it), a path
 * drifts when the private side changed it since the base and not to the
 * public side's current bytes; without --base, every scoped path must match
 * the public side exactly (pre-push, and the invariant after a merge-back).
 * `staged` refuses a staged change to a scoped path unless the result equals
 * the public side. `merged` checks a merge-back's result (mergeProblems).
 * `check-push` is the pre-push check for any pushed commit (pushProblems),
 * `check-sync` validates a proposed public-sync (syncProblems), and
 * `casefold` lists public paths that differ only in case from a private one.
 * A change that narrows the scope (scopeNarrowing) is refused by `staged` and
 * `check-push` unless ALLOW_SCOPE_CHANGE=1 is set with the owner's go.
 * Paths are printed; contents never are. Exit 1 means drift or a problem.
 */
// First: refuse before the shared guard module runs unless it is the reviewed copy.
import "./reviewed-shared.ts";
import { resolve } from "node:path";
import { globToRegExp, parseAllowlist, ALLOWLIST_PATH, DENYLIST_PATH, OVERLAY_ROOT, type Allowlist } from "../../bin/project-public.ts";
import { foldPath, git, isSafeRelativePath, isWithin, PROJECTION_FILE, sharedTreeRefusal } from "../../tools/public-guard.ts";

/** Where the adoption merge records the public root commit. */
export const PUBLIC_ROOT_RECORD = "private/export/public-root.txt";

export interface ExportExclude {
  path: string;
  reason: string;
}

export interface ExportConfig {
  allowlist: Allowlist;
  rootFiles: string[];
  exclude: ExportExclude[];
}

export class ScopeError extends Error {}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Validates the allowlist's `export` section. A missing section fails closed. */
export function parseExportConfig(allowlist: Allowlist): ExportConfig {
  const fail = (message: string): never => {
    throw new ScopeError(`${ALLOWLIST_PATH}: export: ${message}`);
  };
  const raw = allowlist.export as Record<string, unknown> | undefined;
  if (raw === undefined) fail("the section is missing; the export and the shared scope need it");
  if (Object.keys(raw!).join(",") !== "note,root_files,exclude") fail("must have exactly note, root_files, exclude in that order");
  if (typeof raw!.note !== "string" || raw!.note.trim() === "") fail("note must be a non-empty string");
  const includes = allowlist.include.map((entry) => entry.path);
  const rootFiles = raw!.root_files;
  if (!Array.isArray(rootFiles) || rootFiles.length === 0) fail("root_files must be a non-empty array");
  for (const [index, path] of (rootFiles as unknown[]).entries()) {
    if (typeof path !== "string" || !isSafeRelativePath(path)) fail(`root_files[${index}] is not a safe relative path`);
    const shared = sharedTreeRefusal(path as string);
    if (shared !== undefined) fail(`root_files[${index}] ${path} is refused in a shared tree (${shared})`);
    if (path === PROJECTION_FILE || isWithin(path as string, OVERLAY_ROOT) || isWithin(path as string, DENYLIST_PATH)) fail(`root_files[${index}] ${path} is private`);
    for (const include of includes) {
      if (isWithin(path as string, include) || isWithin(include, path as string)) fail(`root_files[${index}] ${path} overlaps include ${include}`);
    }
    // A root file is a top-level text, shared tooling under tools/, or a
    // shared workflow; nothing under bin/, api/, apps/, or the like.
    if (!(!(path as string).includes("/") || isWithin(path as string, "tools") || /^\.github\/workflows\/[^/]+\.ya?ml$/u.test(path as string))) {
      fail(`root_files[${index}] ${path} is not a top-level file, a tools/ file, or a workflow`);
    }
  }
  const sortedRoot = [...(rootFiles as string[])].sort(compare);
  if (sortedRoot.join("\n") !== (rootFiles as string[]).join("\n") || new Set(rootFiles as string[]).size !== (rootFiles as string[]).length) {
    fail("root_files must be sorted and unique");
  }
  const exclude = raw!.exclude;
  if (!Array.isArray(exclude)) fail("exclude must be an array");
  const excludes: ExportExclude[] = [];
  for (const [index, entry] of (exclude as unknown[]).entries()) {
    const record = entry as Record<string, unknown>;
    if (typeof record !== "object" || record === null || Object.keys(record).join(",") !== "path,reason") fail(`exclude[${index}] must have exactly path and reason`);
    if (typeof record.path !== "string" || !isSafeRelativePath(record.path)) fail(`exclude[${index}].path is not a safe relative path`);
    if (typeof record.reason !== "string" || record.reason.trim() === "") fail(`exclude[${index}].reason must say why`);
    if (!includes.some((include) => isWithin(record.path as string, include))) fail(`exclude[${index}] ${record.path} is not inside an include path`);
    excludes.push({ path: record.path as string, reason: record.reason as string });
  }
  const excludePaths = excludes.map((entry) => entry.path);
  if ([...excludePaths].sort(compare).join("\n") !== excludePaths.join("\n") || new Set(excludePaths).size !== excludePaths.length) {
    fail("exclude must be sorted by path and unique");
  }
  return { allowlist, rootFiles: rootFiles as string[], exclude: excludes };
}

/** Reads and validates the allowlist and its export section from a commit (or `:` for the index). */
export function readExportConfig(repo: string, rev: string): ExportConfig {
  const spec = rev === ":" ? `:${ALLOWLIST_PATH}` : `${rev}:${ALLOWLIST_PATH}`;
  const blob = git(repo, ["cat-file", "blob", spec], { allowFailure: true });
  if (blob.status !== 0) throw new ScopeError(`${ALLOWLIST_PATH} is missing from ${rev === ":" ? "the index" : rev}`);
  return parseExportConfig(parseAllowlist(blob.stdout));
}

/** Whether a path is in the allowlist part of the shared scope (the export's own set). */
export function exportMatcher(config: ExportConfig): (path: string) => boolean {
  const globs = config.allowlist.exclude.map(globToRegExp);
  const roots = new Set(config.rootFiles);
  return (path) => {
    if (config.exclude.some((entry) => isWithin(path, entry.path))) return false;
    if (globs.some((pattern) => pattern.test(path))) return false;
    if (roots.has(path)) return true;
    return config.allowlist.include.some((include) => (include.kind === "blob" ? path === include.path : path.startsWith(`${include.path}/`)));
  };
}

/** One tree entry, as `<mode> <oid>`, or undefined when the path is absent. */
export type EntryMap = Map<string, string>;

/** Every non-tree entry of a commit (blobs, symlinks, submodules) by path. */
export function treeEntries(repo: string, rev: string): EntryMap {
  const entries: EntryMap = new Map();
  const raw = git(repo, ["ls-tree", "-r", "-z", "--full-tree", rev]).stdout.toString("utf8");
  for (const record of raw.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    const [mode, , oid] = record.slice(0, tab).split(" ");
    entries.set(record.slice(tab + 1), `${mode} ${oid}`);
  }
  return entries;
}

/** Stage-0 index entries by path. */
export function indexEntries(repo: string): EntryMap {
  const entries: EntryMap = new Map();
  const raw = git(repo, ["ls-files", "-s", "-z"]).stdout.toString("utf8");
  for (const record of raw.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    const [mode, oid, stage] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (stage !== "0") throw new ScopeError(`the index has an unmerged entry; resolve it first`);
    entries.set(path, `${mode} ${oid}`);
  }
  return entries;
}

export interface Drift {
  path: string;
  /**
   * added, deleted, changed: this side differs from the public side on a
   * shared path. collision: the public side added a path that this side
   * holds privately (outside the allowlist) with other bytes; move the
   * private file under private/ and run again.
   */
  kind: "added" | "deleted" | "changed" | "collision";
}

function kindOf(privateEntry: string | undefined, publicEntry: string | undefined): Drift["kind"] {
  if (publicEntry === undefined) return "added";
  if (privateEntry === undefined) return "deleted";
  return "changed";
}

/**
 * Scoped paths where the private side differs from the public side. With a
 * base, a path the private side has not changed since the base, or changed to
 * exactly the public side's entry, is not drift.
 */
export function scopeDrift(
  inScope: (path: string) => boolean,
  sides: { privateEntries: EntryMap; publicEntries: EntryMap; baseEntries?: EntryMap },
): Drift[] {
  const { privateEntries, publicEntries, baseEntries } = sides;
  const paths = new Set<string>([...publicEntries.keys(), ...(baseEntries?.keys() ?? [])]);
  for (const path of privateEntries.keys()) if (inScope(path)) paths.add(path);
  const drift: Drift[] = [];
  for (const path of [...paths].sort(compare)) {
    const mine = privateEntries.get(path);
    const theirs = publicEntries.get(path);
    if (mine === theirs) continue;
    if (baseEntries !== undefined && mine === baseEntries.get(path)) continue;
    const collision = mine !== undefined && theirs !== undefined && !inScope(path) && baseEntries?.get(path) === undefined;
    drift.push({ path, kind: collision ? "collision" : kindOf(mine, theirs) });
  }
  return drift;
}

function resolveCommit(repo: string, rev: string): string | undefined {
  const result = git(repo, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { allowFailure: true });
  return result.status === 0 ? result.stdout.toString("utf8").trim() : undefined;
}

/** Drift of a private commit against a public commit (optionally since a base), scoped by the private commit's allowlist. */
export function commitDrift(repo: string, options: { privateRev: string; publicRev: string; baseRev?: string }): Drift[] {
  const config = readExportConfig(repo, options.privateRev);
  return scopeDrift(exportMatcher(config), {
    privateEntries: treeEntries(repo, options.privateRev),
    publicEntries: treeEntries(repo, options.publicRev),
    baseEntries: options.baseRev === undefined ? undefined : treeEntries(repo, options.baseRev),
  });
}

/**
 * Staged changes to scoped paths whose result differs from the public side.
 * The scope is the union of HEAD's and the index's allowlists, so neither
 * narrowing the allowlist nor widening it in the same commit hides an edit.
 * Without a public side (before the adoption merge, or no fetch yet), every
 * staged change to an allowlisted path is refused.
 */
export function stagedViolations(repo: string, publicRef: string, options: { allowScopeChange?: boolean } = {}): Drift[] {
  const head = resolveCommit(repo, "HEAD");
  const matchers: Array<(path: string) => boolean> = [];
  for (const rev of head === undefined ? [":"] : ["HEAD", ":"]) {
    try {
      matchers.push(exportMatcher(readExportConfig(repo, rev)));
    } catch (error) {
      // A side without the export section contributes nothing; both missing fails closed.
      if (!(error instanceof ScopeError)) throw error;
    }
  }
  if (matchers.length === 0) throw new ScopeError(`neither HEAD nor the index holds a valid ${ALLOWLIST_PATH} export section`);
  if (head !== undefined && !options.allowScopeChange) {
    let before: ExportConfig | undefined;
    let after: ExportConfig | undefined;
    try {
      before = readExportConfig(repo, "HEAD");
      after = readExportConfig(repo, ":");
    } catch (error) {
      if (!(error instanceof ScopeError)) throw error;
    }
    if (before !== undefined && after !== undefined) {
      const narrowed = scopeNarrowing(before, after);
      if (narrowed.length > 0) throw new ScopeError(`the staged allowlist narrows the shared scope (${narrowed.map((line) => line.replace("\t", " ")).join("; ")}); that needs the owner's go (ALLOW_SCOPE_CHANGE=1)`);
    }
  }
  const publicCommit = resolveCommit(repo, publicRef);
  const publicEntries = publicCommit === undefined ? undefined : treeEntries(repo, publicCommit);
  const inScope = (path: string) => matchers.some((matches) => matches(path)) || (publicEntries?.has(path) ?? false);
  const changed = git(repo, ["diff", "--cached", "--name-only", "--no-renames", "-z"])
    .stdout.toString("utf8")
    .split("\0")
    .filter(Boolean);
  const staged = indexEntries(repo);
  const violations: Drift[] = [];
  for (const path of [...new Set(changed)].sort(compare)) {
    if (!inScope(path)) continue;
    const mine = staged.get(path);
    const theirs = publicEntries?.get(path);
    if (publicEntries !== undefined && mine === theirs) continue;
    violations.push({ path, kind: kindOf(mine, theirs) });
  }
  return violations;
}

/**
 * The invariants after a merge-back's merge, before anything is pushed:
 * every public path is in the merged commit with the public bytes (I1), the
 * shared scope of the merged commit equals the public tip exactly, and the
 * merge changed nothing outside the shared scope, the public tip, and the
 * base (a public deletion of a path the base held).
 */
export function mergeProblems(repo: string, revs: { base: string; publicRev: string; before: string; after: string }): string[] {
  const problems: string[] = [];
  const publicEntries = treeEntries(repo, revs.publicRev);
  const after = treeEntries(repo, revs.after);
  for (const [path, entry] of publicEntries) {
    if (after.get(path) !== entry) problems.push(`public path differs or is missing after the merge\t${path}`);
  }
  for (const entry of commitDrift(repo, { privateRev: revs.after, publicRev: revs.publicRev })) {
    problems.push(`shared path ${entry.kind} after the merge\t${entry.path}`);
  }
  for (const path of caseCollisions(publicEntries.keys(), after.keys())) problems.push(`a path differs only in case from another\t${path}`);
  const before = treeEntries(repo, revs.before);
  const base = treeEntries(repo, revs.base);
  const inScope = exportMatcher(readExportConfig(repo, revs.after));
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(path) === after.get(path)) continue;
    if (publicEntries.has(path) || base.has(path) || inScope(path)) continue;
    problems.push(`the merge changed a private-only path\t${path}`);
  }
  return problems.sort(compare);
}

/**
 * How an allowlist change narrows the shared scope: an include or root file
 * removed (or an include turned from tree to blob), an export exclude or an
 * exclude glob added. A narrowed scope would let later adds under the
 * narrowed tree pass every drift check while the projection still ships
 * them, so a narrowing needs the owner's explicit go (ALLOW_SCOPE_CHANGE=1).
 */
export function scopeNarrowing(before: ExportConfig, after: ExportConfig): string[] {
  const changes: string[] = [];
  const afterIncludes = new Map(after.allowlist.include.map((entry) => [entry.path, entry.kind]));
  for (const entry of before.allowlist.include) {
    const kind = afterIncludes.get(entry.path);
    if (kind === undefined) {
      if (!after.allowlist.include.some((wider) => wider.kind === "tree" && isWithin(entry.path, wider.path))) changes.push(`include removed\t${entry.path}`);
    } else if (kind !== entry.kind && entry.kind === "tree") changes.push(`include narrowed to a blob\t${entry.path}`);
  }
  for (const path of before.rootFiles) if (!after.rootFiles.includes(path)) changes.push(`root file removed\t${path}`);
  const beforeExcludes = new Set(before.exclude.map((entry) => entry.path));
  for (const entry of after.exclude) if (!beforeExcludes.has(entry.path) && !before.exclude.some((old) => isWithin(entry.path, old.path))) changes.push(`export exclude added\t${entry.path}`);
  for (const glob of after.allowlist.exclude) if (!before.allowlist.exclude.includes(glob)) changes.push(`exclude glob added\t${glob}`);
  return changes.sort(compare);
}

/** Every path and every directory prefix of it, case-folded, mapped to its spellings. */
function foldedSpellings(paths: Iterable<string>): Map<string, Set<string>> {
  const spellings = new Map<string, Set<string>>();
  for (const path of paths) {
    const segments = path.split("/");
    for (let end = 1; end <= segments.length; end += 1) {
      const prefix = segments.slice(0, end).join("/");
      const folded = foldPath(prefix);
      let set = spellings.get(folded);
      if (set === undefined) spellings.set(folded, (set = new Set()));
      set.add(prefix);
    }
  }
  return spellings;
}

/**
 * Public paths (or their directories) that a case-insensitive file system
 * would write over a differently spelled path of the private commit, as
 * `Private/guard/x` over `private/guard/x`, or two public spellings of one
 * path. A merge must never write such a path.
 */
export function caseCollisions(publicPaths: Iterable<string>, privatePaths: Iterable<string>): string[] {
  const publicSpellings = foldedSpellings(publicPaths);
  const privateSpellings = foldedSpellings(privatePaths);
  const collisions = new Set<string>();
  for (const [folded, spellings] of publicSpellings) {
    const all = new Set([...spellings, ...(privateSpellings.get(folded) ?? [])]);
    if (all.size > 1) for (const spelling of spellings) collisions.add(spelling);
  }
  return [...collisions].sort(compare);
}

function rootsOf(repo: string, rev: string): string[] {
  return git(repo, ["rev-list", "--max-parents=0", rev, "--"]).stdout.toString("utf8").split("\n").filter(Boolean).sort(compare);
}

function isAncestor(repo: string, ancestor: string, descendant: string): boolean {
  return git(repo, ["merge-base", "--is-ancestor", ancestor, descendant], { allowFailure: true }).status === 0;
}

/** The public root a private commit records (the adoption merge's private/export/public-root.txt), or undefined before adoption. */
export function recordedPublicRoot(repo: string, rev: string): string | undefined {
  const blob = git(repo, ["cat-file", "blob", `${rev}:${PUBLIC_ROOT_RECORD}`], { allowFailure: true });
  if (blob.status !== 0) return undefined;
  const value = blob.stdout.toString("utf8").trim();
  if (!/^[0-9a-f]{40}$/u.test(value)) throw new ScopeError(`${PUBLIC_ROOT_RECORD} in ${rev} does not hold one commit id`);
  return value;
}

/**
 * Checks a proposed public-sync value: its history has exactly the public
 * root as its root and adds no path a shared tree may not hold; it
 * fast-forwards the previous value; and it is contained in `main` (the main
 * pushed with it, or the remote's) when given.
 */
export function syncProblems(repo: string, options: { sync: string; root: string; previous?: string; main?: string }): string[] {
  const problems: string[] = [];
  const sync = resolveCommit(repo, options.sync);
  if (sync === undefined) return [`public-sync ${options.sync} is not a commit here`];
  const roots = rootsOf(repo, sync);
  if (roots.join(",") !== options.root) problems.push(`public-sync ${sync.slice(0, 12)} does not have the public root as its only root`);
  const touched = git(repo, ["-c", "core.quotePath=false", "log", "-z", "--format=", "--name-only", "--no-renames", "--diff-merges=separate", sync, "--"])
    .stdout.toString("utf8")
    .split("\0")
    .map((path) => path.replace(/^\n+/u, ""))
    .filter(Boolean);
  for (const path of new Set(touched)) {
    const refusal = sharedTreeRefusal(path);
    if (refusal !== undefined) problems.push(`public-sync history holds a path a shared tree may not hold (${refusal})\t${path}`);
  }
  if (options.previous !== undefined) {
    const previous = resolveCommit(repo, options.previous);
    if (previous === undefined) problems.push(`the previous public-sync ${options.previous.slice(0, 12)} is not known here; fetch it first`);
    else if (!isAncestor(repo, previous, sync)) problems.push(`public-sync ${sync.slice(0, 12)} does not fast-forward ${previous.slice(0, 12)}`);
  }
  if (options.main !== undefined && !isAncestor(repo, sync, options.main)) problems.push(`public-sync ${sync.slice(0, 12)} is not contained in main ${options.main.slice(0, 12)}`);
  return problems.sort(compare);
}

/**
 * The push check for one private commit (every pushed branch or tag, not only
 * main): the public tip it contains is S = merge-base(commit, public-sync),
 * which must be a public commit (its only root the recorded public root);
 * inside the shared scope the commit must equal S exactly, so an edit, delete,
 * or add under a shared tree is drift whichever branch carries it; and its
 * allowlist must not narrow the scope relative to `baseConfigRev` (the
 * remote's main) unless `allowScopeChange`.
 */
export function pushProblems(
  repo: string,
  options: { rev: string; sync: string; baseConfigRev?: string; allowScopeChange?: boolean },
): { problems: string[]; drift: Drift[] } {
  const rev = resolveCommit(repo, options.rev);
  if (rev === undefined) return { problems: [`${options.rev} is not a commit here`], drift: [] };
  const root = recordedPublicRoot(repo, rev);
  if (root === undefined) return { problems: [`${rev.slice(0, 12)} predates the adoption merge (no ${PUBLIC_ROOT_RECORD}); rebase it onto main`], drift: [] };
  const sync = resolveCommit(repo, options.sync);
  if (sync === undefined) return { problems: [`public-sync ${options.sync} is not known here; fetch it first`], drift: [] };
  const base = git(repo, ["merge-base", rev, sync], { allowFailure: true });
  if (base.status !== 0) return { problems: [`${rev.slice(0, 12)} and public-sync share no history`], drift: [] };
  const tip = base.stdout.toString("utf8").trim().split("\n")[0] as string;
  const problems: string[] = [];
  if (rootsOf(repo, tip).join(",") !== root) problems.push(`the public tip ${tip.slice(0, 12)} in ${rev.slice(0, 12)} is not a public commit (its root is not the recorded public root)`);
  const drift = commitDrift(repo, { privateRev: rev, publicRev: tip });
  if (options.baseConfigRev !== undefined && !options.allowScopeChange) {
    let before: ExportConfig | undefined;
    try {
      before = readExportConfig(repo, options.baseConfigRev);
    } catch (error) {
      if (!(error instanceof ScopeError)) throw error;
    }
    if (before !== undefined) {
      for (const change of scopeNarrowing(before, readExportConfig(repo, rev))) problems.push(`the allowlist narrows the shared scope (set ALLOW_SCOPE_CHANGE=1 only with the owner's go): ${change}`);
    }
  }
  return { problems, drift };
}

export function formatDrift(drift: readonly Drift[]): string[] {
  return drift.map((entry) => `${entry.kind}\t${entry.path}`);
}

// ---------------------------------------------------------------------------
// CLI

function usage(): never {
  console.error(
    "usage: bun private/bin/shared-scope.ts list [--repo <dir>] [--rev <commit>]\n" +
      "       bun private/bin/shared-scope.ts drift --public <commit> --private <commit> [--base <commit>] [--repo <dir>]\n" +
      "       bun private/bin/shared-scope.ts staged --public <ref> [--repo <dir>]\n" +
      "       bun private/bin/shared-scope.ts merged --base <commit> --public <commit> --private <before> --rev <after> [--repo <dir>]\n" +
      "       bun private/bin/shared-scope.ts check-push --rev <commit> --sync <commit> [--base-config <commit>] [--repo <dir>]\n" +
      "       bun private/bin/shared-scope.ts check-sync --sync <commit> --root-from <commit> [--previous <commit>] [--main <commit>] [--repo <dir>]\n" +
      "       bun private/bin/shared-scope.ts casefold --public <commit> --private <commit> [--repo <dir>]",
  );
  process.exit(2);
}

function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  const options: Record<string, string> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] as string;
    const value = rest[index + 1];
    if (!["--repo", "--rev", "--public", "--private", "--base", "--sync", "--base-config", "--root-from", "--previous", "--main"].includes(arg) || value === undefined) usage();
    options[arg.slice(2).replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase())] = value;
    index += 1;
  }
  const repo = resolve(options.repo ?? ".");
  if (command === "list") {
    const rev = options.rev ?? "HEAD";
    const matches = exportMatcher(readExportConfig(repo, rev));
    for (const path of [...treeEntries(repo, rev).keys()].filter(matches).sort(compare)) console.log(path);
    return 0;
  }
  if (command === "drift") {
    if (options.public === undefined || options.private === undefined) usage();
    for (const rev of [options.public, options.private, ...(options.base === undefined ? [] : [options.base])]) {
      if (resolveCommit(repo, rev) === undefined) throw new ScopeError(`cannot resolve ${rev} to a commit`);
    }
    const drift = commitDrift(repo, { privateRev: options.private, publicRev: options.public, baseRev: options.base });
    for (const line of formatDrift(drift)) console.log(line);
    if (drift.length > 0) {
      console.error(`shared scope: ${drift.length} shared path(s) differ from the public side; change them in the public repository`);
      return 1;
    }
    console.error("shared scope: no drift");
    return 0;
  }
  if (command === "merged") {
    if (options.public === undefined || options.base === undefined || options.private === undefined || options.rev === undefined) usage();
    const problems = mergeProblems(repo, { base: options.base, publicRev: options.public, before: options.private, after: options.rev });
    for (const line of problems) console.log(line);
    if (problems.length > 0) {
      console.error(`shared scope: ${problems.length} problem(s) after the merge; nothing may be pushed`);
      return 1;
    }
    console.error("shared scope: the merge holds the public tip exactly and changed only shared paths");
    return 0;
  }
  const allowScopeChange = process.env.ALLOW_SCOPE_CHANGE === "1";
  if (command === "check-push") {
    if (options.rev === undefined || options.sync === undefined) usage();
    const { problems, drift } = pushProblems(repo, { rev: options.rev, sync: options.sync, baseConfigRev: options.baseConfig, allowScopeChange });
    for (const line of [...problems, ...formatDrift(drift)]) console.log(line);
    if (problems.length + drift.length > 0) {
      console.error(`shared scope: ${problems.length} problem(s), ${drift.length} shared path(s) differ from the public tip this commit contains; change shared paths in the public repository`);
      return 1;
    }
    return 0;
  }
  if (command === "check-sync") {
    if (options.sync === undefined || options.rootFrom === undefined) usage();
    const root = recordedPublicRoot(repo, options.rootFrom);
    if (root === undefined) throw new ScopeError(`${options.rootFrom} has no ${PUBLIC_ROOT_RECORD}`);
    const problems = syncProblems(repo, { sync: options.sync, root, previous: options.previous, main: options.main });
    for (const line of problems) console.log(line);
    if (problems.length > 0) {
      console.error(`shared scope: ${problems.length} problem(s) with the proposed public-sync`);
      return 1;
    }
    return 0;
  }
  if (command === "casefold") {
    if (options.public === undefined || options.private === undefined) usage();
    const collisions = caseCollisions(treeEntries(repo, options.public).keys(), treeEntries(repo, options.private).keys());
    for (const path of collisions) console.log(`case collision\t${path}`);
    if (collisions.length > 0) {
      console.error(`shared scope: ${collisions.length} public path(s) differ only in case from a path here; a case-insensitive file system would overwrite it`);
      return 1;
    }
    return 0;
  }
  if (command === "staged") {
    if (options.public === undefined) usage();
    const violations = stagedViolations(repo, options.public, { allowScopeChange });
    for (const line of formatDrift(violations)) console.log(line);
    if (violations.length > 0) {
      const known = resolveCommit(repo, options.public) !== undefined;
      console.error(
        known
          ? `shared scope: ${violations.length} staged change(s) to shared paths; make them in the public repository`
          : `shared scope: ${options.public} is unknown here, so ${violations.length} staged change(s) to shared paths cannot be checked; refusing`,
      );
      return 1;
    }
    return 0;
  }
  usage();
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`shared scope: ${(error as Error).message}`);
    process.exit(2);
  }
}
