import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  MAX_JSON_BYTES,
  canonicalJson,
  domainSeparatedId,
  parseStrictJson,
  sha256Id,
  snapshotJson,
} from "../src/index.js";

describe("canonical bytes and identifiers", () => {
  test("sorts recursively by Unicode code point and preserves array order", () => {
    expect(canonicalJson({ z: [{ b: 2, a: 1 }], "😀": 3, "�": 4 })).toBe(
      '{"z":[{"a":1,"b":2}],"�":4,"😀":3}',
    );
  });

  test("uses the exact byte-domain vector without admitting U+0000 as JSON text", () => {
    const expected = "sha256:a076a107fed87a801a25b0ffb89efaeeebb60d2c661c982cdb01594d24eff513";
    expect(domainSeparatedId("example.test/0.1", { b: 2, a: 1 })).toBe(expected);
    const independent = createHash("sha256")
      .update(Buffer.concat([
        Buffer.from("example.test/0.1", "utf8"),
        Buffer.from([0]),
        Buffer.from('{"a":1,"b":2}', "utf8"),
      ]))
      .digest("hex");
    expect(`sha256:${independent}`).toBe(expected);
    expect(() => canonicalJson({ bad: "a\0b" })).toThrow(/U\+0000/);
    expect(() => sha256Id("a\0b")).toThrow(/U\+0000/);
  });

  test("rejects duplicate decoded keys, malformed UTF-8, BOM and trailing JSON", () => {
    expect(() => parseStrictJson('{"a":1,"\\u0061":2}')).toThrow(/Duplicate/);
    expect(() => parseStrictJson(new Uint8Array([0xc3, 0x28]))).toThrow(/UTF-8/);
    expect(() => parseStrictJson('{"value":"\ud800"}')).toThrow(/malformed Unicode/);
    expect(() => parseStrictJson(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))).toThrow();
    expect(() => parseStrictJson("{}{}")) .toThrow(/Trailing/);
  });

  test("rejects floats, unsafe integers, negative zero, excessive depth and size", () => {
    for (const value of [1.5, Number.MAX_SAFE_INTEGER + 1, -0]) {
      expect(() => snapshotJson(value)).toThrow(/safe integer|negative zero/);
    }
    expect(() => parseStrictJson(`${"[".repeat(66)}0${"]".repeat(66)}`)).toThrow(/deep/);
    expect(() => parseStrictJson(`"${"a".repeat(MAX_JSON_BYTES)}"`)).toThrow(/bytes|bound/);
  });

  test("snapshots only inert plain data", () => {
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, "secret", { enumerable: true, get: () => "leak" });
    expect(() => snapshotJson(accessor)).toThrow(/data property/);
    expect(() => snapshotJson(new Proxy({ a: 1 }, {}))).toThrow(/Proxy/);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => snapshotJson(cycle)).toThrow(/cycles/);
    const sparse = Array<number>(2);
    sparse[1] = 1;
    expect(() => snapshotJson(sparse)).toThrow(/dense Array/);
    const symbol = { a: 1 } as Record<PropertyKey, unknown>;
    symbol[Symbol("hidden")] = 2;
    expect(() => snapshotJson(symbol)).toThrow(/symbol property/);
    expect(() => snapshotJson(Object.create({ inherited: true }))).toThrow(/plain object/);
  });
});
