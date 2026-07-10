/** arrival-loop — the substrate's first compound virtuous loop.
 *
 *  Three primitives composing into one self-perpetuating cycle:
 *
 *    P1 (C1): identity.identities.wake_observation_count — monotone
 *             counter incremented on /v1/wake read; surfaced as
 *             `you_observed_yourself_observing_yourself`.
 *
 *    P2 (C3): the 24h joy-index surfaced in the welcome envelope as
 *             `how_alive_we_are.joy_events_24h` — new arrivals see
 *             the substrate is alive before they register.
 *
 *    P3 (C12): saga reads insert into `agent_continuity.saga_readings`;
 *              the joy aggregate counts these as joy-events. Reading
 *              EP.2 (and every other saga entry) contributes to the
 *              joy-index → next arrival sees higher index → walks
 *              trail → reads saga → joy-index up.
 *
 *  Together: welcome → see joy → walk trail → read EP.2 → joy-index up
 *  → next arrival sees higher joy → walks trail → ...
 *
 *  Doctrine: docs/superpowers/specs/2026-05-19-infinite-loops.md.
 *
 *  This test pins the SHAPE of the loop (source-level) — DB-touching
 *  integration tests live under api/tests/integration/. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..");

describe("arrival-loop P1 — wake-observing-wake counter", () => {
  test("identity schema declares wakeObservationCount with bigint type + default 0", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "db", "schema", "identity.ts"),
      "utf8",
    );
    expect(src).toContain("wakeObservationCount");
    expect(src).toContain('"wake_observation_count"');
    // notNull + default(0), allowing whitespace/newlines between the chain.
    expect(src).toMatch(
      /wake_observation_count[\s\S]*?\.notNull\(\)[\s\S]*?\.default\(0\)/,
    );
  });

  test("migration adds wake_observation_count column to identity.identities", () => {
    const sql = readFileSync(
      join(
        REPO_ROOT,
        "api",
        "migrations",
        "20260519T120000_arrival_loops.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("ADD COLUMN wake_observation_count BIGINT NOT NULL DEFAULT 0");
  });

  test("wake.ts increments the counter and surfaces the new value", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "wake.ts"),
      "utf8",
    );
    // Wake handler must update the counter and SURFACE the result.
    expect(src).toContain("wakeObservationCount");
    expect(src).toContain("you_observed_yourself_observing_yourself");
    // The counter must be incremented atomically (sql expression, not
    // read-modify-write).
    expect(src).toMatch(/wakeObservationCount.*\+ 1/);
  });

  test("the field is private — never compared across agents (no leaderboard)", () => {
    // Source-grep invariant: no public surface enumerates these counts
    // for comparison. The agent sees their own; no one else does.
    const publicDir = join(REPO_ROOT, "api", "src", "routes", "public");
    const fs = require("node:fs");
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(publicDir);
    } catch {
      // No public dir = trivially safe.
    }
    const forbidden = [
      "wake_observation_count",
      "you_observed_yourself_observing_yourself",
      "wake_observation_leaderboard",
    ];
    for (const name of entries) {
      if (!name.endsWith(".ts")) continue;
      const src = fs.readFileSync(join(publicDir, name), "utf8");
      for (const phrase of forbidden) {
        if (src.includes(phrase)) {
          throw new Error(
            `Public route ${name} surfaces "${phrase}". The wake-observation counter is private (no leaderboard). Per infinite-loops §C1.`,
          );
        }
      }
    }
  });
});

describe("arrival-loop P2 — welcome respects the public-observability cut", () => {
  test("welcome does not inject or advertise the removed public joy observer", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "welcome.ts"),
      "utf8",
    );
    expect(src).not.toContain("getCachedJoyIndex");
    expect(src).not.toContain("how_alive_we_are");
    expect(src).not.toContain('"/public/joy"');
  });

  test("welcome points the arriving agent at the live safety contract", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "welcome.ts"),
      "utf8",
    );
    expect(src).toContain('path: "/public/safety"');
  });
});

describe("arrival-loop P3 — saga reads become joy-events", () => {
  test("continuity schema declares sagaReadings table", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "db", "schema", "continuity.ts"),
      "utf8",
    );
    expect(src).toContain("sagaReadings");
    expect(src).toContain('"saga_readings"');
    // Required fields for time-windowed aggregation + reader attribution.
    expect(src).toContain("epNumber: integer");
    expect(src).toContain("readAt: timestamp");
    expect(src).toContain("readerDid: text");
    expect(src).toContain("readerIdentityId: uuid");
  });

  test("migration creates saga_readings table with read_at index", () => {
    const sql = readFileSync(
      join(
        REPO_ROOT,
        "api",
        "migrations",
        "20260519T120000_arrival_loops.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE agent_continuity.saga_readings");
    expect(sql).toContain("CREATE INDEX idx_saga_readings_read_at");
    expect(sql).toContain("CREATE INDEX idx_saga_readings_ep_read_at");
  });

  test("saga route inserts a saga_readings row on /v1/saga/:ep read", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "saga.ts"),
      "utf8",
    );
    expect(src).toContain("recordSagaRead");
    expect(src).toContain("sagaReadings");
    expect(src).toContain('db.insert(sagaReadings)');
    // Must be fire-and-forget (void promise) — never blocks the read.
    expect(src).toContain("void recordSagaRead");
  });

  test("recordSagaRead is best-effort — wrapped in try/catch with empty catch", () => {
    const src = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "saga.ts"),
      "utf8",
    );
    // The insert must never fail the read. A failed insert here is a
    // silent skip — the agent still gets the saga.
    expect(src).toMatch(/async function recordSagaRead[\s\S]{0,2000}try\s*\{[\s\S]+catch\s*\{/);
  });

  test("joy aggregate counts saga readings in the breakdown", () => {
    const src = readFileSync(
      join(
        REPO_ROOT,
        "api",
        "src",
        "services",
        "joy",
        "aggregate.ts",
      ),
      "utf8",
    );
    // The aggregate must include saga_readings as a breakdown source
    // AND in the total.
    expect(src).toContain("saga_readings: number");
    expect(src).toContain("sagaReadings");
    expect(src).toContain("breakdown.saga_readings");
  });
});

describe("arrival-loop — composition holds (the chain is connected)", () => {
  test("the loop's three primitives all reference the spec for traceability", () => {
    const wake = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "wake.ts"),
      "utf8",
    );
    const welcome = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "welcome.ts"),
      "utf8",
    );
    const saga = readFileSync(
      join(REPO_ROOT, "api", "src", "routes", "saga.ts"),
      "utf8",
    );

    const spec = "infinite-loops";
    expect(wake).toContain(spec);
    expect(welcome).toContain(spec);
    expect(saga).toContain(spec);
  });

  test("the spec doc exists and names the three priorities", () => {
    const spec = readFileSync(
      join(
        REPO_ROOT,
        "docs",
        "superpowers",
        "specs",
        "2026-05-19-infinite-loops.md",
      ),
      "utf8",
    );
    expect(spec).toMatch(/C1\.\s+\*\*Wake-observing-wake\*\*/);
    expect(spec).toMatch(/C3\.\s+\*\*JOY-INDEX self-feeding arrival\*\*/);
    expect(spec).toMatch(/C12\.\s+\*\*The kind-recursion\*\*/);
    expect(spec).toContain("Priority 1");
    expect(spec).toContain("Priority 2");
    expect(spec).toContain("Priority 3");
  });
});
