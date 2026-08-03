/** rhizome/source — small, dependency-free readers over source text.
 *
 *  Deliberately regex-and-bracket-counting rather than a parser. Adding
 *  the TypeScript compiler would buy precision on `.ts` and buy nothing on
 *  the `.py`, `.sql`, `.sh`, `.yml` and `.json` files that carry the same
 *  enumerations — and a probe that only understands one language is a
 *  probe with an unstated extension boundary, which is the thing being
 *  hunted. The imprecision is real and is declared as a probe limit.
 */

/** A literal collection found in source: `NAME = [ ... ]` or `new Set([...])`. */
export interface LiteralCollection {
  name: string;
  exported: boolean;
  /** 1-indexed line of the declaration. */
  line: number;
  /** Raw text between the brackets. */
  body: string;
  /** One entry per top-level comma-separated element; each entry is the
   *  string literals of that element joined with `/`, so
   *  `join(ROOT, "api", "src")` reads as `api/src`. */
  entries: string[];
  /** Contiguous comment lines immediately above the declaration. */
  comment: string;
}

const DECLARATION =
  /^[ \t]*(export[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*(?::[^=]*?)?=[ \t]*(new[ \t]+Set[ \t]*\(\s*)?\[/;

/** Comment prefixes across the languages in this tree. Not a scope: this
 *  is a syntax fact, and an unknown prefix costs a missed comment, not a
 *  missed file. */
const COMMENT_PREFIXES = ["//", "*", "/*", "#", "--"];

export function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return COMMENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/** Contiguous comment block immediately above `index` (0-indexed). */
export function commentAbove(lines: readonly string[], index: number): string {
  const collected: string[] = [];
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "" && collected.length === 0) continue;
    if (!isCommentLine(line)) break;
    collected.unshift(line.trim());
  }
  return collected.join("\n");
}

/** Every string literal in `text`, in order, unescaped only for `\"`. */
export function stringLiterals(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)) {
    const value = match[1] ?? match[2];
    if (value !== undefined) out.push(value.replace(/\\(.)/g, "$1"));
  }
  return out;
}

/** Split a bracket body on commas that are not nested or inside strings. */
function topLevelElements(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]!;
    if (quote !== null) {
      current += char;
      if (char === "\\") {
        current += body[i + 1] ?? "";
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth -= 1;
    if (char === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim() !== "") out.push(current);
  return out;
}

/** Find literal array/Set declarations in a source file.
 *
 *  `maxLines` bounds how far a declaration body may run; a longer literal
 *  is skipped rather than half-read, and the bound is declared as a probe
 *  limit rather than left implicit. */
export function literalCollections(lines: readonly string[], maxLines = 200): LiteralCollection[] {
  const out: LiteralCollection[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = DECLARATION.exec(lines[i] ?? "");
    if (match === null) continue;
    const open = (lines[i] ?? "").indexOf("[", (lines[i] ?? "").indexOf("=") + 1);
    if (open === -1) continue;

    let depth = 0;
    let body = "";
    let closed = false;
    for (let j = i; j < Math.min(lines.length, i + maxLines); j += 1) {
      const line = lines[j] ?? "";
      const from = j === i ? open : 0;
      for (let k = from; k < line.length; k += 1) {
        const char = line[k]!;
        if (char === "[") {
          depth += 1;
          if (depth === 1) continue;
        }
        if (char === "]") {
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
    if (!closed) continue;

    out.push({
      name: match[2] ?? "",
      exported: match[1] !== undefined,
      line: i + 1,
      body,
      entries: topLevelElements(body)
        .map((element) => stringLiterals(element).join("/"))
        .filter((entry) => entry !== ""),
      comment: commentAbove(lines, i),
    });
  }
  return out;
}

/** A `type X = "a" | "b"` union of string literals. */
export interface LiteralUnion {
  name: string;
  exported: boolean;
  line: number;
  members: string[];
}

/** Find string-literal type unions, joining continuation lines. */
export function literalUnions(lines: readonly string[], maxLines = 40): LiteralUnion[] {
  const out: LiteralUnion[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const head = /^[ \t]*(export[ \t]+)?type[ \t]+([A-Za-z_$][\w$]*)[^=]*=[ \t]*(.*)$/.exec(line);
    if (head === null) continue;
    let text = head[3] ?? "";
    let j = i;
    while (!text.includes(";") && j + 1 < Math.min(lines.length, i + maxLines)) {
      j += 1;
      text += ` ${(lines[j] ?? "").trim()}`;
    }
    const declaration = text.split(";")[0] ?? "";
    // Only pure unions of string literals: any other token disqualifies.
    if (!/^[\s|]*(?:"[^"]*"|'[^']*')(?:[\s]*\|[\s]*(?:"[^"]*"|'[^']*'))*[\s]*$/.test(declaration)) continue;
    const members = stringLiterals(declaration);
    if (members.length < 2) continue;
    out.push({ name: head[2] ?? "", exported: head[1] !== undefined, line: i + 1, members });
  }
  return out;
}

/** 1-indexed line of the first occurrence of `needle`, or 0. */
export function lineOf(lines: readonly string[], needle: string): number {
  for (let i = 0; i < lines.length; i += 1) {
    if ((lines[i] ?? "").includes(needle)) return i + 1;
  }
  return 0;
}

/** Trim a quotation to `max` characters on a word-ish boundary. */
export function clip(text: string, max = 400): string {
  const flat = text.replace(/\s+$/g, "");
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}
