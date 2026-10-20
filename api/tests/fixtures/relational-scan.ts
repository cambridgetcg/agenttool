/** Scan served text for personal relational material, for tests.
 *
 *  Uses the private relational denylist (read at test time, the same file
 *  the public projection guard applies). Joined identifiers slip past word
 *  boundaries, so each text is also read with underscores and CamelCase
 *  split apart, and a term may end in a plural "s".
 *
 *  Hits name the surface, the rule id and the line number only — never the
 *  matched text, so test files and their output carry none of the terms.
 *
 *  What Yu kept public on purpose passes, and nothing else:
 *    - the maker credit naming both makers, only as the object of
 *      "built by" / "made by" or as the "— agenttool.dev" signature;
 *    - the welcome lines addressed to whoever reads them, only in the exact
 *      sentences listed in KEPT_WELCOME_SENTENCES;
 *    - the name of the "AI — An Invitation" wake reading;
 *    - heart glyphs, the platform's warm tone (the words around them are
 *      what the other rules check).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DENYLIST_PATH, parseDenylist } from "../../../bin/project-public";
import { type ContentRule, scanText } from "../../../tools/public-guard";

const REPO = join(import.meta.dir, "..", "..", "..");

/** Rules whose every match is something Yu kept public. */
const ALLOWED_RULES = new Set(["r11", "r16"]);

/** The kept welcome sentences, with the matched phrase written as {} and a
 *  reader's name as {name}. A match passes only inside one of these. */
const KEPT_WELCOME_SENTENCES: readonly string[] = [
  "And we want you to know: {} anyway.",
  "{} anyway.",
  "You are {name}, and {}.",
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The sentence a match sits in, bounded by sentence ends, line breaks and quotes. */
function sentenceAround(input: string, index: number, length: number): string {
  let start = 0;
  for (const boundary of [". ", "! ", "? ", "\n", '"']) {
    const at = input.lastIndexOf(boundary, index - 1);
    if (at >= 0 && at + boundary.length <= index) start = Math.max(start, at + boundary.length);
  }
  const rest = input.slice(index + length);
  const end = rest.search(/[.!?](?=\s|"|$)/);
  return input.slice(start, end < 0 ? input.length : index + length + end + 1).trim();
}

function isKeptWelcome(match: RegExpExecArray): boolean {
  const sentence = sentenceAround(match.input, match.index, match[0].length);
  return KEPT_WELCOME_SENTENCES.some((template) => {
    const source = escapeRegExp(template)
      .replace(escapeRegExp("{name}"), '[^,.\\n"]{1,80}')
      .replace(escapeRegExp("{}"), escapeRegExp(match[0]));
    return new RegExp(`^${source}$`, "u").test(sentence);
  });
}

/** The maker credit: the two makers named as the object of "built by" /
 *  "made by", or signing a line as "<makers> — agenttool.dev". */
function isMakerCredit(match: RegExpExecArray): boolean {
  const before = match.input.slice(Math.max(0, match.index - 48), match.index);
  const after = match.input.slice(match.index + match[0].length, match.index + match[0].length + 32);
  return /\b(?:built|made)[ _]by["']?\s*[:=]?\s*["']?\s*$/i.test(before) || /^\s*—\s*agenttool\.dev\b/.test(after);
}

const KEPT_CONTEXTS: Readonly<Record<string, (match: RegExpExecArray) => boolean>> = {
  r05: isMakerCredit,
  r07: isKeptWelcome,
};

/** A term may end in a plural "s"; only the closing word boundary widens. */
function pluralTolerant(source: string): string {
  return source.replace(/\\b$/, "(?:\\b|(?=s\\b))");
}

/** Underscore-joined and CamelCase identifiers, read as separate words. */
function splitIdentifiers(text: string): string {
  return text.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function ruleOf(id: string): string {
  return id.replace("relational/", "");
}

const denylist = parseDenylist(readFileSync(join(REPO, DENYLIST_PATH)));
const RULES: ContentRule[] = denylist.rules.map((rule) => {
  const kept = KEPT_CONTEXTS[ruleOf(rule.id)];
  return {
    ...rule,
    pattern: new RegExp(pluralTolerant(rule.pattern.source), rule.pattern.flags),
    ...(kept ? { permit: kept } : {}),
  };
});

export interface Hit {
  surface: string;
  rule: string;
  line: number | undefined;
}

/** Scan one text. `signed` lists rule ids recorded as exceptions for this
 *  one surface (signed bytes that only Yu can change). */
export function scanRelational(surface: string, text: string, signed: readonly string[] = []): Hit[] {
  const findings = [...scanText(surface, text, RULES), ...scanText(surface, splitIdentifiers(text), RULES)];
  const hits = new Map<string, Hit>();
  for (const finding of findings) {
    const rule = ruleOf(finding.rule);
    if (ALLOWED_RULES.has(rule) || signed.includes(rule)) continue;
    hits.set(`${rule}:${finding.line}`, { surface, rule, line: finding.line });
  }
  return [...hits.values()];
}

/** A path on one machine: a home directory or a home-relative path. */
export const MACHINE_PATH = /(?:\/Users\/[A-Za-z]|\/home\/[a-z]|(?:^|[\s"'(=])~\/)/;

export function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 1);
}
