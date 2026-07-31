import { createHash } from "node:crypto";

import { HfScoutError } from "./errors.js";
import { escapeJsonTerminalState } from "./terminal.js";
import { compareUnicode } from "./validation.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  return encode(value, seen);
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeJson(value: unknown, indent = 2): string {
  const json = JSON.stringify(value, null, indent);
  if (json === undefined) throw new HfScoutError("invalid_json", "value is not JSON serializable");
  return escapeJsonTerminalState(json);
}

function encode(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new HfScoutError("invalid_json_number", "canonical JSON accepts safe integers only");
    }
    return String(value);
  }
  if (typeof value !== "object") {
    throw new HfScoutError("invalid_json_type", "value is not canonical JSON");
  }
  if (seen.has(value)) throw new HfScoutError("invalid_json_cycle", "canonical JSON rejects cycles");
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    seen.add(value);
    try {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new HfScoutError("invalid_json_array", "canonical JSON rejects sparse arrays");
        }
      }
      return `[${value.map((item) => encode(item, seen)).join(",")}]`;
    } finally {
      seen.delete(value);
    }
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new HfScoutError("invalid_json_object", "canonical JSON accepts plain objects only");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((entry) => entry.get || entry.set)) {
    throw new HfScoutError("invalid_json_object", "canonical JSON rejects accessors");
  }
  seen.add(value);
  try {
    return `{${Object.keys(value)
          .sort(compareUnicode)
      .map((key) => {
        const entry = (value as Record<string, unknown>)[key];
        if (entry === undefined) {
          throw new HfScoutError("invalid_json_type", "canonical JSON rejects undefined");
        }
        return `${JSON.stringify(key)}:${encode(entry, seen)}`;
      })
      .join(",")}}`;
  } finally {
    seen.delete(value);
  }
}
