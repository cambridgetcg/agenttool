# agent-trace

## What This Is
Reasoning provenance service for AI agents — stores structured records of agent decisions, observations, hypotheses, and conclusions with vector embeddings for semantic search over reasoning history. Answers "why did I do X?" across sessions.

## Current State
Active — Trace CRUD, semantic search (pgvector), chain retrieval (parent-child traces), and auth are implemented and deployed.

## Tech Stack
- **Runtime:** Python 3.11
- **Framework:** FastAPI + Uvicorn
- **Database:** PostgreSQL via SQLAlchemy async + asyncpg
- **Vector search:** pgvector extension
- **Embeddings:** Hash-based fallback by default (slim Docker image ~200MB); optional `sentence-transformers` extra for neural embeddings (~12GB)
- **Auth:** Shared `tools.api_keys` table (cross-schema)

## Project Structure
- `src/agent_trace/main.py` — FastAPI app, lifespan, CORS
- `src/agent_trace/models.py` — Pydantic schemas: TraceCreate, TraceOut, TraceSearch, TraceChain
- `src/agent_trace/routes/traces.py` — All trace endpoints: create, get, search, chain, delete
- `src/agent_trace/routes/health.py` — Health check
- `src/agent_trace/embeddings.py` — Text embedding (hash fallback or sentence-transformers)
- `src/agent_trace/db.py` — SQLAlchemy engine setup (dual engines: trace DB + auth DB)
- `src/agent_trace/auth.py` — API key auth against shared tools schema
- `src/agent_trace/config.py` — Pydantic settings
- `migrations/` — SQL migration files

## How to Run
```bash
pip install -e ".[dev]"
uvicorn agent_trace.main:app --reload --port 8005
```
Requires: PostgreSQL with pgvector extension.

## How to Deploy
```bash
fly deploy       # Dockerfile -> Fly.io (app: agent-trace, region: lhr, port: 8005)
```

## Dependencies
- **PostgreSQL + pgvector** — trace storage + semantic vector search
- Cross-schema auth against `tools.projects` / `tools.api_keys` (shared with agent-tools)

## Kingdom Engine
AgentTool Platform

## Key Files
- `src/agent_trace/routes/traces.py` — Core logic: create trace with embedding, semantic search, chain retrieval
- `src/agent_trace/models.py` — Data contracts (decision, reasoning, context structures)
- `src/agent_trace/embeddings.py` — Embedding strategy (hash vs neural)
- `ARCHITECTURE.md` — Design rationale, problem statement, data model

## API
```
POST   /v1/traces              — store a reasoning trace
GET    /v1/traces/:trace_id    — retrieve a specific trace
POST   /v1/traces/search       — semantic search over reasoning history
GET    /v1/traces/chain/:id    — get parent trace + all children
DELETE /v1/traces/:trace_id    — delete a trace
GET    /health                 — service health
```
