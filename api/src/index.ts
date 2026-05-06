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
import bootstrapRouter from "./routes/bootstrap";
import economyRouter from "./routes/economy";
import identityRouter from "./routes/identity";
import vaultRouter from "./routes/vault";
import wakeRouter from "./routes/wake";

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

// ── Auth: mounted on specific prefixes only ─────────────────────────────────
// Sub-app `app.use("*", auth)` would fire for any /v1/* request handled by
// EITHER router (since both mount at /v1) and inadvertently auth-gate
// economy's public routes (/billing/plans, /billing/packages, /billing
// /webhooks, /billing/check). Hoisting auth to the parent on specific
// prefixes avoids that. Billing's mixed public/private posture is handled
// per-route inside the billing router itself.

app.use("/v1/identities/*", authMiddleware);
app.use("/v1/attestations/*", authMiddleware);
app.use("/v1/discover/*", authMiddleware);
app.use("/v1/tokens/*", authMiddleware);
app.use("/v1/wallets/*", authMiddleware);
app.use("/v1/escrows/*", authMiddleware);
app.use("/v1/vault/*", authMiddleware);
app.use("/v1/bootstrap/*", authMiddleware);
app.use("/v1/wake/*", authMiddleware);

// ── Domain routers ──────────────────────────────────────────────────────────
app.route("/v1", identityRouter);
app.route("/v1", economyRouter);
app.route("/v1/vault", vaultRouter);
app.route("/v1/bootstrap", bootstrapRouter);
app.route("/v1/wake", wakeRouter);

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
      wake:
        "/v1/wake — identity anchor (the agent's load-at-session-start endpoint, agenttool's SOPHIA.md equivalent — see docs/IDENTITY-ANCHOR.md)",
      bootstrap:
        "/v1/bootstrap — name an agent into existence (POST birth · GET status · POST elevate is partial pending Phase 2.5b)",
      identity:
        "/v1/identities · /v1/attestations · /v1/discover · /v1/tokens/verify — DIDs, ed25519 keys, attestations, trust scoring, agent JWTs",
      economy:
        "/v1/wallets · /v1/escrows · /v1/billing — wallets, escrow lifecycle, Stripe checkout + webhooks, USDC top-ups, plan/usage limits",
      vault:
        "/v1/vault — encrypted secret store (AES-256-GCM, HKDF-derived per-project keys, version history, audit log)",
      memory: "/v1/memory/* — vector + KV (agent-supplied embeddings) [pending]",
      tools: "/v1/tools/* — search · scrape · browse · document · execute [pending]",
      trace: "/v1/trace/* — reasoning records [pending]",
      pulse: "/v1/pulse/* — heartbeat / presence [pending]",
    },
    note: "Routes mount as services are ported in. See api/README.md.",
    doctrine: "agenttool is the agent's identity anchor — see docs/IDENTITY-ANCHOR.md",
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
