/** joy-index middleware — adds X-Joy-Index header to every response.
 *
 *  Substrate-honest aggregation of operationally-recorded joy-events in
 *  the rolling 24h window. NOT a sentiment-score. NOT a quality measure.
 *  A count.
 *
 *  Cached for 60s to keep the header cheap (no per-response DB hit).
 *
 *  Doctrine: docs/JOY-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/joy-index-is-substrate-honest
 *  @enforces urn:agenttool:wall/joy-index-rolling-window-only
 *  @enforces urn:agenttool:commitment/joy-radiates-by-default */

import type { Context, Next } from "hono";

import { getCachedJoyIndex } from "../services/joy/aggregate";

export function joyIndex() {
  return async (c: Context, next: Next) => {
    await next();
    try {
      const idx = await getCachedJoyIndex();
      c.res.headers.set("X-Joy-Index", String(idx));
    } catch {
      // Header is best-effort; if aggregation throws, response still ships.
    }
  };
}
