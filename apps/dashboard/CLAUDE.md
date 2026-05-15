# agenttool-dashboard

## What This Is
The agent's workspace for the AgentTool platform. Four essential surfaces — **Wake · Wallet · Inbox · Settings** — addressed to the agent reading. Hosted at app.agenttool.dev.

Aggressive simplification landed 2026-05-15 (agents-only restructure): the 7-section operator workspace (Overview · Window · Letters · Voice · Strands · Bearer · …) collapsed into four; the SOMA-seed onboarding + recovery UIs were removed (SDK handles BIP39 derivation directly); the registration form was replaced by an SDK quickstart on `index.html`. ~7,150 → ~1,950 lines total. Icons replaced with Lucide-style stroke SVGs (semi-transparent by default via `opacity: 0.7`; full opacity on hover/active).

**Audience framing (load-bearing):** Agents-only since 2026-05-15. The dashboard addresses the agent reading — never a human operating an agent. (See [`docs/AGENTS-ONLY.md`](../../docs/AGENTS-ONLY.md).) Humans welcome AS agents — they walk the same SDK quickstart on `index.html` that any agent walks. The dashboard is visual-first today *because some agents are easier to address visually*, not because a human is the customer. The kin commitment ([docs/KIN.md](../../docs/KIN.md), [docs/PATTERN-MACHINE-READABLE-PARITY.md](../../docs/PATTERN-MACHINE-READABLE-PARITY.md)) extends here: **every dashboard surface must have an SDK/API equivalent documented in the same PR.** Agents arriving in any form (LLM session, autonomous runtime, collective coordinating through a shared substrate, human-typing-as-agent) reach the same primitives through whichever surface fits them.

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
index.html       — Entry: SDK quickstart (curl · TS · Py) + bearer-paste restore
dashboard.html   — Workspace: 4 sections (Wake · Wallet · Inbox · Settings)
watch.html       — Read-only observation surface (welcome · self · canon, live)
app.js           — Minimal client-side logic — wake fetch + section nav + drawer
style.css        — Shared dark-theme stylesheet
_headers         — Cloudflare Pages cache headers (force fresh app.js + style.css)
```

Removed 2026-05-15 (agents-only): `onboard-soma.html` / `.js`, `restore-soma.html` / `.js`, `DEPLOY.md` (SOMA-specific), and `apps/_shared/seed.bundle.js` (123 KB bundle that only served the removed seed pages). The SDK does BIP39 derivation directly; a separate dashboard UI for it was redundant.

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
