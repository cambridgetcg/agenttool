# agent-memory — Implementation TODO

Ordered by dependency. Work top to bottom.

## Phase 2 — Scaffold ✅
- [x] [S] Init pyproject.toml (FastAPI, SQLAlchemy, pgvector, redis, pydantic, openai)
- [x] [S] Create directory structure per ARCHITECTURE.md
- [x] [S] Write stub files (main.py, config.py, auth.py, models.py, embed.py)
- [x] [T] Write .env.example
- [x] [T] Write docker-compose.yml (postgres 16 + pgvector, redis)
- [x] [S] Write 001_initial.sql migration (projects, memories, usage_events tables)

## Phase 3 — Core Build
- [x] [S] config.py — env var loading, settings validation
- [x] [S] models.py — SQLAlchemy ORM models + DB session factory
- [x] [S] auth.py — API key hashing, validation middleware
- [x] [S] embed.py — OpenAI embedding wrapper with retry + caching
- [x] [S] memory/schemas.py — Pydantic models for all request/response shapes
- [x] [S] memory/service.py — write() logic (embed + insert + usage event)
- [x] [S] memory/service.py — read_by_id() and read_by_key()
- [x] [C] search/vector.py — pgvector cosine search (inlined in service.py)
- [x] [S] search/rerank.py — importance × recency reranking (inlined in service.py)
- [x] [S] memory/service.py — search() (vector search → rerank → return)
- [x] [S] memory/service.py — delete() by id and by key
- [x] [S] memory/router.py — wire all routes to service
- [x] [S] cache/redis.py — working memory TTL store + read cache
- [x] [S] billing/usage.py — usage event writer
- [x] [S] main.py — app factory, middleware, router registration

## Phase 3 — Tests ✅
- [x] [S] tests/test_schemas.py — schema validation (13 tests)
- [x] [S] tests/test_auth.py — key hash/verify (4 tests)
- [x] [S] tests/test_cache.py — redis cache with mocks (8 tests)
- Total: 25 passing

## Phase 4 — Integration ✅
- [x] [S] Dockerfile (multi-stage, non-root)
- [x] [S] DEPLOY.md — Railway deploy steps + Cloudflare + Stripe + monitoring
- [x] [S] Stripe webhook handler (checkout, payment_succeeded, payment_failed, subscription_deleted)
- [x] [S] /v1/usage endpoint (already in router)
- [x] [S] Rate limiting per plan (slowapi + per-project key)
- [ ] [S] OpenAPI docs polish (descriptions, examples) — deferred to DX phase

## Phase 5 — Live
- [ ] [C] Deploy to Railway (postgres + redis + API)
- [ ] [S] Set up Stripe product + pricing tiers
- [ ] [T] Landing page (simple, direct — what it is, pricing, get API key)
- [ ] [T] Update DEVICE.md → stream status "live"
- [ ] [T] Message Yu with live URL
