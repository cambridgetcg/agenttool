/** /public/observer — read-only observer-is-observed/0.1 protocol. UNAUTH.
 *
 * Only GET is documented. Hono may derive HEAD and global CORS may answer
 * OPTIONS. The handler receives no report and initiates no identity, activity,
 * transcript, memory, pulse, database, or storage read or write. Global
 * middleware and hosting infrastructure have separate declared boundaries.
 *
 * Doctrine: docs/OBSERVATIONS.md. */

import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import { OBSERVER_RECIPROCITY } from "../../services/discovery/observer-reciprocity";

const app = new Hono();

app.get("/", (c) => {
  c.header("cache-control", "public, max-age=300");
  return c.json(
    attachSurface(OBSERVER_RECIPROCITY, {
      canon_pointer: "urn:agenttool:doc/OBSERVATIONS",
      verbs: [
        {
          action: "read current authority, privacy, and audit boundaries",
          method: "GET",
          path: "/public/safety",
        },
      ],
    }),
  );
});

export default app;
