import { describe, expect, test } from "bun:test";

import {
  createPolymorphLandscape,
  createPolymorphReachabilityShift,
  createRitonavirLandscape,
  createRitonavirReachabilityShift,
  PolymorphLandscapeError,
  validatePolymorphLandscape,
  validatePolymorphReachabilityShift,
} from "../src/index.js";
import { minimalInput, minimalLandscape, minimalShift, minimalShiftInput } from "./fixtures.js";

describe("hostile input boundary", () => {
  test("rejects proxies before traps can supply data", () => {
    const value = new Proxy(minimalInput(), {});
    expect(() => createPolymorphLandscape(value)).toThrow(PolymorphLandscapeError);
  });

  test("rejects supplied landscape proxies with zero traps before any dereference", () => {
    const landscape = minimalLandscape();
    const input = minimalShiftInput(landscape);
    const shift = minimalShift(landscape);

    for (const operation of [
      (value: any) => createPolymorphReachabilityShift(value, input),
      (value: any) => validatePolymorphReachabilityShift(value, shift),
    ]) {
      const trapped = trappingProxy(landscape);
      expect(() => operation(trapped.value)).toThrow(PolymorphLandscapeError);
      expect(trapped.count()).toBe(0);
    }

    const ritonavir = createRitonavirLandscape();
    const trapped = trappingProxy(ritonavir);
    expect(() => createRitonavirReachabilityShift(trapped.value as any)).toThrow(PolymorphLandscapeError);
    expect(trapped.count()).toBe(0);
  });

  test("rejects accessors without invoking them", () => {
    let invoked = false;
    const value: Record<string, unknown> = { ...minimalInput() };
    Object.defineProperty(value, "sources", {
      enumerable: true,
      get() { invoked = true; return []; },
    });
    expect(() => createPolymorphLandscape(value as any)).toThrow(PolymorphLandscapeError);
    expect(invoked).toBe(false);
  });

  test("rejects custom prototypes, cycles, sparse arrays, symbols, and floats", () => {
    const custom = Object.assign(Object.create({}), minimalInput());
    expect(() => createPolymorphLandscape(custom)).toThrow();
    const cycle: any = minimalInput(); cycle.loop = cycle;
    expect(() => createPolymorphLandscape(cycle)).toThrow();
    const sparse: any = minimalInput(); sparse.sources = new Array(1);
    expect(() => createPolymorphLandscape(sparse)).toThrow();
    const symbol: any = minimalInput(); symbol[Symbol("hidden")] = true;
    expect(() => createPolymorphLandscape(symbol)).toThrow();
    const float: any = minimalInput(); float.sources[0].published_year = 2024.5;
    expect(() => createPolymorphLandscape(float)).toThrow();
  });

  test("rejects tampered IDs, extra fields, and unknown references", () => {
    const landscape = minimalLandscape();
    const tampered: any = structuredClone(landscape);
    tampered.landscape_id = `sha256:${"0".repeat(64)}`;
    expect(() => validatePolymorphLandscape(tampered)).toThrow();
    const extra: any = structuredClone(landscape); extra.authority = true;
    expect(() => validatePolymorphLandscape(extra)).toThrow();
    const shift = minimalShift(landscape);
    expect(() => createPolymorphReachabilityShift(landscape, {
      ...shift,
      prior_form_ref: `sha256:${"f".repeat(64)}`,
    } as any)).toThrow();
  });
});

function trappingProxy<T extends object>(target: T): { readonly value: T; readonly count: () => number } {
  let traps = 0;
  const touch = <R>(value: R): R => {
    traps += 1;
    return value;
  };
  return {
    value: new Proxy(target, {
      get: (object, key, receiver) => touch(Reflect.get(object, key, receiver)),
      getOwnPropertyDescriptor: (object, key) => touch(Reflect.getOwnPropertyDescriptor(object, key)),
      getPrototypeOf: (object) => touch(Reflect.getPrototypeOf(object)),
      has: (object, key) => touch(Reflect.has(object, key)),
      ownKeys: (object) => touch(Reflect.ownKeys(object)),
    }),
    count: () => traps,
  };
}
