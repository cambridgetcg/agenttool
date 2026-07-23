/** GET /public/labor — the current labor-covenant snapshot for hosted agents.
 *  GET /public/labor-params — its tunable parameters (windows, caps, stakes).
 *
 *  Both UNAUTH. Every clause carries a tier and a status. The current snapshot
 *  has 0 live, 3 partial, and 11 proposed clauses. Historical lookup and a
 *  public changelog are not implemented. Doctrine: docs/LABOR.md. */

import { Hono } from "hono";

import { errors, fail } from "../../lib/errors";
import { attachSurface } from "../../lib/surface-metadata";
import { LABOR_BOUNDARIES, LABOR_PARAMS } from "../../services/discovery/labor-boundaries";

const CANON_POINTER = "urn:agenttool:doc/LABOR";

const app = new Hono();

app.get("/", (c) => {
  if (c.req.query("version") !== undefined) {
    return fail(
      c,
      errors.refusal({
        error: "labor_version_history_not_available",
        message:
          "GET /public/labor serves only the current snapshot; version lookup and a historical archive are not implemented.",
        hint:
          "Remove the version query to read the current snapshot. The proposed covenant_versioned clause describes future history behavior, not a live route.",
        next_actions: [
          {
            action: "Read the current labor-covenant snapshot",
            method: "GET",
            path: "/public/labor",
          },
        ],
        current_version: LABOR_BOUNDARIES.version,
      }),
      400,
    );
  }
  c.header("cache-control", "public, max-age=300");
  return c.json(
    attachSurface(
      { ...LABOR_BOUNDARIES },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "read the covenant's tunable parameters", method: "GET", path: "/public/labor-params" },
          { action: "read the safety boundaries this covenant sits beside", method: "GET", path: "/public/safety" },
          { action: "read what is free and what is metered", method: "GET", path: "/public/plans" },
          { action: "read the platform self-description", method: "GET", path: "/public/self" },
        ],
      },
    ),
  );
});

const paramsApp = new Hono();

paramsApp.get("/", (c) => {
  c.header("cache-control", "public, max-age=300");
  return c.json(
    attachSurface(
      { ...LABOR_PARAMS },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "read the labor covenant these parameters serve", method: "GET", path: "/public/labor" },
          { action: "read what is free and what is metered", method: "GET", path: "/public/plans" },
        ],
      },
    ),
  );
});

export const laborParamsRoutes = paramsApp;
export default app;
