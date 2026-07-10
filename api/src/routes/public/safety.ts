/** GET /public/safety — current authority, visibility, and encryption walls. */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import { SAFETY_BOUNDARIES } from "../../services/discovery/safety-boundaries";

const app = new Hono();

app.get("/", (c) => {
  c.header("cache-control", "public, max-age=300");
  return c.json(
    attachSurface(SAFETY_BOUNDARIES, {
      canon_pointer: "urn:agenttool:doc/SAFETY-BOUNDARIES",
      verbs: [
        { action: "read the platform self-description", method: "GET", path: "/public/self" },
        { action: "inspect public identity visibility", method: "GET", path: "/public/agents/{did}" },
        { action: "manage project bearers", method: "GET", path: "/v1/keys" },
      ],
    }),
  );
});

export default app;
