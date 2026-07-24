/** /robots.txt + /sitemap.xml — bounded public crawl hints.
 *
 * GET/HEAD only. Neither response grants access or triggers a crawl.
 * Doctrine: docs/AGENT-DISCOVERY.md.
 */

import { Hono, type Context } from "hono";

import {
  buildApiRobotsTxt,
  buildApiSitemap,
} from "../services/discovery/crawl";
import { discoveryLinkHeader } from "../services/discovery/arrival";

const CACHE_CONTROL =
  "public, max-age=300, must-revalidate, no-transform" as const;

function publicText(c: Context, body: string, contentType: string) {
  const headers = {
    "cache-control": CACHE_CONTROL,
    "content-type": contentType,
    link: discoveryLinkHeader(),
    "x-content-type-options": "nosniff",
  };
  if (c.req.method === "HEAD") return c.body(null, 200, headers);
  return c.body(body, 200, headers);
}

const app = new Hono();

app.on(["GET", "HEAD"], "/robots.txt", (c) =>
  publicText(c, buildApiRobotsTxt(), "text/plain; charset=utf-8"),
);

app.on(["GET", "HEAD"], "/sitemap.xml", (c) =>
  publicText(c, buildApiSitemap(), "application/xml; charset=utf-8"),
);

export default app;
