// The hub's two text normalisers (spec §6.4, R8, T10). Seat text reaches Collab only through them, so a label cannot
// carry bidi overrides, tag characters or invisible formatting into an actor line or a knock origin, and a body cannot
// hide text in tag characters. Both are pure: the same input always gives the same bytes, so a same-key replay
// rebuilds a byte-identical request and Collab returns its stored receipt (K24).

// N1 (labels): every control, format, private-use, unassigned, line and paragraph separator character, and VS17–VS256.
const N1_DROP = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}\u{E0100}-\u{E01EF}]/gu
// N2 (every other forwarded text field): tags, bidi embeddings, overrides and isolates, the Arabic letter mark, U+FEFF
// and VS17–VS256. ZWJ (U+200D) and ZWNJ (U+200C) stay, because emoji sequences and some scripts need them; newlines
// and tabs stay, because report bodies are multi-line.
const N2_DROP = /[\u{E0000}-\u{E007F}\u202A-\u202E\u2066-\u2069\u061C\uFEFF\u{E0100}-\u{E01EF}]/gu
const LEADING_VS = /^[\uFE00-\uFE0F]+/
const VS_RUN = /([\uFE00-\uFE0F])[\uFE00-\uFE0F]+/g
// Code points that render as nothing (zero-width spaces, soft hyphens, joiners, variation selectors…).
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu

export const RESERVED_PREFIX = 'hub-observed:'

/** At most one of U+FE00–FE0F after a base character, and none at the start. */
export function collapseVariationSelectors(s: string): string {
  return s.replace(LEADING_VS, '').replace(VS_RUN, '$1')
}

/**
 * N1. NFC, then the drops, then NFC again: a dropped character between a letter and its combining mark would otherwise
 * leave a sequence NFC would compose, so this order makes N1 idempotent (N1(N1(x)) === N1(x)).
 */
export function normalizeLabel(s: string): string {
  return collapseVariationSelectors(s.normalize('NFC').replace(N1_DROP, '').normalize('NFC'))
}

/** N2. No NFC here: body text is kept as written apart from the dropped characters. */
export function normalizeText(s: string): string {
  return collapseVariationSelectors(s.replace(N2_DROP, ''))
}

/** The first `max` UTF-16 units of `s`, one fewer when the cut would split a surrogate pair. */
export function cutUtf16(s: string, max: number): string {
  if (s.length <= max) return s
  let end = Math.max(0, max)
  const hi = s.charCodeAt(end - 1)
  const lo = s.charCodeAt(end)
  if (end > 0 && hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff) end -= 1
  return s.slice(0, end)
}

/**
 * Whether seat text would read as a hub stamp (§7.6): after N2, ignoring case and leading space. It also folds with
 * NFKC and ignores default-ignorable code points, so `hub\u200B-observed:`, a soft hyphen, the long s or a fullwidth
 * spelling cannot pass for the stamp either (T10); this refuses a few more strings than NFC alone would.
 */
export function startsReserved(s: string): boolean {
  return normalizeText(s).normalize('NFKC').replace(IGNORABLE, '').trimStart().toLowerCase().startsWith(RESERVED_PREFIX)
}
