import { isDeepStrictEqual, types as utilTypes } from "node:util";

import { fail, type SkillsWakeContinuityErrorCode } from "./errors.js";

const MAX_PLAN_NODES = 32_768;
const MAX_DEPTH = 24;
const MAX_ARRAY_LENGTH = 4_096;
const MAX_STRING_BYTES = 4_096;
const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const INSPECTION_REF =
  /^skills\/inspections\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SNAPSHOT_REF =
  /^skills\/skill_snapshots\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const INSPECTOR_REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export type DataPrimitive = string | number | boolean | null;
export type DataValue =
  | DataPrimitive
  | DataValue[]
  | { [key: string]: DataValue };

function assertUnicode(value: string, path: string): void {
  if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) {
    fail("plan_invalid", `${path} exceeds ${String(MAX_STRING_BYTES)} UTF-8 bytes`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0) fail("plan_invalid", `${path} contains forbidden U+0000`);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        fail("plan_invalid", `${path} contains a lone UTF-16 surrogate`);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail("plan_invalid", `${path} contains a lone UTF-16 surrogate`);
    }
  }
}

/**
 * Takes one own-data snapshot for validation only. It is deliberately not an
 * identity canonicalizer: content IDs remain owned by AFTERGLOW's
 * domainSeparatedId. The larger node budget admits the Skills planner's
 * closed 128-snapshot maximum without executing accessors.
 */
export function snapshotData(
  root: unknown,
  code: SkillsWakeContinuityErrorCode,
  rootPath = "$value",
): DataValue {
  let nodes = 0;
  const seen = new Set<object>();

  function visit(value: unknown, depth: number, path: string): DataValue {
    nodes += 1;
    if (nodes > MAX_PLAN_NODES) {
      fail(code, `${rootPath} has more than ${String(MAX_PLAN_NODES)} values`);
    }
    if (depth > MAX_DEPTH) fail(code, `${path} is too deeply nested`);
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      try {
        assertUnicode(value, path);
      } catch (error) {
        if (code === "plan_invalid") throw error;
        fail(code, error instanceof Error ? error.message : `${path} is invalid`);
      }
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
        fail(code, `${path} must be a safe integer and not negative zero`);
      }
      return value;
    }
    if (typeof value !== "object") {
      fail(code, `${path} contains unsupported ${typeof value}`);
    }
    if (utilTypes.isProxy(value)) {
      fail(code, `${path} must not be a Proxy`);
    }
    if (seen.has(value)) fail(code, `${path} contains a cycle`);
    seen.add(value);
    try {
      let descriptors: ReturnType<typeof Object.getOwnPropertyDescriptors>;
      let array: boolean;
      let prototype: object | null = null;
      try {
        array = Array.isArray(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
        if (!array) prototype = Object.getPrototypeOf(value);
      } catch {
        fail(code, `${path} could not be inspected as own data`);
      }
      const keys = Reflect.ownKeys(descriptors);
      if (array) {
        const lengthDescriptor = descriptors.length;
        if (
          !lengthDescriptor ||
          lengthDescriptor.enumerable ||
          !("value" in lengthDescriptor) ||
          !Number.isSafeInteger(lengthDescriptor.value) ||
          lengthDescriptor.value < 0 ||
          lengthDescriptor.value > MAX_ARRAY_LENGTH ||
          keys.length !== lengthDescriptor.value + 1
        ) {
          fail(code, `${path} must be a dense bounded array without extra properties`);
        }
        const output: DataValue[] = [];
        for (let index = 0; index < lengthDescriptor.value; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor?.enumerable || !("value" in descriptor)) {
            fail(code, `${path}[${String(index)}] must be an enumerable data property`);
          }
          output.push(visit(descriptor.value, depth + 1, `${path}[${String(index)}]`));
        }
        return output;
      }
      if (prototype !== Object.prototype && prototype !== null) {
        fail(code, `${path} must be a plain object`);
      }
      const output = Object.create(null) as Record<string, DataValue>;
      for (const key of keys) {
        if (typeof key !== "string") fail(code, `${path} has a symbol property`);
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          fail(code, `${path}.${key} must be an enumerable data property`);
        }
        try {
          assertUnicode(key, `${path}.{key}`);
        } catch (error) {
          if (code === "plan_invalid") throw error;
          fail(code, error instanceof Error ? error.message : `${path} has an invalid key`);
        }
        output[key] = visit(descriptor.value, depth + 1, `${path}.${key}`);
      }
      return output;
    } finally {
      seen.delete(value);
    }
  }

  return visit(root, 0, rootPath);
}

/** Inspect exactly one object layer without evaluating accessors. */
export function ownDataRecord(
  value: unknown,
  expected: readonly string[],
  path: string,
  code: SkillsWakeContinuityErrorCode,
): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    fail(code, `${path} must be a plain object`);
  }
  if (utilTypes.isProxy(value)) fail(code, `${path} must not be a Proxy`);
  if (Array.isArray(value)) fail(code, `${path} must be a plain object`);
  let prototype: object | null;
  let descriptors: ReturnType<typeof Object.getOwnPropertyDescriptors>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(code, `${path} could not be inspected as own data`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail(code, `${path} must be a plain object`);
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string")) {
    fail(code, `${path} has a symbol property`);
  }
  const actual = (keys as string[]).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(code, `${path} must contain exactly: ${wanted.join(", ")}`);
  }
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of actual) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      fail(code, `${path}.${key} must be an enumerable data property`);
    }
    output[key] = descriptor.value;
  }
  return output;
}

export function record(
  value: DataValue | undefined,
  path: string,
  code: SkillsWakeContinuityErrorCode,
): Record<string, DataValue> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    fail(code, `${path} must be an object`);
  }
  return value;
}

export function array(
  value: DataValue | undefined,
  path: string,
  code: SkillsWakeContinuityErrorCode,
): DataValue[] {
  if (!Array.isArray(value)) fail(code, `${path} must be an array`);
  return value;
}

export function exactKeys(
  value: Record<string, DataValue>,
  expected: readonly string[],
  path: string,
  code: SkillsWakeContinuityErrorCode,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(code, `${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

export function text(
  value: DataValue | undefined,
  path: string,
  code: SkillsWakeContinuityErrorCode,
): string {
  if (typeof value !== "string") fail(code, `${path} must be a string`);
  return value;
}

export function integer(
  value: DataValue | undefined,
  path: string,
  code: SkillsWakeContinuityErrorCode,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(code, `${path} must be a non-negative safe integer`);
  }
  return value as number;
}

export function literal<T extends string>(
  value: DataValue | undefined,
  allowed: readonly T[],
  path: string,
  code: SkillsWakeContinuityErrorCode,
): T {
  const candidate = text(value, path, code);
  if (!(allowed as readonly string[]).includes(candidate)) {
    fail(code, `${path} must be one of: ${allowed.join(", ")}`);
  }
  return candidate as T;
}

export function sha256(
  value: DataValue | undefined,
  path: string,
  code: SkillsWakeContinuityErrorCode,
): `sha256:${string}` {
  const candidate = text(value, path, code);
  if (!SHA256_ID.test(candidate)) {
    fail(code, `${path} must be a lowercase sha256: content ID`);
  }
  return candidate as `sha256:${string}`;
}

export function revision(
  value: DataValue | undefined,
  path: string,
  code: SkillsWakeContinuityErrorCode,
): string {
  const candidate = text(value, path, code);
  if (!INSPECTOR_REVISION.test(candidate)) {
    fail(code, `${path} must be a 40 or 64 lowercase hex revision`);
  }
  return candidate;
}

export function yutabaseRef(
  value: DataValue | undefined,
  deck: "inspections" | "skill_snapshots",
  path: string,
  code: SkillsWakeContinuityErrorCode,
): string {
  const candidate = text(value, path, code);
  const pattern = deck === "inspections" ? INSPECTION_REF : SNAPSHOT_REF;
  if (!pattern.test(candidate)) fail(code, `${path} must be a ${deck} YUTABASE ref`);
  return candidate;
}

export function assertDataEqual(
  actual: unknown,
  expected: unknown,
  path: string,
  code: SkillsWakeContinuityErrorCode,
): void {
  const left = snapshotData(actual, code, `${path}.actual`);
  const right = snapshotData(expected, code, `${path}.expected`);
  if (!isDeepStrictEqual(left, right)) fail(code, `${path} does not match the fixed contract`);
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value as Readonly<T>;
}
