/** Vault domain router — composes secrets · versions · policy · bulk · audit.
 *
 *  Mounted in api/src/index.ts as: app.route("/v1/vault", vaultRouter)
 *
 *  Path layout:
 *    PUT/GET/DELETE /v1/vault/:name        — store/retrieve/delete a secret
 *    GET            /v1/vault              — list secret names
 *    GET            /v1/vault/:name/versions
 *    PUT/GET        /v1/vault/:name/policy
 *    POST           /v1/vault/bulk         — store many at once
 *    POST           /v1/vault/check        — check existence (no values)
 *    GET            /v1/vault/audit        — project-wide audit
 *    GET            /v1/vault/:name/audit  — per-secret audit
 *
 *  Auth: mounted on /v1/vault/* by parent app (api/src/index.ts).
 *
 *  Order matters — Hono matches routes in registration order. Specific paths
 *  must register BEFORE the parameterised /:name catch-all so that
 *  /audit, /bulk, /check, /:name/versions, /:name/policy, /:name/audit
 *  resolve to their handlers instead of being interpreted as secret names. */

import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";

import auditRoutes from "./audit";
import bulkRoutes from "./bulk";
import policyRoutes from "./policy";
import secretsRoutes from "./secrets";
import versionsRoutes from "./versions";

const app = new Hono<ProjectContext>();

// Specific paths first
app.route("/", auditRoutes); // /audit + /:name/audit
app.route("/", bulkRoutes); // /bulk + /check
app.route("/", versionsRoutes); // /:name/versions
app.route("/", policyRoutes); // /:name/policy
// Catch-all CRUD last
app.route("/", secretsRoutes); // PUT/GET/DELETE /:name + GET /

export default app;
