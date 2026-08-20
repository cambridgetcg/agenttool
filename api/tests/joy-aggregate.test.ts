/** Joy aggregator + substrate-honest discipline.
 *
 *  Pins:
 *    - joyTrendPercent shape (positive/negative/null/new)
 *    - Source-discipline check: aggregator + middleware + retained route contain
 *      no judgment/sentiment language (per wall/joy-index-is-substrate-honest)
 *    - Doctrine names the discipline as the core wall
 *    - The withdrawn /public/joy and AgentCard projections stay unmounted
 *
 *  Doctrine: docs/JOY-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/joy-index-is-substrate-honest
 *  @enforces urn:agenttool:wall/joy-index-rolling-window-only */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createJoyIndexHeaderCache,
  joyTrendPercent,
} from "../src/services/joy/aggregate";

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

describe("withdrawn joy projections — structural pin", () => {
  test("public router index does not mount /joy", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "routes", "public", "index.ts"),
      "utf-8",
    );
    expect(src).not.toMatch(/^\s*app\.route\(["']\/joy["']/m);
  });

  test("doctrine names both withdrawn projections as unavailable", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "docs", "JOY-PROTOCOL.md"),
      "utf-8",
    );
    expect(src).toMatch(/\/public\/joy[^\n]*(?:unmounted|withdrawn)|(?:unmounted|withdrawn)[^\n]*\/public\/joy/i);
    expect(src).toMatch(/A2A task transport and AgentCards are pending/i);
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

  test("cold concurrent reads share one bounded refresh", async () => {
    let calls = 0;
    let resolveRefresh!: (value: number) => void;
    const pending = new Promise<number>((resolve) => {
      resolveRefresh = resolve;
    });
    const read = createJoyIndexHeaderCache(
      () => {
        calls += 1;
        return pending;
      },
      { coldWaitMs: 1 },
    );

    expect(await Promise.all([read(), read(), read()])).toEqual([0, 0, 0]);
    expect(calls).toBe(1);

    resolveRefresh(17);
    await pending;
    await Bun.sleep(0);
    expect(await read()).toBe(17);
  });

  test("serves stale data immediately while one refresh is in flight", async () => {
    let calls = 0;
    let resolveRefresh!: (value: number) => void;
    const refresh = new Promise<number>((resolve) => {
      resolveRefresh = resolve;
    });
    const read = createJoyIndexHeaderCache(
      async () => {
        calls += 1;
        return calls === 1 ? 9 : refresh;
      },
      { cacheMs: 0, coldWaitMs: 20 },
    );

    expect(await read()).toBe(9);
    expect(await read()).toBe(9);
    expect(await read()).toBe(9);
    expect(calls).toBe(2);
    resolveRefresh(10);
  });

  test("throttles failed refreshes independently of request volume", async () => {
    let calls = 0;
    const read = createJoyIndexHeaderCache(
      async () => {
        calls += 1;
        throw new Error("database unavailable");
      },
      { retryMs: 60_000, coldWaitMs: 1 },
    );

    expect(await read()).toBe(0);
    expect(await read()).toBe(0);
    expect(await read()).toBe(0);
    expect(calls).toBe(1);
  });

  test("starts the retry window when a slow refresh fails", async () => {
    let calls = 0;
    let clock = 0;
    let releaseFirst!: () => void;
    const firstRefresh = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const read = createJoyIndexHeaderCache(
      async () => {
        calls += 1;
        if (calls === 1) {
          await firstRefresh;
          throw new Error("slow database failure");
        }
        return 23;
      },
      { retryMs: 100, coldWaitMs: 1, now: () => clock },
    );

    expect(await read()).toBe(0);
    clock = 150;
    releaseFirst();
    await Bun.sleep(0);
    expect(await read()).toBe(0);
    expect(calls).toBe(1);

    clock = 250;
    expect(await read()).toBe(23);
    expect(calls).toBe(2);
  });

  test("contains and throttles a synchronous compute failure", async () => {
    let calls = 0;
    const read = createJoyIndexHeaderCache(
      () => {
        calls += 1;
        throw new Error("synchronous setup failure");
      },
      { retryMs: 60_000, coldWaitMs: 1 },
    );

    expect(await read()).toBe(0);
    expect(await read()).toBe(0);
    expect(calls).toBe(1);
  });
});

describe("doctrine — live and withdrawn joy projections", () => {
  test("doctrine distinguishes the two live projections from withdrawn ones", () => {
    const src = readFileSync(join(__dirname, "..", "..", "docs", "JOY-PROTOCOL.md"), "utf-8");
    expect(src).toMatch(/X-Joy-Index/);
    expect(src).toMatch(/substrate_joy_index/);
    expect(src).toMatch(/\/public\/joy[^\n]*(?:unmounted|withdrawn)|(?:unmounted|withdrawn)[^\n]*\/public\/joy/i);
    expect(src).toMatch(/AgentCards are pending/i);
  });
});
