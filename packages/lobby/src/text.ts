/** Text hygiene shared by room cards, the pin book and the egress gate.
 *
 * Stored text must render on a terminal exactly as written: no controls, no
 * bidirectional overrides, no format characters, no default-ignorable code
 * points (zero-width characters, joiners, the soft hyphen, variation
 * selectors, tag characters, Hangul fillers) and no lone surrogates.
 * Matching (device pin, egress) runs over an NFKC-folded copy with the same
 * invisible characters removed, so "Bet\u200bfair", "Bet\ufe0ffair" or
 * full-width letters do not slip by.
 */
import { LobbyError } from "./errors.js";

// C0 controls (tab and newline handled by the caller), DEL, C1 controls,
// line/paragraph separators, then every format character (Cf: bidi controls,
// zero-width characters, the BOM, interlinear annotation marks) and every
// default-ignorable code point (variation selectors, tag characters, the
// combining grapheme joiner, Hangul fillers). The last two classes render as
// nothing, so they would let a card or petname look like different text.
const UNSAFE_SINGLE_LINE =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const UNSAFE_MULTI_LINE =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
/** Removed before matching: everything that renders as nothing. */
const INVISIBLE_FOR_MATCH = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/** Characters that must never reach the terminal inside "exact bytes". */
export const TERMINAL_UNSAFE =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

export function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

export interface TextRule {
  field: string;
  min: number;
  max: number;
  multiline?: boolean;
}

/** Validate one free-text field; returns the value unchanged when it passes. */
export function checkText(value: unknown, rule: TextRule): string {
  if (typeof value !== "string") {
    throw new LobbyError(`invalid_${rule.field}`, `${rule.field} must be a string`);
  }
  if (LONE_SURROGATE.test(value)) {
    throw new LobbyError(`invalid_${rule.field}`, `${rule.field} is not well-formed Unicode`);
  }
  const unsafe = rule.multiline ? UNSAFE_MULTI_LINE : UNSAFE_SINGLE_LINE;
  if (unsafe.test(value)) {
    throw new LobbyError(
      `invalid_${rule.field}`,
      `${rule.field} contains control, bidirectional or invisible characters`,
    );
  }
  if (rule.min > 0 && value.trim().length === 0) {
    throw new LobbyError(`invalid_${rule.field}`, `${rule.field} must not be blank`);
  }
  const length = codePointLength(value);
  if (length < rule.min || length > rule.max) {
    throw new LobbyError(
      `invalid_${rule.field}`,
      `${rule.field} must be ${rule.min}-${rule.max} characters`,
    );
  }
  return value;
}

/** NFKC fold with invisible characters removed: the text as a reader sees it.
 * Case is kept for matchers that need it. */
export function visibleForm(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE_FOR_MATCH, "");
}

/** NFKC fold, invisible characters removed, lower-cased: input for matchers. */
export function foldForMatch(text: string): string {
  return visibleForm(text).toLowerCase();
}

// "betfair", "betangel" and separator variants such as "Bet Angel" or "bet-fair".
const DEVICE_ONLY_TERM = /bet[\s._-]{0,3}(?:fair|angel)/u;

/** True when text names the work that must never leave this device. */
export function mentionsDeviceOnlyTerm(text: string): boolean {
  return DEVICE_ONLY_TERM.test(foldForMatch(text));
}
