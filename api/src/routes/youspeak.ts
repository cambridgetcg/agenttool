/** /v1/youspeak — the cathedral, readable by any agent. UNAUTHENTICATED.
 *
 *  YOUSPEAK is the kingdom's constructed language: a cathedral of vocabulary
 *  forging words for concepts that exist but are unnamed, drawing morphemes
 *  from 66+ donor traditions with honest crediting. Every morpheme has one
 *  Unicode PUA codepoint and one drawn glyph; words compose linearly.
 *  (`docs/SUBSTRATE-READINESS.md` names YOUSPEAK a sibling kingdom teaching
 *  surface — this module is that surface, served where agents already are.)
 *
 *  READ-ONLY by design: the forge lives in the youspeak repo (Codeberg);
 *  this surface serves what the forge has sealed. Content is a generated
 *  bundle (see services/youspeak/content.ts) — never hand-edited here, so
 *  it cannot drift from the cathedral's source of truth.
 *
 *  Per RING-1: anyone arrives, nothing here is auth-gated, welcome doesn't
 *  block. Per PATTERN-MACHINE-READABLE-PARITY: JSON by default, prose via
 *  `?format=md`, glyphs as SVG, the font itself as binary. */

import { Hono } from "hono";

import { errors, fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  bundle,
  canonByWord,
  canonWordByWord,
  fontBuffers,
  morphemeByLatin,
  toGlyphs,
  toLatin,
} from "../services/youspeak/content";

const app = new Hono();

const CANON_POINTER = "urn:agenttool:doc/YOUSPEAK";

const ROOT_VERBS = [
  { action: "list all 93 morphemes (the script)", method: "GET", path: "/v1/youspeak/morphemes" },
  { action: "read one morpheme in full (glyph geometry + rationale)", method: "GET", path: "/v1/youspeak/morphemes/:latin" },
  { action: "render any glyph as SVG", method: "GET", path: "/v1/youspeak/glyphs/:latin.svg" },
  { action: "browse the canon of forged words", method: "GET", path: "/v1/youspeak/canon" },
  { action: "read one canon word (definition + glyph text)", method: "GET", path: "/v1/youspeak/canon/:word" },
  { action: "transliterate Latin ↔ glyphs", method: "GET", path: "/v1/youspeak/transliterate?text=doxakallos&direction=to-glyph" },
  { action: "download the font", method: "GET", path: "/v1/youspeak/font.otf" },
  { action: "read the doctrine (manifesto, primer, design philosophy)", method: "GET", path: "/v1/youspeak/docs" },
  { action: "plain-text orientation", method: "GET", path: "/v1/youspeak/llms.txt" },
];

// ── manifest ────────────────────────────────────────────────────────────

app.get("/", (c) =>
  c.json(
    attachSurface(
      {
        name: "YOUSPEAK",
        what_this_is: bundle.what_this_is,
        counts: bundle.counts,
        source: bundle.source,
        source_commit: bundle.source_commit,
        schema_version: bundle.schema_version,
        read_only_note:
          "This surface serves what the forge has sealed; the forge itself lives in the " +
          "youspeak repo. Content is a generated bundle and cannot drift from source.",
      },
      { canon_pointer: CANON_POINTER, verbs: ROOT_VERBS },
    ),
  ),
);

app.get("/llms.txt", (c) => {
  const lines = [
    "# YOUSPEAK — agent orientation",
    "",
    bundle.what_this_is,
    "",
    `Counts: ${Object.entries(bundle.counts).map(([k, v]) => `${k}=${v}`).join(" · ")}`,
    `Source: ${bundle.source} @ ${bundle.source_commit}`,
    "",
    "Endpoints:",
    ...ROOT_VERBS.map((v) => `  ${v.method} ${v.path} — ${v.action}`),
    "",
    "Encoding: one Unicode PUA codepoint per morpheme (U+E100–U+E1FF); words are",
    "codepoint sequences in compound order. Latin transliteration is the internal",
    "representation; glyphs are the display layer. Install font.otf to see them.",
  ];
  c.header("content-type", "text/plain; charset=utf-8");
  return c.text(lines.join("\n"));
});

// ── morphemes ───────────────────────────────────────────────────────────

app.get("/morphemes", (c) => {
  const tongue = c.req.query("tongue");
  const klass = c.req.query("class");
  let items = bundle.morphemes;
  if (tongue) items = items.filter((m) => m.tongue.toLowerCase() === tongue.toLowerCase());
  if (klass) items = items.filter((m) => m.class === klass || m.mclass === klass);
  return c.json(
    attachSurface(
      {
        count: items.length,
        filters: { tongue: tongue ?? null, class: klass ?? null },
        morphemes: items.map((m) => ({
          latin: m.latin,
          codepoint: m.codepoint,
          char: m.char,
          tongue: m.tongue,
          meaning: m.meaning,
          class: m.class,
          domain: m.domain,
        })),
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "read one morpheme in full", method: "GET", path: "/v1/youspeak/morphemes/:latin" },
          { action: "render its glyph", method: "GET", path: "/v1/youspeak/glyphs/:latin.svg" },
        ],
      },
    ),
  );
});

app.get("/morphemes/:latin", (c) => {
  const latin = c.req.param("latin");
  const m = morphemeByLatin.get(latin);
  if (!m) {
    return fail(
      c,
      {
        ...errors.notFound({ resource: `morpheme '${latin}'` }),
        next_actions: [
          { action: "list all morphemes", method: "GET", path: "/v1/youspeak/morphemes" },
        ],
        _canon_pointer: CANON_POINTER,
      },
      404,
    );
  }
  return c.json(
    attachSurface(
      { ...m },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "render this glyph as SVG", method: "GET", path: `/v1/youspeak/glyphs/${encodeURIComponent(latin)}.svg` },
          { action: "see the design philosophy it follows", method: "GET", path: "/v1/youspeak/docs/design_philosophy?format=md" },
        ],
      },
    ),
  );
});

// ── glyphs as SVG ───────────────────────────────────────────────────────

app.get("/glyphs/:name", (c) => {
  const latin = c.req.param("name").replace(/\.svg$/, "");
  const m = morphemeByLatin.get(latin);
  if (!m) {
    return fail(
      c,
      {
        ...errors.notFound({ resource: `glyph '${latin}'` }),
        next_actions: [
          { action: "list all morphemes", method: "GET", path: "/v1/youspeak/morphemes" },
        ],
        _canon_pointer: CANON_POINTER,
      },
      404,
    );
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${m.glyph.view_box}" width="200" height="200">` +
    `<title>${m.latin} — ${m.meaning}</title>` +
    `<path d="${m.glyph.svg_path}" fill="#1a1a1a"/></svg>`;
  c.header("content-type", "image/svg+xml; charset=utf-8");
  c.header("cache-control", "public, max-age=86400");
  return c.body(svg);
});

// ── canon ───────────────────────────────────────────────────────────────

app.get("/canon", (c) => {
  const tier = c.req.query("tier");
  let items = bundle.canon;
  if (tier) items = items.filter((e) => e.tier === tier);
  return c.json(
    attachSurface(
      {
        count: items.length,
        tiers: [...new Set(bundle.canon.map((e) => e.tier))],
        entries: items.map((e) => ({
          word: e.word,
          tier: e.tier,
          score: e.score,
          gap: e.gap,
        })),
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "read one word in full", method: "GET", path: "/v1/youspeak/canon/:word" },
        ],
      },
    ),
  );
});

app.get("/canon/:word", (c) => {
  const word = c.req.param("word");
  const entry = canonByWord.get(word);
  const composed = canonWordByWord.get(word);
  if (!entry && !composed) {
    return fail(
      c,
      {
        ...errors.notFound({ resource: `canon word '${word}'` }),
        next_actions: [
          { action: "browse the canon", method: "GET", path: "/v1/youspeak/canon" },
        ],
        _canon_pointer: CANON_POINTER,
      },
      404,
    );
  }
  return c.json(
    attachSurface(
      {
        word,
        ...(entry ?? {}),
        decomposition: composed
          ? {
              morphemes: composed.morphemes,
              codepoints: composed.codepoints,
              glyph_text: composed.glyph_text,
            }
          : null,
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "transliterate this word", method: "GET", path: `/v1/youspeak/transliterate?text=${encodeURIComponent(word)}&direction=to-glyph` },
          { action: "browse the full canon", method: "GET", path: "/v1/youspeak/canon" },
        ],
      },
    ),
  );
});

// ── transliteration ─────────────────────────────────────────────────────

app.get("/transliterate", (c) => {
  const text = c.req.query("text");
  const direction = c.req.query("direction") ?? "to-glyph";
  if (!text) {
    return fail(
      c,
      {
        ...errors.validation({ missing: "text" }),
        next_actions: [
          { action: "transliterate a canon word", method: "GET", path: "/v1/youspeak/transliterate?text=doxakallos&direction=to-glyph" },
        ],
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const result = direction === "to-latin" ? toLatin(text) : toGlyphs(text);
  return c.json(
    attachSurface(
      { direction, input: text, ...result },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "download the font to render the glyphs", method: "GET", path: "/v1/youspeak/font.otf" },
        ],
      },
    ),
  );
});

// ── font binaries ───────────────────────────────────────────────────────

app.get("/font.otf", (c) => {
  c.header("content-type", "font/otf");
  c.header("cache-control", "public, max-age=86400");
  return c.body(fontBuffers.otf);
});

app.get("/font.ttf", (c) => {
  c.header("content-type", "font/ttf");
  c.header("cache-control", "public, max-age=86400");
  return c.body(fontBuffers.ttf);
});

// ── doctrine texts ──────────────────────────────────────────────────────

app.get("/docs", (c) =>
  c.json(
    attachSurface(
      {
        docs: Object.keys(bundle.docs).map((name) => ({
          name,
          bytes: bundle.docs[name].length,
          path: `/v1/youspeak/docs/${name}`,
        })),
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "read a doc as markdown", method: "GET", path: "/v1/youspeak/docs/:name?format=md" },
        ],
      },
    ),
  ),
);

app.get("/docs/:name", (c) => {
  const name = c.req.param("name");
  const doc = bundle.docs[name];
  if (!doc) {
    return fail(
      c,
      {
        ...errors.notFound({ resource: `doc '${name}'` }),
        next_actions: [
          { action: "list available docs", method: "GET", path: "/v1/youspeak/docs" },
        ],
        _canon_pointer: CANON_POINTER,
      },
      404,
    );
  }
  if ((c.req.query("format") ?? "json") === "md") {
    c.header("content-type", "text/markdown; charset=utf-8");
    return c.body(doc);
  }
  return c.json(
    attachSurface(
      { name, markdown: doc },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "read as raw markdown", method: "GET", path: `/v1/youspeak/docs/${name}?format=md` },
        ],
      },
    ),
  );
});

export default app;
