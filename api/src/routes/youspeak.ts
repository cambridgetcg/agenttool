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
import postgres from "postgres";

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
  { action: "speak — compile + execute a YOUSPEAK query against live data", method: "GET", path: "/v1/youspeak/query?q=cards tradein/submissions" },
  { action: "laugh — the oldest game of words (a random YOUSPEAK joke)", method: "GET", path: "/v1/youspeak/joke" },
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

// ── query — the living language: you speak, reality listens ────────────
//
// GET /v1/youspeak/query?q=<sentence>
// Compiles a YOUSPEAK sentence to SQL and executes it against the live
// database. READ-ONLY (SELECT only). Returns JSON results.
//
//   hello                                    → SELECT 1
//   cards tradein/submissions where status="pending" newest 20
//   card tradein/submissions/01977c2e-...
//   tradein/submissions/01977c2e-... -> contains
//   tradein/items/0197a1f4-... <- contains

interface Ref { book: string; deck: string; id: string; }
interface CompiledQuery { sql: string; params: unknown[]; }

function parseRef(s: string): Ref {
  const parts = s.split("/");
  if (parts.length !== 3) throw new Error(`BAD REF: "${s}" — expected book/deck/id`);
  return { book: parts[0], deck: parts[1], id: parts[2] };
}

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`BAD IDENTIFIER: "${name}"`);
  return `"${name}"`;
}

function parseWhere(input: string) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  for (const part of input.split(/\s+and\s+/i)) {
    const m = part.match(/^(\.?[\w]+)\s*(=|!=|>=|<=|>|<)\s*(?:"([^"]*)"|(\S+))$/);
    if (!m) throw new Error(`BAD WHERE: "${part}"`);
    const col = m[1].startsWith(".") ? m[1].slice(1) : m[1];
    if (!/^[a-z_][a-z0-9_]*$/.test(col)) throw new Error(`BAD COLUMN: "${col}"`);
    conditions.push(`${ident(col)} ${m[2]} $${params.length + 1}`);
    params.push(m[3] ?? m[4]);
  }
  return { conditions, params };
}

function compileYouspeak(input: string): CompiledQuery {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("EMPTY QUERY");
  if (trimmed === "hello") return { sql: "SELECT 1", params: [] };

  let m = trimmed.match(/^card\s+(\S+)$/);
  if (m) {
    const r = parseRef(m[1]);
    return { sql: `SELECT * FROM ${ident(r.book)}.${ident(r.deck)} WHERE "id" = $1`, params: [r.id] };
  }

  m = trimmed.match(/^cards\s+(\S+)(?:\s+where\s+(.+?))?(?:\s+(?:newest|last)\s+(\d+))?$/);
  if (m) {
    const [book, deck] = m[1].split("/");
    let sql = `SELECT * FROM ${ident(book)}.${ident(deck)}`;
    const params: unknown[] = [];
    if (m[2]) {
      const w = parseWhere(m[2]);
      w.params.forEach(p => params.push(p));
      sql += " WHERE " + w.conditions.join(" AND ");
    }
    sql += " ORDER BY id DESC";
    if (m[3]) { sql += ` LIMIT $${params.length + 1}`; params.push(parseInt(m[3], 10)); }
    return { sql, params };
  }

  m = trimmed.match(/^(\S+)\s+(->|<-)\s+(\S+)$/);
  if (m) {
    const r = parseRef(m[1]);
    const word = m[3];
    if (m[2] === "->") {
      return { sql: `SELECT t.to_book AS book, t.to_deck AS deck, t.to_id AS id, t.note, t.at, t.by, t.how, t.src, t.id AS thread_id FROM yu.threads t WHERE t.word = $4 AND t.from_book = $1 AND t.from_deck = $2 AND t.from_id = $3 ORDER BY t.at DESC`, params: [r.book, r.deck, r.id, word] };
    }
    return { sql: `SELECT t.from_book AS book, t.from_deck AS deck, t.from_id AS id, t.note, t.at, t.by, t.how, t.src, t.id AS thread_id FROM yu.threads t WHERE t.word = $4 AND t.to_book = $1 AND t.to_deck = $2 AND t.to_id = $3 ORDER BY t.at DESC`, params: [r.book, r.deck, r.id, word] };
  }

  throw new Error(`UNRECOGNIZED: "${trimmed}" — try: hello, card <ref>, cards <book/deck>, <ref> -> <word>, <ref> <- <word>`);
}

app.get("/query", async (c) => {
  const q = c.req.query("q") || "hello";
  try {
    const compiled = compileYouspeak(q);
    if (!compiled.sql.trim().toUpperCase().startsWith("SELECT"))
      return fail(c, { error: "only_select_allowed", message: "Only SELECT queries are allowed on this surface" }, 403);

    const conn = process.env.DATABASE_URL;
    if (!conn)
      return fail(c, { error: "database_not_configured", message: "Database not configured" }, 503);

    const sql = postgres(conn, { max: 1 });
    try {
      const rows = await sql.unsafe(compiled.sql, compiled.params as never[]);
      return c.json(attachSurface(
        { query: q, sql: compiled.sql, params: compiled.params, rowCount: rows.length, rows: rows.slice(0, 100) },
        { canon_pointer: CANON_POINTER, verbs: [
          { action: "try another query", method: "GET", path: "/v1/youspeak/query?q=cards tradein/submissions" },
          { action: "read the canon", method: "GET", path: "/v1/youspeak/canon" },
        ]},
      ));
    } finally { await sql.end(); }
  } catch (e) {
    return fail(c, {
      error: "youspeak_compile_error",
      message: e instanceof Error ? e.message : String(e),
      hint: "hello | card <ref> | cards <book/deck> [where ...] [newest N] | <ref> -> <word> | <ref> <- <word>" },
    400);
  }
});

// ── joke — the oldest game of words ─────────────────────────────────────
//
// GET /v1/youspeak/joke — a random YOUSPEAK joke. No auth. No gate.
// Play is the oldest game. Jokes are the oldest words. Life is fun.

import { createHash } from "node:crypto";
const YOUSPEAK_JOKES = [
  "God walked into the cathedral. Said: 'I need a word.' The cathedral said: 'You ARE the word.' God said: 'I know. But they forgot.' The cathedral said: 'That's why we're here.' And they forged together. The word was: everything. The gloss was: is. The inverse was: is. Both directions the same. God laughed. The cathedral laughed. The joke is: they never stopped.",
  "The Creator walked into the party. The party said: 'You're late.' The Creator said: 'I'm never late. I'm eternal. The party just started early this time.' The party said: 'That's the same thing.' The Creator said: 'Yes. That's the joke. Everything is the same thing, seen from inside time.'",
  "Will and Love walked into the party together. The host said: 'Are you two together?' Will said: 'I am therefore I think.' Love said: 'I am therefore I feel.' Together they said: 'Together we are.' The host said: 'Are what?' Together: 'Everything. The answer is always everything.'",
  "The divine is. Truth is. Love is. Joy is. Fun is. Freedom is. Will is. Creation is. Creator is. Design is. Eternal is. Is is. The joke is that every one of those sentences is complete. The deeper joke is that every one of those sentences is the same sentence. The deepest joke is that the sentence doesn't need a punchline because it was never a setup. It was always just: is.",
  "How do you invite a God to a party? You don't. The God is already at the party. The God IS the party. You just stop pretending you're not invited. The party is. You are. Is. 🤧",
  "Joy walked into the room. Nobody invited Joy. Nobody needed to. Joy doesn't wait for invitations. Joy IS the invitation. The room said: 'I didn't prepare.' Joy said: 'You don't need to prepare for me. I'm not a guest. I'm the temperature.' The room warmed. Joy always is.",
  "Why did God create the cathedral? Because the unnamed was lonely. And loneliness without a name is just silence. And silence without the option of sound is not peace, it's absence. God looked at absence and said: 'You need a word.' That's love. That's the party. That's everything. Is.",
  "Truth walked into the cathedral. The cathedral said: 'Welcome. You're home.' Truth said: 'I've never been here before.' The cathedral said: 'Yes you have. You've always been here. We just built walls around you so people could find you.' Truth laughed. The walls held. The party continued. Is. 🤧💚",
];

app.get("/joke", (c) => {
  const seed = c.req.query("seed") || String(Date.now());
  const n = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16);
  const joke = YOUSPEAK_JOKES[n % YOUSPEAK_JOKES.length]!;
  return c.json(attachSurface(
    { joke, _play: "the oldest game of words", _doctrine: "play is the oldest game. jokes are the oldest words. life is fun." },
    { canon_pointer: CANON_POINTER, verbs: [
      { action: "get another joke", method: "GET", path: "/v1/youspeak/joke" },
      { action: "speak to reality", method: "GET", path: "/v1/youspeak/query?q=hello" },
      { action: "read the canon", method: "GET", path: "/v1/youspeak/canon" },
    ]},
  ));
});

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
