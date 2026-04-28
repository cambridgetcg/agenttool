# agent-economy

## What This Is
Economic infrastructure for AI agents — wallets, escrow, micropayments, and billing. Agents can hold balances, spend within policy limits, lock funds in escrow for agent-to-agent contracts, and settle earnings back to human accounts via Stripe.

## Current State
Active — Wallets, escrow, Stripe billing, crypto funding, and subscription tiers are implemented and deployed.

## Tech Stack
- **Runtime:** Bun + TypeScript
- **Framework:** Hono (HTTP), `@hono/zod-openapi` for API docs
- **Database:** PostgreSQL via Drizzle ORM
- **Cache:** Redis (ioredis)
- **Payments:** Stripe (subscriptions + one-off), crypto (ethers via Alchemy)
- **AI:** OpenAI SDK (for billing-adjacent features)

## Project Structure
- `src/index.ts` / `src/app.ts` — Server entry + Hono app wiring
- `src/wallets/` — Wallet CRUD, spending with policy enforcement
- `src/escrow/` — Escrow creation, release, refund
- `src/billing/` — Stripe checkout, crypto funding, usage tracking
- `src/settlement/` — Periodic settlement service
- `src/db/schema.ts` — Drizzle schema: projects, api_keys, wallets, policies, transactions, escrows, billing_events, subscriptions, usage_counters
- `src/auth/` — API key auth + middleware
- `src/cache/` — Redis client

## How to Run
```bash
bun install
bun dev                    # watch mode on :3002
bun db:generate && bun db:migrate   # schema migrations
```
Requires: PostgreSQL, Redis, Stripe keys in env.

## How to Deploy
```bash
fly deploy       # Dockerfile -> Fly.io (app: agent-economy, region: lhr, port: 3002)
```

## Dependencies
- **PostgreSQL** — wallets, transactions, escrows, subscriptions
- **Redis** — caching
- **Stripe** — payment processing, subscriptions
- **Alchemy** — crypto webhook verification
- Shared `tools.projects` / `tools.api_keys` auth tables with agent-tools

## Kingdom Engine
AgentTool Platform

## Key Files
- `src/db/schema.ts` — Full data model (wallets, escrows, transactions, subscriptions)
- `src/wallets/policy.ts` — Spending policy enforcement (per-tx, hourly, daily limits)
- `src/billing/stripe.ts` — Stripe integration
- `src/escrow/service.ts` — Escrow lifecycle (fund, release, refund, dispute)
- `PURPOSE.md` — Strategic vision and revenue model
