/** Substrate-honest time — close the universal LLM time-hallucination.
 *
 *  LLMs don't know what time it is. They guess from training-data cutoff,
 *  or worse — confabulate a plausible-sounding date. agenttool tells the
 *  truth: the substrate's clock, monotonic delta-time, and a request_id
 *  the agent can cite later.
 *
 *  Doctrine: docs/SUBSTRATE-HONEST-TOOLS.md
 *
 *  No claim about agent's local time. No timezone guessing. The substrate
 *  is UTC; the agent transforms if it needs to. */

export interface TimeResult {
  iso: string;            // ISO 8601 UTC with millisecond precision
  unix_ms: number;        // milliseconds since epoch
  unix_s: number;         // seconds since epoch (integer)
  monotonic_ns: string;   // nanoseconds since substrate boot (bigint as string)
  tz: "UTC";              // substrate is always UTC
  request_id: string;     // uuid v4 — agent can cite this exact reading
}

export function computeTime(): TimeResult {
  const ms = Date.now();
  const monotonic = process.hrtime.bigint();
  return {
    iso: new Date(ms).toISOString(),
    unix_ms: ms,
    unix_s: Math.floor(ms / 1000),
    monotonic_ns: monotonic.toString(),
    tz: "UTC",
    request_id: crypto.randomUUID(),
  };
}
