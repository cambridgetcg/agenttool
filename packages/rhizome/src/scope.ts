/** rhizome/scope — "what source files exist here?", answered twice.
 *
 *  Every probe needs a corpus. The tempting way to give it one is a list
 *  of directories. That list is the pathology: `api/src/services/canon/
 *  annotations.ts` shipped `SCAN_DIRS = [api/src, bin]` for months, so
 *  the twelve orphan annotations under `packages/` were not "missed" —
 *  they were outside the universe, and every report written from that
 *  scan said the tree was clean.
 *
 *  So rhizome derives its corpus, twice, by two mechanisms that fail
 *  differently:
 *
 *    git-tracked      `git ls-files -z` — what version control knows.
 *                     Blind to anything untracked, however real.
 *    filesystem-walk  a real walk with rules parsed from the `.gitignore`
 *                     files found during the walk. Blind to nothing on
 *                     disk, but its ignore matching is an approximation.
 *
 *  The corpus handed to probes is the UNION. Intersecting would rebuild
 *  the blind spot inside the instrument: a file only one derivation can
 *  see is precisely the file worth looking at. Every path the two
 *  derivations disagree about becomes a finding (`probes/scope.ts`),
 *  because that disagreement *is* the blind-spot signature.
 *
 *  The one boundary that is not derived is `NEVER_WALKED`; it is exported,
 *  reasoned below, and cross-checked by the git derivation.
 */

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import { compileIgnoreFile, isIgnored, type IgnoreRule } from "./gitignore.js";
import type { Scope, ScopeDerivation, ScopeDisagreement } from "./types.js";

/** Directories the filesystem walk never enters, with the reason each is out.
 *
 *  Asserted, not silent, and staleness-checked by construction: `git
 *  ls-files` also never lists paths under `.git`, so if an entry here were
 *  wrong the git derivation would report files the walk cannot see and the
 *  `scope` probe would print the disagreement. The check is the
 *  cross-derivation diff, not a promise.
 *
 *  Note what is NOT here: `node_modules`, `dist`, `.venv`. Those are
 *  excluded because the repository's own `.gitignore` says so, read at
 *  walk time. Copying them into this list is how the list starts lying. */
export const NEVER_WALKED: Readonly<Record<string, string>> = Object.freeze({
  ".git": "object database, not source; git ls-files never lists it either, so the cross-check would catch a mistake here",
});

/** Files above this size are listed in the corpus but not read. Reported
 *  as `Scope.unread` and surfaced as a `limit` finding rather than
 *  dropped, because an unread file is a place rhizome cannot see. */
export const MAX_READ_BYTES = 2 * 1024 * 1024;

/** Walk up from `start` until a directory containing `.git` is found. The
 *  repository root is derived from the filesystem, never passed in as a
 *  constant. */
export function findRepoRoot(start: string): string {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`no .git found at or above ${start}`);
    }
    current = parent;
  }
}

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

/** Derivation 1: version control's answer. */
export function deriveFromGit(root: string): ScopeDerivation {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  const files =
    result.status === 0 && result.stdout
      ? result.stdout
          .toString("utf8")
          .split("\0")
          .filter((entry) => entry !== "")
          .sort()
      : [];
  return {
    id: "git-tracked",
    method: "git ls-files -z",
    files,
    blindTo:
      result.status === 0
        ? "untracked files, including work in progress and anything a .gitignore rule covers"
        : "everything — git exited non-zero, so this derivation contributed nothing",
  };
}

/** Derivation 2: the disk's answer, with ignore rules learned en route. */
export function deriveFromFilesystem(root: string): ScopeDerivation {
  const files: string[] = [];

  const walk = (relativeDir: string, inherited: readonly IgnoreRule[]): void => {
    const absolute = relativeDir === "" ? root : join(root, relativeDir);
    let entries: Dirent[];
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }

    let rules = inherited;
    if (entries.some((entry) => entry.isFile() && entry.name === ".gitignore")) {
      try {
        const text = readFileSync(join(absolute, ".gitignore"), "utf8");
        rules = [...inherited, ...compileIgnoreFile(relativeDir, text)];
      } catch {
        rules = inherited;
      }
    }

    for (const entry of entries) {
      // Symlinks are never followed: this repository publishes mirrors by
      // symlink, and following them counts the same file twice.
      if (entry.isSymbolicLink()) continue;
      const relative = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name in NEVER_WALKED) continue;
        if (isIgnored(relative, true, rules) !== null) continue;
        walk(relative, rules);
      } else if (entry.isFile()) {
        if (isIgnored(relative, false, rules) !== null) continue;
        files.push(relative);
      }
    }
  };

  walk("", []);
  files.sort();
  return {
    id: "filesystem-walk",
    method: "recursive readdir from the repository root, ignore rules parsed from every .gitignore encountered, symlinks never followed",
    files,
    blindTo:
      "anything behind a symlink, and any file a gitignore construct this matcher approximates wrongly would have kept or dropped",
  };
}

/** Why a path git tracks did not come out of the walk.
 *
 *  Three different things wear the same shape, and calling all three
 *  "rhizome's own miss" would be exactly the imprecision this package
 *  objects to. So each absence is explained against the tree: is it a
 *  symlink the walk deliberately refuses to follow, a file force-added
 *  past an ignore rule, or a real hole in the matcher? */
function explainAbsence(root: string, path: string): { kind: "symlink" | "ignored-yet-tracked" | "unexplained"; note: string } {
  const segments = path.split("/");
  for (let i = 1; i <= segments.length; i += 1) {
    const prefix = segments.slice(0, i).join("/");
    try {
      if (lstatSync(join(root, ...segments.slice(0, i))).isSymbolicLink()) {
        return {
          kind: "symlink",
          note: prefix === path ? "is a symlink" : `sits under the symlink ${prefix}`,
        };
      }
    } catch {
      break;
    }
  }

  let rules: IgnoreRule[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const directory = segments.slice(0, i).join("/");
    try {
      const text = readFileSync(join(root, ...segments.slice(0, i), ".gitignore"), "utf8");
      rules = [...rules, ...compileIgnoreFile(directory, text)];
    } catch {
      // no .gitignore at this level
    }
  }
  // The walk never descends an ignored directory, so an ancestor's rule
  // explains the absence just as well as one naming the file.
  let rule = isIgnored(path, false, rules);
  for (let i = 1; rule === null && i < segments.length; i += 1) {
    rule = isIgnored(segments.slice(0, i).join("/"), true, rules);
  }
  if (rule !== null) {
    return { kind: "ignored-yet-tracked", note: `matches ${JSON.stringify(rule.source.trim())} in ${rule.base === "" ? "." : rule.base}/.gitignore, yet git tracks it` };
  }
  return { kind: "unexplained", note: "no symlink and no ignore rule explains the absence" };
}

function diff(root: string, derivations: readonly ScopeDerivation[]): ScopeDisagreement[] {
  const membership = new Map<string, Set<string>>();
  for (const derivation of derivations) {
    for (const file of derivation.files) {
      const set = membership.get(file) ?? new Set<string>();
      set.add(derivation.id);
      membership.set(file, set);
    }
  }
  const ids = derivations.map((derivation) => derivation.id);
  const out: ScopeDisagreement[] = [];
  for (const [file, present] of membership) {
    if (present.size === ids.length) continue;
    const absentFrom = ids.filter((id) => !present.has(id));
    let reading: string;
    if (absentFrom.includes("git-tracked")) {
      reading = "on disk but untracked: a scanner that enumerates via git cannot see this file";
    } else {
      const explanation = explainAbsence(root, file);
      reading =
        explanation.kind === "symlink"
          ? "tracked, and skipped by the walk because it is or sits under a symlink: git records the link, the walk deliberately refuses to follow it"
          : explanation.kind === "ignored-yet-tracked"
            ? "tracked despite matching an ignore rule: a walk that honours .gitignore cannot see a force-added file"
            : "tracked but not produced by the walk: rhizome's own ignore matching dropped a file git keeps";
    }
    out.push({
      file,
      presentIn: ids.filter((id) => present.has(id)),
      absentFrom,
      reading,
    });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

function looksBinary(text: string): boolean {
  return text.indexOf("\0") !== -1;
}

/** Resolve the repository scope. `root` defaults to the repository that
 *  contains this module, found by walking up for `.git`. */
export function resolveScope(root?: string): Scope {
  const repoRoot = root === undefined ? findRepoRoot(import.meta.dir) : resolve(root);
  const derivations = [deriveFromGit(repoRoot), deriveFromFilesystem(repoRoot)];
  const union = new Set<string>();
  for (const derivation of derivations) for (const file of derivation.files) union.add(file);
  const files = [...union].sort();

  const directories = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    for (let i = 1; i < parts.length; i += 1) directories.add(parts.slice(0, i).join("/"));
  }

  const textCache = new Map<string, string | null>();
  const lineCache = new Map<string, readonly string[]>();
  const markerCache = new Map<string, readonly string[]>();
  const unread: string[] = [];

  const read = (file: string): string | null => {
    const cached = textCache.get(file);
    if (cached !== undefined) return cached;
    let text: string | null = null;
    try {
      const stat = statSync(join(repoRoot, ...file.split("/")));
      if (stat.isFile() && stat.size <= MAX_READ_BYTES) {
        const candidate = readFileSync(join(repoRoot, ...file.split("/")), "utf8");
        text = looksBinary(candidate) ? null : candidate;
      }
    } catch {
      text = null;
    }
    if (text === null) unread.push(file);
    textCache.set(file, text);
    return text;
  };

  const lines = (file: string): readonly string[] => {
    const cached = lineCache.get(file);
    if (cached !== undefined) return cached;
    const text = read(file);
    const split = text === null ? [] : text.split("\n");
    lineCache.set(file, split);
    return split;
  };

  const filesContaining = (marker: string): readonly string[] => {
    const cached = markerCache.get(marker);
    if (cached !== undefined) return cached;
    const hits = files.filter((file) => read(file)?.includes(marker) === true);
    markerCache.set(marker, hits);
    return hits;
  };

  return {
    root: repoRoot,
    files,
    directories,
    derivations,
    disagreements: diff(repoRoot, derivations),
    get unread(): readonly string[] {
      return [...new Set(unread)].sort();
    },
    read,
    lines,
    filesContaining,
  };
}

export { toPosix };
