/** rhizome/probes/decay/reach — who actually calls this, and with what.
 *
 *  A quarantine list is only interesting once you know whether anything
 *  runs it. That question is usually answered by reading a CI file and
 *  believing it, which is how "the only gate CI runs skips them" survived
 *  four rounds of review: every reader checked that the quarantine mode
 *  *existed*, and none checked that it was *invoked*.
 *
 *  The check here is deliberately dumb and therefore hard to fool: a
 *  corpus file mentions another corpus file's path on some line, and the
 *  tokens after the path on that line are the arguments. No shell parsing,
 *  no build graph, no assumption about which directory holds CI. The one
 *  exclusion is prose — a `.md` that quotes a command is documenting it,
 *  not running it — and that exclusion is published as a probe limit
 *  rather than filtered in silence.
 *
 *  What it cannot see is stated plainly in the finding it produces: an
 *  argument held in a variable reads as the variable's name, and a caller
 *  outside the repository is outside the corpus. So the finding reports
 *  the invocation table verbatim and lets the reader judge, rather than
 *  claiming unreachability as a proof.
 */

import type { Scope } from "../../types.js";

/** Extensions whose mention of a command is documentation, not invocation.
 *  Stated here, published as a probe limit, and shared with `edge`'s own
 *  prose boundary — the same reasoning, the same answer. */
export const PROSE_EXTENSIONS: readonly string[] = [".md", ".mdx", ".txt", ".rst"];

export interface CallSite {
  file: string;
  /** 1-indexed. */
  line: number;
  /** The line, trimmed. */
  text: string;
  /** Tokens following the target path on this line. */
  args: string[];
}

/** A token that could be a mode/subcommand. Anything else ends the
 *  argument list: past the first non-argument the line has stopped being
 *  a command and started being a sentence, and reading further produced
 *  an "arguments passed" list containing the words "the", "own" and
 *  "discipline". */
const ARGUMENT = /^[A-Za-z-][\w.:/-]*$/;

/** Shell control words that follow a command without being its arguments.
 *  Syntax, not scope: an unknown keyword costs one noisy token in an
 *  evidence table the reader is being asked to read anyway. */
const SHELL_KEYWORD = new Set(["then", "else", "elif", "fi", "do", "done", "esac"]);

/** How many tokens after the path are read as arguments. */
const MAX_ARGUMENTS = 3;

function argumentsAfter(line: string, target: string): string[] {
  const at = line.indexOf(target);
  if (at === -1) return [];
  const out: string[] = [];
  for (const raw of line.slice(at + target.length).split(/[\s,]+/)) {
    const token = raw.replace(/^["'`([]+|["'`)\];]+$/g, "").trim();
    if (token === "") continue;
    if (!ARGUMENT.test(token)) break;
    if (SHELL_KEYWORD.has(token)) break;
    out.push(token);
    if (out.length >= MAX_ARGUMENTS) break;
  }
  return out;
}

/** Is this line a comment in one of the tree's languages? A runbook line
 *  inside a script documents an invocation; it does not perform one. */
function isComment(line: string): boolean {
  return /^\s*(#|\/\/|\*|\/\*|--|<!--)/.test(line);
}

/** Every non-prose corpus file, other than `target` itself, whose text
 *  names `target`'s repo-relative path — with the arguments that follow. */
export function callSites(scope: Scope, target: string): CallSite[] {
  const out: CallSite[] = [];
  for (const file of scope.filesContaining(target)) {
    if (file === target) continue;
    if (PROSE_EXTENSIONS.some((extension) => file.endsWith(extension))) continue;
    const lines = scope.lines(file);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (!line.includes(target)) continue;
      if (isComment(line)) continue;
      out.push({ file, line: i + 1, text: line.trim(), args: argumentsAfter(line, target) });
    }
  }
  return out;
}

/** Call sites that pass `token` as an argument to `target`. */
export function sitesPassing(sites: readonly CallSite[], token: string): CallSite[] {
  return sites.filter((site) => site.args.includes(token));
}

/** Every distinct argument any caller passes to `target`. */
export function argumentVocabulary(sites: readonly CallSite[]): string[] {
  const seen = new Set<string>();
  for (const site of sites) for (const arg of site.args) seen.add(arg);
  return [...seen].sort();
}
