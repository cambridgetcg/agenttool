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

// Lookalikes of the characters in the reserved prefix (T10). startsReserved folds them to the ASCII character they
// imitate before it compares. These lists are finite: every \p{Dash} code point, plus the single-code-point entries of
// the Unicode UTS #39 confusables table (confusables.txt 18.0.0) whose prototype is '-', ':' or one of the letters h u b
// o s e r v d and that NFKC leaves alone (NFKC has already turned the rest into these, or into ASCII). A lookalike
// outside them, one added to Unicode later, and an ASCII one (0 for o, 5 for s) still pass.
const DASHES = /\p{Dash}/gu
// U+FE30 is a colon drawn sideways, but NFKC turns it into two full stops, so it is mapped before NFKC runs.
const VERTICAL_TWO_DOTS = /\uFE30/g
const LOOKALIKES: ReadonlyArray<readonly [string, string]> = [
  ['-', '\u02D7\u06D4\u174D\u1BF3\u2043\u2796\u2CBA\u2CBB\uAA7D\u{10191}'],
  [':',
    '\u02D0\u02F8\u0589\u05C3\u0703\u0704\u0831\u0903\u0A83\u1361\u1393\u16EC\u1803\u1809\u205A\u2236' +
    '\uA4FD\uA789\u{1015B}\u{10AF5}\u{11002}\u{11082}\u{11182}\u{1123A}\u{115BE}\u{116AC}\u{11838}' +
    '\u{11DD9}\u{1D108}'],
  ['b',
    '\u0184\u0392\u0412\u042C\u07D5\u13CF\u13F4\u1472\u15AF\u15F7\u2C82\uA4D0\uA557\uA7B4\u{10282}' +
    '\u{102A1}\u{10301}\u{1031C}\u{16EB6}\u{1D207}'],
  ['d', '\u0501\u13A0\u13E7\u146F\u15DE\u15EA\uA4D2\uA4D3\u{1018B}'],
  ['e',
    '\u0395\u0415\u0435\u04BD\u13AC\u212E\u22FF\u2D39\uA4F0\uA5CB\uAB32\u{10286}\u{118A6}\u{118AE}' +
    '\u{1DF81}'],
  ['h', '\u0397\u041D\u04BA\u04BB\u0570\u10B9\u13BB\u13C2\u157C\u2C8E\uA4E7\u{102CF}'],
  ['o',
    '\u039F\u03BF\u03C3\u03ED\u041E\u043E\u0555\u0585\u05E1\u0647\u0665\u06BE\u06C1\u06D5\u06F5\u07C0' +
    '\u07CB\u0840\u0966\u09E6\u0A66\u0AE6\u0B20\u0B66\u0BE6\u0C02\u0C66\u0C82\u0CE6\u0D02\u0D20\u0D66' +
    '\u0D82\u0E50\u0ED0\u101D\u1040\u10FF\u110B\u11BC\u12D0\u17E0\u1A45\u1A80\u1A90\u1BEA\u1C82\u1CBF' +
    '\u1D0F\u1D11\u2C9E\u2C9F\u2D54\u3007\uA4F3\uAB3D\u{10292}\u{102AB}\u{1030F}\u{10404}\u{1042C}' +
    '\u{104C2}\u{104EA}\u{10516}\u{1092C}\u{10C17}\u{10D07}\u{11124}\u{11302}\u{114D0}\u{118B5}\u{118C8}' +
    '\u{118D7}\u{118E0}\u{11DE0}\u{16AE9}\u{1E140}\u{1E2F0}'],
  ['r',
    '\u01A6\u024C\u0433\u13A1\u13D2\u1587\u1D26\u2C85\uA4E3\uAB47\uAB48\uAB81\u{104B4}\u{16A19}\u{16F35}' +
    '\u{1D216}'],
  ['s',
    '\u01BD\u0405\u0455\u054F\u0D1F\u10BD\u10FD\u13D5\u13DA\u1CBD\uA4E2\uA576\uA731\uABAA\u{10296}' +
    '\u{10420}\u{10448}\u{118C1}\u{16AD6}\u{16F3A}'],
  ['u',
    '\u028B\u03C5\u054D\u057D\u1200\u144C\u1D1C\u222A\u22C3\uA4F4\uA79F\uAB4E\uAB52\u{104CE}\u{104F6}' +
    '\u{118B8}\u{118D8}\u{16F42}'],
  ['v',
    '\u03BD\u0474\u0475\u05D8\u0667\u06F7\u13D9\u142F\u1D20\u2228\u22C1\u2D38\uA4E6\uA6DF\uABA9\u{1051D}' +
    '\u{10C1F}\u{11706}\u{118A0}\u{118C0}\u{16F08}\u{1CEFC}\u{1D20D}\u{1E145}'],
]
const FOLD = new Map<number, string>()
for (const [ascii, chars] of LOOKALIKES) for (const ch of chars) FOLD.set(ch.codePointAt(0)!, ascii)
// How far into the text a lookalike can matter. The prefix is 13 characters and the fold keeps one code point for one,
// so the first few dozen units decide; the rest of a long body is not folded.
const LOOKALIKE_WINDOW = 64

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

function foldLookalikes(s: string): string {
  let out = ''
  for (const ch of s.replace(DASHES, '-')) out += FOLD.get(ch.codePointAt(0)!) ?? ch
  return out
}

/**
 * Whether seat text would read as a hub stamp (§7.6): after N2, ignoring case and leading space. It also folds with
 * NFKC and ignores default-ignorable code points, so `hub\u200B-observed:`, a soft hyphen, the long s or a fullwidth
 * spelling cannot pass for the stamp either (T10). Then, on the first 64 units only, it maps dashes, colons and the
 * letters of the prefix that other scripts also draw to their ASCII look (a hyphen or minus sign, Cyrillic o, a
 * modifier-letter colon), before lower-casing so Cyrillic and Greek capitals fold too. The lookalike lists are finite
 * (see LOOKALIKES); this refuses a few more strings than NFC alone would.
 */
export function startsReserved(s: string): boolean {
  const head = normalizeText(s).replace(VERTICAL_TWO_DOTS, ':').normalize('NFKC').replace(IGNORABLE, '').trimStart().slice(0, LOOKALIKE_WINDOW)
  return foldLookalikes(head).toLowerCase().startsWith(RESERVED_PREFIX)
}
