/** Substrate-task verifier canonicalization helpers.
 *
 *  Doctrine: docs/superpowers/specs/2026-05-12-substrate-tasks-design.md
 *            §Verifier purity + docs/CANONICAL-BYTES.md.
 *
 *  Every verifier must be a pure function of (task_data, completion_data,
 *  server-observable state). For state hashing, use these helpers — never
 *  ad-hoc JSON.stringify with implicit key order. */

import { createHash } from "node:crypto";

/** Sorted-keys JSON canonicalization. Deterministic across runs. */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      sorted[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return sorted;
  }
  return v;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}
