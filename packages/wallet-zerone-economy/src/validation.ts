import { snapshotJsonData } from "@agenttool/wallet";

import { ECONOMY_LIMITS } from "./constants.js";
import { fail } from "./errors.js";

export function closedRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  const snapshot = snapshotJsonData(value);
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    fail("invalid_input", `${path} must be a plain closed object.`, path);
  }
  const descriptors = Object.getOwnPropertyDescriptors(snapshot);
  const actualKeys = Reflect.ownKeys(descriptors);
  if (actualKeys.some((key) => typeof key !== "string")) {
    fail("invalid_input", `${path} must not contain symbol properties.`, path);
  }
  for (const key of actualKeys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      fail("invalid_input", `${path} fields must be enumerable data properties.`, path);
    }
  }
  const actual = (actualKeys as string[]).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail("invalid_input", `${path} contains an unknown or missing property.`, path);
  }
  return snapshot as Record<string, unknown>;
}

export function assertUint64(
  value: unknown,
  path: string,
  options: { readonly positive?: boolean } = {},
): asserts value is string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/u.test(value)) {
    fail("invalid_input", `${path} must be a canonical uint64 decimal string.`, path);
  }
  const parsed = BigInt(value);
  if (parsed > ECONOMY_LIMITS.max_uint64 || (options.positive && parsed === 0n)) {
    fail("invalid_input", `${path} is outside its uint64 range.`, path);
  }
}

export function assertAtomicAmount(
  value: unknown,
  path: string,
  options: { readonly positive?: boolean } = {},
): asserts value is string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/u.test(value)) {
    fail("invalid_input", `${path} must be a canonical uint256 decimal string.`, path);
  }
  const parsed = BigInt(value);
  if (parsed > ECONOMY_LIMITS.max_uint256 || (options.positive && parsed === 0n)) {
    fail("invalid_input", `${path} is outside its uint256 range.`, path);
  }
}

export function assertSafeCode(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 0xffff_ffff) {
    fail("invalid_input", `${path} must be a non-negative uint32-safe integer.`, path);
  }
}

export function assertBoundedText(
  value: unknown,
  path: string,
  maxBytes: number,
  options: { readonly allowEmpty?: boolean } = {},
): asserts value is string {
  if (
    typeof value !== "string"
    || (!options.allowEmpty && value.length === 0)
    || value.includes("\0")
    || new TextEncoder().encode(value).byteLength > maxBytes
  ) {
    fail("invalid_input", `${path} must be bounded UTF-8 text without NUL.`, path);
  }
}

export function freezeArray<T>(items: readonly T[]): readonly Readonly<T>[] {
  return Object.freeze(items.map((item) => (
    item !== null && typeof item === "object" ? Object.freeze(item) : item
  ))) as readonly Readonly<T>[];
}
