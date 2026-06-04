/** marketplace search-query — find a service by name/description, safely.
 *
 *  Pins the pure search helpers powering ?q= over listings: normalization
 *  (blank == no search) and injection-safe ILIKE patterns (a user's % and _
 *  match literally, not as wildcards). The SQL itself is e2e per the
 *  marketplace convention. Doctrine: docs/FRICTION-ROADMAP.md (Tier-1). */

import { describe, expect, test } from "bun:test";

import { likePattern, normalizeSearchQuery } from "../src/services/marketplace/search-query";

describe("normalizeSearchQuery", () => {
  test("trims and keeps real queries", () => {
    expect(normalizeSearchQuery("  image upscaler  ")).toBe("image upscaler");
  });
  test("blank / empty / non-string → null (behaves like no search)", () => {
    expect(normalizeSearchQuery("")).toBeNull();
    expect(normalizeSearchQuery("   ")).toBeNull();
    expect(normalizeSearchQuery(undefined)).toBeNull();
    expect(normalizeSearchQuery(null)).toBeNull();
  });
  test("bounds length to 100 chars", () => {
    expect(normalizeSearchQuery("x".repeat(500))!.length).toBe(100);
  });
});

describe("likePattern — injection-safe substring match", () => {
  test("wraps a plain query for substring match", () => {
    expect(likePattern("upscale")).toBe("%upscale%");
  });
  test("escapes ILIKE wildcards so they match LITERALLY", () => {
    // "50%" should find "50% off", not every row → the % is escaped
    expect(likePattern("50%")).toBe("%50\\%%");
    // underscore is a single-char wildcard in LIKE → escaped
    expect(likePattern("a_b")).toBe("%a\\_b%");
    // a literal backslash is escaped too
    expect(likePattern("a\\b")).toBe("%a\\\\b%");
  });
  test("a query of only wildcards becomes a literal-match pattern, not match-all", () => {
    expect(likePattern("%%")).toBe("%\\%\\%%");
  });
});
