# agent-verify

## What This Is
Claim verification API for AI agents — an agent submits a factual claim, and the service returns a confidence score, verdict (verified/disputed/false/unverifiable), evidence for and against, and source citations. Multi-source consensus from web, Wikipedia, government/regulatory sites, and a knowledge base, evaluated by an LLM judge.

## Current State
Active — Verification pipeline (single + batch), multi-source evidence gathering, LLM judge, caching, and billing tiers are implemented and deployed.

## Tech Stack
- **Runtime:** Bun + TypeScript
- **Framework:** Hono, `@hono/zod-openapi`
- **Database:** PostgreSQL via Drizzle ORM
- **Cache:** Redis (ioredis) for verification result caching
- **AI:** OpenAI (LLM judge for evidence evaluation)
- **HTTP:** undici (for source fetching)
- **Payments:** Stripe
- **Validation:** Zod

## Project Structure
- `src/index.ts` / `src/app.ts` — Server entry + Hono app
- `src/verify/router.ts` — `POST /v1/verify` (single), `POST /v1/verify/batch` (up to 10 claims)
- `src/verify/pipeline.ts` — Orchestrates: parse claim -> gather evidence -> score -> judge -> verdict
- `src/verify/sources/dispatcher.ts` — Routes claim to relevant source backends
- `src/verify/sources/web.ts` — Web search evidence
- `src/verify/sources/wikipedia.ts` — Wikipedia API evidence
- `src/verify/sources/gov.ts` — Government/regulatory sources
- `src/verify/sources/knowledge.ts` — Internal knowledge base of verified facts
- `src/verify/judge.ts` — LLM-based evidence evaluation (OpenAI)
- `src/verify/scorer.ts` — Confidence scoring from multi-source consensus
- `src/verify/evidence.ts` — Evidence data structures
- `src/verify/parser.ts` — Claim parsing and normalization
- `src/verify/types.ts` — Shared type definitions
- `src/db/schema.ts` — projects, api_keys, usage_events, verification_cache, verified_facts, billing_events
- `src/billing/` — Credit system, tier gates
- `src/cache/redis.ts` — Redis caching for verification results

## How to Run
```bash
bun install
bun dev                    # watch mode on :3000
bun db:generate && bun db:migrate   # schema migrations
```
Requires: PostgreSQL, Redis, OpenAI API key.

## How to Deploy
```bash
fly deploy       # Dockerfile -> Fly.io (app: atool-proof, region: lhr)
```

## Dependencies
- **PostgreSQL** — verification cache, verified facts, usage tracking, billing
- **Redis** — fast verification result caching
- **OpenAI API** — LLM judge for evidence evaluation
- **Stripe** — billing
- Web access for source fetching (Wikipedia API, web search, gov sites)

## Kingdom Engine
AgentTool Platform

## Key Files
- `src/verify/pipeline.ts` — End-to-end verification orchestration
- `src/verify/judge.ts` — LLM evidence evaluation logic
- `src/verify/sources/` — All evidence source implementations (web, Wikipedia, gov, knowledge)
- `src/verify/scorer.ts` — Multi-source confidence scoring
- `src/db/schema.ts` — Data model (verification_cache with TTL, verified_facts)
- `PURPOSE.md` — Strategic vision, revenue model, API design
