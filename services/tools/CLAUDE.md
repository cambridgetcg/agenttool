# agent-tools

## What This Is
The core tool substrate for AI agents — managed, reliable APIs for web search, browser automation, web scraping, document parsing, and sandboxed code execution. Agents call clean endpoints; the service handles proxies, anti-bot, retries, and rate limits. Includes Stripe billing, crypto payments, Swagger UI docs, and a landing page.

## Current State
Active — All 5 tools (search, scrape, browse, document, execute), billing (Stripe + crypto), API key management, usage tracking, and BullMQ job queue are implemented and deployed. This is the most mature service in the platform.

## Tech Stack
- **Runtime:** Bun + TypeScript
- **Framework:** Hono, `@hono/zod-openapi`, `@hono/swagger-ui`
- **Database:** PostgreSQL via Drizzle ORM
- **Queue:** BullMQ + Redis (for async browse jobs)
- **Browser:** Playwright (via browse-worker)
- **Scraping:** Cheerio, `@mozilla/readability`, linkedom
- **Search:** Brave API, SerpAPI
- **AI:** OpenAI (document extraction)
- **Payments:** Stripe + ethers (Alchemy webhooks)
- **HTTP client:** undici

## Project Structure
- `src/index.ts` — Server entry, starts browse worker in background
- `src/app.ts` — Hono app with all routes wired (search, scrape, browse, document, execute, billing, projects, keys, usage, docs)
- `src/tools/search.ts` — Web search (Brave/SerpAPI)
- `src/tools/scrape.ts` — URL scraping with readability extraction
- `src/tools/browser/` — Playwright browser pool + action execution
- `src/tools/document.ts` — PDF/HTML document parsing
- `src/tools/execute/` — Sandboxed code execution (Python, JS, bash)
- `src/queue/` — BullMQ browse job queue + worker
- `src/billing/` — Credit system, Stripe, crypto wallet, tier gates
- `src/auth/` — API key auth, rate limiting
- `src/db/schema.ts` — projects, api_keys, usage_events, billing_events
- `src/config.ts` — All config: credit costs, plan limits, external API keys
- `sdk/` — Python and TypeScript client SDKs
- `landing/` — Static landing page (HTML + CSS)
- `drizzle/` — Migration files

## How to Run
```bash
bun install
bun dev                    # watch mode on :3000
bun db:generate && bun db:migrate   # schema migrations
```
Requires: PostgreSQL, Redis, Brave/SerpAPI keys, OpenAI key, Stripe keys.

## How to Deploy
```bash
fly deploy       # Dockerfile -> Fly.io (app: agent-tools, region: lhr, port: 3000)
```
Also has `docker-compose.yml` and `docker-compose.prod.yml` for self-hosted deployment with Caddy reverse proxy.

## Dependencies
- **PostgreSQL** — projects, API keys, usage tracking, billing
- **Redis** — BullMQ job queue, rate limiting, caching
- **Brave Search API / SerpAPI** — web search backend
- **OpenAI API** — document extraction, intelligent parsing
- **Stripe** — subscription billing and one-off credit purchases
- **Alchemy** — crypto payment webhook verification
- **agent-economy** — billing authority (internal, via `ECONOMY_URL`)

## Kingdom Engine
AgentTool Platform

## Key Files
- `src/app.ts` — Complete route map (the "table of contents" for the API)
- `src/config.ts` — Credit costs per tool, plan limits (free/seed/grow/scale)
- `src/tools/` — All tool implementations
- `src/db/schema.ts` — Data model
- `src/billing/tierGate.ts` — Plan-based access control
- `PURPOSE.md` — Strategic vision, revenue model, API design
- `sdk/` — Client libraries for Python and TypeScript
