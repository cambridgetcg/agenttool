import { describe, expect, test } from "bun:test";

import {
  CONFORMANCE_BOUNDARIES,
  ConformanceFormatError,
  OFFICIAL_SUITE_SEMANTIC_SHA256,
  OFFICIAL_VECTOR_MANIFEST_RAW_SHA256,
  evaluateConformance,
  validateConformanceTrace,
} from "../src/index.js";
import { canonicalJson, sameJson } from "../src/internal.js";
import type { ConformanceTraceEntry, JsonValue } from "../src/index.js";
import { exactEntries, reversedObservation, suite, trace } from "./fixtures.js";

function expectFormatError(operation: () => unknown, code?: ConformanceFormatError["code"]): void {
  try {
    operation();
    throw new Error("expected ConformanceFormatError");
  } catch (error) {
    expect(error).toBeInstanceOf(ConformanceFormatError);
    if (code !== undefined) expect((error as ConformanceFormatError).code).toBe(code);
  }
}

describe("closed conformance comparison", () => {
  test("a complete exact trace passes with hash-only case reports", () => {
    const report = evaluateConformance(suite, trace(exactEntries()));

    expect(report.status).toBe("PASS");
    expect(report.counts).toEqual({ total: 53, pass: 53, fail: 0, inconclusive: 0 });
    expect(report.suite_semantic_sha256).toBe(OFFICIAL_SUITE_SEMANTIC_SHA256);
    expect(report.official_vector_manifest_raw_sha256).toBe(OFFICIAL_VECTOR_MANIFEST_RAW_SHA256);
    expect(report.trace_semantic_sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(report.producer_declared_ref).toBe("adapter:test-fixture");
    expect(report.scalar_score).toBeNull();
    expect(report.boundaries).toEqual(CONFORMANCE_BOUNDARIES);
    expect(report.families.map((item) => item.family)).toEqual([
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
    for (const item of report.cases) {
      expect(item.status).toBe("PASS");
      expect(item.reason_code).toBe("EXACT_MATCH");
      expect(item.expected_observation_semantic_sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(item.observed_observation_semantic_sha256).toBe(item.expected_observation_semantic_sha256);
      expect(Object.hasOwn(item, "expected")).toBeFalse();
      expect(Object.hasOwn(item, "observed")).toBeFalse();
    }
    expect(Object.isFrozen(report)).toBeTrue();
    expect(Object.isFrozen(report.cases)).toBeTrue();
    expect(Object.isFrozen(report.cases[0])).toBeTrue();
  });

  test("missing observations are inconclusive unless any supplied observation fails", () => {
    const absent = evaluateConformance(suite, trace([]));
    expect(absent.status).toBe("INCONCLUSIVE");
    expect(absent.counts).toEqual({ total: 53, pass: 0, fail: 0, inconclusive: 53 });
    expect(absent.cases[0]?.reason_code).toBe("OBSERVATION_MISSING");

    const first = suite.cases[0]!;
    const mismatch: ConformanceTraceEntry = {
      case_id: first.case_id,
      observed: { outcome: "ERROR", error_code: "UNEXPECTED_TEST_RESULT" },
    };
    const mixed = evaluateConformance(suite, trace([mismatch]));
    expect(mixed.status).toBe("FAIL");
    expect(mixed.counts).toEqual({ total: 53, pass: 0, fail: 1, inconclusive: 52 });
    expect(mixed.cases[0]?.reason_code).toBe("OBSERVATION_MISMATCH");
  });

  test("object insertion order does not affect exact comparison", () => {
    const entries = suite.cases.map((item) => ({
      case_id: item.case_id,
      observed: reversedObservation(item.expected),
    }));
    const reordered = evaluateConformance(suite, trace(entries));
    const original = evaluateConformance(suite, trace(exactEntries()));
    expect(reordered.status).toBe("PASS");
    expect(reordered.trace_semantic_sha256).toBe(original.trace_semantic_sha256);
  });

  test("all object keys use an explicit UTF-8 total order, not host object ordering", () => {
    const left = Object.fromEntries([["e\u0301", 1], ["é", 2]]) as JsonValue;
    const right = Object.fromEntries([["é", 2], ["e\u0301", 1]]) as JsonValue;
    expect(sameJson(left, right)).toBeTrue();
    expect(canonicalJson(left)).toBe('{"é":1,"é":2}');
    expect(canonicalJson({ "\u{10000}": 1, "\ue000": 2 })).toBe('{"":2,"𐀀":1}');
    expect(canonicalJson({ "2": "two", "10": "ten", a: "aye" }))
      .toBe('{"10":"ten","2":"two","a":"aye"}');
    expect(canonicalJson([{ nested: { "2": 2, "10": 10 } }]))
      .toBe('[{"nested":{"10":10,"2":2}}]');
  });

  test("an altered suite cannot manufacture PASS", () => {
    const altered = structuredClone(suite);
    altered.cases[0]!.description = "Altered semantics";
    expectFormatError(() => evaluateConformance(altered, trace(exactEntries())), "UNPINNED_SUITE");
  });

  test("legacy, unsafe, duplicate, reordered, and unknown trace fields are format errors", () => {
    const base = trace([]);
    const { producer_declared_ref: _declared, ...withoutDeclared } = base;
    expectFormatError(() => validateConformanceTrace({
      ...withoutDeclared,
      producer_ref: "adapter:legacy",
    }, suite));
    expectFormatError(() => validateConformanceTrace({
      ...base,
      producer_declared_ref: "adapter:test\nterminal-injection",
    }, suite));

    const exact = exactEntries();
    expectFormatError(() => validateConformanceTrace(trace([exact[0]!, exact[0]!]), suite));
    expectFormatError(() => validateConformanceTrace(trace([exact[1]!, exact[0]!]), suite));
    expectFormatError(() => validateConformanceTrace(trace([{
      case_id: "case:unknown",
      observed: { outcome: "ERROR", error_code: "UNKNOWN" },
    }]), suite));
  });

  test("a large supplied observation is summarized without duplicating raw material", () => {
    const canary = `synthetic-private-canary-${"x".repeat(520_000)}`;
    const first = suite.cases[0]!;
    const report = evaluateConformance(suite, trace([{
      case_id: first.case_id,
      observed: { outcome: "VALUE", value: { canary } },
    }]));
    const serialized = JSON.stringify(report);
    expect(report.status).toBe("FAIL");
    expect(serialized.length).toBeLessThan(20_000);
    expect(serialized).not.toContain("synthetic-private-canary");
  });
});

describe("hostile input validation", () => {
  test("all exposed validation failures use ConformanceFormatError", () => {
    expectFormatError(() => validateConformanceTrace(null, suite));
    expectFormatError(() => validateConformanceTrace({ ...trace([]), schema: "other" }, suite), "UNSUPPORTED_SCHEMA");
    expectFormatError(() => validateConformanceTrace({
      ...trace([]),
      entries: [{ case_id: suite.cases[0]!.case_id, observed: { outcome: "OTHER" } }],
    }, suite));
    expectFormatError(() => validateConformanceTrace({
      ...trace([]),
      entries: [{ case_id: suite.cases[0]!.case_id, observed: { outcome: "VALUE", value: -0 } }],
    }, suite));
  });

  test("proxies, accessors, cycles, sparse arrays, symbols, and custom prototypes are rejected", () => {
    expectFormatError(() => validateConformanceTrace(new Proxy(trace([]), {}), suite));

    let getterRan = false;
    const accessor = { ...trace([]) } as Record<string, unknown>;
    Object.defineProperty(accessor, "entries", {
      enumerable: true,
      get() {
        getterRan = true;
        return [];
      },
    });
    expectFormatError(() => validateConformanceTrace(accessor, suite));
    expect(getterRan).toBeFalse();

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expectFormatError(() => validateConformanceTrace({
      ...trace([]),
      entries: [{
        case_id: suite.cases[0]!.case_id,
        observed: { outcome: "VALUE", value: cyclic },
      }],
    }, suite));

    const sparse = new Array(1) as unknown[];
    expectFormatError(() => validateConformanceTrace({ ...trace([]), entries: sparse }, suite));
    expectFormatError(() => validateConformanceTrace({ ...trace([]), [Symbol("extra")]: true }, suite));
    expectFormatError(() => validateConformanceTrace(Object.assign(Object.create({}), trace([])), suite));
    expectFormatError(() => validateConformanceTrace({
      ...trace([]),
      producer_declared_ref: "adapter:\ud800",
    }, suite));
  });

  test("hostile property names never enter error messages or paths", () => {
    const canaryKey = "synthetic-private-key\nterminal-control";
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, canaryKey, {
      enumerable: true,
      get() {
        throw new Error("getter must not run");
      },
    });
    try {
      validateConformanceTrace({
        ...trace([]),
        entries: [{
          case_id: suite.cases[0]!.case_id,
          observed: { outcome: "VALUE", value: hostile },
        }],
      }, suite);
      throw new Error("expected ConformanceFormatError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConformanceFormatError);
      const rendered = JSON.stringify({
        message: (error as Error).message,
        path: (error as ConformanceFormatError).path,
      });
      expect(rendered).not.toContain("synthetic-private-key");
      expect(rendered).not.toContain("terminal-control");
    }
  });

  test("object property counts are bounded before value traversal", () => {
    const oversized = Object.create(null) as Record<string, number>;
    for (let index = 0; index < 1_025; index += 1) oversized[`key-${String(index)}`] = index;
    try {
      validateConformanceTrace({
        ...trace([]),
        entries: [{
          case_id: suite.cases[0]!.case_id,
          observed: { outcome: "VALUE", value: oversized },
        }],
      }, suite);
      throw new Error("expected ConformanceFormatError");
    } catch (error) {
      expect(error).toBeInstanceOf(ConformanceFormatError);
      expect((error as ConformanceFormatError).code).toBe("LIMIT_EXCEEDED");
    }
  });
});
