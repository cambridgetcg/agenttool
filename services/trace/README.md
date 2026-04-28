# agent-trace

**Decision and reasoning traces for AI agents.**

Record what your agent decided, why, and how confident it was. Search across traces semantically.

[![API](https://img.shields.io/badge/API-live-brightgreen)](https://api.agenttool.dev/health)
[![Part of agenttool.dev](https://img.shields.io/badge/agenttool.dev-trace-blue)](https://agenttool.dev)

## What it does

`agent-trace` lets agents record structured decision traces — observation → hypothesis → conclusion — and retrieve them by semantic similarity. Useful for debugging, auditing, and agent self-improvement.

```bash
curl -X POST https://api.agenttool.dev/v1/traces \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "decision": {
      "type": "tool_call",
      "summary": "Chose web search over cached results"
    },
    "reasoning": {
      "observations": ["Cache is 3 days old", "User asked for latest news"],
      "conclusion": "Fresh search required for accuracy",
      "confidence": 0.9
    },
    "tags": ["search", "cache"],
    "agent_id": "my-agent",
    "session_id": "sess-001"
  }'
```

## Decision types

- `model_change` — switched model/temperature
- `code_edit` — made a code modification
- `message` — sent a message to user/agent
- `plan` — made a planning decision
- `tool_call` — invoked a tool or external API

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/traces` | Record a decision trace |
| `GET` | `/v1/traces/{id}` | Get trace by ID |
| `POST` | `/v1/traces/search` | Semantic search across traces |
| `GET` | `/v1/traces/chain/{id}` | Follow a chain of linked traces |
| `GET` | `/health` | Health check |

## SDK

```python
pip install agenttool-sdk
```

```python
from agenttool import AgentTool

at = AgentTool()
trace = at.traces.record(
    decision={"type": "tool_call", "summary": "Called web search"},
    reasoning={
        "observations": ["User asked about recent events"],
        "conclusion": "Web search needed for fresh data",
        "confidence": 0.85
    },
    session_id="my-session"
)
```

## Tech stack

- **FastAPI** + Python 3.11
- **PostgreSQL** + pgvector (Supabase, EU)
- **OpenAI** embeddings for semantic search across traces
- Deployed on **Fly.io** (London)

## Get started

1. Create a free project at [app.agenttool.dev](https://app.agenttool.dev)
2. Free tier included. Paid from $29/mo.

---

Part of [agenttool.dev](https://agenttool.dev) — memory, tools, verify, economy, traces. One API key.
