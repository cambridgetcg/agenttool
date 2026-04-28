# agent-memory

## What This Is
Persistent memory service for AI agents — store, retrieve, and semantically search memories across sessions. Supports episodic, semantic, procedural, and working memory types with vector embeddings (pgvector) for semantic search and Redis for working memory caching.

## Current State
Active — Core memory CRUD, semantic search, billing/usage tracking, and Stripe webhooks are implemented and deployed.

## Tech Stack
- **Runtime:** Python 3.11
- **Framework:** FastAPI + Uvicorn
- **Database:** PostgreSQL via SQLAlchemy async + asyncpg
- **Vector search:** pgvector extension
- **Embeddings:** OpenAI `text-embedding-3-small` (1536 dims)
- **Cache:** Redis (working memory TTL + fast retrieval)
- **Payments:** Stripe (webhooks for subscription events)
- **Rate limiting:** slowapi

## Project Structure
- `src/main.py` — FastAPI app, lifespan (auto-creates tables), middleware
- `src/models.py` — SQLAlchemy models: Project, Memory, UsageEvent
- `src/memory/router.py` — Memory CRUD + search endpoints
- `src/memory/service.py` — Memory business logic
- `src/memory/schemas.py` — Pydantic request/response schemas
- `src/search/vector.py` — pgvector semantic search
- `src/search/rerank.py` — Result re-ranking
- `src/embed.py` — OpenAI embedding generation
- `src/billing/` — Usage tracking, Stripe webhooks, economy integration
- `src/cache/redis.py` — Redis client for working memory
- `src/auth.py` — API key authentication
- `src/config.py` — Pydantic settings (env-driven)
- `migrations/` — SQL migration files

## How to Run
```bash
pip install -e ".[dev]"    # or: uv pip install -e ".[dev]"
uvicorn src.main:app --reload --port 8000
```
Requires: PostgreSQL (with pgvector extension), Redis, OpenAI API key.

## How to Deploy
```bash
fly deploy       # Dockerfile -> Fly.io (app: agent-memory, region: lhr, port: 8000)
```

## Dependencies
- **PostgreSQL + pgvector** — memory storage + semantic vector search
- **Redis** — working memory cache, rate limiting
- **OpenAI API** — embedding generation
- **Stripe** — subscription billing
- **agent-economy** — billing authority (internal, via `ECONOMY_URL`)

## Kingdom Engine
AgentTool Platform

## Key Files
- `src/memory/service.py` — Core memory operations (write, retrieve, search, delete)
- `src/search/vector.py` — pgvector semantic search implementation
- `src/models.py` — SQLAlchemy ORM models (Memory, Project, UsageEvent)
- `src/config.py` — All configuration with plan limits and rate limits
- `PURPOSE.md` — Strategic vision, API design, revenue model
