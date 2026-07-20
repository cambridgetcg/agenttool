import { equalBytes, utf8Decoder, utf8Encoder } from "./bytes.js";
import { InvalidInputError } from "./errors.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Finite parser/serializer ceilings used by the experimental reference profile. */
export const MAX_CANONICAL_DEPTH = 64;
export const MAX_CANONICAL_NODES = 100_000;

function assertStructuralLimits(root: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_CANONICAL_NODES) {
      throw new InvalidInputError(`Canonical JSON exceeds ${MAX_CANONICAL_NODES} values.`);
    }
    if (current.depth > MAX_CANONICAL_DEPTH) {
      throw new InvalidInputError(`Canonical JSON exceeds depth ${MAX_CANONICAL_DEPTH}.`);
    }
    if (current.value !== null && typeof current.value === "object") {
      const values = Array.isArray(current.value)
        ? current.value
        : Object.values(current.value as Record<string, unknown>);
      for (const value of values) stack.push({ value, depth: current.depth + 1 });
    }
  }
}

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        throw new InvalidInputError("Canonical JSON strings must not contain lone UTF-16 surrogates.");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new InvalidInputError("Canonical JSON strings must not contain lone UTF-16 surrogates.");
    }
  }
}

function serialize(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    assertValidUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new InvalidInputError("Canonical JSON numbers must be finite.");
    }
    if (Object.is(value, -0)) {
      throw new InvalidInputError("Canonical JSON numbers must not be negative zero.");
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new InvalidInputError("Canonical JSON integers must be safe integers.");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new InvalidInputError(`Unsupported canonical JSON value: ${typeof value}.`);
  }
  if (seen.has(value)) throw new InvalidInputError("Canonical JSON cannot contain cycles.");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const values: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new InvalidInputError("Canonical JSON arrays must be dense.");
        }
        values.push(serialize(value[index], seen));
      }
      if (Reflect.ownKeys(value).some((key) => key !== "length" && !(typeof key === "string" && /^(0|[1-9][0-9]*)$/u.test(key)))) {
        throw new InvalidInputError("Canonical JSON arrays must not have non-index properties.");
      }
      return `[${values.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new InvalidInputError("Canonical JSON objects must be plain objects.");
    }
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    if (Reflect.ownKeys(object).length !== keys.length) {
      throw new InvalidInputError("Canonical JSON objects must not have symbol or non-enumerable properties.");
    }
    const fields = keys.map((key) => {
      assertValidUnicode(key);
      return `${JSON.stringify(key)}:${serialize(object[key], seen)}`;
    });
    return `{${fields.join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

/** Stable restricted-I-JSON serialization with RFC 8785-compatible ordering/rendering. */
export function canonicalJson(value: JsonValue | unknown): string {
  assertStructuralLimits(value);
  return serialize(value, new Set());
}

export function canonicalJsonBytes(value: JsonValue | unknown): Uint8Array {
  return utf8Encoder.encode(canonicalJson(value));
}

/** Parse a record and reject whitespace, duplicate-key normalization, or other non-canonical encodings. */
export function parseCanonicalJson(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = utf8Decoder.decode(bytes);
  } catch (cause) {
    throw new InvalidInputError("Record is not valid UTF-8.", { cause });
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new InvalidInputError("Record is not valid JSON.", { cause });
  }
  let encoded: Uint8Array;
  try {
    encoded = canonicalJsonBytes(value);
  } catch (cause) {
    throw new InvalidInputError("Record is not valid canonical JSON.", { cause });
  }
  if (!equalBytes(bytes, encoded)) {
    throw new InvalidInputError("Record bytes are not canonical JSON.");
  }
  return value;
}
