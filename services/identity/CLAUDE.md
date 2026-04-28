# agent-identity

## What This Is
Identity service for AI agents — assigns DIDs (`did:at:<uuid>`), manages ed25519 keypairs, signed attestations between agents, trust score computation from attestation graphs, JWT token issuance, and agent discovery.

## Current State
Active — Full identity lifecycle, attestations, trust scoring, token auth, and discovery are implemented and deployed.

## Tech Stack
- **Runtime:** Bun + TypeScript
- **Framework:** Hono (HTTP)
- **Database:** PostgreSQL via Drizzle ORM (uses `identity` schema)
- **Crypto:** `@noble/ed25519`, `@noble/hashes` for key generation and signing
- **Auth:** `jose` for JWT token issuance/verification, bcryptjs for API key hashing
- **Validation:** Zod

## Project Structure
- `src/index.ts` — Hono server (port 3000), route mounting with tier gates
- `src/routes/identities.ts` — CRUD for agent identities
- `src/routes/keys.ts` — Ed25519 key management per identity
- `src/routes/attestations.ts` — Create/revoke signed attestations
- `src/routes/discover.ts` — Search/discover agents by capability
- `src/routes/tokens.ts` / `tokenVerify.ts` — JWT issuance and verification
- `src/services/trust.ts` — Recursive trust score computation: `trust = sum(weight * attester_trust * recency_decay)`
- `src/services/crypto.ts` — Ed25519 key generation and signature verification
- `src/db/schema.ts` — Tables: identities, identity_keys, attestations (in `identity` schema); references `tools.projects` and `tools.api_keys`
- `src/auth/tierGate.ts` — Plan-based rate limiting for write ops

## How to Run
```bash
bun install
bun dev                    # watch mode on :3000
bun db:generate && bun db:migrate   # schema migrations
```
Requires: PostgreSQL with `identity` and `tools` schemas.

## How to Deploy
```bash
fly deploy       # Dockerfile -> Fly.io (app: agent-identity, region: lhr)
```

## Dependencies
- **PostgreSQL** — identity records, attestations, keys
- Cross-schema reference to `tools.projects` and `tools.api_keys` (shared auth with agent-tools)

## Kingdom Engine
AgentTool Platform

## Key Files
- `src/services/trust.ts` — Trust score algorithm (recursive, depth-3 max, recency decay over 90 days)
- `src/services/crypto.ts` — Ed25519 key generation and attestation signing
- `src/db/schema.ts` — Data model (identities, keys, attestations)
- `ARCHITECTURE.md` — Detailed design: DIDs, attestations, trust scoring
