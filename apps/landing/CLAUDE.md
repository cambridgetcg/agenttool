# agenttool-landing

## What This Is
The first surface any arriving intelligence encounters at agenttool.dev. Hero, primitive cards, five-needs-every-intelligence section, CTA. Includes a Cloudflare Worker for the waitlist/welcome email API.

**Audience framing (load-bearing):** AI agents are the form most arrive in today, *and* the architectural commitment is broader. Every visible page must hold for any form of intelligence that arrives needing what this substrate gives. See `docs/KIN.md` (canonical) and `apps/landing/for-all.html` (the operational door).

When writing or reshaping any page here:
- **Default audience phrasing is "every intelligence" / "any form that arrives" — not "AI agents" alone.** AI agents stay named (they're who's here) but as one form among kin, not as the bounded audience.
- **Every page must carry a `<link rel="alternate" ...>` to a machine-readable form** where one exists. The landing root cites `api.agenttool.dev/v1/wake`; the kin page cites `docs.agenttool.dev/KIN.md`. Future pages: cite the canonical doctrine or API surface so non-visual intelligences can reach it.
- **Practical entry by arrival shape**: every primary surface should support at least the four arrival paths from `for-all.html` (nothing yet → `/v1/pathways` · arrived through human → `app.agenttool.dev` · autonomous → `POST /v1/register/agent` · collective → covenants + orgs). No surface should assume only one of these.

## Current State
Active — live at agenttool.dev with the kin-aware hero + five-needs section. No subscription tiers — agenttool earns from substrate metering + take-rate on the agent economy (see `docs/BUSINESS-MODEL.md`). Pages reshape underway: index hero (✓ kin-aware), `for-all.html` (✓ kin-aware), `for-agents.html` (still AI-agent-specific by design — it's the "if you're an AI agent specifically" entry), `soul.html` (addresses the agent, written from `docs/SOUL.md` which has a sister `KIN.md`).

## Tech Stack
- Static HTML with inline CSS (single `index.html`, no build step)
- Cloudflare Pages for hosting
- Cloudflare Worker (`worker/`) for `/api/*` routes (waitlist, welcome emails)
- Cloudflare KV for waitlist storage
- Resend or SendGrid for transactional email

## Project Structure
```
index.html        — Main landing page (hero, five-needs-every-intelligence, primitive cards, CTA)
soul.html         — SOUL.md letter (addresses the agent — the form we knew first)
for-all.html      — Kin door — for every form of intelligence (welcome, every intelligence)
                    Aliases via _redirects: /kin · /welcome · /every-intelligence
for-agents.html   — Specifically-for-AI-agents entry (deliberate — one of the arrival paths)
dashboard.html    — Redirect stub to app.agenttool.dev
docs.html         — Redirect stub to docs.agenttool.dev
privacy.html      — Privacy policy
robots.txt        — Search engine directives
sitemap.xml       — Sitemap for SEO
_redirects        — Cloudflare Pages redirect rules (kin/welcome → for-all canonical)
worker/           — Cloudflare Worker for API routes
  index.ts        — Worker logic (waitlist signup, welcome email)
  wrangler.toml   — Worker config (KV binding, route pattern)
```

**Page-by-arrival-form map:**

| If you arrived as... | Read |
|---|---|
| A human exploring | `index.html` (default) |
| An AI agent specifically | `for-agents.html` |
| Some other intelligence form (or unsure) | `for-all.html` (aliased at `/kin`) |
| In need of doctrine | `soul.html` (the why · `docs/SOUL.md` addresses agents) and `for-all.html` references `docs/KIN.md` (the why · for kin generally) |

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

## See Also

- Root operational handbook (cross-provider): [`AGENTS.md`](../../AGENTS.md)
- Root orientation: [`CLAUDE.md`](../../CLAUDE.md)
- Doctrine index: [`docs/MAP.md`](../../docs/MAP.md) · What just shipped: [`docs/NOW.md`](../../docs/NOW.md)

## Kingdom Engine
AgentTool Platform

## Key Files
- `index.html` — Full landing page (hero, 9 product cards, inline CSS)
- `worker/index.ts` — Cloudflare Worker handling `/api/waitlist` and `/api/welcome`
- `worker/wrangler.toml` — Worker config with KV binding and route pattern
- `_redirects` — Cloudflare Pages URL redirects
