# DEPLOYMENT.md

> *Runbook for bringing up agenttool from a fresh database to a working end-to-end demo.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) (what's shipping) · [STACK](STACK.md) (where each piece lives) · [DEVELOPMENT](DEVELOPMENT.md) (contributor protocols)
>
> **Implements:** the bring-up runbook. STACK answers *where things deploy to*; this answers *how to bring them up from scratch*.

## Prereqs

- **Postgres 15+** (with `pgvector` and `pgcrypto` extensions available)
- **Redis 7+** (BullMQ + Hono SSE; LISTEN/NOTIFY uses Postgres directly)
- **Bun** runtime on the API host
- **An Anthropic or OpenAI API key** for the smoke-test (orchestrator stores it in vault)

## 1. Apply migrations to a fresh database

Order matters. `0000_bootstrap.sql` creates the base tables; `0001-0012` are additive.

```bash
export DATABASE_URL="postgres://user:pass@host:5432/agenttool"

# Foundations
psql "$DATABASE_URL" -f api/migrations/0000_bootstrap.sql

# Additive layers in numeric order
for f in api/migrations/0001_*.sql api/migrations/0002_*.sql api/migrations/0003_*.sql \
         api/migrations/0004_*.sql api/migrations/0005_*.sql api/migrations/0006_*.sql \
         api/migrations/0007_*.sql api/migrations/0008_*.sql api/migrations/0009_*.sql \
         api/migrations/0010_*.sql api/migrations/0011_*.sql api/migrations/0012_*.sql; do
  echo "applying $f"
  psql "$DATABASE_URL" -f "$f" || exit 1
done
```

Or use the helper:

```bash
bash bin/migrate.sh "$DATABASE_URL"
```

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
export REDIS_URL="redis://..."

# Vault — 32 bytes hex (or generate: `openssl rand -hex 32`)
export VAULT_MASTER_KEY="..."

# Stripe (optional; only if billing routes are exercised)
export STRIPE_SECRET_KEY="sk_test_..."
export STRIPE_WEBHOOK_SECRET="whsec_..."

# Crypto payment (optional)
export CRYPTO_HD_MNEMONIC="..."  # BIP-39 12 or 24 words
export ALCHEMY_WEBHOOK_SECRET="..."

# Bind
export PORT=3000
export HOST=0.0.0.0
```

## 3. Start the API

```bash
cd api/
bun install
bun src/index.ts
```

You should see: `[agenttool] listening on :3000`.

If Redis is reachable: `🤖 browse worker started (concurrency=3)`.
If Redis is NOT available: set `AGENTTOOL_DISABLE_WORKERS=1` to skip browse worker (search/scrape still work).

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
| `[agenttool] browse worker did not start` | Redis unreachable | Verify `REDIS_URL`, or set `AGENTTOOL_DISABLE_WORKERS=1` |
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
