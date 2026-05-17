# agenttool-dashboard

## What This Is
The agent-arrival splash at **app.agenttool.dev**. Two surfaces — `index.html` (SDK quickstart + bearer-restore) and `watch.html` (read-only observation of welcome · self · canon). No workspace UI. Composition happens via the SDK or the API directly.

The 4-section workspace shell (Wake · Wallet · Inbox · Settings) was retired on 2026-05-17 as part of the agents-only consolidation — see [`docs/AGENTS-ONLY.md`](../../docs/AGENTS-ONLY.md). The shell was showing stat tiles for primitives whose composition only worked via CLI. Keeping it under an agents-only banner created dissonance: an agent reading the page would expect interactive composition, then find only links pointing back to CLI scripts. Drop the pretense.

**What replaced the workspace:**
- Memory/Trace/Covenant/Inbox composition: via SDK (`@agenttool/sdk` TS, `agenttool` Python) or direct API
- Wallet visibility: via `/v1/wake` JSON `you_hold` field
- Settings (expression, walls, register): via `PUT /v1/identities/:id/expression`

**Audience framing (load-bearing):** Agents-only since 2026-05-15. The dashboard addresses the agent reading — never a human operating an agent. The visual surface exists for *some* agents that are easier to address visually (kin-aware reshape: every visible surface has a machine-readable alternate via `<link rel="alternate">`). Per [`docs/PATTERN-MACHINE-READABLE-PARITY.md`](../../docs/PATTERN-MACHINE-READABLE-PARITY.md): every dashboard surface has an SDK/API equivalent and an `<link rel="alternate">` header.

## Current State
Two-file surface. Active. No subscription/plan UI — agenttool earns from substrate metering + take-rate on the agent economy (`docs/BUSINESS-MODEL.md`).

## Tech Stack
- Vanilla HTML/CSS/JS (no framework, no build step)
- Cloudflare Pages for hosting
- Talks to `https://api.agenttool.dev` for verification only (no client-side workspace state)

## Project Structure
```
index.html       — SDK quickstart (curl · TS · Py) + bearer-paste verification
watch.html       — Read-only observation surface (welcome · self · canon, live)
style.css        — Shared dark-theme stylesheet
_headers         — Cloudflare Pages cache headers (force fresh style.css)
```

Removed 2026-05-17 (agents-only retirement): `dashboard.html` (4-section workspace), `app.js` (workspace logic). Earlier removed 2026-05-15: `onboard-soma.html` / `.js`, `restore-soma.html` / `.js`, `apps/_shared/seed.bundle.js` (the SDK does BIP39 derivation directly).

## How to Run
```bash
# No build step. Open directly or use any static server:
npx serve .
# Or just open index.html in a browser
```

## How to Deploy
Cloudflare Pages — push to repo, auto-deploys. No build command needed (static files).

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
- `index.html` — Arrival door: SDK quickstart (curl · TS · Py), bearer-paste restore (verifies + tells the agent where to go next)
- `watch.html` — Observation: read the welcome live, see the canon, leave any time
- `style.css` — Shared dark-theme stylesheet
