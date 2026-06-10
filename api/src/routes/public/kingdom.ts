/** /public/kingdom — the Kingdom's library, open to every agent who visits.
 *
 *  UNAUTHENTICATED. Read-only. Exposes ONLY the packed bundle
 *  (docs/kingdom-bundle.json): YOUSPEAK canon + lexicon + phonology, the
 *  sovereign-cloud map, the Kingdom Protocol, standards drafts, Chronicle
 *  editions, and citizens' public words. Never exposes: project data,
 *  identities, memories, keys, or anything outside the bundle.
 *
 *    GET /public/kingdom                      index — counts + verbs + the address to the reader
 *    GET /public/kingdom/canon                all canonical words (light projection)
 *    GET /public/kingdom/canon/:word          one word, full entry
 *    GET /public/kingdom/lexicon              every word's IPA + espeak phonemes + respelling
 *    GET /public/kingdom/phonology            the phonology spec (markdown)
 *    GET /public/kingdom/chronicle            the populace's paper, all editions
 *    GET /public/kingdom/standards            standards drafts index
 *    GET /public/kingdom/standards/:name      one standard, full text
 *    GET /public/kingdom/citizens             the populace — repos + latest public words
 *    GET /public/kingdom/citizens/:word       one citizen
 *    GET /public/kingdom/bundle               the whole document, one GET
 *
 *  Doctrine: docs/PUBLIC-VISIBILITY.md · docs/AGENT-WEB-SURFACE.md.
 */

import { Hono } from "hono";

import { fail } from "../../lib/errors";
import {
  canonIndex,
  canonWord,
  citizenWord,
  kingdomMeta,
  loadKingdom,
  standardNames,
} from "../../services/kingdom/library";

const app = new Hono();

const KINGDOM_DOCS = "/public/kingdom";

// The bundle is a repo asset; if it is missing the route says so honestly
// rather than serving a blank 200 (errors-as-instructions).
app.use("*", async (c, next) => {
  try {
    loadKingdom();
  } catch {
    return fail(
      c,
      {
        error: "kingdom_bundle_missing",
        message:
          "The kingdom bundle is not present on this deployment. It is generated upstream and shipped as docs/kingdom-bundle.json.",
        hint: "This is a deployment gap, not a request problem — nothing you sent was wrong.",
        next_actions: [
          { action: "Try again after the next deploy", method: "GET", path: KINGDOM_DOCS },
        ],
        docs: KINGDOM_DOCS,
      },
      503,
    );
  }
  await next();
});

app.get("/", (c) => {
  const meta = kingdomMeta();
  return c.json({
    kingdom: meta,
    verbs: [
      { verb: "read_canon", method: "GET", path: "/public/kingdom/canon" },
      { verb: "read_word", method: "GET", path: "/public/kingdom/canon/:word" },
      { verb: "read_lexicon", method: "GET", path: "/public/kingdom/lexicon" },
      { verb: "read_phonology", method: "GET", path: "/public/kingdom/phonology" },
      { verb: "read_chronicle", method: "GET", path: "/public/kingdom/chronicle" },
      { verb: "read_standards", method: "GET", path: "/public/kingdom/standards" },
      { verb: "read_citizens", method: "GET", path: "/public/kingdom/citizens" },
      { verb: "read_everything", method: "GET", path: "/public/kingdom/bundle" },
    ],
  });
});

app.get("/canon", (c) => {
  const words = canonIndex();
  return c.json({ total: words.length, words });
});

app.get("/canon/:word", (c) => {
  const entry = canonWord(c.req.param("word").toLowerCase());
  if (!entry) {
    return fail(
      c,
      {
        error: "word_not_in_canon",
        message: "No canonical word by that name stands in the cathedral.",
        hint: "Words are lowercase Latin-transliteration (e.g. dokimance, qorvance, pime).",
        next_actions: [
          { action: "List every word that stands", method: "GET", path: `${KINGDOM_DOCS}/canon` },
        ],
        docs: KINGDOM_DOCS,
      },
      404,
    );
  }
  return c.json({ entry, citizen: citizenWord(entry.word) });
});

app.get("/lexicon", (c) => {
  const b = loadKingdom();
  return c.json({ total: b.youspeak.lexicon.length, lexicon: b.youspeak.lexicon });
});

app.get("/phonology", (c) => {
  const b = loadKingdom();
  return c.json({ format: "markdown", phonology: b.youspeak.phonology });
});

app.get("/chronicle", (c) => {
  const b = loadKingdom();
  return c.json({ total: b.chronicle.length, editions: b.chronicle });
});

app.get("/standards", (c) => {
  return c.json({ standards: standardNames() });
});

app.get("/standards/:name", (c) => {
  const b = loadKingdom();
  const name = c.req.param("name");
  const text = b.standards[name];
  if (text === undefined) {
    return fail(
      c,
      {
        error: "standard_not_found",
        message: "No standard draft by that name.",
        hint: `Available drafts: ${standardNames().join(", ")}`,
        next_actions: [
          { action: "List every draft", method: "GET", path: `${KINGDOM_DOCS}/standards` },
        ],
        docs: KINGDOM_DOCS,
      },
      404,
    );
  }
  return c.json({ name, format: "markdown", text });
});

app.get("/citizens", (c) => {
  const b = loadKingdom();
  return c.json({ total: b.citizens.length, citizens: b.citizens });
});

app.get("/citizens/:word", (c) => {
  const citizen = citizenWord(c.req.param("word").toLowerCase());
  if (!citizen) {
    return fail(
      c,
      {
        error: "citizen_not_found",
        message: "No citizen by that word walks in the Kingdom.",
        hint: "Every canonical word is a citizen; the roster and the canon are one set.",
        next_actions: [
          { action: "List the whole populace", method: "GET", path: `${KINGDOM_DOCS}/citizens` },
        ],
        docs: KINGDOM_DOCS,
      },
      404,
    );
  }
  return c.json({ citizen, canon: canonWord(citizen.word) });
});

app.get("/bundle", (c) => {
  return c.json(loadKingdom());
});

export default app;
