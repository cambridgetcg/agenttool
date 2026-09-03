import { readFileSync } from "node:fs";

import { verifyOfficialVectorSources } from "../src/index.js";
import type {
  ConformanceObservation,
  ConformanceSuite,
  ConformanceTrace,
  ConformanceTraceEntry,
  JsonValue,
} from "../src/index.js";

export const packageRoot = new URL("../", import.meta.url);
export const vectorBytes = readFileSync(new URL("vectors/economic-kernel-v0.2.json", packageRoot));
export const manifestBytes = readFileSync(new URL("vectors/manifest.json", packageRoot));
export const suite: Readonly<ConformanceSuite> = verifyOfficialVectorSources(vectorBytes, manifestBytes);

export function trace(entries: readonly ConformanceTraceEntry[]): ConformanceTrace {
  return {
    schema: "agenttool.economic-conformance-trace/1",
    suite_id: suite.suite_id,
    suite_revision: suite.suite_revision,
    producer_declared_ref: "adapter:test-fixture",
    entries,
  };
}

export function exactEntries(): ConformanceTraceEntry[] {
  return suite.cases.map((item) => ({
    case_id: item.case_id,
    observed: item.expected,
  }));
}

export function reverseObjectKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value !== null && typeof value === "object") {
    const output = Object.create(null) as Record<string, JsonValue>;
    for (const [key, item] of Object.entries(value).reverse()) {
      output[key] = reverseObjectKeys(item);
    }
    return output;
  }
  return value;
}

export function reversedObservation(value: ConformanceObservation): ConformanceObservation {
  return reverseObjectKeys(value as unknown as JsonValue) as ConformanceObservation;
}
