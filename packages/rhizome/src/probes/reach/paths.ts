/** rhizome/probes/reach/paths — syntax facts about filenames.
 *
 *  Nothing here names a directory, a package or a route. These are
 *  language and tooling conventions — "a file called `x.test.ts` is a
 *  test", "a file under `dist/` is a build artefact" — and they are
 *  shared by the four halves of this probe so the four cannot drift into
 *  four different answers to "is this a test?".
 */

/** "Is this file a document?" has exactly one definition in this package,
 *  in `src/prose.ts`, and it is imported rather than copied. Three private
 *  copies of that list used to exist here and in two sibling probes, one
 *  of them strictly narrower than the others — the duplication-with-drift
 *  this package exists to report, inside the instrument. */
export { isProse, PROSE_EXTENSIONS } from "../../prose.js";

/** Extensions read as executable source. A client written in a language
 *  not listed here is invisible to this probe; that is declared as a
 *  limit in `reach.ts` rather than left implicit. */
export const CODE_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".py",
];

/** Interpreters that mean "the rest of this file is a language this probe
 *  reads", matched against the file's own first line.
 *
 *  This exists because the first integrated run reported `PATCH
 *  /v1/strands/:strandId/thoughts/:thoughtId/ciphertext` as having no
 *  client anywhere, and it has one: `bin/agenttool-rotate`, 18KB of
 *  TypeScript behind `#!/usr/bin/env bun` and no `.ts`. Reading
 *  "extension" as "language" is an enumeration with a boundary it cannot
 *  see from inside, in the probe whose job is to find those. */
export const SHEBANG_INTERPRETERS = /^#!.*\b(?:bun|node|deno|tsx|ts-node|python[\d.]*)\b/;

export function isTestPath(file: string): boolean {
  return (
    /(^|\/)(tests?|__tests__|e2e|examples?)\//.test(file) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) ||
    /(^|\/)test_[^/]+\.py$/.test(file) ||
    /_test\.py$/.test(file) ||
    /(^|\/)conftest\.py$/.test(file)
  );
}

export function extensionOf(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

/** A built artefact is a copy of source, not a caller of it. Counting
 *  `dist/index.js` as a reference makes every source symbol look
 *  reachable from its own build output. */
export function isGenerated(file: string): boolean {
  return /(^|\/)(dist|build|out|__pycache__|node_modules|\.venv|vendor)\//.test(file);
}

/** Directory of `file`, or `""`. */
export function dirOf(file: string): string {
  const at = file.lastIndexOf("/");
  return at === -1 ? "" : file.slice(0, at);
}

/** Normalise `a/b/../c` and `./` against a base directory. */
export function joinRelative(base: string, specifier: string): string {
  const parts = (base === "" ? [] : base.split("/")).concat(specifier.split("/"));
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}
