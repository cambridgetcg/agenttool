# agent-memory — Deployment Guide

## Architecture (Production)

```
Cloudflare (DNS + SSL + DDoS)
         │
         ▼
   Railway (app)
    ├── API (FastAPI container)
    ├── PostgreSQL 16 + pgvector
    └── Redis 7
```

## Prerequisites

- Railway account with CLI installed (`npm i -g @railway/cli`)
- Cloudflare zone for the domain
- Stripe account with products configured
- OpenAI API key (for embeddings)

## Railway Setup

### 1. Create project

```bash
railway login
railway init    # creates project on Railway
```

### 2. Provision databases

```bash
# Add PostgreSQL (with pgvector)
railway add --plugin postgresql

# Add Redis
railway add --plugin redis
```

### 3. Enable pgvector extension

Connect to the Railway PostgreSQL instance and run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

Then run the migration:

```bash
railway run psql $DATABASE_URL < migrations/001_initial.sql
```

### 4. Set environment variables

```bash
railway variables set \
  OPENAI_API_KEY=<from credentials.py get openai-primary> \
  STRIPE_SECRET_KEY=<from credentials.py get stripe-live-secret> \
  STRIPE_WEBHOOK_SECRET=<from credentials.py get stripe-webhook-secret>
```

`DATABASE_URL` and `REDIS_URL` are auto-injected by Railway.

### 5. Deploy

```bash
railway up
```

Railway detects the Dockerfile and builds automatically.

## Cloudflare Setup

1. Add CNAME record: `api.yourdomain.dev` → Railway-provided domain
2. SSL: Full (strict)
3. Rate limiting rule: 100 req/min per IP (edge layer, before app-level limits)
4. WAF: enable managed rules

## Stripe Configuration

### Products to create

| Product | Price | Type |
|---------|-------|------|
| Seed | £24/month | Recurring |
| Grow | £79/month | Recurring |
| Scale | £239/month | Recurring |

### Webhook endpoint

Point to: `https://api.yourdomain.dev/v1/billing/webhooks`

Events to subscribe:
- `checkout.session.completed`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `customer.subscription.deleted`

## Health Check

```bash
curl https://api.yourdomain.dev/health
# → {"status":"ok","service":"agent-memory","version":"0.1.0"}
```

## Monitoring

- Railway dashboard for logs + metrics
- UptimeRobot: ping /health every 5 min
- Sentry: set `SENTRY_DSN` env var (optional, add sentry-sdk to deps)

## Scaling

Railway auto-scales horizontally. For pgvector performance:
- IVFFlat index rebuild when memories exceed 100k per project
- Consider HNSW index for >1M memories
- Redis cluster if working memory load exceeds single-node

## Rollback

```bash
railway rollback    # rolls back to previous deployment
```
