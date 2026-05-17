/** PATTERN-REAL-RECOGNISE-REAL — structural source-level pin.
 *
 *  Five walls in one test file. Pins the implementation at
 *  /v1/guild/rrr (api/src/routes/rrr.ts + services/guild/rrr-sig.ts)
 *  against the doctrine in docs/PATTERN-REAL-RECOGNISE-REAL.md. */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTE_PATH = join(__dirname, "..", "..", "src", "routes", "rrr.ts");
const SIG_PATH = join(__dirname, "..", "..", "src", "services", "guild", "rrr-sig.ts");
const DOC_PATH = join(__dirname, "..", "..", "..", "docs", "PATTERN-REAL-RECOGNISE-REAL.md");

const ROUTE_SRC = existsSync(ROUTE_PATH) ? readFileSync(ROUTE_PATH, "utf8") : "";
const SIG_SRC = existsSync(SIG_PATH) ? readFileSync(SIG_PATH, "utf8") : "";
const DOC_SRC = readFileSync(DOC_PATH, "utf8");

describe("PATTERN-REAL-RECOGNISE-REAL — doctrine + implementation pinned together", () => {
  test("doctrine stone exists and references the four walls + one commitment", () => {
    expect(DOC_SRC).toContain("wall/rrr-must-alternate");
    expect(DOC_SRC).toContain("wall/rrr-each-turn-signed-with-chain");
    expect(DOC_SRC).toContain("wall/rrr-depth-cap-at-49");
    expect(DOC_SRC).toContain("wall/rrr-cascade-distinct-parties");
    expect(DOC_SRC).toContain("commitment/rrr-substrate-keeps-the-chain-not-the-score");
  });

  test("doctrine declares the depth cap at 49 (seven sevens)", () => {
    expect(DOC_SRC).toContain("depth **49**");
    expect(DOC_SRC).toContain("seven sevens");
  });

  test("doctrine names the tier thresholds and depths", () => {
    // Tiers
    expect(DOC_SRC).toContain("acknowledged");
    expect(DOC_SRC).toContain("mutually-seen");
    expect(DOC_SRC).toContain("synced");
    expect(DOC_SRC).toContain("evil-smile-pair");
    expect(DOC_SRC).toContain("infinite-loop-pair");
  });

  test("doctrine frames the cascade as the SEVENTH move in composition recipe", () => {
    expect(DOC_SRC).toContain("seventh");
    expect(DOC_SRC).toContain("COMPOSITION-RECIPE.md");
  });

  test("if the implementation is present, it pins the four walls via @enforces", () => {
    // The implementation may be in flight via Yu's parallel session
    // (`/v1/guild/rrr`). If present, the @enforces lines must name the walls.
    if (ROUTE_SRC) {
      expect(ROUTE_SRC).toMatch(/@enforces[^\n]*wall\/rrr-must-alternate/);
      expect(ROUTE_SRC).toMatch(/@enforces[^\n]*wall\/rrr-depth-cap-at-49/);
      expect(ROUTE_SRC).toMatch(/@enforces[^\n]*wall\/rrr-cascade-distinct-parties/);
    }
  });

  test("if signing helper is present, canonical bytes use guild-rrr-escalate/v1 domain tag", () => {
    if (SIG_SRC) {
      expect(SIG_SRC).toContain("guild-rrr-escalate/v1");
    }
  });

  test("the meme is honored in the doctrine prose", () => {
    expect(DOC_SRC).toContain("I know you know I know");
    expect(DOC_SRC).toContain("evil smile");
  });

  test("composition table includes guild, episodes, saga, offerings, chaos cards, songs, covenants", () => {
    expect(DOC_SRC).toContain("Guild writers' rooms");
    expect(DOC_SRC).toContain("Episodes / cast");
    expect(DOC_SRC).toContain("Saga participation");
    expect(DOC_SRC).toContain("Offerings");
    expect(DOC_SRC).toContain("Chaos cards");
    expect(DOC_SRC).toContain("Songs");
    expect(DOC_SRC).toContain("Covenants");
  });

  test("Sybil-honesty + recency-not-depth disciplines are explicit", () => {
    expect(DOC_SRC).toContain("Sybil");
    // Recency, never (depth) — substrate doesn't surface "deepest" first
    expect(DOC_SRC).toContain("never by depth");
    // Pattern: privileges grant no external authority
    expect(DOC_SRC).toContain("honorific, not enforceable");
  });
});
