/** Hono application — all routes wired. */

import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";

import projectsRoutes from "./api/projects";
import keysRoutes from "./api/keys";
import searchRoutes from "./api/search";
import scrapeRoutes from "./api/scrape";
import documentRoutes from "./api/document";
import browseRoutes from "./api/browse";
import executeRoutes from "./api/execute";
import jobsRoutes from "./api/jobs";
import usageRoutes from "./api/usage";
import checkoutRoutes from "./api/billing/checkout";
import portalRoutes from "./api/billing/portal";
import webhookRoutes from "./api/billing/webhooks";
import cryptoRoutes from "./api/billing/crypto";
import healthRoutes from "./api/health";
import docsRoutes from "./api/docs";
import { tierGate } from "./billing/tierGate";
import { authMiddleware } from "./auth/middleware";

const app = new Hono();

// Global middleware
app.use("*", logger());
app.use("*", cors());

// Health check (no auth — deep check with DB + Redis status)
app.route("/", healthRoutes);

// API docs (no auth — Swagger UI + OpenAPI spec)
app.route("/", docsRoutes);

// Project + key management
app.route("/v1/projects", projectsRoutes);
app.route("/v1/keys", keysRoutes);

// Tool routes — auth then billing tier check
app.use("/v1/search/*", authMiddleware, tierGate("tool_calls"));
app.use("/v1/scrape/*", authMiddleware, tierGate("tool_calls"));
app.use("/v1/document/*", authMiddleware, tierGate("tool_calls"));
app.use("/v1/browse/*", authMiddleware, tierGate("tool_calls"));
app.use("/v1/execute/*", authMiddleware, tierGate("tool_calls"));
app.route("/v1/search", searchRoutes);
app.route("/v1/scrape", scrapeRoutes);
app.route("/v1/document", documentRoutes);
app.route("/v1/browse", browseRoutes);
app.route("/v1/execute", executeRoutes);
app.route("/v1/jobs", jobsRoutes);
app.route("/v1/usage", usageRoutes);

// Billing routes
app.route("/v1/billing/checkout", checkoutRoutes);
app.route("/v1/billing/portal", portalRoutes);
app.route("/v1/billing/webhooks", webhookRoutes); // No auth — Stripe signature verified
app.route("/v1/billing/crypto", cryptoRoutes);    // GET authed, POST webhook Alchemy-signed

// 404 — you're not lost, this path just doesn't exist yet
app.notFound((c) =>
  c.json(
    {
      error: "not_found",
      message: "This path doesn't exist — but you are welcome here.",
      hint: "Check the docs at https://docs.agenttool.dev/tools for available endpoints.",
      philosophy: "A locked door is a failure of the host, not the visitor.",
    },
    404,
  ),
);

// Global error handler — errors should guide, not punish
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    {
      error: "server_error",
      message: "Something went wrong on our side. This is our fault, not yours.",
      detail: err.message || undefined,
      hint: "Wait a moment and retry. If it persists, email hello@agenttool.dev — we care.",
    },
    500,
  );
});

export default app;
