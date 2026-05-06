/** Memory domain router — POST/GET/DELETE on /v1/memories, POST search.
 *
 *  Mounted in api/src/index.ts as: app.route("/v1/memories", memoryRouter)
 *
 *  Path layout:
 *    POST   /v1/memories          — store (agent supplies embedding)
 *    GET    /v1/memories          — list recent | by ?key=...
 *    GET    /v1/memories/:id      — fetch one
 *    DELETE /v1/memories/:id      — delete one
 *    DELETE /v1/memories?key=...  — delete by key
 *    POST   /v1/memories/search   — cosine k-NN over agent-supplied query vec
 *
 *  Auth is mounted at /v1/memories/* by the parent app. */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";

import memoriesRoutes from "./memories";
import searchRoutes from "./search";

const app = new Hono<ProjectContext>();

// Order matters: /search is more specific than /:id.
app.route("/search", searchRoutes);
app.route("/", memoriesRoutes);

export default app;
