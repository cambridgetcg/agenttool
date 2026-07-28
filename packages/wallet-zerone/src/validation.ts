import { assertAmount } from "@agenttool/wallet";

import { ZERONE_LIMITS } from "./constants.js";
import { invalid } from "./errors.js";

const UINT64 = /^(0|[1-9][0-9]{0,19})$/u;
const TX_HASH = /^[0-9A-F]{64}$/u;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

export function assertUint64(
  value: unknown,
  path: string,
  options?: { readonly positive?: boolean },
): asserts value is string {
  if (typeof value !== "string" || !UINT64.test(value)) {
    invalid(`${path} must be a canonical uint64 decimal string.`, path);
  }
  const parsed = BigInt(value);
  if (
    parsed > ZERONE_LIMITS.max_uint64
    || (options?.positive === true && parsed === 0n)
  ) {
    invalid(`${path} is outside the allowed uint64 range.`, path);
  }
}

export function assertAtomicAmount(
  value: unknown,
  path: string,
  options?: { readonly positive?: boolean },
): asserts value is string {
  assertAmount(value, path);
  if (options?.positive === true && BigInt(value) === 0n) {
    invalid(`${path} must be positive.`, path);
  }
}

export function assertIdentifier(
  value: unknown,
  path: string,
): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    invalid(`${path} is not a canonical bounded identifier.`, path);
  }
}

export function assertTxHash(
  value: unknown,
  path = "tx_hash",
): asserts value is string {
  if (typeof value !== "string" || !TX_HASH.test(value)) {
    invalid(`${path} must be 64 uppercase hexadecimal characters.`, path);
  }
}

export function assertSafeCode(
  value: unknown,
  path: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(`${path} must be a non-negative safe integer.`, path);
  }
}

export function assertBoundedText(
  value: unknown,
  path: string,
  maxBytes: number,
  options?: { readonly allowEmpty?: boolean },
): asserts value is string {
  if (
    typeof value !== "string"
    || (options?.allowEmpty !== true && value.length === 0)
    || new TextEncoder().encode(value).byteLength > maxBytes
    || value.includes("\0")
  ) {
    invalid(`${path} is outside its UTF-8 text boundary.`, path);
  }
}

export function closedRecord(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): Readonly<Record<string, unknown>> {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalid(`${path} must be a plain closed object.`, path);
  }
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    invalid(`${path} properties could not be read safely.`, path);
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string")) {
    invalid(`${path} must not have symbol properties.`, path);
  }
  const actual = (keys as string[]).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    invalid(`${path} must contain exactly: ${expected.join(", ")}.`, path);
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      invalid(`${path}.${key} must be an enumerable data property.`, `${path}.${key}`);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

export function freezeArray<T>(items: readonly T[]): readonly T[] {
  return Object.freeze([...items]);
}
