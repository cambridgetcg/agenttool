import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createLoveGeometry,
  encodeLoveGeometry,
  loveGeometryDomainBytes,
  loveGeometryUrn,
  sha256Id,
  type CreateLoveGeometryInput,
} from "../src/index.js";

const vector = JSON.parse(
  readFileSync(
    join(import.meta.dir, "..", "vectors", "agenttool-love-geometry-v0.1.json"),
    "utf8",
  ),
);

describe("portable deterministic vector", () => {
  test("pins canonical shape, exact-byte hashes, length, and URN", () => {
    expect(vector._format).toBe("agenttool.love-geometry-vector/0.1");
    const geometry = createLoveGeometry(vector.input as CreateLoveGeometryInput);

    expect(geometry.geometry_id).toBe(vector.expected.geometry_id);
    expect(geometry.subject_refs).toEqual(vector.expected.subject_refs);
    expect(geometry.vantages).toEqual(vector.expected.vantages);
    expect(sha256Id(encodeLoveGeometry(geometry))).toBe(
      vector.expected.canonical_json_sha256,
    );
    expect(loveGeometryDomainBytes(geometry).byteLength).toBe(
      vector.expected.domain_byte_length,
    );
    expect(loveGeometryUrn(geometry)).toBe(vector.expected.urn);
  });
});
