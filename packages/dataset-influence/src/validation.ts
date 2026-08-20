import { compareUnicode } from "./canonical.js";
import { MAX_REFS } from "./constants.js";
import { fail } from "./errors.js";
import type { JsonValue } from "./canonical.js";
import type { Sha256Id } from "./types.js";

export type JsonRecord = Record<string, JsonValue>;

export function record(value: JsonValue | undefined, path: string): JsonRecord {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    fail("invalid_input", `${path} must be an object`);
  }
  return value;
}

export function exactKeys(value: JsonRecord, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort(compareUnicode);
  const wanted = [...expected].sort(compareUnicode);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail("invalid_input", `${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

export function arrayValue(value: JsonValue | undefined, maximum: number, path: string): JsonValue[] {
  if (!Array.isArray(value)) fail("invalid_input", `${path} must be an array`);
  if (value.length > maximum) fail("invalid_input", `${path} exceeds ${maximum} entries`);
  return value;
}

export function enumValue<T extends string>(value: JsonValue | undefined, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail("invalid_input", `${path} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function sha256(value: JsonValue | undefined, path: string): Sha256Id {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail("invalid_input", `${path} must be a lowercase sha256 identifier`);
  }
  return value as Sha256Id;
}

export function nullableSha256(value: JsonValue | undefined, path: string): Sha256Id | null {
  return value === null ? null : sha256(value, path);
}

export function sha256Set(value: JsonValue | undefined, path: string, maximum = MAX_REFS): readonly Sha256Id[] {
  const refs = arrayValue(value, maximum, path).map((entry, index) => sha256(entry, `${path}[${index}]`));
  const sorted = [...refs].sort(compareUnicode);
  if (new Set(sorted).size !== sorted.length) fail("invalid_input", `${path} must not contain duplicates`);
  return sorted;
}

export function nonNegativeInteger(value: JsonValue | undefined, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("invalid_input", `${path} must be a non-negative safe integer`);
  }
  return value;
}

export function positiveInteger(value: JsonValue | undefined, path: string): number {
  const parsed = nonNegativeInteger(value, path);
  if (parsed === 0) fail("invalid_input", `${path} must be positive`);
  return parsed;
}

export function nullableNonNegativeInteger(value: JsonValue | undefined, path: string): number | null {
  return value === null ? null : nonNegativeInteger(value, path);
}

export function isoDate(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    fail("invalid_input", `${path} must be an ISO calendar date`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const leap = year! % 4 === 0 && (year! % 100 !== 0 || year! % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month! < 1 || month! > 12 || day! < 1 || day! > (days[month! - 1] ?? 0)) {
    fail("invalid_input", `${path} must be a real ISO calendar date`);
  }
  return value;
}

export function assertUniqueBy<T>(values: readonly T[], key: (value: T) => string, path: string): void {
  const keys = values.map(key);
  if (new Set(keys).size !== keys.length) fail("invalid_input", `${path} must not contain duplicate keys`);
}
