import {
  canonicalJson,
  encodeCanonicalRecord,
  snapshotJsonData,
} from "@agenttool/public-surface-binding";
import { isProxy } from "node:util/types";

import { LIMITS, MAX_UINT64 } from "./constants.js";
import { invalid, limit } from "./errors.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

/** Safely close a small exported wrapper while leaving nominated large arrays
 * shallow. Array structure and every index descriptor are copied without
 * invoking caller code; each element is subsequently snapshot/validated by
 * its own source-record verifier. */
export function snapshotInputWrapper(
  value: unknown,
  path: string,
  expectedKeys: readonly string[],
  shallowArrayKeys: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || isProxy(value)) {
    invalid(`${path} must be a non-proxy plain object.`, path);
  }
  let prototype: object | null;
  let ownKeys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    ownKeys = Reflect.ownKeys(value);
  } catch {
    return invalid(`${path} could not be safely inspected.`, path);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(`${path} must be a plain object.`, path);
  }
  const actual = ownKeys.map((key) => typeof key === "string"
    ? key
    : invalid(`${path} must not contain symbol fields.`, path)).sort();
  const wanted = [...expectedKeys].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid(`${path} must contain exactly ${wanted.join(", ")}.`, path);
  }
  const shallow = new Set(shallowArrayKeys);
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      return invalid(`${path}.${key} could not be safely inspected.`, `${path}.${key}`);
    }
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      invalid(`${path}.${key} must be an enumerable data property.`, `${path}.${key}`);
    }
    output[key] = shallow.has(key)
      ? snapshotInputArray(descriptor.value, `${path}.${key}`)
      : snapshotJsonData(descriptor.value);
  }
  return Object.freeze(output);
}

function snapshotInputArray(value: unknown, path: string): readonly unknown[] {
  if (value === null || typeof value !== "object" || isProxy(value)) {
    invalid(`${path} must be a non-proxy exact native array.`, path);
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  } catch {
    return invalid(`${path} could not be safely inspected.`, path);
  }
  if (!Array.isArray(value) || prototype !== Array.prototype) {
    invalid(`${path} must be an exact native array.`, path);
  }
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value as unknown
    : undefined;
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    invalid(`${path} must have an intrinsic array length.`, path);
  }
  if ((length as number) > LIMITS.max_array_items) {
    limit(`${path} exceeds ${LIMITS.max_array_items} elements.`, path);
  }
  if (
    keys.length !== (length as number) + 1
    || keys.some((key, index) => index < (length as number)
      ? key !== String(index)
      : key !== "length")
  ) {
    invalid(`${path} must be dense and have no extra fields.`, path);
  }
  const output: unknown[] = [];
  for (let index = 0; index < (length as number); index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      return invalid(`${path}[${index}] could not be safely inspected.`, `${path}[${index}]`);
    }
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      invalid(`${path}[${index}] must be an enumerable data property.`, `${path}[${index}]`);
    }
    output.push(descriptor.value);
  }
  return Object.freeze(output);
}

export function snapshotObject(value: unknown, path: string): JsonObject {
  let snap: JsonValue;
  try {
    snap = snapshotJsonData(value) as JsonValue;
  } catch (cause) {
    invalid(
      `${path} could not be copied as bounded canonical JSON${cause instanceof Error ? `: ${cause.message}` : "."}`,
      path,
    );
  }
  if (snap === null || Array.isArray(snap) || typeof snap !== "object") {
    invalid(`${path} must be an object.`, path);
  }
  return snap;
}

export function object(value: JsonValue, path: string): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    invalid(`${path} must be an object.`, path);
  }
  return value;
}

export function exactKeys(value: JsonObject, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid(`${path} must contain exactly ${wanted.join(", ")}.`, path);
  }
}

export function nonEmptyString(
  value: JsonValue,
  path: string,
  maxBytes: number = LIMITS.max_string_bytes,
): string {
  if (typeof value !== "string" || value.length === 0) {
    invalid(`${path} must be a non-empty string.`, path);
  }
  if (new TextEncoder().encode(value).byteLength > maxBytes) {
    limit(`${path} exceeds ${maxBytes} UTF-8 bytes.`, path);
  }
  return value;
}

export function exactString<T extends string>(value: JsonValue, expected: T, path: string): T {
  if (value !== expected) invalid(`${path} must be ${JSON.stringify(expected)}.`, path);
  return expected;
}

export function oneOf<T extends string>(value: JsonValue, choices: readonly T[], path: string): T {
  const candidate = nonEmptyString(value, path);
  if (!choices.includes(candidate as T)) invalid(`${path} has an unsupported value.`, path);
  return candidate as T;
}

export function boolean(value: JsonValue, path: string): boolean {
  if (typeof value !== "boolean") invalid(`${path} must be a boolean.`, path);
  return value;
}

export function nullable<T>(value: JsonValue, validator: (value: JsonValue) => T): T | null {
  return value === null ? null : validator(value);
}

export function hex(value: JsonValue, bytes: number, path: string): string {
  const candidate = nonEmptyString(value, path, bytes * 2);
  if (candidate.length !== bytes * 2 || !/^[0-9a-f]+$/u.test(candidate)) {
    invalid(`${path} must be exactly ${bytes * 2} lowercase hexadecimal characters.`, path);
  }
  return candidate;
}

export function sha256Id(value: JsonValue, path: string): `sha256:${string}` {
  const candidate = nonEmptyString(value, path, 71);
  if (!/^sha256:[0-9a-f]{64}$/u.test(candidate)) {
    invalid(`${path} must be a canonical sha256: identifier.`, path);
  }
  return candidate as `sha256:${string}`;
}

export function keyFingerprint(value: JsonValue, path: string): `ed25519-sha256:${string}` {
  const candidate = nonEmptyString(value, path, 79);
  if (!/^ed25519-sha256:[0-9a-f]{64}$/u.test(candidate)) {
    invalid(`${path} must be a canonical ed25519-sha256: fingerprint.`, path);
  }
  return candidate as `ed25519-sha256:${string}`;
}

export function opaqueRef(value: JsonValue, path: string): string {
  return hex(value, 32, path);
}

export function unsignedDecimal(
  value: JsonValue,
  path: string,
  options: { minimum?: bigint; maximum?: bigint } = {},
): string {
  const candidate = nonEmptyString(value, path, 20);
  if (!/^(0|[1-9][0-9]*)$/u.test(candidate)) {
    invalid(`${path} must be a canonical unsigned decimal string.`, path);
  }
  const integer = BigInt(candidate);
  const minimum = options.minimum ?? 0n;
  const maximum = options.maximum ?? MAX_UINT64;
  if (integer < minimum || integer > maximum) {
    invalid(`${path} must be between ${minimum} and ${maximum}.`, path);
  }
  return candidate;
}

export function canonicalInstant(value: JsonValue, path: string): string {
  const candidate = nonEmptyString(value, path, 32);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(candidate)) {
    invalid(`${path} must be a canonical UTC instant with millisecond precision.`, path);
  }
  const date = new Date(candidate);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== candidate) {
    invalid(`${path} must be a real canonical UTC instant.`, path);
  }
  return candidate;
}

export function nullableCanonicalInstant(value: JsonValue, path: string): string {
  if (value === "") return "";
  return canonicalInstant(value, path);
}

export function uuid(value: JsonValue, path: string): string {
  const candidate = nonEmptyString(value, path, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(candidate)) {
    invalid(`${path} must be a canonical lowercase UUID.`, path);
  }
  return candidate;
}

export function token(value: JsonValue, path: string): string {
  const candidate = nonEmptyString(value, path, 128);
  if (!/^[a-z0-9][a-z0-9._:/-]{0,127}$/u.test(candidate)) {
    invalid(`${path} must be a closed lowercase namespaced token.`, path);
  }
  return candidate;
}

export function witnessAudience(value: JsonValue, path: string): string {
  const candidate = nonEmptyString(value, path, 128);
  if (!/^[a-z][a-z0-9.-]{0,31}:[a-z0-9][a-z0-9._-]{0,95}$/u.test(candidate)) {
    invalid(`${path} must be an exact WITNESS audience token.`, path);
  }
  return candidate;
}

export function base64(value: JsonValue, expectedBytes: number, path: string): string {
  const candidate = nonEmptyString(value, path, 4 * Math.ceil(expectedBytes / 3));
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(candidate)) {
    invalid(`${path} must be canonical padded base64.`, path);
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(candidate, "base64"));
  } catch {
    return invalid(`${path} must be valid base64.`, path);
  }
  if (bytes.byteLength !== expectedBytes || Buffer.from(bytes).toString("base64") !== candidate) {
    invalid(`${path} must encode exactly ${expectedBytes} bytes as canonical padded base64.`, path);
  }
  return candidate;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as Readonly<T>;
}

export function validated<T>(value: JsonObject): Readonly<T> {
  encodeCanonicalRecord(value);
  return deepFreeze(value) as unknown as Readonly<T>;
}

export { canonicalJson, encodeCanonicalRecord };
