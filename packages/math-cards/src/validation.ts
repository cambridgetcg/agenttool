import { MAX_REFERENCE_LIST, MAX_TOTAL_REFERENCES } from "./constants.js";
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
  const result = arrayValue(value, MAX_REFERENCE_LIST, path)
    .map((entry, index) => digest(entry, `${path}[${String(index)}]`));
  if (new Set(result).size !== result.length) fail("invalid_input", `${path} must not contain duplicate references`);
  return result.sort();
}

export function uniqueEnumList<T extends string>(
  value: unknown,
  allowed: readonly T[],
  maximum: number,
  path: string,
): T[] {
  const result = arrayValue(value, maximum, path)
    .map((entry, index) => enumValue(entry, allowed, `${path}[${String(index)}]`));
  if (new Set(result).size !== result.length) fail("invalid_input", `${path} must not contain duplicates`);
  return result;
}

export function assertReferenceBudget(value: unknown): void {
  let count = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string" && /^sha256:[0-9a-f]{64}$/u.test(current)) {
      count += 1;
      if (count > MAX_TOTAL_REFERENCES) {
        fail("invalid_input", `Math Card contains more than ${String(MAX_TOTAL_REFERENCES)} digest references`);
      }
    } else if (Array.isArray(current)) {
      stack.push(...current);
    } else if (typeof current === "object" && current !== null) {
      stack.push(...Object.values(current));
    }
  }
}
