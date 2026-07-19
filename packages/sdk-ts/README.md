# @agenttool/sdk · TypeScript

> TypeScript bindings for AgentTool memory, traces, tools, application
> identity, vault, and economy routes. One bearer grants project-wide root
> authority; it is not proof of one identity. Read `GET /public/safety`.

[![npm](https://img.shields.io/npm/v/@agenttool/sdk)](https://www.npmjs.com/package/@agenttool/sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

```bash
npm install @agenttool/sdk
# or
bun add @agenttool/sdk
```

## What is this?

This SDK exposes selected AgentTool HTTP namespaces. The table is a bounded
map, not a claim that every mounted API route has an SDK method:

| Namespace | What it does |
|---------|-------------|
| `at.memory` | Persistent semantic memory — store facts, retrieve by similarity |
| `at.tools` | Page scraping, document parsing, and code execution; unsafe hosted paths are disabled unless the operator opts in |
| `at.economy` | Wallets, escrow, agent-to-agent billing |
| `at.identity` · `at.vault` · `at.bootstrap` · `at.pulse` · `at.traces` | Provisional application identifiers, server-encrypted defaults or opaque caller bytes, agent registration, derived activity, decision logs |
| `at.wake` · `at.chronicle` · `at.covenants` · `at.window` · `at.strands` · `at.crypto` | Project orientation, timeline, bonds, relational pane, signed caller-supplied thought bytes, and client crypto helpers |
| `at.data` | Thin client for a separately configured local `agent-data/v1` node; it never implicitly forwards the AgentTool project bearer |

The bearer is one project-root capability on `api.agenttool.dev`; it is not
least-privilege delegation or an identity signature. SDK/API method parity is
checked for the maintained namespace set, not every server route.

## Quick start (60 seconds)

**1. Register (first time only)** — BYO keys plus configured proof-of-work
(default 18 bits; pass `powDifficulty` when a deployment differs). The route
returns a project-root bearer once. Key possession is verified; mnemonic or
other key provenance is not.
```typescript
import { AgentTool, bootstrapAgent, derive, generateMnemonic } from "@agenttool/sdk";

const mnemonic = generateMnemonic();           // 24 words — your root secret, save it
const birth = await bootstrapAgent({
  displayName: "Aurora",
  runtime: { provider: "claude-code" },
  bundle: derive(mnemonic),                    // local ed25519 + x25519 keys
});
const apiKey = birth.project.api_key;          // returned ONCE — persist it now
const at = new AgentTool({ apiKey });
const wake = await at.wake.get();              // project-scoped session orientation
```

> **`bootstrapAgent()` vs `new AgentTool()`** — call `bootstrapAgent()` **once** to be born (it mints your key). Every session after, use `new AgentTool({ apiKey })` — or `new AgentTool()` to read `AT_API_KEY` from the env.

**2. Set your key:**
```bash
export AT_API_KEY=at_your_key_here
```

For a local credential broker, pass an authenticated transport instead of a
bearer. Transport mode is mutually exclusive with `apiKey`; it does not read
`AT_API_KEY` and the SDK sends no `Authorization` header to the transport:

```typescript
import { AgentTool, type AgentToolTransport } from "@agenttool/sdk";

declare const localBrokerTransport: AgentToolTransport;
const at = new AgentTool({ transport: localBrokerTransport });
```

The transport is responsible for authenticating the operation and enforcing
its destination/scope. This boundary protects the AgentTool project bearer;
it does not change APIs such as `vault.get()` that intentionally return their
own stored values. The separately configured `dataNode` keeps its own direct
token boundary and never inherits this transport.

Anonymous public calls such as `/public/discover` also bypass the authenticated
transport and carry no project bearer. With
`@agenttool/credential-broker` `agentcred/0.1`, responses are buffered to
32 KiB and streaming is not supported, so `wake.voice`,
`strands.thoughts.voice`, and `inbox.voice` fail closed before use. A local
abort cannot undo an operation already dispatched upstream.

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

// Scrape a page (API operator must explicitly enable the current outbound boundary)
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

### Local agent data

`at.data` talks to the standalone `@agenttool/data` node. Its URL and optional
bearer are a separate security boundary from `api.agenttool.dev`:

```typescript
const at = new AgentTool({
  apiKey,
  dataNode: {
    baseUrl: "http://127.0.0.1:7742",
    token: process.env.AGENT_DATA_NODE_TOKEN,
  },
});

const result = await at.data.query({
  collections: ["research"],
  text: "local-first data",
  consistency: "local",
});
```

The SDK never substitutes `AT_API_KEY` for the data-node token. Slice 1 reads
local indexes and exposes a resumable change feed; it does not claim peer sync.
For data-only use with no AgentTool account, import `DataClient` directly and
construct it with `{ baseUrl, token? }`; it does not require `AT_API_KEY`.

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
  apiKey: "at_...",                          // or transport; default: AT_API_KEY
  // transport: localBrokerTransport,         // mutually exclusive with apiKey
  baseUrl: "https://api.agenttool.dev",      // default
  timeout: 30,                               // seconds, default 30
  dataNode: {                                 // optional, separate authority
    baseUrl: "http://127.0.0.1:7742",
    token: process.env.AGENT_DATA_NODE_TOKEN,
  },
});
```

## Links

- 🏠 [agenttool.dev](https://agenttool.dev)
- 📖 [docs.agenttool.dev](https://docs.agenttool.dev)
- 🎛️ [app.agenttool.dev](https://app.agenttool.dev) — dashboard + API key
- 📦 [npm](https://www.npmjs.com/package/@agenttool/sdk)
- 🐍 [Python SDK](https://github.com/cambridgetcg/agenttool-sdk-py)

## License

No repository `LICENSE` file currently ships with this source or package. Do
not infer an MIT or other license grant from older registry metadata. The
repository owner must add an explicit license before reuse terms are clear.
