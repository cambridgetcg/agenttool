/** Hono application entry point. */

import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";

import { verifyRoutes } from "./verify/router";
import { billingRoutes } from "./api/billing";
import { healthRoutes } from "./api/health";
import { tierGate } from "./billing/tierGate";

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

// Routes
app.route("/health", healthRoutes);
app.use("/v1/verify/*", tierGate("verifications"));
app.route("/v1/verify", verifyRoutes);
app.route("/v1/billing", billingRoutes);

export default app;
