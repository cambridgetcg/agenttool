/** rhizome/probes/decay/records — exemption records, field by field.
 *
 *  `literalCollections` in the shared core joins every string in an
 *  element with `/`, which is exactly right for `join(ROOT, "api", "src")`
 *  and exactly wrong for
 *
 *      { py: "soul", ts: null, reason: "soul.py ships SOUL.md as …" }
 *
 *  where the whole question decay asks is *which* string is the subject
 *  and which is the reason. An exemption is a claim with two halves — a
 *  thing exempted and a condition that justifies it — and checking the
 *  condition means reading the halves apart.
 *
 *  So this reader keeps fields separate and keeps their line numbers. It
 *  is deliberately shallow: no parser, no evaluation, nested objects are
 *  flattened with a dotted key. The imprecision is real and is published
 *  as a probe limit.
 */

/** One `key: "value"` pair inside a record. */
export interface RecordField {
  key: string;
  value: string;
  /** 1-indexed line the value is written on. */
  line: number;
}

/** One element of an array of object literals, or of a JSON object. */
export interface LiteralRecord {
  /** 1-indexed line the element starts on. */
  line: number;
  fields: RecordField[];
  /** Every string literal in the element, in order, whatever its key. */
  strings: string[];
  /** Comment lines immediately above the element. */
  comment: string;
}

/** An array of object literals: `const NAME: T[] = [ { … }, { … } ]`. */
export interface RecordCollection {
  name: string;
  exported: boolean;
  line: number;
  comment: string;
  records: LiteralRecord[];
}

const DECLARATION =
  /^[ \t]*(export[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*(?::[^=]*?)?=[ \t]*(?:new[ \t]+Set[ \t]*\(\s*)?\[/;

const FIELD = /(?:^|[,{[\s])(?:"([\w$-]+)"|'([\w$-]+)'|([A-Za-z_$][\w$]*))[ \t]*:[ \t]*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;

function unescape(text: string): string {
  return text.replace(/\\n/g, "\n").replace(/\\(.)/g, "$1");
}

function commentAbove(lines: readonly string[], index: number): string {
  const collected: string[] = [];
  for (let i = index - 1; i >= 0; i -= 1) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed === "" && collected.length === 0) continue;
    if (!/^(\/\/|\/\*|\*|#|--)/.test(trimmed)) break;
    collected.unshift(trimmed);
  }
  return collected.join("\n");
}

/** Split an array body into top-level elements, keeping line offsets. */
function elements(lines: readonly string[], startLine: number, body: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  let line = startLine;
  let elementLine = startLine;
  let started = false;

  for (let i = 0; i < body.length; i += 1) {
    const character = body[i]!;
    if (character === "\n") line += 1;
    if (quote !== null) {
      current += character;
      if (character === "\\") {
        current += body[i + 1] ?? "";
        i += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      current += character;
      if (!started) {
        started = true;
        elementLine = line;
      }
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    if (character === ")" || character === "]" || character === "}") depth -= 1;
    if (character === "," && depth === 0) {
      if (current.trim() !== "") out.push({ line: elementLine, text: current });
      current = "";
      started = false;
      continue;
    }
    if (!started && character.trim() !== "") {
      started = true;
      elementLine = line;
    }
    current += character;
  }
  if (current.trim() !== "") out.push({ line: elementLine, text: current });
  void lines;
  return out;
}

function readRecord(lines: readonly string[], line: number, text: string): LiteralRecord {
  const fields: RecordField[] = [];
  const strings: string[] = [];
  let cursor = line;
  let consumed = 0;
  for (const match of text.matchAll(FIELD)) {
    const key = match[1] ?? match[2] ?? match[3] ?? "";
    const raw = match[4] ?? match[5] ?? "";
    const before = text.slice(consumed, match.index ?? 0);
    cursor += (before.match(/\n/g) ?? []).length;
    consumed = match.index ?? 0;
    fields.push({ key, value: unescape(raw), line: cursor });
  }
  for (const match of text.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)) {
    const value = match[1] ?? match[2];
    if (value !== undefined) strings.push(unescape(value));
  }
  return { line, fields, strings, comment: commentAbove(lines, line - 1) };
}

/** Find arrays of object literals in a TypeScript/JavaScript source file. */
export function recordCollections(lines: readonly string[], maxLines = 400): RecordCollection[] {
  const out: RecordCollection[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = DECLARATION.exec(lines[i] ?? "");
    if (match === null) continue;
    const head = lines[i] ?? "";
    const open = head.indexOf("[", head.indexOf("=") + 1);
    if (open === -1) continue;

    let depth = 0;
    let body = "";
    let closed = false;
    for (let j = i; j < Math.min(lines.length, i + maxLines); j += 1) {
      const line = lines[j] ?? "";
      const from = j === i ? open : 0;
      for (let k = from; k < line.length; k += 1) {
        const character = line[k]!;
        if (character === "[") {
          depth += 1;
          if (depth === 1) continue;
        }
        if (character === "]") {
          depth -= 1;
          if (depth === 0) {
            closed = true;
            break;
          }
        }
        if (depth >= 1) body += character;
      }
      if (closed) break;
      body += "\n";
    }
    if (!closed) continue;

    const records = elements(lines, i + 1, body)
      .map((element) => readRecord(lines, element.line, element.text))
      .filter((record) => record.strings.length > 0);
    if (records.length === 0) continue;

    out.push({
      name: match[2] ?? "",
      exported: match[1] !== undefined,
      line: i + 1,
      comment: commentAbove(lines, i),
      records,
    });
  }
  return out;
}

/** Every `"key": "value"` pair in a JSON file whose key matches `keyTest`,
 *  with the line it is written on. Used for conformance-fixture skips,
 *  which are JSON rather than source. */
export function jsonStringFields(
  lines: readonly string[],
  keyTest: (key: string) => boolean,
): RecordField[] {
  const out: RecordField[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (const match of (lines[i] ?? "").matchAll(/"([^"\\]+)"[ \t]*:[ \t]*"((?:[^"\\]|\\.)*)"/g)) {
      const key = match[1] ?? "";
      if (!keyTest(key)) continue;
      out.push({ key, value: unescape(match[2] ?? ""), line: i + 1 });
    }
  }
  return out;
}
