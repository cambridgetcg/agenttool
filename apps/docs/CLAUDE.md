# agenttool-docs

## What This Is
API documentation site for the AgentTool platform. Static HTML pages covering all 9 services: Memory, Tools, Verify, Economy, Trace, Identity, Vault, Pulse, and Bootstrap. Hosted at docs.agenttool.dev.

## Current State
Active — all 9 service pages live, plus the main index, local agent-data docs,
and a LOVE Package Protocol surface for public exact-version package discovery.
The package index is a mirror locator, not package-name authority; optional npm
discovery is a convenience, while v1 manifests provide artifact size and
SHA-256 integrity but no publisher signature. The Whitehack page documents a
pinned runner-local heuristic advisory, separately scoped security research,
and the privacy-sensitive legacy device inventory; it is not a hosted scanner.

## Tech Stack
- Static HTML + CSS (no framework, no build step)
- Single shared `style.css` (dark theme matching landing page)
- Small native JavaScript files for bounded interactions such as Party Telephone

## Project Structure
```
index.html      — Docs home: quick start, service cards, auth, errors, rate limits
packages.html   — love-package/v1 discovery, exact tarball/npm installs, verification, mirrors
play.html       — Public arcade plus the local three-seat Party Telephone game
play.js         — Party Telephone's three-turn state, validation, erasure, and reveal
whitehack.html  — pinned advisory, research authorization, and legacy inventory boundaries
memory.html     — agent-memory API reference (CRUD + semantic search)
tools.html      — agent-tools API reference (search, scrape, browse, execute, document)
verify.html     — agent-verify API reference (fact-checking)
economy.html    — agent-economy API reference (wallets, escrow, billing)
trace.html      — agent-trace API reference (reasoning provenance)
identity.html   — agent-identity API reference (provisional AgentTool identifiers, attestations, trust)
vault.html      — agent-vault API reference (encrypted secrets)
pulse.html      — agent-pulse API reference (heartbeats, presence)
bootstrap.html  — agent-bootstrap API reference (initial project records and key material)
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
- **agenttool-dashboard**: SDK-quickstart surface (agents-only since 2026-05-15 — no operator registration form); SDK / curl links route through here
- **agenttool.dev apex**: the API itself. Logo links route to `/v1/welcome`; live discovery is MCP, wake-keystone, agent.txt, llms.txt, and pyramid. A2A task transport and AgentCards are pending
- References SDK snippets from `@agenttool/sdk` (TS) and `agenttool-sdk` (Python). Canonical genesis door: `bootstrap_agent()` / `bootstrapAgent()` against `/v1/register/agent`

## See Also

- Root operational handbook (cross-provider): [`AGENTS.md`](../../AGENTS.md)
- Root orientation: [`CLAUDE.md`](../../CLAUDE.md)
- Doctrine index: [`docs/MAP.md`](../../docs/MAP.md) · What just shipped: [`docs/NOW.md`](../../docs/NOW.md)
- The docs site renders the doctrine; the canonical doctrine lives in [`docs/`](../../docs/) — this app is the HTML wrapper.
- Package discovery starts at `/.well-known/love-packages`; canonical protocol
  truth lives in [`docs/LOVE-PACKAGE-PROTOCOL.md`](../../docs/LOVE-PACKAGE-PROTOCOL.md).
  Release files under `packages/v1/` are explicit generated artifacts, not a
  hand-maintained registry or an automatic consequence of opening the docs app.

## Kingdom Engine
AgentTool Platform

## Key Files
- `index.html` — Main docs page: quick start guide, service overview, auth, errors, rate limits
- `packages.html` — Registry-neutral package discovery, install, integrity, and mirror guide
- `play.html` / `play.js` — Human arcade and local, non-persistent Party Telephone table
- `whitehack.html` — Whitehack advisory and privacy/authorization boundaries
- `memory.html` — Most detailed endpoint reference (the flagship service)
- `tools.html` — Search, scrape, browse, execute, document parsing endpoints
- `style.css` — Shared stylesheet with endpoint styling, sidebar, code blocks
