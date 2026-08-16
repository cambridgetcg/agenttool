import { isProxy } from "node:util/types";

import { PublicSurfaceBindingError, invalid, limit } from "./errors.js";

export const utf8Encoder = new TextEncoder();
export const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;

export function snapshotPlainBytes(
  value: unknown,
  label: string,
  maxLength?: number,
  overLimit: "invalid" | "limit" = "invalid",
): Uint8Array {
  try {
    if (
      typeof value !== "object"
      || value === null
      || isProxy(value)
      || !(value instanceof Uint8Array)
      || Object.getPrototypeOf(value) !== Uint8Array.prototype
      || typeof typedArrayByteLength !== "function"
    ) return invalid(`${label} must be a plain Uint8Array.`, label);

    const length = Reflect.apply(typedArrayByteLength, value, []) as number;
    if (!Number.isSafeInteger(length) || length < 0) {
      return invalid(`${label} has an invalid byte length.`, label);
    }
    if (maxLength !== undefined && length > maxLength) {
      return overLimit === "limit"
        ? limit(`${label} exceeds ${maxLength} bytes.`, label)
        : invalid(`${label} exceeds ${maxLength} bytes.`, label);
    }

    const keys = Reflect.ownKeys(Object.getOwnPropertyDescriptors(value));
    if (
      keys.length !== length
      || keys.some((key, index) => key !== String(index))
    ) return invalid(`${label} must not carry decorated byte-view properties.`, label);

    const result = new Uint8Array(length);
    Reflect.apply(Uint8Array.prototype.set, result, [value]);
    return result;
  } catch (cause) {
    if (cause instanceof PublicSurfaceBindingError) throw cause;
    return invalid(`${label} could not be inspected safely.`, label);
  }
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

export function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

export function canonicalBase64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

export function canonicalBase64Decode(value: string, label: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    return invalid(`${label} must be canonical padded base64.`, label);
  }
  let binary: string;
  try {
    binary = globalThis.atob(value);
  } catch {
    return invalid(`${label} is not valid base64.`, label);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (canonicalBase64Encode(bytes) !== value) {
    return invalid(`${label} must use one canonical padded base64 encoding.`, label);
  }
  return bytes;
}

export function decodeFixedBase64(value: string, length: number, label: string): Uint8Array {
  const encodedLength = Math.ceil(length / 3) * 4;
  if (value.length !== encodedLength) {
    return invalid(`${label} must decode to ${length} bytes.`, label);
  }
  const bytes = canonicalBase64Decode(value, label);
  if (bytes.byteLength !== length) return invalid(`${label} must decode to ${length} bytes.`, label);
  return bytes;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return canonicalBase64Encode(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function base64UrlDecode(value: string, label: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) {
    return invalid(`${label} must be canonical unpadded base64url.`, label);
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    + "=".repeat((4 - (value.length % 4)) % 4);
  const bytes = canonicalBase64Decode(padded, label);
  if (base64UrlEncode(bytes) !== value) return invalid(`${label} is not canonical base64url.`, label);
  return bytes;
}

export function decodeFixedBase64Url(value: string, length: number, label: string): Uint8Array {
  const encodedLength = Math.ceil((length * 8) / 6);
  if (value.length !== encodedLength) {
    return invalid(`${label} must decode to ${length} bytes.`, label);
  }
  const bytes = base64UrlDecode(value, label);
  if (bytes.byteLength !== length) return invalid(`${label} must decode to ${length} bytes.`, label);
  return bytes;
}
