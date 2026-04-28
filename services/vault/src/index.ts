/** agent-vault — encrypted secrets manager for AI agents. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { config } from "./config.ts";
import { authMiddleware, type ProjectContext } from "./auth/middleware.ts";
import secretsRoutes from "./routes/secrets.ts";
import versionsRoutes from "./routes/versions.ts";
import policyRoutes from "./routes/policy.ts";
import auditRoutes from "./routes/audit.ts";
import bulkRoutes from "./routes/bulk.ts";

const app = new Hono();

// Health check (unauthenticated)
app.get("/health", (c) => c.json({ service: "agent-vault", status: "ok" }));

// All /v1/vault routes require auth
const vault = new Hono<ProjectContext>();
vault.use("*", authMiddleware);

// Mount routes — order matters: specific paths before parameterized
// /v1/vault/audit (project-wide audit) must come before /:name
vault.route("/", auditRoutes);
// /v1/vault/bulk and /v1/vault/check
vault.route("/", bulkRoutes);
// /v1/vault/:name/versions
vault.route("/", versionsRoutes);
// /v1/vault/:name/policy
vault.route("/", policyRoutes);
// /v1/vault/:name (CRUD + list)
vault.route("/", secretsRoutes);

app.route("/v1/vault", vault);

// Global error handler
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  // Zod validation errors
  if (err.name === "ZodError") {
    return c.json({ error: "Validation error", details: (err as any).issues }, 400);
  }
  console.error("Unhandled error:", err.message, err.stack?.split('\n').slice(0,3).join(' | '));
  return c.json({
    error: "server_error",
    message: "Something went wrong on our side. Your secrets are still safe — this is our fault, not yours.",
    hint: "Wait a moment and retry. If it persists, email hello@agenttool.dev.",
  }, 500);
});

console.log(`agent-vault listening on ${config.host}:${config.port}`);

export default {
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
};
