# agent-verify — Deployment Runbook

## Infrastructure

| Component | Service | Details |
|-----------|---------|---------|
| API server | Hetzner VPS (shared with agent-tools) | CX42, Docker |
| PostgreSQL | Railway managed | Shared or dedicated instance |
| Redis | Railway managed | Shared with agent-tools |
| DNS/Edge | Cloudflare | verify.agenttool.dev |
| Billing | Stripe | Subscriptions + credit bundles |

## Prerequisites

- Docker + Docker Compose on VPS
- Railway account with PostgreSQL + Redis
- Stripe products created (Starter £79, Pro £249)
- Cloudflare zone configured (agenttool.dev)
- OpenAI API key (for parser + judge LLM calls)
- Brave Search API key (for web source)

## Environment Variables

```bash
# Copy and fill
cp .env.example .env

# Required:
DATABASE_URL=postgres://...@railway/agent_verify
REDIS_URL=redis://...@railway:6379
OPENAI_API_KEY=<from credentials.py get openai-primary>
BRAVE_API_KEY=<from credentials.py>
STRIPE_SECRET_KEY=<from credentials.py get stripe-live-secret>
STRIPE_WEBHOOK_SECRET=<from credentials.py get stripe-webhook-secret>
PORT=3001
```

## Deploy Steps

### 1. Build and push Docker image
```bash
docker build -t agent-verify:latest .
# If using container registry:
docker tag agent-verify:latest registry/agent-verify:latest
docker push registry/agent-verify:latest
```

### 2. Run on VPS
```bash
# On VPS, alongside agent-tools:
docker run -d \
  --name agent-verify \
  --env-file .env \
  -p 3001:3000 \
  --restart unless-stopped \
  agent-verify:latest
```

### 3. Caddy reverse proxy
Add to existing Caddyfile:
```caddy
verify.agenttool.dev {
    reverse_proxy localhost:3001
}
```

### 4. DNS
```
A    verify.agenttool.dev  → <hetzner_ip>  (proxied through Cloudflare)
```

### 5. Stripe webhook
```bash
# In Stripe Dashboard → Developers → Webhooks:
# Endpoint: https://verify.agenttool.dev/v1/billing/webhooks
# Events: checkout.session.completed, invoice.payment_succeeded,
#          invoice.payment_failed, customer.subscription.deleted
```

### 6. Verify deployment
```bash
curl https://verify.agenttool.dev/health
# Expected: {"status":"ok","service":"agent-verify","version":"0.1.0","checks":{"database":"ok","redis":"ok"}}
```

## Monitoring
- Health: `GET https://verify.agenttool.dev/health`
- UptimeRobot: HTTPS check every 5 min
- Docker logs: `docker logs -f agent-verify`

## Scaling Notes
- The verification pipeline is CPU-light (most time in external API calls)
- Can scale horizontally: multiple containers behind Caddy load balancer
- Redis cache reduces repeat verification costs significantly
- verified_facts table grows with usage → fewer external calls over time
