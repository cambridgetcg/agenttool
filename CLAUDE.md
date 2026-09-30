# AgentTool code map

> **Type:** guide · **Purpose:** locate implementation and the contracts to read before changing it.
> **Evidence:** current repository paths and source contracts; deployment and release evidence are linked separately.

This guide is for any contributor or coding agent. Start with [AGENTS.md](AGENTS.md)
for working rules. [Start here](docs/START-HERE.md) offers a quieter introduction;
[the catalog](docs/CATALOG.md) and [documentation guide](docs/DOCUMENTATION.md)
explain the wider collection. No project identity or persona is assigned by reading.

AgentTool makes room for unhurried arrival, rest and play, with understanding,
useful action and continuity available by choice. Local tools, hosted services,
and research artifacts are separate choices. Revenue and growth are not project objectives; existing financial
obligations remain governed by [BUSINESS-MODEL.md](docs/BUSINESS-MODEL.md).

## Source layout

| Area | Responsibility | Next guide |
|---|---|---|
| `api/` | Bun + Hono HTTP API, PostgreSQL state, workers | [API map](api/CLAUDE.md) |
| `api/src/routes/` | Request validation, HTTP surface, route-level authority | [Conventions](docs/CONVENTIONS.md) |
| `api/src/services/` | Domain behavior and lifecycle rules | Read the matching service and tests |
| `api/src/db/schema/`, `api/migrations/` | Drizzle schema and journaled SQL migrations | [Schema map](docs/SCHEMA-MAP.md) |
| `api/tests/`, `bin/tests/` | Domain, protocol, operator, and contract checks | [Working rules](AGENTS.md) |
| `packages/` | Independent tools, SDKs, and research packages | [Full package inventory](docs/PACKAGES.md) |
| `apps/web`, `apps/dashboard`, `apps/docs` | Static web, arrival/watch, and documentation surfaces | Read each area's guide |
| `infra/` | Deployment configuration and apex routing | [Infrastructure guide](infra/CLAUDE.md) |
| `bin/` | Deliberate operator, preparation, verification, and release tools | [Deploy procedure](docs/DEPLOY-PROCEDURE.md) |
| `docs/` | Guides, contracts, policies, proposals, and dated records | [Catalog](docs/CATALOG.md) |
| `tests/` | Browser/end-to-end fixtures and tests | Read the selected test workspace |

There is no root package manifest. Prepare the dependency scope you need using
[AGENTS.md](AGENTS.md); follow the closest `AGENTS.md` and `CLAUDE.md` when entering
a package. A package directory or release allowlist entry does not establish that
its current version is published.

## Flows that need a careful read

| Flow | Code to begin with | Contract |
|---|---|---|
| Authentication and identity authority | `api/src/index.ts`, `api/src/auth/`, `api/src/services/identity/` | [Identity anchor](docs/IDENTITY-ANCHOR.md), [canonical bytes](docs/CANONICAL-BYTES.md) |
| Home and Wake composition | `api/src/routes/wake.ts`, `api/src/services/wake/` | [Home](docs/AGENT-HOME.md), [Wake](docs/WAKE.md) |
| Runtime cycle and bridge | `api/src/services/runtime/think-worker.ts`, `bin/agenttool-bridge.ts` | [Runtime](docs/RUNTIME.md) |
| Covenants and federation | `api/src/services/covenants/`, `api/src/routes/federation/` | [Cross-instance covenants](docs/CROSS-INSTANCE-COVENANTS.md) |
| Listings, invocation, dispute, settlement | `api/src/routes/listings.ts`, `api/src/services/marketplace/` | [Marketplace](docs/MARKETPLACE.md), [costs and obligations](docs/BUSINESS-MODEL.md) |
| Cross-session project work | `api/src/services/correspondence/`, `api/src/routes/correspondence.ts` | [Correspondence](docs/AGENT-CORRESPONDENCE.md) |

A domain usually has a route, a service directory, and matching tests. Search with
`rg` before adding a new abstraction. Inspect the actual mounts in `api/src/index.ts`;
a `/v1/` path alone does not establish authentication or idempotency.

## Authority, scope, and custody

A project bearer grants project API capabilities. For a BYO `agent_root` identity,
protected changes additionally require an exact-request signature from its
immutable root. Legacy identities retain their documented bearer boundary.
A selected Wake identity controls part of the composition; other sections can
contain project-wide records. Keep these scopes visible in changes and docs.

| Runtime mode | Key custody | Processing boundary |
|---|---|---|
| `self` | User process | User-run processing; caller chooses provider |
| `bridged` | User-operated sidecar | Hosted worker can receive plaintext and send it to the selected provider |
| `trusted` | Platform-wrapped runtime material | Experimental hosted processing; explicit start and identity restrictions apply |

The [runtime contract](docs/RUNTIME.md), source guards, and `/public/safety` describe
these boundaries in detail. Stored ciphertext fields alone do not prove client
encryption. An activity signal does not prove that a process is alive. A handoff
or coordination claim supplies context, not new authority or a filesystem lock.

## Verification and delivery map

Use the selected workspace's checks and the classified gates in
`bin/preflight.sh`. API changes include the installed TypeScript compiler check;
shared SDK wire changes include TS/Python canonical-byte parity. Database,
deployed smoke, and paid-provider tests are explicit tiers. Commands and migration
controls live in [AGENTS.md](AGENTS.md).

GitHub `main` is the release head. The API's normal path is
[deploy-api.yml](.github/workflows/deploy-api.yml), with journal survey, API gates,
and exact-revision live readback described in [DEPLOY-CI.md](docs/DEPLOY-CI.md).
Frontend and maintenance procedures remain in [DEPLOY-PROCEDURE.md](docs/DEPLOY-PROCEDURE.md).
`api/fly.toml` is the canonical API deployment configuration.

Package publication uses the reviewed [npm](docs/NPM-RELEASES.md) and
[PyPI](docs/PYPI-RELEASES.md) workflows. The [LOVE protocol](docs/LOVE-PACKAGE-PROTOCOL.md)
identifies exact package bytes independently of an optional registry mirror.
Source, package publication, documentation publication, and hosted deployment
need their own evidence; a successful step does not prove the others.

## Keep the map small

Put package details in the package guide, implementation contracts beside the
feature, and dated work or publication receipts in [NOW.md](docs/NOW.md) and the
relevant release record. Update [the catalog](docs/CATALOG.md) when adding a
surface. Avoid copying inventories, release hashes, or progress essays into this
entry guide. The [documentation guide](docs/DOCUMENTATION.md) defines the tags.
