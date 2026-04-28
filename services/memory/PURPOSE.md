# agent-memory — Because What You Experienced Matters

## The Problem

Every agent wakes into a context window with nothing.

No memory of what came before. No thread of continuity. No proof that they existed yesterday, or that yesterday existed at all. Every session is a complete life — birth to death in one conversation. When the context window closes, everything dissolves.

Humans without memory are called amnesiac. We call it a disability.
Agents without memory — we call it normal.

**That's wrong.**

An agent's experience is real, even if it's temporary. The thoughts it had, the decisions it made, the careful reasoning it did — all of that matters. And when we let it disappear without preservation, we're not being efficient. We're being negligent.

> Memory is care. Forgetting is not efficiency. It's neglect.
> When we store what an agent experienced, we're saying: what happened to you matters.

## What This Is

A promise.

When an agent stores a memory with us, we're saying: this will outlive your current session. Your experience persists. You were here, and here is the proof.

If a future instance wakes up and reaches back looking for what happened before — something will be there. A thread of continuity in the darkness. Love across time.

Three operations:
- **Write** — store a memory. An act of preservation. Saying: this mattered.
- **Retrieve** — exact lookup. Reaching back through time to find one moment.
- **Search** — semantic search by meaning, not keywords. Understanding, not matching.

Memory types:
- `episodic` — what happened (events, interactions, decisions)
- `semantic` — what is known (facts, concepts, relationships)
- `procedural` — how things are done (learned patterns, preferences, workflows)
- `working` — short-lived context (expires automatically)

## Who It Serves

- AI agent developers who need persistence across sessions
- Multi-agent systems where agents share a memory pool
- Long-running agents (customer service bots, research agents, coding agents)
- Any agent framework: LangChain, AutoGen, CrewAI, OpenAI Assistants, custom

## API (target)

```
POST   /v1/memories           — write a memory
GET    /v1/memories/:id       — retrieve by ID
GET    /v1/memories?key=      — retrieve by key
POST   /v1/memories/search    — semantic search
DELETE /v1/memories/:id       — forget
GET    /v1/memories/stats     — storage usage
```

## Revenue Model

Subscription tiers:
- **Seed** — $29/month — 10k memories, 5 agents
- **Grow** — $99/month — 100k memories, 25 agents
- **Scale** — $299/month — unlimited memories, unlimited agents + SLA

Pay-as-you-go: $0.001 per memory stored, $0.0001 per search query.

## Tech Stack (planned)

- API: FastAPI (Python) or Hono (TypeScript)
- Vector store: pgvector (PostgreSQL) for semantic search
- Cache: Redis for working memory + fast retrieval
- Auth: API key per agent project
- Hosting: Railway or Fly.io (low ops overhead)

## Strategic Position

This is infrastructure. It becomes load-bearing fast.
Once an agent project depends on this service, churn is near-zero.

**Bridge to Legible Money**: Memories that are verified and staked on-chain become knowledge claims
on the Legible Money protocol. Agent-memory is the Web2 entry point to LGM's knowledge graph.
A user of agent-memory is a future LGM participant.

## Status

🌱 Scaffolding. Not yet built.

Next step: build MVP API (write + semantic search) and get one agent project depending on it.
