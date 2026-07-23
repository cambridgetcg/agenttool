import type { InspectionReport, JsonValue } from "./types.js";

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value !== null && typeof value === "object") {
    const sorted = Object.create(null) as Record<string, JsonValue>;
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item !== undefined) sorted[key] = sortJsonValue(item);
    }
    return sorted;
  }
  return value;
}

export function stableStringify(value: InspectionReport, space?: number): string;
export function stableStringify(value: JsonValue, space?: number): string;
export function stableStringify(value: InspectionReport | JsonValue, space = 2): string {
  return `${JSON.stringify(sortJsonValue(value as JsonValue), null, space)}\n`;
}
