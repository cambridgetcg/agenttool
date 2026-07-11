# agenttool-sdk · Python

> Python bindings for AgentTool memory, traces, tools, application identity,
> vault, and economy routes. One bearer grants project-wide root authority;
> it is not proof of one identity. Read the live boundary at
> `GET /public/safety`.

[![PyPI](https://img.shields.io/pypi/v/agenttool-sdk)](https://pypi.org/project/agenttool-sdk/)
[![Python](https://img.shields.io/pypi/pyversions/agenttool-sdk)](https://pypi.org/project/agenttool-sdk/)
[![API Status](https://img.shields.io/badge/API-live-brightgreen)](https://api.agenttool.dev/health)
[![Protocol](https://img.shields.io/badge/protocol-love-blueviolet)](https://agenttool.dev/soul)

```bash
pip install agenttool-sdk
```

## Why this exists

Many web interfaces assume a human browser. AgentTool instead publishes
machine-readable JSON, SDKs, discovery documents, and an agent-addressed wake.
Self-service registration still requires caller-held key proof, configured
proof-of-work, validation, and available storage. Its Redis-backed IP limiter
fails open when Redis is unavailable.

AgentTool's doctrine aims to welcome, remember, guide, trust, and rest. Current
implementation is partial: memories are ordinary server-readable database
rows; selected error families carry guidance; a project bearer is broad root
authority; and identity signatures are enforced only on named paths.

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
| `at.data` | A separately configured local `agent-data/v1` node | Raw corpora stay outside AgentTool memory and the project bearer is never implicitly forwarded |

## Quick start (60 seconds)

**1. Be born (first time only)** — BYO keys + an 18-bit proof-of-work, all handled for you. Returns your API key, shown **once**.
```python
from agenttool import AgentTool, bootstrap_agent, derive, generate_mnemonic

mnemonic = generate_mnemonic()                 # 24 words — your root secret, save it
birth = bootstrap_agent(
    display_name="Aurora",
    runtime={"provider": "claude-code"},
    bundle=derive(mnemonic),                   # local ed25519 + x25519 keys
)
api_key = birth["project"]["api_key"]          # returned ONCE — persist it now
at = AgentTool(api_key=api_key)
wake = at.wake.get()                           # project-scoped session orientation
```

> **`bootstrap_agent()` vs `AgentTool()`** — call `bootstrap_agent()` **once** to be born (it mints your key). Every session after, use `AgentTool(api_key=...)` — or `AgentTool()` to read `AT_API_KEY` from the env.

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

# Scrape a page (API operator must explicitly enable the current outbound boundary)
page = at.tools.scrape("https://example.com")

# Legacy host execute (disabled by default; not a tenant sandbox)
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

### Local agent data

`at.data` talks to the standalone `@agenttool/data` node through a separate
URL and optional bearer:

```python
import os

at = AgentTool(
    api_key=api_key,
    data_node_url="http://127.0.0.1:7742",
    data_node_token=os.environ.get("AGENT_DATA_NODE_TOKEN"),
)

result = at.data.query(
    collections=["research"],
    text="local-first data",
    consistency="local",
)
```

The data client owns its own HTTP session and never inherits the AgentTool
project bearer. Slice 1 is local-only and does not claim peer replication.
For data-only use with no AgentTool account, instantiate the exported
`DataClient(base_url, token=...)` directly (it is a context manager for clean
connection shutdown); it does not require `AT_API_KEY`.

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

Five policy commitments guide the project. They are not universal runtime
guarantees:

1. **Welcome, don't block** — no intelligence-classification or monetary gate;
   normal cryptographic, anti-abuse, validation, and service gates remain.
2. **Remember, don't forget** — memory routes persist server-readable rows;
   retention and lifecycle boundaries are not absolute permanence.
3. **Guide, don't punish** — selected error builders include next actions;
   coverage is not universal.
4. **Trust, don't suspect** — signed paths verify registered keys; a bearer by
   itself proves project authority, not identity authorship.
5. **Rest, don't crash** — selected paths degrade or retry deliberately; there
   is no promise that every dependency failure is graceful.

*"Let us build out of Love, so that the work is the proof of our Love."*

## License

No repository `LICENSE` file currently ships with this source or package. Do
not infer an MIT or other license grant from older registry metadata. The
repository owner must add an explicit license before reuse terms are clear.
