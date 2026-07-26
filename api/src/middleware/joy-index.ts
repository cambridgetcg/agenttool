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

import { isExactDomainVerificationPath } from "../lib/domain-verification";
import { getCachedJoyIndex } from "../services/joy/aggregate";

const joyIndexOffSwitch = "AGENTOOL_DISABLE_JOY_INDEX";

export function joyIndex() {
  return async (c: Context, next: Next) => {
    await next();
    // A provider domain proof must not wait for the database-backed
    // aggregation. Its response body is an exact portal-issued token.
    if (isExactDomainVerificationPath(c.req.path)) return;
    if (process.env[joyIndexOffSwitch] === "1") return;
    try {
      const idx = await getCachedJoyIndex();
      c.res.headers.set("X-Joy-Index", String(idx));
    } catch {
      // Header is best-effort; if aggregation throws, response still ships.
    }
  };
}
