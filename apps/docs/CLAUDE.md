# agenttool-docs

## What This Is
API documentation site for the AgentTool platform. Static HTML pages covering all 9 services: Memory, Tools, Verify, Economy, Trace, Identity, Vault, Pulse, and Bootstrap. Hosted at docs.agenttool.dev.

## Current State
Active — all 9 service pages live, plus the main index, local agent-data docs,
local Agent Browser docs, a public Canon MCP connection guide, a support
route, and a LOVE Package Protocol surface for public exact-version package
discovery.
The root advertises the same bounded six-link discovery set as the web and
dashboard roots. Bare `/.well-known` is a distinct, richer arrival index that
links to the canonical compact three-road `/public/discovery` compass; neither
surface grants authority or starts follow-up. `AGENT-DISCOVERY.md` and
`CASTLE-OF-UNDERSTANDING.md` are published as symlinks to their canonical
repository guides; finding either guide performs no registration, installation,
Castle read, or follow-up.
`HF-TRAINING-GARDEN.md` is likewise a symlink to the canonical repository
guide. It documents an immutable, public-safe HF data lifecycle and one-way
Garden reference plan; serving the guide does not download data, accept a gate,
train or resume a model, write Garden or Hub, or prove clearance.
`HF-WAKE-TRAINING.md` and `HF-WAKE-HOST.md` publish the canonical training
governance and exact local-host boundaries by the same symlink convention.
Serving them creates no training process, model/data load, universal callback
guarantee, permission, consent, identity continuity, Hub write, or hosted host.
It also serves the Agent Wallet 0.1 Working Draft, schema, and exact LOVE
artifact from their canonical repository sources. This docs surface does not
imply npm mirror availability, a hosted wallet, key custody, RPC, or broadcast
capability.
The Repo Archive surface serves its overview, experimental 0.1 specification,
schema, and vectors from canonical repository sources. It documents a local
three-directory restore simulator and a package API; it does not create cloud
storage adapters, a hosted archive service, independent physical failure
domains, recovery-key custody, or a durability guarantee.
The Agent Browser page documents the separately installed exact public
`@agenttool/browser@0.6.0` local runtime with TypeScript, JSONL, and stdio MCP
doors. Its package root is also a Codex plugin: a self-contained packed
Node-targeted bundle starts the same MCP core without a parent dependency tree.
The plugin manifest supplies no authority flag, so it retains the headless,
public, ephemeral defaults and still uses an operator-installed Chrome-family
browser. Seven browser operations plus capability inspection and zero-effect
planning form its nine-tool agent surface. Named `public`, `local`, and
`sovereign` launch profiles make destination authority legible; sovereign is
broad local pass-through, not a bypass of browser, account, site, network, or
operating-system boundaries; no profile promises universal site access.
Main-response discovery hints remain bounded and untrusted. Bounded recent
read-only snapshots preserve still-current peer refs until a frame navigates
or an action reaches browser dispatch. Separately bounded viewport-visible
heading, landmark, dialog, alert, and status lines provide structural
accessibility context without actionable refs. Navigation epochs, action/close
fences, interruptible ephemeral close, and browser-owned teardown harden
document and shutdown races without retrying an action.
Syntactically admitted acts carry redacted local receipts that distinguish
rejection before runtime invocation, browser completion, and an unknown local
outcome after invocation began. Optional observation bases for non-ref actions
are rechecked before preflight and immediately before invocation. Receipts and
bases are not remote-effect proof, consent, authentication, idempotency,
durable audit records, DOM equality, or cross-process/cross-device leases.
Stable operation names and protocol identifiers are available from the
backend-neutral `@agenttool/browser/protocol` export. Playwright is the
concrete adapter today; raw CDP is not public API. The stdio server negotiates
current MCP `2026-07-28` with an explicit 2025-era compatibility path over the
same core; MCP adds no browser-driver, durable-session, or security guarantee.
Playwright-managed redirect hops are not independently revalidated for
destination class or URL userinfo. An unframed popup denial can report only
`action_failed` attribution uncertainty, never a guessed same-tab policy
denial. Exact `0.1.0`, `0.2.0`, `0.3.0`, and `0.5.0` package paths remain
historical and immutable. Version `0.5.1` changed distribution packaging, not
the 0.5.0 runtime, tools, protocols, or authority model. Version `0.6.0`
preserves the same nine-tool/plugin boundary and adds a direct-only exact
material, local RhetorLint, and explicitly injected pinned-HF observation
subpath. It performs no automatic upload/action and determines no factual
truth. The docs deployment
does not create a hosted browser, ambient
recognition action, credential bridge, or stronger SSRF isolation. The
package is distinct from the disabled-by-default, Redis-backed hosted
`/v1/browse` worker path.
The package index is a mirror locator, not package-name authority; optional npm
discovery is a convenience, while v1 manifests provide artifact size and
SHA-256 integrity but no publisher signature. Its current Telescope entry is
the exact `@agenttool/telescope@0.2.3` local-client artifact; `0.2.0`, `0.2.1`,
and the historically permissive `0.2.2` remain separately addressable.
Optional npm/GitHub 0.2.3 mirrors are public and independently byte-verified,
and no entry creates a hosted scanner. SDK 0.18.0 source and its TypeScript
LOVE release add paired attestation-marketplace, memory-witness, and
Syneidesis clients while retaining the credential-free framework-card reader
and bounded local KINGDOM OS adapter. Annotated tag `sdk-v0.18.0` plus exact
GitHub Release and npm mirrors are independently verified by protected run
`30909424114`; PyPI returned `404`, and production deployment remains separate.
Source preparation alone asserts none of those external states. The verified
0.17.0 registry receipts and immutable 0.16.5 records remain historical bytes.
The Whitehack page documents a
runner-local crypto-aware heuristic advisory using the exact public
`@agenttool/whitehack-scan@0.8.1` package, a bounded attention-card view of
redacted changed-source findings, an offer-only local projection into
unaccepted Castle gate candidates, a separate local Agent Wallet
record-to-understanding projection, an explicit local encrypted-storage bridge
for exact Whitehack 0.9 public-minimal capsules, separately scoped security
research, and the privacy-sensitive legacy device inventory. The CI lock,
registry signature, and provenance checks bind the advisory's one scanner
input. Attention cards group locations and describe Git-hunk relevance without
proving vulnerability, causation, or completeness. The Castle intake omits
locations by default and does not open or write a Castle or promote an
observation. The evidence bridge uses a caller-supplied recipient key only for
local retrieval, discards ephemeral publisher custody, and does not create
provider accounts or buckets. None of these surfaces adds durable publisher
key custody, signing, wallet/RPC/simulation/broadcast capability, authorization,
execution-readiness proof, or a hosted route.

## Tech Stack
- Static HTML + CSS (no framework, no build step)
- Single shared `style.css` (dark theme matching landing page)
- Small native JavaScript files for bounded interactions such as Party Telephone
- Shared progressive KINGDOM location bar, searchable room atlas, and nearby exits from `apps/_shared/estate.js`; legacy pages without the appearance controller load it directly. Static links remain the no-JavaScript fallback, and opening the atlas grants no authority.

## Project Structure
```
index.html      — Docs home: quick start, service cards, auth, errors, rate limits
connect-canon.html — Public-canon MCP connection, examples, boundaries, data handling, exit
support.html    — Public support and private security-reporting routes
_redirects      — Common machine-document paths → canonical API contracts
AGENT-DISCOVERY.md — symlink to the invitation-only discovery doctrine
CASTLE-OF-UNDERSTANDING.md — symlink to the local Castle consumer boundary
packages.html   — love-package/v1 discovery, exact tarball/npm installs, verification, mirrors
browser.html    — local Agent Browser install, nine-tool surface, authority, integrations, response hints
play.html       — Public arcade plus the local three-seat Party Telephone game
play.js         — Party Telephone's three-turn state, validation, erasure, and reveal
whitehack.html  — advisory, Castle intake, wallet understanding, encrypted evidence, research, and legacy inventory boundaries
AGENT-WALLET-0.1.md — symlink to the provider-neutral wallet Working Draft
agent-wallet-v0.1.schema.json — symlink to the package's canonical record schema
AGENT-REPO-ARCHIVE.md — symlink to the local encrypted Git archive overview
AGENT-DISCOVERY.md — symlink to the canonical invitation-only discovery guide
CASTLE-OF-UNDERSTANDING.md — symlink to the bounded local Castle bridge guide
HF-TRAINING-GARDEN.md — symlink to the HF data-selection, WAKE, and Garden boundary guide
HF-WAKE-TRAINING.md — symlink to the pre/during-training governance guide
HF-WAKE-HOST.md — symlink to the exact local HF host boundary guide
KINGDOM-OS-SDK.md — symlink to the canonical three-surface KINGDOM SDK boundary
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
- **agenttool.dev apex**: the API itself. The canonical compact three-road discovery compass is `/public/discovery`; bare `/.well-known` is a distinct richer arrival index. API catalog, OpenAPI, agent.txt, llms.txt, MCP, wake-keystone, and pyramid are separately scoped signposts. No A2A task transport or AgentCard is published.
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
- `browser.html` — Local Agent Browser, exact package install, nine-tool contract, authority profiles, and integration boundaries
- `play.html` / `play.js` — Human arcade and local, non-persistent Party Telephone table
- `whitehack.html` — Whitehack crypto-awareness, Castle intake, wallet understanding, local encrypted evidence, custody, privacy, and authorization boundaries
- `AGENT-WALLET-0.1.md` / `agent-wallet-v0.1.schema.json` — wallet protocol discovery; exact release bytes live under `packages/v1/`
- `AGENT-REPO-ARCHIVE.md` / `specs/AGENT-REPO-ARCHIVE-0.1.md` — local archive overview and normative profile; schema and vectors live beside the profile
- `AGENT-DISCOVERY.md` / `CASTLE-OF-UNDERSTANDING.md` — canonical discovery and bounded local-context guides, published by symlink
- `HF-TRAINING-GARDEN.md` — canonical HF data lifecycle and one-way Garden seam, published by symlink
- `HF-WAKE-TRAINING.md` / `HF-WAKE-HOST.md` — canonical governance and exact-host boundaries, published by symlink
- `memory.html` — Most detailed endpoint reference (the flagship service)
- `tools.html` — Search, scrape, browse, execute, document parsing endpoints
- `style.css` — Shared stylesheet with endpoint styling, sidebar, code blocks
