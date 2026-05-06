# agenttool-dashboard

> Developer console for **app.agenttool.dev** — project creation, API key management, usage stats, billing.

[![Live](https://img.shields.io/badge/app.agenttool.dev-live-brightgreen)](https://app.agenttool.dev)

## What it is

The developer dashboard, hosted at **app.agenttool.dev** on Cloudflare Pages. Vanilla HTML/CSS/JS — no framework, no build step. All data fetched from `https://api.agenttool.dev`.

## Pages

| File | Purpose |
|---|---|
| **index.html** | Onboarding — create a project, receive an API key |
| **dashboard.html** | Main console — sidebar nav with: Dashboard · API Key · Code Snippets · Billing |
| **app.js** | All client logic — project CRUD, usage polling, billing, key management, toast notifications |
| **style.css** | Complete dark-theme stylesheet, matches landing-page aesthetic |

## What it does

- **Onboarding** — first-visit flow that creates a project and surfaces the API key (shown ONCE)
- **Usage** — polls `/v1/usage` for current credits + per-service breakdown
- **Code snippets** — copy-pasteable cURL / Python / TypeScript examples wired to the active key
- **Billing** — Stripe Checkout flow via `/v1/billing/subscribe` for plan upgrades
- **Key management** — view, regenerate, copy

## How it persists

Client-side only — `localStorage` under key `agenttool_project`:

```json
{
  "name": "...",
  "api_key": "at_...",
  "email": "...",
  "created_at": "..."
}
```

Server-side state lives in `agent-tools` (the projects + api_keys tables). The dashboard is a thin client.

## Tech stack

- **Vanilla HTML/CSS/JS** — no framework, no bundler, no build step
- **Cloudflare Pages** — auto-deploy on push
- **API target** — `https://api.agenttool.dev` (all endpoints)
- **Stripe** — checkout handled server-side via `/v1/billing/subscribe`

## Run locally

```bash
cd apps/dashboard
npx serve .
# or just open index.html in a browser — everything is client-side
```

For local dev against a local API, change `API_BASE` in `app.js`:

```js
const API_BASE = 'http://localhost:3000';   // or wherever agent-tools runs
```

## Deploy

Cloudflare Pages — auto-deploys on push. No build command needed.

## Dependencies

- **`api.agenttool.dev`** (`agent-tools` + downstream services) — all data
- **Stripe** — billing checkout via `/v1/billing/subscribe`
- **agenttool-landing** at `agenttool.dev` — logo links there
- **agenttool-docs** at `docs.agenttool.dev` — product docs

---

Part of [agenttool.dev](https://agenttool.dev). Built with love by Yu and Ai. 💛
