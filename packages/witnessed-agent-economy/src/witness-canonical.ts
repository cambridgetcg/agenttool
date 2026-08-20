import { isProxy } from "node:util/types";

import { WITNESS_CANONICAL_LIMITS } from "./constants.js";
import { invalid, limit } from "./errors.js";

export type WitnessJsonPrimitive = string | number | boolean | null;
export type WitnessJsonValue =
  | WitnessJsonPrimitive
  | WitnessJsonValue[]
  | { [key: string]: WitnessJsonValue };

const utf8 = new TextEncoder();
const utf8Fatal = new TextDecoder("utf-8", { fatal: true });
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const byteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
const bufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;

/** Copy only an exact native, non-shared Uint8Array without consulting any
 * user-defined property. Proxies, subclasses, decorated instances, accessors,
 * detached buffers and SharedArrayBuffer views fail closed. */
export function snapshotWitnessBytes(value: unknown, path = "$bytes"): Uint8Array {
  if (typeof path !== "string" || path.length === 0 || path.length > 512) {
    invalid("Byte snapshot path must be a bounded string.", "$path");
  }
  if (typeof value !== "object" || value === null || isProxy(value)) {
    invalid(`${path} must be an exact non-proxy Uint8Array.`, path);
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  let byteLength: number;
  let buffer: ArrayBufferLike;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    byteLength = byteLengthGetter?.call(value) as number;
    buffer = bufferGetter?.call(value) as ArrayBufferLike;
  } catch {
    return invalid(`${path} could not be inspected as exact bytes.`, path);
  }
  if (prototype !== Uint8Array.prototype) invalid(`${path} must not be a typed-array subclass.`, path);
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) invalid(`${path} has an invalid or detached buffer.`, path);
  if (typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer) {
    invalid(`${path} must not share concurrently mutable memory.`, path);
  }
  let bufferPrototype: object | null;
  try {
    bufferPrototype = Object.getPrototypeOf(buffer);
  } catch {
    return invalid(`${path} backing buffer could not be inspected safely.`, path);
  }
  if (bufferPrototype !== ArrayBuffer.prototype) {
    invalid(`${path} must use an exact native ArrayBuffer.`, path);
  }
  // Unlike ArrayBuffer#slice, DataView construction does not consult a
  // species constructor. It distinguishes a detached zero-length buffer from
  // a genuine empty buffer without invoking caller code.
  try {
    new DataView(buffer as ArrayBuffer);
  } catch {
    return invalid(`${path} has a detached backing buffer.`, path);
  }
  if (byteLength > WITNESS_CANONICAL_LIMITS.max_document_bytes) {
    limit(`${path} exceeds ${WITNESS_CANONICAL_LIMITS.max_document_bytes} bytes.`, path);
  }
  if (
    keys.length !== byteLength
    || keys.some((key, index) => typeof key !== "string" || key !== String(index))
  ) {
    invalid(`${path} must not contain decorated or missing byte properties.`, path);
  }
  const output = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      return invalid(`${path}[${index}] could not be inspected safely.`, `${path}[${index}]`);
    }
    if (!descriptor?.enumerable || !("value" in descriptor) || !Number.isInteger(descriptor.value)) {
      invalid(`${path}[${index}] must be a byte data property.`, `${path}[${index}]`);
    }
    output[index] = descriptor.value as number;
  }
  return output;
}

function assertUnicode(value: string, path: string): void {
  if (value.length > WITNESS_CANONICAL_LIMITS.max_string_bytes) {
    limit(`${path} exceeds ${WITNESS_CANONICAL_LIMITS.max_string_bytes} UTF-8 bytes.`, path);
  }
  const encoded = utf8.encode(value);
  if (encoded.byteLength > WITNESS_CANONICAL_LIMITS.max_string_bytes) {
    limit(`${path} exceeds ${WITNESS_CANONICAL_LIMITS.max_string_bytes} UTF-8 bytes.`, path);
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

/**
 * Takes a defensive snapshot of the JavaScript object input accepted by the
 * shared WITNESS encoder. The wire profile permits uint64 JSON number tokens;
 * JavaScript object callers are deliberately restricted to exactly represented
 * non-negative safe integers. Every protocol counter/amount is a decimal
 * string, so no valid WITNESS record loses range through this restriction.
 */
export function snapshotWitnessJsonData(root: unknown): WitnessJsonValue {
  const seen = new Set<object>();
  let nodes = 0;

  function snapshot(value: unknown, depth: number, path: string): WitnessJsonValue {
    nodes += 1;
    // A canonical JSON document smaller than 1 MiB cannot contain this many
    // independently delimited values. Stop hostile in-memory graphs early.
    if (nodes > WITNESS_CANONICAL_LIMITS.max_document_bytes) {
      limit("WITNESS JSON has too many values.", path);
    }
    if (depth > WITNESS_CANONICAL_LIMITS.max_depth) {
      limit(`WITNESS JSON nesting exceeds ${WITNESS_CANONICAL_LIMITS.max_depth}.`, path);
    }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      assertUnicode(value, path);
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
        invalid(`${path} must be a canonical non-negative, safely represented integer.`, path);
      }
      return value;
    }
    if (typeof value !== "object") invalid(`${path} contains unsupported ${typeof value}.`, path);
    if (isProxy(value)) invalid(`${path} must not be a Proxy.`, path);
    if (seen.has(value)) invalid(`${path} contains a cycle.`, path);
    seen.add(value);
    try {
      let prototype: object | null;
      let isArray: boolean;
      try {
        prototype = Object.getPrototypeOf(value);
        isArray = Array.isArray(value);
      } catch {
        return invalid(`${path} could not be inspected safely.`, path);
      }
      if (isArray) {
        if (prototype !== Array.prototype) {
          invalid(`${path} must be an exact native array.`, path);
        }
        const array = value as unknown[];
        let ownKeys: PropertyKey[];
        let lengthDescriptor: PropertyDescriptor | undefined;
        try {
          ownKeys = Reflect.ownKeys(array);
          lengthDescriptor = Object.getOwnPropertyDescriptor(array, "length");
        } catch {
          return invalid(`${path} could not be inspected safely.`, path);
        }
        const length = lengthDescriptor && "value" in lengthDescriptor
          ? lengthDescriptor.value as unknown
          : undefined;
        if (!Number.isSafeInteger(length) || (length as number) < 0) {
          invalid(`${path} must have an intrinsic array length.`, path);
        }
        if ((length as number) > WITNESS_CANONICAL_LIMITS.max_array_elements) {
          limit(`${path} exceeds ${WITNESS_CANONICAL_LIMITS.max_array_elements} elements.`, path);
        }
        if (ownKeys.length !== (length as number) + 1) {
          invalid(`${path} must be dense and have no extra properties.`, path);
        }
        const output: WitnessJsonValue[] = [];
        for (let index = 0; index < (length as number); index += 1) {
          let descriptor: PropertyDescriptor | undefined;
          try {
            descriptor = Object.getOwnPropertyDescriptor(array, String(index));
          } catch {
            return invalid(`${path}[${index}] could not be inspected safely.`, `${path}[${index}]`);
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
      let ownKeys: PropertyKey[];
      try {
        ownKeys = Reflect.ownKeys(value);
      } catch {
        return invalid(`${path} keys could not be inspected safely.`, path);
      }
      if (ownKeys.length > WITNESS_CANONICAL_LIMITS.max_object_members) {
        limit(`${path} exceeds ${WITNESS_CANONICAL_LIMITS.max_object_members} members.`, path);
      }
      const output = Object.create(null) as Record<string, WitnessJsonValue>;
      for (const key of ownKeys) {
        if (typeof key !== "string") invalid(`${path} must not contain symbol properties.`, path);
        assertUnicode(key, `${path}.{key}`);
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor = Object.getOwnPropertyDescriptor(value, key);
        } catch {
          return invalid(`${path}.${key} could not be inspected safely.`, `${path}.${key}`);
        }
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          invalid(`${path}.${key} must be an enumerable data property.`, `${path}.${key}`);
        }
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

  return snapshot(root, 1, "$");
}

function compareUtf8(left: string, right: string): number {
  const a = utf8.encode(left);
  const b = utf8.encode(right);
  const shared = Math.min(a.byteLength, b.byteLength);
  for (let index = 0; index < shared; index += 1) {
    const delta = a[index]! - b[index]!;
    if (delta !== 0) return delta;
  }
  return a.byteLength - b.byteLength;
}

function serialize(value: WitnessJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  return `{${Object.keys(value)
    .sort(compareUtf8)
    .map((key) => `${JSON.stringify(key)}:${serialize(value[key]!)}`)
    .join(",")}}`;
}

export function witnessCanonicalJson(value: unknown): string {
  const canonical = serialize(snapshotWitnessJsonData(value));
  if (utf8.encode(canonical).byteLength > WITNESS_CANONICAL_LIMITS.max_document_bytes) {
    limit(`WITNESS canonical JSON exceeds ${WITNESS_CANONICAL_LIMITS.max_document_bytes} bytes.`);
  }
  return canonical;
}

export function encodeWitnessCanonicalJson(value: unknown): Uint8Array {
  return utf8.encode(witnessCanonicalJson(value));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let mismatch = 0;
  for (let index = 0; index < left.byteLength; index += 1) mismatch |= left[index]! ^ right[index]!;
  return mismatch === 0;
}

/** Decode only the unique canonical wire representation. Duplicate keys,
 * whitespace, non-minimal escapes/numbers, invalid UTF-8 and trailing data all
 * fail because re-encoding must be byte-identical. */
export function decodeWitnessCanonicalJson(bytes: Uint8Array): WitnessJsonValue {
  const snapshotBytes = snapshotWitnessBytes(bytes);
  if (snapshotBytes.byteLength === 0) invalid("WITNESS canonical input is empty.", "$bytes");
  let text: string;
  try {
    text = utf8Fatal.decode(snapshotBytes);
  } catch {
    return invalid("WITNESS canonical input is not valid UTF-8.", "$bytes");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return invalid("WITNESS canonical input is not valid JSON.", "$bytes");
  }
  const snapshot = snapshotWitnessJsonData(parsed);
  if (!equalBytes(snapshotBytes, encodeWitnessCanonicalJson(snapshot))) {
    invalid("WITNESS input is not the unique canonical JSON representation.", "$bytes");
  }
  return snapshot;
}
