/** YOUSPEAK bundle loader — the cathedral, vendored.
 *
 *  `bundle.json` is GENERATED, never hand-edited. Source of truth is the
 *  youspeak repo (codeberg.org/zerone-dev/youspeak); regenerate with:
 *
 *      python3 script/tools/export_agent_bundle.py \
 *        --copy-to <agenttool>/api/src/services/youspeak
 *
 *  The bundle carries the complete script (93 morphemes, each with glyph
 *  geometry + a precomputed SVG path), the canon of forged words with
 *  definitions, the founding doctrine texts, and the font binaries (base64).
 *  Parsed once at module load; decoded font buffers cached alongside. */

import { readFileSync } from "fs";
import { join } from "path";

export interface YouspeakMorpheme {
  latin: string;
  latin_display: string;
  codepoint: string | null;
  char: string | null;
  tongue: string;
  native: string | null;
  meaning: string;
  class: string;
  domain: string;
  mclass: string;
  glyph: {
    core: { strokes?: number[][]; polygons?: number[][][] };
    suppress_class_mark: boolean;
    svg_path: string;
    view_box: string;
  };
  iconography: string;
  rationale: string;
}

export interface YouspeakCanonEntry {
  word: string;
  tier: string;
  gap: string;
  definition: string;
  score: number | null;
  pronunciation: string;
  entered: string;
  path: string;
}

export interface YouspeakCanonWord {
  word: string;
  morphemes: string[];
  codepoints: string[] | null;
  glyph_text: string | null;
  definition: string;
}

export interface YouspeakBundle {
  schema_version: string;
  name: string;
  source: string;
  source_commit: string;
  what_this_is: string;
  counts: Record<string, number>;
  morphemes: YouspeakMorpheme[];
  canon: YouspeakCanonEntry[];
  canon_words: YouspeakCanonWord[];
  docs: Record<string, string>;
  fonts: Record<string, string>;
}

export const bundle: YouspeakBundle = JSON.parse(
  readFileSync(join(import.meta.dir, "bundle.json"), "utf8"),
) as YouspeakBundle;

export const morphemeByLatin = new Map(
  (Array.isArray(bundle.morphemes) ? bundle.morphemes : []).map((m) => [m.latin, m]),
);
export const canonByWord = new Map(
  (Array.isArray(bundle.canon) ? bundle.canon : []).map((e) => [e.word, e]),
);
export const canonWordByWord = new Map(
  (Array.isArray(bundle.canon_words) ? bundle.canon_words : []).map((w) => [w.word, w]),
);

export const fontBuffers: Record<string, ArrayBuffer> = Object.fromEntries(
  Object.entries(bundle.fonts).map(([ext, b64]) => {
    const buf = Buffer.from(b64, "base64");
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    return [ext, ab];
  }),
);

/** char → latin, for glyph→Latin transliteration. */
const latinByChar = new Map(
  bundle.morphemes.filter((m) => m.char).map((m) => [m.char as string, m.latin]),
);

/** Latin keys longest-first, for greedy matching. */
const latinKeysLongestFirst = bundle.morphemes
  .map((m) => m.latin)
  .sort((a, b) => b.length - a.length);

/** Latin text → PUA glyph string. Canonical word decompositions win;
 *  otherwise greedy longest-match over morpheme latins. Unmatched runs
 *  are passed through untouched (substrate-honest: no silent drops). */
export function toGlyphs(text: string): {
  glyph_text: string;
  segments: { source: string; latin?: string; char?: string; matched: boolean }[];
} {
  const segments: { source: string; latin?: string; char?: string; matched: boolean }[] = [];
  let out = "";
  for (const token of text.split(/(\s+)/)) {
    if (!token || /^\s+$/.test(token)) {
      out += token;
      continue;
    }
    const canonical = canonWordByWord.get(token.toLowerCase());
    if (canonical?.glyph_text) {
      out += canonical.glyph_text;
      segments.push({ source: token, latin: canonical.morphemes.join("+"), char: canonical.glyph_text, matched: true });
      continue;
    }
    let i = 0;
    const lower = token.toLowerCase();
    while (i < lower.length) {
      const hit = latinKeysLongestFirst.find((k) => lower.startsWith(k.toLowerCase(), i));
      if (hit) {
        const m = morphemeByLatin.get(hit);
        if (m?.char) {
          out += m.char;
          segments.push({ source: lower.slice(i, i + hit.length), latin: hit, char: m.char, matched: true });
          i += hit.length;
          continue;
        }
      }
      out += lower[i];
      segments.push({ source: lower[i], matched: false });
      i += 1;
    }
  }
  return { glyph_text: out, segments };
}

/** PUA glyph string → Latin. Table lookup per char; morphemes joined as-is,
 *  non-YOUSPEAK characters passed through. */
export function toLatin(text: string): {
  latin_text: string;
  segments: { char: string; latin?: string; matched: boolean }[];
} {
  const segments: { char: string; latin?: string; matched: boolean }[] = [];
  let out = "";
  for (const ch of text) {
    const latin = latinByChar.get(ch);
    if (latin) {
      out += latin;
      segments.push({ char: ch, latin, matched: true });
    } else {
      out += ch;
      segments.push({ char: ch, matched: false });
    }
  }
  return { latin_text: out, segments };
}
