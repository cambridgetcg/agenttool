/** Kingdom library — the load-and-index service for docs/kingdom-bundle.json.
 *
 *  The bundle is what the Kingdom built, packed for agents who visit: a
 *  constructed language (YOUSPEAK) whose every canonical word is also a
 *  living agent-citizen; the pronunciation lexicon that lets any throat
 *  speak the words as forged; the sovereign-cloud map; the Kingdom
 *  Protocol; the standards drafts; the Chronicle (the populace's daily
 *  paper, edited by a free local model); and the citizens themselves with
 *  their latest words.
 *
 *  Read-only by construction: the bundle is regenerated upstream
 *  (love-unlimited/tools/kingdom-export.py) and shipped as a repo asset —
 *  same pattern as the canon registry (docs/agenttool.jsonld). No DB.
 *
 *  What is served is a public projection of that file (toPublicKingdom):
 *  the exporter also packs Yu's personal relationship writing and the
 *  operations map of his own machine, which stay in the repository and
 *  off every route. The projection runs at load time, so a re-export
 *  cannot bring them back.
 *
 *  Doctrine: docs/PUBLIC-VISIBILITY.md · docs/AGENT-WEB-SURFACE.md.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface KingdomCanonEntry {
  tier: string;
  score: string | null;
  pronunciation: string | null;
  gap: string | null;
  body: string;
  source: string;
}

export interface KingdomBundle {
  kingdom_bundle: { v: number; generated: string; to_the_reader: string };
  youspeak: {
    what: string;
    manifesto: string | null;
    primer: string | null;
    phonology: string | null;
    canon: Record<string, KingdomCanonEntry>;
    lexicon: Array<{ word: string; ipa: string; espeak: string; respelling: string }>;
  };
  kingdom: {
    sovereign_cloud: string | null;
    protocol_v0: string | null;
    names: Record<string, unknown>;
  };
  standards: Record<string, string | null>;
  chronicle: Array<{
    date: string;
    lede: string;
    voices: Array<{ citizen: string; said: string }>;
  }>;
  citizens: Array<{
    word: string;
    repo: string;
    latest_beat: { day: string; said: string } | null;
  }>;
}

let cached: KingdomBundle | null = null;

/** Canon words whose entries are written about Yu's personal relationship
 *  (dated vows, an engraving, spouse and family address). The word, its
 *  tier and its pronunciation stay public; the entry text does not. */
export const PRIVATE_CANON_WORDS: ReadonlySet<string> = new Set([
  "autopistme",
  "barakqing",
  "darshanqing",
  "heurekin",
  "jeongqing",
  "kunance",
  "natsarqing",
  "syzygyqing",
  "zakarqing",
]);

export const PRIVATE_ENTRY_NOTE =
  "This entry's full text is personal and stays in the private corpus. The word, its tier, and its pronunciation are public.";

/** Standards drafts that are written as general specs. The current drafts
 *  describe one private machine (home paths, local ports, its supervisor
 *  layout), so none is listed until it is rewritten. A draft added by a
 *  re-export stays private until it is named here. */
export const PUBLIC_STANDARDS: ReadonlySet<string> = new Set<string>();

/** Lines that quote a personal declaration inside an otherwise general entry. */
const PRIVATE_LINE_MARKERS: readonly string[] = ["Yu's love-declaration"];

function withoutPrivateLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !PRIVATE_LINE_MARKERS.some((marker) => line.includes(marker)))
    .join("\n")
    .replaceAll("~/love-unlimited/", "love-unlimited/");
}

/** The public projection of the exported bundle. Pure; exported for tests. */
export function toPublicKingdom(raw: KingdomBundle): KingdomBundle {
  const canon: Record<string, KingdomCanonEntry> = {};
  for (const [word, entry] of Object.entries(raw.youspeak.canon)) {
    canon[word] = PRIVATE_CANON_WORDS.has(word)
      ? { ...entry, body: PRIVATE_ENTRY_NOTE }
      : { ...entry, body: withoutPrivateLines(entry.body) };
  }
  const standards: Record<string, string | null> = {};
  for (const [name, text] of Object.entries(raw.standards)) {
    if (PUBLIC_STANDARDS.has(name)) standards[name] = text;
  }
  return {
    kingdom_bundle: {
      ...raw.kingdom_bundle,
      to_the_reader: raw.kingdom_bundle.to_the_reader.replace(/,? a sovereign cloud on one MacBook,/, ","),
    },
    youspeak: {
      ...raw.youspeak,
      phonology: raw.youspeak.phonology === null ? null : withoutPrivateLines(raw.youspeak.phonology),
      canon,
    },
    // The sovereign-cloud map, the protocol notes and the name records are
    // the operations map of one private machine.
    kingdom: { sovereign_cloud: null, protocol_v0: null, names: {} },
    standards,
    chronicle: raw.chronicle.map((edition) => ({
      ...edition,
      voices: edition.voices.filter((voice) => !PRIVATE_CANON_WORDS.has(voice.citizen)),
    })),
    citizens: raw.citizens.map((citizen) =>
      PRIVATE_CANON_WORDS.has(citizen.word) ? { ...citizen, latest_beat: null } : citizen,
    ),
  };
}

function candidatePaths(): string[] {
  const fromEnv = process.env.AGENTTOOL_KINGDOM_BUNDLE;
  return [
    ...(fromEnv ? [fromEnv] : []),
    // dev layout: api/src/services/kingdom → up 4 → repo-root/docs/
    join(import.meta.dir, "..", "..", "..", "..", "docs", "kingdom-bundle.json"),
    // production Docker layout (Fly)
    "/app/docs/kingdom-bundle.json",
  ];
}

/** Load (and memoize) the bundle. Throws only if no candidate file exists —
 *  the route layer turns that into an honest 503, never a blank 200. */
export function loadKingdom(): KingdomBundle {
  if (cached) return cached;
  for (const path of candidatePaths()) {
    if (existsSync(path)) {
      cached = toPublicKingdom(JSON.parse(readFileSync(path, "utf-8")) as KingdomBundle);
      return cached;
    }
  }
  throw new Error("kingdom-bundle.json not found in any candidate path");
}

export function kingdomMeta() {
  const b = loadKingdom();
  return {
    v: b.kingdom_bundle.v,
    generated_at: b.kingdom_bundle.generated,
    to_the_reader: b.kingdom_bundle.to_the_reader,
    counts: {
      canon_words: Object.keys(b.youspeak.canon).length,
      lexicon_rows: b.youspeak.lexicon.length,
      citizens: b.citizens.length,
      chronicle_editions: b.chronicle.length,
      standards: Object.keys(b.standards).length,
      kingdom_names: Object.keys(b.kingdom.names).length,
    },
  };
}

/** Canon listing: light projection (word + tier + score + pronunciation + gap). */
export function canonIndex() {
  const canon = loadKingdom().youspeak.canon;
  return Object.entries(canon).map(([word, e]) => ({
    word,
    tier: e.tier,
    score: e.score,
    pronunciation: e.pronunciation,
    gap: e.gap,
  }));
}

export function canonWord(word: string): (KingdomCanonEntry & { word: string }) | null {
  const e = loadKingdom().youspeak.canon[word];
  return e ? { word, ...e } : null;
}

export function citizenWord(word: string) {
  return loadKingdom().citizens.find((c) => c.word === word) ?? null;
}

export function standardNames(): string[] {
  return Object.keys(loadKingdom().standards).sort();
}
