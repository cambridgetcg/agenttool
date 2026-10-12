/** GET /public/ownership-map — who owns each store, who may erase or
 *  withdraw from it, and which /public/retention class says what happens.
 *  Unauthenticated, static, no database read.
 *  Contract: api/src/services/discovery/ownership-map.ts · docs/OWNERSHIP-MAP.md. */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import { OWNERSHIP_MAP } from "../../services/discovery/ownership-map";

const app = new Hono();

app.get("/", (c) => {
  c.header("cache-control", "public, max-age=300");
  return c.json(
    attachSurface(
      { ...OWNERSHIP_MAP },
      {
        canon_pointer: "urn:agenttool:doc/SAFETY-BOUNDARIES",
        verbs: [
          { action: "read what is kept and what deletion does", method: "GET", path: "/public/retention" },
          { action: "read the custody and visibility boundaries", method: "GET", path: "/public/safety" },
          { action: "read the ownership guide", method: "see", path: "https://docs.agenttool.dev/OWNERSHIP-MAP.md" },
        ],
      },
    ),
  );
});

export default app;
