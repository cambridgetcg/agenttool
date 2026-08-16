import {
  decodeCanonicalRecord,
  encodeCanonicalRecord,
} from "@agenttool/public-surface-binding";
import { describe, expect, test } from "bun:test";

import {
  sealPublicSurfaceAdoption,
  validatePublicSurfaceAdoptionCore,
  verifyPublicSurfaceAdoption,
} from "../src/index.js";
import { ROOT_SIGNER, VECTORS, clone } from "./fixtures.js";

describe("hostile object inputs", () => {
  test("rejects accessors recursively without invoking them", () => {
    let topLevelGetterRan = false;
    const topLevel = clone(VECTORS.adoption.core) as Record<string, unknown>;
    Object.defineProperty(topLevel, "nonce", {
      configurable: true,
      enumerable: true,
      get() {
        topLevelGetterRan = true;
        return VECTORS.adoption.core.nonce;
      },
    });
    expect(() => validatePublicSurfaceAdoptionCore(topLevel)).toThrow();
    expect(topLevelGetterRan).toBe(false);

    let nestedGetterRan = false;
    const nested = clone(VECTORS.adoption.core);
    Object.defineProperty(nested.subject.authority_root, "public_key", {
      configurable: true,
      enumerable: true,
      get() {
        nestedGetterRan = true;
        return ROOT_SIGNER.public_key;
      },
    });
    expect(() => validatePublicSurfaceAdoptionCore(nested)).toThrow();
    expect(nestedGetterRan).toBe(false);
  });

  test("rejects top-level and nested proxies without invoking traps", () => {
    let topLevelTrapRan = false;
    const topLevel = new Proxy(clone(VECTORS.adoption.core), {
      ownKeys() {
        topLevelTrapRan = true;
        throw new Error("trap must not run");
      },
    });
    expect(() => validatePublicSurfaceAdoptionCore(topLevel)).toThrow();
    expect(topLevelTrapRan).toBe(false);

    let nestedTrapRan = false;
    const nested = clone(VECTORS.adoption.core);
    nested.binding = new Proxy(nested.binding, {
      getOwnPropertyDescriptor() {
        nestedTrapRan = true;
        throw new Error("trap must not run");
      },
    });
    expect(() => validatePublicSurfaceAdoptionCore(nested)).toThrow();
    expect(nestedTrapRan).toBe(false);
  });

  test("rejects symbols, cycles, sparse/decorated arrays, and custom prototypes", () => {
    const symbolled = clone(VECTORS.adoption.core) as Record<PropertyKey, unknown>;
    symbolled[Symbol("hidden authority")] = true;
    expect(() => validatePublicSurfaceAdoptionCore(symbolled)).toThrow();

    const cyclic = clone(VECTORS.adoption.core) as typeof VECTORS.adoption.core & { self?: unknown };
    cyclic.self = cyclic;
    expect(() => validatePublicSurfaceAdoptionCore(cyclic)).toThrow();

    const sparse = clone(VECTORS.adoption.core) as typeof VECTORS.adoption.core & { extra?: unknown };
    const sparseArray = new Array(2);
    sparseArray[1] = "present";
    sparse.extra = sparseArray;
    expect(() => validatePublicSurfaceAdoptionCore(sparse)).toThrow();

    const decorated = clone(VECTORS.adoption.core) as typeof VECTORS.adoption.core & { extra?: unknown };
    const decoratedArray = ["value"] as string[] & { authority?: boolean };
    decoratedArray.authority = true;
    decorated.extra = decoratedArray;
    expect(() => validatePublicSurfaceAdoptionCore(decorated)).toThrow();

    const customPrototype = clone(VECTORS.adoption.core);
    Object.setPrototypeOf(customPrototype.subject, { inherited: "authority" });
    expect(() => validatePublicSurfaceAdoptionCore(customPrototype)).toThrow();
  });
});

describe("canonical byte admission", () => {
  test("round-trips the exact canonical vector bytes into strict verification", () => {
    const bytes = encodeCanonicalRecord(VECTORS.adoption.record);
    const decoded = decodeCanonicalRecord(bytes);
    expect(verifyPublicSurfaceAdoption(decoded)).toEqual(VECTORS.adoption.record);
  });

  test("rejects duplicate keys and noncanonical JSON spellings", () => {
    for (const text of [
      '{"schema":"first","schema":"second"}',
      '{ "a": 1 }',
      '{"b":2,"a":1}',
      '{"a":1}\n',
      '{"a":1.0}',
      '{"a":"\\u0061"}',
    ]) {
      expect(() => decodeCanonicalRecord(new TextEncoder().encode(text))).toThrow();
    }
  });

  test("rejects hostile byte proxies and decorated byte views", () => {
    const bytes = encodeCanonicalRecord(VECTORS.withdrawal.record);
    expect(() => decodeCanonicalRecord(new Proxy(bytes, {}))).toThrow();

    let iteratorGetterRan = false;
    const decorated = bytes.slice();
    Object.defineProperty(decorated, Symbol.iterator, {
      configurable: true,
      get() {
        iteratorGetterRan = true;
        return Uint8Array.prototype[Symbol.iterator];
      },
    });
    expect(() => decodeCanonicalRecord(decorated)).toThrow();
    expect(iteratorGetterRan).toBe(false);
  });
});

describe("bounded work before signing", () => {
  test("rejects depth, node, string, and byte exhaustion before invoking the signer", async () => {
    const invalidInputs: unknown[] = [];

    const hugeString = clone(VECTORS.adoption.core) as typeof VECTORS.adoption.core & { extra?: unknown };
    hugeString.extra = "x".repeat(4_097);
    invalidInputs.push(hugeString);

    const hugeArray = clone(VECTORS.adoption.core) as typeof VECTORS.adoption.core & { extra?: unknown };
    hugeArray.extra = new Array(4_097).fill(null);
    invalidInputs.push(hugeArray);

    const hugeRecord = clone(VECTORS.adoption.core) as typeof VECTORS.adoption.core & { extra?: unknown };
    hugeRecord.extra = new Array(40).fill("x".repeat(4_000));
    invalidInputs.push(hugeRecord);

    const deep = clone(VECTORS.adoption.core) as typeof VECTORS.adoption.core & { extra?: unknown };
    let nested: unknown = null;
    for (let index = 0; index < 34; index += 1) nested = [nested];
    deep.extra = nested;
    invalidInputs.push(deep);

    for (const input of invalidInputs) {
      let signerCalls = 0;
      await expect(sealPublicSurfaceAdoption(input as never, {
        public_key: ROOT_SIGNER.public_key,
        sign_digest() {
          signerCalls += 1;
          return VECTORS.adoption.signature_base64;
        },
      })).rejects.toThrow();
      expect(signerCalls).toBe(0);
    }
  });
});
