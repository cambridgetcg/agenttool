import { snapshotJson, type JsonValue } from "./canonical.js";
import { fail, type LoveBombErrorCode } from "./errors.js";
import type { Sha256Id } from "./types.js";

const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;

export function closedRecord(
  value: unknown,
  path: string,
  code: LoveBombErrorCode,
): Record<string, JsonValue> {
  const snapshot = snapshotJson(value);
  if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== "object") {
    fail(code, `${path} must be a plain object`);
  }
  return snapshot;
}

export function exactKeys(
  value: Record<string, JsonValue>,
  expected: readonly string[],
  path: string,
  code: LoveBombErrorCode,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, `${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

export function sha256(
  value: JsonValue | undefined,
  path: string,
  code: LoveBombErrorCode,
): Sha256Id {
  if (typeof value !== "string" || !SHA256_ID.test(value)) {
    fail(code, `${path} must be a lowercase sha256: content reference`);
  }
  return value as Sha256Id;
}

export function nullableSha256(
  value: JsonValue | undefined,
  path: string,
  code: LoveBombErrorCode,
): Sha256Id | null {
  return value === null ? null : sha256(value, path, code);
}

export function literal<const T extends readonly string[]>(
  value: JsonValue | undefined,
  allowed: T,
  path: string,
  code: LoveBombErrorCode,
): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(code, `${path} is not a supported value`);
  }
  return value as T[number];
}

export function nullableLiteral<const T extends readonly string[]>(
  value: JsonValue | undefined,
  allowed: T,
  path: string,
  code: LoveBombErrorCode,
): T[number] | null {
  return value === null ? null : literal(value, allowed, path, code);
}

export function booleanValue(
  value: JsonValue | undefined,
  path: string,
  code: LoveBombErrorCode,
): boolean {
  if (typeof value !== "boolean") fail(code, `${path} must be a boolean`);
  return value;
}
