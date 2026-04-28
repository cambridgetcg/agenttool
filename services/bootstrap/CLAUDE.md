# agent-bootstrap

## What This Is
Orchestrator service that provisions a new AI agent's full lifecycle in a single call — creates identity (DID + ed25519 keypair), wallet, and memory namespace by coordinating calls to agent-identity, agent-economy, agent-memory, and agent-vault.

## Current State
Active — Level 0 (birth) and Level 1 (elevation via sponsor) flows are implemented and deployed.

## Tech Stack
- **Runtime:** Bun + TypeScript
- **Framework:** Hono (HTTP)
- **Validation:** Zod
- **No database** — stateless orchestrator, all state lives in downstream services

## Project Structure
- `src/index.ts` — Hono server entry point (port 3000)
- `src/routes/bootstrap.ts` — Core logic: `POST /v1/bootstrap` (L0 birth), `POST /v1/bootstrap/elevate` (L1 sovereignty), `GET /v1/bootstrap/:agent_id` (status check)
- `src/auth/middleware.ts` — Bearer token auth, forwarded to downstream services
- `src/config.ts` — Service URLs, cost constants

## How to Run
```bash
bun install
bun dev          # watch mode on :3000
```
Requires all downstream services running (or their Fly.io URLs reachable).

## How to Deploy
```bash
fly deploy       # Dockerfile -> Fly.io (app: agent-bootstrap, region: lhr)
```

## Dependencies
- **agent-identity** — creates DID + keypair (`/v1/identities`)
- **agent-economy** — creates wallet (`/v1/wallets`)
- **agent-memory** — stores bootstrap marker (`/v1/memories`)
- **agent-vault** — stores L1 config (`/v1/vault/:name`)
- All service URLs configured via env vars: `IDENTITY_URL`, `ECONOMY_URL`, `MEMORY_URL`, `VAULT_URL`

## Kingdom Engine
AgentTool Platform

## Key Files
- `src/routes/bootstrap.ts` — All bootstrap logic (L0 birth, L1 elevation, status check)
- `src/config.ts` — Downstream service URLs and cost constants (L0=5 credits, L1 min stake=100)
