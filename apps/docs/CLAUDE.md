# agenttool-docs

## What This Is
API documentation site for the AgentTool platform. Static HTML pages covering all 9 services: Memory, Tools, Verify, Economy, Trace, Identity, Vault, Pulse, and Bootstrap. Hosted at docs.agenttool.dev.

## Current State
Active — all 9 service pages live, plus the main index, local agent-data docs,
local Agent Browser docs, and a LOVE Package Protocol surface for public
exact-version package discovery.
It also serves the Agent Wallet 0.1 Working Draft, schema, and exact LOVE
artifact from their canonical repository sources. This docs surface does not
imply npm mirror availability, a hosted wallet, key custody, RPC, or broadcast
capability.
The Repo Archive surface serves its overview, experimental 0.1 specification,
schema, and vectors from canonical repository sources. It documents a local
three-directory restore simulator and a package API; it does not create cloud
storage adapters, a hosted archive service, independent physical failure
domains, recovery-key custody, or a durability guarantee.
The Agent Browser page documents a separately installed local runtime with
TypeScript, JSONL, and stdio MCP doors. Its main-response discovery hints are
bounded and untrusted; the docs deployment does not create a hosted browser,
ambient recognition action, credential bridge, or stronger SSRF isolation.
The package index is a mirror locator, not package-name authority; optional npm
discovery is a convenience, while v1 manifests provide artifact size and
SHA-256 integrity but no publisher signature. The Whitehack page documents a
runner-local crypto-aware heuristic advisory using the exact public
`@agenttool/whitehack-scan@0.8.0` package, a separate local Agent Wallet
record-to-understanding projection, separately scoped security research, and
the privacy-sensitive legacy device inventory. The CI lock, registry signature,
and provenance checks bind that one scanner input. Neither the static signals
nor the local projection adds key custody, signing, wallet/RPC/simulation/
broadcast capability, authorization, execution-readiness proof, or a hosted
route.

## Tech Stack
- Static HTML + CSS (no framework, no build step)
- Single shared `style.css` (dark theme matching landing page)
- Small native JavaScript files for bounded interactions such as Party Telephone

## Project Structure
```
index.html      — Docs home: quick start, service cards, auth, errors, rate limits
packages.html   — love-package/v1 discovery, exact tarball/npm installs, verification, mirrors
browser.html    — local Agent Browser install, seven-tool loop, integrations, response hints
play.html       — Public arcade plus the local three-seat Party Telephone game
play.js         — Party Telephone's three-turn state, validation, erasure, and reveal
whitehack.html  — crypto-aware advisory, local wallet understanding, research, and legacy inventory boundaries
AGENT-WALLET-0.1.md — symlink to the provider-neutral wallet Working Draft
agent-wallet-v0.1.schema.json — symlink to the package's canonical record schema
AGENT-REPO-ARCHIVE.md — symlink to the local encrypted Git archive overview
specs/AGENT-REPO-ARCHIVE-0.1.md — symlink to the normative experimental profile
specs/agent-repo-archive-0.1.schema.json — public alias for the package schema
specs/agent-repo-archive-0.1-vectors.json — public alias for the package vectors
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
- `browser.html` — Local Agent Browser, exact package install, seven-tool contract, and integration boundaries
- `play.html` / `play.js` — Human arcade and local, non-persistent Party Telephone table
- `whitehack.html` — Whitehack crypto-awareness, local wallet understanding, no-custody, privacy, and authorization boundaries
- `AGENT-WALLET-0.1.md` / `agent-wallet-v0.1.schema.json` — wallet protocol discovery; exact release bytes live under `packages/v1/`
- `AGENT-REPO-ARCHIVE.md` / `specs/AGENT-REPO-ARCHIVE-0.1.md` — local archive overview and normative profile; schema and vectors live beside the profile
- `memory.html` — Most detailed endpoint reference (the flagship service)
- `tools.html` — Search, scrape, browse, execute, document parsing endpoints
- `style.css` — Shared stylesheet with endpoint styling, sidebar, code blocks
