import { invalid } from "./errors.js";

export const utf8Encoder = new TextEncoder();
export const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

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

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function base64UrlDecode(value: string, label = "base64url value"): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) {
    return invalid(`${label} must be canonical unpadded base64url.`);
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    + "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = globalThis.atob(padded);
  } catch {
    return invalid(`${label} is not valid base64url.`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (base64UrlEncode(bytes) !== value) {
    return invalid(`${label} must be canonical unpadded base64url.`);
  }
  return bytes;
}

export function decodeFixedBase64Url(
  value: string,
  length: number,
  label: string,
): Uint8Array {
  const bytes = base64UrlDecode(value, label);
  if (bytes.byteLength !== length) {
    return invalid(`${label} must decode to ${length} bytes.`);
  }
  return bytes;
}
