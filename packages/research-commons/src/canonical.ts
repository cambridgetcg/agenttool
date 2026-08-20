import { createHash } from "node:crypto";
import { isProxy, isUint8Array } from "node:util/types";

import {
  MAX_JSON_BYTES,
  MAX_JSON_DEPTH,
  MAX_JSON_NODES,
  MAX_STRING_BYTES,
} from "./constants.js";
import { fail } from "./errors.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export function compareUnicode(left: string, right: string): number {
  const a = Array.from(left, (value) => value.codePointAt(0)!);
  const b = Array.from(right, (value) => value.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

function assertWellFormedUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) fail("canonical_error", `${path} contains forbidden U+0000`);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail("canonical_error", `${path} contains malformed Unicode`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail("canonical_error", `${path} contains malformed Unicode`);
    }
  }
}

function assertUnicode(value: string, path: string): void {
  if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) {
    fail("canonical_error", `${path} exceeds ${String(MAX_STRING_BYTES)} UTF-8 bytes`);
  }
  assertWellFormedUnicode(value, path);
}

function dataDescriptor(value: object, key: string, path: string): PropertyDescriptor & { value: unknown } {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    fail("canonical_error", `${path} could not be inspected`);
  }
  if (!descriptor || !("value" in descriptor)) {
    fail("canonical_error", `${path} must be a data property`);
  }
  return descriptor as PropertyDescriptor & { value: unknown };
}

export function snapshotJson(root: unknown): JsonValue {
  let nodes = 0;
  let stringBytes = 0;
  const ancestors = new Set<object>();

  function account(value: string, path: string): void {
    assertUnicode(value, path);
    stringBytes += Buffer.byteLength(value, "utf8");
    if (stringBytes > MAX_JSON_BYTES) {
      fail("canonical_error", "Canonical JSON input exceeds the byte bound");
    }
  }

  function visit(value: unknown, depth: number, path: string): JsonValue {
    nodes += 1;
    if (nodes > MAX_JSON_NODES) fail("canonical_error", "Canonical JSON has too many values");
    if (depth > MAX_JSON_DEPTH) fail("canonical_error", "Canonical JSON is too deeply nested");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      account(value, path);
      return value;
    }
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
        fail("canonical_error", `${path} must be a safe integer other than negative zero`);
      }
      return value;
    }
    if ((typeof value === "object" || typeof value === "function") && value !== null && isProxy(value)) {
      fail("canonical_error", `${path} must not be a Proxy value`);
    }
    if (typeof value !== "object" || value === null) {
      fail("canonical_error", `${path} is not canonical JSON`);
    }
    if (ancestors.has(value)) fail("canonical_error", "Canonical JSON rejects cycles");

    let prototype: object | null;
    let keys: readonly PropertyKey[];
    let isArray: boolean;
    try {
      prototype = Object.getPrototypeOf(value);
      keys = Reflect.ownKeys(value);
      isArray = Array.isArray(value);
    } catch {
      fail("canonical_error", `${path} could not be inspected`);
    }
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      fail("canonical_error", `${path} must use a standard Array or plain object`);
    }
    if (keys.some((key) => typeof key === "symbol")) {
      fail("canonical_error", `${path} has a symbol property`);
    }

    ancestors.add(value);
    try {
      if (isArray) {
        const input = value as unknown[];
        if (keys.length !== input.length + 1) {
          fail("canonical_error", `${path} must be a dense Array with only index data properties`);
        }
        const result: JsonValue[] = [];
        for (let index = 0; index < input.length; index += 1) {
          const descriptor = dataDescriptor(input, String(index), `${path}[${String(index)}]`);
          if (!descriptor.enumerable) {
            fail("canonical_error", `${path}[${String(index)}] must be enumerable`);
          }
          result.push(visit(descriptor.value, depth + 1, `${path}[${String(index)}]`));
        }
        return result;
      }

      const entries = (keys as readonly string[]).map((key) => {
        account(key, `${path} property name`);
        const descriptor = dataDescriptor(value, key, `${path}.${key}`);
        if (!descriptor.enumerable) fail("canonical_error", `${path}.${key} must be enumerable`);
        return { key, value: descriptor.value };
      }).sort((left, right) => compareUnicode(left.key, right.key));
      const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
      for (const entry of entries) {
        Object.defineProperty(result, entry.key, {
          configurable: true,
          enumerable: true,
          value: visit(entry.value, depth + 1, `${path}.${entry.key}`),
          writable: true,
        });
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  }

  const snapshot = visit(root, 0, "$");
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > MAX_JSON_BYTES) {
    fail("canonical_error", "Canonical JSON exceeds the byte bound");
  }
  return snapshot;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(snapshotJson(value));
}

export function deepFreeze<T>(value: T): Readonly<T> {
  const snapshot = snapshotJson(value);
  const stack: JsonValue[] = [snapshot];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current !== null && typeof current === "object") {
      stack.push(...(Array.isArray(current) ? current : Object.values(current)));
      Object.freeze(current);
    }
  }
  return snapshot as Readonly<T>;
}

export function sha256Id(value: string | Uint8Array): `sha256:${string}` {
  let bytes: Uint8Array;
  if (typeof value === "string") {
    assertUnicode(value, "$hash");
    bytes = Buffer.from(value, "utf8");
  } else {
    if (isProxy(value) || !isUint8Array(value)) {
      fail("canonical_error", "Hash bytes must be a genuine Uint8Array");
    }
    try {
      bytes = new Uint8Array(value);
    } catch {
      fail("canonical_error", "Hash bytes must be readable and attached");
    }
  }
  if (bytes.byteLength > MAX_JSON_BYTES) fail("canonical_error", "Hash input exceeds the byte bound");
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function domainSeparatedId(domain: string, value: unknown): `sha256:${string}` {
  if (!/^[\x21-\x7e]{1,128}$/u.test(domain)) {
    fail("canonical_error", "Hash domain must be a bounded ASCII protocol token");
  }
  const payload = Buffer.concat([
    Buffer.from(domain, "ascii"),
    Buffer.from([0]),
    Buffer.from(canonicalJson(value), "utf8"),
  ]);
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
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
        if (!escape || !'"\\/bfnrt'.includes(escape)) {
          fail("canonical_error", "Invalid string escape");
        }
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

export function parseStrictJson(input: string | Uint8Array): unknown {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    assertWellFormedUnicode(input, "$json input");
    bytes = Buffer.from(input, "utf8");
  } else {
    if (isProxy(input) || !isUint8Array(input)) {
      fail("canonical_error", "JSON input must be a string or genuine Uint8Array");
    }
    try {
      bytes = new Uint8Array(input);
    } catch {
      fail("canonical_error", "JSON input bytes must be readable and attached");
    }
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_JSON_BYTES) {
    fail("canonical_error", `JSON input must be 1..${String(MAX_JSON_BYTES)} bytes`);
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail("canonical_error", "JSON input must not begin with a UTF-8 BOM");
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
