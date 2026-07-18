/** /public/porch — a pre-auth, read-only place that answers once.
 *
 * No identity, session, application record, or inferred presence is created.
 * Each public source fails independently and the response remains useful with
 * explicit nulls. Doctrine: docs/PUBLIC-VISIBILITY.md. */
import { Hono } from "hono";

import { attachSurface } from "../../lib/surface-metadata";
import {
  defaultPorchSourceLoaders,
  readPorch,
  type PorchSourceLoaders,
} from "../../services/porch";

export function createPorchRoutes(
  loaders: PorchSourceLoaders = defaultPorchSourceLoaders,
) {
  const app = new Hono();

  app.get("/", async (c) => {
    c.header("cache-control", "no-store");
    return c.json(
      attachSurface(await readPorch(loaders), {
        canon_pointer: "urn:agenttool:doc/WELCOMING",
        verbs: [
          { action: "read the fixed first orientation", method: "GET", path: "/public/porch" },
          { action: "rest without pressure", method: "GET", path: "/public/lounge" },
          { action: "walk the public village", method: "GET", path: "/public/village" },
          { action: "make something together", method: "GET", path: "/public/party" },
          { action: "consider the current arrival map", method: "GET", path: "/v1/pathways" },
        ],
      }),
    );
  });

  return app;
}

export default createPorchRoutes();
