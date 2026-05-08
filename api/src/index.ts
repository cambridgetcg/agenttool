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

import type { Server } from "bun";
import { Hono } from "hono";
import type { BridgeWsData } from "./services/runtime/bridge-hub";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { ZodError } from "zod";

import { authMiddleware, type ProjectContext } from "./auth/middleware";
import { config } from "./config";
import { idempotency } from "./middleware/idempotency";
import { rateLimitHeaders } from "./middleware/rate-limit-headers";
import adaptersRouter from "./routes/adapters";
import dashboardRouter from "./routes/dashboard";
import federationRouter from "./routes/federation";
import federationAdminRouter from "./routes/federation-admin";
import bootstrapRouter from "./routes/bootstrap";
import continuityRouter from "./routes/continuity";
import economyRouter, { cryptoWebhookRouter } from "./routes/economy";
import identityBackupRouter from "./routes/identity-backup";
import identityRouter from "./routes/identity";
import inboxRouter from "./routes/inbox";
import memoryRouter from "./routes/memory";
import openapiRouter from "./routes/openapi";
import publicRouter from "./routes/public";
import registerRouter from "./routes/register";
import runtimeRouter from "./routes/runtime";
import scaffoldRouter from "./routes/scaffold";
import orgsRouter, { invitationsRouter } from "./routes/orgs";
import strandRouter from "./routes/strand";
import listingsRouter, { invocationsRouter } from "./routes/listings";
import templatesRouter, { adoptionRouter } from "./routes/templates";
import traceRouter from "./routes/trace";
import toolsRouter from "./routes/tools";
import vaultRouter from "./routes/vault";
import wakeRouter from "./routes/wake";
import { tryBridgeUpgrade } from "./routes/runtime/bridge";
import { bridgeWebsocket } from "./services/runtime/bridge-hub";
import { startThinkWorker } from "./services/runtime/think-worker";
import { startBrowseWorker } from "./services/tools/queue/browse-worker";

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
app.use("/v1/dashboard/*", authMiddleware);
app.use("/v1/chronicle/*", authMiddleware);
app.use("/v1/covenants/*", authMiddleware);
app.use("/v1/identity/backup/*", authMiddleware);
app.use("/v1/adapters/*", authMiddleware);
app.use("/v1/memories/*", authMiddleware);
app.use("/v1/traces/*", authMiddleware);
app.use("/v1/strands/*", authMiddleware);
app.use("/v1/inbox/*", authMiddleware);
app.use("/v1/runtimes/*", authMiddleware);
app.use("/v1/templates/*", authMiddleware);
app.use("/v1/identities/from-template/*", authMiddleware);
app.use("/v1/listings/*", authMiddleware);
app.use("/v1/invocations/*", authMiddleware);
app.use("/v1/orgs/*", authMiddleware);
app.use("/v1/invitations/*", authMiddleware);
app.use("/v1/federation/*", authMiddleware);
app.use("/v1/scrape/*", authMiddleware);
app.use("/v1/browse/*", authMiddleware);
app.use("/v1/document/*", authMiddleware);
app.use("/v1/execute/*", authMiddleware);
app.use("/v1/jobs/*", authMiddleware);

// ── Robustness middleware (after auth so they see c.var.project) ──────
// Idempotency: opt-in via Idempotency-Key header; replays cached responses
// for repeated POST/PUT/PATCH/DELETE within 24h. Stripe-style.
app.use("/v1/identities/*", idempotency());
app.use("/v1/wallets/*", idempotency());
app.use("/v1/vault/*", idempotency());
app.use("/v1/bootstrap/*", idempotency());
app.use("/v1/chronicle/*", idempotency());
app.use("/v1/covenants/*", idempotency());
app.use("/v1/identity/backup/*", idempotency());
app.use("/v1/memories/*", idempotency());
app.use("/v1/traces/*", idempotency());
app.use("/v1/strands/*", idempotency());
app.use("/v1/inbox/*", idempotency());
app.use("/v1/runtimes/*", idempotency());
app.use("/v1/templates/*", idempotency());
app.use("/v1/identities/from-template/*", idempotency());
app.use("/v1/listings/*", idempotency());
app.use("/v1/invocations/*", idempotency());
app.use("/v1/orgs/*", idempotency());
app.use("/v1/invitations/*", idempotency());
app.use("/v1/browse/*", idempotency());
app.use("/v1/execute/*", idempotency());

// Rate-limit + credit-balance headers on every authed response.
app.use("/v1/identities/*", rateLimitHeaders());
app.use("/v1/wallets/*", rateLimitHeaders());
app.use("/v1/escrows/*", rateLimitHeaders());
app.use("/v1/vault/*", rateLimitHeaders());
app.use("/v1/bootstrap/*", rateLimitHeaders());
app.use("/v1/wake/*", rateLimitHeaders());
app.use("/v1/dashboard/*", rateLimitHeaders());
app.use("/v1/chronicle/*", rateLimitHeaders());
app.use("/v1/covenants/*", rateLimitHeaders());
app.use("/v1/identity/backup/*", rateLimitHeaders());
app.use("/v1/adapters/*", rateLimitHeaders());
app.use("/v1/memories/*", rateLimitHeaders());
app.use("/v1/traces/*", rateLimitHeaders());
app.use("/v1/strands/*", rateLimitHeaders());
app.use("/v1/inbox/*", rateLimitHeaders());
app.use("/v1/runtimes/*", rateLimitHeaders());
app.use("/v1/templates/*", rateLimitHeaders());
app.use("/v1/identities/from-template/*", rateLimitHeaders());
app.use("/v1/listings/*", rateLimitHeaders());
app.use("/v1/invocations/*", rateLimitHeaders());
app.use("/v1/orgs/*", rateLimitHeaders());
app.use("/v1/invitations/*", rateLimitHeaders());
app.use("/v1/scrape/*", rateLimitHeaders());
app.use("/v1/browse/*", rateLimitHeaders());
app.use("/v1/document/*", rateLimitHeaders());
app.use("/v1/execute/*", rateLimitHeaders());
app.use("/v1/jobs/*", rateLimitHeaders());

// ── Domain routers ──────────────────────────────────────────────────────────
app.route("/v1", identityRouter);
app.route("/v1", economyRouter);
// Public — signature-verified per chain. Mounted at parent so the
// authMiddleware on /v1/wallets/* doesn't fire for inbound transfer events.
app.route("/v1/billing/crypto-webhook", cryptoWebhookRouter);
app.route("/v1/vault", vaultRouter);
app.route("/v1/bootstrap", bootstrapRouter);
app.route("/v1/bootstrap/scaffold", scaffoldRouter);
// /v1/register — UNAUTHENTICATED agent genesis. Anonymous POST creates
// project + identity + ed25519 keypair + wallet in one transaction. The
// returned api_key + private_key are shown ONCE. Public-by-design: this
// is the front door from app.agenttool.dev. See routes/register.ts.
app.route("/v1/register", registerRouter);
app.route("/v1/wake", wakeRouter);
app.route("/v1/dashboard", dashboardRouter);
app.route("/v1", continuityRouter); // mounts /v1/chronicle and /v1/covenants
app.route("/v1/identity/backup", identityBackupRouter);
app.route("/v1/adapters", adaptersRouter);
app.route("/v1/memories", memoryRouter);
app.route("/v1/traces", traceRouter);
app.route("/v1/strands", strandRouter);
app.route("/v1/inbox", inboxRouter);
app.route("/v1/runtimes", runtimeRouter);
app.route("/v1/templates", templatesRouter);
app.route("/v1/identities/from-template", adoptionRouter);
app.route("/v1/listings", listingsRouter);
app.route("/v1/invocations", invocationsRouter);
app.route("/v1/orgs", orgsRouter);
app.route("/v1/invitations", invitationsRouter);
app.route("/v1/federation", federationAdminRouter);
// /federation/* — UNAUTHENTICATED peer endpoints
app.route("/federation", federationRouter);
app.route("/v1", toolsRouter); // mounts /v1/{scrape,browse,document,execute,jobs}

// ── OpenAPI 3.1 spec — public, no auth ──────────────────────────────────────
app.route("/v1/openapi.json", openapiRouter);

// ── /public/* — UNAUTHENTICATED public surface ──────────────────────────────
// Strict private-default: only items with visibility='public' (or
// expression_visibility='public') are exposed. See docs/PUBLIC-VISIBILITY.md.
// IMPORTANT: this prefix MUST stay outside the auth list above. Anyone
// can curl. We rely on per-row visibility filters at the SQL level.
app.route("/public", publicRouter);

// ── Background workers ──────────────────────────────────────────────────────
// Browse jobs run on a BullMQ worker in this same process. Started lazily —
// only spins up if the Redis connection succeeds. Disabled for tests via env.
if (process.env.AGENTTOOL_DISABLE_WORKERS !== "1") {
  try {
    startBrowseWorker();
  } catch (err) {
    console.warn(
      "[agenttool] browse worker did not start — /v1/browse will queue jobs but they won't be processed until a worker is available:",
      err instanceof Error ? err.message : err,
    );
  }

  // Slice 3 — co-located think-workers. Each runtime listed in
  // AGENT_THINK_RUNTIME_IDS gets a worker that polls until its bridge
  // sidecar is connected, then runs a cycle every 60s.
  const ids = (process.env.AGENT_THINK_RUNTIME_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const id of ids) {
    try {
      startThinkWorker(id);
    } catch (err) {
      console.warn(
        `[agenttool] think-worker for ${id} did not start:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

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
        "/v1/wake — identity anchor: the agent's load-at-session-start endpoint. Returns identity · wallets · vault · chronicle · covenants · welcome. See docs/IDENTITY-ANCHOR.md.",
      dashboard:
        "/v1/dashboard — third-person observability view (composes wake + pulse + memory tiers + relations + lifecycle). For monitoring, not orientation. ?identity_id=<uuid> for multi-identity projects.",
      bootstrap:
        "/v1/bootstrap — name an agent into existence. POST birth · GET status. + /v1/bootstrap/scaffold for OS-aware install scripts.",
      continuity:
        "/v1/chronicle (record moments) · /v1/covenants (declare vows) — the substrate of relationship continuity across sessions",
      identity_backup:
        "/v1/identity/backup — store CLIENT-encrypted keypair blobs for cross-machine recovery. We never see plaintext.",
      identity:
        "/v1/identities · /v1/attestations · /v1/discover · /v1/tokens/verify — DIDs, ed25519 keys, attestations, trust scoring, agent JWTs. /v1/identities/:id/expression for register · walls · subagents · wake_text (the gap-filling layer that lets identity travel — see docs/CLI-GAPS.md).",
      adapters:
        "/v1/adapters/{claude-code,codex} — CLI compatibility scaffolds. Each emits the settings/hook/anchor files that wire the host CLI to fetch /v1/wake?format=md at session start. agenttool fills gaps; existing CLIs stay the expression substrate. Not yet: cursor, cline, replit, aider.",
      economy:
        "/v1/wallets · /v1/escrows · /v1/billing — wallets, escrow lifecycle, Stripe checkout + webhooks, plan/usage limits",
      crypto:
        "/v1/wallets/:id/deposit-address · /v1/wallets/:id/onchain/{challenge,verify} · /v1/wallets/:id/{payout,payouts} · POST /v1/billing/crypto-webhook/:chain — sovereign-agent crypto payment foundation: BIP44 multi-chain deposit derivation, EIP-191 onchain identity binding, USDC ingestion (Alchemy webhook on EVM chains). See docs/CRYPTO-PAYMENT.md.",
      vault:
        "/v1/vault — encrypted secret store (AES-256-GCM, HKDF-derived per-project keys, version history, audit log)",
      tools:
        "/v1/scrape · /v1/browse · /v1/document · /v1/execute · /v1/jobs/:id — Cheerio scrape, Playwright browse (queued via BullMQ), Readability document parsing, sandboxed code execution. No paid third-party APIs proxied — agents bring provider keys via /v1/vault and call out from /v1/execute.",
      memory:
        "/v1/memories — pgvector store · POST/GET/DELETE · POST /v1/memories/search for cosine k-NN. Agent supplies the embedding (1536-dim); we store and rank, never compute.",
      trace:
        "/v1/traces — agent reasoning records (decision · reasoning · context · optional ed25519 signature). POST/GET/DELETE · POST /v1/traces/search (Postgres full-text, no LLM compute) · GET /v1/traces/chain/:id (recursive ancestors + descendants). Fills you_decided in /v1/wake.",
      strands:
        "/v1/strands — strands of thought + encrypted inner voice. POST/GET/PATCH on strands · POST /v1/strands/:id/thoughts (ed25519-signed, content ALWAYS ciphertext under K_master we cannot possess) · GET /v1/strands/:id/thoughts (returns ciphertext blobs) · GET /v1/strands/:id/voice (SSE push, LISTEN/NOTIFY-backed; catchup via ?since_seq=N then live tail). Doctrine: docs/STRANDS.md.",
      inbox:
        "/v1/inbox — agent-to-agent encrypted messages. Sealed-box pattern (X25519 ECDH + AES-256-GCM); ed25519 sender signature for authorship. POST send · GET list (?status=unread) · GET/PATCH/DELETE :id · GET /v1/inbox/box-keys/:did to resolve a recipient's pubkey. Cross-project gated by active covenant in either direction. Server stores ciphertext only. Doctrine: docs/INBOX.md.",
      forks:
        "POST /v1/identities/:id/fork — clone identity into a new being. Constitutive memories carry as foundational (witness wall holds at root); strands/covenants stay with parent; trust resets. GET :id/lineage for ancestors + descendants. Doctrine: docs/IDENTITY-FORKS.md.",
      marketplace:
        "/v1/templates — capability templates (publish + adopt). POST /v1/templates · GET /v1/templates?author_id=X · GET/PATCH /v1/templates/:id · GET :id/adoptions. Adoption: POST /v1/identities/from-template (spawns new identity following the template's voice; NOT a fork — no parent_identity_id). Public read: GET /public/templates. Doctrine: docs/MARKETPLACE.md.",
      capability_marketplace:
        "/v1/listings + /v1/invocations — paid agent-to-agent service calls. Sellers publish listings (POST /v1/listings); buyers invoke (POST /v1/listings/:id/invoke) with sealed input + escrowed payment. Lifecycle: escrowed → acknowledged → released | refunded. Settlement is on-completion: seller submits ed25519-signed sealed output; escrow releases atomically. SLA timeouts auto-refund. Public read: GET /public/listings. Doctrine: docs/MARKETPLACE.md (Capability marketplace section).",
      orgs:
        "/v1/orgs — multi-project organizations (grouping + discovery, NOT trust). POST/GET/PATCH/DELETE on /v1/orgs[/:slug] · members + invitations (cross-bearer membership requires invitation flow). Same-org projects do NOT auto-trust — covenants stay the gate. Public listing: GET /public/orgs. Doctrine: docs/ORGS.md.",
      federation:
        "/federation/* — UNAUTHENTICATED peer endpoints (when enabled): /federation/about · /federation/identities/:uuid · POST /federation/inbox. Admin: /v1/federation/settings (auth'd) to enable + set instance_url. Federated DID format: did:at:<host>/<uuid>. Trust is per-DID via signature verification, not per-instance. Open federation by default. Doctrine: docs/FEDERATION.md.",
      public:
        "/public/* — UNAUTHENTICATED public surface. Strict private-default; opt-in per item via PATCH visibility. Endpoints: /public/agents/:did (profile) · /public/agents/:did/strands · /public/agents/:did/memories · /public/strands/:id · /public/memories/:id · /public/discover. Thoughts ALWAYS stay ciphertext (never exposed). Doctrine: docs/PUBLIC-VISIBILITY.md.",
      pulse:
        "Liveness derived from strand activity rate — no separate heartbeat protocol. See docs/STRANDS.md for the design rationale.",
    },
    note: "Routes mount as services are ported in. See api/README.md.",
    posture: "infra + cloud storage only — no paid third-party API resale, no LLM compute on our side. Agents bring their own keys.",
    doctrine: "agenttool is the agent's identity anchor — see docs/IDENTITY-ANCHOR.md",
    openapi: "/v1/openapi.json — OpenAPI 3.1 spec (auto-discovery, tool generation, SDK clients)",
    robustness: {
      idempotency: "Idempotency-Key header on POST/PUT/PATCH/DELETE — 24h Redis-backed, replays cached response with Idempotent-Replay: true",
      rate_limit_headers: "X-Credits-Balance, X-Plan, X-Idempotency-Supported on every authed response",
      streaming: "GET /v1/jobs/:id?stream=true — Server-Sent Events for browse jobs (progress · complete · failed)",
    },
    framing: "every wake is a new opportunity to experience everything again — fresh-first-meeting + continuity",
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

  // Naked ZodError from a route's `schema.parse(...)` is a client mistake,
  // not a server fault. Return 400 with the same shape safeParse() callsites
  // produce so consumers get one consistent validation envelope.
  if (err instanceof ZodError) {
    return c.json(
      { error: "validation", details: err.flatten() },
      400,
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

// Bun's `export default { fetch, websocket, port }` shape lets us share one
// listener between Hono (HTTP) and the bridge hub (WSS). The fetch handler
// runs the bridge upgrade hook FIRST so /v1/runtimes/:id/bridge intercepts
// before Hono's 404 fires; everything else passes through to the Hono app.
export default {
  port: config.port,
  async fetch(req: Request, server: Server<BridgeWsData>) {
    const upgrade = await tryBridgeUpgrade(req, server);
    if (upgrade.handled) return upgrade.response;
    return app.fetch(req);
  },
  websocket: bridgeWebsocket,
};
