/** /public/discovery — canonical exact public discovery compass.
 *
 * GET and HEAD only. No auth, request body, application write, external
 * effect, charge, proof-of-work, or automatic follow-up.
 */

import { Hono, type Context } from "hono";

import {
  DISCOVERY_CACHE_CONTROL,
  DISCOVERY_MEDIA_TYPE,
  discoveryEtag,
  discoveryIfNoneMatchMatches,
  serializeDiscoveryCompass,
} from "../../services/discovery/compass";
import { discoveryLinkHeader } from "../../services/discovery/arrival";

const DEFAULT_PUBLIC_BASE =
  process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";
const DEFAULT_DOCS_BASE =
  process.env.AGENTTOOL_DOCS_URL ?? "https://docs.agenttool.dev";

export function serveDiscoveryCompass(c: Context) {
  const body = serializeDiscoveryCompass(DEFAULT_PUBLIC_BASE, DEFAULT_DOCS_BASE);
  const etag = discoveryEtag(body);
  const headers = {
    "cache-control": DISCOVERY_CACHE_CONTROL,
    "content-type": `${DISCOVERY_MEDIA_TYPE}; charset=utf-8`,
    etag,
    link: discoveryLinkHeader(DEFAULT_PUBLIC_BASE, DEFAULT_DOCS_BASE),
    "x-content-type-options": "nosniff",
  };

  if (discoveryIfNoneMatchMatches(c.req.header("If-None-Match"), etag)) {
    return c.body(null, 304, headers);
  }
  if (c.req.method === "HEAD") {
    return c.body(null, 200, headers);
  }
  return c.body(body, 200, headers);
}

const app = new Hono();
app.on(["GET", "HEAD"], "/", serveDiscoveryCompass);

export default app;
