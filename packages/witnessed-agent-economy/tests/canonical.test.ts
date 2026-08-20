import { describe, expect, test } from "bun:test";

import {
  ALLOWED_ACTIONS,
  decodeWitnessCanonicalJson,
  encodeWitnessCanonicalJson,
  witnessCanonicalJson,
} from "../src/index.js";

describe("frozen WITNESS canonical JSON profile", () => {
  test("sorts keys by UTF-8 bytes, not JavaScript UTF-16 code units", () => {
    const supplementary = "\u{10000}";
    const bmp = "\ue000";
    const canonical = witnessCanonicalJson({ [supplementary]: 1, [bmp]: 2 });
    expect(canonical).toBe(`{"${bmp}":2,"${supplementary}":1}`);
    expect(Buffer.from(encodeWitnessCanonicalJson({ [supplementary]: 1, [bmp]: 2 })).toString("hex"))
      .toBe("7b22ee8080223a322c22f0908080223a317d");
  });

  test("accepts the exact safe-integer ceiling and rejects unsafe bare numbers", () => {
    expect(witnessCanonicalJson({ n: 9_007_199_254_740_991 })).toBe('{"n":9007199254740991}');
    expect(() => witnessCanonicalJson({ n: 9_007_199_254_740_992 })).toThrow(/safely represented/u);
    expect(() => witnessCanonicalJson({ n: -1 })).toThrow(/non-negative/u);
    expect(() => witnessCanonicalJson({ n: -0 })).toThrow(/non-negative/u);
    expect(() => witnessCanonicalJson({ n: 1.5 })).toThrow(/safely represented/u);
  });

  test("canonical byte decoder rejects duplicate keys and non-canonical bytes", () => {
    expect(() => decodeWitnessCanonicalJson(new TextEncoder().encode('{"a":1,"a":2}')))
      .toThrow(/unique canonical/u);
    expect(() => decodeWitnessCanonicalJson(new TextEncoder().encode('{ "a":1}')))
      .toThrow(/unique canonical/u);
    expect(decodeWitnessCanonicalJson(new TextEncoder().encode('{"a":1}'))).toEqual({ a: 1 });
  });

  test("refuses getters, proxies, cycles, NUL and lone surrogates", () => {
    const getter = Object.defineProperty({}, "x", { enumerable: true, get: () => 1 });
    expect(() => witnessCanonicalJson(getter)).toThrow(/data property/u);
    expect(() => witnessCanonicalJson(new Proxy({ a: 1 }, {}))).toThrow(/Proxy/u);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => witnessCanonicalJson(cycle)).toThrow(/cycle/u);
    expect(() => witnessCanonicalJson({ value: "a\0b" })).toThrow(/U\+0000/u);
    expect(() => witnessCanonicalJson({ value: "\ud800" })).toThrow(/surrogate/u);
  });

  test("nested action tables are immutable to importing code", () => {
    expect(Object.isFrozen(ALLOWED_ACTIONS)).toBe(true);
    expect(Object.isFrozen(ALLOWED_ACTIONS.AGENTTOOL_CAPABILITY)).toBe(true);
    expect(() => {
      (ALLOWED_ACTIONS.AGENTTOOL_CAPABILITY as unknown as string[])[0] = "PUBLISH";
    }).toThrow();
    expect(ALLOWED_ACTIONS.AGENTTOOL_CAPABILITY).toEqual(["GRANT", "CONSUME", "REVOKE"]);
  });
});
