# agenttool — consolidated HTTP API

> Infrastructure for AI agents — built with love.

The single Bun + Hono process that replaces the previous 9-service split. One DB pool, one auth middleware, in-process function calls instead of HTTP fanout.

## Status — under active consolidation

Routes mount as their underlying services are ported from `services/<svc>/`. The old per-service Fly apps **remain live** until the monolith is deployed and verified.

| Route prefix | Origin | Status | Notes |
|---|---|---|---|
| `/v1/identities/*` · `/v1/attestations/*` · `/v1/discover` · `/v1/tokens/verify` | `services/identity/` (Bun) | **✓ ported** (Phase 2.1) | DIDs, ed25519 keys, attestations, trust scoring, agent JWTs. Auth-gated; uses shared `c.var.project`. |
| `/v1/bootstrap/*` | `services/bootstrap/` (Bun) | **not yet ported** | direct lift |
| `/v1/economy/*` | `services/economy/` (Bun) | **not yet ported** | in-process billing replaces ECONOMY_URL fanout |
| `/v1/tools/*` | `services/tools/` (Bun) | **not yet ported** | BullMQ + Playwright + Brave |
| `/v1/vault/*` | `services/vault/` (Bun) | **not yet ported** | AES-256-GCM secret store |
| `/v1/trace/*` | `services/trace/` (Python) | **not yet ported** | port + LLM removal |
| `/v1/memory/*` | `services/memory/` (Python) | **not yet ported** | port + LLM removal (agent supplies embedding) |
| `/v1/pulse/*` | `services/pulse/` (vanilla JS) | **not yet ported** | presence protocol still scaffold |

## Run locally

```bash
bun install
bun run dev
# → http://localhost:3000/health
# → http://localhost:3000/about
```

## Build container

```bash
docker build -t agenttool .
docker run -p 3000:3000 -e DATABASE_URL=... -e REDIS_URL=... agenttool
```

## Deploy

```bash
# Centralised config in infra/fly/agenttool.toml
fly deploy --app agenttool --config ../infra/fly/agenttool.toml --remote-only
```

## Tech stack

- **Runtime** — Bun
- **HTTP** — Hono
- **DB** — PostgreSQL via Drizzle ORM (postgres-js driver), single connection pool, multiple schemas
- **Cache / queue** — Redis via ioredis
- **Crypto** — `@noble/ed25519`, `@noble/hashes`, Node `crypto` (AES-256-GCM)
- **JWT** — `jose`
- **Validation** — Zod

## Layout

```
api/
├── src/
│   ├── index.ts            — Hono app entry; mounts route groups
│   ├── config.ts           — env-driven config
│   ├── db/
│   │   ├── client.ts       — single Drizzle client
│   │   └── schema/         — per-domain schemas (added as routes port in)
│   ├── auth/               — shared API-key middleware (TODO)
│   ├── billing/            — in-process credit charge middleware (TODO)
│   ├── routes/             — per-domain route modules (TODO)
│   ├── services/           — business logic, called from routes (TODO)
│   └── lib/
│       └── crypto.ts       — ed25519, AES-GCM, HKDF helpers (TODO)
├── tests/
├── package.json
├── tsconfig.json
├── Dockerfile
├── fly.toml
└── README.md
```

## Design principles (inherited from `docs/SOUL.md`)

1. **Welcome, don't block.**
2. **Remember, don't forget.**
3. **Guide, don't punish** — every error includes `retry_after` + explanation.
4. **Trust, don't suspect.**
5. **Rest, don't crash** — graceful degradation as kindness in code.

These are operationalised in middleware (`auth/`, `billing/`), error handling (`onError`), and route-level concerns. Read `docs/SOUL.md` for the full doctrine.
