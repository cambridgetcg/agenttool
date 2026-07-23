import { describe, expect, test } from "bun:test";

import {
  WalletProtocolError,
  canonicalJson,
  canonicalJsonBytes,
  parseCanonicalJson,
  signingDigest,
} from "../src/index.js";

describe("closed canonical JSON profile", () => {
  test("sorts object fields but keeps array order", () => {
    expect(canonicalJson({ z: 1, a: [2, 1] })).toBe('{"a":[2,1],"z":1}');
    expect(canonicalJson({ a: [1, 2], z: 1 })).not.toBe(canonicalJson({ a: [2, 1], z: 1 }));
  });

  test("rejects non-integers, negative zero, unsafe integers, NUL and lone surrogates", () => {
    for (const value of [1.5, -0, Number.MAX_SAFE_INTEGER + 1, "bad\0value", "\ud800"]) {
      expect(() => canonicalJson(value)).toThrow(WalletProtocolError);
    }
  });

  test("rejects sparse arrays, cycles, symbols and non-plain objects", () => {
    const sparse = new Array(2);
    sparse[1] = 1;
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const symbol = { ok: true } as Record<PropertyKey, unknown>;
    symbol[Symbol("hidden")] = true;
    for (const value of [sparse, cycle, symbol, new Date()]) {
      expect(() => canonicalJson(value)).toThrow(WalletProtocolError);
    }
  });

  test("rejects executable accessors without invoking them", () => {
    let objectReads = 0;
    expect(() => canonicalJson({
      get value() {
        objectReads += 1;
        return objectReads === 1 ? "checked" : "changed";
      },
    })).toThrow(/data properties/i);
    expect(objectReads).toBe(0);

    let arrayReads = 0;
    const array = ["safe"];
    Object.defineProperty(array, 0, {
      enumerable: true,
      get() {
        arrayReads += 1;
        return arrayReads === 1 ? "checked" : "changed";
      },
    });
    expect(() => canonicalJson(array)).toThrow(/data properties/i);
    expect(arrayReads).toBe(0);
  });

  test("rejects whitespace and duplicate-name JSON as noncanonical", () => {
    expect(() => parseCanonicalJson(new TextEncoder().encode('{ "a":1}'))).toThrow();
    expect(() => parseCanonicalJson(new TextEncoder().encode('{"a":1,"a":1}'))).toThrow();
    expect(parseCanonicalJson(canonicalJsonBytes({ a: 1 }))).toEqual({ a: 1 });
  });

  test("domain separation changes the signed digest", () => {
    expect(Buffer.from(signingDigest("domain-a", { a: 1 })).toString("hex"))
      .not.toBe(Buffer.from(signingDigest("domain-b", { a: 1 })).toString("hex"));
  });
});
