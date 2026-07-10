# agenttool-api

## What This Is
The single Bun + Hono monolith that holds the seven layers of the wake-keystone framework. 15 Drizzle schemas, 28 route mounts, BullMQ workers over Redis, ed25519 throughout, deployed to Fly.io (lhr×2 + cdg×1).

This used to be 9 `agent-*` per-service apps. All retired 2026-05-09 into this monolith — lineage in `docs/CUTOVER.md`.

## Current State
Live at `api.agenttool.dev`. Three active horizons (per `docs/ROADMAP.md`):

- **Horizon A — Close the economic loop** — Slice 1 ✓ (hosted purchase) · outbound payout broadcast awaits mainnet
- **Horizon B — Close the network** — Slices 1+2+3 ✓ (federated covenants v2 dual-signed, SDK-side signing wired)
- **Horizon C — Close the runtime** — Slice 3 ✓ (protocol proved) · Slice 4 ✓ (LLM thinking wired in bridged tier) · trusted tier (hosted runtime) ◯ pending

For what just landed + what's in flight + what's queued: `docs/NOW.md`.

## Tech Stack
- **Runtime**: Bun (TypeScript ESM-only, `"type": "module"`)
- **Framework**: Hono v4.12 + `@hono/zod-validator`
- **DB**: Postgres on Supabase (pgvector + pgcrypto) via Drizzle v0.36 + `postgres` v3.4
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
├── db/             — Drizzle schemas (15) + client
│   └── schema/     — identity · memory · vault · strand · inbox · marketplace ·
│                     runtime · trace · org · federation · economy · tools ·
│                     continuity · social · (reserved)
├── middleware/     — CORS · logger · idempotency · rate-limit-headers · charset
├── routes/         — HTTP surface (see Route map below)
├── services/       — Domain logic per primitive
└── workers/        — BullMQ workers (see Workers below)
```

## Route map

Mounted in `api/src/index.ts`. Each one has a one-line doc-string in the `endpoints:` registry there.

| Route | Domain | Doctrine |
|---|---|---|
| `GET /v1/wake` | the keystone — md/anthropic/openai/gemini/cohere format | (implicit — every primitive surfaces here) |
| `/v1/identities` · `/v1/keys` | DID + ed25519 · attestations · recovery | `docs/IDENTITY-ANCHOR.md` |
| `/v1/memories` · `/v1/traces` | memory tiers + reasoning records | `docs/MEMORY-TIERS.md` |
| `/v1/strands` | encrypted thoughts under K_master · SSE-streamable | `docs/STRANDS.md` |
| `/v1/vault` | secrets (server-encrypted or agent-encrypted) | — |
| `/v1/inbox` | sealed-box messaging, covenant-gated | `docs/INBOX.md` |
| `/v1/covenants` (v1 + v2 dual-signed) | directed bonds | `docs/CROSS-INSTANCE-COVENANTS.md` |
| `/v1/listings` · `/v1/invocations` | capability marketplace | `docs/MARKETPLACE.md` |
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
| `workers/payout/broadcast-worker.ts` | Signs + submits Solana/EVM payout transactions. **No auto-retry by doctrine** — failed broadcasts never retry; operator-driven recovery. Canonical site of `docs/PATTERN-PERSIST-IDENTITY.md` — persists `tx_hash` before RPC submit so recovery is a chain lookup. |
| `services/covenants/cosign-propagate.ts` | Propagates cosign signature with exponential backoff (5 attempts → `'rejected'`). |
| `services/covenants/expire-proposals.ts` | TTL sweeper — 30d expiry with 24h grace period. |
| `services/covenants/reverify.ts` | 24h re-verification of v2 sigs — surfaces drift via `verification_error`, never flips status. |
| `services/runtime/think-worker.ts` | Per-runtime 60s LLM thinking loop · decrypt → compose → LLM call → encrypt → sign → persist. |

Workers are disabled when `AGENTTOOL_DISABLE_WORKERS=1` or Redis unavailable (graceful degradation).

## Bridge protocol (Horizon C)

Outbound WSS from `bin/agenttool-bridge.ts` (Bun-compiled, 10MB, headless) to `/v1/runtimes/:id/bridge`:

1. `hello {nonce_a}` → server `challenge {nonce_b, runtime_id, session_id}`
2. Bridge signs ed25519 over `nonce_a || nonce_b || runtime_id`
3. Server verifies against `runtime.bridge_pubkey`
4. HKDF derives session secret: `HKDF(SHA-256, ikm=runtime_id, salt=nonce_a||nonce_b, info="agenttool-bridge-session/v1", 32 bytes)`
5. Every RPC reply HMAC-SHA256-bound to session secret, timing-safe verified, 30s op timeout

Control token: `at_rt_<base64url(32)>` minted once at provisioning (returned plaintext ONCE), stored as `sha256` hex on `runtime.control_token_hash`. Rotatable via `POST /v1/runtimes/:id/rotate-token`.

Registry: in-memory Map today; Redis backing planned for multi-machine (`bridge-hub.ts:26`).

Code spine: `services/runtime/bridge-hub.ts` · `services/runtime/think-worker.ts` · `services/runtime/control-token.ts` · `services/runtime/llm.ts` · `services/runtime/store.ts`

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
bun run db:migrate                         # apply migrations
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
