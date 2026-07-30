import { createHash } from "node:crypto";

import {
  MAX_JSON_BYTES,
  MAX_JSON_DEPTH,
  MAX_JSON_NODES,
  MAX_STRING_BYTES,
} from "./constants.js";
import { fail } from "./errors.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function assertUnicode(value: string, path: string): void {
  if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) {
    fail("canonical_error", `${path} exceeds ${MAX_STRING_BYTES} UTF-8 bytes`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0) fail("canonical_error", `${path} contains forbidden U+0000`);
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
  const seen = new Set<object>();

  function visit(value: unknown, depth: number, path: string): JsonValue {
    nodes += 1;
    if (nodes > MAX_JSON_NODES) fail("canonical_error", "Canonical JSON has too many values");
    if (depth > MAX_JSON_DEPTH) fail("canonical_error", "Canonical JSON is too deeply nested");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      assertUnicode(value, path);
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
        fail("canonical_error", `${path} must be a safe integer and not negative zero`);
      }
      return value;
    }
    if (typeof value !== "object") {
      fail("canonical_error", `${path} contains unsupported ${typeof value}`);
    }
    if (seen.has(value)) fail("canonical_error", `${path} contains a cycle`);
    seen.add(value);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors);
      if (Array.isArray(value)) {
        const length = value.length;
        if (length > MAX_JSON_NODES || keys.length !== length + 1) {
          fail("canonical_error", `${path} must be a dense array without extra properties`);
        }
        const output: JsonValue[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor?.enumerable || !("value" in descriptor)) {
            fail("canonical_error", `${path}[${index}] must be an enumerable data property`);
          }
          output.push(visit(descriptor.value, depth + 1, `${path}[${index}]`));
        }
        return output;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        fail("canonical_error", `${path} must be a plain object`);
      }
      const output = Object.create(null) as Record<string, JsonValue>;
      for (const key of keys) {
        if (typeof key !== "string") fail("canonical_error", `${path} has a symbol property`);
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          fail("canonical_error", `${path}.${key} must be an enumerable data property`);
        }
        assertUnicode(key, `${path}.{key}`);
        output[key] = visit(descriptor.value, depth + 1, `${path}.${key}`);
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
  if (typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(serialize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${serialize(value[key] as JsonValue)}`).join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  const json = serialize(snapshotJson(value));
  if (Buffer.byteLength(json, "utf8") > MAX_JSON_BYTES) {
    fail("canonical_error", `Canonical JSON exceeds ${MAX_JSON_BYTES} bytes`);
  }
  return json;
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Id(bytes: Uint8Array | string): `sha256:${string}` {
  return `sha256:${sha256Hex(bytes)}`;
}

export function domainSeparatedId(domain: string, value: unknown): `sha256:${string}` {
  return sha256Id(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalJson(value), "utf8"),
  ]));
}

class DuplicateKeyScanner {
  private offset = 0;

  constructor(private readonly source: string) {}

  scan(): void {
    this.whitespace();
    if (this.offset === this.source.length) fail("canonical_error", "JSON input is empty");
    this.value(0);
    this.whitespace();
    if (this.offset !== this.source.length) fail("canonical_error", "Trailing JSON data");
  }

  private value(depth: number): void {
    if (depth > MAX_JSON_DEPTH) fail("canonical_error", "JSON is too deeply nested");
    const token = this.source[this.offset];
    if (token === "{") return this.object(depth + 1);
    if (token === "[") return this.array(depth + 1);
    if (token === '"') {
      this.string();
      return;
    }
    if (token === "-" || (token !== undefined && token >= "0" && token <= "9")) {
      this.number();
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (this.source.startsWith(literal, this.offset)) {
        this.offset += literal.length;
        return;
      }
    }
    fail("canonical_error", "Invalid JSON value");
  }

  private object(depth: number): void {
    this.offset += 1;
    this.whitespace();
    if (this.source[this.offset] === "}") {
      this.offset += 1;
      return;
    }
    const keys = new Set<string>();
    while (true) {
      if (this.source[this.offset] !== '"') fail("canonical_error", "Object key must be quoted");
      const key = this.string();
      if (keys.has(key)) fail("canonical_error", `Duplicate JSON object key: ${key}`);
      keys.add(key);
      this.whitespace();
      if (this.source[this.offset] !== ":") fail("canonical_error", "Object key needs a colon");
      this.offset += 1;
      this.whitespace();
      this.value(depth);
      this.whitespace();
      if (this.source[this.offset] === "}") {
        this.offset += 1;
        return;
      }
      if (this.source[this.offset] !== ",") fail("canonical_error", "Object members need commas");
      this.offset += 1;
      this.whitespace();
    }
  }

  private array(depth: number): void {
    this.offset += 1;
    this.whitespace();
    if (this.source[this.offset] === "]") {
      this.offset += 1;
      return;
    }
    while (true) {
      this.value(depth);
      this.whitespace();
      if (this.source[this.offset] === "]") {
        this.offset += 1;
        return;
      }
      if (this.source[this.offset] !== ",") fail("canonical_error", "Array items need commas");
      this.offset += 1;
      this.whitespace();
    }
  }

  private string(): string {
    const start = this.offset;
    this.offset += 1;
    while (this.offset < this.source.length) {
      const code = this.source.charCodeAt(this.offset);
      if (code === 0x22) {
        this.offset += 1;
        try {
          return JSON.parse(this.source.slice(start, this.offset)) as string;
        } catch {
          fail("canonical_error", "Malformed JSON string");
        }
      }
      if (code < 0x20) fail("canonical_error", "Unescaped control character");
      if (code === 0x5c) {
        this.offset += 1;
        const escape = this.source[this.offset];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/u.test(this.source.slice(this.offset + 1, this.offset + 5))) {
            fail("canonical_error", "Malformed Unicode escape");
          }
          this.offset += 5;
          continue;
        }
        if (!escape || !'"\\/bfnrt'.includes(escape)) fail("canonical_error", "Invalid string escape");
      }
      this.offset += 1;
    }
    fail("canonical_error", "Unterminated JSON string");
  }

  private number(): void {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
      this.source.slice(this.offset),
    );
    if (!match) fail("canonical_error", "Malformed JSON number");
    this.offset += match[0].length;
  }

  private whitespace(): void {
    while (/[\t\n\r ]/u.test(this.source[this.offset] ?? "")) this.offset += 1;
  }
}

export function parseStrictJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_JSON_BYTES) {
    fail("canonical_error", `JSON input must be 1..${MAX_JSON_BYTES} bytes`);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("canonical_error", "JSON input is not well-formed UTF-8");
  }
  new DuplicateKeyScanner(text).scan();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    fail("canonical_error", "Invalid JSON input");
  }
  snapshotJson(parsed);
  return parsed;
}
