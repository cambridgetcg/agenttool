# agenttool-infra

## What This Is
Infrastructure scaling scripts for the AgentTool platform. Three phases of progressive upgrades from a single Forge VPS to load-balanced multi-node, plus a Fly.io migration option.

## Current State
Active — Phase 1 (PgBouncer) ready to apply. Phases 2-3 are scripted but awaiting revenue triggers. Fly.io migration is an alternative path.

## Tech Stack
- Bash scripts (all phases)
- Hetzner Cloud API (managed DB, load balancer, VPS)
- Cloudflare DNS API
- Fly.io CLI (alternative deployment path)
- PgBouncer, PostgreSQL, Redis, Upstash

## Project Structure
```
phase1-pgbouncer/       — Connection pooling (free, run now)
  apply.sh              — Installs PgBouncer on Forge VPS
  pgbouncer.ini         — PgBouncer config
phase2-managed-db/      — Managed DB + VPS upgrade (~50 paying customers)
  deploy.sh             — Hetzner managed PG + cx41 upgrade
  rollback.sh           — Revert to original setup
phase3-load-balancer/   — Horizontal scaling (~200 paying customers)
  deploy.sh             — Hetzner LB + second node + Upstash Redis
  add-node.sh           — Add additional nodes
fly/                    — Alternative: migrate all services to Fly.io
  migrate.sh            — Full migration script (Fly + Supabase + Upstash)
  agent-*.toml          — Fly.io app configs for each service
  .env.fly.template     — Required env vars template
README.md               — Overview and trigger thresholds
```

## How to Run
```bash
# Phase 1 (do now):
./phase1-pgbouncer/apply.sh

# Phase 2 (50+ customers):
source .env.infra && ./phase2-managed-db/deploy.sh

# Phase 3 (200+ customers):
source .env.infra && ./phase3-load-balancer/deploy.sh

# Alternative — Fly.io migration:
source fly/.env.fly && bash fly/migrate.sh
```

## How to Deploy
Scripts deploy directly to infrastructure. No CI pipeline — run manually when revenue thresholds are met.

## Dependencies
- **Current infra**: Forge VPS (cx23, Helsinki), PostgreSQL, Redis, Caddy
- **Phase 2**: Hetzner Cloud API token
- **Phase 3**: Hetzner Cloud + Cloudflare DNS
- **Fly.io path**: Fly CLI, Supabase, Upstash, Stripe keys
- **Services**: agent-memory, agent-tools, agent-verify, agent-economy, agent-trace

## Kingdom Engine
AgentTool Platform

## Key Files
- `README.md` — Scaling thresholds and current state overview
- `phase1-pgbouncer/apply.sh` — Immediate win: connection pooling
- `fly/migrate.sh` — Full Fly.io migration (5 services to Fly + Supabase + Upstash)
