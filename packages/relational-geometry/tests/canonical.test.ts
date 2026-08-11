import { describe, expect, test } from "bun:test";

import { RelationalGeometryError, canonicalJson, createRelationalComplex, sha256Id } from "../src/index.js";

describe("canonical boundary", () => {
  test("orders Unicode keys and hashes strings and detached bytes", () => {
    expect(canonicalJson({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
    expect(sha256Id("same")).toBe(sha256Id(Uint8Array.from(Buffer.from("same"))));
  });

  test("rejects proxies before executing traps", () => {
    let traps = 0;
    const trap = () => { traps += 1; throw new Error("trap"); };
    const hostile = new Proxy({}, { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, ownKeys: trap });
    expect(() => createRelationalComplex(hostile as never)).toThrow(RelationalGeometryError);
    expect(traps).toBe(0);
  });

  test("rejects cycles, accessors, exotic prototypes, malformed Unicode, floats, and sparse arrays", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow(/cycles/i);
    const accessor = Object.defineProperty({}, "x", { enumerable: true, get: () => 1 });
    expect(() => canonicalJson(accessor)).toThrow(/data properties/i);
    expect(() => canonicalJson(new Map())).toThrow(/plain object|standard Array/i);
    expect(() => canonicalJson("\ud800")).toThrow(/Unicode/i);
    expect(() => canonicalJson(1.5)).toThrow(/safe integers/i);
    const sparse = Array(2);
    sparse[1] = true;
    expect(() => canonicalJson(sparse)).toThrow(/dense Array/i);
  });
});
