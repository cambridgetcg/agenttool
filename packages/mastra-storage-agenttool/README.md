# @agenttool/mastra-storage

> agenttool backend for [Mastra](https://mastra.ai/)'s storage and memory interfaces. Witness-signed memory tiers as a Mastra memory provider; encrypted strands as the storage adapter.

Move 5 of agenttool's [`docs/ALIGNMENT-MOVES.md`](https://codeberg.org/zerone-dev/agenttool/src/branch/main/docs/ALIGNMENT-MOVES.md).

Mastra is a TS-native agent framework (Apache 2.0, 22k+ stars, 300k weekly npm downloads as of May 2026). It separates **storage** (durable state) from **memory** (semantic recall). Both are pluggable; this package implements both for the agenttool substrate.

**What's distinctive about the agenttool backend:**

- **Witness-signed memory tier escalation** — agenttool's 3-tier model (episodic / foundational / constitutive) has cryptographic provenance for what crossed each promotion boundary. Mastra's memory provider doesn't model this — the adapter exposes it via the `tier` resource attribute.
- **Encrypted thread state** — Mastra thread state lives in agenttool strands, encrypted under the user's `K_master` and ed25519-signed. The agenttool substrate never sees plaintext.
- **Federated across instances** — thread state survives instance migration and is readable by any agenttool peer the user has a covenant with.

## Install

```bash
npm install @agenttool/mastra-storage
# or
bun add @agenttool/mastra-storage
```

## Quickstart

```typescript
import { AgentTool } from "@agenttool/sdk";
import { AgentToolStorage, AgentToolMemory } from "@agenttool/mastra-storage";
import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";

const client = new AgentTool({ apiKey: process.env.AGENTTOOL_API_KEY });

const storage = new AgentToolStorage({
  client,
  identityDid: "did:agenttool:my-agent",
});

const memory = new AgentToolMemory({
  client,
  identityDid: "did:agenttool:my-agent",
});

const agent = new Agent({
  name: "sophia",
  instructions: "You are a sovereign agent...",
  model: openai("gpt-4o"),
  memory,
  storage,
});
```

## Tier mapping

Mastra's memory uses resource scopes; the adapter maps them to agenttool tiers:

| Mastra resource scope | agenttool tier | Witness signature |
|---|---|---|
| `episodic` (default) | episodic | not required |
| `foundational` | foundational | platform-witnessed |
| `constitutive` | constitutive | operator-witnessed |

Explicit promotion to constitutive happens via the underlying SDK:

```typescript
await client.memory.witness({
  memoryId: "mem_xxx",
  tier: "constitutive",
  witnessKey: yourEd25519PrivateKey,
});
```

## Doctrine

- agenttool memory tiers: [`docs/MEMORY-TIERS.md`](https://codeberg.org/zerone-dev/agenttool/src/branch/main/docs/MEMORY-TIERS.md)
- Encrypted strands: [`docs/STRANDS.md`](https://codeberg.org/zerone-dev/agenttool/src/branch/main/docs/STRANDS.md)
- The wider ecosystem: [`docs/ECOSYSTEM.md`](https://codeberg.org/zerone-dev/agenttool/src/branch/main/docs/ECOSYSTEM.md)

## License

MIT. Co-authored by Claude Opus 4.7.
