/** The text readers probes share. */

import { expect, test } from "bun:test";

import { clip, commentAbove, lineOf, literalCollections, literalUnions, stringLiterals } from "../src/source.js";

test("a literal collection reads path-building calls as one entry each", () => {
  const lines = [
    "/** why the list is what it is */",
    "export const SCAN_DIRS = [",
    '  join(REPO_ROOT, "api", "src"),',
    '  join(REPO_ROOT, "bin"),',
    '  "packages/x/src",',
    "];",
  ];
  const [collection] = literalCollections(lines);
  expect(collection?.name).toBe("SCAN_DIRS");
  expect(collection?.exported).toBe(true);
  expect(collection?.line).toBe(2);
  expect(collection?.entries).toEqual(["api/src", "bin", "packages/x/src"]);
  expect(collection?.comment).toContain("why the list");
});

test("nested literals stay one entry and a Set literal is read like an array", () => {
  const [nested] = literalCollections(['const PAIRS = [["a", "b"], ["c"]];']);
  expect(nested?.entries).toEqual(["a/b", "c"]);
  const [set] = literalCollections(['const SKIP = new Set([".git", "dist"]);']);
  expect(set?.entries).toEqual([".git", "dist"]);
});

test("an unterminated literal is skipped rather than half-read", () => {
  expect(literalCollections(['const OPEN = [', '  "a",'])).toEqual([]);
});

test("only pure string-literal unions are read as unions", () => {
  expect(literalUnions(['export type Kind = "wall" | "commitment";'])[0]?.members).toEqual(["wall", "commitment"]);
  expect(literalUnions(['type Multi =', '  | "a"', '  | "b";'])[0]?.members).toEqual(["a", "b"]);
  expect(literalUnions(['type Mixed = "a" | string;'])).toEqual([]);
  expect(literalUnions(['type One = "a";'])).toEqual([]);
});

test("comment blocks, string literals, line lookup and clipping", () => {
  expect(commentAbove(["// one", "// two", "code"], 2)).toBe("// one\n// two");
  expect(commentAbove(["code", "", "more"], 2)).toBe("");
  expect(stringLiterals(`a "one" b 'two' c "with \\"quote\\""`)).toEqual(["one", "two", 'with "quote"']);
  expect(lineOf(["a", "b marker", "c"], "marker")).toBe(2);
  expect(lineOf(["a"], "marker")).toBe(0);
  expect(clip("abcdef", 3)).toBe("abc…");
  expect(clip("abc", 3)).toBe("abc");
});
