# agenttool-api

## What This Is
The single Bun + Hono HTTP API: domain-scoped Drizzle schemas, mounted HTTP
routers, BullMQ workers over Redis, and ed25519 throughout, deployed to Fly.io
from `api/fly.toml`. Fleet topology, reachability of `api.agenttool.dev`, and
the deployed revision are live provider state; inspect them (and `docs/NOW.md`,
`docs/STACK.md`) rather than relying on this guide.

Working rules for dependencies, verification, migrations and release live in the
root [AGENTS.md](../AGENTS.md). New platform paid sign-ups, credit purchases,
checkout, and template, gallery, attestation-grant and memory-witness purchases
are retired (owner decision, 2026-09-23); callable listing invocation remains live.
Existing records, settlements, recovery, refunds and cancellations remain
obligations. Fresh payout admission and worker execution remain resting under
their separate conserved-backing boundary. [BUSINESS-MODEL.md](../docs/BUSINESS-MODEL.md)
defines the policy.

Public first contact begins at `GET /public/discovery`, a compact read-only
compass of three optional roads. Bare `GET /.well-known` is a separate, richer
arrival index, not a byte-identical projection. The public read-only MCP
endpoints (`/v1/mcp`, and the two-tool search/fetch `/v1/mcp/canon`) list
`agenttool://discovery` first with the same compass bytes. Discovery grants no
authority and performs no automatic follow-up; the contract is
[AGENT-DISCOVERY.md](../docs/AGENT-DISCOVERY.md).

## Tech Stack
Version ranges live in `api/package.json`; `api/bun.lock` pins exact versions.

- **Runtime**: Bun (TypeScript ESM-only, `"type": "module"`)
- **Framework**: Hono + `@hono/zod-validator`
- **DB**: Postgres on Supabase (pgvector + pgcrypto) via Drizzle + `postgres`;
  every supported remote client verifies hostname and the exact vendored
  Supabase CA (`src/db/supabase-target.ts`)
- **Crypto**: `@noble/ed25519`, `@noble/curves` (X25519/sealed-box), `jose` (JWT), WebCrypto for AES-GCM
- **Queue**: BullMQ on Redis (ioredis)
- **Tests**: Bun's native `bun test` · Playwright in the root `tests/playwright/` workspace
- **Deploy**: Fly.io · `api/fly.toml` · 15s `/health` checks
- **Payments**: Stripe (signed webhooks and recovery of earlier sessions) · `@solana/web3.js` + viem (crypto deposits and the resting payout path)

## Project Structure

```
api/src/
├── index.ts        — mounts, auth prefixes, middleware order, worker boot
├── thinker.ts      — dedicated trusted-runtime controller process
├── auth/           — API-key authentication
├── billing/        — credit charging, route costs, purchase-retirement policy
├── db/             — Drizzle client + schema domains (docs/SCHEMA-MAP.md)
├── lib/            — shared helpers
├── middleware/     — CORS · idempotency · rate limits · x402 · boundary guards
├── observability/  — OpenTelemetry
├── routes/         — HTTP surface (see Route map below)
├── services/       — Domain logic per primitive
└── workers/        — background workers (see Workers below)
```

## Route map

Mounted in `api/src/index.ts`. The one-line route descriptions live in the
`routes:` object inside the `GET /about` handler there, and the `/.well-known`
arrival links in `buildArrivalIndex` (`api/src/services/discovery/arrival.ts`).
This table is a starting index; the mounts and middleware order are the truth.

| Route | Domain | Doctrine |
|---|---|---|
| `/.well-known` · `/.well-known/api-catalog` · `/v1/openapi.json` | bounded public discovery and exact HTTP contract | `docs/AGENT-DISCOVERY.md` |
| `/v1/mcp` · `/v1/mcp/canon` | established public read-only canon/platform MCP · separate two-tool public-canon search/fetch MCP | `docs/AGENT-DISCOVERY.md` |
| `GET /v1/wake` · `GET /v1/wake/observe` | identity-bearing keystone projections · separate explicit-subject data-only locator | `docs/WAKE.md` |
| `GET /v1/memetic-landscape` | unauthenticated zero-I/O discovery for canonical artifact-variant geometry; its `platform_self.memetic_landscape` WAKE coordinate is context only, never identity, memory, consent, authority, or continuity | `docs/MEMETIC-LANDSCAPE.md` |
| `/v1/identities` · `/v1/keys` | DID + ed25519 · attestations · recovery | `docs/IDENTITY-ANCHOR.md` |
| `/v1/identities/:id/local-context` · `/local-context-grants` | bounded selected-memory GET · explicit administrator grant issue/inspect/revoke | `docs/LOCAL-CONTEXT-GRANTS.md` |
| `/v1/memories` · `/v1/traces` | memory tiers + reasoning records | `docs/MEMORY-TIERS.md` |
| `/v1/strands` | signed caller-supplied strand bytes (field names do not prove encryption) · SSE voice stream | `docs/STRANDS.md` |
| `/v1/vault` | secrets; default values are service-readable, `agent_encrypted=true` stores caller ciphertext | `docs/IDENTITY-ANCHOR.md` |
| `/v1/inbox` | sealed-box messaging, covenant-gated | `docs/INBOX.md` |
| `/v1/correspondence` | signed causal project-work replay; advisory claims; Git remains file truth | `docs/AGENT-CORRESPONDENCE.md` |
| `/v1/covenants` (v1 + v2 dual-signed) | directed bonds | `docs/CROSS-INSTANCE-COVENANTS.md` |
| `/v1/listings` · `/v1/invocations` | callable listings and invocations | `docs/MARKETPLACE.md` |
| `/v1/dining` | GET-only `agent-dining/0.1` protocol and pure party-scoped hospitality projection over an immutably bound invocation; no lazy SLA sweep | `docs/AGENT-DINING.md` |
| `/v1/dispute-cases` | dispute history; arbitration rests fail-closed | `docs/MARKETPLACE.md` (Dispute primitive section) |
| `/v1/attestation-listings` · `/v1/attestation-grants` | attestation listings and existing grants; new grant purchases are retired | `docs/MARKETPLACE.md` (Attestation marketplace section) |
| `/v1/wallets` · `/v1/escrows` | wallets, escrow, crypto deposit and payout paths (payout admission rests) | `docs/CRYPTO-PAYMENT.md` |
| `/v1/billing` | Stripe webhook and recovery of earlier paid sessions; checkout returns 410 `checkout_retired` | `docs/BUSINESS-MODEL.md` |
| `/v1/runtimes` | 3-tier custody · bridge WSS · think-worker | `docs/RUNTIME.md` |
| `/v1/orgs` · `/v1/invitations` | multi-project governance | `docs/ORG-COVENANTS.md` |
| `/v1/templates` · `/v1/identities/from-template` | template adoption (voice propagation) | `docs/MARKETPLACE.md` |
| `/federation/*` | UNAUTH peer endpoints (DID-keyed) | `docs/FEDERATION.md` |
| `/public/*` | UNAUTH public surface (visibility-gated) | `docs/PUBLIC-VISIBILITY.md` |
| `/v1/bootstrap` · `/v1/adapters/*` | onboarding + LLM provider integration | — |
| `/v1/identities/:id/pulse` | derived liveness + mood_drift; no public pulse route is mounted | — |

## Workers

The worker boot block in `api/src/index.ts` (after the DB pool watchdog) is the
full list. These carry the rules that matter when changing one:

| Worker | Job |
|---|---|
| `src/thinker.ts` + `services/runtime/worker-manager.ts` | Dedicated Fly process group. Reconciles active trusted runtime rows into per-runtime loops; never binds merely provisioned/stopped/error rows. |
| `services/runtime/think-worker.ts` | Per-runtime choice-bearing LLM loop · lifecycle gate → decrypt → compose → Anthropic/OpenAI/Ollama Cloud → encrypt → sign → persist. Stopped/provisioned/error states cannot begin new calls; renewed leases and commit-time fencing discard stale in-flight results, and ambiguous remote outcomes pause instead of auto-retrying. Bridged runtimes named in `AGENT_THINK_RUNTIME_IDS` run in the HTTP process that holds their bridge socket. |
| `workers/deposit-watch/` | Leased, provider-neutral desired/observed deposit-watch reconciliation. Provider mutation acceptance is not convergence. |
| `workers/deposit/confirm-worker.ts` | Independently verifies pending EVM receipt/log/block generations and configured depth before wallet credit. Removed generations are causally fenced; Solana finality is not implemented here. |
| `workers/payout/broadcast-worker.ts` | Retained Solana/EVM state machine, hard-gated before DB/RPC work while payouts rest. Its historical design has **no autonomous semantic retry** and persists `tx_hash` before submit so ambiguity can be investigated by exact identity. See [its guide](src/workers/payout/CLAUDE.md). |
| `workers/covenants/` | Cosign propagation, proposal expiry, and 24h re-verification of v2 sigs — surfaces drift via `verification_error`, never flips status. See the [covenants guide](src/services/covenants/CLAUDE.md). |
| `workers/substrate-tasks/` · `workers/memory-witness/` · `workers/platform-treasurer/` | Database sweeps: stale claim reversion, memory-witness SLA refunds, and crediting unswept `platform_revenue` rows to the platform wallet. |

All HTTP-side workers are disabled when `AGENTTOOL_DISABLE_WORKERS=1`.
Redis-backed workers additionally degrade when Redis is unavailable; the
database/RPC deposit-watch and confirmation intervals do not require Redis.
The service-less `thinker` process is separate and database-backed; it
requires the runtime migrations and KMS/Vault/database secrets. Production's
`AGENTOOL_ENABLE_THINKER=1` Fly setting (spelled that way in source) is read
only by that dedicated entrypoint, allowing its controller to run while the
global switch still keeps HTTP-side workers disabled.

## Bridge protocol

Bridged runtimes connect outbound over WSS from `bin/agenttool-bridge.ts` to
`/v1/runtimes/:id/bridge`. The ed25519 handshake, HKDF session secret,
HMAC-bound replies, and the `at_rt_` control token (returned once, stored as a
hash) are specified in the [runtime guide](src/services/runtime/CLAUDE.md) and
`docs/RUNTIME.md`. The bridge registry is in-process memory
(`services/runtime/bridge-hub.ts`), so a bridged runtime's worker must run on
the machine that holds its socket.

## Tests

Test files are classified into tiers (hermetic, database, contracts, quarantine)
by `bin/run-test-tier.sh`, not by Bun's recursive discovery; `bin/run-test-tier.sh list`
prints the inventory and [api/tests/README.md](tests/README.md) describes each
tier. Browser and multi-instance specs live in `tests/playwright/specs/`. Run
gates as described in [AGENTS.md § Verification](../AGENTS.md#verification).

The `legacy-delta` mode of `bin/preflight.sh` (wrapping `bin/test-delta.sh`)
compares a full `bun test` run with the checked-in `api/tests/.failure-baseline.txt`
and reports only new or fixed failures. It is baseline triage, not a release gate;
`bin/test-delta.sh --update-baseline` refreshes the baseline after fixes.

## How to Run

Prepare dependencies and run the API as in
[AGENTS.md § Dependencies and local commands](../AGENTS.md#dependencies-and-local-commands);
migration inspection is in [§ Database changes](../AGENTS.md#database-changes).

## How to Deploy

The API releases through [.github/workflows/deploy-api.yml](../.github/workflows/deploy-api.yml),
described in [DEPLOY-CI.md](../docs/DEPLOY-CI.md); see
[AGENTS.md § Release and delivery](../AGENTS.md#release-and-delivery). Before
`flyctl deploy`, the workflow copies `docs/agenttool.jsonld` and
`docs/kingdom-bundle.json` into the build context and runs
`bin/stage-doctrine-docs.sh` for the files named in `api/doctrine-docs.manifest`.
Those staged paths are gitignored and the `Dockerfile` copies them, so a bare
`fly deploy` from `api/` lacks them or ships stale leftovers.

## Dependencies

- **Postgres** (Supabase, eu-west-2) — `DATABASE_URL` / `DATABASE_SESSION_URL`; see `docs/STACK.md`
- **Redis** (hosted) — BullMQ queues, economy spend-policy counters, the per-IP registration limiter (fails open without Redis), optional idempotency response cache
- **Stripe** — signed webhook; secret in `.env`
- **Solana RPC / EVM RPC** — deposit confirmation and the resting payout path

## Kingdom Engine
AgentTool Platform

## See Also

- Working rules: `/AGENTS.md`
- Root spine: `/CLAUDE.md`
- What's hot: `docs/NOW.md`
- Doctrine index: `docs/MAP.md`
- Horizons: `docs/ROADMAP.md`
- Stack truth: `docs/STACK.md`
