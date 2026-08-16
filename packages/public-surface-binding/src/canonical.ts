import { sha256 } from "@noble/hashes/sha2.js";
import { isProxy } from "node:util/types";

import {
  bytesToHex,
  concatBytes,
  equalBytes,
  snapshotPlainBytes,
  utf8Decoder,
  utf8Encoder,
} from "./bytes.js";
import { LIMITS } from "./constants.js";
import { PublicSurfaceBindingError, invalid, limit } from "./errors.js";
import type { Sha256Id } from "./types.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function assertUnicode(value: string, path: string): void {
  // UTF-16 code-unit length is a safe lower bound for UTF-8 byte length. Refuse
  // obviously oversized attacker input before asking TextEncoder to allocate.
  if (value.length > LIMITS.max_string_bytes) {
    limit(`${path} exceeds ${LIMITS.max_string_bytes} UTF-8 bytes.`, path);
  }
  if (utf8Encoder.encode(value).byteLength > LIMITS.max_string_bytes) {
    limit(`${path} exceeds ${LIMITS.max_string_bytes} UTF-8 bytes.`, path);
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0) invalid(`${path} contains forbidden U+0000.`, path);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        invalid(`${path} contains a lone UTF-16 surrogate.`, path);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      invalid(`${path} contains a lone UTF-16 surrogate.`, path);
    }
  }
}

export function snapshotJsonData(root: unknown): JsonValue {
  let nodes = 0;
  const seen = new Set<object>();

  function snapshot(value: unknown, depth: number, path: string): JsonValue {
    nodes += 1;
    if (nodes > LIMITS.max_canonical_nodes) limit("Canonical JSON has too many values.", path);
    if (depth > LIMITS.max_canonical_depth) limit("Canonical JSON is too deeply nested.", path);
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      assertUnicode(value, path);
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
        invalid(`${path} must be a safe integer and not negative zero.`, path);
      }
      return value;
    }
    if (typeof value !== "object") invalid(`${path} contains unsupported ${typeof value}.`, path);
    if (isProxy(value)) invalid(`${path} must not be a Proxy.`, path);
    if (seen.has(value)) invalid(`${path} contains a cycle.`, path);
    seen.add(value);
    try {
      let arrayValue: boolean;
      let prototype: object | null;
      try {
        arrayValue = Array.isArray(value);
        prototype = Object.getPrototypeOf(value);
      } catch {
        invalid(`${path} could not be inspected safely.`, path);
      }
      if (arrayValue) {
        if (prototype !== Array.prototype) {
          invalid(`${path} must be an exact native array, not an array subclass or altered prototype.`, path);
        }
        let lengthDescriptor: PropertyDescriptor | undefined;
        try {
          lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
        } catch {
          invalid(`${path} length could not be inspected safely.`, path);
        }
        const length = lengthDescriptor && "value" in lengthDescriptor
          ? lengthDescriptor.value as unknown
          : undefined;
        if (!Number.isSafeInteger(length) || (length as number) < 0) {
          invalid(`${path} must have an intrinsic array length.`, path);
        }
        if ((length as number) > LIMITS.max_canonical_nodes - nodes) {
          limit("Canonical JSON has too many values.", path);
        }
        let keys: PropertyKey[];
        try {
          keys = Reflect.ownKeys(value);
        } catch {
          invalid(`${path} keys could not be inspected safely.`, path);
        }
        if (keys.length !== (length as number) + 1) {
          invalid(`${path} must be a dense array without extra properties.`, path);
        }
        const output: JsonValue[] = [];
        for (let index = 0; index < (length as number); index += 1) {
          let descriptor: PropertyDescriptor | undefined;
          try {
            descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          } catch {
            invalid(`${path}[${index}] could not be inspected safely.`, `${path}[${index}]`);
          }
          if (!descriptor?.enumerable || !("value" in descriptor)) {
            invalid(`${path}[${index}] must be an enumerable data property.`, `${path}[${index}]`);
          }
          output.push(snapshot(descriptor.value, depth + 1, `${path}[${index}]`));
        }
        return output;
      }
      if (prototype !== Object.prototype && prototype !== null) {
        invalid(`${path} must be a plain object.`, path);
      }
      let keys: PropertyKey[];
      try {
        keys = Reflect.ownKeys(value);
      } catch {
        invalid(`${path} keys could not be inspected safely.`, path);
      }
      if (keys.length > LIMITS.max_canonical_nodes - nodes) {
        limit("Canonical JSON has too many values.", path);
      }
      const output = Object.create(null) as Record<string, JsonValue>;
      for (const key of keys) {
        if (typeof key !== "string") invalid(`${path} must not contain symbol properties.`, path);
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor = Object.getOwnPropertyDescriptor(value, key);
        } catch {
          invalid(`${path}.${key} could not be inspected safely.`, `${path}.${key}`);
        }
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          invalid(`${path}.${key} must be an enumerable data property.`, `${path}.${key}`);
        }
        assertUnicode(key, `${path}.{key}`);
        Object.defineProperty(output, key, {
          configurable: true,
          enumerable: true,
          value: snapshot(descriptor.value, depth + 1, `${path}.${key}`),
          writable: true,
        });
      }
      return output;
    } finally {
      seen.delete(value);
    }
  }

  return snapshot(root, 0, "$");
}

function serialize(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serialize(value[key] as JsonValue)}`)
    .join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  const json = serialize(snapshotJsonData(value));
  if (utf8Encoder.encode(json).byteLength > LIMITS.max_canonical_bytes) {
    limit(`Canonical JSON exceeds ${LIMITS.max_canonical_bytes} bytes.`);
  }
  return json;
}

export function encodeCanonicalRecord(value: unknown): Uint8Array {
  return utf8Encoder.encode(canonicalJson(value));
}

export function decodeCanonicalRecord(bytes: Uint8Array): unknown {
  let snapshot: Uint8Array;
  try {
    snapshot = snapshotPlainBytes(bytes, "Canonical record", LIMITS.max_canonical_bytes, "limit");
  } catch (cause) {
    if (cause instanceof PublicSurfaceBindingError) throw cause;
    throw new PublicSurfaceBindingError(
      "CANONICAL_BYTES_INVALID",
      "Canonical record bytes could not be inspected safely.",
      { cause },
    );
  }
  let text: string;
  try {
    text = utf8Decoder.decode(snapshot);
  } catch (cause) {
    throw new PublicSurfaceBindingError("CANONICAL_BYTES_INVALID", "Record is not valid UTF-8.", { cause });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new PublicSurfaceBindingError("CANONICAL_BYTES_INVALID", "Record is not valid JSON.", { cause });
  }
  if (!equalBytes(snapshot, encodeCanonicalRecord(parsed))) {
    throw new PublicSurfaceBindingError(
      "CANONICAL_BYTES_INVALID",
      "Record bytes are not the unique canonical JSON encoding.",
    );
  }
  return parsed;
}

export function signingBytes(domain: string, core: unknown): Uint8Array {
  if (!/^[a-z0-9][a-z0-9._/-]{0,127}$/u.test(domain)) invalid("Invalid signing domain.");
  return concatBytes(utf8Encoder.encode(domain), new Uint8Array([0]), encodeCanonicalRecord(core));
}

export function signingDigest(domain: string, core: unknown): Uint8Array {
  return sha256(signingBytes(domain, core));
}

export function domainSeparatedId(domain: string, value: unknown): Sha256Id {
  return `sha256:${bytesToHex(sha256(signingBytes(domain, value)))}`;
}

export function canonicalRecordSha256(value: unknown): Sha256Id {
  return `sha256:${bytesToHex(sha256(encodeCanonicalRecord(value)))}`;
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value as Readonly<T>;
}

export function frozenClone<T>(value: T): Readonly<T> {
  return deepFreeze(structuredClone(value));
}
