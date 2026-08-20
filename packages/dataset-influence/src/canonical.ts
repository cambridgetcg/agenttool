import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

import { fail } from "./errors.js";
import type { Sha256Id } from "./types.js";

const MAX_JSON_BYTES = 256 * 1024;
const MAX_JSON_DEPTH = 24;
const MAX_JSON_NODES = 8_192;
const MAX_STRING_BYTES = 8 * 1024;
const DOMAIN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function assertScalarUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        fail("canonical_error", `${path} contains a lone UTF-16 surrogate`);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail("canonical_error", `${path} contains a lone UTF-16 surrogate`);
    }
  }
}

function assertUnicode(value: string, path: string): void {
  assertScalarUnicode(value, path);
  if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) {
    fail("canonical_error", `${path} exceeds ${MAX_STRING_BYTES} UTF-8 bytes`);
  }
  if (value.includes("\0")) fail("canonical_error", `${path} contains forbidden U+0000`);
}

export function snapshotJson(root: unknown): JsonValue {
  let nodes = 0;
  let jsonBytes = 0;
  const seen = new Set<object>();

  function charge(bytes: number): void {
    jsonBytes += bytes;
    if (jsonBytes > MAX_JSON_BYTES) fail("canonical_error", `Canonical JSON exceeds ${MAX_JSON_BYTES} bytes`);
  }

  function visit(value: unknown, depth: number, path: string): JsonValue {
    nodes += 1;
    if (nodes > MAX_JSON_NODES) fail("canonical_error", "Canonical JSON has too many values");
    if (depth > MAX_JSON_DEPTH) fail("canonical_error", "Canonical JSON is too deeply nested");
    if (value === null) {
      charge(4);
      return value;
    }
    if (typeof value === "boolean") {
      charge(value ? 4 : 5);
      return value;
    }
    if (typeof value === "string") {
      assertUnicode(value, path);
      charge(Buffer.byteLength(JSON.stringify(value), "utf8"));
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
        fail("canonical_error", `${path} must be a safe integer and not negative zero`);
      }
      charge(Buffer.byteLength(JSON.stringify(value), "utf8"));
      return value;
    }
    if (typeof value !== "object") fail("canonical_error", `${path} contains unsupported ${typeof value}`);
    if (isProxy(value)) fail("canonical_error", `${path} must not be a Proxy value`);
    if (seen.has(value)) fail("canonical_error", `${path} contains a cycle`);
    seen.add(value);
    try {
      const arrayValue = Array.isArray(value);
      let descriptors: ReturnType<typeof Object.getOwnPropertyDescriptors>;
      let arrayLength: number | null = null;
      let keys: ReturnType<typeof Reflect.ownKeys>;
      let prototype: object | null = null;
      if (arrayValue) {
        let length: unknown;
        try {
          length = Object.getOwnPropertyDescriptor(value, "length")?.value;
        } catch {
          fail("canonical_error", `${path} could not be inspected`);
        }
        if (!Number.isSafeInteger(length) || (length as number) < 0) {
          fail("canonical_error", `${path} has an invalid array length`);
        }
        if ((length as number) > MAX_JSON_NODES) {
          fail("canonical_error", `${path} exceeds the canonical value budget`);
        }
        arrayLength = length as number;
      }
      try {
        keys = Reflect.ownKeys(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
        if (!arrayValue) prototype = Object.getPrototypeOf(value);
      } catch {
        fail("canonical_error", `${path} could not be inspected`);
      }
      if (keys.length > MAX_JSON_NODES + (arrayValue ? 1 : 0)) {
        fail("canonical_error", `${path} exceeds the canonical own-key budget`);
      }
      if (arrayValue) {
        const length = arrayLength!;
        if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) {
          fail("canonical_error", `${path} must be a dense array without extra properties`);
        }
        charge(2 + Math.max(0, length - 1));
        const output: JsonValue[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor?.enumerable || !("value" in descriptor)) {
            fail("canonical_error", `${path}[${index}] must be an enumerable data property`);
          }
          output.push(visit(descriptor.value, depth + 1, `${path}[${index}]`));
        }
        return output;
      }
      if (prototype !== Object.prototype && prototype !== null) {
        fail("canonical_error", `${path} must be a plain object`);
      }
      charge(2 + Math.max(0, keys.length - 1));
      const output = Object.create(null) as Record<string, JsonValue>;
      for (const key of keys) {
        if (typeof key !== "string") fail("canonical_error", `${path} has a symbol property`);
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          fail("canonical_error", `${path}.${key} must be an enumerable data property`);
        }
        assertUnicode(key, `${path}.{key}`);
        charge(Buffer.byteLength(JSON.stringify(key), "utf8") + 1);
        output[key] = visit(descriptor.value, depth + 1, `${path}.${key}`);
      }
      return output;
    } finally {
      seen.delete(value);
    }
  }

  return visit(root, 0, "$");
}

export function compareUnicode(left: string, right: string): number {
  const a = Array.from(left, (character) => character.codePointAt(0)!);
  const b = Array.from(right, (character) => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

function serialize(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  return `{${Object.keys(value).sort(compareUnicode).map((key) => `${JSON.stringify(key)}:${serialize(value[key]!)}`).join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  const json = serialize(snapshotJson(value));
  if (Buffer.byteLength(json, "utf8") > MAX_JSON_BYTES) {
    fail("canonical_error", `Canonical JSON exceeds ${MAX_JSON_BYTES} bytes`);
  }
  return json;
}

export function domainSeparatedId(domain: string, value: unknown): Sha256Id {
  if (!DOMAIN.test(domain)) fail("canonical_error", "Invalid protocol domain");
  return `sha256:${createHash("sha256").update(`${domain}\0${canonicalJson(value)}`).digest("hex")}`;
}

export function sha256Id(value: string | Uint8Array): Sha256Id {
  if (typeof value === "string") assertScalarUnicode(value, "$sha256_input");
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value as Readonly<T>;
}
