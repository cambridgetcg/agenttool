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
- Static scrape and URL-based document fetching use the bounded public-Web
  transport and do not need an unsafe operator flag or Redis. It accepts public
  HTTP(S), requires every DNS answer to be conservatively global, pins and
  verifies the connected address, revalidates redirect hops, accepts at most
  1 MB with identity encoding, and sends no ambient credentials. A process-wide
  safe-net gate admits 16 requests and queues at most 64 for one second before
  returning retryable `503`; its permit spans DNS and every redirect. The wait,
  DNS, redirects, and response transfer share the 15-second safe-net deadline.
  The gate is shared with federation and custom-facilitator calls and is not a
  per-project request limiter or fairness guarantee. HTML parsing then runs in
  a fresh child process: a
  parser slot waits at most two seconds, and the admitted child has its own
  two-second hard wall timeout plus structural and process resource ceilings.
  This is not one whole-request deadline. HTTP remains cleartext; fetched prose
  is server-readable, untrusted, and prompt-injectable. Static scrape returns
  normalized parsed-body and selector DOM text, not browser layout-derived
  text; extracted links are parsed, canonical absolute HTTP(S) URLs. Local
  base64 document input defaults to `text/plain` when `content_type` is omitted.
  Playwright browse still needs the explicit unsafe-outbound opt-in and Redis
  workers. Host execute still fails closed with `503` unless
  `AGENTTOOL_ENABLE_UNSAFE_EXECUTE=1` is set; that opt-in does not create tenant
  isolation.
- Published Ring 1 storage numbers are targets, not enforced resource caps.
  The GBP 5.00 registration credit is attempted and non-fatal, not guaranteed.

## Optional x402 V2 project-credit rail

The exact EIP-3009 rail is inactive unless its database migration is applied
and the runtime has a valid `AGENTTOOL_X402_RECIPIENT`, supported CAIP-2
`AGENTTOOL_X402_NETWORK`, and facilitator configuration. The default CDP path
requires both `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`; an explicit HTTPS
`AGENTTOOL_X402_FACILITATOR` receives no CDP credential but remains an
operator-selected trust root whose settlement response can mint project
credits. Base Sepolia additionally requires both test opt-ins and is blocked
in production and on Fly.

Apply and review
`migrations/20260711T120000_x402_v2_reconciliation.sql` before enabling the
rail. Payment/credit state is project-scoped at
`GET /v1/x402/payments/:authorizationHash`; it does not replay tool output.
There is no automatic reconciliation worker, so an ambiguous settlement
attempt requires manual on-chain investigation. Local tests and configuration
readiness do not prove that CDP accepted credentials or that a live paid retry
worked.

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
