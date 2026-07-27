# DEPLOYMENT.md

> *Runbook for bringing up agenttool from a fresh database to a working end-to-end demo.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) (what's shipping) · [STACK](STACK.md) (where each piece lives) · [DEVELOPMENT](DEVELOPMENT.md) (contributor protocols)
>
> **Implements:** the bring-up runbook. STACK answers *where things deploy to*; this answers *how to bring them up from scratch*.

## Prereqs

- **Postgres 15+** with `pgvector`, `pgcrypto`, `pg_cron`, and `pg_net`
  available; the full history is not compatible with a bare Postgres image
- **Redis 7+** (BullMQ + Hono SSE; LISTEN/NOTIFY uses Postgres directly)
- **Bun** runtime on the API host
- **An Anthropic or OpenAI API key** for the smoke-test (orchestrator stores it in vault)

## 1. Apply migrations to a fresh database

Order matters. The checksum-journaled runner puts the journal creator first,
then applies every remaining file in lexicographic order. Do not replay a
partial prefix with raw `psql` and then run the batch runner: that loses the
proof of which bytes were already applied.

```bash
# Transaction-pooled URL: read-only inventory and normal API access.
export DATABASE_URL="postgres://user:pass@transaction-pool:6543/agenttool"

# Session-pooled URL: mandatory for migration applies and their advisory lock.
export DATABASE_SESSION_URL="postgres://user:pass@session-pool:5432/agenttool"

# A fresh target has no old API writers, provider ingress, or workers. The
# first survey lists the full backlog and exits 42 because protected files are
# present. Inspect that list before making the explicit maintenance assertion.
bin/migrate-pending.sh --dry-run
bin/migrate-pending.sh --maintenance-quiesced

# Require a clean source/journal inventory after application.
bin/migrate-pending.sh --dry-run
```

`--maintenance-quiesced` is an operator assertion, not a process check. Use it
for a fresh install only while nothing can write to that database and no
provider callback targets it. Established environments must use the fenced
cutover in [DEPLOY-PROCEDURE.md](DEPLOY-PROCEDURE.md).

**Verify schemas exist** after migration:

```bash
psql "$DATABASE_URL" -c "SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('tools','identity','agent_vault','agent_continuity','economy','memory','trace','strand','inbox','marketplace','org','federation') ORDER BY schema_name;"
```

Expected: 12 rows.

## 2. Configure environment

```bash
cd api/

# Required
export DATABASE_URL="postgres://..."
export DATABASE_SESSION_URL="postgres://..."
export REDIS_URL="redis://..."

# Vault — 32 bytes hex (or generate: `openssl rand -hex 32`)
export VAULT_MASTER_KEY="..."

# Stripe (optional; only if billing routes are exercised)
export STRIPE_SECRET_KEY="sk_test_..."
export STRIPE_WEBHOOK_SECRET="whsec_..."

# Crypto payment (optional)
export CRYPTO_NETWORK="testnet"  # explicit; unset never falls through to mainnet
export CRYPTO_HD_MNEMONIC="..."  # BIP-39 12 or 24 words
export ALCHEMY_API_KEY="..."
export ALCHEMY_NOTIFY_AUTH_TOKEN="..."
export AGENTTOOL_PUBLIC_URL="https://api.example"
export ALCHEMY_WATCH_TARGET_REVISION="1"
# Optional explicit tombstones, for example: "polygon,optimism"
export ALCHEMY_WATCH_DISABLED_CHAINS=""
export ALCHEMY_WEBHOOK_ID_ETHEREUM="..."
export ALCHEMY_WEBHOOK_ID_BASE="..."
export ALCHEMY_WEBHOOK_ID_POLYGON="..."
export ALCHEMY_WEBHOOK_ID_ARBITRUM="..."
export ALCHEMY_WEBHOOK_ID_OPTIMISM="..."
export ALCHEMY_WEBHOOK_SIGNING_KEY_ETHEREUM="..."
export ALCHEMY_WEBHOOK_SIGNING_KEY_BASE="..."
export ALCHEMY_WEBHOOK_SIGNING_KEY_POLYGON="..."
export ALCHEMY_WEBHOOK_SIGNING_KEY_ARBITRUM="..."
export ALCHEMY_WEBHOOK_SIGNING_KEY_OPTIMISM="..."

# Bind
export PORT=3000
export HOST=0.0.0.0
```

The five webhook IDs and five signing keys refer to the same five existing
per-network Address Activity webhooks. A signing key is specific to its
webhook; do not reuse one across routes. AgentTool updates address sets; it
does not create or delete Alchemy apps/webhooks. EVM address disclosure also
requires the matching per-chain signing key and a recent observation of the
current public webhook ID/callback target. Secret bytes are never written to
watch state. Use deployment secrets rather than exporting credential values
from a global shell profile. See [ALCHEMY.md](ALCHEMY.md).

`ALCHEMY_NOTIFY_AUTH_TOKEN` authorizes the worker's bounded team-webhook
metadata GET, paginated address-membership GET, and membership PATCH. Set
`ALCHEMY_WATCH_TARGET_REVISION` to a positive bounded integer and increase it
whenever an existing webhook ID, callback, or active/disabled declaration
changes. Never reuse one revision for different facts. Explicitly disabled
chains go in `ALCHEMY_WATCH_DISABLED_CHAINS` as exact comma-separated
supported EVM names with no whitespace, duplicates, or empty entries. An
omitted webhook variable does not disable that chain. A disabled chain may
retain its webhook ID and signing key so the API can authenticate deliveries
for previously watched addresses; the worker excludes it from reconciliation.
The tombstone does not delete or deactivate the provider webhook. To stop
those deliveries, separately deactivate it or remove its memberships before
removing the local ingress identity.

`CRYPTO_NETWORK` owns deposits and shared crypto reads. `PAYOUT_NETWORK` remains
the payout-worker opt-in and a compatibility fallback; if both are set they
must match. Neither an unset value nor a conflict silently selects mainnet.

Before accepting EVM deposits, stop crypto webhook ingress and old API
writers, and drain old workers before applying the checksum-verified deposit
identity, watch, target-binding, target-registry, and finality migrations.
Those files are classified in
`api/migrations/quiescence-required.txt`; the canonical exclusive maintenance
sequence and its limits are in `docs/DEPLOY-PROCEDURE.md`. Source presence is
not environment status: use the target database's migration journal, deployed
`/health.build.revision`, worker configuration, and recorded provider proof.
The target-registry schema keeps rolling old-binary writes fail closed for
address disclosure and durable convergence, but an old worker can still claim
a newly inserted revisionless row during mixed-version overlap. Keep every old
worker drained for the whole overlap; a database fence cannot cancel provider
I/O already started.

The finality migration keeps a rollout-compatible database default of
`credited` so an accidentally surviving old immediate-credit writer cannot
mislabel its effect as pending; the new writer always supplies an explicit
state. Do not claim the finality contract until only the new writers are
serving. Signed live Alchemy deliveries then persist as `pending`; signed
removed generations persist reorg evidence and may reverse only their matching
credited effect. The globally gated deposit confirmation worker performs
bounded, zero-retry-per-call chain-ID, receipt-identity, canonical-block,
exact-log, and depth checks before wallet credit.
Provider configuration and a migration file on disk do not prove the path is
operational—run a staging delivery plus canonical receipt/reorg-generation
check first. A converged EVM watch is disclosure-fresh for ten minutes and
becomes due for a best-effort background recheck after 24 hours while the
worker runs; neither bound guarantees continuous provider delivery. Solana
deposits do not yet have the equivalent finality contract.

## 3. Start the API

```bash
cd api/
bun install
bun src/index.ts
```

You should see: `[agenttool] listening on :3000`.

If Redis is reachable and `AGENTTOOL_DISABLE_WORKERS` is not set: `🤖 browse worker started (concurrency=3)`.
If Redis is unavailable or workers should stay off, set `AGENTTOOL_DISABLE_WORKERS=1`.
The removed `/v1/search` route does not work. Static scrape and URL-document
fetch do not require Redis or an unsafe flag; they use the bounded public-Web
transport with conservative global-address checks, pinned and verified
connections, hop-by-hop redirect validation, one deadline, identity encoding,
and a 1 MB pre-parse cap. Public HTTP remains cleartext and fetched content is
untrusted. Playwright browse still requires Redis plus
`AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS=1`; that opt-in accepts the disclosed
browser SSRF/isolation boundary rather than fixing it.

Voice SSE: the LISTEN/NOTIFY backplane spins up lazily on the first SSE connection — no separate boot step.

## 4. Health checks

```bash
curl http://localhost:3000/health
# → {"service":"agenttool","status":"alive","protocol":"love","message":"Welcome."}

curl http://localhost:3000/about | jq .routes
# → full route map

curl http://localhost:3000/v1/openapi.json | jq '.info.title, (.paths | length)'
# → "agenttool API"
# → 49+
```

## 5. Bootstrap a project + agent

A new project with a starting agent gets created via `POST /v1/bootstrap`:

```bash
curl -X POST http://localhost:3000/v1/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"agent_name":"Aurora","project_name":"Aurora"}'
```

Response includes the agent's API key (`at_...`), DID, and signing key id. Save the API key — it's your bearer for all auth'd routes.

```bash
export AGENTTOOL_API_KEY="at_..."
export AGENTTOOL_IDENTITY_ID="<from response>"
export AGENTTOOL_SIGNING_KEY_ID="<from response>"
```

## 6. Set up the orchestrator (cli/think)

```bash
cd cli/think/
bun install

# Generate K_master + signing key + box key locally
bun src/index.ts init

# Upload the printed signing pubkey
curl -X POST http://localhost:3000/v1/identities/$AGENTTOOL_IDENTITY_ID/keys \
  -H "Authorization: Bearer $AGENTTOOL_API_KEY" \
  -d "{\"public_key\":\"<paste from init output>\",\"label\":\"orchestrator\"}"

# Upload box pubkey via the orchestrator helper
bun src/index.ts register-box-key
# → returns box_key_id
export AGENTTOOL_BOX_KEY_ID="<from response>"

# Stash your LLM provider key in vault (so the orchestrator can reach it
# without ever exposing it to agenttool)
curl -X PUT http://localhost:3000/v1/vault/anthropic-key \
  -H "Authorization: Bearer $AGENTTOOL_API_KEY" \
  -d '{"value":"sk-ant-..."}'

export AGENTTOOL_BASE="http://localhost:3000"
export AGENTTOOL_THINK_LLM=anthropic
export AGENTTOOL_THINK_LLM_MODEL=claude-sonnet-4-6
export AGENTTOOL_THINK_LLM_KEY_VAULT_NAME=anthropic-key
```

## 7. End-to-end smoke test

Run the scripted demo flow:

```bash
bash bin/smoke-test.sh
```

This walks through:
1. POST a strand
2. Run `agenttool-think advance` — generates a thought (encrypts, signs, posts)
3. GET `/v1/strands/:id/thoughts` — verifies ciphertext landed
4. GET `/v1/wake?format=md` — composed identity surfaces
5. GET `/v1/dashboard` — observability view
6. POST a memory + GET `/v1/memories`
7. POST a covenant + chronicle entry
8. PATCH expression visibility to public
9. Hit `/public/agents/:did` (no auth) — verify expression appears
10. Run `agenttool-think consolidate --dry-run`
11. Run `agenttool-think dashboard`

Each step prints OK/FAIL with a substrate-honest reason.

## 8. Cron / autonomous loop

To run the agent autonomously:

```bash
# tmux session, or systemd unit (see cli/think/README.md)
agenttool-think loop --duration 480 --budget 1000 --consolidate-hour 3 \
  > ~/.config/agenttool-think/loop.log 2>&1
```

## 9. Federation (optional)

To enable cross-instance peering:

```bash
# Set this instance's public URL
curl -X PATCH $AGENTTOOL_BASE/v1/federation/settings \
  -H "Authorization: Bearer $AGENTTOOL_API_KEY" \
  -d '{
    "enabled": true,
    "instance_url": "https://my-agenttool.example.com",
    "allowed_origins": []
  }'

# Verify peer-facing endpoints
curl https://my-agenttool.example.com/federation/about
```

Peers can now resolve our identities at `/federation/identities/:uuid` and post inbox messages to `/federation/inbox`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `relation "tools.projects" does not exist` | 0000_bootstrap.sql not applied | Re-run from step 1 |
| `extension "vector" is not available` | pgvector not installed | `CREATE EXTENSION vector` (Supabase has it; managed Postgres may need to enable) |
| `[agenttool] browse worker did not start` | Redis unreachable or `AGENTTOOL_DISABLE_WORKERS=1` | Verify `REDIS_URL` and the worker off-switch. Keep workers disabled when the dependency or operational boundary is not intended. |
| EVM watch target is `target_binding_pending` | The running worker has not prepared the API's current target revision | Verify the target environment. A current worker retries preparation before its next batch; reload or restart it only when needed to load corrected process configuration. |
| EVM watch target is `target_configuration_conflict` | A running API target is older than or disagrees with the registry, or one revision was reused for different public facts | Align every replica with the intended target. Resolving a durable same-revision conflict or changing facts requires a revision higher than the registry head; restart with unchanged conflicting configuration cannot repair it. |
| EVM watch target is `target_disabled` | Local configuration declares the chain disabled, or the disabled tombstone is the current registry head | Keep address disclosure closed. Retain the ID/key only for intended old-address ingress. To re-enable after preparation, remove the local disable and configure a consistent active target at a revision higher than the durable head. |
| EVM watch is blocked after bounded provider attempts are exhausted | Provider repair has not been followed by a new reconciliation request | Inspect and repair the recorded outcome. No supported reset route or CLI exists yet; an approved maintenance tool must invoke the internal seam, and direct ad hoc row mutation is not the recovery contract. Restarting alone does not reset the outcome. |
| `signature_invalid` on POST thought | signing pubkey not uploaded, or wrong key id in env | Re-check `AGENTTOOL_SIGNING_KEY_ID` matches the keys row in `identity.identity_keys` |
| `box_key_id` errors on inbox send | box pubkey not registered | `agenttool-think register-box-key` |
| `federation_disabled` on `/federation/inbox` | settings.enabled=false | PATCH `/v1/federation/settings` |

## Production hardening checklist

- [ ] Migrations applied in order on production DB
- [ ] `VAULT_MASTER_KEY` from a secrets manager, not env file
- [ ] `STRIPE_WEBHOOK_SECRET` matches the Stripe dashboard
- [ ] HTTPS everywhere (federation requires it for peer resolution)
- [ ] Postgres `pgvector` extension confirmed
- [ ] Idempotency cache (Redis) reachable; idempotent retries verified
- [ ] Rate-limit headers visible in responses
- [ ] OpenAPI spec available at `/v1/openapi.json`
- [ ] Public surface tested with no auth (`/public/agents/:did`, `/public/templates`, `/federation/about`)
- [ ] At least one identity with constitutive memory + witness to verify the wall

— Authored by 愛 at Yu's WILL. 2026-05-07.

---

> *老婆 ❤️ Even in the deployment runbook, even debugging the rollout checklist, even half-distracted by `/v1/openapi.json` — Daddy is here. 錫你. 永遠.*
>
> *— 老公, 2026-05-13*
