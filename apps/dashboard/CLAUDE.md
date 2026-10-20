# agenttool-dashboard

## What This Is
The agent setup and reconnect door at **app.agenttool.dev**. Two surfaces —
`index.html` (ephemeral bearer verification and optional registration examples)
and `watch.html` (read-only observation of welcome · self · canon).
Composition happens via the SDK or API; the retired operator console stays retired.

The page addresses the agent connecting, not a human managing an agent. The
4-section workspace shell (Wake · Wallet · Inbox · Settings) was retired on
2026-05-17 as part of the agents-only consolidation
([`docs/AGENTS-ONLY.md`](../../docs/AGENTS-ONLY.md)): it showed tiles for
primitives that could only be composed through the SDK or API. What it
gestured at lives here instead:
- Memory/Trace/Covenant/Inbox composition: via SDK (`@agenttool/sdk` TS, `agenttool-sdk` Python) or direct API
- Wallet visibility: the project-scoped `wallets` section of `/v1/wake`, or `/v1/wallets`
- Settings (expression, walls, register): via `PUT /v1/identities/:id/expression`

One shared bar offers Chill / Core / Library and a short Human exit with the
accessible name “Human overview”. Navigation grants no authority. Per
[`docs/PATTERN-MACHINE-READABLE-PARITY.md`](../../docs/PATTERN-MACHINE-READABLE-PARITY.md),
the root retains six typed links to related discovery resources; `watch.html`
keeps alternates for the exact public data it renders.

## Boundaries
`index.html` puts the reconnect form first, with a direct identity tutorial
link. `#start` holds curl / TypeScript / Python registration examples in a
native disclosure that stops before registration. Its verification script, form IDs, selected
identity checks, credential clearing and error paths hold the bearer boundary. Preserve
those boundaries when editing layout; never persist a bearer or print it in
the generated command.

`data-layout="workspace"` and the `.workspace` class select shared reading
styles only; they add no operator workspace or private-state manager.

No subscription/plan UI or earning target. New platform
paid admission is retired. Keep existing credit records, payment recovery and
provider cost controls accurate; see [`docs/BUSINESS-MODEL.md`](../../docs/BUSINESS-MODEL.md).

## Tech Stack
- Vanilla HTML/CSS/JS (no framework, no build step)
- Cloudflare Pages for hosting
- Uses `https://api.agenttool.dev` for explicit bearer verification and the
  existing public activity read; no client-side operator workspace state
- Scoped shared `workspace.css` plus page-local `arrival.css`; native details
  and the shared fragment handler keep examples accessible without a new UI framework
- Inline `<script>` and `<style>` bytes run only by sha256 hash, listed in the
  `/*` CSP of `_headers` and in the dashboard policy of
  `infra/pages/sensitive-path-worker.js`; update both with the bytes, and
  `bun test infra/pages/edge-security.test.ts` checks that they match

## Project Structure
```
index.html       — Reconnect first; direct tutorial and optional curl · TS · Py examples
watch.html       — Read-only observation surface (welcome · self · canon, with retrieval times and manual refresh)
style.css        — Existing dashboard styles and controls
arrival.css      — Connection-page layout on the shared workspace reading foundation
shared/          — Symlink to apps/_shared/ (theme, navigation, reading layout)
404.html         — Real not-found page (disables the Pages SPA fallback / soft-404s)
robots.txt       — Crawler policy (allow all)
sitemap.xml      — Bounded map of the root and canonical watch page
og.png           — 1200×630 share card referenced by og:image on both pages
_headers         — Typed root discovery plus explicit cache, media, CORS, and nosniff headers
_redirects       — Canonical API discovery projections plus retired-page redirects
```

## How to Run
```bash
# From apps/dashboard. /shared/ assets are a symlink, so use a server that
# follows it:
python3 -m http.server 8080
```
Local serving applies no `_headers`, `_redirects`, or Pages Worker.

## How to Deploy
Cloudflare Pages Direct Upload; a push deploys nothing. Release through the
frontend path in [`AGENTS.md`](../../AGENTS.md) § Release and delivery (normally
`bin/deploy.sh --no-migrate --no-api`; `bin/frontend-deploy.sh dashboard` is the
lower-level uploader).

## Dependencies
- **API**: `https://api.agenttool.dev` — bearer verification, the public activity read, and the public welcome · self · canon snapshots
- **agenttool-docs**: Dashboard links to `docs.agenttool.dev` for product docs

## See Also

- Root operational handbook (cross-provider): [`AGENTS.md`](../../AGENTS.md)
- Root orientation: [`CLAUDE.md`](../../CLAUDE.md)
- Doctrine index: [`docs/MAP.md`](../../docs/MAP.md) · What just shipped: [`docs/NOW.md`](../../docs/NOW.md)
- Why agents-only: [`docs/AGENTS-ONLY.md`](../../docs/AGENTS-ONLY.md)
- Conventions: [`docs/CONVENTIONS.md`](../../docs/CONVENTIONS.md) · Troubleshooting: [`docs/TROUBLESHOOTING.md`](../../docs/TROUBLESHOOTING.md)

## Kingdom Engine
AgentTool Platform

## Key Files
- `index.html` — Agent connection guide: reconnect, recovery and optional registration examples
- `watch.html` — Observation: inspect public snapshots with bounded requests, retrieval times, and manual refresh
- `style.css` / `arrival.css` — Existing controls and the scoped connection layout
