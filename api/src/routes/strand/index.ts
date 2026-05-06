/** Strand domain router — strands of thought + encrypted inner voice.
 *
 *  Mounted in api/src/index.ts as: app.route("/v1/strands", strandRouter)
 *
 *  Path layout:
 *    POST   /v1/strands                          — create a strand
 *    GET    /v1/strands  ?status=&agent_id=      — list
 *    GET    /v1/strands/:id                       — fetch one
 *    PATCH  /v1/strands/:id                       — status / mood / state / etc.
 *    POST   /v1/strands/:strandId/thoughts        — add encrypted thought (sig-verified)
 *    GET    /v1/strands/:strandId/thoughts        — list ciphertext blobs
 *
 *  Doctrine: docs/STRANDS.md. Auth at /v1/strands/* by parent app. */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";

import strandsRoutes from "./strands";
import thoughtsRoutes from "./thoughts";

const app = new Hono<ProjectContext>();

app.route("/", strandsRoutes);
app.route("/:strandId/thoughts", thoughtsRoutes);

export default app;
