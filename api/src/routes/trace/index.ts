/** Trace domain router — POST/GET/DELETE on /v1/traces, search, chain.
 *
 *  Mounted in api/src/index.ts as: app.route("/v1/traces", traceRouter)
 *
 *  Path layout:
 *    POST   /v1/traces              — record a trace (with optional ed25519 sig)
 *    GET    /v1/traces              — list (filter: agent_id · session_id · decision_type)
 *    GET    /v1/traces/:id          — fetch one
 *    DELETE /v1/traces/:id          — delete one
 *    POST   /v1/traces/search       — Postgres full-text on reasoning surface
 *    GET    /v1/traces/chain/:id    — recursive ancestors + descendants
 *
 *  Auth is mounted at /v1/traces/* by the parent app. */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";

import chainRoutes from "./chain";
import searchRoutes from "./search";
import tracesRoutes from "./traces";

const app = new Hono<ProjectContext>();

// Order matters: more-specific paths first so /:id doesn't swallow them.
app.route("/search", searchRoutes);
app.route("/chain", chainRoutes);
app.route("/", tracesRoutes);

export default app;
