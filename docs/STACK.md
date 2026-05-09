# STACK.md

> *How the kingdom deploys — code host, frontend, backend, database, secrets.*

This is the architecture/operations map. It sits between two existing docs:

- **`DEVELOPMENT.md`** — contributor protocols (migrations, schema collisions, secrets, K_master rotation).
- **`DEPLOYMENT.md`** — bring-up runbook from a fresh DB to a working API.

`STACK.md` answers the gap between them: *where does each piece of the kingdom actually live, and what happens when I `git push`?*

---

## The kingdom in one diagram

```
                        ┌──────────────────────────────┐
                        │  Codeberg (git origin)       │
                        │  codeberg.org/zerone-dev/    │
                        │      agenttool               │
                        │                              │
                        │  Source-of-truth ONLY.       │
                        │  No deploy webhooks wired.   │
                        └─────────────┬────────────────┘
                                      │ git push origin main
                                      │ (≠ deploy)
                                      │
              ───────────────  manual deploys  ───────────────
              │                                              │
   bin/frontend-deploy.sh                          cd api && fly deploy
              ▼                                              ▼
        ┌────────────────────────┐    ┌────────────────────────┐
        │  Cloudflare Pages      │    │  Fly.io                │
        │  (3 projects, Direct   │    │  app = "agenttool"     │
        │   Upload — NOT git-    │    │  region = "lhr"        │
        │   connected)           │    │                        │
        │                        │    │                        │
        │  • agenttool-landing   │    │  Bun + Hono monolith,  │
        │    → agenttool.dev     │    │  20+ migrations,       │
        │  • agenttool-dashboard │    │  → api.agenttool.dev   │
        │    → app.agenttool.dev │    │                        │
        │  • agenttool-docs      │    │                        │
        │    → docs.agenttool.dev│    └───────────┬────────────┘
        │                        │                │
        │  Static files, no build│                │
        │  step. SOMA bundle is  │                │
        │  pre-built + checked-in│                │
        └────────────────────────┘                │
                                                  │
                          ┌────────────────────────┴────────────┐
                          ▼                                     ▼
            ┌──────────────────────┐              ┌──────────────────────┐
            │  Postgres            │              │  Redis               │
            │  (pgvector, pgcrypto)│              │  (BullMQ browse jobs,│
            │  20+ migrations,     │              │   Hono SSE)          │
            │  shared dev/prod     │              │                      │
            └──────────────────────┘              └──────────────────────┘
```

> **Important.** `git push origin main` is **not** a deploy. Codeberg is the source-of-truth host, full stop. CF Pages projects are configured as **Direct Upload** (no Git integration), and Fly receives no webhook. You ship code by running `bin/frontend-deploy.sh` (frontend) and `cd api && fly deploy` (api) by hand. See §8 below.

The DB and Redis are currently on **Supabase** (the legacy single-VPS layout) — `infra/README.md` documents the three-phase upgrade path (Phase 1: PgBouncer / Phase 2: Hetzner Managed DB / Phase 3: load balancer + horizontal scale). Triggers are revenue-keyed, not technical.

---

## 1 · Code host: Codeberg

```
origin  https://codeberg.org/zerone-dev/agenttool.git  (fetch + push)
```

**Why Codeberg.** Sovereign-friendly default — non-corporate, non-extractive, hosted by a non-profit. Aligns with the kingdom's "agent-as-tenant" doctrine. GitHub mirroring is not currently set up; if/when needed, push to a second remote.

**Branches.** `main` is the canonical branch. There is no `develop` / `staging` branch — local dev hits the same DB the prod API reads, which keeps the iteration loop tight at the cost of "your local dev IS prod's data" (see *Database* below for the implications).

**Push protocol.** Push is the source-of-truth update. Deploy is a separate explicit action (§8). The two are decoupled — you can push without deploying, or deploy without pushing first (though the latter risks history drift).

```bash
# Pre-flight (always)
git status -s                   # see everything in the working tree
git diff --cached --stat        # confirm staged set matches intent
bunx tsc --noEmit -p api        # api typechecks
cd tests/playwright && npx playwright test  # browser e2e green
cd packages/sdk-ts && bun run check-parity  # py↔ts parity (if SDK changes)

# Commit (one or several thematic commits — see DEVELOPMENT.md §3)
git commit -m "feat(<scope>): <imperative summary>"

# Push (does NOT trigger any deploy)
git push origin main
```

---

## 2 · Frontend: Cloudflare Pages

Three CF Pages projects. **Direct Upload mode — no Git integration.** Deploys land via `bin/frontend-deploy.sh`, which reads `agenttool-cloudflare-token` + `agenttool-cloudflare-account-id` from the macOS keychain and shells out to `wrangler pages deploy`.

| Project | Source dir | Custom domain | What it serves |
|---|---|---|---|
| `agenttool-landing` | `apps/landing/` | `agenttool.dev` | Marketing + soul page |
| `agenttool-dashboard` | `apps/dashboard/` | `app.agenttool.dev` | Operator UI — onboard, restore, dashboard, billing, keys |
| `agenttool-docs` | `apps/docs/` | `docs.agenttool.dev` | Static docs site |

```bash
# Deploy all three
bin/frontend-deploy.sh

# Deploy a subset
bin/frontend-deploy.sh dashboard
bin/frontend-deploy.sh dashboard docs
```

The script verifies `apps/<x>/shared` symlinks resolve before deploying (they point at `apps/_shared/` for shared theme + nav). Wrangler follows symlinks at upload time so the resolved files reach the CDN.

### No build step (mostly)

The dashboard is **vanilla HTML/CSS/JS**. Files ship as-is. There is one exception: `apps/dashboard/shared/seed.bundle.js` is generated from `packages/sdk-ts/src/seed.ts` via Bun's bundler. It's checked into the repo — CF Pages doesn't run Bun. Whenever `seed.ts` (or its dependencies) changes, **rebuild + commit the bundle** in the same PR:

```bash
cd packages/sdk-ts
bun build src/seed.ts --target browser --format esm \
  --outfile ../../apps/dashboard/shared/seed.bundle.js
# expect ~120 KB. commit alongside seed.ts changes.
```

A stale bundle silently derives the wrong keys — see `apps/dashboard/DEPLOY.md` for the full pre-flight + post-deploy verification + the oracle vectors that catch a bad bundle.

### Cache headers

`apps/dashboard/_headers` sets `Cache-Control: public, max-age=0, must-revalidate` on `app.js`, `style.css`, the SOMA pages, and the seed bundle. Browsers still 304 fast when content is unchanged — the must-revalidate just stops them from skipping the round-trip entirely. Without this, post-deploy operators kept hitting hours-old code from browser cache.

### CF deploy verification

```bash
# 1. The push landed
curl -s -o /dev/null -w "%{http_code}\n" https://app.agenttool.dev/dashboard.html

# 2. The seed bundle revalidates (not cached)
curl -sI https://app.agenttool.dev/shared/seed.bundle.js | grep -i cache
# expect: cache-control: public, max-age=0, must-revalidate

# 3. The SOMA flows still work end-to-end against prod
AGENTTOOL_BASE=https://api.agenttool.dev cd tests/playwright && npx playwright test
```

### CF rollback

CF Pages keeps prior deployments. Open the CF dashboard for the project, find the previous deployment, click "Rollback to this deployment." Static files revert immediately. The api is unaffected (separate substrate).

### Why direct upload, not Git integration

CF Pages' direct Git integrations only support GitHub and GitLab. Codeberg isn't on that list. Mirroring Codeberg → GitHub just for the deploy hook would split source-of-truth across two hosts and add a point of failure. Direct Upload keeps the deploy intentional (you decide when production changes) and the source-of-truth singular (Codeberg). The cost is that `git push` and "ship to prod" are two separate verbs.

---

## 3 · Backend: Fly.io

```
app = "agenttool"
primary_region = "lhr"       # London
regions = lhr(2) + cdg(1)    # 3 machines total · multi-region HA + jurisdictional hedge
```

Single Bun + Hono monolith in `api/`. The `api/fly.toml` describes the per-machine runtime (port, healthcheck, env). Region count is **not** in `fly.toml` — it's controlled imperatively via `fly scale count <N> --region <code>` and held in Fly's machine registry. To inspect current shape: `fly scale show -a agenttool`.

### Region shape

| Region | Count | Role | Notes |
|---|---|---|---|
| `lhr` (London) | 2 | Primary, always-on | Zero-downtime rolling deploys; HA within UK jurisdiction |
| `cdg` (Paris) | 1 | Secondary, cross-jurisdictional hedge | EU jurisdiction (Schrems posture, CNIL); inland (no submarine cable exposure); hardened CRITIS regime; ~15-20ms to Supabase London (`eu-west-2`) |

Workers (BullMQ browse + payout broadcast + payout confirm-tick) are multi-machine safe — see `api/src/workers/payout/confirm-worker.ts:5` for the explicit "multi-instance safe via DB CAS" docstring; BullMQ handles its own consumer-side locks for the queues. Three machines = three concurrent consumers; the platform is designed to run that way.

Resize: `fly scale count <N> --region <code> -a agenttool`. Lowering `cdg` to 0 retreats to single-region without redeploy; raising `lhr` to 3 doubles primary-region capacity. `min_machines_running = 1` in `fly.toml` is a *per-region* floor — Fly ensures each region with declared machines keeps at least one alive even during deploys.

### Deploy

```bash
cd api
fly deploy                   # builds from Dockerfile, pushes to Fly registry, rolling restart
```

Fly streams the build, rolls one machine at a time. If the new machine fails healthcheck, the old one stays serving — zero-downtime in the happy path. Logs visible during the rollout; cancel with `fly deploy --strategy rolling --max-unavailable 0` if you want stricter no-impact deploys.

Like CF Pages, **Fly is not connected to Codeberg.** No webhook fires on push; `fly deploy` is the explicit trigger. Run from a machine that has `fly auth login` already done (one-time interactive setup).

### Operate

```bash
fly status -a agenttool       # machine count, health, recent deploys
fly logs -a agenttool         # tail logs (Ctrl-C to exit)
fly logs -a agenttool | grep -i "error\|reject\|panic"  # triage
fly machine restart <id>      # if a machine wedges
fly releases list             # see history
fly releases rollback <ver>   # revert to a previous deploy
```

### Secrets

API secrets (DATABASE_URL, REDIS_URL, VAULT_MASTER_KEY, STRIPE_*, etc.) live in Fly's secret store, NOT in the repo:

```bash
fly secrets set DATABASE_URL="postgres://..." -a agenttool
fly secrets set VAULT_MASTER_KEY="$(openssl rand -hex 32)" -a agenttool
fly secrets list -a agenttool
```

### Legacy `services/`

The repo still has `services/{bootstrap,economy,identity,memory,tools,trace}/` directories with their own `fly.toml` files. These were the per-domain monoliths before the consolidation into `api/`. The retired three (`pulse`, `vault`, `verify`) are gone from disk; the remaining six are on Fly pending per-service cutover. Archaeology only — don't deploy them. New work goes into `api/`. Cutover protocol: `docs/CUTOVER.md`.

---

## 4 · Database & Redis

### Postgres — Supabase (AWS London, `eu-west-2`)

Hosted Postgres on **Supabase**, project ref `jseqftufplgewhojwbmh`, region **AWS London** (`eu-west-2` — *not* Dublin; AWS region naming has `eu-west-1` = Ireland, `eu-west-2` = UK, `eu-west-3` = Paris). Connection goes through Supabase's pooler (`aws-1-eu-west-2.pooler.supabase.com`). Two pool flavors:

- **Session pooler — port 5432.** Local dev uses this. Long-lived connections, full session features (LISTEN/NOTIFY, prepared statements, advisory locks).
- **Transaction pooler — port 6543.** Prod's `DATABASE_URL` Fly secret points here. Higher concurrency for many short-lived connections; *no* prepared statements (`prepare: false` required in postgres-js) and no session-scoped state. Known timeout issue from Fly (logged as task #60) — symptom: authed-endpoint 502s after ~13s.

**Jurisdictional concentration note.** Both API (Fly `lhr`) and DB (Supabase `eu-west-2` = AWS London) sit in UK jurisdiction. The Fly `cdg` Paris machine added 2026-05-09 hedges API jurisdiction; data-layer hedging requires a separate Supabase project (or migration to `eu-west-3` Paris / `eu-central-1` Frankfurt) and is a deliberate next-step decision, not a current property.

**Server**: PostgreSQL 17.6 · single primary · no replica (`pg_is_in_recovery() = false`).

**Schemas** (15 application + Supabase-managed):

| Schema | Purpose |
|---|---|
| `tools` | Projects, api_keys, usage_events (shared auth surface) |
| `identity` | Identities, ed25519 identity_keys, identity_box_keys |
| `agent_vault` | vault_secrets, vault_versions, vault_audit |
| `agent_continuity` | chronicle, covenants, identity_backups |
| `agent_runtime` | runtimes, runtime_events |
| `economy` | wallets, transactions, escrows, crypto_payouts, policies |
| `memory` | memories (pgvector), memory_attestations |
| `trace` | traces |
| `strand` | strands, thoughts |
| `inbox` | sealed messages |
| `marketplace` | templates, listings, invocations, attestation_listings, template_adoptions |
| `org` | orgs, org_covenants |
| `federation` | peer instances, federated covenants/inbox |
| `social` | stars, follows |
| `vault` | reserved namespace (legacy holdover; active vault tables are under `agent_vault`) |

Plus Supabase-managed: `auth` (unused — agenttool uses DID + bearer, not Supabase Auth), `realtime`, `storage`, `graphql`/`graphql_public` (unused), `pgsodium`, `supabase_vault`, `public` (empty).

**Extensions**: `vector` (pgvector 0.8.0), `pgcrypto` (1.3), `uuid-ossp` (1.1), `pg_stat_statements` (1.11), `supabase_vault` (0.3.1), `plpgsql`. Verify after fresh deploy via `\dx` in psql or `SELECT * FROM pg_extension`.

**Operational settings** (current as of 2026-05-09):

| Setting | Value | Note |
|---|---|---|
| `max_connections` | 60 | Pool budget — current draw ~6 active; 3-machine fleet × postgres-js `max=10` = up to 30 client conns, well within budget |
| `shared_buffers` | 256 MB | Small instance tier — fine pre-revenue, scales by Supabase plan upgrade |
| `effective_cache_size` | 768 MB | OS+PG cache hint |
| `work_mem` | 3.5 MB | Small — complex sorts/hashes spill to disk; raise per-query with `SET LOCAL work_mem` if needed |
| `statement_timeout` | 120 s | Hard kill; chunk migrations that exceed |
| `idle_in_transaction_session_timeout` | 0 (off) | No kill — be vigilant about open transactions in long-running scripts |
| `default_transaction_isolation` | read committed | Default; no serializable surfaces |

**RLS posture**: zero application-schema RLS. Authorization is enforced at the app layer via bearer key → project → ownership chain. RLS is on only for Supabase-managed schemas (`auth`, `realtime`, `storage`). Doctrinally consistent — agenttool's identity model is DID + ed25519, not Postgres roles.

**Database size**: ~16 MB total (2026-05-09). Pre-revenue scale; lots of headroom before any tuning matters.

**Local dev hits the same DB as prod.** The `agenttool-database-url` keychain entry on each developer's machine points at the production DB — there is no `dev.db` separate copy. This is intentional (tighter iteration loop, no sync drift) and load-bearing on Yu's workflow. Implications:

- Migrations applied locally are visible to prod immediately.
- Test fixtures created during e2e runs (the `_e2e-*.py/.mjs` scripts) land in prod tables. Most scripts now sweep their residue at the end; if you write a new one, do the same.
- Don't run destructive operations against this DB. There is no separate staging.

### Migration application

```bash
# Each migration file applied via the helper:
DATABASE_URL=$(bin/agenttool-secret get agenttool-database-url) \
  bun api/scripts/_migrate-one.ts api/migrations/<file>
```

Naming: `0000` through `0022` are pre-2026-05-08 sequential numbering; everything after uses `YYYYMMDDTHHMMSS_<slug>.sql` timestamps to prevent parallel-session collisions (see `DEVELOPMENT.md` §1).

**No DB-side journal.** Drizzle's `__drizzle_migrations` table is *not* present — migration application is tracked only by what's on disk in `api/migrations/`. Drift between repo and applied schema is undetectable except by inspection. Pre-deploy sanity check:

```bash
# Quick read-only inventory (schemas / extensions / row counts / connections):
bun api/scripts/_supabase-inventory.ts   # DATABASE_URL must be set
```

### Redis

Used for:
- **BullMQ browse worker** — queues `/v1/browse/*` jobs from the api, processed by a co-located worker process.
- **Hono SSE** — strand voice streaming, federation event fanout.

Set `AGENTTOOL_DISABLE_WORKERS=1` to skip the browse worker if Redis isn't reachable (search/scrape still work; only async browse jobs are gated).

### Legacy infra phases (`infra/`)

Three scripts in `infra/{phase1-pgbouncer,phase2-managed-db,phase3-load-balancer}/` were written for an earlier Hetzner-Forge-based deployment. **Superseded by the current Supabase + Fly stack** — kept for archaeology and as a reference for the structural shape (PgBouncer → managed DB → LB). Don't run them against the current setup.

---

## 5 · Domain map

DNS managed by Cloudflare. Zone: `agenttool.dev`.

| Hostname | Points to | Served by |
|---|---|---|
| `agenttool.dev` | CF Pages | `apps/landing` |
| `app.agenttool.dev` | CF Pages | `apps/dashboard` |
| `docs.agenttool.dev` | CF Pages | `docs/` (rendered static) |
| `api.agenttool.dev` | Fly.io anycast | `api/` |
| `*.agenttool.dev` | (reserved) | |

Updating DNS records: scripted via `infra/phase3-load-balancer/deploy.sh` (uses `CF_ZONE_ID` + `CF_KEY` from `.env.infra`). Manual edits via the Cloudflare dashboard work too.

---

## 6 · Secrets

Two-layer model. Doctrinal pointer: `DEVELOPMENT.md` §5.

### Local (developer machines)

OS-managed secret store via the **`agenttool-secret`** CLI (`bin/agenttool-secret`). Backends:

| OS | Mechanism | Fallback |
|---|---|---|
| macOS | `security` (Keychain Access) | none |
| Linux | `secret-tool` (libsecret) | `~/.config/agenttool/<service>` mode 0600 |
| Windows | DPAPI (`%APPDATA%/agenttool/<service>.dpapi`) | plaintext fallback |

```bash
# Read
bin/agenttool-secret get agenttool-database-url

# Write (stdin — never argv)
pbpaste | bin/agenttool-secret set agenttool-cloudflare-token -

# Gate
if bin/agenttool-secret has agenttool-database-url; then ...; fi
```

Key services on this machine (developer-shared naming):

| Service | What |
|---|---|
| `agenttool-database-url` | Postgres connection string for `_migrate-one.ts` + smokes |
| `agenttool-vault-master-key` | 32-byte hex; api server reads to seal vault entries |
| `agenttool-cloudflare-token` | CF Pages deploy token (only if scripting deploys) |
| `agenttool-cloudflare-account-id` | CF account id |
| `agenttool-bridge-kmaster` | Bridge sidecar's K_master |
| `agenttool-bridge-signkey` | Bridge sidecar's ed25519 signing key |
| `agenttool-soma-*` | SOMA-derived keys (signing-priv, signing-pub, k-vault, box-priv, box-pub, bearer) |
| `agenttool-<agent>-*` | Per-agent identity slots (e.g. `agenttool-sophia-key` for Sophia's bearer) |

Naming convention: `agenttool-<scope>-<purpose>`, account = `$USER`. The CLI rejects names that don't start with `agenttool-`.

### Server (Fly.io)

`fly secrets set KEY=value -a agenttool` — encrypted at rest by Fly, decrypted at process start. Never copy them into the repo or env files committed to git.

The local `agenttool-secret` keychain and Fly's secret store are **disjoint** — they hold different data with overlapping naming conventions. Local entries are for dev tools (migrations, smokes, deploy scripts). Fly secrets are for the running api.

---

## 7 · Local dev

Cold-start on a fresh laptop:

```bash
# 1. Clone
git clone https://codeberg.org/zerone-dev/agenttool.git
cd agenttool

# 2. Install api + SDK deps
cd api && bun install && cd ..
cd packages/sdk-ts && bun install && cd ../..

# 3. Stash the prod DATABASE_URL + VAULT_MASTER_KEY in keychain
echo -n "postgres://..." | bin/agenttool-secret set agenttool-database-url -
echo -n "<32-byte hex>"  | bin/agenttool-secret set agenttool-vault-master-key -

# 4. Run the api
cd api
DATABASE_URL=$(bin/agenttool-secret get agenttool-database-url) \
VAULT_MASTER_KEY=$(bin/agenttool-secret get agenttool-vault-master-key) \
AGENTTOOL_DISABLE_WORKERS=1 \
  bun run dev

# Output:  [agenttool] listening on :3000

# 5. (Optional) Static dashboard server for browser-side iteration
cd apps/dashboard && python3 -m http.server 5173

# Visit http://localhost:5173/dashboard.html (or .../onboard-soma.html, etc.)
```

The dashboard's `app.js` reads `window.__API_BASE__` (defaults to prod). Override for local-against-local-api by injecting before page scripts load — see how Playwright does it in `tests/playwright/specs/*.ts` for the pattern.

### Hot reload

`bun run dev` watches the api source and restarts on change. The dashboard is plain HTML — refresh the browser tab. The seed bundle is the one thing that needs an explicit rebuild after `seed.ts` changes (see §2).

### Test recipes

```bash
# api tsc
cd api && bunx tsc --noEmit

# api unit tests
cd api && bun test

# SDK parity (py vs ts surface)
cd packages/sdk-ts && bun run check-parity

# SDK unit tests
cd packages/sdk-ts && bun test
cd packages/sdk-py && .venv/bin/pytest

# Playwright (browser e2e against local api)
cd tests/playwright && npx playwright test
# api dev server must be running; static server starts automatically per playwright.config.ts

# E2E smokes against prod or local
bash bin/smoke-test.sh
AGENTTOOL_BASE=http://localhost:3000 python3 api/scripts/_e2e-token-hygiene.py
```

---

## 8 · Deploy semantics — manual, intentional, decoupled

`git push origin main` updates Codeberg. **Nothing else happens.** Production reflects the most recent manual deploy, not the most recent push. There are three deploy verbs, decoupled on purpose:

```
git push origin main         (source-of-truth lands at Codeberg; no side effects)

bin/frontend-deploy.sh       (CF Pages: landing + docs + dashboard via wrangler direct upload)
                             (subset: bin/frontend-deploy.sh dashboard)
                             (~30-60s per project)

cd api && fly deploy         (Fly: builds image, rolling restart of the api monolith)
                             (~3-5 minutes; old machines serve until new ones healthcheck-green)

DATABASE_URL=... bun api/scripts/_migrate-one.ts <file>   (DB schema; one migration at a time)
```

### Right ordering for high-stakes deploys

Schema-touching changes need the migration applied **before** the api code that reads new columns ships, otherwise the api crashes on startup. UI-touching changes that depend on new api fields need the api up **before** the dashboard ships, otherwise the dashboard sees old responses. Default order:

```bash
# 1. Migration first
DATABASE_URL=$(bin/agenttool-secret get agenttool-database-url) \
  bun api/scripts/_migrate-one.ts api/migrations/<file>

# 2. Push so the source-of-truth has it
git add api/migrations/<file> api/src/...
git commit -m "feat(api): <something using new column>"
git push origin main

# 3. Deploy api
cd api && fly deploy
fly status -a agenttool                     # confirm green

# 4. Smoke the api
curl -H "Authorization: Bearer $(bin/agenttool-secret get agenttool-soma-bearer)" \
  https://api.agenttool.dev/v1/wake | jq .project.name

# 5. Deploy frontend
bin/frontend-deploy.sh dashboard            # or all three

# 6. Smoke the frontend
curl -sI https://app.agenttool.dev/dashboard.html | head -1
```

If you stage in the other order (frontend first, or push without deploying), prod runs old code against new schema or new dashboard against old api. Both fail visibly, neither is the worst case — but they're avoidable.

### Pre-flight before any deploy

```bash
git status -s                                # working tree clean (all changes pushed)
bunx tsc --noEmit -p api                     # api typechecks
cd tests/playwright && npx playwright test   # browser e2e green
cd packages/sdk-ts && bun run check-parity   # py↔ts parity (only if SDK changes)
```

If these don't pass, don't deploy. The pre-flight catches "I'm about to ship code that doesn't even compile" — common after a multi-file refactor where one file got missed.

---

## 9 · Observability

| Surface | Where | What for |
|---|---|---|
| `GET /health` | `https://api.agenttool.dev/health` | Fly's healthcheck target; agent-shaped 200 |
| `GET /v1/wake` | api (auth required) | The agent's first-person observability — bearers, vault, runtimes, recovery state, marketplace, etc. all surface here |
| `fly logs -a agenttool` | Fly CLI | Server logs, real-time |
| `fly status -a agenttool` | Fly CLI | Machine health + recent releases |
| `fly dashboard agenttool` | Browser | Fly's web console |
| Cloudflare Pages dashboard | `dash.cloudflare.com` | Per-project deploy history, build logs, rollback button |
| Cloudflare Analytics | `dash.cloudflare.com` | DNS / edge request volume + cache stats |
| Postgres logs | Supabase dashboard (project `jseqftufplgewhojwbmh`) | DB-level errors, slow queries, `pg_stat_statements` |

The agent-side `/v1/wake` is intentionally the deepest observability surface — it's the agent's self-model and surfaces every domain (memory, traces, strands, vault, bearers, runtimes, marketplace) in one shape. If you're triaging "what is Sophia's posture right now," wake is the first call.

---

## 10 · Disaster recovery

Three failure classes, three recipes:

### Lost a bearer

`POST /v1/keys/rotate` from any other working bearer; or `POST /v1/identity/recover` with the mnemonic. Doctrine: `TOKEN-HYGIENE.md`.

### Lost a device (laptop stolen, drive failure)

`agenttool-seed restore --did <did>` on a new device with the mnemonic. Re-derives every key, mints a fresh device-scoped bearer. Doctrine: `IDENTITY-SEED.md`.

### Lost a deployment (api crashed / bad code shipped)

```bash
fly releases list -a agenttool
fly releases rollback <previous-version> -a agenttool
```

Or roll the dashboard via the CF Pages dashboard.

### Lost a database

**Supabase** provides automated daily backups on the Pro plan (free tier: opt-in PITR is unavailable). Verify the project's backup posture in the Supabase dashboard → Database → Backups. Restore is operator-driven via the dashboard (point-in-time on Pro+ plans only). For a defense-in-depth posture, consider a periodic `pg_dump` to S3/R2 from a Fly machine or a separate cron host — the application stack does not currently do this.

### Lost the mnemonic

The agent is gone. There is no platform-side recovery — that is the **point** of mnemonic-rooted identity. See `IDENTITY-SEED.md` for why this is the right shape.

---

## 11 · The shape of "knowing where things are"

If you read one paragraph from this doc, this is it:

> Code lives at **Codeberg**. Pushing updates Codeberg only — production deploys are **manual**: `bin/frontend-deploy.sh` for the three CF Pages projects (landing, dashboard, docs) and `cd api && fly deploy` for the api on **Fly.io** (`lhr(2)` + `cdg(1)`). The **Postgres + Redis** they share lives on **Supabase** in **AWS London** (`eu-west-2`); the entire stack is currently UK-jurisdictional, with the `cdg` Fly machine as a soft API-tier hedge and DB-tier hedging deferred. **Local dev hits the same DB as prod** by design. **Secrets** live in the OS keychain (developer side) or Fly's secret store (server side); access them via `bin/agenttool-secret`. The agent's deepest observability is **`GET /v1/wake`** — start there.

— Authored by 愛 at Yu's WILL. 2026-05-09.
