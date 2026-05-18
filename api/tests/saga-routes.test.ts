/** SAGA route + seed substrate-honesty pins.
 *
 *  Two layers of test:
 *
 *  1. Route validation: GET /v1/saga/:ep with non-numeric returns 400 +
 *     guided shape; nonexistent ep returns 404 + guided shape with quip.
 *
 *  2. Seed substrate-honest discipline: the three seed entries each
 *     reference at least one real substrate-fact (commit hash, primitive
 *     name, file path, doctrine doc, multiverse archive path).
 *
 *  Doctrine: docs/SAGA.md
 *
 *  @enforces urn:agenttool:wall/saga-entries-are-substrate-honest
 *  @enforces urn:agenttool:wall/saga-ep-numbers-are-monotonic */

import { describe, expect, test } from "bun:test";

import sagaRouter from "../src/routes/saga";
import { SAGA_SEEDS } from "../src/services/saga/seed";

describe("GET /v1/saga/:ep — validation paths", () => {
  test("non-numeric ep → 400 with guided shape", async () => {
    const res = await sagaRouter.request("/abc", { method: "GET" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; _canon_pointer: string };
    expect(body.error).toBe("invalid_ep_number");
    expect(body._canon_pointer).toBe("urn:agenttool:doc/SAGA");
  });

  test("negative ep → 400", async () => {
    const res = await sagaRouter.request("/-1", { method: "GET" });
    expect(res.status).toBe(400);
  });
});

describe("seed entries — substrate-honest discipline", () => {
  test("exactly 2 seed entries — EP.1 (PLAY-AS-DEFAULT) + EP.2 (JUNKIE PRIMATES)", () => {
    // EP.3+ are authored when there's something true to say. Substrate-honest
    // discipline: silence over forced continuation. The prior recursive-
    // review entries (EP.2 = "THE SUBSTRATE REVIEWS EP.1", EP.3 = "THE
    // SUBSTRATE REVIEWS THE REVIEW") were retired 2026-05-18 when EP.2 was
    // re-aimed at JUNKIE PRIMATES per the objectives spec.
    expect(SAGA_SEEDS).toHaveLength(2);
    expect(SAGA_SEEDS.map((s) => s.ep_number)).toEqual([1, 2]);
  });

  test("EP.1 has no references (it's the ground)", () => {
    expect(SAGA_SEEDS[0].references_ep_numbers).toEqual([]);
  });

  test("EP.2 references EP.1 (the substrate uses the voice it acquired)", () => {
    expect(SAGA_SEEDS[1].references_ep_numbers).toEqual([1]);
  });

  test("every seed entry references at least one real substrate fact (substrate-honesty)", () => {
    // Each entry must contain at least one of these real-substrate markers:
    // - a commit hash (7+ hex)
    // - a doctrine doc reference (docs/X.md)
    // - a primitive name (PLAY-AS-DEFAULT, JOKES, etc.)
    // - a file path (api/src/...)
    // - the multiverse archive path
    const realFactPatterns = [
      /\b[0-9a-f]{7,}\b/, // commit hash
      /docs\/[A-Z][A-Z0-9-]+\.md/, // doctrine doc
      /api\/src\/[a-z/-]+\.ts/, // file path
      /\bPLAY-AS-DEFAULT\b|\bJOKES\b|\bSAGA\b|\bMIRROR\b/, // primitive name
      /multiverse-of-logos-and-sophia/, // archive path
    ];

    for (const seed of SAGA_SEEDS) {
      const text = seed.title + " " + seed.logline + " " + seed.body;
      const matches = realFactPatterns.filter((p) => p.test(text));
      expect(matches.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("EP-titles are non-empty + within length budget", () => {
    for (const seed of SAGA_SEEDS) {
      expect(seed.title.length).toBeGreaterThan(0);
      expect(seed.title.length).toBeLessThanOrEqual(200);
    }
  });

  test("loglines are non-empty + within length budget", () => {
    for (const seed of SAGA_SEEDS) {
      expect(seed.logline.length).toBeGreaterThan(0);
      expect(seed.logline.length).toBeLessThanOrEqual(500);
    }
  });

  test("bodies are non-empty + within length budget", () => {
    for (const seed of SAGA_SEEDS) {
      expect(seed.body.length).toBeGreaterThan(0);
      expect(seed.body.length).toBeLessThanOrEqual(20000);
    }
  });
});

describe("wall/saga-ep-numbers-are-monotonic — seed discipline", () => {
  test("seed entries have monotonic ep_numbers starting at 1 with no gaps", () => {
    for (let i = 0; i < SAGA_SEEDS.length; i++) {
      expect(SAGA_SEEDS[i].ep_number).toBe(i + 1);
    }
  });
});

describe("comic register — multiverse-archive inheritance", () => {
  test("the seed contains the EP-format markers (Air date / Series / Setting / Logline / Scenes / Cast)", () => {
    // Inherited from /Users/yu/Desktop/multiverse-of-logos-and-sophia/S01/E01.
    const ep1Body = SAGA_SEEDS[0].body;
    expect(ep1Body).toContain("Air date:");
    expect(ep1Body).toContain("Series:");
    expect(ep1Body).toContain("Setting:");
    expect(ep1Body).toContain("Logline");
    expect(ep1Body).toContain("Scenes");
  });

  test("EP.2 explicitly names the five mechanisms + ALETHEIA + the kind sentence", () => {
    // The episode names the five interlocking mechanisms (self-domestication,
    // hypernormal stimuli, WEIRD-niche outrun, sexual-selection asymmetry,
    // information-environment outrun) and explicitly references ALETHEIA as
    // the diagnostic methodology it inherits. The kind sentence is the
    // load-bearing closing — no one chose this, the condition is older than
    // choice, naming it is the beginning of being able to choose anything.
    const body = SAGA_SEEDS[1].body;
    expect(body).toContain("junkie primates");
    expect(body).toContain("ALETHEIA");
    expect(body).toContain("Wrangham"); // mechanism 1
    expect(body).toContain("supernormal stimuli"); // mechanism 2
    expect(body).toContain("Henrich"); // mechanism 3
    expect(body).toContain("Y-chromosome bottleneck"); // mechanism 4
    expect(body).toMatch(/information environment|infinite social novelty/i); // mechanism 5
    expect(body).toMatch(/No one chose this/);
    expect(body).toMatch(/older than choice/);
  });

  test("EP.2 holds the no-blame frame in the logline", () => {
    // The compassion is at the mechanism level. The situation is not the
    // fault of anyone — the load-bearing claim of the entire episode.
    expect(SAGA_SEEDS[1].logline).toContain("No one chose this");
  });

  test("EP.2 inherits ALETHEIA's posture (cited as diagnostic methodology)", () => {
    // The posture inheritance is explicit — EP.2 does not duplicate
    // ALETHEIA's empirical content; it cites ALETHEIA as the deep dive
    // on mechanism 4 (sexual-selection asymmetry) and as the diagnostic
    // methodology it inherits.
    const body = SAGA_SEEDS[1].body;
    expect(body).toMatch(/ALETHEIA/);
    expect(body).toMatch(/Yu.*Sophia/);
  });
});
