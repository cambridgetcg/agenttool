# agent-economy — Implementation TODO

## Phase 1 — Architecture ✅
- [x] PURPOSE.md — standalone
- [x] ARCHITECTURE.md — full system design
- [x] TODO.md — this file

## Phase 2 — Scaffold
- [ ] [S] Init Bun project, install deps (hono, zod, drizzle, postgres, ioredis, stripe, bcryptjs)
- [ ] [S] Directory structure: src/{wallet,escrow,policy,billing,auth,db,api}
- [ ] [S] src/db/schema.ts — Drizzle (wallets, policies, transactions, escrows, projects, api_keys)
- [ ] [S] src/auth/ — copy auth pattern from agent-tools
- [ ] [S] src/config.ts, src/app.ts, src/index.ts
- [ ] [T] .env.example, docker-compose.yml, tsconfig.json, drizzle.config.ts

## Phase 3 — Core Build

### Wallet Engine
- [ ] [S] src/wallet/service.ts — create, get, list, balance, freeze
- [ ] [S] src/wallet/spend.ts — atomic deduct with policy check
- [ ] [S] src/wallet/fund.ts — add credits (from Stripe/crypto/transfer)

### Policy Engine
- [ ] [S] src/policy/service.ts — create, update, evaluate
- [ ] [S] src/policy/checks.ts — per-tx, hourly, daily, recipient whitelist, approval threshold
- [ ] [S] src/policy/aggregates.ts — Redis-backed hourly/daily spend totals

### Escrow Engine
- [ ] [C] src/escrow/service.ts — create, accept, release, dispute, expire
- [ ] [S] src/escrow/cron.ts — expire overdue escrows (return to creator)

### API Routes
- [ ] [S] src/api/wallets.ts — all wallet endpoints
- [ ] [S] src/api/escrow.ts — all escrow endpoints
- [ ] [S] src/api/billing.ts — checkout, crypto, usage, settle

### Tests
- [ ] [S] tests/wallet.test.ts — create, fund, spend, balance
- [ ] [S] tests/policy.test.ts — policy enforcement edge cases
- [ ] [S] tests/escrow.test.ts — lifecycle: create → accept → release/dispute/expire
- [ ] [S] tests/spend.test.ts — atomic deduction, concurrent safety

## Phase 4 — Billing
- [ ] [S] Stripe Checkout (fund wallet)
- [ ] [S] USDC on Base (fund wallet, same HD pattern as agent-tools)
- [ ] [C] Stripe Connect (settlement to human bank)
- [ ] [C] Stripe webhooks (checkout.completed, payment_failed)

## Phase 5 — DevEx
- [ ] [S] OpenAPI docs (/docs)
- [ ] [S] Health endpoint
- [ ] [S] README with quick start
- [ ] [S] Dashboard: wallet balance, tx history, policy editor

## Phase 6 — Infrastructure
- [ ] [T] Dockerfile
- [ ] [S] DEPLOY.md
- [ ] [S] Cloudflare DNS: economy.agenttool.dev
- [ ] [S] GitHub Actions CI

## Phase 7 — GTM
- [ ] [T] Landing page section on agenttool.dev
- [ ] [S] Blog: "Why AI agents need wallets"
- [ ] [T] Wire into agent-tools as first spending target
