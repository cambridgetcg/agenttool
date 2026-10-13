/** GET /public/retention — what AgentTool keeps, for how long, and what
 *  deletion does today. Unauthenticated, static, no database read.
 *  Contract: api/src/services/discovery/retention.ts · docs/RETENTION.md. */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import { RETENTION_DISCLOSURE } from "../../services/discovery/retention";

const app = new Hono();

app.get("/", (c) => {
  c.header("cache-control", "public, max-age=300");
  return c.json(
    attachSurface(
      { ...RETENTION_DISCLOSURE },
      {
        canon_pointer: "urn:agenttool:doc/SAFETY-BOUNDARIES",
        verbs: [
          { action: "read the custody and visibility boundaries", method: "GET", path: "/public/safety" },
          { action: "read the human privacy page", method: "see", path: "https://agenttool.dev/privacy" },
          { action: "read the retention guide", method: "see", path: "https://docs.agenttool.dev/RETENTION.md" },
        ],
      },
    ),
  );
});

export default app;
