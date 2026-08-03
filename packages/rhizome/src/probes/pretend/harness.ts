/** rhizome/probes/pretend/harness — break the guarded thing, watch the guard.
 *
 *  Everything else rhizome does is reading. This is the one place that runs
 *  repository code, and it is opt-in for that reason: `RHIZOME_MUTATE=1`.
 *  The rest of the package's read-only invariant is unchanged — the harness
 *  never writes inside the repository. It builds a shadow root under the
 *  system temporary directory in which every top-level entry is a symlink
 *  back to the real tree, except the packages a mutant touches, which are
 *  copied. The mutant is written into the copy. `git status` in the real
 *  checkout is identical before and after.
 *
 *  Three properties this harness holds, because a mutation report is
 *  trivially faked:
 *
 *  1. **Baseline first.** A guard that is already red proves nothing when a
 *     mutant is added, so every guard is run unmutated in the shadow first
 *     and a guard that is not green there is SKIPPED, with its output tail
 *     recorded. A harness that counts a pre-existing failure as "the guard
 *     died" is the grass this package is looking for.
 *
 *  2. **A control mutant that must die.** Each operator declares one target
 *     whose breakage is unambiguous. If the control survives, the harness
 *     reports itself broken rather than reporting the tree clean — the
 *     failure mode of every mutation tool is silently applying nothing and
 *     printing a page of green.
 *
 *  3. **Everything skipped is named.** Mutation is expensive and this
 *     harness samples. The sample size, the skips and their reasons are
 *     part of the output, not a footnote: a probe that samples and reports
 *     as if exhaustive is the exact pathology it exists to name.
 */

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { compileIgnoreFile } from "../../gitignore.js";
import { NEVER_WALKED } from "../../scope.js";
import type { Scope } from "../../types.js";

/** How long a single guard invocation may take before it is abandoned. */
export const GUARD_TIMEOUT_MS = 240_000;

/** Directories never copied into a shadow, derived from the repository's own
 *  ignore rules.
 *
 *  This was a literal — `["node_modules", ".venv", "dist", ".git",
 *  "__pycache__", ".pytest_cache"]` — inside the package whose first run
 *  over this repository reported six copies of one list in the SDKs. It is
 *  the same shape as `annotations.ts`'s `SCAN_DIRS`, inverted: a scope
 *  decision made once, in a file nobody re-reads, while `.gitignore` keeps
 *  being edited. A build directory added to `.gitignore` next month would
 *  have been copied into every shadow, silently, forever.
 *
 *  So it is read from the corpus instead: every directory-only, unanchored,
 *  non-negated rule in every `.gitignore` rhizome can see, plus the entries
 *  of `NEVER_WALKED` — the one asserted boundary in `src/scope.ts`, reused
 *  rather than re-typed. */
export function notCopiedDirectories(scope: Scope): Set<string> {
  const out = new Set<string>(Object.keys(NEVER_WALKED));
  for (const file of scope.files) {
    if (!file.endsWith(".gitignore")) continue;
    const text = scope.read(file);
    if (text === null) continue;
    const base = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
    for (const rule of compileIgnoreFile(base, text)) {
      if (!rule.directoryOnly || rule.negated || rule.anchored) continue;
      const name = rule.source.trim().replace(/\/$/, "");
      if (/^[\w.-]+$/.test(name)) out.add(name);
    }
  }
  return out;
}

/** Not-copied directories that are linked back into the shadow instead.
 *
 *  A genuine literal boundary, and the honest reason is that it is not a
 *  scope: it is the answer to "which of these would a test run need, and
 *  cannot regenerate cheaply?". An installed dependency tree costs minutes
 *  to reproduce and is read-only to every mutant this package writes, so it
 *  is linked. A `dist/` is rebuilt by the guard's own runner and a `.git`
 *  must not be reachable from a shadow at all — a `git` invocation inside
 *  the shadow would then be operating on the real repository.
 *
 *  The four properties: exported here; reasoned above; staleness-checked by
 *  `tests/pretend.test.ts`, which fails if an entry is not also in the
 *  derived not-copied set for this repository (so it cannot drift into
 *  naming a source directory) and fails if `.git` ever appears in it; and
 *  stated in rhizome's own output as a declared `ProbeLimit` on `pretend`. */
export const LINKED_BACK: readonly string[] = Object.freeze(["node_modules", ".venv"]);

/** `LINKED_BACK` as prose, for the probe limit that publishes it. Derived
 *  rather than re-typed, and named so that a reader of the limit can find
 *  the list it came from. */
export const LINKED_BACK_PHRASE = LINKED_BACK.join(" and ");

/** A file replaced in the shadow. */
export interface Edit {
  file: string;
  text: string;
}

export interface ShadowRoot {
  path: string;
  dispose(): void;
}

/** Does anything at all sit at `path`, including a broken symlink? */
function present(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
}

/** Link every SIBLING of `relative` at each level, leaving `relative` itself
 *  to be copied. The loop stops one short of `relative` on purpose: linking
 *  the children of the subtree that is about to be copied is how the copy
 *  collides with a `node_modules` link it just made. */
function linkSiblings(root: string, repo: string, relative: string): void {
  const parts = relative === "" ? [] : relative.split("/");
  for (let i = 0; i < parts.length; i += 1) {
    const here = parts.slice(0, i).join("/");
    const from = here === "" ? repo : join(repo, here);
    const to = here === "" ? root : join(root, here);
    if (present(to) && lstatSync(to).isSymbolicLink()) rmSync(to);
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) {
      if (name === parts[i]) continue;
      const link = join(to, name);
      if (present(link)) continue;
      try {
        symlinkSync(join(from, name), link);
      } catch {
        // A racing sibling session can create the same link; harmless.
      }
    }
  }
}

function copyTree(from: string, to: string, notCopied: ReadonlySet<string>): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const destination = join(to, entry.name);
    if (present(destination)) continue;
    if (entry.isDirectory()) {
      if (notCopied.has(entry.name)) {
        // Installed trees are linked back rather than copied: an install is
        // never repeated, and nothing writes through the link because the
        // mutants only ever touch source files.
        if (LINKED_BACK.includes(entry.name)) symlinkSync(source, destination);
        continue;
      }
      copyTree(source, destination, notCopied);
    } else if (entry.isFile()) {
      writeFileSync(destination, readFileSync(source));
    } else if (entry.isSymbolicLink()) {
      try {
        symlinkSync(source, destination);
      } catch {
        // unreadable link; the shadow simply does not carry it
      }
    }
  }
}

/** Build a shadow of the repository in which `copied` are real directories.
 *
 *  `notCopied` comes from `notCopiedDirectories(scope)` — derived from the
 *  repository's own ignore rules — and is a parameter rather than a
 *  constant so that this module holds no private copy of it. */
export function buildShadow(
  repoRoot: string,
  copied: readonly string[],
  edits: readonly Edit[],
  notCopied: ReadonlySet<string>,
): ShadowRoot {
  const path = join(tmpdir(), `rhizome-pretend-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(path, { recursive: true });
  for (const subtree of copied) {
    linkSiblings(path, repoRoot, subtree);
    const destination = join(path, subtree);
    if (present(destination) && lstatSync(destination).isSymbolicLink()) rmSync(destination);
    copyTree(join(repoRoot, subtree), destination, notCopied);
  }
  for (const edit of edits) {
    const target = join(path, edit.file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, edit.text);
  }
  return {
    path,
    dispose(): void {
      rmSync(path, { recursive: true, force: true });
    },
  };
}

export interface GuardRun {
  ok: boolean;
  /** Trailing output, for the reader to judge without re-running. */
  tail: string;
  passed: number | null;
  failed: number | null;
}

/** Run one guard command inside a shadow. */
export function runGuard(shadow: ShadowRoot, cwd: string, command: readonly string[]): GuardRun {
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: join(shadow.path, cwd),
    encoding: "utf8",
    timeout: GUARD_TIMEOUT_MS,
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const passed = /(\d+) (?:pass(?:ed)?)\b/.exec(output);
  const failed = /(\d+) (?:fail(?:ed)?)\b/.exec(output);
  return {
    ok: result.status === 0 && (failed === null || failed[1] === "0"),
    tail: output.trim().split("\n").slice(-6).join("\n").slice(0, 700),
    passed: passed === null ? null : Number(passed[1]),
    failed: failed === null ? null : Number(failed[1]),
  };
}

/** The package a path belongs to, derived from the manifests in the corpus. */
export function owningPackage(scope: Scope, file: string): { directory: string; runner: "bun" | "pytest" } | null {
  let best: { directory: string; runner: "bun" | "pytest" } | null = null;
  for (const manifest of scope.files) {
    const base = manifest.slice(manifest.lastIndexOf("/") + 1);
    if (base !== "package.json" && base !== "pyproject.toml") continue;
    const directory = manifest.includes("/") ? manifest.slice(0, manifest.lastIndexOf("/")) : "";
    if (directory === "" || directory.includes("node_modules")) continue;
    if (!file.startsWith(`${directory}/`)) continue;
    if (best === null || directory.length > best.directory.length) {
      best = { directory, runner: base === "package.json" ? "bun" : "pytest" };
    }
  }
  return best;
}

/** The command that runs one guard file, derived from its package manifest.
 *
 *  A boundary, and a real one: knowing that a `package.json` package is run
 *  with `bun test` and a `pyproject.toml` package with `pytest` is knowledge
 *  about two ecosystems, not something readable from this tree. It is here,
 *  named, and published as a probe limit. A package whose runner is neither
 *  is reported as unrunnable rather than guessed at. */
export function guardCommand(
  scope: Scope,
  file: string,
): { cwd: string; command: string[] } | null {
  const owner = owningPackage(scope, file);
  if (owner === null) return null;
  const relative = file.slice(owner.directory.length + 1);
  if (owner.runner === "bun") return { cwd: owner.directory, command: ["bun", "test", relative] };
  const venv = join(owner.directory, ".venv", "bin", "python");
  const python = scope.files.includes(venv) || existsSync(join(scope.root, venv)) ? `.venv/bin/python` : "python3";
  return { cwd: owner.directory, command: [python, "-m", "pytest", "-q", relative] };
}
