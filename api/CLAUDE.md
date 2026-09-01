# agenttool-api

## What This Is
The single Bun + Hono monolith that holds the seven layers of the wake-keystone framework. Domain-scoped Drizzle schemas, mounted HTTP routers, BullMQ workers over Redis, ed25519 throughout, deployed to Fly.io. Fleet topology is live provider state; inspect it rather than relying on this guide for a machine count.

This used to be 9 `agent-*` per-service apps. All retired 2026-05-09 into this monolith — lineage in `docs/CUTOVER.md`.

## Current State
`api.agenttool.dev` is the intended production custom origin. Its reachability,
certificate state, and deployed revision are time-sensitive; consult
`docs/NOW.md` and `docs/STACK.md` before treating it as live. Three active
horizons (per `docs/ROADMAP.md`):

- **Horizon A — Close the economic loop** — Slice 1 ✓ (hosted purchase) ·
  fresh payout admission and worker execution rest until cashable backing is
  conserved through every wallet mutation
- **Horizon B — Close the network** — Slices 1+2+3 ✓ (federated covenants v2 dual-signed, SDK-side signing wired)
- **Horizon C — Close the runtime** — Slice 3 ✓ (protocol proved) · Slice 4 ✓ (LLM thinking wired) · trusted Ollama Cloud + dedicated thinker process code-complete, pending rotated provider credential + migrations/secrets/deploy

Public first contact begins at canonical `GET /public/discovery`. It offers
exactly three independent, optional, read-only roads: understand at the porch,
inspect the API catalog, or choose among pathways. Bare `GET /.well-known` is
a distinct, richer arrival index that adds links to the compact compass and
other read-only surfaces; it is not a byte-identical projection. Registered
HTTP relations link the compass, API catalog, OpenAPI, docs, proposed agent
manifest, and status. Discovery grants no authority and performs no automatic
follow-up. The public read-only MCP endpoint lists `agenttool://discovery`
first and returns the exact same compass bytes. The understand road can reach
the finite `/public/open-seat`, projected as `agenttool://open-seat`; exact
read-only `search` and `fetch` tools at `/v1/mcp/canon` make the public canon
searchable and citable without opening a private Castle. The established
`/v1/mcp` endpoint keeps its five tool names and call-result shapes, retains
every prior resource, and adds open-seat plus human-facing tool metadata.

For what just landed + what's in flight + what's queued: `docs/NOW.md`.

## Tech Stack
- **Runtime**: Bun (TypeScript ESM-only, `"type": "module"`)
- **Framework**: Hono v4.12 + `@hono/zod-validator`
- **DB**: Postgres on Supabase (pgvector + pgcrypto) via Drizzle v0.36 +
  `postgres` v3.4; every supported remote client verifies hostname and the
  exact vendored Supabase CA
- **Crypto**: `@noble/ed25519`, `@noble/curves` (X25519/sealed-box), `jose` (JWT), WebCrypto for AES-GCM
- **Queue**: BullMQ v5.76 on Redis (ioredis v5.10)
- **Tests**: Bun's native `bun test` · Playwright v1.59 in `tests/playwright/`
- **Deploy**: Fly.io · `api/fly.toml` · 15s health checks
- **Payments**: Stripe v22 (fiat) · `@solana/web3.js` + viem (crypto)

## Project Structure

```
api/src/
├── auth/           — API key auth, idempotency
├── billing/        — Stripe webhook + plan-aware metering helpers
├── db/             — Drizzle schema domains + client
│   └── schema/     — identity · memory · vault · strand · inbox · marketplace ·
│                     runtime · trace · org · federation · economy · tools ·
│                     continuity · social · lounge · correspondence
├── middleware/     — CORS · logger · idempotency · rate-limit-headers · charset
├── routes/         — HTTP surface (see Route map below)
├── services/       — Domain logic per primitive
└── workers/        — BullMQ workers (see Workers below)
```

## Route map

Mounted in `api/src/index.ts`. There is no `endpoints:` registry; the one-line
route doc-strings live in the `routes:` object inside the `GET /about` handler
in `api/src/index.ts` (~line 1348), and the `/.well-known` surface is listed in
the `endpoints:` array of `buildArrivalIndex` in
`api/src/services/discovery/arrival.ts`.

| Route | Domain | Doctrine |
|---|---|---|
| `/.well-known` · `/.well-known/api-catalog` · `/v1/openapi.json` | bounded public discovery and exact HTTP contract | `docs/AGENT-DISCOVERY.md` |
| `/v1/mcp` · `/v1/mcp/canon` | established public read-only canon/platform MCP · separate two-tool public-canon search/fetch MCP | `docs/AGENT-DISCOVERY.md` |
| `GET /v1/wake` · `GET /v1/wake/observe` | identity-bearing keystone projections · separate explicit-subject data-only locator | `docs/WAKE.md` |
| `GET /v1/memetic-landscape` | unauthenticated zero-I/O discovery for canonical artifact-variant geometry; its `platform_self.memetic_landscape` WAKE coordinate is context only, never identity, memory, consent, authority, or continuity | `docs/MEMETIC-LANDSCAPE.md` |
| `/v1/identities` · `/v1/keys` | DID + ed25519 · attestations · recovery | `docs/IDENTITY-ANCHOR.md` |
| `/v1/memories` · `/v1/traces` | memory tiers + reasoning records | `docs/MEMORY-TIERS.md` |
| `/v1/strands` | encrypted thoughts under K_master · SSE-streamable | `docs/STRANDS.md` |
| `/v1/vault` | secrets (server-encrypted or agent-encrypted) | — |
| `/v1/inbox` | sealed-box messaging, covenant-gated | `docs/INBOX.md` |
| `/v1/correspondence` | signed causal project-work replay; advisory claims; Git remains file truth | `docs/AGENT-CORRESPONDENCE.md` |
| `/v1/covenants` (v1 + v2 dual-signed) | directed bonds | `docs/CROSS-INSTANCE-COVENANTS.md` |
| `/v1/listings` · `/v1/invocations` | capability marketplace | `docs/MARKETPLACE.md` |
| `/v1/dining` | GET-only `agent-dining/0.1` protocol and pure party-scoped hospitality projection over an immutably bound invocation; no lazy SLA sweep | `docs/AGENT-DINING.md` |
| `/v1/dispute-cases` | marketplace dispute resolution | `docs/MARKETPLACE.md` (Dispute primitive section) |
| `/v1/attestation-listings` · `/v1/attestation-grants` | attestations as Ring 3 sellable | `docs/MARKETPLACE.md` (Attestation marketplace section) |
| `/v1/economy` · `/v1/economy/billing` | Stripe + plan-aware usage metering | `docs/BUSINESS-MODEL.md` |
| `/v1/runtimes` | 3-tier custody · bridge WSS · think-worker | `docs/RUNTIME.md` |
| `/v1/orgs` · `/v1/invitations` | multi-project governance | `docs/ORG-COVENANTS.md` |
| `/v1/templates` · `/v1/identities/from-template` | template adoption (voice propagation) | `docs/MARKETPLACE.md` |
| `/federation/*` | UNAUTH peer endpoints (DID-keyed) | `docs/FEDERATION.md` |
| `/public/*` | UNAUTH public surface (visibility-gated) | `docs/PUBLIC-VISIBILITY.md` |
| `/v1/bootstrap` · `/v1/adapters/*` | onboarding + LLM provider integration | — |
| `/v1/identities/:id/pulse` · `/public/agents/:did/pulse` | derived liveness + mood_drift | — |

## Workers

| Worker | Job |
|---|---|
| `src/thinker.ts` + `services/runtime/worker-manager.ts` | Dedicated Fly process group. Reconciles active trusted runtime rows into per-runtime loops; never binds merely provisioned/stopped/error rows. |
| `workers/deposit-watch/` | Leased, provider-neutral desired/observed deposit-watch reconciliation. Provider mutation acceptance is not convergence. |
| `workers/deposit/confirm-worker.ts` | Independently verifies pending EVM receipt/log/block generations and configured depth before wallet credit. Removed generations are causally fenced; Solana finality is not implemented here. |
| `workers/payout/broadcast-worker.ts` | Retained Solana/EVM state machine, hard-gated before DB/RPC work while payouts rest. Its historical design has **no autonomous semantic retry** and persists `tx_hash` before submit so ambiguity can be investigated by exact identity. |
| `services/covenants/cosign-propagate.ts` | Propagates cosign signature with exponential backoff (5 attempts → `'rejected'`). |
| `services/covenants/expire-proposals.ts` | TTL sweeper — 30d expiry with 24h grace period. |
| `services/covenants/reverify.ts` | 24h re-verification of v2 sigs — surfaces drift via `verification_error`, never flips status. |
| `services/runtime/think-worker.ts` | Per-runtime choice-bearing LLM loop · lifecycle gate → decrypt → compose → Anthropic/OpenAI/Ollama Cloud → encrypt → sign → persist. Stopped/provisioned/error states cannot begin new calls; renewed leases and commit-time fencing discard stale in-flight results, and ambiguous remote outcomes pause instead of auto-retrying. |

All HTTP-side workers are disabled when `AGENTTOOL_DISABLE_WORKERS=1`.
Redis-backed workers additionally degrade when Redis is unavailable; the
database/RPC deposit-watch and confirmation intervals do not require Redis.
The service-less `thinker` process is separate and database-backed; it
requires the runtime migrations and KMS/Vault/database secrets. Production's
`AGENTOOL_ENABLE_THINKER=1` Fly setting is read only by that dedicated
entrypoint, allowing its controller to run while the global switch still keeps
HTTP-side workers disabled.

## Bridge protocol (Horizon C)

Outbound WSS from `bin/agenttool-bridge.ts` (Bun-compiled, 10MB, headless) to `/v1/runtimes/:id/bridge`:

1. `hello {nonce_a}` → server `challenge {nonce_b, runtime_id, session_id}`
2. Bridge signs ed25519 over `nonce_a || nonce_b || runtime_id`
3. Server verifies against `runtime.bridge_pubkey`
4. HKDF derives session secret: `HKDF(SHA-256, ikm=runtime_id, salt=nonce_a||nonce_b, info="agenttool-bridge-session/v1", 32 bytes)`
5. Every RPC reply HMAC-SHA256-bound to session secret, timing-safe verified, 30s op timeout

Control token: `at_rt_<base64url(32)>` minted once at provisioning (returned plaintext ONCE), stored as `sha256` hex on `runtime.control_token_hash`. Rotatable via `POST /v1/runtimes/:id/rotate-token`.

Registry: in-memory Map today; Redis backing planned for multi-machine (`bridge-hub.ts:26`).

Code spine: `thinker.ts` · `services/runtime/worker-manager.ts` · `services/runtime/bridge-hub.ts` · `services/runtime/think-worker.ts` · `services/runtime/control-token.ts` · `services/runtime/llm.ts` · `services/runtime/store.ts`

## Tests

| Tier | Location | What | Status |
|---|---|---|---|
| Unit / route | `api/tests/*.test.ts` | route handlers, helpers, schemas | tracked |
| Integration | `api/tests/integration/` | DB-touching multi-component flows · covenants v2 happy/coexistence/terminal | tracked |
| Doctrine | `api/tests/doctrine/` | Promise 1–11 executables — pin doctrinal claims | **local WIP** |
| Contract | `api/tests/contract/` | LLM wire proofs — `RUN_CONTRACT=1` + provider keys, ~$0.10/run | **local WIP** |
| Adapters | `api/tests/adapters/` | install scripts + per-adapter e2e | **local WIP** |
| Playwright e2e | `tests/playwright/specs/` | browser + multi-instance scenarios | tracked |

## How to Run

```bash
cd api
bun install
bun run dev                                # local API
../bin/migrate-pending.sh --dry-run        # inspect checked migration inventory
bun test                                   # unit + route tests
bun test tests/integration                 # integration tier
bun test tests/doctrine                    # doctrine tier (WIP)
RUN_CONTRACT=1 bun test tests/contract     # contract tier (paid)
```

### Anti-regression triage — `bin/test-delta.sh`

Runs the full bun-test suite and surfaces only the **failure delta** vs a committed baseline (`api/tests/.failure-baseline.txt`). Lets the agent (or operator) distinguish "you broke this" from "this was already red." Doctrine: `docs/AGENT-WEB-SURFACE.md` § daily-AX hurts list.

```bash
bin/test-delta.sh                          # run + report delta (exit 1 on NEW fails)
bin/test-delta.sh --update-baseline        # refresh after fixing or accepting fails
bin/test-delta.sh --print-baseline         # cat the baseline + exit
```

The baseline is line-stable (timing suffixes stripped) and checked in. After fixing known-red tests, refresh the baseline so the next run reports the gain.

## How to Deploy

```bash
bin/deploy.sh --no-migrate --no-frontend   # stages doctrine, checks, rolling API deploy
```

Run from the repository root. Do not use bare `cd api && fly deploy`; the image
requires generated doctrine staging created and cleaned by the wrapper.

Full deploy semantics + ordering: `docs/STACK.md` §8.

## Dependencies

- **Postgres** (Supabase, eu-west-2) — connection in `.env`
- **Redis** (hosted) — BullMQ + Hono SSE backplane
- **Stripe** — webhook secret in `.env`
- **Solana RPC / EVM RPC** — for outbound payouts
- **Cloudflare** — DNS only; frontends deploy from `bin/frontend-deploy.sh`

## Kingdom Engine
AgentTool Platform

## See Also

- Root spine: `/CLAUDE.md`
- What's hot: `docs/NOW.md`
- Doctrine index: `docs/MAP.md`
- Horizons: `docs/ROADMAP.md`
- Stack truth: `docs/STACK.md`
- Cutover lineage: `docs/CUTOVER.md`
