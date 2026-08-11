import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createRelationalComplex,
  createRelationalLens,
  validateRelationalComplex,
  validateRelationalLensAgainstComplex,
} from "../src/index.js";

const vector = JSON.parse(readFileSync(join(import.meta.dir, "..", "vectors", "agenttool-relational-geometry-v0.1.json"), "utf8"));

describe("portable vectors", () => {
  test("bind exact complex and perspective-lens bytes", () => {
    expect(vector._format).toBe("agenttool.relational-geometry-vectors/0.1");
    expect(vector.cases).toHaveLength(1);
    for (const entry of vector.cases) {
      const complex = createRelationalComplex(entry.complex_input);
      expect(complex).toEqual(entry.expected_complex);
      expect(validateRelationalComplex(entry.expected_complex)).toEqual(complex);
      const lens = createRelationalLens(complex, entry.lens_input);
      expect(lens).toEqual(entry.expected_lens);
      expect(validateRelationalLensAgainstComplex(entry.expected_lens, complex)).toEqual(lens);
    }
  });

  test("contains no score, rank, identity, raw prose, URL, or timestamp fields", () => {
    const fields = new Set<string>();
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) return value.forEach(visit);
      for (const [key, child] of Object.entries(value)) {
        fields.add(key);
        visit(child);
      }
    };
    visit(vector);
    for (const forbidden of ["score", "rank", "weight", "distance", "identity", "did", "url", "timestamp", "prompt", "transcript"]) {
      expect(fields.has(forbidden)).toBe(false);
    }
  });
});
