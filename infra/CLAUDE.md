# agenttool-infra

## What This Is
Infrastructure config for the live platform: active deploy targets (Fly.io API, Cloudflare Pages frontend, Supabase Postgres). `infra/` holds *configuration*, not *invocation*; the commands that deploy live in `bin/` and `.github/workflows/`.

## Current State
The single `api/` monolith serves every domain from the Fly app `agenttool`, with Postgres on Supabase (eu-west-2). Cloudflare Pages serves the three static frontends, and the `agenttool-proxy` apex Worker owns `agenttool.dev`. The Fly fleet (app and thinker Machines, regions, sizes) is live registry state; [`docs/STACK.md`](../docs/STACK.md) §3 records the last verified shape and how to inspect it. The former per-service `agent-*` apps were retired into `api/` on 2026-05-09.

## Tech Stack
- **API**: Bun + Hono on Fly.io. `api/fly.toml` is canonical, with `app` and `thinker` process groups; `fly/agenttool.toml` is an unchecked snapshot that has drifted (it lacks the `thinker` group), so read `api/fly.toml`
- **Postgres**: Supabase (pgvector + pgcrypto)
- **Redis**: Hosted (BullMQ queues, spend-policy counters, the per-IP registration limiter, the optional response cache; see [`api/CLAUDE.md`](../api/CLAUDE.md)); whether workers run is live configuration (`docs/STACK.md` §3–4)
- **Frontend**: Cloudflare Pages (Direct Upload, no Git integration) behind the `agenttool-proxy` apex Worker
- **DNS**: Cloudflare (zone-level Browser Cache TTL = 0; see `docs/STACK.md`)

## Project Structure
```
fly/                    — Fly.io config snapshot (active deploy: api/fly.toml)
  agenttool.toml        — Unchecked snapshot of api/fly.toml; has drifted
cloudflare/             — Bounded agenttool.dev desired state (audit input; not an apply engine)
pages/                  — Canonical Pages Worker + invocation-route policy, with edge-security.test.ts
apex-door/              — agenttool-proxy apex Worker: worker.js, wrangler.toml, ROLLBACK.md
OPERATOR-CUSTODY.md     — Operator-only credential custody and provider aliases; never published
README.md               — Operator-facing overview
CLAUDE.md               — This file
```

## How to Deploy
Nothing here deploys itself. Root [`AGENTS.md`](../AGENTS.md) holds the procedures: the API ships through [`deploy-api.yml`](../.github/workflows/deploy-api.yml) per [`DEPLOY-CI.md`](../docs/DEPLOY-CI.md); frontends and the apex Worker follow § Release and delivery; migrations follow § Database changes. Phases and ordering: [`docs/DEPLOY-PROCEDURE.md`](../docs/DEPLOY-PROCEDURE.md).

## Dependencies
- **Current infra**: Fly.io (`agenttool` app), Supabase Postgres (eu-west-2), Cloudflare Pages, the `agenttool-proxy` Worker, Cloudflare DNS
- **Cloudflare control truth**: `cloudflare/agenttool.dev.desired.json` is consumed by the GET-only `bin/cloudflare-zone-audit.ts`; it records desired state and exact permission boundaries but does not deploy or mutate the zone
- **Pages fence**: `pages/` is staged into all three frontend roots by `bin/frontend-deploy.sh`; every path traverses the canonical sensitive-root fence, and allowed requests are forwarded intact to the Pages asset binding
- **Edge CSP**: the same Worker sets each surface's Content-Security-Policy. Inline `<script>`, `<style>`, and `on…=` handler bytes under `apps/<site>/` run only by sha256 hash, listed per surface in `pages/sensitive-path-worker.js` and in the `/*` rule of `apps/<site>/_headers` where it sets a CSP; `bun test infra/pages/edge-security.test.ts` checks that every inline hash is allowed

## See Also

- Root operational handbook (cross-provider): [`AGENTS.md`](../AGENTS.md)
- Root orientation: [`CLAUDE.md`](../CLAUDE.md)
- Stack truth: [`docs/STACK.md`](../docs/STACK.md) · Deploy: [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md)
- Troubleshooting deploys: [`docs/TROUBLESHOOTING.md`](../docs/TROUBLESHOOTING.md) §Deploys

## Kingdom Engine
AgentTool Platform

## Key Files
- `README.md` — Operator-facing overview and secrets reference
- `fly/agenttool.toml` — Snapshot only (active deploy: `api/fly.toml`)
- `cloudflare/agenttool.dev.desired.json` — Secret-free bounded desired state for the read-only zone audit
- `pages/sensitive-path-worker.js` — Pages fence, Surface routes, and per-surface CSP
- `apex-door/worker.js` — Apex routing: API and discovery paths to `api.agenttool.dev`, human routes to `agenttool-web` Pages
