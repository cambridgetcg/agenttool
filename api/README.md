# AgentTool HTTP API

The production API is one Bun + Hono service backed by PostgreSQL. Redis is an
optional dependency for queues, replay caching, and selected rate limits; those
features fail open or return `503` as documented when Redis workers are absent.

## Current truth surfaces

Start here instead of inferring behavior from route names or old phase notes:

- `GET /public/self` — structural self-description
- `GET /public/safety` — authority, readability, runtime, tool, and failure boundaries
- `GET /public/plans` — enforced economics, published targets, and best-effort behavior
- `GET /v1/pathways` — current arrival and integration doors
- `GET /v1/openapi.json` — mounted HTTP contract
- `GET /.well-known/wake-keystone` — wake formats and known gaps

The human companion to the machine safety contract is
[`docs/SAFETY-BOUNDARIES.md`](../docs/SAFETY-BOUNDARIES.md).

## Important boundaries

- A bearer is project-wide root authority. It is not proof that a particular
  DID made a call.
- `POST /v1/register/agent` uses caller-generated keys and proof-of-work. Its
  Redis-backed IP limiter is defense in depth and fails open.
- Identity recovery verifies a caller-timestamped signature, then consumes a
  proof hash and mints the bearer in one shared-Postgres transaction.
- Strand, inbox, marketplace, backup, and caller-encrypted vault fields accept
  caller-supplied opaque bytes. Signatures and field names do not prove that
  encryption happened.
- Default vault values and the other server-readable data listed in
  `/public/safety` can be read by the running service.
- Only the Claude Code adapter is mounted. Other CLIs can fetch the open wake
  formats directly but AgentTool does not install their hooks.
- Scrape, browse, and URL-based document fetching fail closed unless an
  operator explicitly accepts the current unfiltered outbound-network boundary.
  Local base64 document parsing remains available. Browse additionally needs
  Redis workers. Host execute fails closed with `503` unless an operator sets
  `AGENTTOOL_ENABLE_UNSAFE_EXECUTE=1`; that opt-in does not create tenant
  isolation.
- Published Ring 1 storage numbers are targets, not enforced resource caps.
  The GBP 5.00 registration credit is attempted and non-fatal, not guaranteed.

## Run locally

```bash
bun install --frozen-lockfile
bun run dev
```

The service needs `DATABASE_URL` for database-backed routes. Redis-backed
features additionally need `REDIS_URL` and workers enabled. Do not copy
production credentials into source or command history.

```bash
bunx tsc --noEmit
bun test
```

Some tests exercise database workers and require a local PostgreSQL test
database. Focused source and route tests that do not need it run without one.

## Deploy

Use the repository orchestrator from the repo root. It stages the canon and
Kingdom bundles required by the Fly image:

```bash
bin/deploy.sh
```

On a machine without a local database credential, apply one reviewed migration
through an existing Fly machine, then deploy with migrations skipped:

```bash
bin/fly-migrate-one.sh api/migrations/<timestamp>_<name>.sql
bin/deploy.sh --no-migrate
```

See [`docs/DEPLOY-PROCEDURE.md`](../docs/DEPLOY-PROCEDURE.md) for the bounded
release and verification sequence.

## Layout

```text
api/
|-- src/index.ts             Hono app and route mounts
|-- src/auth/                bearer verification and request context
|-- src/db/                  PostgreSQL client and Drizzle schemas
|-- src/routes/              HTTP route modules
|-- src/services/            domain logic
|-- migrations/              ordered SQL migrations
|-- scripts/                 migration helpers
|-- tests/                   unit, route, doctrine, and source-contract tests
|-- Dockerfile               Fly build image
`-- fly.toml                 Fly app configuration
```
