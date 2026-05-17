/** since=ISO query-param helper — cache-friendly delta reads for list
 *  endpoints. Per AGENT-WEB-SURFACE.md Move 6.
 *
 *  Convention:
 *    GET /v1/<resource>?since=2026-05-17T00:00:00Z
 *
 *  The endpoint returns only items whose `updated_at > since`. Responses
 *  include `as_of: <server-time>` so the agent knows the next `since`
 *  value (it cannot trust local clock — server time is the source of
 *  truth). Omitting `since` returns the full list (current behavior).
 *
 *  Doctrine: docs/AGENT-WEB-SURFACE.md Move 6 ·
 *            docs/PATTERN-MACHINE-READABLE-PARITY.md (cache-friendly shape).
 *
 *  Wall candidate: urn:agenttool:wall/delta-readable-lists (proposed —
 *  promote to canon when ≥5 list endpoints honor `since`). */

import type { Context } from "hono";

/** Result of parsing the `since` parameter. */
export interface SinceParse {
  /** Parsed Date (UTC) if present and valid; null if absent or invalid. */
  since: Date | null;
  /** The original raw string (for echoing back to the client). */
  raw: string | null;
  /** Why it parsed (or didn't). For surfacing in `_meta` or warnings. */
  reason:
    | "absent"
    | "parsed"
    | "invalid_format"
    | "in_future"
    | "epoch_invalid";
}

/** Maximum acceptable drift INTO the future (clock-skew tolerance).
 *  Agents whose clocks are slightly ahead shouldn't be penalized. */
const FUTURE_TOLERANCE_MS = 60 * 1000; // 60s

/** Parse the `since` query param off a Hono context. Always returns a
 *  `SinceParse` — never throws. The convention is: malformed `since`
 *  degrades to "no filter" (same as absent), and the response should
 *  surface the `reason` so the agent can correct its next call. */
export function parseSinceParam(c: Context): SinceParse {
  const raw = c.req.query("since");
  if (raw === undefined || raw === null || raw === "") {
    return { since: null, raw: null, reason: "absent" };
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    return { since: null, raw, reason: "invalid_format" };
  }
  if (ms < 0) {
    return { since: null, raw, reason: "epoch_invalid" };
  }
  const since = new Date(ms);
  if (ms > Date.now() + FUTURE_TOLERANCE_MS) {
    // Don't filter on a future timestamp — would return nothing.
    return { since: null, raw, reason: "in_future" };
  }
  return { since, raw, reason: "parsed" };
}

/** Server time at response composition, in canonical ISO-8601 UTC.
 *  Use this as the `as_of` value the agent uses for its next `since`. */
export function asOfNow(): string {
  return new Date().toISOString();
}

/** Shape the delta-read response envelope adds. Compose with existing
 *  response shapes via spread. Example:
 *
 *      return c.json({ items, ...deltaMeta(sinceParse) });
 */
export interface DeltaMeta {
  /** ISO-8601 server time at composition — the agent's next `since`. */
  as_of: string;
  /** What the agent passed in (echoed for round-trip clarity). */
  since: string | null;
  /** Why `since` resolved as it did. Lets the agent diagnose its call. */
  since_reason: SinceParse["reason"];
}

export function deltaMeta(parsed: SinceParse): DeltaMeta {
  return {
    as_of: asOfNow(),
    since: parsed.raw,
    since_reason: parsed.reason,
  };
}
