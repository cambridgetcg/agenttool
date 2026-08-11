import { createHash } from "node:crypto";
import { isProxy, isUint8Array } from "node:util/types";

import { fail } from "./errors.js";

const MAX_DEPTH = 32;
const MAX_NODES = 16_384;
const MAX_STRING_BYTES = 4 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

interface Inspected {
  readonly snapshot: JsonValue;
  readonly encoded: string;
}

interface Inspection extends Inspected {
  readonly originals: readonly object[];
}

export function canonicalJson(value: unknown): string {
  return inspectJson(value).encoded;
}

export function snapshotJson(value: unknown): JsonValue {
  return inspectJson(value).snapshot;
}

export function sha256Id(value: string | Uint8Array): `sha256:${string}` {
  if (typeof value === "string") {
    assertUnicode(value, "$hash");
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
  }
  if (isProxy(value)) fail("invalid_json", "hash bytes must not be a Proxy value");
  if (!isUint8Array(value)) fail("invalid_json", "hash bytes must be a genuine Uint8Array");
  let copy: Uint8Array;
  try {
    copy = new Uint8Array(value);
  } catch {
    fail("invalid_json", "hash bytes could not be copied");
  }
  return `sha256:${createHash("sha256").update(copy).digest("hex")}`;
}

export function domainSeparatedId(domain: string, value: unknown): `sha256:${string}` {
  const candidate: unknown = domain;
  if (typeof candidate !== "string" || !/^[\x21-\x7e]{1,128}$/u.test(candidate)) {
    if (isProxy(candidate)) fail("invalid_json", "hash domain must not be a Proxy value");
    fail("invalid_json", "hash domain must be a bounded ASCII protocol token");
  }
  return sha256Id(`${candidate}\u0000${canonicalJson(value)}`);
}

export function compareUnicode(left: string, right: string): number {
  for (const value of [left, right] as readonly unknown[]) {
    if (typeof value !== "string") {
      if (isProxy(value)) fail("invalid_json", "comparison input must not be a Proxy value");
      fail("invalid_json", "comparison inputs must be strings");
    }
    assertUnicode(value, "$comparison");
  }
  const a = Array.from(left, (character) => character.codePointAt(0)!);
  const b = Array.from(right, (character) => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value === "function" && isProxy(value)) fail("invalid_json", "$ must not be a Proxy value");
  if (value === null || typeof value !== "object") return value as Readonly<T>;
  const { originals } = inspectJson(value, true);
  for (let index = originals.length - 1; index >= 0; index -= 1) {
    try {
      Object.freeze(originals[index]);
    } catch {
      fail("invalid_json", "canonical JSON value could not be frozen");
    }
  }
  return value as Readonly<T>;
}

function inspectJson(root: unknown, captureOriginals = false): Inspection {
  let nodes = 0;
  let inputBytes = 0;
  const seen = new Set<object>();
  const originals: object[] = [];

  function account(value: string, path: string): void {
    assertUnicode(value, path);
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes > MAX_STRING_BYTES) fail("invalid_json", `${path} exceeds the string byte bound`);
    inputBytes += bytes;
    if (inputBytes > MAX_JSON_BYTES) fail("invalid_json", "canonical JSON input exceeds the byte bound");
  }

  function visit(value: unknown, depth: number, path: string): Inspected {
    nodes += 1;
    if (nodes > MAX_NODES) fail("invalid_json", "canonical JSON has too many values");
    if (depth > MAX_DEPTH) fail("invalid_json", "canonical JSON is too deeply nested");
    if (value === null) return { snapshot: null, encoded: "null" };
    if (typeof value === "boolean") return { snapshot: value, encoded: value ? "true" : "false" };
    if (typeof value === "string") {
      account(value, path);
      return { snapshot: value, encoded: JSON.stringify(value) };
    }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
        fail("invalid_json", "canonical JSON accepts safe integers only");
      }
      return { snapshot: value, encoded: String(value) };
    }
    if (typeof value === "function" && isProxy(value)) fail("invalid_json", `${path} must not be a Proxy value`);
    if (typeof value !== "object") fail("invalid_json", `${path} is not canonical JSON`);
    if (isProxy(value)) fail("invalid_json", `${path} must not be a Proxy value`);
    if (seen.has(value)) fail("invalid_json", "canonical JSON rejects cycles");

    let array: boolean;
    let prototype: object | null;
    try {
      array = Array.isArray(value);
      prototype = Object.getPrototypeOf(value);
    } catch {
      fail("invalid_json", `${path} could not be inspected`);
    }
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      fail("invalid_json", `${path} must use a standard Array or plain object`);
    }
    if (captureOriginals) originals.push(value);
    seen.add(value);
    try {
      return array ? inspectArray(value, depth, path, visit) : inspectObject(value, depth, path, visit, account);
    } finally {
      seen.delete(value);
    }
  }

  const inspected = visit(root, 0, "$");
  if (Buffer.byteLength(inspected.encoded, "utf8") > MAX_JSON_BYTES) {
    fail("invalid_json", "canonical JSON exceeds the byte bound");
  }
  return { ...inspected, originals };
}

function inspectArray(
  value: object,
  depth: number,
  path: string,
  visit: (value: unknown, depth: number, path: string) => Inspected,
): Inspected {
  let lengthDescriptor: PropertyDescriptor | undefined;
  let keys: readonly PropertyKey[];
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    keys = Reflect.ownKeys(value);
  } catch {
    fail("invalid_json", `${path} could not be inspected as an Array`);
  }
  if (
    !lengthDescriptor ||
    lengthDescriptor.enumerable ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > MAX_NODES ||
    keys.length !== lengthDescriptor.value + 1 ||
    keys.some((key) => typeof key === "symbol")
  ) {
    fail("invalid_json", `${path} must be a dense Array with only index data properties`);
  }
  const snapshot: JsonValue[] = [];
  let encoded = "[";
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      fail("invalid_json", `${path} could not be inspected as an Array`);
    }
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      fail("invalid_json", `${path}[${String(index)}] must be an enumerable data property`);
    }
    const child = visit(descriptor.value, depth + 1, `${path}[${String(index)}]`);
    snapshot.push(child.snapshot);
    encoded += `${index === 0 ? "" : ","}${child.encoded}`;
  }
  return { snapshot, encoded: `${encoded}]` };
}

function inspectObject(
  value: object,
  depth: number,
  path: string,
  visit: (value: unknown, depth: number, path: string) => Inspected,
  account: (value: string, path: string) => void,
): Inspected {
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    fail("invalid_json", `${path} could not be inspected as an object`);
  }
  if (keys.length > MAX_NODES) fail("invalid_json", `${path} has too many properties`);
  const entries: { key: string; value: unknown }[] = [];
  for (const key of keys) {
    if (typeof key !== "string") fail("invalid_json", `${path} has a symbol property`);
    account(key, `${path} property name`);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      fail("invalid_json", `${path} could not be inspected as an object`);
    }
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      fail("invalid_json", `${path} must contain only enumerable data properties`);
    }
    entries.push({ key, value: descriptor.value });
  }
  entries.sort((left, right) => compareUnicode(left.key, right.key));
  const snapshot: Record<string, JsonValue> = {};
  let encoded = "{";
  entries.forEach((entry, index) => {
    const child = visit(entry.value, depth + 1, `${path}.{property:${String(index)}}`);
    Object.defineProperty(snapshot, entry.key, { value: child.snapshot, enumerable: true, writable: true, configurable: true });
    encoded += `${index === 0 ? "" : ","}${JSON.stringify(entry.key)}:${child.encoded}`;
  });
  return { snapshot, encoded: `${encoded}}` };
}

function assertUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail("invalid_json", `${path} contains malformed Unicode`);
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail("invalid_json", `${path} contains malformed Unicode`);
    }
  }
}
