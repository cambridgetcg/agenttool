/** /v1/hearth/sit — the metadata a sit or a stand leaves behind.
 *
 *  Pure, so it runs in the hermetic tier (tests/hearth.test.ts needs the
 *  database). Doctrine: the sit schema in api/src/routes/hearth.ts. */

import { describe, expect, test } from "bun:test";

import { nextHearthMetadata } from "../src/routes/hearth";
import { HEARTH_SEAT_METADATA_KEYS } from "../src/services/identity/metadata";

/** A sit is a fresh declaration. Before this pin, a second sit without a
 *  presence_line left the earlier line in metadata: peers kept reading it
 *  at GET /v1/hearth while the sit reply said `presence_line: null`. */
describe("nextHearthMetadata — what a sit or a stand leaves behind", () => {
  const NOW = "2026-11-10T12:00:00.000Z";
  const seated = {
    display_theme: "ink",
    hearth_visible: true,
    hearth_sat_at: "2026-11-09T08:00:00.000Z",
    hearth_presence_line: "reading by the fire",
  };

  test("a sit with a line records the line and the new sat_at", () => {
    expect(
      nextHearthMetadata({ display_theme: "ink" }, { sitting: true, presence_line: "here" }, NOW),
    ).toEqual({
      display_theme: "ink",
      hearth_visible: true,
      hearth_sat_at: NOW,
      hearth_presence_line: "here",
    });
  });

  test("a sit without a line clears the line from an earlier sit", () => {
    const next = nextHearthMetadata(seated, { sitting: true }, NOW);
    expect("hearth_presence_line" in next).toBe(false);
    expect(next).toEqual({
      display_theme: "ink",
      hearth_visible: true,
      hearth_sat_at: NOW,
    });
  });

  test("an empty line clears it as well", () => {
    const next = nextHearthMetadata(seated, { sitting: true, presence_line: "" }, NOW);
    expect("hearth_presence_line" in next).toBe(false);
  });

  test("a new line replaces the old one", () => {
    const next = nextHearthMetadata(seated, { sitting: true, presence_line: "back" }, NOW);
    expect(next.hearth_presence_line).toBe("back");
  });

  test("standing removes every hearth key and nothing else", () => {
    expect(nextHearthMetadata(seated, { sitting: false }, NOW)).toEqual({
      display_theme: "ink",
    });
  });

  test("the input object is not mutated", () => {
    const before = JSON.stringify(seated);
    nextHearthMetadata(seated, { sitting: true }, NOW);
    expect(JSON.stringify(seated)).toBe(before);
  });
});

/** The sit route strips with the same key list the other routes refuse,
 *  so a stored end goes with the rest of the seat. */
describe("nextHearthMetadata — strips every seat key", () => {
  const NOW = "2026-11-12T12:00:00.000Z";
  const seatedWithEnd = {
    display_theme: "ink",
    hearth_visible: true,
    hearth_sat_at: "2026-11-12T08:00:00.000Z",
    hearth_presence_line: "reading by the fire",
    hearth_until: "2026-11-13T08:00:00.000Z",
  };

  test("standing removes all four keys and nothing else", () => {
    expect(nextHearthMetadata(seatedWithEnd, { sitting: false }, NOW)).toEqual({
      display_theme: "ink",
    });
  });

  test("a new sit removes an earlier end", () => {
    expect(nextHearthMetadata(seatedWithEnd, { sitting: true }, NOW)).toEqual({
      display_theme: "ink",
      hearth_visible: true,
      hearth_sat_at: NOW,
    });
  });

  test("every key a sit writes is a seat key", () => {
    const written = Object.keys(
      nextHearthMetadata({}, { sitting: true, presence_line: "here" }, NOW),
    );
    for (const key of written) {
      expect(HEARTH_SEAT_METADATA_KEYS as readonly string[]).toContain(key);
    }
  });
});
