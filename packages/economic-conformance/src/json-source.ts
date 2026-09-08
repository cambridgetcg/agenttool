import { isProxy } from "node:util/types";
import { TextDecoder } from "node:util";

import { fail, snapshotJson } from "./internal.js";
import type { JsonValue } from "./types.js";

const MAX_SOURCE_BYTES = 1_048_576;
const MAX_SOURCE_DEPTH = 20;
const MAX_SOURCE_NODES = 16_384;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;

function snapshotBytes(value: unknown, path: string): Uint8Array {
  if (
    (typeof value === "object" || typeof value === "function")
    && value !== null
    && isProxy(value)
  ) {
    fail(`${path} must not be a Proxy.`, path);
  }
  if (!(value instanceof Uint8Array)) {
    fail(`${path} must be a Uint8Array containing exact UTF-8 bytes.`, path);
  }
  const prototype = Object.getPrototypeOf(value);
  const standardPrototype = Buffer.isBuffer(value) ? Buffer.prototype : Uint8Array.prototype;
  if (prototype !== standardPrototype || typedArrayByteLength === undefined || typedArrayBuffer === undefined) {
    fail(`${path} must use the standard Buffer or Uint8Array prototype.`, path);
  }
  let byteLength: number;
  let backingBuffer: ArrayBufferLike;
  try {
    byteLength = Reflect.apply(typedArrayByteLength, value, []) as number;
    backingBuffer = Reflect.apply(typedArrayBuffer, value, []) as ArrayBufferLike;
  } catch {
    fail(`${path} must be an intact Buffer or Uint8Array.`, path);
  }
  if (typeof SharedArrayBuffer !== "undefined" && backingBuffer instanceof SharedArrayBuffer) {
    fail(`${path} must not use shared, concurrently mutable storage.`, path);
  }
  if (byteLength === 0 || byteLength > MAX_SOURCE_BYTES) {
    fail(`${path} must contain 1..${String(MAX_SOURCE_BYTES)} bytes.`, path, "LIMIT_EXCEEDED");
  }
  const snapshot = new Uint8Array(byteLength);
  try {
    // The intrinsic typed-array copy ignores own iterator/accessor decorations.
    Reflect.apply(Uint8Array.prototype.set, snapshot, [value]);
  } catch {
    fail(`${path} could not be copied as inert bytes.`, path);
  }
  return snapshot;
}

class StrictJsonScanner {
  private offset = 0;
  private nodes = 0;

  constructor(
    private readonly source: string,
    private readonly path: string,
  ) {}

  scan(): void {
    this.whitespace();
    if (this.offset === this.source.length) {
      fail(`${this.path} must not be empty.`, this.path, "INVALID_JSON");
    }
    this.value(0);
    this.whitespace();
    if (this.offset !== this.source.length) {
      fail(`${this.path} contains trailing JSON data.`, this.path, "INVALID_JSON");
    }
  }

  private value(depth: number): void {
    this.nodes += 1;
    if (this.nodes > MAX_SOURCE_NODES) {
      fail(`${this.path} contains too many JSON values.`, this.path, "LIMIT_EXCEEDED");
    }
    if (depth > MAX_SOURCE_DEPTH) {
      fail(`${this.path} is too deeply nested.`, this.path, "LIMIT_EXCEEDED");
    }
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
    for (const literal of ["true", "false", "null"] as const) {
      if (this.source.startsWith(literal, this.offset)) {
        this.offset += literal.length;
        return;
      }
    }
    fail(`${this.path} contains an invalid JSON value.`, this.path, "INVALID_JSON");
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
      if (this.source[this.offset] !== '"') {
        fail(`${this.path} contains an unquoted object key.`, this.path, "INVALID_JSON");
      }
      const key = this.string();
      if (keys.has(key)) {
        fail(`${this.path} contains a duplicate JSON object key.`, this.path, "DUPLICATE_JSON_KEY");
      }
      keys.add(key);
      this.whitespace();
      if (this.source[this.offset] !== ":") {
        fail(`${this.path} contains an object key without a colon.`, this.path, "INVALID_JSON");
      }
      this.offset += 1;
      this.whitespace();
      this.value(depth);
      this.whitespace();
      if (this.source[this.offset] === "}") {
        this.offset += 1;
        return;
      }
      if (this.source[this.offset] !== ",") {
        fail(`${this.path} contains object members without commas.`, this.path, "INVALID_JSON");
      }
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
      if (this.source[this.offset] !== ",") {
        fail(`${this.path} contains array items without commas.`, this.path, "INVALID_JSON");
      }
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
        let value: unknown;
        try {
          value = JSON.parse(this.source.slice(start, this.offset)) as unknown;
        } catch {
          fail(`${this.path} contains a malformed JSON string.`, this.path, "INVALID_JSON");
        }
        if (typeof value !== "string") {
          fail(`${this.path} contains a malformed JSON string.`, this.path, "INVALID_JSON");
        }
        return value;
      }
      if (code < 0x20) {
        fail(`${this.path} contains an unescaped control character.`, this.path, "INVALID_JSON");
      }
      if (code === 0x5c) {
        this.offset += 1;
        const escape = this.source[this.offset];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/u.test(this.source.slice(this.offset + 1, this.offset + 5))) {
            fail(`${this.path} contains a malformed Unicode escape.`, this.path, "INVALID_JSON");
          }
          this.offset += 5;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) {
          fail(`${this.path} contains an invalid string escape.`, this.path, "INVALID_JSON");
        }
      }
      this.offset += 1;
    }
    fail(`${this.path} contains an unterminated JSON string.`, this.path, "INVALID_JSON");
  }

  private number(): void {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
      this.source.slice(this.offset),
    );
    if (match === null) {
      fail(`${this.path} contains a malformed JSON number.`, this.path, "INVALID_JSON");
    }
    this.offset += match[0].length;
  }

  private whitespace(): void {
    while (/^[\t\n\r ]$/u.test(this.source[this.offset] ?? "")) this.offset += 1;
  }
}

export function parseStrictJsonBytes(value: unknown, path: string): JsonValue {
  const bytes = snapshotBytes(value, path);
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(`${path} is not well-formed UTF-8.`, path, "INVALID_UTF8");
  }
  new StrictJsonScanner(source, path).scan();
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    fail(`${path} is not valid JSON.`, path, "INVALID_JSON");
  }
  return snapshotJson(parsed);
}

export function copyRawBytes(value: unknown, path: string): Uint8Array {
  return snapshotBytes(value, path);
}
