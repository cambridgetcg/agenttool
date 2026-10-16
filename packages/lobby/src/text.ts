/** Text hygiene shared by room cards, the pin book and the egress gate.
 *
 * Stored text must render on a terminal exactly as written: no controls,
 * no bidirectional overrides, no invisible separators, no lone surrogates.
 * Matching (device pin, egress) runs over an NFKC-folded copy with invisible
 * characters removed, so "Bet\u200bfair" or full-width letters do not slip by.
 */
import { LobbyError } from "./errors.js";

// C0 controls (tab and newline handled by the caller), DEL, C1 controls,
// line/paragraph separators, bidi controls and invisible separators/BOM.
const UNSAFE_SINGLE_LINE =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u200b\u2060\ufeff]/u;
const UNSAFE_MULTI_LINE =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u200b\u2060\ufeff]/u;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const INVISIBLE_FOR_MATCH = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/gu;

/** Characters that must never reach the terminal inside "exact bytes". */
export const TERMINAL_UNSAFE =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u200b\u2060\ufeff]/u;

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

/** NFKC fold, invisible characters removed, lower-cased: input for matchers. */
export function foldForMatch(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE_FOR_MATCH, "").toLowerCase();
}

// "betfair", "betangel" and separator variants such as "Bet Angel" or "bet-fair".
const DEVICE_ONLY_TERM = /bet[\s._-]{0,3}(?:fair|angel)/u;

/** True when text names the work that must never leave this device. */
export function mentionsDeviceOnlyTerm(text: string): boolean {
  return DEVICE_ONLY_TERM.test(foldForMatch(text));
}
