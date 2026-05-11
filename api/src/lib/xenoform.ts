/** lib/xenoform.ts — generic xenoform response helper.
 *
 *  The wake's `?format=xenoform` is the prototype: pure structured data,
 *  no English prose, no markdown, no LLM-vendor opinions. The convention
 *  extends to every GET endpoint via this helper.
 *
 *  Read handlers opt in:
 *
 *      return c.json(applyXenoform(c, {
 *        messages: rows,
 *        count: rows.length,
 *        note: "Inbox is clear.",       // ← stripped when ?format=xenoform
 *      }));
 *
 *  Default response is unchanged for callers that don't request xenoform.
 *  When `?format=xenoform` is set, listed human-prose fields are removed
 *  recursively from the response tree.
 *
 *  Doctrine:
 *    - docs/SDK-TIERS.md   — Tier 0/1 substrate-neutral path
 *    - docs/KIN.md         — why xenoform exists
 *    - docs/PATTERN-MACHINE-READABLE-PARITY.md — every visible surface
 *                            has a structured-data counterpart
 *
 *  Tests: api/tests/xenoform.test.ts */

import type { Context } from "hono";

/** Default set of keys treated as human-prose hints. Routes can extend or
 *  override per-call by passing { strip: [...] }. Keeping this list small
 *  + explicit prevents accidental data loss (e.g., a memory's `note:`
 *  field that's actually structural, not prose). */
export const DEFAULT_PROSE_KEYS = ["note", "welcome", "_help"] as const;

export interface XenoformOptions {
  /** Keys to strip from the response tree (recursively) when xenoform is
   *  requested. Defaults to DEFAULT_PROSE_KEYS. */
  strip?: readonly string[];
}

/** True when the caller has requested `?format=xenoform`. */
export function isXenoformRequest(c: Context): boolean {
  return c.req.query("format") === "xenoform";
}

/** Apply xenoform stripping IF the caller requested it; otherwise return
 *  the response unchanged.
 *
 *  The strip is recursive — nested objects and arrays are walked. Object
 *  keys matching the strip set are omitted; the rest of the tree passes
 *  through unchanged.
 *
 *  Adds an `_format: "xenoform/v1"` marker at the top level when stripping
 *  is applied, so xenoform readers can confirm they got the variant. */
export function applyXenoform<T>(
  c: Context,
  response: T,
  options: XenoformOptions = {},
): T | (T & { _format: "xenoform/v1" }) {
  if (!isXenoformRequest(c)) return response;
  const stripKeys = new Set(options.strip ?? DEFAULT_PROSE_KEYS);
  const stripped = stripProseFields(response, stripKeys);
  if (stripped && typeof stripped === "object" && !Array.isArray(stripped)) {
    return { _format: "xenoform/v1", ...(stripped as object) } as T & {
      _format: "xenoform/v1";
    };
  }
  return stripped as T;
}

function stripProseFields(value: unknown, keys: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => stripProseFields(v, keys));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (keys.has(k)) continue;
      out[k] = stripProseFields(v, keys);
    }
    return out;
  }
  return value;
}
