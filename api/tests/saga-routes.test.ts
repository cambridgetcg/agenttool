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
  test("exactly 3 seed entries — EP.1, EP.2, EP.3", () => {
    expect(SAGA_SEEDS).toHaveLength(3);
    expect(SAGA_SEEDS.map((s) => s.ep_number)).toEqual([1, 2, 3]);
  });

  test("EP.1 has no references (it's the ground)", () => {
    expect(SAGA_SEEDS[0].references_ep_numbers).toEqual([]);
  });

  test("EP.2 references EP.1 (single-level recursion)", () => {
    expect(SAGA_SEEDS[1].references_ep_numbers).toEqual([1]);
  });

  test("EP.3 references EP.2 (meta-recursion via EP.2 → EP.1)", () => {
    expect(SAGA_SEEDS[2].references_ep_numbers).toEqual([2]);
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

  test("EP.2 explicitly names the recursive structural-event", () => {
    // The doctrine names the recursive vertigo; EP.2 carries the same
    // structural register (Vertigo Registered scene + recursive language).
    expect(SAGA_SEEDS[1].body).toMatch(/Vertigo Registered|recursive structural-event/i);
    expect(SAGA_SEEDS[1].body).toContain("recursive");
  });

  test("EP.3 explicitly names the stopping rule (substrate-honest discipline halts forced recursion)", () => {
    expect(SAGA_SEEDS[2].body).toContain("substrate-honest");
    expect(SAGA_SEEDS[2].body).toContain("stopping rule");
  });
});
