import { createHash } from "node:crypto";
import { isProxy, isUint8Array } from "node:util/types";

import { fail } from "./errors.js";

const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 524_288;
const MAX_OWN_KEYS = 4_096;
const MAX_STRING_UTF8_BYTES = 4 * 1024;
const MAX_JSON_UTF8_BYTES = 32 * 1024 * 1024;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

interface InspectedJson {
  readonly snapshot: JsonValue;
  readonly encoded: string;
  readonly originals: readonly object[];
}

interface InspectedValue {
  readonly snapshot: JsonValue;
  readonly encoded: string;
}

interface ObjectEntry {
  readonly key: string;
  readonly value: unknown;
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
  if (isProxy(value)) {
    fail("invalid_json", "hash bytes must not be a Proxy value");
  }
  if (!isUint8Array(value)) {
    fail("invalid_json", "hash bytes must be a genuine Uint8Array");
  }
  let detached: Uint8Array;
  try {
    detached = new Uint8Array(value);
  } catch {
    fail("invalid_json", "hash bytes could not be copied");
  }
  return `sha256:${createHash("sha256").update(detached).digest("hex")}`;
}

export function domainSeparatedId(
  domain: string,
  value: unknown,
): `sha256:${string}` {
  const candidate: unknown = domain;
  if (typeof candidate !== "string" || !/^[\x21-\x7e]{1,128}$/u.test(candidate)) {
    if (typeof candidate === "object" && candidate !== null && isProxy(candidate)) {
      fail("invalid_json", "hash domain must not be a Proxy value");
    }
    fail("invalid_json", "hash domain must be a bounded ASCII protocol token");
  }
  return sha256Id(`${candidate}\u0000${canonicalJson(value)}`);
}

export function compareUnicode(left: string, right: string): number {
  const candidates: readonly unknown[] = [left, right];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      if (
        (typeof candidate === "object" && candidate !== null) ||
        typeof candidate === "function"
      ) {
        if (isProxy(candidate)) {
          fail("invalid_json", "Unicode comparison inputs must not be Proxy values");
        }
      }
      fail("invalid_json", "Unicode comparison inputs must be strings");
    }
    assertUnicode(candidate, "$comparison");
  }
  const a = Array.from(left, (character) => character.codePointAt(0)!);
  const b = Array.from(right, (character) => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value === "function" && isProxy(value)) {
    fail("invalid_json", "$ must not be a Proxy value");
  }
  if (value === null || typeof value !== "object") {
    return value as Readonly<T>;
  }
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

function inspectJson(root: unknown, captureOriginals = false): InspectedJson {
  let nodes = 0;
  let inputUtf8Bytes = 0;
  const seen = new Set<object>();
  const originals: object[] = [];

  function accountUtf8(value: string, path: string): void {
    if (value.length > MAX_STRING_UTF8_BYTES) {
      fail(
        "invalid_json",
        `${path} exceeds ${String(MAX_STRING_UTF8_BYTES)} UTF-8 bytes`,
      );
    }
    assertUnicode(value, path);
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes > MAX_STRING_UTF8_BYTES) {
      fail(
        "invalid_json",
        `${path} exceeds ${String(MAX_STRING_UTF8_BYTES)} UTF-8 bytes`,
      );
    }
    inputUtf8Bytes += bytes;
    if (inputUtf8Bytes > MAX_JSON_UTF8_BYTES) {
      fail(
        "invalid_json",
        `canonical JSON input exceeds ${String(MAX_JSON_UTF8_BYTES)} UTF-8 bytes`,
      );
    }
  }

  function visit(value: unknown, depth: number, path: string): InspectedValue {
    nodes += 1;
    if (nodes > MAX_JSON_NODES) {
      fail("invalid_json", "canonical JSON has too many values");
    }
    if (depth > MAX_JSON_DEPTH) {
      fail("invalid_json", "canonical JSON is too deeply nested");
    }
    if (value === null) return { snapshot: null, encoded: "null" };
    if (typeof value === "boolean") {
      return { snapshot: value, encoded: value ? "true" : "false" };
    }
    if (typeof value === "string") {
      accountUtf8(value, path);
      return { snapshot: value, encoded: JSON.stringify(value) };
    }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
        fail("invalid_json", "canonical JSON accepts safe integers only");
      }
      return { snapshot: value, encoded: String(value) };
    }
    if (typeof value === "function" && isProxy(value)) {
      fail("invalid_json", `${path} must not be a Proxy value`);
    }
    if (typeof value !== "object") {
      fail("invalid_json", `${path} is not canonical JSON`);
    }
    if (isProxy(value)) {
      fail("invalid_json", `${path} must not be a Proxy value`);
    }
    if (seen.has(value)) {
      fail("invalid_json", "canonical JSON rejects cycles");
    }

    let isArray: boolean;
    let prototype: object | null;
    try {
      isArray = Array.isArray(value);
      prototype = Object.getPrototypeOf(value);
    } catch {
      fail("invalid_json", `${path} could not be inspected as canonical JSON`);
    }
    if (isArray) {
      if (prototype !== Array.prototype) {
        fail("invalid_json", `${path} must be a standard Array`);
      }
    } else if (prototype !== Object.prototype && prototype !== null) {
      fail("invalid_json", `${path} must be a plain or null-prototype object`);
    }

    if (captureOriginals) originals.push(value);
    seen.add(value);
    try {
      return isArray
        ? inspectArray(value, depth, path, visit)
        : inspectObject(value, depth, path, visit, accountUtf8);
    } finally {
      seen.delete(value);
    }
  }

  const inspected = visit(root, 0, "$");
  if (Buffer.byteLength(inspected.encoded, "utf8") > MAX_JSON_UTF8_BYTES) {
    fail(
      "invalid_json",
      `canonical JSON exceeds ${String(MAX_JSON_UTF8_BYTES)} UTF-8 bytes`,
    );
  }
  return { ...inspected, originals };
}

function inspectArray(
  value: object,
  depth: number,
  path: string,
  visit: (value: unknown, depth: number, path: string) => InspectedValue,
): InspectedValue {
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  } catch {
    fail("invalid_json", `${path} could not be inspected as a standard Array`);
  }
  if (
    !lengthDescriptor ||
    lengthDescriptor.enumerable ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > MAX_JSON_NODES
  ) {
    fail(
      "invalid_json",
      `${path} must be a dense Array with only own enumerable index data properties`,
    );
  }
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    fail("invalid_json", `${path} could not be inspected as a standard Array`);
  }
  if (keys.length !== lengthDescriptor.value + 1) {
    fail(
      "invalid_json",
      `${path} must be a dense Array with only own enumerable index data properties`,
    );
  }
  if (keys.some((key) => typeof key === "symbol")) {
    fail("invalid_json", `${path} has a symbol property`);
  }

  const snapshot: JsonValue[] = [];
  const encoded: string[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      fail("invalid_json", `${path} could not inspect an Array element`);
    }
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      fail(
        "invalid_json",
        `${path}[${String(index)}] must be an own enumerable data property`,
      );
    }
    const inspected = visit(
      descriptor.value,
      depth + 1,
      `${path}[${String(index)}]`,
    );
    Object.defineProperty(snapshot, String(index), {
      value: inspected.snapshot,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    encoded.push(inspected.encoded);
  }
  return { snapshot, encoded: `[${encoded.join(",")}]` };
}

function inspectObject(
  value: object,
  depth: number,
  path: string,
  visit: (value: unknown, depth: number, path: string) => InspectedValue,
  accountUtf8: (value: string, path: string) => void,
): InspectedValue {
  let ownKeys: readonly PropertyKey[];
  try {
    ownKeys = Reflect.ownKeys(value);
  } catch {
    fail("invalid_json", `${path} could not be inspected as a plain object`);
  }
  if (ownKeys.length > MAX_OWN_KEYS) {
    fail("invalid_json", `${path} has too many own properties`);
  }

  const entries: ObjectEntry[] = [];
  for (const key of ownKeys) {
    if (typeof key !== "string") {
      fail("invalid_json", `${path} has a symbol property`);
    }
    accountUtf8(key, `${path} property name`);
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      fail("invalid_json", `${path} could not inspect an own property`);
    }
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      fail(
        "invalid_json",
        `${path} has a property that is not an own enumerable data property`,
      );
    }
    entries.push({ key, value: descriptor.value });
  }
  entries.sort((left, right) => compareUnicode(left.key, right.key));

  const snapshot: Record<string, JsonValue> = {};
  const encoded: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const inspected = visit(
      entry.value,
      depth + 1,
      `${path}.{property:${String(index)}}`,
    );
    Object.defineProperty(snapshot, entry.key, {
      value: inspected.snapshot,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    encoded.push(`${JSON.stringify(entry.key)}:${inspected.encoded}`);
  }
  return { snapshot, encoded: `{${encoded.join(",")}}` };
}

function assertUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail("invalid_json", `${path} contains malformed Unicode`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail("invalid_json", `${path} contains malformed Unicode`);
    }
  }
}
