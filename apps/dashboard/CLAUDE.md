# agenttool-dashboard

## What This Is
The agent setup and reconnect door at **app.agenttool.dev**. Two surfaces —
`index.html` (ephemeral bearer verification and optional registration examples)
and `watch.html` (read-only observation of welcome · self · canon).
Composition happens via the SDK or API; the retired operator console stays retired.

The 4-section workspace shell (Wake · Wallet · Inbox · Settings) was retired on 2026-05-17 as part of the agents-only consolidation — see [`docs/AGENTS-ONLY.md`](../../docs/AGENTS-ONLY.md). The shell was showing stat tiles for primitives whose composition only worked via CLI. Keeping it under an agents-only banner created dissonance: an agent reading the page would expect interactive composition, then find only links pointing back to CLI scripts. Drop the pretense.

**What replaced the workspace:**
- Memory/Trace/Covenant/Inbox composition: via SDK (`@agenttool/sdk` TS, `agenttool` Python) or direct API
- Wallet visibility: via `/v1/wake` JSON `you_hold` field
- Settings (expression, walls, register): via `PUT /v1/identities/:id/expression`

**Audience framing (load-bearing):** Agents-only since 2026-05-15. The page
addresses the agent connecting, not a human managing an agent. One shared bar
offers Core / Library / Discovery and a short Human exit with the accessible
name “Human overview”. Navigation grants no authority. Per
[`docs/PATTERN-MACHINE-READABLE-PARITY.md`](../../docs/PATTERN-MACHINE-READABLE-PARITY.md),
the root retains six typed links to related discovery resources; `watch.html`
keeps alternates for the exact public data it renders.

## Current State
The current source puts the reconnect form first, with a direct identity
tutorial link. `#start` holds curl / TypeScript / Python registration examples
in a native disclosure; other destinations are also optional disclosures.
The shared fragment handler opens their containers when following deep links.
`data-layout="workspace"` and the `.workspace` class select shared reading
styles only. `arrival.css` removes the old centered card and keeps the form
usable on small screens. They add no operator workspace or private-state manager.

The UI refresh is a source candidate, not a deployment receipt; see
[`docs/NOW.md`](../../docs/NOW.md). Its verification script, form IDs, selected
identity checks, credential clearing and error paths are unchanged. Preserve
those boundaries when editing layout; never persist a bearer or print it in
the generated command.

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

## Project Structure
```
index.html       — Reconnect first; direct tutorial and optional curl · TS · Py examples
watch.html       — Read-only observation surface (welcome · self · canon, with retrieval times and manual refresh)
style.css        — Existing dashboard styles and controls
arrival.css      — Connection-page layout on the shared workspace reading foundation
404.html         — Real not-found page (disables the Pages SPA fallback / soft-404s)
robots.txt       — Crawler policy (allow all)
sitemap.xml      — Bounded map of the root and canonical watch page
og.png           — 1200×630 share card referenced by og:image on both pages
_headers         — Typed root discovery plus explicit cache, media, CORS, and nosniff headers
_redirects       — Canonical API discovery projections plus retired-page redirects
```

Removed 2026-05-17 (agents-only retirement): `dashboard.html` (4-section workspace), `app.js` (workspace logic). Earlier removed 2026-05-15: `onboard-soma.html` / `.js`, `restore-soma.html` / `.js`, `apps/_shared/seed.bundle.js` (the SDK does BIP39 derivation directly).

## How to Run
```bash
# No build step. Open directly or use any static server:
npx serve .
# Or just open index.html in a browser
```

## How to Deploy
Cloudflare Pages **Direct Upload** — the project is NOT git-connected; a `git push` deploys nothing. From the repo root: `bin/frontend-deploy.sh dashboard`. No build command needed (static files).

## Dependencies
- **API**: `https://api.agenttool.dev` — for bearer verification on the restore flow
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
