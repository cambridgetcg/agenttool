import { sha256 } from "@noble/hashes/sha2.js";

import { bytesToHex, concatBytes, equalBytes, utf8Decoder, utf8Encoder } from "./bytes.js";
import { LIMITS } from "./constants.js";
import { invalid, limit } from "./errors.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function assertUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) invalid("NUL is not allowed in protocol strings.", path);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        invalid("Lone UTF-16 surrogates are not allowed.", path);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      invalid("Lone UTF-16 surrogates are not allowed.", path);
    }
  }
}

export function snapshotJsonData(root: unknown): JsonValue {
  let nodes = 0;
  const seen = new Set<object>();

  function snapshot(value: unknown, depth: number, path: string): JsonValue {
    nodes += 1;
    if (nodes > LIMITS.max_canonical_nodes) {
      limit(`Canonical JSON exceeds ${LIMITS.max_canonical_nodes} values.`);
    }
    if (depth > LIMITS.max_canonical_depth) {
      limit(`Canonical JSON exceeds depth ${LIMITS.max_canonical_depth}.`, path);
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      assertUnicode(value, path);
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
        invalid("Protocol JSON numbers must be safe integers and must not be negative zero.", path);
      }
      return value;
    }
    if (typeof value !== "object") {
      invalid(`Unsupported protocol JSON value: ${typeof value}.`, path);
    }
    if (seen.has(value)) invalid("Protocol JSON cannot contain cycles.", path);
    seen.add(value);
    try {
      let descriptors: PropertyDescriptorMap;
      try {
        descriptors = Object.getOwnPropertyDescriptors(value);
      } catch {
        invalid("Protocol JSON properties could not be snapshotted safely.", path);
      }
      const keys = Reflect.ownKeys(descriptors);
      if (Array.isArray(value)) {
        const lengthDescriptor = descriptors.length;
        if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value)) {
          invalid("Protocol JSON array length must be a data property.", path);
        }
        const length = lengthDescriptor.value as number;
        if (length > LIMITS.max_canonical_nodes || keys.length !== length + 1) {
          invalid("Protocol JSON arrays must be dense and contain only index properties.", path);
        }
        const result: JsonValue[] = new Array(length);
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor?.enumerable || !("value" in descriptor)) {
            invalid("Protocol JSON array items must be enumerable data properties.", `${path}[${index}]`);
          }
          result[index] = snapshot(descriptor.value, depth + 1, `${path}[${index}]`);
        }
        if (keys.some((key) => key !== "length" && !(typeof key === "string" && /^(0|[1-9][0-9]*)$/u.test(key)))) {
          invalid("Protocol JSON arrays must not have non-index properties.", path);
        }
        return result;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        invalid("Protocol JSON objects must be plain objects.", path);
      }
      const result = Object.create(null) as Record<string, JsonValue>;
      for (const key of keys) {
        if (typeof key !== "string") {
          invalid("Protocol JSON objects must not have symbol properties.", path);
        }
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          invalid("Protocol JSON object fields must be enumerable data properties, not accessors.", `${path}.${key}`);
        }
        assertUnicode(key, `${path}.{key}`);
        Object.defineProperty(result, key, {
          configurable: true,
          enumerable: true,
          value: snapshot(descriptor.value, depth + 1, `${path}.${key}`),
          writable: true,
        });
      }
      return result;
    } finally {
      seen.delete(value);
    }
  }

  return snapshot(root, 0, "$");
}

function serialize(value: unknown, seen: Set<object>, path: string): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    assertUnicode(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      invalid("Protocol JSON numbers must be safe integers and must not be negative zero.", path);
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    invalid(`Unsupported protocol JSON value: ${typeof value}.`, path);
  }
  if (seen.has(value)) invalid("Protocol JSON cannot contain cycles.", path);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const fields: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) invalid("Protocol JSON arrays must be dense.", path);
        fields.push(serialize(value[index], seen, `${path}[${index}]`));
      }
      if (
        Reflect.ownKeys(value).some((key) =>
          key !== "length"
          && !(typeof key === "string" && /^(0|[1-9][0-9]*)$/u.test(key)))
      ) {
        invalid("Protocol JSON arrays must not have non-index properties.", path);
      }
      return `[${fields.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      invalid("Protocol JSON objects must be plain objects.", path);
    }
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    if (Reflect.ownKeys(object).length !== keys.length) {
      invalid("Protocol JSON objects must not have symbol or non-enumerable properties.", path);
    }
    const fields = keys.map((key) => {
      assertUnicode(key, `${path}.{key}`);
      return `${JSON.stringify(key)}:${serialize(object[key], seen, `${path}.${key}`)}`;
    });
    return `{${fields.join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value: JsonValue | unknown): string {
  return serialize(snapshotJsonData(value), new Set(), "$");
}

export function canonicalJsonBytes(value: JsonValue | unknown): Uint8Array {
  const bytes = utf8Encoder.encode(canonicalJson(value));
  if (bytes.byteLength > LIMITS.max_canonical_bytes) {
    limit(`Canonical record exceeds ${LIMITS.max_canonical_bytes} bytes.`);
  }
  return bytes;
}

export function parseCanonicalJson(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = utf8Decoder.decode(bytes);
  } catch (cause) {
    invalid(`Record is not valid UTF-8 (${cause instanceof Error ? cause.name : "decode_error"}).`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (cause) {
    invalid(`Record is not valid JSON (${cause instanceof Error ? cause.name : "parse_error"}).`);
  }
  if (!equalBytes(bytes, canonicalJsonBytes(value))) {
    invalid("Record bytes are not canonical JSON.");
  }
  return value;
}

export function signingBytes(domain: string, core: unknown): Uint8Array {
  return concatBytes(utf8Encoder.encode(domain), new Uint8Array([0]), canonicalJsonBytes(core));
}

export function signingDigest(domain: string, core: unknown): Uint8Array {
  return sha256(signingBytes(domain, core));
}

export function sha256Id(value: unknown): `sha256:${string}` {
  return `sha256:${bytesToHex(sha256(canonicalJsonBytes(value)))}`;
}
