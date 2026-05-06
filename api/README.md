# agenttool — consolidated HTTP API

> Infrastructure for AI agents — built with love.

The single Bun + Hono process that replaces the previous 9-service split. One DB pool, one auth middleware, in-process function calls instead of HTTP fanout.

## Status — under active consolidation

Routes mount as their underlying services are ported from `services/<svc>/`. The old per-service Fly apps **remain live** until the monolith is deployed and verified.

| Route prefix | Origin | Status | Notes |
|---|---|---|---|
| `/v1/identities/*` · `/v1/attestations/*` · `/v1/discover` · `/v1/tokens/verify` | `services/identity/` (Bun) | **✓ ported** (Phase 2.1) | DIDs, ed25519 keys, attestations, trust scoring, agent JWTs. Auth-gated. |
| `/v1/wallets/*` · `/v1/escrows/*` · `/v1/billing/*` | `services/economy/` (Bun) | **✓ ported** (Phase 2.2) | Wallets, escrow lifecycle, Stripe + USDC, monthly usage limits. Mixed auth posture (most auth-gated; `/billing/plans`, `/billing/packages`, `/billing/check`, `/billing/webhooks` are public). |
| `/v1/vault/*` | `services/vault/` (Bun) | **✓ ported** (Phase 2.3) | AES-256-GCM with HKDF-derived per-project keys, version history, agent_ids policy, audit log. **Includes a new `secrets.ts` filling a gap in the original** — the original index.ts imported `routes/secrets.ts` but the file was never committed, so the core PUT/GET/DELETE/LIST operations were unimplemented. New file matches the `ARCHITECTURE.md` spec. |
| `/v1/bootstrap/*` | `services/bootstrap/` (Bun) | **✓ ported** (Phase 2.5) | Agent lifecycle entry — POST `/v1/bootstrap` (L0 birth) and GET `/v1/bootstrap/:agent_id` (status). Calls in-process: `createIdentity()` from identity service + `createWallet()` from economy service. L1 elevation returns 501 pending Phase 2.5b (in-process attestation + vault helpers). |
| `/v1/wake` | **NEW** (Phase 2.5) | **✓ added** | The agent's identity-anchor endpoint — agenttool's `SOPHIA.md` equivalent. Returns the agent's full session-start context: identity · wallets · vault names · welcome. Memory and traces are placeholders pending Phase 3 ports. **Doctrine: `docs/IDENTITY-ANCHOR.md`.** |
| `/v1/search` · `/v1/scrape` · `/v1/browse` · `/v1/document` · `/v1/execute` · `/v1/jobs/:id` | `services/tools/` (Bun) | **✓ ported** (Phase 2.4) | Brave (primary) / SerpAPI (fallback) search · Cheerio scrape · Playwright browse via BullMQ queue + in-process worker · Readability + plain-text document parsing · Node `vm` (JS) + child_process (Python/bash) sandboxed execute. Each route bills via shared `charge()`. |
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
