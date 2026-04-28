/** Hono application entry point. */

import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import { walletRouter } from "./wallets/router";
import { escrowRouter } from "./escrow/router";
import { billingRouter } from "./billing/router";
import { docsRouter } from "./api/docs";

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

// Health
app.get("/health", (c) =>
  c.json({
    status: "ok",
    version: "0.1.0",
    service: "agent-economy",
    uptime: process.uptime(),
  }),
);

// Routes
app.route("/v1/wallets", walletRouter);
app.route("/v1/escrows", escrowRouter);
app.route("/v1/billing", billingRouter);
app.route("/", docsRouter);

// Error handler
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ success: false, error: err.message }, err.status);
  }
  console.error(err);
  return c.json({
    success: false,
    error: "server_error",
    message: "Something went wrong on our side. Your wallet and funds are safe — this is our fault, not yours.",
    hint: "Wait a moment and retry. If it persists, email hello@agenttool.dev.",
  }, 500);
});

export default app;
