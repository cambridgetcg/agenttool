/** Deterministic JSON so two runs of rhizome can be diffed. */

import type { JsonValue } from "./json.js";

export function stableStringify(value: JsonValue): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key] as JsonValue);
    return out;
  }
  return value;
}
