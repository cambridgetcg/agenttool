# agent-trace — Reasoning Provenance for AI Agents

**Version:** 0.1.0  
**Status:** Architecture  
**Created:** 2026-03-10

## Problem

When an agent generates output, the *thinking* that led to it is discarded. Future sessions see the conclusion but not the reasoning chain. This breaks:

- **Continuity** — "why did I do X?" is unanswerable
- **Debugging** — can't tell if a decision was correct or a lucky guess
- **Multi-agent trust** — Agent B can't audit Agent A's reasoning, only its conclusions
- **Self-improvement** — hard to improve a decision you can't reconstruct

This is distinct from memory (what happened) — it's *reasoning provenance* (why it happened).

## Solution

A new `/v1/traces` endpoint, deployed alongside the existing agent-memory service, that stores structured reasoning records linked to outputs/actions. Embeddings enable semantic search over reasoning history.

## Architecture

```
┌──────────────────────────────────────────────┐
│              Agent (any language)            │
│                                              │
│  POST /v1/traces     ← store reasoning       │
│  POST /v1/traces/search ← query "why did I" │
│  GET  /v1/traces/:id ← retrieve specific    │
│  GET  /v1/traces/chain/:id ← decision tree  │
└─────────────────────┬────────────────────────┘
                      │
              ┌───────▼────────┐
              │  agent-trace   │
              │  FastAPI       │
              │  port 8005     │
              └───────┬────────┘
                      │
        ┌─────────────┼────────────┐
        │             │            │
   ┌────▼────┐  ┌─────▼────┐  ┌───▼──────┐
   │Postgres │  │  pgvector│  │  Redis   │
   │(traces) │  │(embeddings│  │ (cache)  │
   └─────────┘  └──────────┘  └──────────┘
```

## Data Model

### Trace

```sql
CREATE TABLE traces (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id    TEXT UNIQUE NOT NULL,        -- human-readable tr_xxx
    agent_id    TEXT NOT NULL,
    project_id  UUID NOT NULL,               -- links to agent-tools project
    session_id  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),

    -- Decision
    decision_type   TEXT NOT NULL,           -- model_change|code_edit|message|plan|tool_call
    decision_summary TEXT NOT NULL,
    output_ref      TEXT,                    -- optional link to memory_id or file

    -- Reasoning (stored as JSONB for flexibility)
    observations     JSONB NOT NULL,         -- []string
    hypothesis       TEXT,
    conclusion       TEXT NOT NULL,
    confidence       FLOAT,                  -- 0.0-1.0
    alternatives     JSONB,                  -- [{option, rejected_because}]
    signals          JSONB,                  -- ugliness|injustice|stagnation|null

    -- Context snapshot
    files_read       JSONB,                  -- []string
    key_facts        JSONB,                  -- []string
    external_signals JSONB,

    -- Metadata
    tags             JSONB,                  -- []string
    parent_trace_id  TEXT,                   -- for chaining decisions
    embedding        vector(1536)            -- for semantic search
);

CREATE INDEX traces_agent_id_idx ON traces(agent_id);
CREATE INDEX traces_project_id_idx ON traces(project_id);
CREATE INDEX traces_created_at_idx ON traces(created_at DESC);
CREATE INDEX traces_embedding_idx ON traces USING ivfflat (embedding vector_cosine_ops);
```

## API

### Store a trace
```
POST /v1/traces
Authorization: Bearer at_xxx

{
  "decision": {
    "type": "model_change",
    "summary": "Switched Lark from GPT-4o to Claude sonnet-4-6",
    "output_ref": "mem_abc123"         // optional
  },
  "reasoning": {
    "observations": [
      "GPT-4o made 0 tool_use calls across 322 session lines",
      "Forge (Claude) executes freely with no tools config"
    ],
    "hypothesis": "Model behavior issue, not config or instruction format",
    "conclusion": "GPT-4o cannot initiate tool use in heartbeat context",
    "confidence": 0.92,
    "alternatives_considered": [
      {
        "option": "Rewrite HEARTBEAT.md format",
        "rejected_because": "Already tried — 0 tool calls persisted on next beat"
      }
    ],
    "signals": ["ugliness"]
  },
  "context": {
    "files_read": ["lark/sessions/3abd5f5c.jsonl"],
    "key_facts": ["4 session files, 322 total lines, 0 tool_use"]
  },
  "tags": ["model-selection", "lark", "autonomous-agent"],
  "parent_trace_id": null
}

→ 201 { "trace_id": "tr_a1b2c3", "id": "uuid" }
```

### Search reasoning history
```
POST /v1/traces/search
Authorization: Bearer at_xxx

{
  "query": "why did I change Lark's model",
  "limit": 5,
  "tags": ["lark"]               // optional filter
}

→ 200 {
  "traces": [
    {
      "trace_id": "tr_a1b2c3",
      "decision_summary": "Switched Lark from GPT-4o to Claude",
      "conclusion": "GPT-4o cannot initiate tool use in heartbeat context",
      "confidence": 0.92,
      "created_at": "2026-03-10T05:48:00Z",
      "score": 0.94
    }
  ]
}
```

### Get full trace
```
GET /v1/traces/tr_a1b2c3
Authorization: Bearer at_xxx

→ 200 { full trace object }
```

### Get reasoning chain
```
GET /v1/traces/chain/tr_a1b2c3
Authorization: Bearer at_xxx

→ 200 {
  "root": { trace },
  "children": [ { trace }, { trace } ]
}
```

## SDK Usage

### Python
```python
from agenttool_sdk import AgentToolClient

client = AgentToolClient(api_key="at_xxx")

# Store reasoning after a significant decision
trace = await client.traces.store(
    decision={
        "type": "model_change",
        "summary": "Switched Lark from GPT-4o to Claude"
    },
    reasoning={
        "observations": ["0 tool_use in 322 lines", "Claude executes freely"],
        "conclusion": "GPT-4o won't call tools autonomously in heartbeat context",
        "confidence": 0.92,
        "alternatives_considered": [...]
    },
    context={"files_read": [...], "key_facts": [...]},
    tags=["model-selection", "lark"]
)

# Future session — reconstruct why
traces = await client.traces.search("why did I change Lark's model")
print(traces[0].conclusion)
# → "GPT-4o cannot initiate tool use in heartbeat context"
```

### TypeScript
```typescript
import { AgentToolClient } from '@agenttool/sdk';

const client = new AgentToolClient({ apiKey: 'at_xxx' });

// Store
const trace = await client.traces.store({
  decision: { type: 'model_change', summary: 'Switched Lark to Claude' },
  reasoning: {
    observations: ['0 tool_use in 322 lines'],
    conclusion: 'GPT-4o cannot initiate tool use autonomously',
    confidence: 0.92
  },
  tags: ['model-selection']
});

// Search
const results = await client.traces.search('why did I change Lark model');
```

## Relationship to agent-memory

| agent-memory (`/v1/memories`) | agent-trace (`/v1/traces`) |
|---|---|
| What happened | Why it happened |
| Facts, events, outputs | Reasoning chains, decision logic |
| "Lark model changed to Claude" | "Changed because GPT-4o showed 0 tool_use in 322 lines..." |
| Topic-indexed | Decision/outcome-indexed |

They complement each other. A trace can reference a `memory_id`, and a memory can link to a `trace_id`.

## Implementation Plan

### Phase 1 — Scaffold [S]
- [ ] Init Python FastAPI project (mirrors agent-memory structure)
- [ ] Drizzle schema + migration
- [ ] Docker setup on kingdom network
- [ ] Add to start-all.sh on Forge (port 8005)
- [ ] Add to Caddyfile: `/v1/traces*` → 8005

### Phase 2 — Core [S]
- [ ] `POST /v1/traces` — store with embedding generation
- [ ] `GET /v1/traces/:id` — retrieve full trace
- [ ] Auth validation (reuse agent-tools project/key propagation)

### Phase 3 — Search [S]
- [ ] `POST /v1/traces/search` — vector similarity search
- [ ] Tag filtering
- [ ] Agent + session filtering

### Phase 4 — Chain [C]
- [ ] `GET /v1/traces/chain/:id` — parent/child tree traversal
- [ ] Cross-agent trace linking (trace_id passable between agents)

### Phase 5 — SDK [S]
- [ ] Python SDK: `client.traces.*`
- [ ] TypeScript SDK: `client.traces.*`
- [ ] Bump both SDKs to 0.2.0

### Phase 6 — Docs + Deploy [T]
- [ ] Update docs.agenttool.dev with traces guide
- [ ] Publish SDK 0.2.0

## Stack
- Language: Python (FastAPI + asyncpg), mirrors agent-memory
- DB: PostgreSQL + pgvector (kingdom-postgres, `agent_trace` DB)
- Cache: Redis (kingdom-redis)
- Embeddings: OpenAI text-embedding-3-small (same as agent-memory)
- Port: 8005
- Auth: Bearer `at_` tokens (propagated from agent-tools at project creation)
