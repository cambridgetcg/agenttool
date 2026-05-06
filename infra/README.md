# agenttool-infra — One-Click Scaling

Three phases. Each is a single script. Run when revenue justifies it.

## Current state
- All 5 services on Forge (cx23, 2 vCPU / 4GB RAM, Helsinki)
- Single PostgreSQL + Redis on Forge
- Caddy TLS termination
- Tier limits protect against abuse at any scale

## When to upgrade

| Phase | Trigger | Cost delta | Time |
|-------|---------|------------|------|
| **Phase 1** — PgBouncer | Now (always beneficial) | Free | 2 min |
| **Phase 2** — Managed DB + bigger VPS | 50+ paying customers | +€28/mo | 10 min |
| **Phase 3** — Load balancer + horizontal scale | 200+ paying customers | +€50/mo | 20 min |

## Credentials required

All scripts read from environment variables. Set once:

```bash
export HETZNER_TOKEN="<from .env.infra>"      # Hetzner Cloud API token
export FORGE_IP="<from .env.infra>"           # Forge VPS public IPv4
export FORGE_SERVER_ID="<from .env.infra>"    # Hetzner server ID for the Forge VPS
export CF_EMAIL="<from .env.infra>"           # Cloudflare account email
export CF_KEY="<from .env.infra>"             # Cloudflare Global API Key
export CF_ZONE_ID="<from .env.infra>"         # Cloudflare zone ID for agenttool.dev
```

Or source the env file:
```bash
source .env.infra
```

## Phase 1 — PgBouncer (run now)
```bash
./phase1-pgbouncer/apply.sh
```
Adds a connection pooler in front of PostgreSQL. Services connect to PgBouncer (port 6432) instead of Postgres directly. Improves stability under concurrent load. Zero downtime.

## Phase 2 — Managed DB + VPS upgrade
```bash
./phase2-managed-db/deploy.sh
```
1. Creates Hetzner Managed PostgreSQL (hel1, pg-2 tier)
2. Migrates all databases with pg_dump/pg_restore
3. Upgrades Forge from cx23 → cx41 (4 vCPU, 8GB RAM)
4. Updates all service .env files
5. Restarts services
6. Verifies health

Rollback: `./phase2-managed-db/rollback.sh`

## Phase 3 — Load balancer + horizontal scaling
```bash
./phase3-load-balancer/deploy.sh
```
1. Creates Hetzner Load Balancer (lb11)
2. Creates snapshot of Forge
3. Spins up second node (Forge-2) from snapshot
4. Registers both nodes with load balancer
5. Migrates Redis to Upstash (serverless)
6. Updates Cloudflare DNS: api.agenttool.dev → load balancer IP
7. Verifies health on both nodes

Each node auto-restarts services via existing start-all.sh.
