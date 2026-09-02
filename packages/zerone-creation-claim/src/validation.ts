import { canonicalJson, compareUnicode, snapshotJson, type JsonValue } from "./canonical.js";
import { MAX_ARRAY_ITEMS, MAX_UINT64 } from "./constants.js";
import { fail } from "./errors.js";
import type { DecimalString, Sha256Id, SourceRevision } from "./types.js";

export type JsonRecord = Record<string, JsonValue>;

export function snapshotRecord(value: unknown, path = "$"): JsonRecord {
  const snapshot = snapshotJson(value);
  return record(snapshot, path);
}

export function record(value: JsonValue | undefined, path: string): JsonRecord {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    fail("invalid_record", `${path} must be an object`, path);
  }
  return value;
}

export function exactKeys(value: JsonRecord, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort(compareUnicode);
  const wanted = [...expected].sort(compareUnicode);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail("invalid_record", `${path} must contain exactly: ${wanted.join(", ")}`, path);
  }
}

export function literal<T>(value: JsonValue | undefined, expected: T, path: string): T {
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail("invalid_record", `${path} must equal the closed protocol value`, path);
  }
  return expected;
}

export function enumValue<T extends string>(
  value: JsonValue | undefined,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail("invalid_record", `${path} must be one of: ${allowed.join(", ")}`, path);
  }
  return value as T;
}

export function booleanValue(value: JsonValue | undefined, path: string): boolean {
  if (typeof value !== "boolean") fail("invalid_record", `${path} must be boolean`, path);
  return value;
}

export function boundedText(value: JsonValue | undefined, path: string, maximum = 256): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > maximum) {
    fail("invalid_record", `${path} must be a nonempty string of at most ${String(maximum)} bytes`, path);
  }
  return value;
}

export function identifier(value: JsonValue | undefined, path: string, maximum = 256): string {
  const item = boundedText(value, path, maximum);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(item)) {
    fail("invalid_record", `${path} must be a canonical bounded identifier`, path);
  }
  return item;
}

export function sourceRevision(value: JsonValue | undefined, path: string): SourceRevision {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    fail("invalid_record", `${path} must be a lowercase 40-hex source revision`, path);
  }
  return value;
}

export function sha256(value: JsonValue | undefined, path: string): Sha256Id {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail("invalid_record", `${path} must be a lowercase sha256 identifier`, path);
  }
  return value as Sha256Id;
}

export function nullableSha256(value: JsonValue | undefined, path: string): Sha256Id | null {
  return value === null ? null : sha256(value, path);
}

export function arrayValue(
  value: JsonValue | undefined,
  path: string,
  minimum = 0,
  maximum = MAX_ARRAY_ITEMS,
): JsonValue[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    fail("invalid_record", `${path} must contain ${String(minimum)}..${String(maximum)} entries`, path);
  }
  return value;
}

export function sortedUniqueDigests(
  value: JsonValue | undefined,
  path: string,
  minimum = 0,
  maximum = MAX_ARRAY_ITEMS,
): readonly Sha256Id[] {
  const items = arrayValue(value, path, minimum, maximum)
    .map((entry, index) => sha256(entry, `${path}[${String(index)}]`));
  assertStrictlySortedUnique(items, path);
  return items;
}

export function sortedUniqueIdentifiers(
  value: JsonValue | undefined,
  path: string,
  minimum = 0,
  maximum = MAX_ARRAY_ITEMS,
): readonly string[] {
  const items = arrayValue(value, path, minimum, maximum)
    .map((entry, index) => identifier(entry, `${path}[${String(index)}]`));
  assertStrictlySortedUnique(items, path);
  return items;
}

export function assertStrictlySortedUnique(values: readonly string[], path: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compareUnicode(values[index - 1]!, values[index]!) >= 0) {
      fail("invalid_record", `${path} must be strictly Unicode-sorted and unique`, path);
    }
  }
}

export function sortUnique<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)].sort(compareUnicode);
}

export function uint64(
  value: JsonValue | undefined,
  path: string,
  options: { readonly positive?: boolean; readonly maximum?: bigint } = {},
): DecimalString {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    fail("invalid_record", `${path} must be a canonical unsigned decimal string`, path);
  }
  const parsed = BigInt(value);
  if (parsed > (options.maximum ?? MAX_UINT64)) {
    fail("invalid_record", `${path} exceeds the allowed bound`, path);
  }
  if (options.positive === true && parsed === 0n) {
    fail("invalid_record", `${path} must be positive`, path);
  }
  return value;
}

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3] as const;

function bech32Polymod(values: readonly number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = (((checksum & 0x1ffffff) << 5) ^ value) >>> 0;
    for (let index = 0; index < BECH32_GENERATORS.length; index += 1) {
      if (((top >>> index) & 1) !== 0) checksum = (checksum ^ BECH32_GENERATORS[index]!) >>> 0;
    }
  }
  return checksum;
}

function isCanonicalZeroneAccount(value: string): boolean {
  if (!/^zrn1[023456789acdefghjklmnpqrstuvwxyz]{38}$/u.test(value)) return false;
  const data: number[] = [];
  for (const character of value.slice(4)) {
    const decoded = BECH32_CHARSET.indexOf(character);
    if (decoded < 0) return false;
    data.push(decoded);
  }
  const hrp = "zrn";
  const expandedHrp = [
    ...Array.from(hrp, (character) => character.charCodeAt(0) >>> 5),
    0,
    ...Array.from(hrp, (character) => character.charCodeAt(0) & 31),
  ];
  // A 20-byte Cosmos account payload is exactly 32 five-bit symbols, followed
  // by the six-symbol Bech32 checksum. The fixed shape makes padding
  // unambiguous; polymod 1 distinguishes Bech32 from Bech32m.
  return data.length === 38 && bech32Polymod([...expandedHrp, ...data]) === 1;
}

export function zeroneAddress(value: JsonValue | undefined, path: string): string {
  const item = boundedText(value, path, 96);
  if (!isCanonicalZeroneAccount(item)) {
    fail("invalid_record", `${path} must be a canonical lowercase zrn Bech32 20-byte account address`, path);
  }
  return item;
}

export function assertSame<T>(actual: T, expected: T, path: string, message?: string): void {
  if (actual !== expected) {
    fail("contract_mismatch", message ?? `${path} does not match its bound contract`, path);
  }
}

export function withoutKeys(
  value: JsonRecord,
  keys: readonly string[],
): Record<string, JsonValue> {
  const omitted = new Set(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)));
}
