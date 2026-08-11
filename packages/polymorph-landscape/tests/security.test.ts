import { describe, expect, test } from "bun:test";

import {
  createPolymorphLandscape,
  createPolymorphReachabilityShift,
  PolymorphLandscapeError,
  validatePolymorphLandscape,
} from "../src/index.js";
import { minimalInput, minimalLandscape, minimalShift } from "./fixtures.js";

describe("hostile input boundary", () => {
  test("rejects proxies before traps can supply data", () => {
    const value = new Proxy(minimalInput(), {});
    expect(() => createPolymorphLandscape(value)).toThrow(PolymorphLandscapeError);
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
