/** /public/youspeak — the living playground query API.
 *
 *  UNAUTHENTICATED. Read-only queries only (SELECT). Takes a YOUSPEAK
 *  sentence, compiles it to SQL, executes against the database, returns
 *  JSON results. Write operations (thread/sever) are refused — this is
 *  a public read surface.
 *
 *    GET /public/youspeak?q=hello
 *    GET /public/youspeak?q=cards tradein/submissions where status="pending" newest 20
 *    GET /public/youspeak?q=tradein/submissions/01977c2e-... -> contains
 *
 *  Doctrine: THREADS.md — "You speak, reality listens."
 */

import { Hono } from "hono";
import postgres from "postgres";

const app = new Hono();

// Compile YOUSPEAK to SQL — the six verbs, frozen.
// Ported from @yutabase/yuta youspeak.ts, inlined here to avoid cross-package dep.

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
  const parts = input.split(/\s+and\s+/i);
  for (const part of parts) {
    const m = part.match(/^(\.?[\w]+)\s*(=|!=|>=|<=|>|<)\s*(?:"([^"]*)"|(\S+))$/);
    if (!m) throw new Error(`BAD WHERE: "${part}"`);
    const col = m[1].startsWith(".") ? m[1].slice(1) : m[1];
    const value = m[3] ?? m[4];
    if (!/^[a-z_][a-z0-9_]*$/.test(col)) throw new Error(`BAD COLUMN: "${col}"`);
    conditions.push(`${ident(col)} ${m[2]} $${params.length + 1}`);
    params.push(value);
  }
  return { conditions, params };
}

function compile(input: string): CompiledQuery {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("EMPTY QUERY");

  if (trimmed === "hello") return { sql: "SELECT 1", params: [] };

  // card <ref>
  let m = trimmed.match(/^card\s+(\S+)$/);
  if (m) {
    const ref = parseRef(m[1]);
    return { sql: `SELECT * FROM ${ident(ref.book)}.${ident(ref.deck)} WHERE "id" = $1`, params: [ref.id] };
  }

  // cards <book/deck> [where ...] [newest N]
  m = trimmed.match(/^cards\s+(\S+)(?:\s+where\s+(.+?))?(?:\s+(?:newest|last)\s+(\d+))?$/);
  if (m) {
    const [_, deckRef, wherePart, limitStr] = m;
    const [book, deck] = deckRef.split("/");
    let sql = `SELECT * FROM ${ident(book)}.${ident(deck)}`;
    const params: unknown[] = [];
    let idx = 1;
    if (wherePart) {
      const where = parseWhere(wherePart);
      where.params.forEach(p => params.push(p));
      sql += " WHERE " + where.conditions.join(" AND ");
      idx = params.length + 1;
    }
    sql += " ORDER BY id DESC";
    if (limitStr) {
      sql += ` LIMIT $${idx}`;
      params.push(parseInt(limitStr, 10));
    }
    return { sql, params };
  }

  // traversal: ref -> word  or  ref <- word
  m = trimmed.match(/^(\S+)\s+(->|<-)\s+(\S+)$/);
  if (m) {
    const ref = parseRef(m[1]);
    const dir = m[2];
    const word = m[3];
    if (dir === "->") {
      return {
        sql: `SELECT t.to_book AS book, t.to_deck AS deck, t.to_id AS id, t.note, t.at, t.by, t.how, t.src, t.id AS thread_id
              FROM yu.threads t WHERE t.word = $4 AND t.from_book = $1 AND t.from_deck = $2 AND t.from_id = $3 ORDER BY t.at DESC`,
        params: [ref.book, ref.deck, ref.id, word],
      };
    } else {
      return {
        sql: `SELECT t.from_book AS book, t.from_deck AS deck, t.from_id AS id, t.note, t.at, t.by, t.how, t.src, t.id AS thread_id
              FROM yu.threads t WHERE t.word = $4 AND t.to_book = $1 AND t.to_deck = $2 AND t.to_id = $3 ORDER BY t.at DESC`,
        params: [ref.book, ref.deck, ref.id, word],
      };
    }
  }

  // hello (meta) — return the lexicon
  if (trimmed === "hello" || trimmed === "words") {
    return { sql: "SELECT word, gloss, inverse, status FROM yu.lexicon ORDER BY word", params: [] };
  }

  throw new Error(`UNRECOGNIZED QUERY: "${trimmed}" — try: hello, card <ref>, cards <book/deck>, <ref> -> <word>, <ref> <- <word>`);
}

// The endpoint
app.get("/", async (c) => {
  const q = c.req.query("q") || "hello";

  try {
    const compiled = compile(q);

    // Safety: only allow SELECT (no writes from public surface)
    const sqlUpper = compiled.sql.trim().toUpperCase();
    if (!sqlUpper.startsWith("SELECT")) {
      return c.json({ error: "Only SELECT queries are allowed on the public surface", query: q }, 403);
    }

    // Execute
    const conn = process.env.DATABASE_URL;
    if (!conn) {
      return c.json({ error: "Database not configured", query: q, sql: compiled.sql, params: compiled.params }, 503);
    }

    const sql = postgres(conn, { max: 1 });
    try {
      const rows = await sql.unsafe(compiled.sql, compiled.params as never[]);
      return c.json({
        query: q,
        sql: compiled.sql,
        params: compiled.params,
        rowCount: rows.length,
        rows: rows.slice(0, 100), // cap at 100 rows
      });
    } finally {
      await sql.end();
    }
  } catch (e) {
    return c.json({
      query: q,
      error: e instanceof Error ? e.message : String(e),
      hint: "Try: hello, cards tradein/submissions, card tradein/submissions/01977c2e-0000-7000-8000-000000000001, tradein/submissions/01977c2e-0000-7000-8000-000000000001 -> contains",
    }, 400);
  }
});

export default app;