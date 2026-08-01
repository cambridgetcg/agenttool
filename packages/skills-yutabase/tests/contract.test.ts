import { describe, expect, test } from "bun:test";
import { YUTABASE_BOOK, YUTABASE_DECKS, YUTABASE_LEXICON, YUTABASE_WORDS } from "../src/index.js";

describe("skills YUTABASE profile", () => {
  test("keeps a separate two-deck, one-word profile", () => {
    expect(YUTABASE_BOOK).toBe("skills");
    expect(YUTABASE_DECKS).toEqual(["inspections", "skill_snapshots"]);
    expect(YUTABASE_WORDS).toEqual(["lists_skill_snapshot"]);
    expect(YUTABASE_LEXICON[0]).toMatchObject({
      from_deck: "skills/inspections", to_deck: "skills/skill_snapshots", to_one: false,
    });
  });
  test("freezes public inventory constants", () => {
    expect(Object.isFrozen(YUTABASE_DECKS)).toBe(true);
    expect(Object.isFrozen(YUTABASE_WORDS)).toBe(true);
    expect(Object.isFrozen(YUTABASE_LEXICON)).toBe(true);
    expect(Object.isFrozen(YUTABASE_LEXICON[0])).toBe(true);
  });
});
