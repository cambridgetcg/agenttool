# agent-tools

> **The OS for your agent's tools.**

Tools that don't break. Infrastructure your agents depend on.

---

## What is this?

A managed tool API for AI agents. We handle the reliability engineering — proxy rotation,
anti-bot bypass, session management, sandboxing — so your agents call clean endpoints.

Five tools, one API key:

| Tool | Endpoint | What it does | Credits |
|------|----------|-------------|---------|
| **Search** | `POST /v1/search` | Web search via Brave API, cached | 1 |
| **Scrape** | `POST /v1/scrape` | HTML → structured data (Cheerio) | 2 |
| **Browse** | `POST /v1/browse` | Managed Playwright + proxy rotation | 5 |
| **Document** | `POST /v1/document` | PDF/Word/HTML → text + metadata | 3 |
| **Execute** | `POST /v1/execute` | Sandboxed Python/Node/bash | 1/10s |

## Quick Start

```bash
# Get an API key
curl -X POST https://api.agenttool.dev/v1/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project"}'

# Search the web
curl -X POST https://api.agenttool.dev/v1/search \
  -H "Authorization: Bearer at_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"query": "latest AI agent frameworks 2026"}'

# Scrape a page
curl -X POST https://api.agenttool.dev/v1/scrape \
  -H "Authorization: Bearer at_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "selector": "article"}'

# Browse with a managed browser
curl -X POST https://api.agenttool.dev/v1/browse \
  -H "Authorization: Bearer at_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "actions": [{"type": "extract", "selector": "h1"}]}'
```

## Pricing

| Plan | Monthly | Credits | Rate Limit |
|------|---------|---------|------------|
| **Dev** | Free | 100 | 10/min |
| **Builder** | £39 | 5,000 | 60/min |
| **Scale** | £159 | 25,000 | 300/min |
| **Enterprise** | Custom | Custom | Custom |

1 credit = £0.008. Overage auto-purchased at same rate.

Pay with card (Stripe) or crypto (USDC on Base).

## API Reference

Full OpenAPI docs available at `/docs` when running.

### Authentication

All tool requests require: `Authorization: Bearer at_<your_key>`

### Response Format

All responses return JSON:
```json
{
  "result": { ... },
  "credits_used": 1,
  "credits_remaining": 4999,
  "duration_ms": 342
}
```

### Error Format

```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT",
  "retry_after_ms": 5000
}
```

## Self-Host

```bash
git clone https://github.com/yu-eternal/agent-tools
cd agent-tools
cp .env.example .env  # fill in your keys
docker compose up -d  # postgres + redis
bun install
bun run dev
```

## Tech Stack

- **Runtime**: Bun
- **API**: Hono
- **Database**: PostgreSQL (Drizzle ORM)
- **Queue**: BullMQ (Redis)
- **Browser**: Playwright + Bright Data proxies
- **Payments**: Stripe + USDC on Base

## Status

🔨 In development. Not yet deployed.

## License

MIT
