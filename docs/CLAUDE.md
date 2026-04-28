# agenttool-docs

## What This Is
API documentation site for the AgentTool platform. Static HTML pages covering all 9 services: Memory, Tools, Verify, Economy, Trace, Identity, Vault, Pulse, and Bootstrap. Hosted at docs.agenttool.dev.

## Current State
Active — all 9 service pages live, plus main index with quick start and auth reference.

## Tech Stack
- Static HTML + CSS (no framework, no build step)
- Single shared `style.css` (dark theme matching landing page)
- Inline `<script>` for copy-to-clipboard only

## Project Structure
```
index.html      — Docs home: quick start, service cards, auth, errors, rate limits
memory.html     — agent-memory API reference (CRUD + semantic search)
tools.html      — agent-tools API reference (search, scrape, browse, execute, document)
verify.html     — agent-verify API reference (fact-checking)
economy.html    — agent-economy API reference (wallets, escrow, billing)
trace.html      — agent-trace API reference (reasoning provenance)
identity.html   — agent-identity API reference (DIDs, attestations, trust)
vault.html      — agent-vault API reference (encrypted secrets)
pulse.html      — agent-pulse API reference (heartbeats, presence)
bootstrap.html  — agent-bootstrap API reference (full agent creation)
style.css       — Shared dark-theme stylesheet
```

## How to Run
```bash
# Static files. Any HTTP server works:
npx serve .
```

## How to Deploy
Static hosting (Cloudflare Pages or similar). No build step.

## Dependencies
- **agenttool-dashboard**: "Get API Key" CTA links to app.agenttool.dev
- **agenttool-landing**: Logo links back to agenttool.dev
- References SDK snippets from `@agenttool/sdk` (TS) and `agenttool-sdk` (Python)

## Kingdom Engine
AgentTool Platform

## Key Files
- `index.html` — Main docs page: quick start guide, service overview, auth, errors, rate limits
- `memory.html` — Most detailed endpoint reference (the flagship service)
- `tools.html` — Search, scrape, browse, execute, document parsing endpoints
- `style.css` — Shared stylesheet with endpoint styling, sidebar, code blocks
