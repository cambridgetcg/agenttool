import { createHash } from "node:crypto";
import { isProxy, isUint8Array } from "node:util/types";

import { fail } from "./errors.js";
import type { Sha256Id } from "./types.js";

// The public maxima admit 128 bridges × 32 evaluations × 8 evidence refs.
// Keep that maximum constructible, with room for the derived flag complex.
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_JSON_DEPTH = 24;
const MAX_JSON_NODES = 262_144;
const MAX_STRING_BYTES = 4 * 1024;
const DOMAIN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

/** AgentTool canonical JSON follows JCS-compatible unsigned UTF-16 order. */
export function utf16Order(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertUnicode(
  value: string,
  path: string,
  maxBytes: number | null = MAX_STRING_BYTES,
  forbidNull = true,
): void {
  if (maxBytes !== null && Buffer.byteLength(value, "utf8") > maxBytes) {
    fail("canonical_error", `${path} exceeds ${String(maxBytes)} UTF-8 bytes`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0 && forbidNull) {
      fail("canonical_error", `${path} contains forbidden U+0000`);
    }
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        fail("canonical_error", `${path} contains a lone UTF-16 surrogate`);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail("canonical_error", `${path} contains a lone UTF-16 surrogate`);
    }
  }
}

export function snapshotJson(root: unknown): JsonValue {
  let nodes = 0;
  let jsonBytes = 0;
  const seen = new Set<object>();

  function addJsonBytes(bytes: number): void {
    jsonBytes += bytes;
    if (jsonBytes > MAX_JSON_BYTES) {
      fail("canonical_error", `Canonical JSON exceeds ${MAX_JSON_BYTES} bytes`);
    }
  }

  function visit(value: unknown, depth: number, path: string): JsonValue {
    nodes += 1;
    if (nodes > MAX_JSON_NODES) {
      fail("canonical_error", "Canonical JSON has too many values");
    }
    if (depth > MAX_JSON_DEPTH) {
      fail("canonical_error", "Canonical JSON is too deeply nested");
    }
    if (value === null) {
      addJsonBytes(4);
      return value;
    }
    if (typeof value === "boolean") {
      addJsonBytes(value ? 4 : 5);
      return value;
    }
    if (typeof value === "string") {
      assertUnicode(value, path);
      addJsonBytes(Buffer.byteLength(JSON.stringify(value), "utf8"));
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
        fail(
          "canonical_error",
          `${path} must be a safe integer and not negative zero`,
        );
      }
      addJsonBytes(Buffer.byteLength(JSON.stringify(value), "utf8"));
      return value;
    }
    if (typeof value !== "object") {
      fail("canonical_error", `${path} contains unsupported ${typeof value}`);
    }
    if (isProxy(value)) {
      fail("canonical_error", `${path} must not be a Proxy`);
    }
    if (seen.has(value)) fail("canonical_error", `${path} contains a cycle`);
    seen.add(value);
    try {
      let array: boolean;
      let keys: (string | symbol)[];
      let prototype: object | null;
      try {
        array = Array.isArray(value);
        keys = Reflect.ownKeys(value);
        prototype = Object.getPrototypeOf(value);
      } catch {
        fail(
          "canonical_error",
          `${path} could not be inspected as canonical JSON`,
        );
      }
      const availableChildNodes = MAX_JSON_NODES - nodes;
      const maximumOwnKeys = availableChildNodes + (array ? 1 : 0);
      if (keys.length > maximumOwnKeys) {
        fail("canonical_error", "Canonical JSON has too many values");
      }
      const descriptor = (key: string | symbol): PropertyDescriptor => {
        let own: PropertyDescriptor | undefined;
        try {
          own = Object.getOwnPropertyDescriptor(value, key);
        } catch {
          fail(
            "canonical_error",
            `${path} could not be inspected as canonical JSON`,
          );
        }
        if (!own) {
          fail(
            "canonical_error",
            `${path} changed while being inspected as canonical JSON`,
          );
        }
        return own;
      };
      if (array) {
        if (prototype !== Array.prototype) {
          fail("canonical_error", `${path} must be a standard array`);
        }
        const lengthDescriptor = descriptor("length");
        if (
          !lengthDescriptor ||
          lengthDescriptor.enumerable ||
          !("value" in lengthDescriptor) ||
          typeof lengthDescriptor.value !== "number" ||
          !Number.isSafeInteger(lengthDescriptor.value) ||
          lengthDescriptor.value < 0
        ) {
          fail(
            "canonical_error",
            `${path} must be a dense array without extra properties`,
          );
        }
        const length = lengthDescriptor.value;
        if (length > MAX_JSON_NODES || keys.length !== length + 1) {
          fail(
            "canonical_error",
            `${path} must be a dense array without extra properties`,
          );
        }
        addJsonBytes(2 + Math.max(0, length - 1));
        const output: JsonValue[] = [];
        for (let index = 0; index < length; index += 1) {
          const item = descriptor(String(index));
          if (!item?.enumerable || !("value" in item)) {
            fail(
              "canonical_error",
              `${path}[${index}] must be an enumerable data property`,
            );
          }
          output.push(visit(item.value, depth + 1, `${path}[${index}]`));
        }
        return output;
      }
      if (prototype !== Object.prototype) {
        fail("canonical_error", `${path} must be a plain object`);
      }
      addJsonBytes(2 + Math.max(0, keys.length - 1));
      const output: Record<string, JsonValue> = {};
      for (const key of keys) {
        if (typeof key !== "string") {
          fail("canonical_error", `${path} has a symbol property`);
        }
        const property = descriptor(key);
        if (!property.enumerable || !("value" in property)) {
          fail(
            "canonical_error",
            `${path}.${key} must be an enumerable data property`,
          );
        }
        assertUnicode(key, `${path}.{key}`);
        addJsonBytes(Buffer.byteLength(JSON.stringify(key), "utf8") + 1);
        Object.defineProperty(output, key, {
          configurable: true,
          enumerable: true,
          value: visit(property.value, depth + 1, `${path}.${key}`),
          writable: true,
        });
      }
      return output;
    } finally {
      seen.delete(value);
    }
  }

  return visit(root, 0, "$");
}

function serialize(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  return `{${Object.keys(value)
    .sort(utf16Order)
    .map(
      (key) => `${JSON.stringify(key)}:${serialize(value[key] as JsonValue)}`,
    )
    .join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  const json = serialize(snapshotJson(value));
  if (Buffer.byteLength(json, "utf8") > MAX_JSON_BYTES) {
    fail("canonical_error", `Canonical JSON exceeds ${MAX_JSON_BYTES} bytes`);
  }
  return json;
}

function rawSha256Id(bytes: Uint8Array | string): Sha256Id {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function sha256Id(bytes: Uint8Array | string): Sha256Id {
  if (typeof bytes === "string") {
    assertUnicode(bytes, "$bytes", null, false);
    return rawSha256Id(bytes);
  }
  if (
    bytes === null ||
    typeof bytes !== "object" ||
    isProxy(bytes) ||
    !isUint8Array(bytes)
  ) {
    fail("canonical_error", "$bytes must be a string or genuine Uint8Array");
  }
  let snapshot: Uint8Array;
  try {
    snapshot = new Uint8Array(bytes);
  } catch {
    fail("canonical_error", "$bytes could not be copied as a Uint8Array");
  }
  return rawSha256Id(snapshot);
}

export function domainSeparatedId(domain: string, value: unknown): Sha256Id {
  if (typeof domain !== "string" || !DOMAIN.test(domain)) {
    fail(
      "canonical_error",
      "Domain must be a 1-128 character ASCII protocol token",
    );
  }
  return rawSha256Id(`${domain}\0${canonicalJson(value)}`);
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value as Readonly<T>;
}
