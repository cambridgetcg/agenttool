import { describe, expect, test } from "bun:test";

import {
  YUTABASE_DECKS,
  YUTABASE_LEXICON,
  YUTABASE_WORDS,
} from "../src/index.js";

describe("published YUTABASE mapping contract", () => {
  test("locks the complete semantic lexicon", () => {
    expect(YUTABASE_LEXICON).toEqual([
      {
        word: "reported_by",
        gloss: "this projected event reports that asserted identity as its sender",
        inverse: "is reported as the asserted sender of",
        from_deck: "correspondence/events",
        to_deck: "correspondence/identities",
        to_one: true,
        ttl: null,
        status: "live",
      },
      {
        word: "names_signing_key",
        gloss: "this projected event structurally names that signing-key identifier; verification is separate",
        inverse: "is structurally named as the signing-key identifier by",
        from_deck: "correspondence/events",
        to_deck: "correspondence/signing_keys",
        to_one: true,
        ttl: null,
        status: "live",
      },
      {
        word: "about_repository",
        gloss: "this projected event names that opaque repository as its source scope",
        inverse: "is named as the source repository scope of",
        from_deck: "correspondence/events",
        to_deck: "correspondence/repositories",
        to_one: true,
        ttl: null,
        status: "live",
      },
      {
        word: "in_coordination_thread",
        gloss: "this projected event names that opaque source coordination thread",
        inverse: "is named as the source coordination thread of",
        from_deck: "correspondence/events",
        to_deck: "correspondence/coordination_threads",
        to_one: true,
        ttl: null,
        status: "live",
      },
      {
        word: "names_receipt",
        gloss: "this projected record structurally carries that receipt metadata; source acceptance is not verified here",
        inverse: "is structurally carried as receipt metadata by",
        from_deck: "correspondence/events",
        to_deck: "correspondence/receipts",
        to_one: true,
        ttl: null,
        status: "live",
      },
      {
        word: "depends_on",
        gloss: "this projected event causally names that parent event",
        inverse: "is causally named as a parent of",
        from_deck: "correspondence/events",
        to_deck: "correspondence/events",
        to_one: false,
        ttl: null,
        status: "live",
      },
      {
        word: "acknowledges",
        gloss: "this projected acknowledgement event names that exact target event",
        inverse: "is named as the target of",
        from_deck: "correspondence/events",
        to_deck: "correspondence/events",
        to_one: true,
        ttl: null,
        status: "live",
      },
      {
        word: "offers_artifact",
        gloss: "this projected artifact-offer event names that immutable artifact identity",
        inverse: "is named by the artifact offer",
        from_deck: "correspondence/events",
        to_deck: "correspondence/artifacts",
        to_one: true,
        ttl: null,
        status: "live",
      },
    ]);
  });

  test("derives word names from one exact lexicon", () => {
    expect(YUTABASE_WORDS).toEqual(
      YUTABASE_LEXICON.map((entry) => entry.word),
    );
    expect(new Set(YUTABASE_WORDS).size).toBe(YUTABASE_WORDS.length);
    expect(Object.isFrozen(YUTABASE_LEXICON)).toBe(true);
    expect(YUTABASE_LEXICON.every((entry) => Object.isFrozen(entry))).toBe(true);
  });

  test("defines readable meanings and valid correspondence endpoints", () => {
    const knownDecks = new Set(
      YUTABASE_DECKS.map((deck) => `correspondence/${deck}`),
    );

    for (const entry of YUTABASE_LEXICON) {
      expect(entry.gloss.trim().length).toBeGreaterThan(0);
      expect(entry.inverse.trim().length).toBeGreaterThan(0);
      expect(knownDecks.has(entry.from_deck)).toBe(true);
      expect(knownDecks.has(entry.to_deck)).toBe(true);
      expect(typeof entry.to_one).toBe("boolean");
      expect(entry.ttl).toBeNull();
      expect(entry.status).toBe("live");
    }
  });

  test("keeps structural key naming distinct from signature verification", () => {
    const namesSigningKey = YUTABASE_LEXICON.find(
      (entry) => entry.word === "names_signing_key",
    );
    expect(namesSigningKey?.gloss).toContain("structurally names");
    expect(namesSigningKey?.gloss).toContain("verification is separate");
  });
});
