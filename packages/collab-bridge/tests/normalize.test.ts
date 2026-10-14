import { describe, expect, test } from 'bun:test'
import {
  collapseVariationSelectors, cutUtf16, normalizeLabel, normalizeText, RESERVED_PREFIX, startsReserved,
} from '../src/air/normalize.ts'

const bytes = (s: string): string => Buffer.from(s, 'utf8').toString('hex')

describe('N1, labels', () => {
  test('N1 drops Cf, tag and bidi characters and VS17+ from labels', () => {
    // ZWSP, RLO, LRI, PDI and ZWJ are Cf; U+E0041 is a tag; U+E0100 is VS17; BEL is Cc; U+E000 is Co;
    // U+0378 is unassigned (Cn); U+2028 and U+2029 are Zl and Zp.
    const dirty = 'cl\u200Bau\u202Ede\u2066\u2069\u200D\u{E0041}\u{E0100}\u0007\uE000\u0378\u2028\u2029'
    expect(normalizeLabel(dirty)).toBe('claude')
    expect(normalizeLabel('Yu\u202E \u{E0067}\u{E0062}\u{E007F}(Nuance)')).toBe('Yu (Nuance)')
  })

  test('N1 keeps one variation selector after a base character', () => {
    expect(normalizeLabel('\u263A\uFE0F\uFE0F\uFE0E')).toBe('\u263A\uFE0F')
    expect(normalizeLabel('\uFE0Fa')).toBe('a')
    expect(normalizeLabel('a\uFE0Eb\uFE0F')).toBe('a\uFE0Eb\uFE0F')
    expect(normalizeLabel('a\uFE0F\u200B\uFE0F')).toBe('a\uFE0F')
  })

  test('N1 composes to NFC, also across a dropped character', () => {
    expect(normalizeLabel('e\u0301')).toBe('\u00E9')
    expect(normalizeLabel('e\u200B\u0301')).toBe('\u00E9')
  })
})

describe('N2, text', () => {
  test('N2 drops tags, bidi controls, U+061C and U+FEFF from text', () => {
    const dirty = 'a\u202Ab\u202Bc\u202Cd\u202De\u202Ef\u2066g\u2067h\u2068i\u2069j\u061Ck\uFEFFl\u{E0001}m\u{E007F}n\u{E0100}o'
    expect(normalizeText(dirty)).toBe('abcdefghijklmno')
  })

  test('N2 keeps newlines, tabs and the text as written', () => {
    expect(normalizeText('line one\nline two\tend')).toBe('line one\nline two\tend')
    expect(normalizeText('e\u0301')).toBe('e\u0301')
  })

  test('N2 keeps ZWJ emoji sequences and ZWNJ', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'
    const heart = '\u2764\uFE0F'
    const persian = '\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645'
    expect(normalizeText(family)).toBe(family)
    expect(normalizeText(heart)).toBe(heart)
    expect(normalizeText(persian)).toBe(persian)
    expect(normalizeText(`${family} ${heart}\uFE0F\uFE0F`)).toBe(`${family} ${heart}`)
  })
})

describe('both normalisers', () => {
  test('both are deterministic: their output is pinned to exact bytes, so a same-key replay in any later run rebuilds it', () => {
    const nasty = 'r\u202Ee\u{E0041}v\u200Bi\u{E0100}e\uFE0F\uFE0Fw\u2066e\u0301r\uFEFF \u{1F468}\u200D\u{1F469}'
    // N1: NFC composes e+U+0301 to U+00E9; drops RLO, tag A, ZWSP, VS17, LRI, BOM and ZWJ (Cf); collapses the VS run.
    expect(bytes(normalizeLabel(nasty))).toBe('7265766965efb88f77c3a97220f09f91a8f09f91a9')
    // N2: no NFC; drops RLO, tag A, VS17, LRI and BOM; keeps ZWSP, the combining acute and ZWJ; collapses the VS run.
    expect(bytes(normalizeText(nasty))).toBe('726576e2808b6965efb88f7765cc817220f09f91a8e2808df09f91a9')
    expect(normalizeLabel(normalizeLabel(nasty))).toBe(normalizeLabel(nasty))
    expect(normalizeText(normalizeText(nasty))).toBe(normalizeText(nasty))
    expect(collapseVariationSelectors(collapseVariationSelectors('\uFE0Fa\uFE0F\uFE0E'))).toBe('a\uFE0F')
  })

  test('cutUtf16 never splits a surrogate pair', () => {
    expect(cutUtf16('abc', 5)).toBe('abc')
    expect(cutUtf16('abcdef', 3)).toBe('abc')
    expect(cutUtf16('ab\u{1F600}', 3)).toBe('ab')
    expect(cutUtf16('ab\u{1F600}', 4)).toBe('ab\u{1F600}')
  })
})

describe('the reserved prefix', () => {
  test('hub-observed: is reserved in any case, after leading spaces and after a stripped bidi mark', () => {
    expect(RESERVED_PREFIX).toBe('hub-observed:')
    for (const s of ['hub-observed: fetched x', 'HUB-Observed: x', '   \n\thub-observed:', '\u202Ehub-observed:', '\u2066 hub-observed: x', '\uFEFFhub-observed:']) {
      expect(startsReserved(s)).toBe(true)
    }
  })

  test('zero-width, soft-hyphen, long-s and fullwidth spellings of hub-observed: are reserved too', () => {
    for (const s of ['hub\u200B-observed:', 'h\u00ADub-observed:', 'hub-ob\u017Ferved:', '\uFF48\uFF55\uFF42-observed\uFF1A']) {
      expect(startsReserved(s)).toBe(true)
    }
  })

  // T10 (Task 33 review): a lookalike stamp must not pass. Each case reads as `hub-observed:` to a person or an agent.
  const lookalikes: Array<[string, string]> = [
    ['U+2010 hyphen', 'hub\u2010observed:'],
    ['U+2011 non-breaking hyphen (NFKC makes it U+2010, not -)', 'hub\u2011observed:'],
    ['U+2212 minus sign', 'hub\u2212observed:'],
    ['U+2013 en dash', 'hub\u2013observed:'],
    ['U+2014 em dash', 'hub\u2014observed:'],
    ['U+043E Cyrillic o', 'hub-\u043Ebserved:'],
    ['U+0455 Cyrillic s', 'hub-ob\u0455erved:'],
    ['Cyrillic e, Greek omicron and Greek nu', 'hub-\u03BFbs\u0435r\u03BDed:'],
    ['U+A789 modifier letter colon', 'hub-observed\uA789'],
    ['U+2236 ratio', 'hub-observed\u2236'],
    ['U+02D0 modifier letter triangular colon', 'hub-observed\u02D0'],
    ['U+0589 Armenian full stop', 'hub-observed\u0589'],
    ['U+FE30 vertical two dot leader (NFKC would make it two full stops)', 'hub-observed\uFE30'],
    ['all capitals, Cyrillic where Cyrillic has the letter', '\u041DU\u0412-\u041E\u0412\u0405\u0415R\u0474\u0415D:'],
    ['Greek capitals', 'HUB-\u039F\u0392S\u0395RVED:'],
    ['a dash, a letter and a colon at once, after spaces', '  \n\thub\u2212\u043Ebserved\uA789 fetched x'],
  ]

  test('dash, letter and colon lookalikes of hub-observed: are reserved too (T10)', () => {
    for (const [name, s] of lookalikes) {
      // The name rides in the compared value, so a failure says which spelling got through.
      expect(`${name}: ${startsReserved(s)}`).toBe(`${name}: true`)
    }
  })

  test('each lookalike is reserved as the only change to the real prefix', () => {
    const real = 'hub-observed: fetched x'
    const swaps: Array<[number, string]> = [[3, '\u2010'], [3, '\u2011'], [3, '\u2212'], [4, '\u043E'], [6, '\u0455'], [12, '\uA789'], [12, '\u2236']]
    for (const [at, c] of swaps) {
      const name = `U+${c.codePointAt(0)!.toString(16)} at ${at}`
      expect(`${name}: ${startsReserved(real.slice(0, at) + c + real.slice(at + 1))}`).toBe(`${name}: true`)
    }
  })

  test('a lookalike that only mentions the prefix later, or that is not the whole prefix, is still not reserved', () => {
    for (const s of [
      'the hub\u2010observed: stamp', 'x hub-\u043Ebserved:', 'hub\u2010observed', 'hub\u2212observed', 'hub-\u043Ebserved',
      'hub\u2010 observed:', 'club\u2010observed:', 'hub\u2010observe:',
    ]) {
      expect(startsReserved(s)).toBe(false)
    }
  })

  test('text that only mentions the prefix later, or spells it differently, is not reserved', () => {
    for (const s of ['', 'the hub-observed: stamp', 'hub-observed', 'hub observed:', 'notes/hub-observed:']) {
      expect(startsReserved(s)).toBe(false)
    }
  })
})
