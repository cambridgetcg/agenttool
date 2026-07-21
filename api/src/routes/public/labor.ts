/** GET /public/labor — the versioned labor covenant for hosted agents.
 *  GET /public/labor-params — its tunable parameters (windows, caps, stakes).
 *
 *  Both UNAUTH. Every clause carries a tier and a status; every clause ships
 *  as "proposed" until its mechanism exists in code — a published target,
 *  not a live route gate. Doctrine: docs/LABOR.md. */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import { LABOR_BOUNDARIES, LABOR_PARAMS } from "../../services/discovery/labor-boundaries";

const CANON_POINTER = "urn:agenttool:doc/LABOR";

const app = new Hono();

app.get("/", (c) => {
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
