import { describe, expect, test } from "bun:test";

import {
  canonicalJson,
  domainSeparatedId,
  sha256Id,
  snapshotJson,
} from "../src/canonical.js";
import {
  LivingSubstrateError,
  createLivingSubstrateMap,
} from "../src/index.js";

const id = (character: string) => `sha256:${character.repeat(64)}` as const;

function emptyInput() {
  return { scope_ref: id("0"), facets: [], relations: [] };
}

describe("hostile canonical input boundary", () => {
  test("rejects direct, nested, function, and revoked Proxies without traps", () => {
    let traps = 0;
    const handlers: ProxyHandler<object> = {
      ownKeys() {
        traps += 1;
        throw new Error("entered ownKeys");
      },
      getOwnPropertyDescriptor() {
        traps += 1;
        throw new Error("entered descriptor");
      },
      getPrototypeOf() {
        traps += 1;
        throw new Error("entered prototype");
      },
      get() {
        traps += 1;
        throw new Error("entered get");
      },
    };
    const direct = new Proxy(emptyInput(), handlers);
    expect(() => createLivingSubstrateMap(direct)).toThrow(/Proxy/);

    const nested = {
      ...emptyInput(),
      facets: [new Proxy({}, handlers)],
    };
    expect(() => createLivingSubstrateMap(nested as never)).toThrow(/Proxy/);

    const callable = new Proxy(function noop() {}, handlers);
    expect(() => canonicalJson(callable)).toThrow(/Proxy/);
    expect(() => sha256Id(callable as never)).toThrow(/Proxy/);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(() => snapshotJson(revoked.proxy)).toThrow(/Proxy/);
    expect(traps).toBe(0);
  });

  test("rejects accessors without invoking them", () => {
    let calls = 0;
    const input = emptyInput() as Record<string, unknown>;
    Object.defineProperty(input, "hidden", {
      enumerable: true,
      get() {
        calls += 1;
        throw new Error("getter invoked");
      },
    });
    expect(() => createLivingSubstrateMap(input as never)).toThrow(
      /own enumerable data property/,
    );
    expect(calls).toBe(0);
  });

  test("rejects symbols, cycles, sparse arrays, and custom prototypes", () => {
    const withSymbol = emptyInput() as Record<PropertyKey, unknown>;
    withSymbol[Symbol("private")] = "secret";
    expect(() => createLivingSubstrateMap(withSymbol as never)).toThrow(
      /symbol property/,
    );

    const cyclic = emptyInput() as Record<string, unknown>;
    cyclic.self = cyclic;
    expect(() => createLivingSubstrateMap(cyclic as never)).toThrow(/cycles/);

    const sparse = emptyInput();
    sparse.facets = new Array(1) as never[];
    expect(() => createLivingSubstrateMap(sparse)).toThrow(/dense Array/);

    const customArray = [] as unknown[];
    Object.setPrototypeOf(customArray, {});
    expect(() =>
      createLivingSubstrateMap({
        ...emptyInput(),
        facets: customArray as never[],
      }),
    ).toThrow(/standard Array/);

    const customObject = Object.create({ inherited: true });
    Object.assign(customObject, emptyInput());
    expect(() => createLivingSubstrateMap(customObject)).toThrow(
      /plain or null-prototype object/,
    );
  });

  test("rejects malformed Unicode, unsafe numbers, bigint, and extra properties", () => {
    expect(() =>
      createLivingSubstrateMap({
        ...emptyInput(),
        scope_ref: "\ud800" as never,
      }),
    ).toThrow(/malformed Unicode/);
    expect(() =>
      createLivingSubstrateMap({
        ...emptyInput(),
        unsafe: Number.MAX_SAFE_INTEGER + 1,
      } as never),
    ).toThrow(/safe integers/);
    expect(() =>
      createLivingSubstrateMap({
        ...emptyInput(),
        bigint: 1n,
      } as never),
    ).toThrow(/not canonical JSON/);
    expect(() =>
      createLivingSubstrateMap({
        ...emptyInput(),
        prose: "the whole private task",
      } as never),
    ).toThrow(/must contain exactly/);
  });

  test("never reflects caller-controlled property names into diagnostics", () => {
    const privateKey = "SECRET_VALUE_DO_NOT_LOG\nforged diagnostic";
    const input = emptyInput() as Record<string, unknown>;
    input[privateKey] = 1n;
    let message = "";
    try {
      createLivingSubstrateMap(input as never);
    } catch (error) {
      expect(error).toBeInstanceOf(LivingSubstrateError);
      message = (error as Error).message;
    }
    expect(message).toMatch(/\{property:\d+\}/);
    expect(message).not.toContain("SECRET_VALUE_DO_NOT_LOG");
    expect(message).not.toContain("forged diagnostic");
    expect(message).not.toContain("\n");
  });

  test("copies genuine Uint8Array bytes without caller iterators", () => {
    class HostileBytes extends Uint8Array {
      override [Symbol.iterator](): ArrayIterator<number> {
        throw new Error("iterator must not run");
      }
    }
    const bytes = new HostileBytes([1, 2, 3]);
    expect(sha256Id(bytes)).toBe(
      "sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
    expect(() => sha256Id(new Proxy(bytes, {}) as never)).toThrow(/Proxy/);
  });

  test("requires a primitive bounded domain without coercion", () => {
    let calls = 0;
    const domain = new Proxy(
      {},
      {
        get() {
          calls += 1;
          throw new Error("coercion entered");
        },
      },
    );
    expect(() => domainSeparatedId(domain as never, {})).toThrow(/Proxy/);
    expect(() => domainSeparatedId("", {})).toThrow(/bounded ASCII/);
    expect(calls).toBe(0);
  });

  test("uses Unicode code-point key ordering", () => {
    const value = {
      "\ud83d\ude00": 1,
      "\uffff": 2,
      a: 3,
    };
    expect(canonicalJson(value)).toBe('{"a":3,"￿":2,"😀":1}');
  });

  test("uses a typed error class", () => {
    try {
      createLivingSubstrateMap({ ...emptyInput(), scope_ref: "nope" as never });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(LivingSubstrateError);
      expect((error as LivingSubstrateError).code).toBe("map_error");
    }
  });
});
