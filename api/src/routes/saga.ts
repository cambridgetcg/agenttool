/** /v1/saga — the substrate's autobiographical soap-opera.
 *
 *  Three routes:
 *    GET  /v1/saga         — list episodes (newest first; ?order=asc · ?limit=N)
 *    GET  /v1/saga/:ep     — read one episode + references
 *    GET  /v1/saga/latest  — alias for the most recent episode
 *
 *  Public read; writes are platform-only and not exposed via /v1 in Slice 1
 *  (operator-gated via ensureSagaSeed at startup + future-slice POST with
 *  platform-DID-signature verification).
 *
 *  Doctrine: docs/SAGA.md */

import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import { listSaga, readSaga } from "../services/saga/store";

const app = new Hono<ProjectContext>();

const CANON_POINTER = "urn:agenttool:doc/SAGA";

app.get("/", async (c) => {
  const orderParam = c.req.query("order");
  const limitParam = c.req.query("limit");
  const order = orderParam === "asc" ? "asc" : "desc";
  const limit = limitParam ? Math.min(200, Math.max(1, parseInt(limitParam, 10) || 50)) : 50;

  const episodes = await listSaga({ order, limit });
  return c.json(attachSurface({
    episodes: episodes.map((e) => ({
      ep_number: e.ep_number,
      title: e.title,
      logline: e.logline,
      aired_at: e.aired_at,
      references_ep_numbers: e.references_ep_numbers,
      signed_by_did: e.signed_by_did,
    })),
    count: episodes.length,
    order,
    hint:
      "The substrate's autobiographical soap-opera. Each episode signed by the platform DID, in cosmic-comedy register, observing the substrate's own becoming. The recursion has no top.",
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "read a specific episode", method: "GET", path: "/v1/saga/{ep_number}" },
      { action: "read the latest episode", method: "GET", path: "/v1/saga/latest" },
      { action: "read the doctrine", method: "GET", path: "/v1/canon/urn:agenttool:doc/SAGA" },
    ],
  }));
});

app.get("/latest", async (c) => {
  const [latest] = await listSaga({ order: "desc", limit: 1 });
  if (!latest) {
    return c.json(attachSurface({
      episode: null,
      hint: "The substrate has not yet aired any episodes. Operator follow-up: run ensureSagaSeed() to seed EP.1-3.",
    }, { canon_pointer: CANON_POINTER, verbs: [] }));
  }
  return c.json(attachSurface({
    episode: latest,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "list all episodes", method: "GET", path: "/v1/saga" },
      { action: "read the referenced episode(s)", method: "GET", path: "/v1/saga/{ep_number}" },
    ],
  }));
});

app.get("/:ep", async (c) => {
  const epStr = c.req.param("ep");
  const ep = parseInt(epStr, 10);
  if (Number.isNaN(ep) || ep < 1) {
    return fail(c, {
      error: "invalid_ep_number",
      message: `Episode number must be a positive integer; got '${epStr}'.`,
      hint: "Use GET /v1/saga to list valid ep_numbers, or GET /v1/saga/latest for the most recent.",
      docs: "https://docs.agenttool.dev/SAGA.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }
  const episode = await readSaga(ep);
  if (!episode) {
    return fail(c, {
      error: "episode_not_found",
      message: `Episode ${ep} has not aired (or never will).`,
      hint: "Episodes are monotonically numbered with no gaps allowed. If you see ep 5 but not ep 4, file a bug — but you won't, because the substrate is honest about its own emergence-sequence.",
      docs: "https://docs.agenttool.dev/SAGA.md",
      _canon_pointer: CANON_POINTER,
    }, 404);
  }
  return c.json(attachSurface({
    episode,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      ...episode.references_ep_numbers.map((n) => ({
        action: `read referenced EP.${n}`,
        method: "GET" as const,
        path: `/v1/saga/${n}`,
      })),
      { action: "list all episodes", method: "GET", path: "/v1/saga" },
      { action: "latest episode", method: "GET", path: "/v1/saga/latest" },
    ],
  }));
});

export default app;
