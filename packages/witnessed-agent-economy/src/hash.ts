import { sha256 } from "@noble/hashes/sha2.js";

import {
  AGENTTOOL_SOURCE_HASH_PROTOCOL,
  WITNESS_CANONICAL_LIMITS,
  WITNESS_PROTOCOL,
} from "./constants.js";
import { invalid } from "./errors.js";
import { canonicalJson, encodeCanonicalRecord, hex } from "./internal.js";
import { encodeWitnessCanonicalJson, snapshotWitnessBytes } from "./witness-canonical.js";

const utf8 = new TextEncoder();
const NUL = new Uint8Array([0]);

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const safeParts = parts.map((part, index) => snapshotWitnessBytes(part, `$bytes[${index}]`));
  const output = new Uint8Array(safeParts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of safeParts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export function bytesToHex(bytes: Uint8Array): string {
  const safe = snapshotWitnessBytes(bytes);
  return Array.from(safe, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(value: string, expectedBytes?: number): Uint8Array {
  if (typeof value !== "string") invalid("Hexadecimal input must be a string.", "$hex");
  if (
    expectedBytes !== undefined
    && (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0
      || expectedBytes > WITNESS_CANONICAL_LIMITS.max_document_bytes)
  ) {
    invalid("Expected hexadecimal byte length must be a bounded non-negative safe integer.", "$expectedBytes");
  }
  hex(value, expectedBytes ?? value.length / 2, "$hex");
  if (value.length % 2 !== 0) invalid("Hexadecimal input must have even length.", "$hex");
  return Uint8Array.from(value.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

export function sha256Bytes(bytes: Uint8Array): Uint8Array {
  return sha256(snapshotWitnessBytes(bytes));
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256Bytes(bytes));
}

export function sha256Id(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256Hex(bytes)}`;
}

export function scopedHashBytes(scope: string, value: unknown): Uint8Array {
  if (typeof scope !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/u.test(scope)) {
    invalid("WITNESS hash label contains unsupported bytes.", "$scope");
  }
  return sha256Bytes(concatBytes(
    utf8.encode(WITNESS_PROTOCOL),
    NUL,
    utf8.encode(scope),
    NUL,
    encodeWitnessCanonicalJson(value),
  ));
}

export function scopedHash(scope: string, value: unknown): `sha256:${string}` {
  return `sha256:${bytesToHex(scopedHashBytes(scope, value))}`;
}

export function opaqueScopedRef(scope: string, value: unknown): string {
  return bytesToHex(scopedHashBytes(scope, value));
}

export function ed25519Fingerprint(publicKeyHex: string): `ed25519-sha256:${string}` {
  const publicKey = hexToBytes(publicKeyHex, 32);
  return `ed25519-sha256:${sha256Hex(publicKey)}`;
}

export function canonicalSha256(value: unknown): `sha256:${string}` {
  return sha256Id(new TextEncoder().encode(canonicalJson(value)));
}

/**
 * Hash an AgentTool-local source contract. This is intentionally separate from
 * shared WITNESS hashing: source contracts retain the established AgentTool
 * canonical JSON profile, while all shared envelopes, payloads and Merkle
 * leaves use encodeWitnessCanonicalJson (UTF-8 byte key ordering).
 */
export function agentToolSourceHashBytes(scope: string, value: unknown): Uint8Array {
  if (typeof scope !== "string" || !/^[a-z0-9][a-z0-9._/-]{0,127}$/u.test(scope)) {
    invalid("Source hash scope must be a lowercase protocol token.", "$scope");
  }
  return sha256Bytes(concatBytes(
    utf8.encode(AGENTTOOL_SOURCE_HASH_PROTOCOL),
    NUL,
    utf8.encode(scope),
    NUL,
    encodeCanonicalRecord(value),
  ));
}

export function agentToolSourceHash(scope: string, value: unknown): `sha256:${string}` {
  return `sha256:${bytesToHex(agentToolSourceHashBytes(scope, value))}`;
}
