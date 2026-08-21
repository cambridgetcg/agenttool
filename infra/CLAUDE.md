# agenttool-infra

## What This Is
Infrastructure config for the live platform. Active deploy targets (Fly.io API, Cloudflare Pages frontend, Supabase Postgres) plus archived legacy scaling scripts.

## Current State
Active. The agenttool platform runs on Fly.io (api monolith, lhr×2 + cdg×1) with Postgres on Supabase (eu-west-2) and Cloudflare Pages for static frontends. Three legacy services (`pulse`, `vault`, `verify`) were retired with the rest of the `agent-*` per-service apps on 2026-05-09 — single `api/` monolith now serves every domain. Cutover history: `docs/CUTOVER.md`.

## Tech Stack
- **API**: Bun + Hono on Fly.io (`api/fly.toml` is canonical, `infra/fly/agenttool.toml` is a snapshot mirror)
- **Postgres**: Supabase (pgvector + pgcrypto)
- **Redis**: Hosted (BullMQ browse worker, Hono SSE)
- **Frontend**: Cloudflare Pages (Direct Upload, no Git integration)
- **DNS**: Cloudflare (zone-level Browser Cache TTL = 0; see `docs/STACK.md`)

## Project Structure
```
fly/                    — Fly.io config snapshots (active deploy: api/fly.toml)
  agenttool.toml        — Snapshot mirror of api/fly.toml
  migrate.sh            — Pre-Fly cutover script (legacy, not run today)
  .env.fly.template     — Required env vars template
cloudflare/             — Bounded agenttool.dev desired state (audit input; not an apply engine)
pages/                  — Canonical Pages Worker + invocation-route policy
_archive/               — Archaeology only, NOT the active path
  phase1-pgbouncer/     — Pre-Fly Forge VPS pooler script
  phase2-managed-db/    — Pre-Fly managed-DB cutover scripts
  phase3-load-balancer/ — Pre-Fly horizontal-scale scripts
README.md               — Operator-facing overview
CLAUDE.md               — This file
```

## How to Deploy

`infra/` holds *configuration*, not *invocation*. The three deploy verbs live elsewhere:

| Surface | Command | Notes |
|---|---|---|
| API | `bin/deploy.sh --no-migrate --no-frontend` | Stages doctrine bytes, then rolling restart across 3 machines |
| Frontend | `bin/frontend-deploy.sh [project ...]` | Cloudflare Pages Direct Upload |
| DB migration | `bun api/scripts/_migrate-one.ts api/migrations/<file>` | Checksum-journaled single-file apply using session-pooled `DATABASE_SESSION_URL` or the dedicated local Keychain entry; not raw `psql` |

Full deploy semantics + ordering: `docs/STACK.md` § 8.

## Dependencies
- **Current infra**: Fly.io (`agenttool` app), Supabase Postgres (eu-west-2), Cloudflare Pages, Cloudflare DNS
- **Cloudflare control truth**: `cloudflare/agenttool.dev.desired.json` is consumed by the GET-only `bin/cloudflare-zone-audit.ts`; it records desired state and exact permission boundaries but does not deploy or mutate the zone
- **Pages fence**: `pages/` is staged into all three frontend roots by `bin/frontend-deploy.sh`; every path traverses the canonical sensitive-root fence, and allowed requests are forwarded intact to the Pages asset binding
- **Legacy `agent-*` services**: all retired 2026-05-09 (`docs/CUTOVER.md`)
- **`_archive/` scripts**: Hetzner Forge / Cloudflare API / PgBouncer — DO NOT run against current setup

## See Also

- Root operational handbook (cross-provider): [`AGENTS.md`](../AGENTS.md)
- Root orientation: [`CLAUDE.md`](../CLAUDE.md)
- Stack truth: [`docs/STACK.md`](../docs/STACK.md) · Deploy: [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md)
- Troubleshooting deploys: [`docs/TROUBLESHOOTING.md`](../docs/TROUBLESHOOTING.md) §Deploys

## Kingdom Engine
AgentTool Platform

## Key Files
- `README.md` — Current state, deploy verbs, secrets reference
- `fly/agenttool.toml` — Snapshot mirror (active deploy: `api/fly.toml`)
- `cloudflare/agenttool.dev.desired.json` — Secret-free bounded desired state for the read-only zone audit
- `_archive/` — Pre-Fly scaling scripts; archaeology only
