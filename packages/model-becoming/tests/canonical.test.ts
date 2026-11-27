import { describe, expect, test } from "bun:test";

import { canonicalJson } from "../src/canonical.js";

describe("canonical JSON Unicode boundary", () => {
  test("accepts plain text and a valid surrogate pair", () => {
    expect(canonicalJson("abc")).toBe('"abc"');
    expect(canonicalJson("😀")).toBe('"😀"');
  });

  test("refuses a lone high surrogate at the end of a string", () => {
    expect(() => canonicalJson("abc\uD800")).toThrow("lone UTF-16 surrogate");
    expect(() => canonicalJson("\uD800")).toThrow("lone UTF-16 surrogate");
    expect(() => canonicalJson({ ["key\uD800"]: "value" })).toThrow(
      "lone UTF-16 surrogate",
    );
  });

  test("refuses a lone high surrogate in the middle and a lone low surrogate", () => {
    expect(() => canonicalJson("ab\uD800c")).toThrow("lone UTF-16 surrogate");
    expect(() => canonicalJson("\uDC00")).toThrow("lone UTF-16 surrogate");
  });
});
