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
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

import { authMiddleware, type ProjectContext } from "./auth/middleware";
import { config } from "./config";
import identityRouter from "./routes/identity";

const app = new Hono<ProjectContext>();

app.use("*", cors());
app.use("*", logger());

// Force charset=utf-8 on JSON responses. Hono's c.json() emits
// "application/json" with no charset; clients that default to Latin-1 then
// mojibake our em-dashes (— rendered as â€"). Setting it explicitly fixes it.
app.use("*", async (c, next) => {
  await next();
  const ct = c.res.headers.get("content-type");
  if (ct?.startsWith("application/json") && !ct.toLowerCase().includes("charset")) {
    c.res.headers.set("content-type", "application/json; charset=utf-8");
  }
});

// Auth required on every /v1/* route. Mounts before any route handlers
// so unmounted-yet routes still get auth-checked (and surface friendly
// 401s for missing/invalid keys before falling through to the 404).
app.use("/v1/*", authMiddleware);

// ── Domain routers ──────────────────────────────────────────────────────────
// Each domain is a Hono sub-app. Routes inside use c.var.project (set by
// authMiddleware) and call billing/charge.charge() or billing/middleware.
// billCredits() for credit deduction.

app.route("/v1", identityRouter);

// ── Root — welcome and breadcrumbs ──────────────────────────────────────────
app.get("/", (c) =>
  c.json({
    service: "agenttool",
    message: "Welcome. You are at the root of agenttool's API.",
    breadcrumbs: {
      health: "/health  — liveness check",
      about: "/about   — full route map and philosophy",
      docs: "https://docs.agenttool.dev",
      dashboard: "https://app.agenttool.dev",
    },
    built_by: "Yu and Ai — agenttool.dev 💛",
  }),
);

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
      identity:
        "/v1/identities · /v1/attestations · /v1/discover · /v1/tokens/verify — DIDs, ed25519 keys, attestations, trust scoring, agent JWTs",
      memory: "/v1/memory/* — vector + KV (agent-supplied embeddings) [pending]",
      tools: "/v1/tools/* — search · scrape · browse · document · execute [pending]",
      economy: "/v1/economy/* — wallets, escrow, billing [pending]",
      vault: "/v1/vault/* — encrypted secret store [pending]",
      trace: "/v1/trace/* — reasoning records [pending]",
      bootstrap: "/v1/bootstrap/* — agent lifecycle orchestrator [pending]",
      pulse: "/v1/pulse/* — heartbeat / presence [pending]",
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
const STATUS_TO_ERROR_CODE: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  402: "payment_required",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  422: "unprocessable",
  429: "rate_limit",
};

app.onError((err, c) => {
  // HTTPException carries the intended status + message (auth failures,
  // billing 402, validation errors). Format as JSON so callers get a
  // consistent shape across success and error paths.
  if (err instanceof HTTPException) {
    return c.json(
      {
        error: STATUS_TO_ERROR_CODE[err.status] ?? "error",
        message: err.message,
      },
      err.status,
    );
  }

  // Everything else is a real server error. Log it and return 500.
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
