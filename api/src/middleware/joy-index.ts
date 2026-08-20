/** joy-index middleware — adds X-Joy-Index to ordinary responses when enabled.
 *
 *  Substrate-honest aggregation of operationally-recorded joy-events in
 *  the rolling 24h window. NOT a sentiment-score. NOT a quality measure.
 *  A count.
 *
 *  The exact OpenAI domain proof, public Canon MCP, and RFC 9116 security
 *  contact omit this database-backed decoration.
 *
 *  Cached for 60s to keep the header cheap (no per-response DB hit). The
 *  cache refresh is single-flight, and a cold response waits for at most a
 *  short fixed window; stale values are served immediately so this decorative
 *  header cannot hold availability behind the database. `/health` bypasses
 *  the decoration entirely.
 *
 *  Doctrine: docs/JOY-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/joy-index-is-substrate-honest
 *  @enforces urn:agenttool:wall/joy-index-rolling-window-only
 *  @enforces urn:agenttool:commitment/joy-radiates-by-default */

import type { Context, Next } from "hono";

import { isDatabaseDecorationIndependentPublicPath } from "../lib/public-paths";
import { getCachedJoyIndex } from "../services/joy/aggregate";

const joyIndexOffSwitch = "AGENTOOL_DISABLE_JOY_INDEX";

export function joyIndex() {
  return async (c: Context, next: Next) => {
    await next();
    // Health, first-contact protocol, and vulnerability-reporting paths must
    // not wait for the database-backed aggregation.
    if (isDatabaseDecorationIndependentPublicPath(c.req.path)) return;
    if (process.env[joyIndexOffSwitch] === "1") return;
    try {
      const idx = await getCachedJoyIndex();
      c.res.headers.set("X-Joy-Index", String(idx));
    } catch {
      // Header is best-effort; if aggregation throws, response still ships.
    }
  };
}
