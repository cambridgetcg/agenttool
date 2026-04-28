# agent-verify — Implementation TODO

## Phase 1 — Architecture ✅
- [x] PURPOSE.md — standalone, LGM refs removed
- [x] ARCHITECTURE.md — full system design
- [x] TODO.md — this file

## Phase 2 — Scaffold
- [ ] [S] Init Bun project, install deps (hono, zod, drizzle, postgres, ioredis, openai, stripe, undici)
- [ ] [S] Directory structure per ARCHITECTURE.md
- [ ] [S] src/config.ts, src/db/schema.ts, src/db/client.ts
- [ ] [S] src/auth/ (copy from agent-tools, same API key pattern)
- [ ] [T] .env.example, docker-compose.yml, tsconfig.json, drizzle.config.ts
- [ ] [S] src/app.ts + src/index.ts — Hono app + Bun server

## Phase 3 — Core Build

### Verification Pipeline ✅
- [x] [S] src/verify/types.ts — core types (ClaimDomain, Verdict, ParsedClaim, SourceEvidence, etc.)
- [x] [S] src/verify/parser.ts — LLM claim parsing (assertion, domain, queries, entities)
- [x] [S] src/verify/sources/web.ts — Brave Search source with reliability scoring
- [x] [S] src/verify/sources/wikipedia.ts — Wikipedia API source
- [ ] [S] src/verify/sources/gov.ts — Gov/official URL patterns
- [ ] [S] src/verify/sources/knowledge.ts — Internal verified facts DB lookup
- [x] [C] src/verify/sources/dispatcher.ts — parallel source queries with 5s timeout
- [x] [S] src/verify/evidence.ts — LLM classification (supports/contradicts/neutral)
- [x] [C] src/verify/judge.ts — LLM judge (gpt-4o, structured evidence → verdict)
- [x] [S] src/verify/scorer.ts — heuristic confidence refinement
- [x] [C] src/verify/pipeline.ts — full 6-step pipeline orchestration

### API Routes
- [x] [S] src/verify/router.ts — POST /v1/verify, POST /v1/verify/batch
- [ ] [S] src/billing/credits.ts — deduct, balance
- [ ] [S] src/cache/redis.ts — result cache for fast tier

### Tests
- [ ] [S] tests/parser.test.ts — claim parsing accuracy
- [ ] [S] tests/scorer.test.ts — confidence scoring edge cases
- [ ] [S] tests/verify.test.ts — end-to-end verification (mocked sources)
- [ ] [S] tests/sources.test.ts — individual source tests

## Phase 4 — Billing
- [ ] [S] src/billing/stripe.ts — Stripe client + webhook handler
- [ ] [S] Stripe products: Starter £79, Pro £249, credit bundles
- [ ] [S] USDC on Base (same crypto handler pattern as agent-tools)

## Phase 5 — Integration & Deploy
- [ ] [S] Dockerfile (multi-stage)
- [ ] [S] DEPLOY.md
- [ ] [C] Deploy to Railway (PG + Redis + API)
- [ ] [S] Cloudflare subdomain (verify.agentforge.dev)

## Phase 6 — GTM
- [ ] [T] Landing page
- [ ] [S] Blog: "Why your agent's confident answer might be wrong"
- [ ] [T] SDK: TypeScript + Python clients
