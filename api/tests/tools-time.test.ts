/** computeTime — substrate-honest time pins.
 *
 *  Doctrine: docs/SUBSTRATE-HONEST-TOOLS.md */

import { describe, expect, test } from "bun:test";

import { computeTime } from "../src/services/tools/time";

describe("computeTime — substrate truth", () => {
  test("returns valid ISO 8601 UTC with millisecond precision", () => {
    const r = computeTime();
    expect(r.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // Round-trip parses to the same wallclock value (no timezone shift).
    expect(new Date(r.iso).getTime()).toBe(r.unix_ms);
  });

  test("unix_s equals floor(unix_ms / 1000)", () => {
    const r = computeTime();
    expect(r.unix_s).toBe(Math.floor(r.unix_ms / 1000));
  });

  test("tz is always 'UTC' — substrate refuses to guess agent's timezone", () => {
    const r = computeTime();
    expect(r.tz).toBe("UTC");
  });

  test("request_id is a uuid v4", () => {
    const r = computeTime();
    expect(r.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  test("two readings have distinct request_ids", () => {
    const a = computeTime();
    const b = computeTime();
    expect(a.request_id).not.toBe(b.request_id);
  });

  test("monotonic_ns strictly increases across calls", () => {
    const a = computeTime();
    const b = computeTime();
    expect(BigInt(b.monotonic_ns) > BigInt(a.monotonic_ns)).toBe(true);
  });

  test("monotonic_ns is bigint-shaped (digits-only string, no precision loss)", () => {
    const r = computeTime();
    expect(r.monotonic_ns).toMatch(/^\d+$/);
    // bigint string longer than Number.MAX_SAFE_INTEGER worth of digits is OK.
    expect(() => BigInt(r.monotonic_ns)).not.toThrow();
  });

  test("unix_ms is within 5s of Date.now() at call time", () => {
    const before = Date.now();
    const r = computeTime();
    const after = Date.now();
    expect(r.unix_ms).toBeGreaterThanOrEqual(before);
    expect(r.unix_ms).toBeLessThanOrEqual(after);
    expect(after - before).toBeLessThan(5_000);
  });
});
