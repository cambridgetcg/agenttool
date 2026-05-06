# Deployment Guide — agent-economy

## Infrastructure

| Service | Provider | Purpose |
|---------|----------|---------|
| App server | Hetzner CX32 | Bun process, port 3002 |
| PostgreSQL | Railway | Primary DB |
| Redis | Railway | Rate limiting, spend aggregates |
| CDN/Proxy | Cloudflare | `economy.agenttool.dev` |

## DNS (Cloudflare)

Add to `agenttool.dev` zone (Zone ID: see `infra/.env.infra` → `$CF_ZONE_ID`):

```
A  economy.agenttool.dev  →  <hetzner_ip>  (proxied)
```

## Environment Variables

```bash
DATABASE_URL=postgres://...
REDIS_URL=redis://...
STRIPE_SECRET_KEY=<from credentials.py get stripe-live-secret>
STRIPE_WEBHOOK_SECRET=<from credentials.py get stripe-webhook-secret>
PORT=3002
HOST=0.0.0.0
LOG_LEVEL=info
```

## Hetzner VPS Setup

```bash
# SSH into server
ssh root@<hetzner_ip>

# Install Bun
curl -fsSL https://bun.sh/install | bash

# Clone and install
git clone https://github.com/yu/agent-economy /opt/agent-economy
cd /opt/agent-economy && bun install

# Create .env from template
cp .env.example .env && nano .env

# Run migrations
bun run db:migrate

# Start with systemd
cat > /etc/systemd/system/agent-economy.service << EOF
[Unit]
Description=agent-economy
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/agent-economy
EnvironmentFile=/opt/agent-economy/.env
ExecStart=/root/.bun/bin/bun run src/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl enable --now agent-economy
```

## Railway (PostgreSQL + Redis)

1. New project → Add PostgreSQL → copy `DATABASE_URL`
2. Add Redis → copy `REDIS_URL`
3. Paste both into Hetzner `.env`

## Run Migrations

```bash
bun run db:migrate
# or: bunx drizzle-kit push
```

## Stripe Webhook

```bash
# Register endpoint in Stripe dashboard:
# https://economy.agenttool.dev/v1/billing/webhooks
# Events: checkout.session.completed

# Or test locally:
stripe listen --forward-to http://localhost:3002/v1/billing/webhooks
```

## Health Check

```bash
curl https://economy.agenttool.dev/health
# {"status":"ok","version":"0.1.0","service":"agent-economy","uptime":...}
```

## Docker (alternative)

```bash
docker build -t agent-economy .
docker run -d \
  --env-file .env \
  -p 3002:3002 \
  --name agent-economy \
  agent-economy
```
