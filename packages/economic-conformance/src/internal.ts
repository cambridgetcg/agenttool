import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

import type { JsonValue } from "./types.js";

const MAX_DEPTH = 20;
const MAX_NODES = 16_384;
const MAX_BYTES = 1_048_576;
const MAX_ARRAY = 1_024;
const MAX_OBJECT_KEYS = 1_024;

export type ConformanceFormatErrorCode =
  | "DUPLICATE_JSON_KEY"
  | "INVALID_JSON"
  | "INVALID_SHAPE"
  | "INVALID_UTF8"
  | "LIMIT_EXCEEDED"
  | "UNPINNED_SUITE"
  | "UNSUPPORTED_SCHEMA"
  | "VECTOR_INTEGRITY_MISMATCH";

export class ConformanceFormatError extends Error {
  readonly code: ConformanceFormatErrorCode;
  readonly path: string;

  constructor(code: ConformanceFormatErrorCode, message: string, path: string) {
    super(message);
    this.name = "ConformanceFormatError";
    this.code = code;
    this.path = path;
  }
}

export function fail(
  message: string,
  path: string,
  code: ConformanceFormatErrorCode = "INVALID_SHAPE",
): never {
  throw new ConformanceFormatError(code, message, path);
}

interface State {
  nodes: number;
  bytes: number;
  ancestors: Set<object>;
}

function text(value: unknown, path: string, maxBytes = 1_024): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maxBytes) {
    fail(`${path} must be a non-empty bounded string.`, path);
  }
  assertWellFormedUnicode(value, path);
  return value;
}

function assertWellFormedUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0) fail(`${path} contains forbidden U+0000.`, path);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        fail(`${path} contains a lone UTF-16 surrogate.`, path);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail(`${path} contains a lone UTF-16 surrogate.`, path);
    }
  }
}

function snapshotValue(value: unknown, path: string, depth: number, state: State): JsonValue {
  state.nodes += 1;
  if (state.nodes > MAX_NODES) fail("Input has too many JSON values.", path, "LIMIT_EXCEEDED");
  if (depth > MAX_DEPTH) fail("Input is too deeply nested.", path, "LIMIT_EXCEEDED");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    assertWellFormedUnicode(value, path);
    state.bytes += Buffer.byteLength(value, "utf8");
    if (state.bytes > MAX_BYTES) fail("Input exceeds the byte bound.", path, "LIMIT_EXCEEDED");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      fail("JSON numbers must be safe integers other than negative zero.", path);
    }
    return value;
  }
  if ((typeof value === "object" || typeof value === "function") && value !== null && isProxy(value)) {
    fail("Proxy inputs are not accepted.", path);
  }
  if (typeof value !== "object" || value === null) fail("Input must be inert JSON data.", path);
  if (state.ancestors.has(value)) fail("Cyclic inputs are not accepted.", path);

  const isArray = Array.isArray(value);
  if (isArray && (value as unknown[]).length > MAX_ARRAY) {
    fail("Array must be dense and bounded.", path, "LIMIT_EXCEEDED");
  }
  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail("Input could not be inspected.", path);
  }
  if (keys.length > (isArray ? MAX_ARRAY + 1 : MAX_OBJECT_KEYS)) {
    fail("Container has too many own properties.", path, "LIMIT_EXCEEDED");
  }
  if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    fail("Only plain objects and standard arrays are accepted.", path);
  }
  if (keys.some((key) => typeof key === "symbol")) fail("Symbol properties are not accepted.", path);

  state.ancestors.add(value);
  try {
    if (isArray) {
      const items = value as unknown[];
      const expectedKeys = [...Array.from({ length: items.length }, (_, index) => String(index)), "length"];
      if (
        keys.length !== expectedKeys.length
        || keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
      ) {
        fail("Array must be dense and bounded.", path);
      }
      const result: JsonValue[] = [];
      for (let index = 0; index < items.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(items, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          fail("Array entries must be enumerable data properties.", `${path}[${String(index)}]`);
        }
        result.push(snapshotValue(descriptor.value, `${path}[${String(index)}]`, depth + 1, state));
      }
      return result;
    }
    const result = Object.create(null) as Record<string, JsonValue>;
    for (const key of keys as readonly string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        fail("Object entries must be enumerable data properties.", `${path}.{value}`);
      }
      assertWellFormedUnicode(key, `${path}.{key}`);
      state.bytes += Buffer.byteLength(key, "utf8");
      if (state.bytes > MAX_BYTES) fail("Input exceeds the byte bound.", `${path}.{key}`, "LIMIT_EXCEEDED");
      result[key] = snapshotValue(descriptor.value, `${path}.{value}`, depth + 1, state);
    }
    return result;
  } finally {
    state.ancestors.delete(value);
  }
}

export function snapshotJson(value: unknown): JsonValue {
  const snapshot = snapshotValue(value, "$", 0, { nodes: 0, bytes: 0, ancestors: new Set<object>() });
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > MAX_BYTES) {
    fail("Input exceeds the byte bound.", "$", "LIMIT_EXCEEDED");
  }
  return snapshot;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  const snapshot = snapshotJson(value) as T;
  const stack: unknown[] = [snapshot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current !== null && typeof current === "object" && !Object.isFrozen(current)) {
      stack.push(...(Array.isArray(current) ? current : Object.values(current)));
      Object.freeze(current);
    }
  }
  return snapshot as Readonly<T>;
}

export function object(value: unknown, path: string): Record<string, unknown> {
  const snapshot = snapshotJson(value);
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    fail(`${path} must be an object.`, path);
  }
  return snapshot as Record<string, unknown>;
}

export function exactKeys(item: Record<string, unknown>, expected: readonly string[], path: string): void {
  const actual = Object.keys(item).sort(compareUtf8);
  const sorted = [...expected].sort(compareUtf8);
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    fail(`${path} must contain exactly: ${sorted.join(", ")}.`, path);
  }
}

export function identifier(value: unknown, path: string): string {
  const result = text(value, path, 192);
  if (!/^[a-z0-9](?:[a-z0-9._:/-]*[a-z0-9])?$/u.test(result) || !result.includes(":")) {
    fail(`${path} must be a lowercase namespaced identifier.`, path);
  }
  return result;
}

export function label(value: unknown, path: string): string {
  return text(value, path, 4_096);
}

export function token(value: unknown, path: string): string {
  const result = text(value, path, 192);
  if (!/^[A-Z][A-Z0-9_]*$/u.test(result)) fail(`${path} must be an uppercase token.`, path);
  return result;
}

export function unsigned(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    fail(`${path} must be a canonical unsigned decimal string.`, path);
  }
  return value;
}

export function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function serializeCanonical(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeCanonical(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort(compareUtf8).map((key) =>
      `${JSON.stringify(key)}:${serializeCanonical(value[key] as JsonValue)}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail("Canonical JSON contains an unsupported value.", "$");
  return encoded;
}

export function canonicalJson(value: unknown): string {
  return serializeCanonical(snapshotJson(value));
}

export function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function semanticSha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}
