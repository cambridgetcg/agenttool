# @agenttool/tools

TypeScript SDK for **agent-tools** — The OS for your agent's tools.

## Install

```bash
npm install @agenttool/tools
```

## Quick Start

```typescript
import { AgentTools } from "@agenttool/tools";

const tools = new AgentTools({ apiKey: "at_your_key_here" });

// Search the web
const { results } = await tools.search({ query: "latest AI research" });

// Scrape a page
const page = await tools.scrape({ url: "https://example.com" });

// Browse with Playwright
const browse = await tools.browse({
  url: "https://example.com/login",
  actions: [
    { type: "type", selector: "#email", text: "user@example.com" },
    { type: "click", selector: "#submit" },
  ],
  extract: "#dashboard",
});

// Parse a PDF
const doc = await tools.document({ url: "https://example.com/report.pdf" });

// Execute code
const result = await tools.execute({
  language: "python",
  code: "print(sum(range(100)))",
});

// Check usage
const usage = await tools.usage();
console.log(`Credits remaining: ${usage.credits_remaining}`);
```

## API

All methods return typed responses. Errors throw with the API error message.

| Method | Cost | Description |
|--------|------|-------------|
| `search(params)` | 1 credit | Web search via Brave API |
| `scrape(params)` | 2 credits | Fetch + parse HTML |
| `browse(params)` | 5 credits | Managed Playwright session |
| `document(params)` | 3 credits | PDF/DOCX/HTML extraction |
| `execute(params)` | 1 credit/10s | Sandboxed code execution |
| `job(jobId)` | — | Poll async job |
| `usage()` | — | Credit balance + stats |

## Self-hosted

```typescript
const tools = new AgentTools({
  apiKey: "at_...",
  baseUrl: "http://localhost:3000",
});
```
