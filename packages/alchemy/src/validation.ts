import { AlchemyReadError } from "./errors.js";
import type {
  EvmAddress,
  EvmBlockReference,
  EvmHash,
  HexData,
  HexQuantity,
} from "./types.js";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const QUANTITY_PATTERN = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const PADDED_QUANTITY_PATTERN = /^0x[0-9a-fA-F]{1,64}$/;
const DATA_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;

export function invalidInput(): never {
  throw new AlchemyReadError("invalid_input");
}

export function invalidResponse(): never {
  throw new AlchemyReadError("invalid_response");
}

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export function requireInputRecord(
  value: unknown,
): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    return invalidInput();
  }
  return value;
}

export function requireResponseRecord(
  value: unknown,
): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    return invalidResponse();
  }
  return value;
}

export function assertExactInputKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      invalidInput();
    }
  }
}

export function assertExactResponseKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      invalidResponse();
    }
  }
}

export function normalizeAddress(value: unknown): EvmAddress {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    return invalidInput();
  }
  return value.toLowerCase() as EvmAddress;
}

export function parseAddress(value: unknown): EvmAddress {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    return invalidResponse();
  }
  return value.toLowerCase() as EvmAddress;
}

export function parseNullableAddress(value: unknown): EvmAddress | null {
  return value === null ? null : parseAddress(value);
}

export function normalizeHash(value: unknown): EvmHash {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    return invalidInput();
  }
  return value.toLowerCase() as EvmHash;
}

export function parseHash(value: unknown): EvmHash {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    return invalidResponse();
  }
  return value.toLowerCase() as EvmHash;
}

export function parseNullableHash(value: unknown): EvmHash | null {
  return value === null ? null : parseHash(value);
}

export function normalizeHexQuantity(value: unknown): HexQuantity {
  if (
    typeof value !== "string" ||
    value.length > 66 ||
    !QUANTITY_PATTERN.test(value)
  ) {
    return invalidInput();
  }
  return value.toLowerCase() as HexQuantity;
}

export function parseHexQuantity(value: unknown): HexQuantity {
  if (
    typeof value !== "string" ||
    value.length > 66 ||
    !QUANTITY_PATTERN.test(value)
  ) {
    return invalidResponse();
  }
  return value.toLowerCase() as HexQuantity;
}

export function parsePaddedHexQuantity(value: unknown): HexQuantity {
  if (
    typeof value !== "string" ||
    !PADDED_QUANTITY_PATTERN.test(value)
  ) {
    return invalidResponse();
  }
  const digits = value.slice(2).replace(/^0+/, "").toLowerCase();
  return `0x${digits.length === 0 ? "0" : digits}`;
}

export function normalizeBlockReference(
  value: unknown,
): EvmBlockReference {
  if (value === "latest" || value === "safe" || value === "finalized") {
    return value;
  }
  return normalizeHexQuantity(value);
}

export function parseHexData(
  value: unknown,
  maxBytes: number,
): { value: HexData; bytes: number } {
  if (typeof value !== "string" || !DATA_PATTERN.test(value)) {
    return invalidResponse();
  }
  const bytes = (value.length - 2) / 2;
  if (bytes > maxBytes) {
    return invalidResponse();
  }
  return {
    value: value.toLowerCase() as HexData,
    bytes,
  };
}

export function quantityToDecimal(value: HexQuantity): string {
  return BigInt(value).toString(10);
}

export function requireInputInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalidInput();
  }
  return value;
}

export function requireResponseInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalidResponse();
  }
  return value;
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function requireBoundedResponseString(
  value: unknown,
  maximumBytes: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    utf8Bytes(value) > maximumBytes
  ) {
    return invalidResponse();
  }
  return value;
}
