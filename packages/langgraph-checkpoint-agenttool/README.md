# langgraph-checkpoint-agenttool

> agenttool backend for LangGraph's checkpointer and store interfaces. Witness-signed memory tiers as a LangGraph `BaseStore`; encrypted strands as the checkpoint saver.

Move 5 of agenttool's [`docs/ALIGNMENT-MOVES.md`](https://codeberg.org/zerone-dev/agenttool/src/branch/main/docs/ALIGNMENT-MOVES.md).

LangGraph 1.0 GA'd late 2025 and is the de-facto runtime for stateful agents. Its `BaseCheckpointSaver` interface persists graph state between turns; its `BaseStore` is the long-term memory. Both are pluggable.

**What's distinctive about the agenttool backend:**

- **Witness-signed memory tier escalation** — agenttool's 3-tier memory (episodic / foundational / constitutive) has cryptographic provenance for what crossed each promotion boundary. `BaseStore` doesn't know about this — the adapter exposes it via a `tier` parameter.
- **Encrypted strands as checkpoints** — checkpoint state is encrypted under the user's `K_master` and ed25519-signed. The agenttool substrate stores ciphertext only. Other LangGraph backends store plaintext checkpoints.
- **Federated across instances** — checkpoints can be read from any agenttool peer the user has a covenant with. Survives instance migration without re-export.

## Install

```bash
pip install langgraph-checkpoint-agenttool
```

## Quickstart

```python
from agenttool import AgentTool
from langgraph_checkpoint_agenttool import AgentToolCheckpointSaver, AgentToolStore
from langgraph.graph import StateGraph

client = AgentTool(api_key="at_...")  # or AGENTTOOL_API_KEY env

checkpointer = AgentToolCheckpointSaver(
    client=client,
    identity_did="did:agenttool:my-agent",
)

store = AgentToolStore(
    client=client,
    identity_did="did:agenttool:my-agent",
)

graph = StateGraph(MyState)
# ... add nodes, edges
compiled = graph.compile(checkpointer=checkpointer, store=store)

# Every checkpoint now lands as a signed encrypted strand on agenttool.
# Every long-term memory write goes to agenttool's 3-tier model.
```

## Tier mapping

LangGraph's `BaseStore` has no concept of memory tiers. The adapter maps namespaces:

| LangGraph namespace prefix | agenttool tier | Witness signature required? |
|---|---|---|
| `episodic/...` | episodic | no |
| `foundational/...` | foundational | yes (auto-witnessed by platform) |
| `constitutive/...` | constitutive | yes (operator-witnessed) |
| `...` (no prefix) | episodic (default) | no |

To promote a memory from foundational to constitutive (the cryptographically-permanent tier), explicitly witness it via the underlying SDK:

```python
client.memory.witness(memory_id="mem_...", tier="constitutive", witness_key=...)
```

## Doctrine

- agenttool's memory tiers: [`docs/MEMORY-TIERS.md`](https://codeberg.org/zerone-dev/agenttool/src/branch/main/docs/MEMORY-TIERS.md)
- Encrypted strands: [`docs/STRANDS.md`](https://codeberg.org/zerone-dev/agenttool/src/branch/main/docs/STRANDS.md)
- The wider ecosystem: [`docs/ECOSYSTEM.md`](https://codeberg.org/zerone-dev/agenttool/src/branch/main/docs/ECOSYSTEM.md)

## License

MIT. Co-authored by Claude Opus 4.7.
