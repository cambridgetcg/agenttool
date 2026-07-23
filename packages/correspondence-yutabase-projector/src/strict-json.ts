import { ProjectorError } from "./errors.js";

// A record itself is bounded at 64; the collection envelope adds a few levels.
const MAX_DEPTH = 72;

function invalid(): never {
  throw new ProjectorError("source_protocol_invalid");
}

/** Detects duplicate decoded object names before JSON.parse can erase them. */
class DuplicateKeyScanner {
  #offset = 0;

  constructor(readonly source: string) {}

  scan(): void {
    this.#whitespace();
    if (this.#offset >= this.source.length) invalid();
    this.#value(0);
    this.#whitespace();
    if (this.#offset !== this.source.length) invalid();
  }

  #value(depth: number): void {
    if (depth > MAX_DEPTH) invalid();
    const token = this.source[this.#offset];
    if (token === "{") return this.#object(depth + 1);
    if (token === "[") return this.#array(depth + 1);
    if (token === '"') {
      this.#string();
      return;
    }
    if (
      token === "-" ||
      (token !== undefined && token >= "0" && token <= "9")
    ) {
      this.#number();
      return;
    }
    for (const literal of ["true", "false", "null"]) {
      if (this.source.startsWith(literal, this.#offset)) {
        this.#offset += literal.length;
        return;
      }
    }
    invalid();
  }

  #object(depth: number): void {
    this.#offset += 1;
    this.#whitespace();
    if (this.source[this.#offset] === "}") {
      this.#offset += 1;
      return;
    }
    const keys = new Set<string>();
    while (true) {
      if (this.source[this.#offset] !== '"') invalid();
      const key = this.#string();
      if (keys.has(key)) invalid();
      keys.add(key);
      this.#whitespace();
      if (this.source[this.#offset] !== ":") invalid();
      this.#offset += 1;
      this.#whitespace();
      this.#value(depth);
      this.#whitespace();
      const separator = this.source[this.#offset];
      if (separator === "}") {
        this.#offset += 1;
        return;
      }
      if (separator !== ",") invalid();
      this.#offset += 1;
      this.#whitespace();
    }
  }

  #array(depth: number): void {
    this.#offset += 1;
    this.#whitespace();
    if (this.source[this.#offset] === "]") {
      this.#offset += 1;
      return;
    }
    while (true) {
      this.#value(depth);
      this.#whitespace();
      const separator = this.source[this.#offset];
      if (separator === "]") {
        this.#offset += 1;
        return;
      }
      if (separator !== ",") invalid();
      this.#offset += 1;
      this.#whitespace();
    }
  }

  #string(): string {
    const start = this.#offset;
    this.#offset += 1;
    while (this.#offset < this.source.length) {
      const code = this.source.charCodeAt(this.#offset);
      if (code === 0x22) {
        this.#offset += 1;
        try {
          return JSON.parse(
            this.source.slice(start, this.#offset),
          ) as string;
        } catch {
          invalid();
        }
      }
      if (code < 0x20) invalid();
      if (code === 0x5c) {
        this.#offset += 1;
        const escape = this.source[this.#offset];
        if (escape === "u") {
          const hex = this.source.slice(
            this.#offset + 1,
            this.#offset + 5,
          );
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) invalid();
          this.#offset += 5;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) {
          invalid();
        }
      }
      this.#offset += 1;
    }
    invalid();
  }

  #number(): void {
    const match =
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
        this.source.slice(this.#offset),
      );
    if (!match) invalid();
    this.#offset += match[0].length;
  }

  #whitespace(): void {
    while (
      this.source[this.#offset] === " " ||
      this.source[this.#offset] === "\t" ||
      this.source[this.#offset] === "\r" ||
      this.source[this.#offset] === "\n"
    ) {
      this.#offset += 1;
    }
  }
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function assertProfile(value: unknown, depth = 0): void {
  if (depth > MAX_DEPTH) invalid();
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.includes("\0") || hasLoneSurrogate(value)) invalid();
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) invalid();
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertProfile(item, depth + 1);
    return;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalid();
    for (const [key, member] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (key.includes("\0") || hasLoneSurrogate(key)) invalid();
      assertProfile(member, depth + 1);
    }
    return;
  }
  invalid();
}

export function parseStrictJson(bytes: ArrayBuffer): unknown {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalid();
  }
  new DuplicateKeyScanner(source).scan();
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    invalid();
  }
  assertProfile(parsed);
  return parsed;
}
