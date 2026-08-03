/** rhizome/probes/pretend/guards — finding the guards, without a list of them.
 *
 *  A guard, here, is a file that decides pass/fail about code other than
 *  itself: a scanner that reads `src/`, a suite driven by a shared fixture,
 *  a parity script. The tempting way to enumerate them is to type their
 *  paths, which is the pathology this package exists to name — so nothing
 *  in this module names a file. Everything below is read out of `Scope`.
 *
 *  Three derivations, in increasing specificity:
 *
 *    guardsIn()          files that read the tree or a fixture and assert
 *    literalPatterns()   pattern constants a guard defines, with their
 *                        source text, so the probe can run the guard's own
 *                        detector rather than a paraphrase of it
 *    caseCollections()   the collections a guard turns into cases, whether
 *                        they live in the guard or in a shared fixture
 */

import { literalCollections, stringLiterals } from "../../source.js";
import type { Scope } from "../../types.js";

/** Textual signature of a file that reads other files at run time.
 *
 *  The promise spellings are here because leaving them out cost a guard: an
 *  earlier version listed only `readFileSync`/`readdirSync`, and
 *  `packages/sdk-ts/scripts/check-parity.ts` — which imports `readdir` and
 *  `readFile` from `node:fs/promises` — was not a guard at all. A probe for
 *  enumerations with an edge they cannot see does not get to keep one. */
const READS_THE_TREE =
  /readFileSync|readdirSync|\breadFile\s*\(|\breaddir\s*\(|read_text\(|open\(|json\.load|createProgram|ast\.parse|os\.walk|Bun\.Glob|new Glob\b/;

/** Textual signature of a file that decides pass/fail. */
const ASSERTS =
  /\bexpect\s*\(|\bassert\b|process\.exit\s*\(\s*1|sys\.exit\s*\(\s*1|throw new Error/;

/** Source with `/* *\/`, `//`, `#` and `"""` comment bodies removed.
 *
 *  Blank lines are kept so line numbers still resolve. */
export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/"""[\s\S]*?"""/g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\w])\/\/[^\n]*/g, "$1")
    .replace(/^[ \t]*#[^\n]*/gm, "");
}

/** Source with its string and regex literals blanked.
 *
 *  A file that greps FOR `readFileSync` is not a file that calls it — the
 *  same distinction `probes/edge.ts` had to make between a marker a file
 *  searches for and a token it merely contains. Without this, every scanner
 *  detector (including the ones in this module) reads as a scanner. */
export function codeOnly(text: string): string {
  return text
    .replace(/\/(?:\\.|\[[^\]\n]*\]|[^/\\\n])+\/[dgimsuvy]*/g, " ")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, " ");
}

export interface Guard {
  file: string;
  /** Files and directories in the corpus this guard reads, derived from the
   *  path literals in its own source. */
  surface: readonly string[];
  /** `.ts` / `.py` / … of the guard itself. */
  extension: string;
}

function extensionOf(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

/** Resolve `a/b/../c` style relative segments against a starting directory. */
function resolveRelative(from: string, parts: readonly string[]): string | null {
  const stack = from === "" ? [] : from.split("/");
  for (const part of parts) {
    for (const segment of part.split("/")) {
      if (segment === "" || segment === ".") continue;
      if (segment === "..") {
        if (stack.length === 0) return null;
        stack.pop();
        continue;
      }
      stack.push(segment);
    }
  }
  return stack.join("/");
}

/** Every corpus path a file's own string literals point at.
 *
 *  Derived twice and unioned, because the two spellings fail differently: a
 *  literal that already reads as a repo-relative path, and a relative walk
 *  resolved against the file's own directory (`../../../docs/specs/x.json`,
 *  which is how every cross-language fixture in this tree is addressed). */
export function readSurface(scope: Scope, file: string): string[] {
  const raw = scope.read(file);
  if (raw === null) return [];
  // Comments first. Every loader in this tree explains itself in a header
  // that contains apostrophes, and an apostrophe opens a string literal for
  // any reader that does not know it is prose — which silently swallows the
  // path literal fifty lines below it.
  const text = stripComments(raw);
  const directory = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
  const found = new Set<string>();

  const consider = (candidate: string | null): void => {
    if (candidate === null || candidate === "") return;
    if (scope.files.includes(candidate) || scope.directories.has(candidate)) found.add(candidate);
  };

  for (const literal of stringLiterals(text)) {
    if (literal.length < 3 || literal.includes(" ") || literal.startsWith("http")) continue;
    consider(literal.replace(/^\.\//, ""));
    if (literal.startsWith(".") || !literal.startsWith("/")) consider(resolveRelative(directory, [literal]));
  }

  // `join(__dirname, "..", "..", "..")` and `Path(__file__).parents[3] /
  // "docs" / "specs"` are the same idea spelled two ways, and they differ in
  // where they start from: the first walks up from the file, the second names
  // the root outright. Both come out of the literal list in order, so each run
  // of consecutive literals is resolved from BOTH origins and whichever lands
  // on a real corpus path is kept. Guessing one origin would have made every
  // Python fixture loader in this tree read as loading nothing.
  const literals = stringLiterals(text);
  for (let i = 0; i < literals.length; i += 1) {
    for (let n = 2; n <= 8 && i + n <= literals.length; n += 1) {
      const run = literals.slice(i, i + n);
      if (run.some((part) => part.includes(" ") || part.length > 60)) break;
      consider(resolveRelative(directory, run));
      consider(resolveRelative("", run));
    }
  }
  return [...found].sort();
}

/** Corpus files the repository's own ignore rules call build output.
 *
 *  A committed bundle is not a guard, and its vendored contents produce
 *  findings about code nobody in this repository wrote. The set is derived
 *  rather than typed: `Scope` already explains every path that version
 *  control tracks and the ignore-honouring walk refuses, and "tracked
 *  despite matching an ignore rule" is precisely a checked-in artefact. If
 *  the repository stops ignoring `dist/`, this set empties itself. */
export function generatedFiles(scope: Scope): Set<string> {
  const out = new Set<string>();
  for (const disagreement of scope.disagreements) {
    if (disagreement.reading.startsWith("tracked despite matching an ignore rule")) out.add(disagreement.file);
  }
  return out;
}

/** Files that read the tree (or a fixture) and assert something about it. */
export function guardsIn(scope: Scope): Guard[] {
  const out: Guard[] = [];
  const generated = generatedFiles(scope);
  for (const file of scope.files) {
    if (generated.has(file)) continue;
    const text = scope.read(file);
    if (text === null) continue;
    const code = codeOnly(text);
    if (!READS_THE_TREE.test(code) || !ASSERTS.test(code)) continue;
    const surface = readSurface(scope, file).filter((path) => path !== file);
    if (surface.length === 0) continue;
    out.push({ file, surface, extension: extensionOf(file) });
  }
  return out;
}

/** A pattern constant a guard defines, with the text of the pattern itself. */
export interface LiteralPattern {
  name: string;
  line: number;
  /** Regular-expression source, as written. */
  source: string;
  /** Flags, translated to the JavaScript spelling where possible. */
  flags: string;
  /** `ts` for a `/…/` literal, `py` for `re.compile(…)`. */
  dialect: "ts" | "py";
}

/** Read the regular expressions a file declares as named constants.
 *
 *  Reading the guard's OWN pattern is the point: a probe that re-implemented
 *  "what the guard probably matches" would be measuring its own paraphrase.
 *  The pattern is only ever compiled and run against short synthetic strings
 *  this package writes — never against repository text — so a pathological
 *  pattern costs a caught exception rather than a hung run. */
export function literalPatterns(lines: readonly string[]): LiteralPattern[] {
  const out: LiteralPattern[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    // TypeScript: `const NAME = /…/flags;`, possibly on the next line.
    const tsHead = /^[ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+([A-Z][A-Z0-9_]{2,})[ \t]*(?::[^=]*)?=[ \t]*(.*)$/.exec(line);
    if (tsHead !== null) {
      let tail = tsHead[2] ?? "";
      let cursor = i;
      while (tail.trim() === "" && cursor + 1 < lines.length && cursor - i < 3) {
        cursor += 1;
        tail = (lines[cursor] ?? "").trim();
      }
      const literal = readRegexLiteral(tail);
      if (literal !== null) {
        out.push({ name: tsHead[1]!, line: i + 1, source: literal.source, flags: literal.flags, dialect: "ts" });
        continue;
      }
    }

    // Python: `NAME = re.compile(r"…" r"…", re.M)`, usually across lines.
    const pyHead = /^[ \t]*([A-Z][A-Z0-9_]{2,})[ \t]*=[ \t]*re\.compile\(/.exec(line);
    if (pyHead !== null) {
      let body = "";
      let depth = 0;
      for (let j = i; j < Math.min(lines.length, i + 40); j += 1) {
        const text = lines[j] ?? "";
        const from = j === i ? text.indexOf("re.compile(") + "re.compile".length : 0;
        let closed = false;
        for (let k = from; k < text.length; k += 1) {
          const char = text[k]!;
          if (char === "(") depth += 1;
          else if (char === ")") {
            depth -= 1;
            if (depth === 0) {
              closed = true;
              break;
            }
          }
          if (depth >= 1) body += char;
        }
        if (closed) break;
        body += "\n";
      }
      // Raw-aware: `stringLiterals` unescapes, and unescaping a regular
      // expression turns `\b` into `b` and `\.` into `.`, which silently
      // rewrites the very pattern this probe exists to run.
      const source = rawStringLiterals(body).join("");
      if (source !== "") {
        const flags = /re\.(?:M|MULTILINE)/.test(body) ? "m" : "";
        out.push({ name: pyHead[1]!, line: i + 1, source, flags: flags + (/re\.(?:S|DOTALL)/.test(body) ? "s" : ""), dialect: "py" });
      }
    }
  }
  return out;
}

/** String literals with their backslashes intact.
 *
 *  `source.ts`'s reader unescapes, which is right for a path list and wrong
 *  for a regular expression: `r"\b_path_segment\b"` unescaped is
 *  `b_path_segmentb`, and a probe measuring that pattern would be measuring
 *  a pattern nobody wrote. */
export function rawStringLiterals(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)) {
    const value = match[1] ?? match[2];
    if (value !== undefined) out.push(value);
  }
  return out;
}

/** Read a `/pattern/flags` literal from the start of `text`. */
function readRegexLiteral(text: string): { source: string; flags: string } | null {
  if (!text.startsWith("/") || text.startsWith("//")) return null;
  let index = 1;
  let inClass = false;
  let source = "";
  while (index < text.length) {
    const char = text[index]!;
    if (char === "\\") {
      source += char + (text[index + 1] ?? "");
      index += 2;
      continue;
    }
    if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) {
      const flags = /^[dgimsuvy]*/.exec(text.slice(index + 1))?.[0] ?? "";
      return { source, flags };
    }
    source += char;
    index += 1;
  }
  return null;
}

/** A collection a guard turns into test cases. */
export interface CaseCollection {
  /** Where the collection lives: the guard itself, or a shared fixture. */
  home: string;
  /** `NAME` for an in-file table, `key` for a fixture array. */
  name: string;
  line: number;
  size: number;
  kind: "in-file table" | "shared fixture";
}

/** Collections in a guard's own source that are iterated into cases.
 *
 *  The bar is deliberately not "an array a test mentions". Every test file
 *  in this repository holds arrays of expected values, and reporting each of
 *  them would be the volume-as-severity this package refuses. The shape that
 *  matters is narrower: a collection whose iteration DECLARES the cases, so
 *  the collection's length is the number of assertions the suite makes and
 *  shortening it shortens the suite rather than failing it. */
const DECLARES_CASES = /\btest(?:\.each)?\s*\(|\bit\s*\(|\bdescribe\s*\(|parametrize/;

export function inFileTables(scope: Scope, guard: Guard): CaseCollection[] {
  const lines = scope.lines(guard.file);
  const out: CaseCollection[] = [];
  for (const collection of literalCollections(lines, 400)) {
    if (collection.entries.length < 5) continue;
    const loop = new RegExp(`(?:for\\s*\\(?[^)\\n]*\\b(?:of|in)\\s+${collection.name}\\b|\\.each\\(\\s*${collection.name}\\b|parametrize\\([^)]*${collection.name}\\b)`);
    let declares = false;
    for (let i = 0; i < lines.length && !declares; i += 1) {
      if (!loop.test(lines[i] ?? "")) continue;
      declares = lines.slice(i, i + 8).some((line) => DECLARES_CASES.test(line));
    }
    if (!declares) continue;
    out.push({
      home: guard.file,
      name: collection.name,
      line: collection.line,
      size: collection.entries.length,
      kind: "in-file table",
    });
  }
  return out;
}

/** Top-level arrays of a JSON fixture, as case collections. */
export function fixtureArrays(scope: Scope, fixture: string): CaseCollection[] {
  const text = scope.read(fixture);
  if (text === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const lines = scope.lines(fixture);
  const out: CaseCollection[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(value) || value.length < 5) continue;
    let line = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if ((lines[i] ?? "").includes(`"${key}"`)) {
        line = i + 1;
        break;
      }
    }
    out.push({ home: fixture, name: key, line, size: value.length, kind: "shared fixture" });
  }
  return out;
}
