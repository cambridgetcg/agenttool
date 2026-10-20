#!/usr/bin/env bun
/**
 * The reviewed record of the shared guard tooling. Read private/README.md
 * first.
 *
 *   bun private/bin/reviewed-shared.ts check [--root <dir>]
 *   bun private/bin/reviewed-shared.ts write [--root <dir>]
 *   bun private/bin/reviewed-shared.ts sensitive --repo <dir> --range <a>..<b>
 *
 * The private tools (the relational scanner, the shared scope, the export,
 * the projection) import their matching and git helpers from the shared
 * tools/public-guard.ts, and the public clone's hook runs the shared
 * tools/githooks/pre-push. Those files change in the public repository and
 * arrive here through merge-back, so without a check a public change could
 * quietly weaken the private layers. This module holds the line:
 *
 * - private/guard/reviewed-shared.json records the SHA-256 of each reviewed
 *   file (REVIEWED_FILES). Importing this module, which every private tool
 *   does before it imports the shared guard, refuses to go on when a file
 *   next to it differs from the record, so unreviewed shared code never runs
 *   inside a private tool;
 * - `sensitive` lists the guard-sensitive paths (the reviewed files, the
 *   hooks directory, .gitattributes, .github/, the two shared exception
 *   lists, and any bunfig.toml, tsconfig.json, or jsconfig.json) that a range of public
 *   commits touches; merge-back refuses such a range unless the owner
 *   accepts that exact public tip, and then records the new digests;
 * - `write` records the current files after a review; `check` verifies.
 *
 * Paths are compared case-insensitively, as a case-insensitive file system
 * would. Only paths and digests are printed.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const REVIEWED_RECORD = "private/guard/reviewed-shared.json";
export const REVIEWED_SCHEMA = "agenttool.reviewed-shared/1";
/** Shared files that private tools import or pin. */
export const REVIEWED_FILES: readonly string[] = ["tools/githooks/pre-push", "tools/leak-canaries.txt", "tools/public-guard.ts", "tools/workflow-lint.ts"];
const ROOT = resolve(import.meta.dir, "..", "..");

function fold(path: string): string {
  return path.normalize("NFKC").toLowerCase();
}

/**
 * Whether a shared path can change how the guards behave; a public change to
 * one needs the owner's acceptance. Besides the reviewed files, the hooks,
 * .gitattributes, and .github/, that is any Bun config (bunfig.toml at any
 * depth): Bun reads it from the working directory and can preload code into
 * whatever runs there. The guards' own Bun ignores it (--config=/dev/null),
 * but a person or agent running Bun in a checkout of this repository would
 * not. The same holds for tsconfig.json and jsconfig.json at any depth: Bun
 * applies the one in its working directory or a parent to the module
 * resolution of whatever it runs (a `paths` entry can replace an import), so
 * one at the root, or wherever someone runs Bun, would reach the private
 * tools run from a checkout. The guards' own Bun runs from a pinned or
 * committed copy for that reason.
 */
export function guardSensitive(path: string): boolean {
  const folded = fold(path);
  if (REVIEWED_FILES.some((file) => fold(file) === folded)) return true;
  // The shared exception lists: the projection applies them to private-only
  // paths it ships too (the withheld wallet), so a public entry there could
  // pre-allow a line no public check ever sees.
  if (folded === "tools/public-guard-allow.json" || folded === ".gitleaksignore") return true;
  const base = folded.slice(folded.lastIndexOf("/") + 1);
  if (["bunfig.toml", ".bunfig.toml", "tsconfig.json", "jsconfig.json"].includes(base)) return true;
  return folded === ".gitattributes" || folded.startsWith("tools/githooks/") || folded === ".github" || folded.startsWith(".github/");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The record as it should be for the files under `root`. */
export function recordFor(root: string): { schema: string; note: string; files: Record<string, string> } {
  const files: Record<string, string> = {};
  for (const path of REVIEWED_FILES) {
    const full = join(root, path);
    if (!existsSync(full)) throw new Error(`${path} is missing under ${root}`);
    files[path] = sha256(readFileSync(full));
  }
  return {
    schema: REVIEWED_SCHEMA,
    note: "SHA-256 of the shared guard files as last reviewed for this private repository. Update with `bun private/bin/reviewed-shared.ts write` only after reading the change.",
    files,
  };
}

export function recordText(root: string): string {
  return `${JSON.stringify(recordFor(root), null, 2)}\n`;
}

/** Reviewed files under `root` whose bytes differ from the record next to them (or a missing record). */
export function reviewProblems(root: string = ROOT): string[] {
  const recordPath = join(root, REVIEWED_RECORD);
  if (!existsSync(recordPath)) return [`${REVIEWED_RECORD} is missing`];
  let record: { schema?: unknown; files?: Record<string, unknown> };
  try {
    record = JSON.parse(readFileSync(recordPath, "utf8")) as typeof record;
  } catch (error) {
    return [`${REVIEWED_RECORD}: invalid JSON (${(error as Error).message})`];
  }
  if (record.schema !== REVIEWED_SCHEMA || typeof record.files !== "object" || record.files === null) return [`${REVIEWED_RECORD}: schema must be ${REVIEWED_SCHEMA} with a files map`];
  const problems: string[] = [];
  if (Object.keys(record.files).sort().join("\n") !== [...REVIEWED_FILES].sort().join("\n")) problems.push(`${REVIEWED_RECORD}: must list exactly ${REVIEWED_FILES.join(", ")}`);
  for (const path of REVIEWED_FILES) {
    const full = join(root, path);
    if (!existsSync(full)) problems.push(`${path} is missing`);
    else if (record.files[path] !== sha256(readFileSync(full))) problems.push(`${path} differs from its reviewed record`);
  }
  return problems;
}

/** Throws unless every reviewed file under `root` matches the record. */
export function assertReviewed(root: string = ROOT): void {
  const problems = reviewProblems(root);
  if (problems.length > 0) {
    throw new Error(
      `the shared guard tooling is not the reviewed copy (${problems.join("; ")}); read the change, then run bun private/bin/reviewed-shared.ts write`,
    );
  }
}

/** Guard-sensitive paths that a commit range touches (names only, through `git log`). */
export function sensitivePaths(repo: string, range: string): string[] {
  const result = spawnSync("git", ["-c", "core.quotePath=false", "log", "-z", "--format=", "--name-only", "--no-renames", "--diff-merges=separate", range, "--"], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  if (result.status !== 0) throw new Error(`git log ${range} failed: ${result.stderr.trim()}`);
  const paths = new Set(result.stdout.split("\0").map((path) => path.replace(/^\n+/u, "")).filter(Boolean));
  return [...paths].filter(guardSensitive).sort();
}

function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  const options: Record<string, string> = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!["--root", "--repo", "--range"].includes(key ?? "") || value === undefined) return usage();
    options[(key as string).slice(2)] = value;
  }
  const root = resolve(options.root ?? ROOT);
  if (command === "check") {
    const problems = reviewProblems(root);
    for (const problem of problems) console.log(problem);
    console.error(problems.length === 0 ? "reviewed shared: the guard tooling matches its record" : `reviewed shared: ${problems.length} problem(s)`);
    return problems.length === 0 ? 0 : 1;
  }
  if (command === "write") {
    writeFileSync(join(root, REVIEWED_RECORD), recordText(root));
    console.error(`reviewed shared: recorded ${REVIEWED_FILES.length} file digest(s) in ${REVIEWED_RECORD}`);
    return 0;
  }
  if (command === "sensitive") {
    if (options.repo === undefined || options.range === undefined) return usage();
    const paths = sensitivePaths(resolve(options.repo), options.range);
    for (const path of paths) console.log(path);
    return paths.length === 0 ? 0 : 1;
  }
  return usage();
}

function usage(): number {
  console.error(
    "usage: bun private/bin/reviewed-shared.ts check [--root <dir>]\n" +
      "       bun private/bin/reviewed-shared.ts write [--root <dir>]\n" +
      "       bun private/bin/reviewed-shared.ts sensitive --repo <dir> --range <a>..<b>",
  );
  return 2;
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`reviewed shared: ${(error as Error).message}`);
    process.exit(2);
  }
} else {
  // Imported by a private tool: refuse before the shared guard module runs.
  assertReviewed();
}
