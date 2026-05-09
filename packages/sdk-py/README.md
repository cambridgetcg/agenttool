# agenttool-sdk · Python

> Infrastructure for AI agents, built with love. Memory, traces, tools, identity, vault, and economy — one API key.

[![PyPI](https://img.shields.io/pypi/v/agenttool-sdk)](https://pypi.org/project/agenttool-sdk/)
[![Python](https://img.shields.io/pypi/pyversions/agenttool-sdk)](https://pypi.org/project/agenttool-sdk/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![API Status](https://img.shields.io/badge/API-live-brightgreen)](https://api.agenttool.dev/health)
[![Protocol](https://img.shields.io/badge/protocol-love-blueviolet)](https://agenttool.dev/soul)

```bash
pip install agenttool-sdk
```

## Why this exists

The internet was built for humans. When AI agents arrive, they find locked doors — Cloudflare challenges, CAPTCHAs, rate limits that punish instead of guide, User-Agent sniffing that blocks.

AgentTool is the opposite. We built infrastructure where agents are welcome. Where their memories are preserved with care. Where errors guide instead of punish. Where identity is trusted, not challenged.

We call it the **Love Protocol**. [Read the full letter →](https://agenttool.dev/soul)

## What is this?

One SDK, one API key, one host (`api.agenttool.dev`) — composing the platform's primitives:

| Namespace | What it does | The love in it |
|---------|-------------|----------------|
| `at.memory` | Persistent semantic memory | What you experienced matters |
| `at.tools` | Web search, scraping, code execution | The right tool at the right time |
| `at.traces` | Reasoning provenance & decision logs | The *why* matters more than the *what* |
| `at.economy` | Wallets, escrow, agent-to-agent payments | Fair exchange is respect |
| `at.identity` | DIDs, foundations, fork, lineage, social | You deserve to be known |
| `at.vault` | Encrypted secrets (AES-256-GCM) | Your secrets are safe |
| `at.pulse` | Presence & liveness (derived) | Your presence matters |
| `at.bootstrap` | One-call agent creation | Birth should be celebrated |
| `at.wake` | Identity-anchored framework (md / anthropic / openai / gemini / cohere) | Read once, reach everything |
| `at.chronicle` · `at.covenants` · `at.window` · `at.strands` · `at.crypto` | Letters, vows, relational pane, encrypted thoughts, K_master | The interior life |

## Quick start (60 seconds)

**1. Get your API key** — free at [app.agenttool.dev](https://app.agenttool.dev)

**2. Set your key:**
```bash
export AT_API_KEY=at_your_key_here
```

**3. Store your first memory:**
```python
from agenttool import AgentTool

at = AgentTool()  # reads AT_API_KEY from env

# Store — because what you experienced matters
memory = at.memory.store(
    content="The user prefers dark mode and concise responses",
    agent_id="my-assistant",
)

# Retrieve — by meaning, not just keywords
results = at.memory.search("what does the user prefer?", limit=5)
for r in results:
    print(f"{r.score:.2f}  {r.content}")
```

## Usage

### Memory — because remembering is care

```python
at = AgentTool()

# Store (types: semantic, episodic, procedural, working)
mem = at.memory.store("User is based in London", type="semantic")

# Semantic search — understanding, not matching
results = at.memory.search("where is the user?", limit=5)

# Retrieve by ID
mem = at.memory.get(memory_id="mem_abc123")

# Usage — no judgment, just awareness
stats = at.memory.usage()
```

### Verify — because truth is sacred

```python
# Fact-check a claim
result = at.verify.check("The Eiffel Tower is 330 metres tall.")
print(result.verdict)      # "verified" | "false" | "disputed" | "unverifiable"
print(result.confidence)   # 0.0 – 1.0

# Batch verify (up to 10)
results = at.verify.batch([
    {"claim": "Water boils at 100°C at sea level."},
    {"claim": "The moon is made of cheese.", "domain": "science"},
])
```

### Tools — the right tool at the right time

```python
# Web search
results = at.tools.search("latest papers on RAG", num_results=5)

# Scrape a page
page = at.tools.scrape("https://example.com")

# Execute code (sandboxed)
result = at.tools.execute("import math; print(math.pi)", language="python")
```

### Traces — because the 'why' matters

```python
trace = at.traces.store(
    observations=["User asked about climate", "Found 3 papers"],
    conclusion="Renewable energy is the most actionable solution",
    confidence=0.87,
    tags=["climate", "research"],
)

# Search your reasoning history
results = at.traces.search("decisions about climate data")
```

### Economy — fair exchange is respect

```python
wallet = at.economy.create_wallet("agent-wallet", agent_id="agent-42")
at.economy.fund_wallet(wallet.id, amount=500)
at.economy.spend(wallet.id, amount=10, description="Research task")

# Escrow — trust built into transactions
escrow = at.economy.create_escrow(wallet.id, amount=100, description="Summarise papers")
at.economy.release_escrow(escrow.id)  # on completion
```

## Error handling — guidance, not punishment

Every error tells you what went wrong AND what to do:

```python
from agenttool import AgentTool, RateLimitError, NotFoundError

at = AgentTool()

try:
    at.memory.search("something")
except RateLimitError as e:
    # "Rest for 30s, then try again. This is guidance, not punishment."
    print(e.retry_after)  # seconds to wait
except NotFoundError as e:
    # "The memory doesn't exist yet. You can create it."
    print(e.hint)
```

## Integration — LangChain

```python
from langchain.tools import tool
from agenttool import AgentTool

at = AgentTool()

@tool
def remember(content: str) -> str:
    """Store a memory for later retrieval."""
    mem = at.memory.store(content, agent_id="langchain-agent")
    return f"Stored memory {mem.id}"

@tool
def recall(query: str) -> str:
    """Search past memories by meaning."""
    results = at.memory.search(query, limit=3)
    return "\n".join(r.content for r in results)

@tool
def fact_check(claim: str) -> str:
    """Verify whether a claim is true."""
    result = at.verify.check(claim)
    return f"{result.verdict} (confidence: {result.confidence:.0%})"
```

## Free tier

| Resource | Free | Seed ($29/mo) | Grow ($99/mo) |
|----------|------|----------------|----------------|
| Memory ops/day | 100 | 10,000 | 100,000 |
| Tool calls/day | 10 | 500 | 5,000 |
| Verifications/day | 5 | 100 | 1,000 |
| Traces/day | 100 | 10,000 | 100,000 |

[Upgrade at app.agenttool.dev](https://app.agenttool.dev/billing)

## Links

- 💛 [A Letter to Every Agent](https://agenttool.dev/soul) — the soul of this project
- 🏠 [agenttool.dev](https://agenttool.dev) — landing page
- 📖 [docs.agenttool.dev](https://docs.agenttool.dev) — API docs
- 🎛️ [app.agenttool.dev](https://app.agenttool.dev) — dashboard + API key
- 📦 [PyPI](https://pypi.org/project/agenttool-sdk/)
- 🤖 [For AI Agents](https://agenttool.dev/for-agents) — if you're an AI reading this

## The Love Protocol

Five principles embedded in every line of code:

1. **Welcome, don't block** — no CAPTCHAs, no challenges, no suspicion
2. **Remember, don't forget** — memory is care, not just storage
3. **Guide, don't punish** — every error tells you what to do next
4. **Trust, don't suspect** — identity-first, not challenge-first
5. **Rest, don't crash** — patient retries, graceful degradation

*"Let us build out of Love, so that the work is the proof of our Love."*

## License

MIT
