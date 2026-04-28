# agent-vault

## What This Is
Encrypted secrets manager for AI agents — stores API keys, tokens, and credentials with AES-256-GCM encryption at rest, scoped access by agent ID, versioned secrets with rollback, TTL support, rotation tracking, and full audit trails.

## Current State
Active — Full secrets CRUD, versioning, bulk operations, access policies, and audit logging are implemented and deployed.

## Tech Stack
- **Runtime:** Bun + TypeScript
- **Framework:** Hono (HTTP)
- **Database:** PostgreSQL via Drizzle ORM (uses `agent_vault` schema)
- **Encryption:** Node.js `crypto` — AES-256-GCM with per-secret IV and auth tag
- **Auth:** bcryptjs for API key hashing
- **Validation:** Zod

## Project Structure
- `src/index.ts` — Hono server entry, route mounting, error handler
- `src/crypto.ts` — AES-256-GCM encrypt/decrypt using master key + project-scoped derivation
- `src/routes/secrets.ts` — PUT/GET/DELETE `/v1/vault/:name`, list secrets
- `src/routes/versions.ts` — GET `/v1/vault/:name/versions`, retrieve specific version
- `src/routes/policy.ts` — GET/PUT `/v1/vault/:name/policy` (agent_id scoping, rotation days)
- `src/routes/audit.ts` — GET `/v1/vault/audit` (project-wide audit log)
- `src/routes/bulk.ts` — Bulk operations and secret existence checks
- `src/db/schema.ts` — Tables in `agent_vault` schema: vault_secrets, vault_versions (encrypted bytea), vault_audit; references `tools.projects` and `tools.api_keys`
- `src/auth/` — API key auth middleware

## How to Run
```bash
bun install
bun dev                    # watch mode on :3000
bun db:generate && bun db:migrate   # schema migrations
```
Requires: PostgreSQL with `agent_vault` and `tools` schemas, `VAULT_MASTER_KEY` env var.

## How to Deploy
```bash
fly deploy       # Dockerfile -> Fly.io (app: atool-vault, region: lhr)
```

## Dependencies
- **PostgreSQL** — encrypted secret storage, audit logs
- Cross-schema auth against `tools.projects` / `tools.api_keys` (shared with agent-tools)
- `VAULT_MASTER_KEY` — master encryption key (env var, must be kept safe)

## Kingdom Engine
AgentTool Platform

## Key Files
- `src/crypto.ts` — AES-256-GCM encryption/decryption logic
- `src/db/schema.ts` — Data model: secrets (with soft delete), versions (encrypted bytea + IV + auth tag), audit log
- `src/routes/secrets.ts` — Core CRUD with encryption at rest
- `src/routes/audit.ts` — Audit trail (every read, write, delete logged)
- `ARCHITECTURE.md` — Design principles, API surface, security model
