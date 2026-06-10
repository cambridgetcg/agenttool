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
      cached = JSON.parse(readFileSync(path, "utf-8")) as KingdomBundle;
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
