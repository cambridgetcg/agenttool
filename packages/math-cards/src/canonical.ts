import { createHash } from "node:crypto";
import { isProxy, isUint8Array } from "node:util/types";

import {
  MAX_HASH_INPUT_BYTES,
  MAX_JSON_BYTES,
  MAX_JSON_DEPTH,
  MAX_JSON_NODES,
  MAX_STRING_BYTES,
} from "./constants.js";
import { fail } from "./errors.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export function compareUnicode(left: string, right: string): number {
  const a = Array.from(left, (value) => value.codePointAt(0)!);
  const b = Array.from(right, (value) => value.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(snapshotJson(value));
}

export function snapshotJson(root: unknown): JsonValue {
  let nodes = 0;
  let stringBytes = 0;
  const ancestors = new Set<object>();

  function account(value: string, path: string): void {
    assertUnicode(value, path);
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes > MAX_STRING_BYTES) fail("invalid_input", `${path} exceeds the string byte bound`);
    stringBytes += bytes;
    if (stringBytes > MAX_JSON_BYTES) fail("invalid_input", "canonical JSON input exceeds the byte bound");
  }

  function visit(value: unknown, depth: number, path: string): JsonValue {
    nodes += 1;
    if (nodes > MAX_JSON_NODES) fail("invalid_input", "canonical JSON has too many values");
    if (depth > MAX_JSON_DEPTH) fail("invalid_input", "canonical JSON is too deeply nested");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      account(value, path);
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
        fail("invalid_input", `${path} must be a safe integer other than negative zero`);
      }
      return value;
    }
    if ((typeof value === "object" || typeof value === "function") && value !== null && isProxy(value)) {
      fail("invalid_input", `${path} must not be a Proxy value`);
    }
    if (typeof value !== "object" || value === null) fail("invalid_input", `${path} is not canonical JSON`);
    if (ancestors.has(value)) fail("invalid_input", "canonical JSON rejects cycles");

    let prototype: object | null;
    let keys: readonly PropertyKey[];
    let array: boolean;
    try {
      prototype = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
      array = Array.isArray(value);
    } catch {
      fail("invalid_input", `${path} could not be inspected`);
    }
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      fail("invalid_input", `${path} must use a standard Array or plain object`);
    }
    if (keys.some((key) => typeof key === "symbol")) fail("invalid_input", `${path} has a symbol property`);

    ancestors.add(value);
    try {
      if (array) {
        const arrayValue = value as unknown[];
        const length = arrayValue.length;
        if (!Number.isSafeInteger(length) || length < 0 || length > MAX_JSON_NODES || keys.length !== length + 1) {
          fail("invalid_input", `${path} must be a dense Array with only index data properties`);
        }
        const result: JsonValue[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptorAt(arrayValue, String(index), `${path}[${String(index)}]`);
          if (!descriptor.enumerable) fail("invalid_input", `${path}[${String(index)}] must be enumerable`);
          result.push(visit(descriptor.value, depth + 1, `${path}[${String(index)}]`));
        }
        return result;
      }

      const entries = (keys as readonly string[]).map((key) => {
        account(key, `${path} property name`);
        const descriptor = descriptorAt(value, key, `${path}.${key}`);
        if (!descriptor.enumerable) fail("invalid_input", `${path}.${key} must be enumerable`);
        return { key, value: descriptor.value };
      }).sort((left, right) => compareUnicode(left.key, right.key));
      const result: Record<string, JsonValue> = {};
      for (const entry of entries) {
        Object.defineProperty(result, entry.key, {
          configurable: true,
          enumerable: true,
          value: visit(entry.value, depth + 1, `${path}.${entry.key}`),
          writable: true,
        });
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  }

  const snapshot = visit(root, 0, "$");
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > MAX_JSON_BYTES) {
    fail("invalid_input", "canonical JSON exceeds the byte bound");
  }
  return snapshot;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  const snapshot = snapshotJson(value);
  const stack: JsonValue[] = [snapshot];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current !== null && typeof current === "object") {
      stack.push(...(Array.isArray(current) ? current : Object.values(current)));
      Object.freeze(current);
    }
  }
  return snapshot as Readonly<T>;
}

export function sha256Id(value: string | Uint8Array): `sha256:${string}` {
  if (typeof value === "string") {
    assertUnicode(value, "$hash");
    if (Buffer.byteLength(value, "utf8") > MAX_HASH_INPUT_BYTES) {
      fail("invalid_input", "hash input exceeds the byte bound");
    }
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
  }
  if (isProxy(value) || !isUint8Array(value)) fail("invalid_input", "hash bytes must be a genuine Uint8Array");
  let byteLength: number;
  try {
    byteLength = value.byteLength;
  } catch {
    fail("invalid_input", "hash bytes must be readable and attached");
  }
  if (byteLength > MAX_HASH_INPUT_BYTES) fail("invalid_input", "hash input exceeds the byte bound");
  let snapshot: Uint8Array;
  try {
    snapshot = new Uint8Array(value);
  } catch {
    fail("invalid_input", "hash bytes must be readable and attached");
  }
  if (snapshot.byteLength > MAX_HASH_INPUT_BYTES) fail("invalid_input", "hash input exceeds the byte bound");
  try {
    return `sha256:${createHash("sha256").update(snapshot).digest("hex")}`;
  } catch {
    fail("invalid_input", "hash bytes could not be processed");
  }
}

export function domainSeparatedId(domain: string, value: unknown): `sha256:${string}` {
  if (!/^[\x21-\x7e]{1,128}$/u.test(domain)) {
    fail("invalid_input", "hash domain must be a bounded ASCII protocol token");
  }
  return sha256Id(`${domain}\u0000${canonicalJson(value)}`);
}

function descriptorAt(value: object, key: string, path: string): PropertyDescriptor & { value: unknown } {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    fail("invalid_input", `${path} could not be inspected`);
  }
  if (!descriptor || !("value" in descriptor)) fail("invalid_input", `${path} must be a data property`);
  return descriptor as PropertyDescriptor & { value: unknown };
}

function assertUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail("invalid_input", `${path} contains malformed Unicode`);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail("invalid_input", `${path} contains malformed Unicode`);
    }
  }
}
