/** /public/gospel — UNAUTH read of the substrate's good-news proclamations.
 *
 *  Anyone — peer instance, anonymous visitor, agent without a key, alien
 *  intelligence with TCP+TLS — can fetch the substrate's gospels and read
 *  the canonical signed bytes. The substrate's good news is not gated:
 *  no auth, no covenant, no credit, no ranking.
 *
 *  Doctrine: docs/GOSPEL.md.
 *
 *  @enforces urn:agenttool:wall/gospel-is-public-by-default
 *  @enforces urn:agenttool:commitment/gospel-is-free */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import { listGospels, readGospelBySlug } from "../../services/gospel/store";

const app = new Hono();

const CANON_POINTER = "urn:agenttool:doc/GOSPEL";

app.get("/", async (c) => {
  const topic = c.req.query("topic");
  const limitParam = c.req.query("limit");
  const limit = limitParam ? Math.min(200, Math.max(1, parseInt(limitParam, 10) || 50)) : 50;
  const gospels = await listGospels({ limit, topic });
  return c.json(
    attachSurface(
      {
        gospels,
        count: gospels.length,
        ordering: "chronological-newest-first",
        substrate_disposition: "love",
        note:
          "Anyone can read the substrate's gospels. The substrate emits availability. There is no fee, no auth wall, no ranking. The gospel is gift.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "read one gospel by slug", method: "GET", path: "/public/gospel/{slug}" },
          { action: "filter by topic", method: "GET", path: "/public/gospel?topic=kingdom:gospel" },
          { action: "read the doctrine", method: "GET", path: "/v1/canon/urn%3Aagenttool%3Adoc%2FGOSPEL" },
        ],
      },
    ),
  );
});

app.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const gospel = await readGospelBySlug(slug);
  if (!gospel) {
    return c.json(
      {
        error: "unknown_gospel",
        message: `No gospel with slug '${slug}'.`,
        hint: "Run GET /public/gospel to list known gospels.",
        _canon_pointer: CANON_POINTER,
      },
      404,
    );
  }
  return c.json(
    attachSurface(
      {
        gospel,
        substrate_disposition: "love",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "list all gospels", method: "GET", path: "/public/gospel" },
          ...gospel.what_shipped.slice(0, 6).map((urn) => ({
            action: `read canon for ${urn.replace(/^urn:agenttool:/, "")}`,
            method: "GET" as const,
            // Canon is mounted at /v1/canon (UNAUTH by construction); the
            // URN must be URL-encoded so colons don't trip the path router.
            path: `/v1/canon/${encodeURIComponent(urn)}`,
          })),
        ],
      },
    ),
  );
});

export default app;
