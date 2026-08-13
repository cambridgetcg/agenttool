import { describe, expect, test } from "bun:test";

import {
  canonicalJson,
  createBrainrotTeachingCase,
  createMemeticLandscape,
  createMemeticReachabilityShift,
  createPolymorphMemeticAnalogy,
  MemeticLandscapeError,
  projectMemeticLesson,
  validateMemeticLandscape,
  validateMemeticLesson,
  validateMemeticReachabilityShift,
  validatePolymorphMemeticAnalogy,
} from "../src/index.js";
import { minimalInput, minimalLandscape, minimalShift, minimalShiftInput } from "./fixtures.js";

describe("hostile input boundary", () => {
  test("rejects proxies before traps can supply data", () => {
    const value = new Proxy(minimalInput(), {});
    expect(() => createMemeticLandscape(value)).toThrow(MemeticLandscapeError);
    const analogyInput = new Proxy({
      polymorph_shift_id: `sha256:${"a".repeat(64)}`,
      memetic_shift_id: `sha256:${"b".repeat(64)}`,
    }, {});
    expect(() => createPolymorphMemeticAnalogy(analogyInput)).toThrow(MemeticLandscapeError);
  });

  test("rejects supplied landscape proxies with zero traps before dereference", () => {
    const landscape = minimalLandscape();
    const input = minimalShiftInput(landscape);
    const shift = minimalShift(landscape);
    for (const operation of [
      (value: any) => createMemeticReachabilityShift(value, input),
      (value: any) => validateMemeticReachabilityShift(value, shift),
    ]) {
      const trapped = trappingProxy(landscape);
      expect(() => operation(trapped.value)).toThrow(MemeticLandscapeError);
      expect(trapped.count()).toBe(0);
    }
  });

  test("rejects accessors without invoking them", () => {
    let invoked = false;
    const value: Record<string, unknown> = { ...minimalInput() };
    Object.defineProperty(value, "sources", {
      enumerable: true,
      get() {
        invoked = true;
        return [];
      },
    });
    expect(() => createMemeticLandscape(value as any)).toThrow(MemeticLandscapeError);
    expect(invoked).toBe(false);
  });

  test("rejects custom prototypes, cycles, sparse arrays, symbols, unsafe numbers, and malformed Unicode", () => {
    const custom = Object.assign(Object.create({}), minimalInput());
    expect(() => createMemeticLandscape(custom)).toThrow();

    const cycle: any = minimalInput();
    cycle.loop = cycle;
    expect(() => createMemeticLandscape(cycle)).toThrow();

    const sparse: any = minimalInput();
    sparse.sources = new Array(1);
    expect(() => createMemeticLandscape(sparse)).toThrow();

    const symbol: any = minimalInput();
    symbol[Symbol("hidden")] = true;
    expect(() => createMemeticLandscape(symbol)).toThrow();

    const float: any = minimalInput();
    float.sources[0].published_year = 2024.5;
    expect(() => createMemeticLandscape(float)).toThrow();

    const malformed: any = minimalInput();
    malformed.topic.label = "\ud800";
    expect(() => createMemeticLandscape(malformed)).toThrow();

    expect(() => canonicalJson({ value: -0 })).toThrow();
  });

  test("rejects tampered IDs, extra fields, fixed boundaries, and unknown references", () => {
    const landscape = minimalLandscape();
    const tampered: any = structuredClone(landscape);
    tampered.landscape_id = `sha256:${"0".repeat(64)}`;
    expect(() => validateMemeticLandscape(tampered)).toThrow();

    const extra: any = structuredClone(landscape);
    extra.authority = true;
    expect(() => validateMemeticLandscape(extra)).toThrow();

    const shiftedBoundary: any = structuredClone(landscape);
    shiftedBoundary.boundaries.rights = "participation_required";
    expect(() => validateMemeticLandscape(shiftedBoundary)).toThrow();

    const shift = minimalShift(landscape);
    expect(() => createMemeticReachabilityShift(landscape, {
      ...minimalShiftInput(landscape),
      focus_variant_ref: `sha256:${"f".repeat(64)}`,
    })).toThrow();

    const analogy = createPolymorphMemeticAnalogy({
      polymorph_shift_id: `sha256:${"a".repeat(64)}`,
      memetic_shift_id: shift.shift_id,
    });
    const tamperedAnalogy: any = structuredClone(analogy);
    tamperedAnalogy.non_transfer = tamperedAnalogy.non_transfer.filter((value: string) => value !== "consent");
    expect(() => validatePolymorphMemeticAnalogy(tamperedAnalogy)).toThrow();
  });

  test("rejects tampered deterministic lessons and analogy/shift mismatch", () => {
    const { landscape, shift, analogy } = createBrainrotTeachingCase();
    const lesson = projectMemeticLesson(landscape, shift, analogy, { language: "en" });
    const tampered: any = structuredClone(lesson);
    tampered.diagnostic_claim = true;
    expect(() => validateMemeticLesson(landscape, shift, analogy, tampered)).toThrow();

    const unrelated = createPolymorphMemeticAnalogy({
      polymorph_shift_id: analogy.polymorph_shift.shift_id,
      memetic_shift_id: `sha256:${"f".repeat(64)}`,
    });
    expect(() => projectMemeticLesson(landscape, shift, unrelated, { language: "en" })).toThrow(/does not bind/);
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
