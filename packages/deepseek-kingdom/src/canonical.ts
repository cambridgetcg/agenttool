import { createHash } from "node:crypto";

import { fail } from "./errors.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export function canonicalJson(value: unknown): string {
  return encode(value, new Set<object>());
}

export function snapshotJson(value: unknown): JsonValue {
  return JSON.parse(canonicalJson(value)) as JsonValue;
}

export function sha256Id(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function domainSeparatedId(domain: string, value: unknown): `sha256:${string}` {
  if (!/^[\x21-\x7e]{1,128}$/u.test(domain)) {
    fail("invalid_json", "hash domain must be a bounded ASCII protocol token");
  }
  return sha256Id(`${domain}\u0000${canonicalJson(value)}`);
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      deepFreeze(entry);
    }
    Object.freeze(value);
  }
  return value;
}

export function compareUnicode(left: string, right: string): number {
  const a = Array.from(left, (character) => character.codePointAt(0)!);
  const b = Array.from(right, (character) => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

function encode(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string" && hasUnpairedSurrogate(value)) {
      fail("invalid_json", "canonical JSON rejects malformed Unicode");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      fail("invalid_json", "canonical JSON accepts safe integers only");
    }
    return String(value);
  }
  if (typeof value !== "object") {
    fail("invalid_json", "value is not canonical JSON");
  }
  if (seen.has(value)) fail("invalid_json", "canonical JSON rejects cycles");
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        fail("invalid_json", "canonical JSON rejects sparse arrays");
      }
    }
    seen.add(value);
    try {
      return `[${value.map((entry) => encode(entry, seen)).join(",")}]`;
    } finally {
      seen.delete(value);
    }
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail("invalid_json", "canonical JSON accepts plain objects only");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((entry) => entry.get || entry.set)) {
    fail("invalid_json", "canonical JSON rejects accessors");
  }
  seen.add(value);
  try {
    return `{${Object.keys(value)
      .sort(compareUnicode)
      .map((key) => {
        const entry = (value as Record<string, unknown>)[key];
        if (entry === undefined) fail("invalid_json", "canonical JSON rejects undefined");
        return `${JSON.stringify(key)}:${encode(entry, seen)}`;
      })
      .join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}
