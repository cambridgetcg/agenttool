import { createHash } from "node:crypto";

// Byte-identical port of @agenttool/collab src/canonical.ts, which is not
// exported from that package's index. tests/conformance.test.ts cross-checks
// recomputed heads against a CollabStore-written journal so drift fails loudly.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, sortValue(child)]);
    return Object.fromEntries(entries);
  }
  return value;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
