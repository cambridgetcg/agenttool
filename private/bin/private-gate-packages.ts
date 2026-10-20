#!/usr/bin/env bun
/**
 * The private-only packages the merge-back gate must run. Read
 * private/README.md first.
 *
 *   bun private/bin/private-gate-packages.ts [--root <dir>]
 *
 * Prints, one per line and sorted, every package directory under packages/
 * that is outside the shared scope (the export allowlist) and depends,
 * directly or through other private-only packages, on shared code, with the
 * command that checks it: its `bun run ci`, or for a package without one
 * the command in GATE_COMMANDS, as `<name>\t<command>`. A public change to
 * shared code can break such a package although no shared test sees it, so
 * `bin/preflight.sh private` runs each one.
 *
 * A package depends on shared code when its manifest names a `file:` or
 * `link:` dependency on a shared package, or when one of its source, test,
 * script, or JSON files holds a relative path (`"../../collab/src/store.js"`,
 * a `../` import, a spawned script) that resolves into a shared package or
 * onto a shared path. Paths built at run time from separate segments are not
 * seen; a package that needs them is listed by hand in SHARED_DEPENDENTS.
 *
 * A private-only package that depends on shared code but has neither a
 * `ci` script nor a GATE_COMMANDS entry is named on stderr, ungated.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { exportMatcher, parseExportConfig } from "./shared-scope.ts";
import { ALLOWLIST_PATH, parseAllowlist } from "../../bin/project-public.ts";

type Manifest = { scripts?: Record<string, string> } & Record<string, unknown>;

/** Private-only packages that reach shared code in a way the scan cannot see. None today. */
export const SHARED_DEPENDENTS: readonly string[] = [];

/**
 * The gate's command for a dependent package that has no `ci` script, run in
 * the package directory. hf-training-host's JavaScript bridge loads the
 * shared wake-continuity build; its Python tests need the prepared HF host
 * environment and stay in `bin/preflight.sh packages`.
 */
export const GATE_COMMANDS: Readonly<Record<string, string>> = { "hf-training-host": "bun test bridge/tests" };

/** Files whose relative paths count: code, scripts, and JSON (manifests, tsconfig `extends` and `paths`). */
const SCANNED = /\.(?:[cm]?[jt]sx?|json|sh)$/u;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "build", "coverage", ".venv", "venv", ".git", "__pycache__", ".turbo", ".next"]);
/** A string literal holding a relative path, without interpolation. */
const RELATIVE_LITERAL = /(["'`])(\.{1,2}\/[^"'`\n\r$]*)\1/gu;

/** The files of one package directory: Git's list when `root` is a checkout, else a walk without build and dependency directories. */
function packageFiles(root: string, directory: string): string[] {
  const listed = spawnSync("git", ["-C", root, "ls-files", "-z", "--", directory], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (listed.status === 0 && listed.stdout !== "") return listed.stdout.split("\0").filter(Boolean);
  const files: string[] = [];
  const walk = (relative: string) => {
    for (const name of readdirSync(join(root, relative))) {
      if (SKIPPED_DIRECTORIES.has(name)) continue;
      const path = posix.join(relative, name);
      const stat = statSync(join(root, path), { throwIfNoEntry: false });
      if (stat?.isDirectory()) walk(path);
      else if (stat?.isFile()) files.push(path);
    }
  };
  walk(directory);
  return files;
}

/** Repository-relative targets of the relative paths written in one file (outside the repository dropped). */
export function relativeTargets(file: string, text: string): string[] {
  const targets = new Set<string>();
  for (const match of text.matchAll(RELATIVE_LITERAL)) {
    const target = posix.normalize(posix.join(posix.dirname(file), match[2] as string)).replace(/\/+$/u, "");
    if (target !== "." && !target.startsWith("../") && target !== "..") targets.add(target);
  }
  return [...targets];
}

/** One gated package: its directory name under packages/ and, when it has no `ci` script, the command that checks it. */
export interface GatedPackage {
  name: string;
  command?: string;
}

export function privateGatePackages(root: string, options: { warn?: (line: string) => void } = {}): GatedPackage[] {
  const inScope = exportMatcher(parseExportConfig(parseAllowlist(readFileSync(join(root, ALLOWLIST_PATH)))));
  const manifests = new Map<string, Manifest>();
  const files = new Map<string, string[]>();
  for (const name of readdirSync(join(root, "packages")).sort()) {
    if (!statSync(join(root, "packages", name)).isDirectory()) continue;
    const list = packageFiles(root, `packages/${name}`);
    files.set(name, list);
    const path = join(root, "packages", name, "package.json");
    if (existsSync(path)) manifests.set(name, JSON.parse(readFileSync(path, "utf8")) as Manifest);
  }
  // A package is shared when any of its files is in the shared scope.
  const sharedPackages = new Set([...files].filter(([, list]) => list.some(inScope)).map(([name]) => name));
  const packageOf = (path: string): string | undefined => /^packages\/([^/]+)(?:\/|$)/u.exec(path)?.[1];

  // Edges: what each private-only package reaches, by manifest and by relative path.
  const reachesShared = new Map<string, boolean>();
  const edges = new Map<string, Set<string>>();
  for (const [name, list] of files) {
    if (sharedPackages.has(name)) continue;
    const local = new Set<string>();
    let shared = SHARED_DEPENDENTS.includes(name);
    const manifest = manifests.get(name);
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const spec of Object.values((manifest?.[field] as Record<string, string> | undefined) ?? {})) {
        const match = /^(?:file|link):\.\.\/([^/]+)\/?$/u.exec(String(spec));
        if (match !== null) local.add(match[1] as string);
      }
    }
    for (const file of list) {
      if (!SCANNED.test(file)) continue;
      const full = join(root, file);
      if (!existsSync(full)) continue;
      for (const target of relativeTargets(file, readFileSync(full, "utf8"))) {
        const other = packageOf(target);
        if (other === name) continue;
        if (inScope(target)) shared = true;
        else if (other !== undefined) local.add(other);
      }
    }
    for (const other of local) if (sharedPackages.has(other)) shared = true;
    reachesShared.set(name, shared);
    edges.set(name, local);
  }
  const visit = (name: string, seen: Set<string>): boolean => {
    if (reachesShared.get(name) === true) return true;
    if (seen.has(name) || !edges.has(name)) return false;
    seen.add(name);
    return [...(edges.get(name) ?? [])].some((other) => visit(other, seen));
  };
  const selected: GatedPackage[] = [];
  for (const name of [...edges.keys()].sort()) {
    if (!visit(name, new Set())) continue;
    if (typeof manifests.get(name)?.scripts?.ci === "string") selected.push({ name });
    else if (GATE_COMMANDS[name] !== undefined) selected.push({ name, command: GATE_COMMANDS[name] });
    else options.warn?.(`private-gate-packages: packages/${name} depends on shared code but has no ci script or gate command, so the merge-back gate does not run it`);
  }
  return selected;
}

if (import.meta.main) {
  const index = process.argv.indexOf("--root");
  const root = resolve(index >= 0 ? (process.argv[index + 1] ?? ".") : dirname(dirname(import.meta.dir)));
  for (const entry of privateGatePackages(root, { warn: (line) => console.error(line) })) console.log(entry.command === undefined ? entry.name : `${entry.name}\t${entry.command}`);
}
