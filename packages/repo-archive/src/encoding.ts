import { sha256 } from "@noble/hashes/sha2.js";

import { InvalidArchiveRecordError } from "./errors.js";

const encoder = new TextEncoder();

export function utf8(value: string): Uint8Array {
  return encoder.encode(value);
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

export function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function base64UrlDecode(
  value: string,
  label: string,
  expectedBytes?: number,
): Uint8Array {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.includes("=")
    || !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new InvalidArchiveRecordError(`${label} must be canonical unpadded base64url.`);
  }
  const bytes = new Uint8Array(Buffer.from(value, "base64url"));
  if (base64UrlEncode(bytes) !== value) {
    throw new InvalidArchiveRecordError(`${label} is not canonical base64url.`);
  }
  if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes) {
    throw new InvalidArchiveRecordError(`${label} must decode to ${expectedBytes} bytes.`);
  }
  return bytes;
}

export function lowerHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function sha256Id(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${lowerHex(sha256(bytes))}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return lowerHex(sha256(bytes));
}

export function randomBytes(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new InvalidArchiveRecordError("Random byte length must be a positive safe integer.");
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}
