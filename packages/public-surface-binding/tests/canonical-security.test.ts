import { describe, expect, test } from "bun:test";

import {
  canonicalJson,
  decodeCanonicalRecord,
  domainSeparatedId,
  encodeCanonicalRecord,
  signingDigest,
  snapshotJsonData,
} from "../src/canonical.js";
import { PublicSurfaceBindingError } from "../src/errors.js";

function expectCode(action: () => unknown, code: PublicSurfaceBindingError["code"]): void {
  try {
    action();
    throw new Error("expected PublicSurfaceBindingError");
  } catch (error) {
    expect(error).toBeInstanceOf(PublicSurfaceBindingError);
    expect((error as PublicSurfaceBindingError).code).toBe(code);
  }
}

describe("bounded canonical JSON", () => {
  test("sorts object names recursively while preserving array order and authored Unicode", () => {
    const left = {
      z: [{ b: 2, a: 1 }, "e\u0301"],
      a: true,
    };
    const reordered = {
      a: true,
      z: [{ a: 1, b: 2 }, "e\u0301"],
    };

    expect(canonicalJson(left)).toBe('{"a":true,"z":[{"a":1,"b":2},"é"]}');
    expect(canonicalJson(left)).toBe(canonicalJson(reordered));
    expect(canonicalJson({ value: "é" })).not.toBe(canonicalJson({ value: "e\u0301" }));
    expect(canonicalJson({ values: [1, 2] })).not.toBe(canonicalJson({ values: [2, 1] }));
  });

  test("pins ascending UTF-16 code-unit key order across supplementary-plane names", () => {
    const replacementCharacter = "\ufffd";
    const supplementaryCharacter = "\ud800\udc00";
    const value = {
      [replacementCharacter]: {
        [replacementCharacter]: "replacement",
        [supplementaryCharacter]: "supplementary",
      },
      [supplementaryCharacter]: {
        [replacementCharacter]: "replacement",
        [supplementaryCharacter]: "supplementary",
      },
    };

    expect(canonicalJson(value)).toBe(
      '{"\ud800\udc00":{"\ud800\udc00":"supplementary","�":"replacement"},"�":{"\ud800\udc00":"supplementary","�":"replacement"}}',
    );
  });

  test("pins ECMAScript JSON escaping without Unicode normalization or optional slash escaping", () => {
    expect(canonicalJson({ value: "\"\b\t\n\f\r\\/\u0001\u2028" })).toBe(
      '{"value":"\\"\\b\\t\\n\\f\\r\\\\/\\u0001 "}',
    );
  });

  test("rejects every non-profile JSON primitive", () => {
    for (const value of [-0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expectCode(() => canonicalJson(value), "INVALID_INPUT");
    }
    for (const value of [undefined, 1n, Symbol("x"), () => undefined]) {
      expectCode(() => canonicalJson(value), "INVALID_INPUT");
    }
  });

  test("rejects NUL and every lone-surrogate position", () => {
    for (const value of ["a\0b", "\ud800", "\udc00", "a\ud800b", "a\udc00b"]) {
      expectCode(() => canonicalJson({ value }), "INVALID_INPUT");
    }
    expect(() => canonicalJson({ value: "\ud83d\udc9b" })).not.toThrow();
  });

  test("rejects hostile object machinery without invoking accessors or proxy traps", () => {
    let getterRan = false;
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, "secret", {
      enumerable: true,
      get() {
        getterRan = true;
        return "should-not-run";
      },
    });
    expectCode(() => snapshotJsonData(accessor), "INVALID_INPUT");
    expect(getterRan).toBe(false);

    let proxyTrapRan = false;
    const proxy = new Proxy({}, {
      ownKeys() {
        proxyTrapRan = true;
        throw new Error("trap must not run");
      },
    });
    expectCode(() => snapshotJsonData(proxy), "INVALID_INPUT");
    expect(proxyTrapRan).toBe(false);
  });

  test("rejects cycles, sparse arrays, array decorations, symbols, hidden fields, and prototypes", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expectCode(() => canonicalJson(cyclic), "INVALID_INPUT");

    const sparse = new Array(2);
    sparse[1] = "present";
    expectCode(() => canonicalJson(sparse), "INVALID_INPUT");

    const decorated = ["only"] as unknown[] & { tag?: string };
    decorated.tag = "extra";
    expectCode(() => canonicalJson(decorated), "INVALID_INPUT");

    const symbolled = { ordinary: true } as Record<PropertyKey, unknown>;
    symbolled[Symbol("hidden")] = true;
    expectCode(() => canonicalJson(symbolled), "INVALID_INPUT");

    const hidden = {};
    Object.defineProperty(hidden, "value", { value: 1, enumerable: false });
    expectCode(() => canonicalJson(hidden), "INVALID_INPUT");

    expectCode(() => canonicalJson(new Date("2026-08-16T00:00:00.000Z")), "INVALID_INPUT");
  });

  test("rejects array subclasses and arrays with altered prototypes", () => {
    class DerivedArray extends Array<unknown> {}
    const derived = new DerivedArray();
    derived.push("value");
    expectCode(() => canonicalJson(derived), "INVALID_INPUT");

    const nullPrototype = ["value"];
    Object.setPrototypeOf(nullPrototype, null);
    expectCode(() => canonicalJson(nullPrototype), "INVALID_INPUT");

    const customPrototype = ["value"];
    Object.setPrototypeOf(customPrototype, Object.create(Array.prototype));
    expectCode(() => canonicalJson(customPrototype), "INVALID_INPUT");
  });

  test("bounds huge containers before bulk key or descriptor inspection", () => {
    const hugeArray = new Array(4_096).fill(null);
    const originalOwnKeys = Reflect.ownKeys;
    const originalDescriptor = Object.getOwnPropertyDescriptor;
    let arrayOwnKeysRan = false;
    let arrayElementDescriptorRan = false;
    let arrayFailure: unknown;
    try {
      Reflect.ownKeys = ((target: object) => {
        if (target === hugeArray) arrayOwnKeysRan = true;
        return originalOwnKeys(target);
      }) as typeof Reflect.ownKeys;
      Object.getOwnPropertyDescriptor = ((target: object, key: PropertyKey) => {
        if (target === hugeArray && key !== "length") arrayElementDescriptorRan = true;
        return originalDescriptor(target, key);
      }) as typeof Object.getOwnPropertyDescriptor;
      canonicalJson(hugeArray);
    } catch (error) {
      arrayFailure = error;
    } finally {
      Reflect.ownKeys = originalOwnKeys;
      Object.getOwnPropertyDescriptor = originalDescriptor;
    }
    expect(arrayFailure).toBeInstanceOf(PublicSurfaceBindingError);
    expect((arrayFailure as PublicSurfaceBindingError).code).toBe("LIMIT_EXCEEDED");
    expect(arrayOwnKeysRan).toBe(false);
    expect(arrayElementDescriptorRan).toBe(false);

    const hugeObject: Record<string, null> = {};
    for (let index = 0; index < 4_096; index += 1) hugeObject[`k${index}`] = null;
    let objectOwnKeysRan = false;
    let objectDescriptorRan = false;
    let objectFailure: unknown;
    try {
      Reflect.ownKeys = ((target: object) => {
        if (target === hugeObject) objectOwnKeysRan = true;
        return originalOwnKeys(target);
      }) as typeof Reflect.ownKeys;
      Object.getOwnPropertyDescriptor = ((target: object, key: PropertyKey) => {
        if (target === hugeObject) objectDescriptorRan = true;
        return originalDescriptor(target, key);
      }) as typeof Object.getOwnPropertyDescriptor;
      canonicalJson(hugeObject);
    } catch (error) {
      objectFailure = error;
    } finally {
      Reflect.ownKeys = originalOwnKeys;
      Object.getOwnPropertyDescriptor = originalDescriptor;
    }
    expect(objectFailure).toBeInstanceOf(PublicSurfaceBindingError);
    expect((objectFailure as PublicSurfaceBindingError).code).toBe("LIMIT_EXCEEDED");
    expect(objectOwnKeysRan).toBe(true);
    expect(objectDescriptorRan).toBe(false);
  });

  test("accepts null-prototype data and treats prototype-pollution spellings as ordinary names", () => {
    const value = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(value, "__proto__", {
      enumerable: true,
      value: "not-a-prototype",
    });
    value.constructor = "not-a-constructor";
    expect(canonicalJson(value)).toBe(
      '{"__proto__":"not-a-prototype","constructor":"not-a-constructor"}',
    );
    expect(Object.getPrototypeOf(snapshotJsonData(value))).toBeNull();
  });

  test("rejects canonical depth, node, string, and record byte exhaustion", () => {
    let deep: unknown = null;
    for (let index = 0; index < 34; index += 1) deep = [deep];
    expectCode(() => canonicalJson(deep), "LIMIT_EXCEEDED");

    expectCode(() => canonicalJson(new Array(4_097).fill(null)), "LIMIT_EXCEEDED");
    expectCode(() => canonicalJson("x".repeat(4_097)), "LIMIT_EXCEEDED");
    expectCode(
      () => canonicalJson(new Array(40).fill("x".repeat(4_000))),
      "LIMIT_EXCEEDED",
    );
  });
});

describe("canonical byte parser and domains", () => {
  test("accepts only the exact canonical UTF-8 record bytes", () => {
    const canonical = encodeCanonicalRecord({ b: 2, a: 1 });
    expect(decodeCanonicalRecord(canonical)).toEqual({ a: 1, b: 2 });

    for (const text of [
      '{"b":2,"a":1}',
      '{ "a": 1, "b": 2 }',
      '{"a":1,"a":2}',
      '{"a":1}\n',
      '{"a":1.0}',
      '{"a":"\\u0061"}',
      '{"a":"\\/"}',
      '{"a":"\\u2028"}',
    ]) {
      expectCode(
        () => decodeCanonicalRecord(new TextEncoder().encode(text)),
        "CANONICAL_BYTES_INVALID",
      );
    }
    expectCode(
      () => decodeCanonicalRecord(new Uint8Array([0xc3, 0x28])),
      "CANONICAL_BYTES_INVALID",
    );
  });

  test("rejects hostile byte views without invoking caller-defined accessors", () => {
    const canonical = encodeCanonicalRecord({ a: 1 });
    expectCode(
      () => decodeCanonicalRecord(new Proxy(canonical, {})),
      "INVALID_INPUT",
    );

    let byteLengthGetterRan = false;
    class HostileBytes extends Uint8Array {
      override get byteLength(): number {
        byteLengthGetterRan = true;
        return super.byteLength;
      }
    }
    const hostile = new HostileBytes(canonical);
    expectCode(() => decodeCanonicalRecord(hostile), "INVALID_INPUT");
    expect(byteLengthGetterRan).toBe(false);

    let iteratorGetterRan = false;
    const decorated = canonical.slice();
    Object.defineProperty(decorated, Symbol.iterator, {
      configurable: true,
      get() {
        iteratorGetterRan = true;
        return Uint8Array.prototype[Symbol.iterator];
      },
    });
    expectCode(() => decodeCanonicalRecord(decorated), "INVALID_INPUT");
    expect(iteratorGetterRan).toBe(false);
  });

  test("domain separation changes both signing digest and content ID", () => {
    const value = { same: "core" };
    expect(signingDigest("binding/v1", value)).not.toEqual(signingDigest("revocation/v1", value));
    expect(domainSeparatedId("binding/v1", value)).not.toBe(
      domainSeparatedId("revocation/v1", value),
    );
  });

  test("rejects malformed signing domains", () => {
    for (const domain of ["", "Binding/v1", " leading/v1", "binding:v1", "x".repeat(129)]) {
      expectCode(() => signingDigest(domain, {}), "INVALID_INPUT");
    }
  });
});
