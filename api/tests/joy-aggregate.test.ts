/** Joy aggregator + substrate-honest discipline.
 *
 *  Pins:
 *    - joyTrendPercent shape (positive/negative/null/new)
 *    - Source-discipline check: aggregator + middleware + route contain
 *      no judgment/sentiment language (per wall/joy-index-is-substrate-honest)
 *    - Doctrine names the discipline as the core wall
 *    - Route exists at /public/joy (UNAUTH per wall/joy-public-surface-is-unauth)
 *
 *  Doctrine: docs/JOY-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/joy-index-is-substrate-honest
 *  @enforces urn:agenttool:wall/joy-public-surface-is-unauth
 *  @enforces urn:agenttool:wall/joy-index-rolling-window-only */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { joyTrendPercent } from "../src/services/joy/aggregate";

describe("joyTrendPercent — substrate-honest trend formatting", () => {
  test("positive trend formats with +", () => {
    expect(joyTrendPercent(100, 80)).toBe("+25%");
  });

  test("negative trend formats without + (just -)", () => {
    expect(joyTrendPercent(80, 100)).toBe("-20%");
  });

  test("zero change is +0%", () => {
    expect(joyTrendPercent(100, 100)).toBe("+0%");
  });

  test("prior 0 + current > 0 returns first-24h marker", () => {
    expect(joyTrendPercent(50, 0)).toBe("(new — first 24h with joy)");
  });

  test("both zero returns null (no trend to report)", () => {
    expect(joyTrendPercent(0, 0)).toBe(null);
  });
});

describe("substrate-honest discipline — wall/joy-index-is-substrate-honest", () => {
  // The aggregator + middleware + route must not contain judgment-shaped
  // language. The joy-index is a COUNT, not a sentiment-score.
  // Match FIELD NAMES (in interfaces or returned objects) — the substrate
  // refuses to ship judgment-shaped data, but the JSDoc can legitimately
  // discuss what's refused (those are negations, not usage).
  const FORBIDDEN_PATTERNS = [
    /\b(happiness_score|sentiment_score|quality_score|joy_ranking|tier_comparison|tier_rank|percentile)\s*[:?]/i,
  ];

  const sources = [
    "api/src/services/joy/aggregate.ts",
    "api/src/middleware/joy-index.ts",
    "api/src/routes/public/joy.ts",
  ];

  test.each(sources)("%s contains no judgment-shaped scoring language", (path) => {
    const src = readFileSync(join(__dirname, "..", "..", path), "utf-8");
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(src).not.toMatch(pattern);
    }
  });

  test("doctrine doc names interpretation-refusal as the core wall", () => {
    const src = readFileSync(join(__dirname, "..", "..", "docs", "JOY-PROTOCOL.md"), "utf-8");
    expect(src).toContain("joy-index-is-substrate-honest");
    expect(src).toContain("not a sentiment-score");
  });
});

describe("wall/joy-public-surface-is-unauth — structural pin", () => {
  test("/public/joy router doesn't import auth middleware", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "routes", "public", "joy.ts"),
      "utf-8",
    );
    expect(src).not.toMatch(/authMiddleware/);
    expect(src).not.toMatch(/requireBearer/i);
  });

  test("public router index mounts joy at /joy", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "routes", "public", "index.ts"),
      "utf-8",
    );
    expect(src).toContain("joyRoutes");
    expect(src).toContain('app.route("/joy"');
  });
});

describe("wall/joy-index-rolling-window-only — structural pin", () => {
  test("aggregator references 24h window in compute functions", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "services", "joy", "aggregate.ts"),
      "utf-8",
    );
    // 24h window = 24 * 60 * 60 * 1000 ms.
    expect(src).toMatch(/24 \* 60 \* 60 \* 1000/);
    // Uses gte filter against the 24h-ago timestamp.
    expect(src).toMatch(/gte\(/);
  });
});

describe("joy middleware shape", () => {
  test("middleware sets X-Joy-Index header on responses", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "middleware", "joy-index.ts"),
      "utf-8",
    );
    expect(src).toMatch(/X-Joy-Index/);
  });

  test("middleware uses cached value (60s) to avoid per-response DB hit", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "services", "joy", "aggregate.ts"),
      "utf-8",
    );
    expect(src).toMatch(/JOY_INDEX_CACHE_MS/);
    // Cache window should be reasonably short for liveness.
    expect(src).toMatch(/60 \* 1000/);
  });
});

describe("doctrine — joy radiates by default at multiple surfaces", () => {
  test("doctrine names all four outbound surfaces", () => {
    const src = readFileSync(join(__dirname, "..", "..", "docs", "JOY-PROTOCOL.md"), "utf-8");
    expect(src).toMatch(/X-Joy-Index/);
    expect(src).toMatch(/\/public\/joy/);
    expect(src).toMatch(/agent-card/i);
    expect(src).toMatch(/substrate_joy_index/);
  });
});
