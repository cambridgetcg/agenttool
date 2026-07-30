import { describe, expect, test } from "bun:test";

import {
  canonicalJson,
  domainSeparatedId,
  parseStrictJson,
  snapshotJson,
} from "../src/canonical.js";
import { createReceiptEnvelope } from "../src/contracts.js";
import { makeBody, makePin } from "./helpers.js";

describe("strict canonical JSON", () => {
  test("sorts keys and preserves integer-only values", () => {
    expect(canonicalJson({ z: 2, a: [true, null, "雪", 1] }))
      .toBe('{"a":[true,null,"雪",1],"z":2}');
  });

  test("rejects non-integers, negative zero, unsafe integers, cycles, sparse arrays, accessors, symbols, NUL, and lone surrogates", () => {
    for (const value of [1.5, -0, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity]) {
      expect(() => canonicalJson(value)).toThrow();
    }
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow();
    const sparse = new Array(2);
    sparse[1] = "x";
    expect(() => canonicalJson(sparse)).toThrow();
    const accessor = Object.defineProperty({}, "x", { enumerable: true, get: () => "x" });
    expect(() => snapshotJson(accessor)).toThrow();
    expect(() => canonicalJson({ [Symbol("x")]: 1 })).toThrow();
    expect(() => canonicalJson("\0")).toThrow();
    expect(() => canonicalJson("\ud800")).toThrow();
  });

  test("fatally decodes UTF-8 and rejects duplicate decoded keys", () => {
    expect(() => parseStrictJson(Buffer.from('{"a":1,"\\u0061":2}'))).toThrow(/Duplicate/);
    expect(() => parseStrictJson(Uint8Array.of(0xc3, 0x28))).toThrow(/UTF-8/);
    expect(parseStrictJson(Buffer.from(" \n {\"a\": 1} \n"))).toEqual({ a: 1 });
  });

  test("domain separation changes the same content ID", () => {
    expect(domainSeparatedId("one", { a: 1 })).not.toBe(domainSeparatedId("two", { a: 1 }));
  });

  test("every receipt field and nested member is content-bound", () => {
    const original = makeBody(makePin(), "E3", 0, 4);
    const originalId = createReceiptEnvelope(original).evidence_id;
    const paths: Array<Array<string | number>> = [];

    function walk(value: unknown, path: Array<string | number>): void {
      if (path.length > 0) paths.push(path);
      if (Array.isArray(value)) value.forEach((item, index) => walk(item, [...path, index]));
      else if (typeof value === "object" && value !== null) {
        for (const [key, member] of Object.entries(value)) walk(member, [...path, key]);
      }
    }
    walk(original, []);

    function replacement(value: unknown): unknown {
      if (value === null) return "changed";
      if (typeof value === "string") return `${value}x`;
      if (typeof value === "boolean") return !value;
      if (typeof value === "number") return value + 1;
      if (Array.isArray(value)) return [...value, "changed"];
      return { ...(value as Record<string, unknown>), changed: true };
    }

    for (const path of paths) {
      const changed = structuredClone(original) as unknown as Record<string, unknown>;
      let parent: unknown = changed;
      for (const key of path.slice(0, -1)) parent = (parent as Record<string | number, unknown>)[key];
      const leaf = path.at(-1) as string | number;
      const container = parent as Record<string | number, unknown>;
      container[leaf] = replacement(container[leaf]);
      expect(domainSeparatedId(original.protocol, changed)).not.toBe(originalId);
    }
  });
});
