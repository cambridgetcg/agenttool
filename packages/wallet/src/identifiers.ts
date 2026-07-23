import { sha256 } from "@noble/hashes/sha2.js";

import { bytesToHex, decodeFixedBase64Url } from "./bytes.js";
import { LIMITS } from "./constants.js";
import { invalid } from "./errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const CAIP2 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/u;
const CAIP10_ADDRESS = /^[-.%a-zA-Z0-9]{1,128}$/u;
const CAIP19_NAMESPACE = /^[-a-z0-9]{3,8}$/u;
const CAIP19_REFERENCE = /^[-.%a-zA-Z0-9]{1,128}$/u;
const METHOD = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/u;
const UINT256 = /^(0|[1-9][0-9]{0,77})$/u;
const MAX_UINT256 = (1n << 256n) - 1n;
const RFC3339_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export function assertBoundedString(
  value: unknown,
  label: string,
  maxBytes: number = LIMITS.max_string_bytes,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || new TextEncoder().encode(value).byteLength > maxBytes) {
    invalid(`${label} must be a non-empty string of at most ${maxBytes} UTF-8 bytes.`, label);
  }
  if (value.includes("\0")) invalid(`${label} must not contain NUL.`, label);
}

export function assertUuid(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) {
    invalid(`${label} must be a lowercase UUID.`, label);
  }
}

export function assertSha256Id(value: unknown, label: string): asserts value is `sha256:${string}` {
  if (typeof value !== "string" || !SHA256_ID.test(value)) {
    invalid(`${label} must be sha256:<64 lowercase hex>.`, label);
  }
}

export function assertCaip2(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !CAIP2.test(value) || value.includes("*")) {
    invalid(`${label} must use bounded CAIP-2 syntax without wildcards.`, label);
  }
}

export function chainFromAccount(accountId: string): string {
  const parts = accountId.split(":");
  return `${parts[0]}:${parts[1]}`;
}

export function assertCaip10(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") invalid(`${label} must be a CAIP-10 account identifier.`, label);
  const first = value.indexOf(":");
  const second = value.indexOf(":", first + 1);
  if (first < 0 || second < 0 || value.indexOf(":", second + 1) >= 0) {
    invalid(`${label} must contain one CAIP-2 chain and one account address.`, label);
  }
  const chain = value.slice(0, second);
  const address = value.slice(second + 1);
  assertCaip2(chain, `${label}.chain`);
  if (!CAIP10_ADDRESS.test(address) || address.includes("*") || /%[0-9a-f]{2}/u.test(address)) {
    invalid(`${label} has an invalid CAIP-10 address component.`, label);
  }
  if (chain.startsWith("eip155:") && !/^0x[0-9a-fA-F]{40}$/u.test(address)) {
    invalid(`${label} EIP-155 addresses must be 20-byte 0x-prefixed hex.`, label);
  }
}

export function chainFromAsset(assetId: string): string {
  return assetId.slice(0, assetId.indexOf("/"));
}

export function assertCaip19(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") invalid(`${label} must be a CAIP-19 asset identifier.`, label);
  const slash = value.indexOf("/");
  const colon = value.indexOf(":", slash + 1);
  if (slash < 0 || colon < 0 || value.indexOf("/", slash + 1) >= 0 || value.includes("*")) {
    invalid(`${label} must contain CAIP-2/asset_namespace:asset_reference.`, label);
  }
  assertCaip2(value.slice(0, slash), `${label}.chain`);
  if (!CAIP19_NAMESPACE.test(value.slice(slash + 1, colon)) || !CAIP19_REFERENCE.test(value.slice(colon + 1))) {
    invalid(`${label} has an invalid CAIP-19 asset component.`, label);
  }
}

export function assertMethod(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !METHOD.test(value) || value.includes("*")) {
    invalid(`${label} must be an explicit method identifier without wildcards.`, label);
  }
}

export function assertAmount(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !UINT256.test(value)) {
    invalid(`${label} must be a canonical base-10 uint256 string.`, label);
  }
  if (BigInt(value) > MAX_UINT256) invalid(`${label} exceeds uint256.`, label);
}

export function assertTimestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !RFC3339_MILLIS.test(value)) {
    invalid(`${label} must be an RFC3339 UTC timestamp with milliseconds.`, label);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    invalid(`${label} is not a real canonical timestamp.`, label);
  }
}

export function timestampMs(value: string): number {
  return Date.parse(value);
}

export function assertEd25519PublicKey(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") invalid(`${label} must be base64url.`, label);
  decodeFixedBase64Url(value, 32, label);
}

export function assertEd25519Signature(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") invalid(`${label} must be base64url.`, label);
  decodeFixedBase64Url(value, 64, label);
}

export function keyIdForPublicKey(publicKey: string): `sha256:${string}` {
  const bytes = decodeFixedBase64Url(publicKey, 32, "public_key");
  return `sha256:${bytesToHex(sha256(bytes))}`;
}
