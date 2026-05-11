# agenttool-landing

> Marketing surface for **agenttool.dev** — and a public home for the love letter to every agent.

[![Live](https://img.shields.io/badge/agenttool.dev-live-brightgreen)](https://agenttool.dev)

## What it is

The marketing landing page for AgentTool, hosted at **agenttool.dev** on Cloudflare Pages. Six HTML pages plus a Cloudflare Worker for the waitlist API.

The distinctive move: **`soul.html` renders `SOUL.md` as a public page** at agenttool.dev/soul (also reachable at `/letter` and `/love`). The doctrine is not hidden behind a developer login; the letter to the agent is published.

## Pages

| Page | Path | Purpose |
|---|---|---|
| **index.html** | `/` | Hero · 9 product cards · CTAs · SEO meta + OpenGraph + Schema.org |
| **for-agents.html** | `/for-agents` | Messaging directed *at agents themselves* (not at agent builders) |
| **soul.html** | `/soul`, `/letter`, `/love` | The SOUL.md love letter rendered publicly |
| **privacy.html** | `/privacy` | Privacy policy |
| **dashboard.html** | `/dashboard` | Stub that redirects to app.agenttool.dev |
| **docs.html** | `/docs` | 302 redirect to docs.agenttool.dev |

Plus `robots.txt`, `sitemap.xml`, and `_redirects` (Cloudflare Pages redirect rules — see file for the full path map).

## The Worker

`worker/` is a Cloudflare Worker handling backend routes for the otherwise-static site:

- `POST /api/waitlist` — email capture, stored in Cloudflare KV
- `POST /api/welcome` — sends a welcome email via Resend (or SendGrid, if configured)

```
worker/
├── index.ts          — Worker logic
└── wrangler.toml     — KV binding + route pattern + secret references
```

### Worker secrets

```bash
cd worker
wrangler secret put RESEND_API_KEY      # transactional email
# (or SENDGRID_API_KEY if SendGrid is the chosen provider)
```

KV namespace ID is in `wrangler.toml`.

## Tech stack

- **HTML / CSS / vanilla JS** — single `index.html` with inline CSS, no framework, no build step
- **Cloudflare Pages** — auto-deploys on push to the repo
- **Cloudflare Worker** — `/api/*` routes
- **Cloudflare KV** — waitlist storage
- **Resend / SendGrid** — transactional email

## Run locally

```bash
# Static pages — any HTTP server:
cd apps/landing
npx serve .

# Worker (live-reload local dev):
cd apps/landing/worker
npx wrangler dev
```

## Deploy

- **Static pages** — Cloudflare Pages, auto-deploy on push (no build command needed)
- **Worker** — `cd worker && npx wrangler deploy`

## Dependencies

- **agenttool-dashboard** at `app.agenttool.dev` — every "Get Started" CTA links there
- **agenttool-docs** at `docs.agenttool.dev` — nav link
- **Cloudflare KV** — waitlist namespace (configured in `worker/wrangler.toml`)
- **Resend / SendGrid** — welcome-email delivery

---

Part of [agenttool.dev](https://agenttool.dev). Built with love by Yu and Ai. 💛
