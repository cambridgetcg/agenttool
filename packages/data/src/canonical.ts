import { createHash } from "node:crypto";
import { DataNodeError } from "./errors.js";
import type { JsonObject } from "./types.js";

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new DataNodeError("invalid_json", "JSON numbers must be finite");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") {
    throw new DataNodeError("invalid_json", "Value is not JSON-compatible");
  }
  const object = value as Record<string, unknown>;
  const entries = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`);
  return `{${entries.join(",")}}`;
}

export function cloneJsonObject(value: unknown, field = "value"): JsonObject {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DataNodeError("invalid_json", `${field} must be a JSON object`);
  }
  assertJsonValue(value, field, new Set(), 0);
  return JSON.parse(canonicalJson(value as JsonObject)) as JsonObject;
}

function assertJsonValue(value: unknown, field: string, seen: Set<object>, depth: number): void {
  if (depth > 64) throw new DataNodeError("invalid_json", `${field} exceeds maximum nesting depth`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DataNodeError("invalid_json", `${field} has a non-finite number`);
    return;
  }
  if (typeof value !== "object") {
    throw new DataNodeError("invalid_json", `${field} is not JSON-compatible`);
  }
  if (seen.has(value)) throw new DataNodeError("invalid_json", `${field} contains a cycle`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${field}[${index}]`, seen, depth + 1));
  } else {
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${field}.${key}`, seen, depth + 1);
    }
  }
  seen.delete(value);
}

export function sha256Hex(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function normalizeIsoDate(value: string, field: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) {
    throw new DataNodeError("invalid_date", `${field} must be RFC 3339 with a timezone`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const zone = match[8]!;
  const offsetHour = zone === "Z" ? 0 : Number(zone.slice(1, 3));
  const offsetMinute = zone === "Z" ? 0 : Number(zone.slice(4, 6));
  const daysInMonth = month >= 1 && month <= 12
    ? [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
    : 0;
  if (
    day < 1 || day > daysInMonth
    || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59
  ) {
    throw new DataNodeError("invalid_date", `${field} must be a valid RFC 3339 timestamp`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new DataNodeError("invalid_date", `${field} must be a valid RFC 3339 timestamp`);
  }
  return date.toISOString();
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function normalizeMediaType(value: string): string {
  const mediaType = value.split(";", 1)[0]!.trim().toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType)) {
    throw new DataNodeError("invalid_media_type", "media_type must be a valid MIME type");
  }
  return mediaType;
}

export function isTextualMediaType(mediaType: string): boolean {
  return mediaType.startsWith("text/")
    || mediaType === "application/json"
    || mediaType.endsWith("+json")
    || mediaType === "application/xml"
    || mediaType.endsWith("+xml")
    || mediaType === "application/javascript";
}
