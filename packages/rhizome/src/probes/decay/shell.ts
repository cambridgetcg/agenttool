/** rhizome/probes/decay/shell — literal collections written in POSIX shell.
 *
 *  `src/source.ts` reads `NAME = [ … ]`, which covers TypeScript and most
 *  of the JSON in this tree. It does not cover `readonly NAME=( … )`, and
 *  the largest held-back inventory in this repository — the quarantine
 *  list every CI gate skips — is written in exactly that form, in a bash
 *  script.
 *
 *  A probe about accommodations that cannot read the file the biggest
 *  accommodation lives in would be a scope boundary hidden inside a
 *  language boundary: the same shape the `edge` probe hunts, one level
 *  down. So this reader exists, and it is deliberately kept in the decay
 *  probe's own directory rather than pushed into the shared core, because
 *  three sibling probes are being written against that core right now.
 *  The integrator's note in `notes` says where it belongs.
 *
 *  Entry-level line numbers are the reason this is not a two-line regex.
 *  "This inventory has 34 entries" is a summary; "this entry, at this
 *  line, under this reason" is a finding.
 */

/** One element of a shell array, with the place it is written down. */
export interface ShellEntry {
  /** The unquoted word. */
  value: string;
  /** 1-indexed line in the file. */
  line: number;
  /** The contiguous comment block immediately above this entry, if any.
   *  Empty when the entry sits directly under a previous entry, in which
   *  case the group's reason is whatever preceded the group. */
  comment: string;
}

/** A shell array literal: `readonly NAME=(\n  a\n  b\n)`. */
export interface ShellArray {
  name: string;
  /** `readonly` or `declare -r`: the shell's nearest thing to an export. */
  readonlyDeclared: boolean;
  /** 1-indexed line of the declaration. */
  line: number;
  /** Contiguous comment block immediately above the declaration. */
  comment: string;
  entries: ShellEntry[];
}

const DECLARATION = /^[ \t]*(?:(readonly|declare[ \t]+-[a-zA-Z]+|local|export)[ \t]+)?([A-Za-z_][\w]*)=\([ \t]*(.*)$/;

function commentAbove(lines: readonly string[], index: number): string {
  const collected: string[] = [];
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "") break;
    if (!line.trim().startsWith("#")) break;
    collected.unshift(line.trim().replace(/^#[ \t]?/, ""));
  }
  return collected.join("\n");
}

/** Split a shell word list on whitespace, honouring quotes. */
function words(text: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i]!;
    if (quote !== null) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#") break;
    if (/\s/.test(character)) {
      if (current !== "") out.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current !== "") out.push(current);
  return out;
}

/** Read every shell array literal in a file.
 *
 *  `maxLines` bounds a declaration body the same way `literalCollections`
 *  does, and for the same reason: a longer literal is skipped rather than
 *  half-read, and the bound is published as a probe limit rather than
 *  left implicit. */
export function shellArrays(lines: readonly string[], maxLines = 300): ShellArray[] {
  const out: ShellArray[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = DECLARATION.exec(lines[i] ?? "");
    if (match === null) continue;
    const keyword = match[1];
    const name = match[2] ?? "";
    const entries: ShellEntry[] = [];
    let closed = false;
    let pendingComment: string[] = [];

    // The declaration line may already carry entries and may already close.
    const first = match[3] ?? "";
    const firstClose = first.indexOf(")");
    for (const word of words(firstClose === -1 ? first : first.slice(0, firstClose))) {
      entries.push({ value: word, line: i + 1, comment: "" });
    }
    if (firstClose !== -1) closed = true;

    for (let j = i + 1; !closed && j < Math.min(lines.length, i + maxLines); j += 1) {
      const raw = lines[j] ?? "";
      const trimmed = raw.trim();
      if (trimmed === "") {
        pendingComment = [];
        continue;
      }
      if (trimmed.startsWith("#")) {
        pendingComment.push(trimmed.replace(/^#[ \t]?/, ""));
        continue;
      }
      const close = raw.indexOf(")");
      const payload = close === -1 ? raw : raw.slice(0, close);
      for (const word of words(payload)) {
        entries.push({ value: word, line: j + 1, comment: pendingComment.join("\n") });
        pendingComment = [];
      }
      if (close !== -1) {
        closed = true;
        break;
      }
    }
    if (!closed) continue;

    out.push({
      name,
      readonlyDeclared: keyword === "readonly" || (keyword ?? "").startsWith("declare"),
      line: i + 1,
      comment: commentAbove(lines, i),
      entries,
    });
  }
  return out;
}
