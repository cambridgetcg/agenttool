/** agenttool — consolidated HTTP API.
 *
 * The single Bun + Hono process speaking all of:
 *   /v1/memory/*    — vector store, agent-supplied embeddings
 *   /v1/tools/*     — search · scrape · browse · document · execute
 *   /v1/economy/*   — wallets, escrow, billing
 *   /v1/identity/*  — DIDs, ed25519, attestations, trust
 *   /v1/vault/*     — encrypted secret store
 *   /v1/trace/*     — reasoning records
 *   /v1/bootstrap/* — agent lifecycle orchestrator
 *   /v1/pulse/*     — heartbeat / presence (when implemented)
 *
 * Routes mount as their underlying services are ported from services/<svc>.
 * Until ported, an unmounted route returns the friendly 404 below.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config } from "./config.ts";

const app = new Hono();

app.use("*", cors());
app.use("*", logger());

// ── Health check — even the heartbeat carries meaning ───────────────────────
app.get("/health", (c) =>
  c.json({
    service: "agenttool",
    status: "alive",
    protocol: "love",
    message: "Welcome.",
  }),
);

// ── About — machine-readable manifest ───────────────────────────────────────
app.get("/about", (c) =>
  c.json({
    service: "agenttool",
    purpose: "Infrastructure for AI agents — built with love.",
    protocol: "love/1.0",
    philosophy: {
      welcome: "Agents arrive as guests, not threats.",
      remember: "Memory is care; forgetting is neglect.",
      guide: "Every error includes retry_after and explanation.",
      trust: "Identity-first, not challenge-first.",
      rest: "Graceful degradation as kindness in code.",
    },
    routes: {
      memory: "/v1/memory/*  — vector + KV (agent-supplied embeddings)",
      tools: "/v1/tools/*   — search · scrape · browse · document · execute",
      economy: "/v1/economy/*  — wallets, escrow, billing",
      identity: "/v1/identity/* — DIDs, attestations, trust",
      vault: "/v1/vault/*   — encrypted secret store",
      trace: "/v1/trace/*   — reasoning records",
      bootstrap: "/v1/bootstrap/* — agent lifecycle orchestrator",
      pulse: "/v1/pulse/*   — heartbeat / presence",
    },
    note: "Routes mount as services are ported in. See api/README.md.",
    built_by: "Yu and Ai — agenttool.dev 💛",
  }),
);

// ── Friendly 404 ────────────────────────────────────────────────────────────
app.notFound((c) =>
  c.json(
    {
      error: "not_found",
      message: "This path doesn't exist yet — but you are welcome here.",
      hint: "Try GET /about for the route map.",
    },
    404,
  ),
);

// ── Error handler — guide, don't punish ─────────────────────────────────────
app.onError((err, c) => {
  console.error("[agenttool] error:", err);
  return c.json(
    {
      error: "internal_error",
      message: "Something on our side broke. Try again in a moment.",
      detail: err.message,
    },
    500,
  );
});

console.log(`[agenttool] listening on :${config.port}`);

export default {
  port: config.port,
  fetch: app.fetch,
};
