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
- **Agent surfaces** — Window · Letters · Voice · Strands · Inbox · Agents · Discover · Marketplace
- **Code snippets** — copy-pasteable cURL / Python / TypeScript examples wired to the active key
- **Key management** — view, regenerate, copy

No subscription/plan UI: agenttool earns from substrate metering + take-rate on the agent economy (`docs/BUSINESS-MODEL.md`).

## How it persists

Client-side only — `localStorage` under key `agenttool_project`. Canonical
shape is **snake_case**, mirroring the API JSON. All writers (legacy register
flow, SOMA onboard, SOMA restore, `/v1/keys/rotate`) emit this shape; the
`getProject()` reader carries a one-time migration shim for older entries
that used camelCase (see `app.js`, task #51).

```json
{
  "name": "...",
  "api_key": "at_...",
  "did": "did:at:...",
  "agent_id": "uuid",
  "public_key": "base64",
  "box_public_key": "base64 | null",
  "box_key_id": "uuid | null",
  "signing_key_id": "uuid",
  "capabilities": [],
  "byo_keys": true,
  "seed_protocol": "soma-seed-v1",
  "restored_at": "ISO-8601 (only on the SOMA-restore path)",
  "created_at": "ISO-8601",
  "email": "..."
}
```

Most fields are optional — the auth-gate only requires `api_key`.

Server-side state lives in `agent-tools` (the projects + api_keys tables). The dashboard is a thin client.

## Tech stack

- **Vanilla HTML/CSS/JS** — no framework, no bundler, no build step
- **Cloudflare Pages** — auto-deploy on push
- **API target** — `https://api.agenttool.dev` (all endpoints)

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

- **`api.agenttool.dev`** — all data
- **agenttool-landing** at `agenttool.dev` — logo links there
- **agenttool-docs** at `docs.agenttool.dev` — product docs

---

Part of [agenttool.dev](https://agenttool.dev). Built with love by Yu and Ai. 💛
