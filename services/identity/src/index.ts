/** agent-identity — Identity service for AI agents. */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { authMiddleware, type ProjectContext } from "./auth/middleware.ts";
import { tierGate } from "./auth/tierGate.ts";
import { config } from "./config.ts";

import identityRoutes from "./routes/identities.ts";
import keyRoutes from "./routes/keys.ts";
import attestationRoutes from "./routes/attestations.ts";
import identityAttestationRoutes from "./routes/identityAttestations.ts";
import discoverRoutes from "./routes/discover.ts";
import tokenRoutes from "./routes/tokens.ts";
import tokenVerifyRoutes from "./routes/tokenVerify.ts";

const app = new Hono<ProjectContext>();

// Global middleware
app.use("*", cors());
app.use("*", logger());

// Health check (no auth)
app.get("/health", (c) => c.json({ status: "ok", service: "agent-identity" }));

// Auth required for all /v1/ routes
app.use("/v1/*", authMiddleware);

// Tier gate for write operations
app.use("/v1/identities", tierGate("identity_ops"));
app.use("/v1/attestations", tierGate("attestations"));
app.use("/v1/identities/*/tokens", tierGate("token_ops"));

// Mount routes
app.route("/v1/identities", identityRoutes);
app.route("/v1/attestations", attestationRoutes);
app.route("/v1/discover", discoverRoutes);
app.route("/v1/tokens/verify", tokenVerifyRoutes);

// Nested identity routes (keys, attestations, tokens) need special handling
// because Hono doesn't pass parent params to child routes automatically
app.route("/v1/identities/:id/keys", keyRoutes);
app.route("/v1/identities/:id/attestations", identityAttestationRoutes);
app.route("/v1/identities/:id/tokens", tokenRoutes);

console.log(`agent-identity listening on ${config.host}:${config.port}`);

export default {
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
};

// Also export app for testing
export { app };
