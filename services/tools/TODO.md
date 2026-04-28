# agent-tools — Implementation TODO

Ordered by dependency. Heartbeat works top to bottom.

---

## Phase 0 — Foundation

### Domain & DNS
- [ ] [T] Check agenttools.dev availability (Cloudflare Registrar)
- [ ] [T] Check agenttools.io availability
- [ ] [T] Register chosen domain via Cloudflare Registrar
- [ ] [T] Set up Cloudflare zone: DNS, SSL (Full strict), DDoS rules
- [ ] [T] Add rate limiting rule at edge (100 req/min per IP by default)

### Git & Repo
- [ ] [T] Create private GitHub repo: agent-tools
- [ ] [T] Set branch protection: main requires PR + CI pass
- [ ] [T] Create branches: main, staging
- [x] [T] Add .gitignore (node_modules, .env, dist, .wrangler)
- [ ] [T] Initial commit: PURPOSE.md + ARCHITECTURE.md + TODO.md

### Accounts & Services
- [ ] [T] Stripe account setup (or use existing) — create agent-tools product catalogue
- [ ] [T] Coinbase Commerce account (or Alchemy for direct USDC on Base)
- [ ] [S] Create Stripe products + prices (Builder £39, Scale £159, credit bundles)
- [ ] [T] Railway account — provision PostgreSQL + Redis
- [ ] [T] Hetzner VPS — CX42 (4 vCPU, 8GB RAM) for Playwright workers
- [ ] [T] Verify Bright Data proxy credentials in .env

---

## Phase 1 — Architecture ✅
- [x] ARCHITECTURE.md — full system design
- [x] TODO.md — this file

---

## Phase 2 — Scaffold ✅
- [x] [S] Init Bun project + package.json + scripts
- [x] [S] Install deps (hono, zod, bullmq, ioredis, drizzle, postgres, bcryptjs, stripe, cheerio, readability)
- [x] [S] Directory structure: src/{tools/browser,tools/execute,api/billing,auth,db,queue}
- [x] [T] tsconfig.json + drizzle.config.ts
- [x] [T] .env.example + .gitignore
- [x] [T] docker-compose.yml (postgres 16 + redis 7)
- [x] [S] src/db/schema.ts — Drizzle ORM (projects, api_keys, usage_events, billing_events)
- [x] [S] src/db/client.ts + src/config.ts + src/auth/keys.ts + src/auth/middleware.ts
- [x] [S] src/app.ts + src/index.ts — Hono app + Bun server
- [x] [T] Dockerfile (multi-stage, Playwright + Chromium)
- [x] [S] GitHub Actions: CI (bun test), deploy-staging

---

## Phase 3 — Core Build

### Auth & Projects ✅
- [x] [S] src/db/schema.ts — Drizzle schema (projects, api_keys, usage_events, billing_events)
- [x] [S] src/auth/keys.ts — generate, hash, verify API keys
- [x] [S] src/auth/middleware.ts — Hono Bearer auth middleware
- [x] [S] src/api/projects.ts — POST /v1/projects (create project + first key)
- [x] [S] src/api/keys.ts — GET/POST/DELETE /v1/keys
- [x] [S] src/auth/ratelimit.ts — Redis sliding window rate limiting per plan

### Tool: Search ✅
- [x] [S] src/tools/search.ts — Brave Search API wrapper + Redis cache
- [x] [S] src/api/search.ts — POST /v1/search route
- [x] [S] tests/search.test.ts

### Tool: Scrape ✅
- [x] [S] src/tools/scrape.ts — undici + Cheerio + schema extraction
- [x] [S] src/api/scrape.ts — POST /v1/scrape route
- [x] [S] tests/scrape.test.ts

### Tool: Document ✅
- [x] [S] src/tools/document.ts — PDF + HTML (readability)
- [x] [S] src/api/document.ts — POST /v1/document route
- [x] [S] tests/document.test.ts

### Queue Infrastructure ✅
- [x] [C] src/queue/worker.ts — BullMQ worker
- [x] [S] src/queue/jobs.ts — job definitions
- [x] [S] src/queue/results.ts — poll results

### Tool: Browser ✅
- [x] [C] src/tools/browser/pool.ts — Playwright session pool
- [x] [C] src/tools/browser/actions.ts — action executor
- [x] [C] src/tools/browser/proxy.ts — Bright Data proxy rotation
- [x] [S] src/api/browse.ts — POST /v1/browse route
- [x] [S] src/api/jobs.ts — GET /v1/jobs/:id
- [x] [C] tests/browse.test.ts

### Tool: Execute ✅
- [x] [C] src/tools/execute/sandbox.ts — Docker sandbox with resource limits
- [x] [S] src/tools/execute/languages.ts — Python 3.11 / Node 22 / bash configs
- [x] [S] src/api/execute.ts — POST /v1/execute route
- [x] [S] tests/execute.test.ts

### Usage & Credits ✅
- [x] [S] src/billing/credits.ts — deduct(), refund(), balance()
- [x] [S] src/api/usage.ts — GET /v1/usage
- [x] [S] src/billing/limits.ts → src/auth/ratelimit.ts — Redis sliding window per plan

---

## Phase 4 — Billing

### Stripe (fiat) ✅
- [x] [S] src/billing/stripe.ts — Stripe client, checkout, portal, event handlers
- [x] [S] src/api/billing/checkout.ts — POST /v1/billing/checkout
- [x] [S] src/api/billing/portal.ts — POST /v1/billing/portal
- [x] [C] src/api/billing/webhooks.ts — checkout.completed, invoice.succeeded/failed, subscription.deleted
- [x] [S] tests/billing.test.ts (mock Stripe)

### Crypto (USDC on Base) ✅
- [x] [C] src/billing/crypto/wallet.ts — HD wallet, deterministic address per project (ethers.js)
- [x] [C] src/billing/crypto/webhook.ts — Alchemy webhook: USDC Transfer → confirm → add credits
- [x] [S] src/api/billing/crypto.ts — GET deposit address + POST webhook receiver

---

## Phase 5 — Developer Experience

- [x] [S] OpenAPI spec + Swagger UI at /docs (full spec: all tools, billing, account, system)
- [x] [S] src/api/health.ts — GET /health (DB + Redis + latency checks)
- [x] [C] Landing page — static HTML/CSS: hero, problem, tools, code example, pricing, signup
- [ ] [S] Dashboard — usage graph, credit balance, API key management (simple Next.js)
- [x] [S] SDK: TypeScript client (@agenttool/tools — thin REST wrapper, ready for npm publish)
- [x] [S] SDK: Python client (agenttool-sdk — sync + async, ready for PyPI)
- [x] [T] README.md — quick start, API reference, pricing, self-host instructions

---

## Phase 6 — Infrastructure & Deploy

- [x] [S] DEPLOY.md — full production deploy runbook
- [x] [T] Dockerfile — multi-stage (deps → build → prod), Playwright + Chromium, non-root user, healthcheck
- [x] [S] docker-compose.prod.yml — API + Redis + Caddy (auto HTTPS)
- [x] [T] Caddyfile — reverse proxy, security headers, logging
- [x] [S] GitHub Actions — CI (bun test), deploy-staging (auto), deploy-prod (manual approval)
- [ ] [C] Hetzner VPS setup: Docker, pull image, env vars, start compose
- [ ] [S] Railway: PostgreSQL provisioned (prod DATABASE_URL)
- [ ] [S] Cloudflare: domain registered + pointed, SSL full strict, WAF, rate limiting
- [ ] [S] Healthcheck: UptimeRobot or Cloudflare health alerts
- [ ] [T] Set up error tracking (Sentry or equivalent)

---

## Phase 7 — Go-to-Market

- [ ] [T] ProductHunt draft: title, tagline, gallery, first comment
- [ ] [S] Show HN post draft: "I built a reliable tool API for AI agents..."
- [ ] [T] Post in LangChain Discord, AutoGen Discord, CrewAI Discord
- [ ] [S] Blog post: "Why AI agent tools fail in production (and how to fix it)"
- [ ] [T] Twitter/X thread: the problem, the solution, the link
- [ ] [T] Update DEVICE.md → stream status "live"
- [ ] [T] Message Yu: "🟢 agent-tools is live at agenttools.dev"
