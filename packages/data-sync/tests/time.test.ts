import { describe, expect, test } from "bun:test";
import { parseRfc3339Instant } from "../src/time.js";

describe("RFC 3339 instant parsing", () => {
  test("pins the reference node's uppercase, non-leap-second profile", () => {
    expect(parseRfc3339Instant("2026-07-29t12:00:00z")).toBeNull();
    expect(parseRfc3339Instant("2016-12-31T23:59:60Z")).toBeNull();
  });

  test("preserves precision beyond nanoseconds instead of collapsing instants", () => {
    expect(parseRfc3339Instant("2026-07-29T12:00:00.1234567891Z"))
      .not.toBe(parseRfc3339Instant("2026-07-29T12:00:00.1234567899Z"));
  });

  test("normalizes equivalent fractions and timezone offsets", () => {
    const expected = parseRfc3339Instant("2026-07-29T12:00:00.1Z");
    expect(parseRfc3339Instant("2026-07-29T12:00:00.1000000000Z")).toBe(expected);
    expect(parseRfc3339Instant("2026-07-29T13:00:00.100+01:00")).toBe(expected);
  });
});
