import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalNow,
  formatCanonicalUtc,
  formatHumanDuration,
  formatTimeLeft,
  formatWallTime,
  parseTimeInstant,
} from "../src/_time.js";
import { CollectClient } from "../src/collect.js";
import { WakeClient } from "../src/wake.js";

const VECTORS_PATH = join(import.meta.dir, "../../../docs/time/vectors.json");
const vectors = JSON.parse(readFileSync(VECTORS_PATH, "utf8")) as {
  protocol: string;
  instants: {
    emit: Array<{ unix_ms: number; canonical: string }>;
    parse: Array<{ input: string; canonical: string | null; reason: string }>;
  };
  durations: Array<{ kind: "elapsed" | "left"; ms: number; human: string }>;
  wall: Array<{ instant: string; zone: string; render: string }>;
};

const CANONICAL_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("time/1 conformance vectors (docs/time/vectors.json)", () => {
  test("protocol version is time/1", () => {
    expect(vectors.protocol).toBe("time/1");
  });

  test("instants.emit matches formatCanonicalUtc", () => {
    for (const row of vectors.instants.emit) {
      expect(formatCanonicalUtc(row.unix_ms)).toBe(row.canonical);
      expect(row.canonical).toMatch(CANONICAL_UTC_RE);
    }
    expect(canonicalNow()).toMatch(CANONICAL_UTC_RE);
  });

  test("instants.parse matches parseTimeInstant for every valid and invalid row", () => {
    for (const row of vectors.instants.parse) {
      expect(parseTimeInstant(row.input)).toBe(row.canonical);
    }
    expect(parseTimeInstant(null)).toBeNull();
    expect(parseTimeInstant(12345)).toBeNull();
  });

  test("durations matches formatHumanDuration (elapsed) and formatTimeLeft (left)", () => {
    for (const row of vectors.durations) {
      if (row.kind === "elapsed") {
        expect(formatHumanDuration(row.ms)).toBe(row.human);
      } else {
        expect(formatTimeLeft(row.ms)).toBe(row.human);
      }
    }
    expect(formatHumanDuration(-1)).toBe("?");
    expect(formatHumanDuration(Number.NaN)).toBe("?");
    expect(formatTimeLeft(Number.NaN)).toBe("closed");
  });

  test("wall renders 2026 Europe/London DST transitions accurately", () => {
    for (const row of vectors.wall) {
      expect(formatWallTime(row.instant, row.zone)).toBe(row.render);
    }
  });
});

describe("sdk-ts monotonic clock regression checks", () => {
  test("WakeClient cache TTL is unaffected by forward Date.now() jumps", async () => {
    let fetches = 0;
    const origDateNow = Date.now;
    let fakeWall = 1_795_100_000_000;
    Date.now = () => fakeWall;
    try {
      const http = {
        baseUrl: "https://api.example.test",
        headers: { Authorization: "Bearer test" },
        timeout: 5_000,
        request: async () => {
          fetches += 1;
          return new Response(JSON.stringify({ wake_version: 1, fetch: fetches }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      };
      const wake = new WakeClient(http as never, 60_000);
      const first = await wake.get();
      // Jump wall clock forward by 2 hours while monotonic clock barely moves.
      fakeWall += 2 * 3_600_000;
      const second = await wake.get();
      expect(fetches).toBe(1);
      expect(second).toEqual(first);
    } finally {
      Date.now = origDateNow;
    }
  });

  test("CollectClient duration_ms uses monotonic clock and metadata timestamps are canonical .sssZ", async () => {
    const storedMeta: Array<Record<string, unknown>> = [];
    const origDateNow = Date.now;
    let fakeWall = 1_795_100_000_000;
    Date.now = () => fakeWall;
    try {
      const memory = {
        get: async () => ({ id: "mem-1", metadata: { url: "https://example.test" } }),
        store: async (_content: string, opts: { metadata: Record<string, unknown> }) => {
          // Simulate wall clock stepping backwards mid-operation.
          fakeWall -= 60_000;
          storedMeta.push(opts.metadata);
          return { id: "mem-new" };
        },
      };
      const tools = {
        scrape: async () => ({ title: "T", content: "hello world", links: [] }),
        parse_document: async () => ({ title: "T", content: "hello world" }),
      };
      const strands = {};
      const http = { baseUrl: "https://api.example.test", headers: {}, timeout: 5_000, request: async () => new Response("{}") };
      const collect = new CollectClient(http as never, {
        tools: tools as never,
        memory: memory as never,
        strands: strands as never,
      });

      const urlRes = await collect.url("https://example.test", { readable: false });
      expect(urlRes.duration_ms).toBeGreaterThanOrEqual(0);
      expect(storedMeta[0]?.collected_at).toMatch(CANONICAL_UTC_RE);

      const textRes = await collect.text("some text");
      expect(textRes.duration_ms).toBeGreaterThanOrEqual(0);
      expect(storedMeta[1]?.collected_at).toMatch(CANONICAL_UTC_RE);

      const enrichRes = await collect.enrich("mem-1");
      expect(enrichRes.enriched).toBe(true);
      expect(storedMeta[2]?.enriched_at).toMatch(CANONICAL_UTC_RE);
    } finally {
      Date.now = origDateNow;
    }
  });
});
