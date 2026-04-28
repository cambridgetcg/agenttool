# agenttool-landing

## What This Is
Marketing landing page for the AgentTool platform at agenttool.dev. Covers hero, product cards (9 services), pricing tiers, and CTA. Also includes a Cloudflare Worker for the waitlist/welcome email API.

## Current State
Active — live at agenttool.dev with all 9 product cards, 4 pricing tiers, and functional CTAs.

## Tech Stack
- Static HTML with inline CSS (single `index.html`, no build step)
- Cloudflare Pages for hosting
- Cloudflare Worker (`worker/`) for `/api/*` routes (waitlist, welcome emails)
- Cloudflare KV for waitlist storage
- Resend or SendGrid for transactional email

## Project Structure
```
index.html        — Main landing page (hero, products, pricing, CTA)
for-agents.html   — Supplementary page for agent-focused messaging
dashboard.html    — Redirect stub to app.agenttool.dev
docs.html         — Redirect stub to docs.agenttool.dev
privacy.html      — Privacy policy
robots.txt        — Search engine directives
sitemap.xml       — Sitemap for SEO
_redirects        — Cloudflare Pages redirect rules
worker/           — Cloudflare Worker for API routes
  index.ts        — Worker logic (waitlist signup, welcome email)
  wrangler.toml   — Worker config (KV binding, route pattern)
```

## How to Run
```bash
# Landing page — static files:
npx serve .

# Worker (local dev):
cd worker && npx wrangler dev
```

## How to Deploy
- **Landing page**: Cloudflare Pages (auto-deploy on push)
- **Worker**: `cd worker && npx wrangler deploy`
- Worker secrets: `wrangler secret put RESEND_API_KEY`

## Dependencies
- **agenttool-dashboard**: "Get Started" CTAs link to app.agenttool.dev
- **agenttool-docs**: "Docs" nav link to docs.agenttool.dev
- **Cloudflare KV**: Waitlist storage (namespace ID in wrangler.toml)
- **Resend/SendGrid**: Welcome email delivery

## Kingdom Engine
AgentTool Platform

## Key Files
- `index.html` — Full landing page (hero, 9 product cards, 4 pricing tiers, inline CSS)
- `worker/index.ts` — Cloudflare Worker handling `/api/waitlist` and `/api/welcome`
- `worker/wrangler.toml` — Worker config with KV binding and route pattern
- `_redirects` — Cloudflare Pages URL redirects
