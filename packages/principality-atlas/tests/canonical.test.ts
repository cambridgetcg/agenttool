import { describe, expect, test } from "bun:test";
import vm from "node:vm";

import {
  PrincipalityAtlasError,
  createPrincipalityAtlas,
  sha256Id,
} from "../src/index.js";
import { id } from "./fixtures.js";

const valid = () => ({ scope_ref: id("canonical-scope"), charts: [], bridges: [] });

describe("hostile input boundary", () => {
  test("rejects top-level and nested Proxies before caller traps run", () => {
    let traps = 0;
    const trap = () => {
      traps += 1;
      throw new Error("trap executed");
    };
    const hostile = new Proxy({}, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    expect(() => createPrincipalityAtlas(hostile as never)).toThrow(PrincipalityAtlasError);
    expect(traps).toBe(0);
    expect(() => createPrincipalityAtlas({ ...valid(), charts: [hostile] } as never)).toThrow(PrincipalityAtlasError);
    expect(traps).toBe(0);
  });

  test("rejects accessors, symbols, cycles, sparse arrays, and exotic prototypes", () => {
    const accessor = valid();
    Object.defineProperty(accessor, "scope_ref", { enumerable: true, get: () => id("getter") });
    expect(() => createPrincipalityAtlas(accessor)).toThrow(/own enumerable data property/);

    const symbol = { ...valid(), [Symbol("hidden")]: true };
    expect(() => createPrincipalityAtlas(symbol)).toThrow(/symbol property/);

    const cycle: Record<string, unknown> = valid();
    cycle.self = cycle;
    expect(() => createPrincipalityAtlas(cycle as never)).toThrow(/cycles/);

    const sparse = new Array(1);
    expect(() => createPrincipalityAtlas({ ...valid(), charts: sparse } as never)).toThrow(/dense Array/);

    const custom = Object.assign(Object.create({ inherited: true }), valid());
    expect(() => createPrincipalityAtlas(custom)).toThrow(/plain or null-prototype/);

    const crossRealm = vm.runInNewContext("({ scope_ref: 'sha256:' + '0'.repeat(64), charts: [], bridges: [] })");
    expect(() => createPrincipalityAtlas(crossRealm)).toThrow(/plain or null-prototype/);
  });

  test("rejects non-canonical numbers, malformed Unicode, and coercive values", () => {
    for (const value of [-0, Number.MAX_SAFE_INTEGER + 1, 1.5, Number.NaN, Infinity]) {
      expect(() => createPrincipalityAtlas({ ...valid(), extra: value } as never)).toThrow(/safe integers only/);
    }
    expect(() => createPrincipalityAtlas({ ...valid(), extra: "\ud800" } as never)).toThrow(/malformed Unicode/);
    expect(() => createPrincipalityAtlas({ ...valid(), extra: 1n } as never)).toThrow(/not canonical JSON/);
    expect(() => createPrincipalityAtlas({ ...valid(), extra: () => false } as never)).toThrow(/not canonical JSON/);
  });

  test("hashes copied strings and genuine Uint8Array values only", () => {
    expect(sha256Id("abc")).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Id(new Uint8Array([97, 98, 99]))).toBe(sha256Id("abc"));
    expect(() => sha256Id(new Proxy(new Uint8Array([1]), {}) as Uint8Array)).toThrow(/Proxy/);
    expect(() => sha256Id(new Uint16Array([1]) as never)).toThrow(/genuine Uint8Array/);
    expect(() => sha256Id("\ud800")).toThrow(/malformed Unicode/);
  });
});
