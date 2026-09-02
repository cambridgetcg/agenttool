import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import {
  ConformanceFormatError,
  OFFICIAL_SUITE_SEMANTIC_SHA256,
  OFFICIAL_VECTOR_BYTES,
  OFFICIAL_VECTOR_CASE_COUNT,
  OFFICIAL_VECTOR_MANIFEST,
  OFFICIAL_VECTOR_MANIFEST_BYTES,
  OFFICIAL_VECTOR_MANIFEST_RAW_SHA256,
  OFFICIAL_VECTOR_RAW_SHA256,
  validateOfficialVectorManifest,
  verifyOfficialVectorSources,
} from "../src/index.js";
import { compareUtf8, semanticSha256 } from "../src/internal.js";
import { manifestBytes, suite, vectorBytes } from "./fixtures.js";

function digest(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function caught(operation: () => unknown): ConformanceFormatError {
  try {
    operation();
    throw new Error("expected ConformanceFormatError");
  } catch (error) {
    expect(error).toBeInstanceOf(ConformanceFormatError);
    return error as ConformanceFormatError;
  }
}

describe("official vector pins", () => {
  test("raw manifest, raw vector, and semantic suite pins all verify", () => {
    expect(vectorBytes.byteLength).toBe(OFFICIAL_VECTOR_BYTES);
    expect(digest(vectorBytes)).toBe(OFFICIAL_VECTOR_RAW_SHA256);
    expect(manifestBytes.byteLength).toBe(OFFICIAL_VECTOR_MANIFEST_BYTES);
    expect(digest(manifestBytes)).toBe(OFFICIAL_VECTOR_MANIFEST_RAW_SHA256);
    expect(semanticSha256(suite)).toBe(OFFICIAL_SUITE_SEMANTIC_SHA256);
    expect(suite.cases).toHaveLength(OFFICIAL_VECTOR_CASE_COUNT);
    expect(validateOfficialVectorManifest(JSON.parse(manifestBytes.toString("utf8")))).toEqual(
      OFFICIAL_VECTOR_MANIFEST,
    );
  });

  test("valid JSON with changed vector or manifest bytes is rejected", () => {
    const changedVector = Buffer.from(
      vectorBytes.toString("utf8").replace("Recorded payment", "Observed payment"),
      "utf8",
    );
    expect(caught(() => verifyOfficialVectorSources(changedVector, manifestBytes)).code).toBe(
      "VECTOR_INTEGRITY_MISMATCH",
    );
    const changedManifest = Buffer.from(`${manifestBytes.toString("utf8")} `, "utf8");
    expect(caught(() => verifyOfficialVectorSources(vectorBytes, changedManifest)).code).toBe(
      "VECTOR_INTEGRITY_MISMATCH",
    );
  });

  test("duplicate raw object keys are rejected before hash comparison", () => {
    const duplicate = Buffer.from(
      vectorBytes.toString("utf8").replace(
        '  "suite_id": "suite:economic-kernel-v0.1",',
        '  "suite_id": "suite:economic-kernel-v0.1",\n  "\\u0073uite_id": "suite:economic-kernel-v0.1",',
      ),
      "utf8",
    );
    expect(caught(() => verifyOfficialVectorSources(duplicate, manifestBytes)).code).toBe(
      "DUPLICATE_JSON_KEY",
    );
  });

  test("malformed UTF-8 has its own closed format reason", () => {
    expect(caught(() => verifyOfficialVectorSources(Uint8Array.of(0xff), manifestBytes)).code).toBe(
      "INVALID_UTF8",
    );
  });

  test("byte sources reject subclasses and shared storage without consulting decorations", () => {
    class ByteSubclass extends Uint8Array {}
    expect(caught(() => verifyOfficialVectorSources(new ByteSubclass(vectorBytes), manifestBytes)).code).toBe(
      "INVALID_SHAPE",
    );
    expect(caught(() => verifyOfficialVectorSources(new Proxy(new Uint8Array(vectorBytes), {}), manifestBytes)).code).toBe(
      "INVALID_SHAPE",
    );

    const decorated = new Uint8Array(vectorBytes);
    Object.defineProperty(decorated, Symbol.iterator, {
      get() {
        throw new Error("iterator must not be consulted");
      },
    });
    Object.defineProperty(decorated, "byteLength", {
      get() {
        throw new Error("own byteLength must not be consulted");
      },
    });
    expect(verifyOfficialVectorSources(decorated, manifestBytes).cases).toHaveLength(34);

    if (typeof SharedArrayBuffer !== "undefined") {
      const shared = new Uint8Array(new SharedArrayBuffer(vectorBytes.byteLength));
      shared.set(vectorBytes);
      expect(caught(() => verifyOfficialVectorSources(shared, manifestBytes)).code).toBe("INVALID_SHAPE");
    }
  });

  test("case ids and families have deterministic closed coverage", () => {
    const caseIds = suite.cases.map((item) => item.case_id);
    expect(caseIds).toEqual([...caseIds].sort(compareUtf8));
    expect(new Set(caseIds).size).toBe(caseIds.length);
    expect([...new Set(suite.cases.map((item) => item.family))].sort(compareUtf8)).toEqual([
      "ADMISSION",
      "AMOUNTS",
      "EFFECTS",
      "LEDGER",
      "PAYMENTS",
      "PRICING",
      "QUOTES",
      "SECURITY",
      "UNITS",
    ]);
  });

  test("amount-like fields are canonical decimal strings except explicit invalid-input cases", () => {
    const exceptions: string[] = [];
    const visit = (value: unknown, caseId: string, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, caseId, `${path}[${String(index)}]`));
        return;
      }
      if (value === null || typeof value !== "object") return;
      for (const [key, item] of Object.entries(value)) {
        const nextPath = `${path}.${key}`;
        if (/(?:_atomic|_per_lot)$/u.test(key) && (typeof item !== "string" || !/^(0|[1-9][0-9]*)$/u.test(item))) {
          exceptions.push(`${caseId}:${nextPath}`);
        }
        visit(item, caseId, nextPath);
      }
    };
    for (const item of suite.cases) visit(item.input, item.case_id, "input");
    expect(exceptions).toEqual([
      "case:amount-json-number:input.amount_atomic",
      "case:amount-leading-zero:input.amount_atomic",
    ]);
  });
});
