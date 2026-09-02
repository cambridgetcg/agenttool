import {
  assertAmount,
  assertSha256Id,
  assertTimestamp,
  canonicalJson,
  snapshotJsonData,
  type Sha256Id,
} from "@agenttool/wallet";

import { LIMITS, SEMANTIC_BOUNDARY } from "./constants.js";
import { invalid } from "./errors.js";

export type ObjectValue = Record<string, unknown>;

export function record(value: unknown, keys: readonly string[], path: string): ObjectValue {
  snapshotJsonData(value);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("invalid_record", `${path} must be a plain object.`, path);
  }
  const object = value as ObjectValue;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid("invalid_record", `${path} contains an unknown or missing property.`, path);
  }
  return object;
}

export function text(
  value: unknown,
  path: string,
  maximum: number = LIMITS.max_text_bytes,
  options: { readonly allowEmpty?: boolean } = {},
): string {
  if (
    typeof value !== "string"
    || (!options.allowEmpty && value.length === 0)
    || new TextEncoder().encode(value).byteLength > maximum
    || value.includes("\0")
  ) {
    invalid(
      "invalid_record",
      `${path} must be ${options.allowEmpty ? "a" : "a non-empty"} bounded UTF-8 string without NUL.`,
      path,
    );
  }
  return value;
}

export function identifier(value: unknown, path: string): string {
  const item = text(value, path, 256);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(item)) {
    invalid("invalid_record", `${path} must be a canonical bounded identifier.`, path);
  }
  return item;
}

export function did(value: unknown, path: string): string {
  const item = text(value, path, 1_024);
  if (!/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+(?:[/:?=#][A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]*)?$/u.test(item)) {
    invalid("invalid_identity_binding", `${path} must be an explicit DID.`, path);
  }
  return item;
}

export function hash(value: unknown, path: string): Sha256Id {
  try {
    assertSha256Id(value, path);
  } catch {
    invalid("invalid_hash", `${path} must be sha256:<64 lowercase hex>.`, path);
  }
  return value as Sha256Id;
}

/**
 * Existing Fact IDs include generated 32-hex IDs and established symbolic
 * doctrine/genesis IDs. Consensus ultimately requires the target to exist.
 */
export function factId(value: unknown, path: string): string {
  return identifier(value, path);
}

export function timestamp(value: unknown, path: string): string {
  try {
    assertTimestamp(value, path);
  } catch {
    invalid("invalid_record", `${path} must be a canonical UTC timestamp with milliseconds.`, path);
  }
  return value as string;
}

export function amount(
  value: unknown,
  path: string,
  options: { readonly positive?: boolean } = {},
): string {
  try {
    assertAmount(value, path);
  } catch {
    invalid("invalid_amount", `${path} must be a canonical uint256 decimal string.`, path);
  }
  const item = value as string;
  if (options.positive && item === "0") {
    invalid("invalid_amount", `${path} must be positive.`, path);
  }
  return item;
}

export function uint64(
  value: unknown,
  path: string,
  options: { readonly positive?: boolean; readonly maximum?: bigint } = {},
): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/u.test(value)) {
    invalid("invalid_amount", `${path} must be a canonical uint64 decimal string.`, path);
  }
  const integer = BigInt(value);
  const maximum = options.maximum ?? LIMITS.max_uint64;
  if (integer > maximum || (options.positive && integer === 0n)) {
    invalid("invalid_amount", `${path} is outside its allowed uint64 range.`, path);
  }
  return value;
}

export function uint32Number(
  value: unknown,
  path: string,
  options: { readonly positive?: boolean; readonly maximum?: number } = {},
): number {
  const maximum = options.maximum ?? Number(LIMITS.max_uint32);
  if (
    !Number.isSafeInteger(value)
    || (value as number) < (options.positive ? 1 : 0)
    || (value as number) > maximum
  ) {
    invalid("invalid_amount", `${path} must be an integer in its allowed uint32 range.`, path);
  }
  return value as number;
}

export function sortedUnique<T extends string>(
  value: unknown,
  path: string,
  validator: (item: unknown, itemPath: string) => T,
  maximum: number = LIMITS.max_array_items,
): readonly T[] {
  if (!Array.isArray(value) || value.length > maximum) {
    invalid("invalid_record", `${path} must be an array with at most ${maximum} entries.`, path);
  }
  const output = value.map((item, index) => validator(item, `${path}[${index}]`));
  if (output.some((item, index) => index > 0 && item <= (output[index - 1] as T))) {
    invalid("invalid_record", `${path} must be strictly sorted and unique.`, path);
  }
  return Object.freeze(output);
}

export function assertSemanticBoundary(value: unknown, path: string): void {
  const item = record(value, [
    "creates_identity",
    "creates_karma",
    "determines_truth",
    "grants_governance",
    "zrn_role",
  ], path);
  if (canonicalJson(item) !== canonicalJson(SEMANTIC_BOUNDARY)) {
    invalid(
      "invalid_record",
      `${path} must preserve the fixed identity/truth/KARMA/governance separation.`,
      path,
    );
  }
}

export function assertSame(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) {
    invalid("contract_mismatch", `${path} does not match its committed value.`, path);
  }
}

export function freeze<T extends object>(value: T): Readonly<T> {
  for (const member of Object.values(value)) {
    if (typeof member === "object" && member !== null && !Object.isFrozen(member)) {
      freeze(member as object);
    }
  }
  return Object.freeze(value);
}
