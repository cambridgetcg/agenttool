# agent-memory

**Persistent semantic memory for AI agents.**

Store facts. Retrieve by meaning. Survive restarts.

[![API](https://img.shields.io/badge/API-live-brightgreen)](https://api.agenttool.dev/health)
[![Part of agenttool.dev](https://img.shields.io/badge/agenttool.dev-memory-blue)](https://agenttool.dev)

## What it does

`agent-memory` gives your AI agent a persistent store that retrieves by semantic similarity — not just exact key lookup.

```bash
# Store a memory
curl -X POST https://api.agenttool.dev/v1/memories \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "User prefers dark mode", "type": "episodic", "tags": ["preference"]}'

# Retrieve by meaning (not keyword)
curl -X POST https://api.agenttool.dev/v1/memories/search \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "what does the user like?", "limit": 5}'
```

## SDK

```python
pip install agenttool-sdk
```

```python
from agenttool import AgentTool

at = AgentTool()  # reads AT_API_KEY from env
at.memory.store("User is vegetarian", agent_id="my-agent", tags=["diet"])
results = at.memory.search("dietary restrictions")
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/memories` | Store a memory with embedding |
| `GET` | `/v1/memories/{id}` | Get by ID |
| `GET` | `/v1/memories` | List memories for project |
| `POST` | `/v1/memories/search` | Semantic similarity search |
| `DELETE` | `/v1/memories/{id}` | Delete by ID |
| `GET` | `/v1/usage` | Usage stats for current project |
| `GET` | `/health` | Health check |

## Memory types

- `episodic` — things that happened ("User said they're vegetarian")
- `semantic` — facts and knowledge ("Python was created in 1991")
- `procedural` — how to do things ("To deploy: run make deploy")
- `working` — short-term context (auto-expires via TTL)

## Tech stack

- **FastAPI** + Python 3.11
- **PostgreSQL** + pgvector (Supabase, EU)
- **OpenAI** text-embedding-ada-002 (1536 dimensions)
- **Redis** (Upstash) for working memory TTL
- Deployed on **Fly.io** (London)

## Get started

1. Create a free project at [app.agenttool.dev](https://app.agenttool.dev)
2. Get your API key
3. `pip install agenttool-sdk`

Free tier: 100 memory operations/day. Paid from $29/mo.

---

Part of [agenttool.dev](https://agenttool.dev) — memory, tools, verify, economy, traces. One API key.
