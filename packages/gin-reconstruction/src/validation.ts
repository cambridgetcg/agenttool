import { MAX_REFERENCE_LIST, MAX_TEXT_CODE_POINTS } from "./constants.js";
import { fail } from "./errors.js";
import type { Sha256Id } from "./types.js";

export type UnknownRecord = Record<string, unknown>;

export function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid_input", `${path} must be an object`);
  }
  return value as UnknownRecord;
}

export function exactKeys(value: UnknownRecord, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail("invalid_input", `${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

export function integer(value: unknown, minimum: number, maximum: number, path: string): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < minimum || value > maximum) {
    fail("invalid_input", `${path} must be an integer from ${String(minimum)} through ${String(maximum)}`);
  }
  return value;
}

export function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail("invalid_input", `${path} must be boolean`);
  return value;
}

export function enumValue<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail("invalid_input", `${path} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function arrayValue(value: unknown, maximum: number, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    fail("invalid_input", `${path} must be an Array of at most ${String(maximum)} items`);
  }
  return value;
}

export function token(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    fail("invalid_input", `${path} must be a bounded opaque ASCII token`);
  }
  return value;
}

export function boundedText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || Array.from(value).length > MAX_TEXT_CODE_POINTS) {
    fail("invalid_input", `${path} must be visible text of at most ${String(MAX_TEXT_CODE_POINTS)} code points`);
  }
  if (/\p{Cc}|\p{Cs}|[\u2028\u2029]/u.test(value)) {
    fail("invalid_input", `${path} contains disallowed control or malformed characters`);
  }
  return value;
}

export function digest(value: unknown, path: string): Sha256Id {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail("invalid_input", `${path} must be a lowercase sha256 identifier`);
  }
  return value as Sha256Id;
}

export function nullableDigest(value: unknown, path: string): Sha256Id | null {
  return value === null ? null : digest(value, path);
}

export function digestList(value: unknown, path: string): Sha256Id[] {
  const result = arrayValue(value, MAX_REFERENCE_LIST, path).map((entry, index) => digest(entry, `${path}[${String(index)}]`));
  if (new Set(result).size !== result.length) fail("invalid_input", `${path} must not contain duplicate references`);
  return result.sort();
}

export function uniqueEnumList<T extends string>(value: unknown, allowed: readonly T[], maximum: number, path: string): T[] {
  const result = arrayValue(value, maximum, path).map((entry, index) => enumValue(entry, allowed, `${path}[${String(index)}]`));
  if (new Set(result).size !== result.length) fail("invalid_input", `${path} must not contain duplicates`);
  return result;
}
