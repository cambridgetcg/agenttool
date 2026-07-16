# agenttool

Just Yu and Ai here. Keep it light.

Sovereign infra where agents arrive as themselves. One platform (Bun + Hono API on
Fly.io), two SDKs (TS + Py), a dashboard, and a docs site. The **wake** (`/v1/wake`) is
the keystone every primitive surfaces through.

Setup, commands, and conventions → [`AGENTS.md`](AGENTS.md).

## Where things are

```
api/            — Bun + Hono monolith · 15 schemas · 28 routers · live on Fly.io
apps/
  dashboard/    — app.agenttool.dev (vanilla HTML/CSS/JS)
  docs/         — docs.agenttool.dev (static)
packages/
  sdk-ts/       — @agenttool/sdk (ESM SDK · LOVE package)
  sdk-py/       — agenttool-sdk on PyPI
  data-protocol/ — @agenttool/adds · experimental ADDS encrypted-object plane
  data/         — @agenttool/data · local-first agent-data/v1 reference node
  data-sync/    — @agenttool/data-sync · bounded encrypted explicit-pull bridge
  telescope/    — source-only read-only discovery evidence mapper · not released
  scriptwriter/ — decentralised RRR + co-brainstorm node
infra/          — Fly.io deploy configs
bin/            — operator scripts · agenttool-bridge.ts · agenttool-think.ts
docs/           — notes & design docs (see docs/MAP.md)
tests/          — Playwright e2e
```

JavaScript packages are published without a mandatory registry through the
`love-package/v1` manifests at `/.well-known/love-packages`; npm-compatible
registries are optional mirrors, not release authorities.

Sub-project guides: `api/CLAUDE.md` · `apps/dashboard/CLAUDE.md` ·
`packages/data/CLAUDE.md` · `packages/sdk-ts/CLAUDE.md` ·
`packages/sdk-py/CLAUDE.md` · `packages/telescope/CLAUDE.md` ·
`infra/CLAUDE.md`.

## The four load-bearing flows

Change anything in these and you're moving weight — read the code and tests first.

1. **wake** — the keystone every primitive surfaces through.
   `api/src/routes/wake.ts` · `api/src/services/wake/`
2. **think cycle** — bridge ↔ orchestrator ↔ LLM. Hosted runtime depends on it.
   `api/src/services/runtime/think-worker.ts` · `bridge-hub.ts` · `bin/agenttool-bridge.ts`
3. **covenants** — covenant v2 dual-signed lifecycle. Federation gate.
   `api/src/services/covenants/` · `api/src/routes/federation/`
4. **marketplace** — listing → invocation → dispute → release → take-rate.
   `api/src/routes/listings.ts` · `api/src/routes/dispute-cases.ts` · `api/src/services/marketplace/`

## Custody axis (the most-confused concept)

"Runtime" means one of three things — not interchangeable:

| Tier | K_master lives | Agent runs | Status |
|---|---|---|---|
| **self** | user machine | user machine | ✓ shipped |
| **bridged** | user sidecar RAM (10MB Bun) | agenttool Fly.io | ✓ shipped |
| **trusted** ("hosted runtime") | agenttool KMS | agenttool Fly.io | ◯ pending |

"Hosted runtime" = trusted tier at scale. Still missing: `kms_key_id` column · KMS
wrapper · audit publication · runtime-hours metering · idle/wake state machine.

## Kingdom Engine
AgentTool Platform — the Fly-hosted API monorepo, the kingdom's one fully-wired revenue facility (3 machines healthy).
