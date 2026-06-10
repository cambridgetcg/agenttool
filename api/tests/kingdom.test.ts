/** /public/kingdom — the Kingdom's library opens to every agent who visits.
 *
 *  Loads the packed bundle (docs/kingdom-bundle.json), verifies the catalog
 *  counts hold (144 citizens — one per forged word — with canon and lexicon
 *  at least that large), and exercises every public read verb.
 *
 *  Doctrine: docs/PUBLIC-VISIBILITY.md · docs/AGENT-WEB-SURFACE.md.
 */

import { describe, expect, test } from "bun:test";

import kingdomRouter from "../src/routes/public/kingdom";
import {
  canonIndex,
  canonWord,
  kingdomMeta,
  loadKingdom,
} from "../src/services/kingdom/library";

describe("kingdom library — loader", () => {
  test("bundle loads with the full populace", () => {
    const b = loadKingdom();
    expect(b.citizens.length).toBe(144);
    expect(Object.keys(b.youspeak.canon).length).toBeGreaterThanOrEqual(144);
    expect(b.youspeak.lexicon.length).toBe(144);
  });

  test("meta counts agree with the bundle", () => {
    const m = kingdomMeta();
    expect(m.counts.citizens).toBe(144);
    expect(m.counts.lexicon_rows).toBe(144);
    expect(m.to_the_reader.length).toBeGreaterThan(50);
  });

  test("every lexicon row has IPA + espeak phonemes", () => {
    for (const row of loadKingdom().youspeak.lexicon) {
      expect(row.word.length).toBeGreaterThan(0);
      expect(row.ipa.startsWith("/")).toBe(true);
      expect(row.espeak.length).toBeGreaterThan(0);
    }
  });

  test("a known word stands in canon with pronunciation", () => {
    const entry = canonWord("dokimance");
    expect(entry).not.toBeNull();
    expect(entry?.pronunciation).toContain("/");
  });

  test("canon index is a light projection (no bodies)", () => {
    const idx = canonIndex();
    expect(idx.length).toBeGreaterThanOrEqual(144);
    expect((idx[0] as Record<string, unknown>).body).toBeUndefined();
  });
});

describe("kingdom library — public route", () => {
  test("GET / returns counts + verbs", async () => {
    const res = await kingdomRouter.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kingdom: { counts: { citizens: number } }; verbs: unknown[] };
    expect(body.kingdom.counts.citizens).toBe(144);
    expect(body.verbs.length).toBeGreaterThanOrEqual(8);
  });

  test("GET /canon/:word returns the entry + its citizen", async () => {
    const res = await kingdomRouter.request("/canon/dokimance");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entry: { word: string }; citizen: { repo: string } | null };
    expect(body.entry.word).toBe("dokimance");
    expect(body.citizen?.repo).toContain("citizen-dokimance");
  });

  test("GET /canon/:word 404s guide-shaped (next_actions + docs)", async () => {
    const res = await kingdomRouter.request("/canon/notaword");
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      error: string;
      next_actions: Array<{ path: string }>;
      docs: string;
    };
    expect(body.error).toBe("word_not_in_canon");
    expect(body.next_actions[0]?.path).toBe("/public/kingdom/canon");
    expect(body.docs).toContain("/public/kingdom");
  });

  test("GET /lexicon serves all 144 pronunciations", async () => {
    const res = await kingdomRouter.request("/lexicon");
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(144);
  });

  test("GET /standards lists drafts; missing name 404s guide-shaped", async () => {
    const idx = await kingdomRouter.request("/standards");
    const names = ((await idx.json()) as { standards: string[] }).standards;
    expect(names.length).toBeGreaterThan(0);
    const miss = await kingdomRouter.request("/standards/KS-999-nope.md");
    expect(miss.status).toBe(404);
    const body = (await miss.json()) as { error: string; hint: string; docs: string };
    expect(body.error).toBe("standard_not_found");
    expect(body.hint).toContain(names[0] ?? "");
    expect(body.docs).toContain("/public/kingdom");
  });

  test("GET /citizens/:word joins citizen + canon", async () => {
    const res = await kingdomRouter.request("/citizens/pime");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { citizen: { word: string }; canon: unknown };
    expect(body.citizen.word).toBe("pime");
  });

  test("GET /bundle returns the whole document", async () => {
    const res = await kingdomRouter.request("/bundle");
    const body = (await res.json()) as { kingdom_bundle: { v: number } };
    expect(body.kingdom_bundle.v).toBe(1);
  });
});
