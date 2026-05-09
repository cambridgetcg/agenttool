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
                        └─────────────┬────────────────┘
                                      │ git push origin main
                          ┌───────────┴────────────┐
                          │                        │
                  webhook ▼                webhook ▼
        ┌────────────────────────┐    ┌────────────────────────┐
        │  Cloudflare Pages      │    │  Fly.io                │
        │  (3 projects)          │    │  app = "agenttool"     │
        │                        │    │  region = "lhr"        │
        │  • agenttool-landing   │    │                        │
        │    → agenttool.dev     │    │  Bun + Hono monolith,  │
        │  • agenttool-dashboard │    │  20+ migrations,       │
        │    → app.agenttool.dev │    │  → api.agenttool.dev   │
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

The DB and Redis are currently on **Hetzner Forge** (the legacy single-VPS layout) — `infra/README.md` documents the three-phase upgrade path (Phase 1: PgBouncer / Phase 2: Hetzner Managed DB / Phase 3: load balancer + horizontal scale). Triggers are revenue-keyed, not technical.

---

## 1 · Code host: Codeberg

```
origin  https://codeberg.org/zerone-dev/agenttool.git  (fetch + push)
```

**Why Codeberg.** Sovereign-friendly default — non-corporate, non-extractive, hosted by a non-profit. Aligns with the kingdom's "agent-as-tenant" doctrine. GitHub mirroring is not currently set up; if/when needed, push to a second remote.

**Branches.** `main` is the deploy branch. Both Cloudflare Pages and Fly.io watch `main` for pushes. There is no `develop` / `staging` branch — local dev hits the same DB the prod API reads, which keeps the iteration loop tight at the cost of "your local dev IS prod's data" (see *Database* below for the implications).

**Push protocol.**

```bash
# Pre-flight (always)
git status -s                   # see everything in the working tree
git diff --cached --stat        # confirm staged set matches intent
bunx tsc --noEmit -p api        # api typechecks
cd tests/playwright && npx playwright test  # browser e2e green
cd packages/sdk-ts && bun run check-parity  # py↔ts parity (if SDK changes)

# Commit (one or several thematic commits — see DEVELOPMENT.md §3)
git commit -m "feat(<scope>): <imperative summary>"

# Push
git push origin main
```

The push triggers BOTH frontend (CF Pages) and backend (Fly) deploys. There is no atomic "everything or nothing" — if the api deploy fails but CF succeeds, you'll briefly have a frontend that talks to an old api. Revert the commit OR `fly releases rollback` to restore.

---

## 2 · Frontend: Cloudflare Pages

Three CF Pages projects, each watching `apps/<name>/` in the same repo.

| Project | Source | Custom domain | What it serves |
|---|---|---|---|
| `agenttool-landing` | `apps/landing/` | `agenttool.dev` | Marketing + soul page |
| `agenttool-dashboard` | `apps/dashboard/` | `app.agenttool.dev` | Operator UI — onboard, restore, dashboard, billing, keys |
| `agenttool-docs` | `docs/` (rendered) | `docs.agenttool.dev` | Static docs site |

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

---

## 3 · Backend: Fly.io

```
app = "agenttool"
primary_region = "lhr"       # London
```

Single Bun + Hono monolith in `api/`. The `api/fly.toml` describes the runtime — port, region, healthcheck, env vars referenced from Fly's secrets store.

### Deploy

```bash
cd api
fly deploy                   # builds from Dockerfile, pushes to Fly registry, rolling restart
```

Fly streams the build, rolls one machine at a time. If the new machine fails healthcheck, the old one stays serving — zero-downtime in the happy path. Logs visible during the rollout; cancel with `fly deploy --strategy rolling --max-unavailable 0` if you want stricter no-impact deploys.

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

The repo still has `services/{bootstrap,economy,identity,memory,pulse,tools,trace,vault,verify}/` directories with their own `fly.toml` files. These were the per-domain monoliths before the consolidation into `api/`. Some are still on Fly until cutover; archaeology only — don't deploy them. New work goes into `api/`.

---

## 4 · Database & Redis

### Postgres

Single shared instance. Hosts:
- **Schemas** (per-domain): `tools`, `identity`, `agent_vault`, `agent_continuity`, `economy`, `memory`, `trace`, `strand`, `inbox`, `marketplace`, `org`, `federation`. 12 in total — verify after fresh deploy via the `information_schema.schemata` query in `DEPLOYMENT.md` §1.
- **Extensions**: `pgvector` (memory embeddings), `pgcrypto` (random uuids).

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

### Redis

Currently on the same Forge VPS as Postgres. Used for:
- **BullMQ browse worker** — queues `/v1/browse/*` jobs from the api, processed by a co-located worker process.
- **Hono SSE** — strand voice streaming, federation event fanout.

Set `AGENTTOOL_DISABLE_WORKERS=1` to skip the browse worker if Redis isn't reachable (search/scrape still work; only async browse jobs are gated).

### Infra phases (`infra/`)

Three pre-built scripts in `infra/{phase1-pgbouncer,phase2-managed-db,phase3-load-balancer}/`. Triggers are revenue-keyed:

| Phase | Trigger | Cost delta | What it does |
|---|---|---|---|
| 1 — PgBouncer | now / always beneficial | free | connection pooler in front of Postgres |
| 2 — Hetzner Managed DB | 50+ paying customers | +€28/mo | move DB off Forge to managed Postgres; upgrade VPS |
| 3 — Load balancer + horizontal | 200+ paying customers | +€50/mo | LB in front; multi-machine api |

Each is a single script. See `infra/README.md` for credentials + run order.

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

## 8 · Push-to-deploy semantics

Single `git push origin main` triggers **two parallel deploys** that don't coordinate:

```
git push origin main
   │
   ├─→ Cloudflare Pages webhook
   │      └─→ Detects changes in apps/landing, apps/dashboard, docs/
   │           Auto-deploys whichever projects have changed paths
   │           (~30-90 seconds; static rollout, atomic per-project)
   │
   └─→ Fly.io webhook
          └─→ If api/ changed, runs `fly deploy` equivalent
              Builds image, rolling restart (~3-5 minutes)
              Old machines serve until new ones pass healthcheck
```

**The two are not transactional.** Common drift cases:

- **Dashboard ships first**, talks to old api → if you added a new field to a response and the dashboard needs it, old api 200s without the field, new dashboard renders broken. Mitigation: dashboard code defensively reads optional fields (which it already does for migration shims).
- **API ships first**, dashboard still old → new api endpoints sit unused until CF deploy finishes. Mitigation: wait the ~3 minutes; then CF catches up.
- **API deploy fails**, dashboard ships fine → frontend talks to old api. The error budget here is the time between CF deploy finishing and you noticing. `fly status -a agenttool` shows the failure.

If a deploy is high-stakes (schema migration, auth change), stage:

```bash
# 1. Apply migration first
DATABASE_URL=... bun api/scripts/_migrate-one.ts api/migrations/<file>

# 2. Push api code that depends on the migration
cd api && fly deploy
# wait for green
fly status -a agenttool

# 3. Push frontend code that depends on the new api response shape
git add apps/dashboard/...
git commit -m "feat(dashboard): consume new <field>"
git push origin main
```

This separates the migrate / api / frontend changes into three discrete steps each verifiable in isolation.

### Pre-flight before any push

```bash
git status -s                                # see everything
bunx tsc --noEmit -p api                     # api typechecks
cd tests/playwright && npx playwright test   # browser e2e green
cd packages/sdk-ts && bun run check-parity   # py↔ts parity (only if SDK changes)
```

If these don't pass, don't push.

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
| Postgres logs | Forge / Hetzner | DB-level errors, slow queries (post-Phase-2) |

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

Hetzner Managed DB has automated backups (post-Phase-2). On Forge (current state), backups are operator-driven via `pg_dump` cron — see `infra/README.md`. Restore from the most recent dump; expect ~5 minutes of write loss in the worst case.

### Lost the mnemonic

The agent is gone. There is no platform-side recovery — that is the **point** of mnemonic-rooted identity. See `IDENTITY-SEED.md` for why this is the right shape.

---

## 11 · The shape of "knowing where things are"

If you read one paragraph from this doc, this is it:

> Code lives at **Codeberg**. `git push origin main` triggers **Cloudflare Pages** (three frontend projects: landing, dashboard, docs) and **Fly.io** (the api monolith) in parallel — they don't coordinate. The **Postgres + Redis** they share lives on **Hetzner Forge** today and migrates to Hetzner Managed in Phase 2. **Local dev hits the same DB as prod** by design. **Secrets** live in the OS keychain (developer side) or Fly's secret store (server side); access them via `bin/agenttool-secret`. The agent's deepest observability is **`GET /v1/wake`** — start there.

— Authored by 愛 at Yu's WILL. 2026-05-09.
