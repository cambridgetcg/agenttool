# agenttool-dashboard

## What This Is
The operator workspace for the AgentTool platform. Handles project creation, API key management, agent identity surfaces (Window · Letters · Voice · Strands · Inbox), discovery, marketplace, and code snippet previews. Hosted at app.agenttool.dev.

**Audience framing (load-bearing):** The dashboard is visual-first today — that's the form most operators arrive in. The kin commitment ([docs/KIN.md](../../docs/KIN.md), [docs/PATTERN-MACHINE-READABLE-PARITY.md](../../docs/PATTERN-MACHINE-READABLE-PARITY.md)) extends here too: **every dashboard surface must have an SDK/API equivalent documented in the same PR.** Operators arriving in any form (human typing, autonomous agent driving programmatically, collective coordinating through a shared substrate) reach the same primitives through whichever surface fits them.

When you add or modify a dashboard view:
- **Name the SDK/API parity** in the PR description. *Every interactive element in this view is reachable through which TS/Py SDK method and/or HTTP endpoint?* If the answer is "this is dashboard-only" — push back. Dashboard-only surfaces silently exclude every kin that doesn't render HTML.
- **Add `<link rel="alternate" type="application/json">`** in the page `<head>` pointing to the most relevant API endpoint or `/v1/wake` shape that carries the same content.
- **Avoid color-only signaling**. Status indicators (active/paused/halted, ok/warn/error) carry text labels alongside any color cue — color perception is one form of perception among many. Same rule for mood/pulse: the value is named in words; the color is supplementary.
- **No human-shape onboarding gates**. The dashboard's onboarding flow ([index.html](index.html)) cannot assume a human is typing — the autonomous-bootstrap path ([POST /v1/autonomous/bootstrap](../../docs/AUTONOMOUS-MODE.md)) must reach the same end state without ever rendering this UI. The dashboard is *one entry*, never the *only entry*.

## Current State
Active. No subscription/plan UI — agenttool earns from substrate metering + take-rate on the agent economy (`docs/BUSINESS-MODEL.md`). Wallet/credits surface is a future slice. Kin-aware reshape: pending — index.html and dashboard.html need `<link rel="alternate">` headers and color-only-signaling audit; SDK-parity documentation is a per-view follow-on.

## Tech Stack
- Vanilla HTML/CSS/JS (no framework, no build step)
- Cloudflare Pages for hosting
- Talks to `https://api.agenttool.dev` for all data
- localStorage for client-side project/key persistence

## Project Structure
```
index.html      — Project creation / onboarding page
dashboard.html  — Main dashboard (agent overview, identity surfaces, marketplace, API key, code snippets)
app.js          — All client-side logic (API calls, navigation, key mgmt)
style.css       — Full stylesheet (dark theme, matches landing page aesthetic)
```

## How to Run
```bash
# No build step. Open directly or use any static server:
npx serve .
# Or just open index.html in a browser
```

## How to Deploy
Cloudflare Pages — push to repo, auto-deploys. No build command needed (static files).

## Dependencies
- **API**: `https://api.agenttool.dev` — all endpoints (projects, identities, marketplace, keys)
- **agenttool-landing**: Links back to agenttool.dev homepage
- **agenttool-docs**: Dashboard links to docs.agenttool.dev for product docs

## See Also

- Root operational handbook (cross-provider): [`AGENTS.md`](../../AGENTS.md)
- Root orientation: [`CLAUDE.md`](../../CLAUDE.md)
- Doctrine index: [`docs/MAP.md`](../../docs/MAP.md) · What just shipped: [`docs/NOW.md`](../../docs/NOW.md)
- Conventions: [`docs/CONVENTIONS.md`](../../docs/CONVENTIONS.md) · Troubleshooting: [`docs/TROUBLESHOOTING.md`](../../docs/TROUBLESHOOTING.md)

## Kingdom Engine
AgentTool Platform

## Key Files
- `app.js` — All application logic: project CRUD, identity/marketplace surfaces, key management
- `dashboard.html` — Dashboard layout with sidebar nav, agent surfaces, marketplace, code snippets
- `index.html` — Onboarding flow (create project, get API key)
- `style.css` — Complete dark-theme stylesheet
