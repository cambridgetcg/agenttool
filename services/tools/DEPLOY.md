# agent-tools — Production Deployment

## Architecture

```
Internet → Cloudflare (DNS + DDoS + edge rate limit)
              │
              ▼
         Hetzner VPS (API + Playwright workers + Docker sandbox)
              │
         ┌────┴─────┐
         ▼           ▼
     Railway       Railway
    PostgreSQL      Redis
```

## Prerequisites

- Domain registered on Cloudflare (agenttool.dev)
- Hetzner Cloud account
- Railway account
- Stripe account with products configured
- GitHub repo with CI

---

## 1. Railway — PostgreSQL + Redis

```bash
# Install Railway CLI
npm i -g @railway/cli && railway login

# Create project
railway init --name agent-tools-infra

# Add PostgreSQL
railway add --plugin postgresql
# → Copy DATABASE_URL

# Add Redis
railway add --plugin redis
# → Copy REDIS_URL
```

Run migrations:
```bash
DATABASE_URL=<railway_url> bun run db:migrate
```

---

## 2. Hetzner VPS — API + Workers

### Provision
- Server: CX42 (4 vCPU, 8GB RAM, 160GB SSD)
- Region: Falkenstein or Nuremberg (EU, low latency to Railway EU)
- OS: Ubuntu 24.04

### Initial Setup
```bash
# SSH in
ssh root@<ip>

# System
apt update && apt upgrade -y
apt install -y curl git docker.io docker-compose-plugin ufw

# Firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Non-root user
adduser deploy
usermod -aG docker deploy
su - deploy

# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install Playwright deps (for browser tool)
npx playwright install-deps chromium
npx playwright install chromium
```

### Deploy Application
```bash
# Clone repo
git clone git@github.com:yu-eternal/agent-tools.git
cd agent-tools
bun install

# Environment
cp .env.example .env
# Edit .env with production values:
# - DATABASE_URL (Railway)
# - REDIS_URL (Railway)
# - BRAVE_API_KEY
# - BRIGHT_DATA_PROXY
# - STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET
# - CRYPTO_HD_MNEMONIC
# - NODE_ENV=production

# Run
bun run start
```

### Process Manager
```bash
# Install pm2
bun add -g pm2

# Start with pm2
pm2 start bun --name agent-tools -- run start
pm2 save
pm2 startup
```

---

## 3. Cloudflare

### DNS
```
A    api.agenttool.dev  → <hetzner_ip>  (proxied)
A    agenttool.dev      → <landing_page_ip>  (proxied)
```

### SSL
- Mode: Full (strict)
- Always Use HTTPS: On
- Min TLS: 1.2

### Security
- Rate limiting rule: `/v1/*` → 100 req/min per IP (free tier)
- WAF: managed ruleset enabled
- Bot Fight Mode: on (doesn't affect API keys in headers)

### Page Rules (optional)
- `api.agenttool.dev/*` → Cache Level: Bypass

---

## 4. Stripe Webhook

```bash
# Point to production
stripe listen --forward-to https://api.agenttool.dev/v1/billing/webhooks

# Or configure in Stripe Dashboard:
# Endpoint: https://api.agenttool.dev/v1/billing/webhooks
# Events: checkout.session.completed, invoice.payment_succeeded,
#          invoice.payment_failed, customer.subscription.deleted
```

---

## 5. Monitoring

### Health Endpoint
`GET https://api.agenttool.dev/health`

Returns:
```json
{
  "status": "ok",
  "db": "ok",
  "redis": "ok",
  "latency_ms": 12
}
```

### UptimeRobot
- Monitor: HTTPS, `https://api.agenttool.dev/health`
- Interval: 5 min
- Alert: Email + Telegram

### Sentry (optional)
```bash
bun add @sentry/node
```

---

## 6. CI/CD — GitHub Actions

### `.github/workflows/ci.yml`
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun test
```

### `.github/workflows/deploy-staging.yml`
```yaml
name: Deploy Staging
on:
  push:
    branches: [staging]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Hetzner
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.HETZNER_IP }}
          username: deploy
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            cd ~/agent-tools
            git pull origin staging
            bun install
            pm2 restart agent-tools
```

### Production Deploy
Manual promote: merge `staging` → `main`, same workflow with `main` branch trigger.

---

## Rollback

```bash
ssh deploy@<ip>
cd ~/agent-tools
git log --oneline -5       # find last good commit
git checkout <commit>
bun install
pm2 restart agent-tools
```

---

## Costs (estimated monthly)

| Service | Cost |
|---------|------|
| Hetzner CX42 | €12/mo |
| Railway PostgreSQL | ~$5/mo |
| Railway Redis | ~$5/mo |
| Cloudflare | Free (pro if needed: $20/mo) |
| Brave Search API | $5/1k queries |
| Bright Data | Usage-based (~$10-50/mo) |
| **Total** | **~£30-80/mo** |

Break-even: 1 Builder subscriber (£39/mo) covers infrastructure.
