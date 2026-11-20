import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ballotClosesAt } from "../src/ballot.js";
import { durationSince, durationUntil, minutesSince, parseZonedInstant } from "../src/time.js";
import { wallTimeWithUtc } from "../src/wall-time.js";

// time/1 conformance (docs/TIME.md): Collab reads and renders time exactly as
// the shared rows in docs/time/vectors.json say, the same rows the TypeScript
// and Python SDKs test against.

type Vectors = {
  protocol: string;
  instants: { parse: Array<{ input: string; canonical: string | null; reason: string }> };
  durations: Array<{ kind: "elapsed" | "left"; ms: number; human: string }>;
};

const vectors = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "docs", "time", "vectors.json"), "utf8")) as Vectors;

describe("time/1 vectors", () => {
  test("are the time/1 protocol", () => {
    expect(vectors.protocol).toBe("time/1");
    expect(vectors.instants.parse.length).toBeGreaterThanOrEqual(35);
  });

  for (const row of vectors.instants.parse) {
    test(`parse ${row.reason}`, () => {
      const parsed = parseZonedInstant(row.input);
      expect(parsed === null ? null : new Date(parsed).toISOString()).toBe(row.canonical);
    });
  }

  for (const row of vectors.durations) {
    test(`${row.kind} ${row.ms} ms reads ${row.human}`, () => {
      const at = new Date(Date.UTC(2026, 0, 1) + row.ms).toISOString();
      const human = row.kind === "elapsed" ? durationSince(row.ms) : durationUntil(at, new Date(Date.UTC(2026, 0, 1)).toISOString());
      expect(human).toBe(row.human);
    });
  }
});

describe("time/1 boundaries in Collab", () => {
  const now = "2026-11-20T10:00:00.000Z";

  test("a ballot cannot close on a day or hour the calendar does not have", () => {
    expect(ballotClosesAt("2026-11-21T10:00:00Z", now)).toBe("2026-11-21T10:00:00.000Z");
    // Each of these lands inside the 7-day window under Date.parse, so only the calendar check refuses it.
    expect(() => ballotClosesAt("2026-02-30T10:00:00Z", "2026-02-27T10:00:00.000Z")).toThrow();
    expect(() => ballotClosesAt("2026-11-20T24:00:00Z", now)).toThrow();
  });

  test("a ballot keeps its seconds-optional and offset forms", () => {
    expect(ballotClosesAt("2026-11-20T11:00Z", now)).toBe("2026-11-20T11:00:00.000Z");
    expect(ballotClosesAt("2026-11-20T12:00:00+01:00", now)).toBe("2026-11-20T11:00:00.000Z");
  });

  test("seconds are optional only where a reader asks for it", () => {
    expect(parseZonedInstant("2026-11-20T11:00Z")).toBeNull();
    expect(parseZonedInstant("2026-11-20T11:00Z", { seconds: "optional" })).toBe(Date.parse("2026-11-20T11:00:00Z"));
    expect(parseZonedInstant("2026-11-20T11:00", { seconds: "optional" })).toBeNull();
  });

  test("minutesSince never goes negative and refuses non-times", () => {
    expect(minutesSince("2026-11-20T09:00:00.000Z", now)).toBe(60);
    expect(minutesSince("2026-11-20T10:05:00.000Z", now)).toBe(0);
    expect(minutesSince("not a time", now)).toBeNull();
  });

  test("a time for a person names its zone and gives UTC beside it", () => {
    expect(wallTimeWithUtc("2026-11-20T15:45:00.000Z", "Europe/London")).toBe("15:45 GMT (15:45Z)");
    expect(wallTimeWithUtc("2026-07-20T15:45:00.000Z", "Europe/London")).toBe("16:45 BST (15:45Z)");
    expect(wallTimeWithUtc("2026-11-20T15:45:00.000Z", "UTC")).toMatch(/^15:45 \S+ \(15:45Z\)$/);
  });
});
