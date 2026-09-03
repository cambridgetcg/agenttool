import { isProxy } from "node:util/types";

import { LIMITS, UINT256_MAX, UINT64_MAX } from "./constants.js";
import { fail, type EconomicKernelErrorCode } from "./errors.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type UnknownRecord = Record<string, unknown>;

interface SnapshotState {
  nodes: number;
  bytes: number;
  ancestors: Set<object>;
}

function accountBytes(value: string, state: SnapshotState, path: string): void {
  if (value.includes("\u0000")) fail("INVALID_RECORD", `${path} contains forbidden U+0000.`, path);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail("INVALID_RECORD", `${path} contains malformed Unicode.`, path);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail("INVALID_RECORD", `${path} contains malformed Unicode.`, path);
    }
  }
  state.bytes += Buffer.byteLength(value, "utf8");
  if (state.bytes > LIMITS.maxSnapshotBytes) {
    fail("LIMIT_EXCEEDED", "Input exceeds the snapshot byte bound.", path);
  }
}

function snapshotValue(value: unknown, path: string, depth: number, state: SnapshotState): JsonValue {
  state.nodes += 1;
  if (state.nodes > LIMITS.maxObjectNodes) fail("LIMIT_EXCEEDED", "Input has too many values.", path);
  if (depth > LIMITS.maxObjectDepth) fail("LIMIT_EXCEEDED", "Input is too deeply nested.", path);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    accountBytes(value, state, path);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      fail("INVALID_RECORD", `${path} must be a safe integer other than negative zero.`, path);
    }
    return value;
  }
  if ((typeof value === "object" || typeof value === "function") && value !== null && isProxy(value)) {
    fail("INVALID_RECORD", `${path} must not be a Proxy.`, path);
  }
  if (typeof value !== "object" || value === null) {
    fail("INVALID_RECORD", `${path} is not JSON data.`, path);
  }
  if (state.ancestors.has(value)) fail("INVALID_RECORD", "Input contains a cycle.", path);

  let prototype: object | null;
  let keys: readonly PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    fail("INVALID_RECORD", `${path} could not be inspected.`, path);
  }
  const array = Array.isArray(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    fail("INVALID_RECORD", `${path} must be a plain object or standard array.`, path);
  }
  if (keys.some((key) => typeof key === "symbol")) {
    fail("INVALID_RECORD", `${path} contains a symbol property.`, path);
  }
  if (!array && keys.length > LIMITS.maxArrayItems) {
    fail("LIMIT_EXCEEDED", `${path} has too many properties.`, path);
  }

  state.ancestors.add(value);
  try {
    if (array) {
      const items = value as unknown[];
      if (items.length > LIMITS.maxArrayItems) {
        fail("LIMIT_EXCEEDED", `${path} must be a dense bounded array.`, path);
      }
      const expectedKeys = [...Array.from({ length: items.length }, (_, index) => String(index)), "length"];
      if (
        keys.length !== expectedKeys.length
        || keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
      ) {
        fail("LIMIT_EXCEEDED", `${path} must be a dense bounded array.`, path);
      }
      const result: JsonValue[] = [];
      for (let index = 0; index < items.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(items, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          fail("INVALID_RECORD", `${path}[${String(index)}] must be an enumerable data property.`, path);
        }
        result.push(snapshotValue(descriptor.value, `${path}[${String(index)}]`, depth + 1, state));
      }
      return result;
    }
    const result = Object.create(null) as Record<string, JsonValue>;
    for (const key of keys as readonly string[]) {
      accountBytes(key, state, `${path} property name`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        fail("INVALID_RECORD", `${path} contains a property that is not an enumerable data property.`, `${path}.*`);
      }
      result[key] = snapshotValue(descriptor.value, `${path}.*`, depth + 1, state);
    }
    return result;
  } finally {
    state.ancestors.delete(value);
  }
}

export function snapshotJson<T>(value: T): T {
  const state: SnapshotState = { nodes: 0, bytes: 0, ancestors: new Set<object>() };
  const snapshot = snapshotValue(value, "$", 0, state);
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > LIMITS.maxSnapshotBytes) {
    fail("LIMIT_EXCEEDED", "Input exceeds the serialized byte bound.", "$");
  }
  return snapshot as T;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  const snapshot = snapshotJson(value);
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

export function record(value: unknown, label: string): UnknownRecord {
  const item = snapshotJson(value);
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    fail("INVALID_RECORD", `${label} must be a plain object.`, label);
  }
  return item as UnknownRecord;
}

export function exactKeys(item: UnknownRecord, keys: readonly string[], label: string): void {
  const actual = Object.keys(item).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    const unknown = actual.filter((key) => !expected.includes(key));
    const code: EconomicKernelErrorCode = unknown.length > 0 ? "UNKNOWN_FIELD" : "INVALID_RECORD";
    fail(code, `${label} must contain exactly: ${expected.join(", ")}.`, label);
  }
}

export function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): asserts value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail("INVALID_RECORD", `${label} must be one of: ${allowed.join(", ")}.`, label);
  }
}

export function boundedString(value: unknown, label: string, maxBytes: number = LIMITS.maxReferenceBytes): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maxBytes) {
    fail("INVALID_IDENTIFIER", `${label} must be a non-empty bounded string.`, label);
  }
  if (/[^\x20-\x7e]/u.test(value)) {
    fail("INVALID_IDENTIFIER", `${label} must contain printable ASCII only.`, label);
  }
  return value;
}

export function identifier(value: unknown, label: string): string {
  const id = boundedString(value, label, LIMITS.maxIdBytes);
  if (!/^[a-z0-9](?:[a-z0-9._:/-]*[a-z0-9])?$/u.test(id) || !id.includes(":")) {
    fail("INVALID_IDENTIFIER", `${label} must be a lowercase namespaced identifier.`, label);
  }
  return id;
}

export function sha256Identifier(value: unknown, label: string): string {
  const id = identifier(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(id)) {
    fail("INVALID_IDENTIFIER", `${label} must be a lowercase SHA-256 identifier.`, label);
  }
  return id;
}

export function reference(value: unknown, label: string): string {
  return boundedString(value, label);
}

export function safeInteger(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    fail("INVALID_RECORD", `${label} must be an integer from ${String(min)} through ${String(max)}.`, label);
  }
  return value as number;
}

export function unsignedDecimal(
  value: unknown,
  label: string,
  max: bigint = UINT256_MAX,
): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    fail("INVALID_AMOUNT", `${label} must be a canonical unsigned decimal string.`, label);
  }
  if (value.length > LIMITS.maxDecimalDigits || BigInt(value) > max) {
    fail("AMOUNT_OVERFLOW", `${label} exceeds its integer bound.`, label);
  }
  return value;
}

export function positiveDecimal(value: unknown, label: string, max: bigint = UINT256_MAX): string {
  const amount = unsignedDecimal(value, label, max);
  if (amount === "0") fail("INVALID_AMOUNT", `${label} must be positive.`, label);
  return amount;
}

export function uint64Decimal(value: unknown, label: string): string {
  return unsignedDecimal(value, label, UINT64_MAX);
}

export function signedDecimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(0|-?[1-9][0-9]*)$/u.test(value)) {
    fail("INVALID_AMOUNT", `${label} must be a canonical signed decimal string.`, label);
  }
  const magnitude = value.startsWith("-") ? value.slice(1) : value;
  if (magnitude.length > LIMITS.maxDecimalDigits || BigInt(magnitude) > UINT256_MAX) {
    fail("AMOUNT_OVERFLOW", `${label} exceeds the signed magnitude bound.`, label);
  }
  return value;
}

export function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    fail("INVALID_TIMESTAMP", `${label} must be canonical UTC RFC3339 with milliseconds.`, label);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail("INVALID_TIMESTAMP", `${label} is not a real canonical timestamp.`, label);
  }
  return value;
}

export function sortedUniqueReferences(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > LIMITS.maxEvidenceRefs) {
    fail("LIMIT_EXCEEDED", `${label} must be an array with at most ${String(LIMITS.maxEvidenceRefs)} items.`, label);
  }
  const refs = value.map((item, index) => reference(item, `${label}[${String(index)}]`));
  for (let index = 1; index < refs.length; index += 1) {
    if (refs[index - 1]! >= refs[index]!) {
      fail("INVALID_RECORD", `${label} must be sorted and unique.`, label);
    }
  }
  return refs;
}

/** Locale-independent UTF-16 code-unit order, matching JavaScript string relational comparison. */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sameJson(left: unknown, right: unknown): boolean {
  const canonicalize = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item));
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([leftKey], [rightKey]) => compareText(leftKey, rightKey))
          .map(([key, item]) => [key, canonicalize(item)]),
      );
    }
    return value;
  };
  const leftSnapshot = snapshotJson(left) as JsonValue;
  const rightSnapshot = snapshotJson(right) as JsonValue;
  return JSON.stringify(canonicalize(leftSnapshot)) === JSON.stringify(canonicalize(rightSnapshot));
}
