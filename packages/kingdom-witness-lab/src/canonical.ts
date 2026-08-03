import { createHash } from "node:crypto";

import { fail } from "./errors.js";

const MAX_JSON_BYTES = 256 * 1024;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 4_096;
const MAX_STRING_BYTES = 16 * 1024;
const arrayIsArray = Array.isArray;
const byteLength = Buffer.byteLength.bind(Buffer);
const jsonStringify = JSON.stringify;
const numberIsSafeInteger = Number.isSafeInteger;
const objectCreate = Object.create;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectIs = Object.is;
const objectIsFrozen = Object.isFrozen;
const objectKeys = Object.keys;
const objectValues = Object.values;
const reflectOwnKeys = Reflect.ownKeys;
const SafeSet = Set;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

function assertUnicode(value: string, path: string): void {
  if (byteLength(value, "utf8") > MAX_STRING_BYTES) {
    fail("canonical_error", `${path} exceeds ${MAX_STRING_BYTES} UTF-8 bytes`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0) fail("canonical_error", `${path} contains forbidden U+0000`);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        fail("canonical_error", `${path} contains a lone UTF-16 surrogate`);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail("canonical_error", `${path} contains a lone UTF-16 surrogate`);
    }
  }
}

export function snapshotJson(root: unknown): JsonValue {
  let nodes = 0;
  const seen = new SafeSet<object>();

  function visit(value: unknown, depth: number, path: string): JsonValue {
    nodes += 1;
    if (nodes > MAX_JSON_NODES) fail("canonical_error", "Canonical JSON has too many values");
    if (depth > MAX_JSON_DEPTH) fail("canonical_error", "Canonical JSON is too deeply nested");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      assertUnicode(value, path);
      return value;
    }
    if (typeof value === "number") {
      if (!numberIsSafeInteger(value) || objectIs(value, -0)) {
        fail("canonical_error", `${path} must be a safe integer and not negative zero`);
      }
      return value;
    }
    if (typeof value !== "object") {
      fail("canonical_error", `${path} contains unsupported ${typeof value}`);
    }
    if (seen.has(value)) fail("canonical_error", `${path} contains a cycle`);
    seen.add(value);
    try {
      const array = arrayIsArray(value);
      let descriptors: ReturnType<typeof Object.getOwnPropertyDescriptors>;
      let prototype: object | null = null;
      try {
        descriptors = objectGetOwnPropertyDescriptors(value);
        if (!array) prototype = objectGetPrototypeOf(value);
      } catch {
        fail("canonical_error", `${path} could not be inspected as canonical JSON`);
      }
      const keys = reflectOwnKeys(descriptors);
      if (array) {
        const lengthDescriptor = descriptors.length;
        if (
          !lengthDescriptor
          || lengthDescriptor.enumerable
          || !("value" in lengthDescriptor)
          || !numberIsSafeInteger(lengthDescriptor.value)
          || lengthDescriptor.value < 0
        ) {
          fail("canonical_error", `${path} must be a dense array without extra properties`);
        }
        const length = lengthDescriptor.value as number;
        if (length > MAX_JSON_NODES || keys.length !== length + 1) {
          fail("canonical_error", `${path} must be a dense array without extra properties`);
        }
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
      const output = objectCreate(null) as Record<string, JsonValue>;
      for (const key of keys) {
        if (typeof key !== "string") fail("canonical_error", `${path} has a symbol property`);
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          fail("canonical_error", `${path}.${key} must be an enumerable data property`);
        }
        assertUnicode(key, `${path}.{key}`);
        output[key] = visit(descriptor.value, depth + 1, `${path}.${key}`);
      }
      return output;
    } finally {
      seen.delete(value);
    }
  }

  return visit(root, 0, "$");
}

function serialize(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number") return jsonStringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  return `{${objectKeys(value)
    .sort()
    .map((key) => `${jsonStringify(key)}:${serialize(value[key] as JsonValue)}`)
    .join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  const json = serialize(snapshotJson(value));
  if (byteLength(json, "utf8") > MAX_JSON_BYTES) {
    fail("canonical_error", `Canonical JSON exceeds ${MAX_JSON_BYTES} bytes`);
  }
  return json;
}

export function sha256Id(bytes: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function domainSeparatedId(domain: string, value: unknown): `sha256:${string}` {
  return sha256Id(`${domain}\0${canonicalJson(value)}`);
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !objectIsFrozen(value)) {
    for (const nested of objectValues(value as Record<string, unknown>)) deepFreeze(nested);
    objectFreeze(value);
  }
  return value as Readonly<T>;
}
