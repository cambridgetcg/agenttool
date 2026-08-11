import { compareUnicode, snapshotJson, type JsonValue } from "./canonical.js";
import { fail, type PolymorphLandscapeErrorCode } from "./errors.js";
import type { Sha256Id } from "./types.js";

const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const TOKEN = /^[a-z][a-z0-9._-]{0,127}$/u;

export function record(value: unknown, path: string, code: PolymorphLandscapeErrorCode): Record<string, JsonValue> {
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
  code: PolymorphLandscapeErrorCode,
): void {
  const actual = Object.keys(value).sort(compareUnicode);
  const wanted = [...expected].sort(compareUnicode);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, `${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

export function array(value: JsonValue | undefined, path: string, maximum = 512): readonly JsonValue[] {
  if (!Array.isArray(value) || value.length > maximum) fail("invalid_input", `${path} must be an array of at most ${String(maximum)} items`);
  return value;
}

export function text(value: JsonValue | undefined, path: string, maximum = 4096): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maximum) {
    fail("invalid_input", `${path} must be non-empty text of at most ${String(maximum)} UTF-8 bytes`);
  }
  return value;
}

export function token(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string" || !TOKEN.test(value)) fail("invalid_input", `${path} must be a bounded lowercase protocol key`);
  return value;
}

export function literal<T extends string>(
  value: JsonValue | undefined,
  allowed: readonly T[],
  path: string,
  code: PolymorphLandscapeErrorCode = "invalid_input",
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(code, `${path} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function integer(value: JsonValue | undefined, path: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("invalid_input", `${path} must be an integer from ${String(minimum)} through ${String(maximum)}`);
  }
  return value;
}

export function bool(value: JsonValue | undefined, expected: boolean, path: string, code: PolymorphLandscapeErrorCode): boolean {
  if (value !== expected) fail(code, `${path} must be ${String(expected)}`);
  return expected;
}

export function sha256(value: JsonValue | undefined, path: string, code: PolymorphLandscapeErrorCode): Sha256Id {
  if (typeof value !== "string" || !SHA256_ID.test(value)) fail(code, `${path} must be a lowercase sha256: content ID`);
  return value as Sha256Id;
}

export function httpsUrl(value: JsonValue | undefined, path: string): string {
  const candidate = text(value, path, 2048);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    fail("invalid_input", `${path} must be a valid URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    fail("invalid_input", `${path} must be an HTTPS URL without credentials`);
  }
  return candidate;
}

export function uniqueTokens(value: JsonValue | undefined, path: string, allowEmpty = true): readonly string[] {
  const values = array(value, path).map((entry, index) => token(entry, `${path}[${String(index)}]`));
  if (!allowEmpty && values.length === 0) fail("invalid_input", `${path} must not be empty`);
  if (new Set(values).size !== values.length) fail("duplicate_key", `${path} must not contain duplicates`);
  return values;
}

export function uniqueRefs(
  value: JsonValue | undefined,
  path: string,
  code: PolymorphLandscapeErrorCode,
  allowEmpty = true,
): readonly Sha256Id[] {
  const values = array(value, path).map((entry, index) => sha256(entry, `${path}[${String(index)}]`, code));
  if (!allowEmpty && values.length === 0) fail(code, `${path} must not be empty`);
  if (new Set(values).size !== values.length) fail(code, `${path} must not contain duplicates`);
  return values;
}

export function assertUniqueKeys(values: readonly { readonly key: string }[], path: string): void {
  const keys = values.map((value) => value.key);
  if (new Set(keys).size !== keys.length) fail("duplicate_key", `${path} must not contain duplicate keys`);
}

export function sorted<T extends { readonly key: string }>(values: readonly T[]): readonly T[] {
  return [...values].sort((left, right) => compareUnicode(left.key, right.key));
}

export function sortedRefs(values: readonly Sha256Id[]): readonly Sha256Id[] {
  return [...values].sort(compareUnicode);
}

export function assertCanonicalOrder(values: readonly string[], path: string, code: PolymorphLandscapeErrorCode): void {
  const expected = [...values].sort(compareUnicode);
  if (values.some((value, index) => value !== expected[index])) fail(code, `${path} must use canonical Unicode order`);
}
