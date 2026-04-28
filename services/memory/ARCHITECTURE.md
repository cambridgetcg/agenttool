# agent-memory — Architecture

## Overview

A persistent, cross-session memory service for AI agents. REST API backed by PostgreSQL
(pgvector for semantic search) and Redis (working memory + cache).

## System Diagram

```
Agent / Client
     │
     │ HTTPS + API Key
     ▼
┌─────────────────────────────────────┐
│          API Layer (FastAPI)        │
│  /v1/memories  /v1/search  /health  │
└────────────┬────────────────────────┘
             │
     ┌───────┴────────┐
     │                │
     ▼                ▼
┌─────────┐    ┌──────────────┐
│  Redis  │    │  PostgreSQL  │
│ Working │    │  + pgvector  │
│ memory  │    │  Long-term   │
│ Cache   │    │  Semantic    │
└─────────┘    └──────────────┘
                      │
                      ▼
              ┌───────────────┐
              │ Embed Service │
              │ (OpenAI/local)│
              └───────────────┘
```

## Memory Types

| Type | TTL | Storage | Use Case |
|------|-----|---------|----------|
| `working` | 1h (configurable) | Redis | Active task context |
| `episodic` | Forever | PostgreSQL | Events, interactions, decisions |
| `semantic` | Forever | PostgreSQL + pgvector | Facts, concepts, knowledge |
| `procedural` | Forever | PostgreSQL | Learned patterns, preferences |

## Data Model

### memories table (PostgreSQL)
```sql
CREATE TABLE memories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id),
  agent_id    TEXT,                          -- optional: which agent owns this
  type        TEXT NOT NULL,                 -- episodic | semantic | procedural | working
  key         TEXT,                          -- optional human-readable key for exact lookup
  content     TEXT NOT NULL,                 -- the memory content
  embedding   vector(1536),                  -- OpenAI ada-002 embedding
  metadata    JSONB DEFAULT '{}',            -- arbitrary tags/context
  importance  FLOAT DEFAULT 0.5,             -- 0.0-1.0, affects search ranking
  accessed_at TIMESTAMPTZ,                   -- last retrieval time
  created_at  TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ                    -- null = never expires
);

CREATE INDEX ON memories USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX ON memories (project_id, type);
CREATE INDEX ON memories (project_id, key) WHERE key IS NOT NULL;
```

### projects table
```sql
CREATE TABLE projects (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  api_key    TEXT UNIQUE NOT NULL,           -- hashed
  plan       TEXT DEFAULT 'seed',            -- seed | grow | scale
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### usage_events table (for billing)
```sql
CREATE TABLE usage_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  event_type TEXT NOT NULL,                  -- write | read | search | delete
  count      INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## API Surface

### Auth
All requests: `Authorization: Bearer <api_key>`

### Endpoints

```
POST   /v1/memories
  body: { type, key?, content, metadata?, importance?, ttl_seconds? }
  → { id, created_at }

GET    /v1/memories/:id
  → { id, type, key, content, metadata, importance, created_at }

GET    /v1/memories?key=<key>&agent_id=<agent>
  → { memories: [...] }

POST   /v1/memories/search
  body: { query, type?, limit?, min_score?, agent_id? }
  → { memories: [{ ...memory, score }] }

DELETE /v1/memories/:id
  → { deleted: true }

DELETE /v1/memories?key=<key>
  → { deleted: N }

GET    /v1/usage
  → { writes, reads, searches, total_memories, plan }
```

### Search Algorithm
1. Embed query via OpenAI text-embedding-ada-002
2. pgvector cosine similarity search (top K candidates)
3. Re-rank by: similarity score × importance × recency decay
4. Return top `limit` results (default 10)

## Modules

```
agent-memory/
├── PURPOSE.md
├── ARCHITECTURE.md       ← this file
├── TODO.md
├── src/
│   ├── main.py           — FastAPI app entry point
│   ├── config.py         — env vars, settings
│   ├── auth.py           — API key validation
│   ├── models.py         — SQLAlchemy models (memories, projects, usage)
│   ├── embed.py          — embedding service (OpenAI wrapper)
│   ├── memory/
│   │   ├── router.py     — /v1/memories routes
│   │   ├── service.py    — write/read/search/delete logic
│   │   └── schemas.py    — Pydantic request/response schemas
│   ├── search/
│   │   ├── vector.py     — pgvector search
│   │   └── rerank.py     — importance × recency reranking
│   ├── cache/
│   │   └── redis.py      — working memory + read cache
│   └── billing/
│       └── usage.py      — usage event tracking
├── migrations/
│   └── 001_initial.sql
├── tests/
│   ├── test_memory.py
│   └── test_search.py
├── .env.example
├── Dockerfile
├── docker-compose.yml    — local dev (postgres + redis)
├── pyproject.toml
└── DEPLOY.md
```

## Non-Functionals

- **Latency**: write <100ms, exact read <20ms, semantic search <500ms
- **Availability**: 99.9% target (Railway managed postgres handles failover)
- **Security**: API keys hashed (bcrypt), no plaintext storage, HTTPS only
- **Limits**: enforced per plan at API layer before DB write

## Tech Choices

| Choice | Reason |
|--------|--------|
| FastAPI | Async, fast, excellent OpenAPI docs auto-generated |
| PostgreSQL + pgvector | One DB for structured + vector data. No Pinecone dependency. |
| Redis | Working memory needs sub-ms TTL operations. Redis is the obvious choice. |
| OpenAI embeddings | ada-002 is cheap ($0.0001/1k tokens), reliable, 1536-dim |
| Railway | Managed Postgres + Redis + auto-deploy from git. Minimal ops. |

## LGM Bridge

When a memory is marked `verified: true` (by the agent or by human confirmation),
it becomes eligible for submission to Legible Money's knowledge graph as a claim.
The `agent-memory` service will expose a `/v1/memories/:id/submit-to-lgm` endpoint
that stakes the memory as a knowledge claim on-chain.

## Stripe Integration (billing)

- Subscription plans via Stripe Billing
- Usage metered events sent to Stripe at end of billing period
- Webhook: `invoice.payment_failed` → downgrade plan, preserve data (30 days)
