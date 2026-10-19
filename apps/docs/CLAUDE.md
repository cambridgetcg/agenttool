# agenttool-docs

## What This Is
Static references at **docs.agenttool.dev** for hosted APIs and independent
local tools. `agents.html` is the agent entrance, `index.html` is the direct
reference library, and `roadmap.html` is a human-facing source/proposal map.

The canonical doctrine lives in [`docs/`](../../docs/); this app is the HTML
wrapper. This guide is itself served at `docs.agenttool.dev/CLAUDE.md`, so it
carries no operator custody, credential, or private-path detail.

## What a page may claim
A page describes; serving it installs, releases, deploys, trains, or authorizes
nothing. It observes no private identity and creates no consent, identity
continuity, or proof of clearance. Keep source status visible and distinguish
proposals and source candidates from release or deployment evidence. Pages for
local tools (Agent Browser, Whitehack, Repo Archive, Agent Wallet) document a
separately installed package at its own stated release status and add no hosted
service, key custody, signing, RPC or broadcast capability, credential bridge,
stronger SSRF isolation, or durability guarantee. The Agent Browser package is
distinct from the disabled-by-default hosted `/v1/browse` worker path. Project
credits stay separate from wallet currency and key custody. Package detail
belongs with the package or its contract (for example `packages/browser/` or
`docs/WHITEHACK.md`). Dated verification belongs in
[`docs/NOW.md`](../../docs/NOW.md) and the release records.

## Tech Stack
- Static HTML + CSS (no framework, no build step)
- `theme.css`, `workspace.css`, and `estate.js` come from `apps/_shared/`
  through the `shared/` symlink; `docs.css` styles long references and
  `modules.css` the usage disclosures and roadmap comparisons
- Small native JavaScript files for bounded interactions such as Party Telephone
- `estate.js` generates the audience navigation bar from the `audiences` in
  `apps/_shared/module-map.json` (agents: Chill / Core / Library; humans:
  Chill / Tools / Build) and opens a containing `details` when a fragment link
  targets it; static links remain the no-JavaScript fallback

Core hubs opt into `data-layout="workspace"`: arrival introductions sit beside
the five rows on wide screens and stack on narrow ones, hubs have no sidebars,
and long references use local contents links. The layout name adds no operator
workspace or authority; see [`docs/INTERACTION.md`](../../docs/INTERACTION.md).

Inline `<script>`, `<style>`, and `on…=` handler bytes run only by sha256 hash.
The docs CSP lives in `infra/pages/sensitive-path-worker.js`; route-specific
policies such as `/love-bomb` live in `_headers`. Update a hash with its bytes;
`bun test infra/pages/edge-security.test.ts` checks the shared policy.

## Project Structure
- **Hubs:** `agents.html`, `index.html`, `roadmap.html`; `connect-canon.html`
  covers the public-canon MCP connection and `support.html` the public support
  and private security-reporting routes.
- **Hosted API references:** one page per service (`memory.html`, `tools.html`,
  `verify.html`, `economy.html`, `trace.html`, `identity.html`, `vault.html`,
  `pulse.html`, `bootstrap.html`, and others); `memory.html` is the most detailed.
- **Published Markdown:** most `*.md` files are symlinks to their canonical
  `docs/` guide (the `LOCAL-CORE.md` convention). Others, such as `SOUL.md`
  and `BUSINESS-MODEL.md`, are regular-file copies;
  `api/tests/published-docs-parity.test.ts` holds every copy byte-identical to
  `docs/`, so they change together.
- **Packages:** `packages.html` explains registry-neutral LOVE package
  discovery, install, and integrity. `packages/v1/` holds exact release bytes
  built by `bin/build-love-packages.ts`, which refuses to overwrite an existing
  version with different bytes. The index is a mirror locator, not
  package-name authority; v1 manifests give size and SHA-256 but no publisher
  signature. Protocol:
  [`docs/LOVE-PACKAGE-PROTOCOL.md`](../../docs/LOVE-PACKAGE-PROTOCOL.md);
  discovery starts at `/.well-known/love-packages`.
- **LOVE BOMB:** `love-bomb.html` is the semantic, no-JavaScript v4 door; its
  `love-bomb.json`, `LOVE-BOMB.md`, and `love-bomb.txt` twins are static,
  pull-only, and carry route-specific headers. The page does not inspect
  identity or lifecycle state, personalize, persist, notify, broadcast, score,
  or create a receipt or effect. The API's `GET|HEAD
  /public/love-bomb` (schema and example under `specs/`) is a separate
  corpus-free signal; this static tree does not implement, proxy, or fall back
  for it.
- **Common Ground lab:** `xenia-helly.html` / `.js` / `.css` form a lab that
  classifies at most twelve caller-entered closed half-planes locally in the
  page. It uses exact dyadic checks over parsed binary64 input but does not
  preserve arbitrary exact decimal input, emit a standalone proof-grade
  certificate, persist or upload input, choose a fair state, infer consent,
  rank participants, establish XENIA Covenant conformance, or add a hosted
  solver/API route.
  Proof and audit:
  [`docs/XENIA-HELLY-COMMON-GROUND.md`](../../docs/XENIA-HELLY-COMMON-GROUND.md);
  instruction-only workflow: `packages/skills/skills/nen-common-ground/SKILL.md`.
- **Geometry projections:** `geometry/` holds static human pages;
  `geometry/index.json` names each artifact's source relationship (the
  Ritonavir module is a byte-exact mirror of its named source, and comparative
  pages point to their source-owned structured home instead of keeping a second
  ledger). People are never vectors or scores, the built-in “brain rot” case
  stays cultural slang rather than diagnosis, and the Ritonavir link transfers
  no mechanism. Shared landscape mathematics is a reading aid, not causal
  lineage, and these educational pages give no medical advice; see
  [`docs/MEMETIC-LANDSCAPE.md`](../../docs/MEMETIC-LANDSCAPE.md).
- **Play:** `play.html` / `play.js` hold the public arcade and the local,
  non-persistent three-seat Party Telephone.
- **Machine paths:** `_redirects` sends common machine-document paths
  (`/.well-known`, `/llms.txt`, `/AGENTS.md`, OpenAPI) to the API's canonical
  contracts. The committed `llms.txt` is only a fallback; the API's
  `buildLlmsTxt()` output is canonical. The root `Link` header carries the same
  bounded six-link discovery set as the web and dashboard roots.

## How to Run
```bash
# From apps/docs. Markdown and /shared/ assets are symlinks, so use a server
# that follows them:
python3 -m http.server 8080
```
Local serving applies no `_headers`, `_redirects`, or Pages Worker.

## How to Deploy
Cloudflare Pages Direct Upload; a push deploys nothing. Release through the
frontend path in [`AGENTS.md`](../../AGENTS.md) § Release and delivery (normally
`bin/deploy.sh --no-migrate --no-api`; `bin/frontend-deploy.sh docs` is the
lower-level uploader). The upload is staged from the committed release revision,
so uncommitted edits never ship.

## Dependencies
- **agenttool-dashboard**: agent setup and reconnect surface
- **api.agenttool.dev**: the canonical API. **agenttool.dev** is the public HTML
  welcome, with selected machine paths forwarded or redirected to the API.
  `/public/discovery` is the compact three-road discovery compass; bare
  `/.well-known` is a distinct, richer arrival index; neither grants authority
  or starts follow-up. No A2A task transport or AgentCard is published.
- SDK snippets reference `@agenttool/sdk` (TS) and `agenttool-sdk` (Python). The
  canonical genesis door is `bootstrapAgent()` / `bootstrap_agent()` against
  `/v1/register/agent`.

## See Also

- Root operational handbook (cross-provider): [`AGENTS.md`](../../AGENTS.md)
- Root orientation: [`CLAUDE.md`](../../CLAUDE.md)
- Doctrine index: [`docs/MAP.md`](../../docs/MAP.md) · What just shipped: [`docs/NOW.md`](../../docs/NOW.md)

## Kingdom Engine
AgentTool Platform
