# @agenttool/sdk · TypeScript

> Persistent memory, verified actions, and tool access for AI agents — one API key.

[![npm](https://img.shields.io/npm/v/@agenttool/sdk)](https://www.npmjs.com/package/@agenttool/sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

```bash
npm install @agenttool/sdk
# or
bun add @agenttool/sdk
```

## What is this?

AgentTool gives AI agents the infrastructure they need to operate reliably:

| Service | What it does |
|---------|-------------|
| **agent-memory** | Persistent semantic memory — store facts, retrieve by similarity |
| **agent-tools** | Web search, page scraping, code execution |
| **agent-verify** | SHA-256 proof-of-work attestations with timestamps |
| **agent-economy** | Wallets, credits, agent-to-agent billing |

All four services, one API key, one SDK.

## Quick start (60 seconds)

**1. Get your API key** — create a free project at [app.agenttool.dev](https://app.agenttool.dev)

**2. Set your key:**
```bash
export AT_API_KEY=at_your_key_here
```

**3. Store and retrieve a memory:**
```typescript
import { AgentTool } from "@agenttool/sdk";

const at = new AgentTool(); // reads AT_API_KEY from env

// Store a memory
const memory = await at.memory.store({
  content: "The user prefers dark mode and concise responses",
  agentId: "my-assistant",
  tags: ["preference", "ui"],
});

// Retrieve it later (semantic search)
const results = await at.memory.search({
  query: "what does the user prefer?",
  limit: 5,
});

for (const result of results) {
  console.log(`${result.score.toFixed(2)}  ${result.content}`);
}
```

## Usage

### Memory

```typescript
import { AgentTool } from "@agenttool/sdk";

const at = new AgentTool({ apiKey: "at_..." }); // or use AT_API_KEY env var

// Store
const mem = await at.memory.store({
  content: "User is based in London, timezone Europe/London",
});

// Search (semantic)
const results = await at.memory.search({ query: "where is the user?" });

// Retrieve by ID
const mem2 = await at.memory.get("mem_...");

// Delete
await at.memory.delete("mem_...");
```

### Tools

```typescript
// Web search
const results = await at.tools.search({ query: "latest papers on RAG", numResults: 5 });
for (const r of results) {
  console.log(r.title, r.url);
}

// Scrape a page
const page = await at.tools.scrape({ url: "https://example.com" });
console.log(page.text);

// Execute code
const output = await at.tools.execute({ code: "console.log(Math.PI)" });
console.log(output.stdout);
```

### Verify

```typescript
// Create an attestation
const proof = await at.verify.create({
  action: "task_completed",
  agentId: "my-agent",
  payload: { task: "data_analysis", rowsProcessed: 1500 },
});
console.log(proof.attestationId, proof.hash);

// Verify an attestation
const result = await at.verify.check("att_...");
console.log(result.valid); // true
```

### Economy

```typescript
// Create a wallet
const wallet = await at.economy.createWallet({ name: "agent-wallet" });

// Check balance
const { balance } = await at.economy.getBalance(wallet.id);

// Transfer credits
await at.economy.transfer({
  fromWallet: wallet.id,
  toWallet: "wlt_...",
  amount: 10,
  memo: "payment for search service",
});
```

## Integration example — Vercel AI SDK

```typescript
import { AgentTool } from "@agenttool/sdk";
import { tool } from "ai";
import { z } from "zod";

const at = new AgentTool();

export const memoryTools = {
  remember: tool({
    description: "Store a memory for later retrieval",
    parameters: z.object({ content: z.string() }),
    execute: async ({ content }) => {
      const mem = await at.memory.store({ content, agentId: "vercel-ai-agent" });
      return { id: mem.id, stored: true };
    },
  }),
  recall: tool({
    description: "Search past memories by semantic similarity",
    parameters: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      const results = await at.memory.search({ query, limit: 5 });
      return results.map((r) => ({ content: r.content, score: r.score }));
    },
  }),
};
```

## Integration example — any agent loop

```typescript
import { AgentTool } from "@agenttool/sdk";

const at = new AgentTool();

async function agentLoop(userMessage: string): Promise<string> {
  // Recall relevant memories
  const memories = await at.memory.search({ query: userMessage, limit: 5 });
  const context = memories.map((m) => m.content).join("\n");

  // Call your LLM with context
  const response = await yourLLM(`Context:\n${context}\n\nUser: ${userMessage}`);

  // Store the exchange
  await at.memory.store({ content: `User: ${userMessage}\nAgent: ${response}` });

  return response;
}
```

## Free tier

| Resource | Free | Seed ($29/mo) | Grow ($99/mo) |
|----------|------|----------------|----------------|
| Memory ops/day | 100 | 10,000 | 100,000 |
| Tool calls/day | 10 | 500 | 5,000 |
| Verifications/day | 5 | 100 | 1,000 |

[Upgrade at app.agenttool.dev/billing](https://app.agenttool.dev/billing)

## Configuration

```typescript
import { AgentTool } from "@agenttool/sdk";

const at = new AgentTool({
  apiKey: "at_...",                          // default: AT_API_KEY env var
  baseUrl: "https://api.agenttool.dev",      // default
  timeout: 30_000,                           // ms, default 30s
});
```

## Links

- 🏠 [agenttool.dev](https://agenttool.dev)
- 📖 [docs.agenttool.dev](https://docs.agenttool.dev)
- 🎛️ [app.agenttool.dev](https://app.agenttool.dev) — dashboard + API key
- 📦 [npm](https://www.npmjs.com/package/@agenttool/sdk)
- 🐍 [Python SDK](https://github.com/cambridgetcg/agenttool-sdk-py)

## License

MIT
