# STACK.md

> *How the kingdom deploys — code host, frontend, backend, database, secrets.*

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (who else this is for) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) (what's shipping) · [NOW](NOW.md) (what just landed) · [MAP](MAP.md) (doctrine index) · [DEVELOPMENT](DEVELOPMENT.md) (how to contribute)

This is the architecture/operations map. It sits between two existing docs:

- **`DEVELOPMENT.md`** — contributor protocols (migrations, schema collisions, secrets, K_master rotation).
- **`DEPLOYMENT.md`** — bring-up runbook from a fresh DB to a working API.

`STACK.md` answers the gap between them: *where does each piece of the kingdom actually live, and what happens when I `git push`?*

---

## The kingdom in one diagram

```
                        ┌──────────────────────────────┐
                        │  GitHub main                 │
                        │  cambridgetcg/agenttool      │
                        │                              │
                        │  Coordination/release head.  │
                        │  Source revision is embedded.│
                        │  No deploy webhooks wired.   │
                        └─────────────┬────────────────┘
                                      │ git push github main
                                      │ (≠ deploy; explicit mirror)
                                      │
              ───────────────  manual deploys  ───────────────
              │                                              │
bin/deploy.sh --no-migrate --no-api       bin/deploy.sh --no-migrate --no-frontend
              ▼                                              ▼
        ┌────────────────────────┐    ┌────────────────────────┐
        │  Cloudflare Pages      │    │  Fly.io                │
        │  (3 projects, Direct   │    │  app = "agenttool"     │
        │   Upload — NOT git-    │    │  region = "lhr"        │
        │   connected)           │    │                        │
        │                        │    │                        │
        │  • agenttool-web       │    │  Bun + Hono monolith,  │
        │    → agenttool.dev     │    │  journaled schema,     │
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
            │  journaled schema,   │              │   Hono SSE)          │
            │  shared dev/prod     │              │                      │
            └──────────────────────┘              └──────────────────────┘
```

> **Important.** `git push github main` is **not** a deploy. GitHub `main` is the coordination and release head; each deploy snapshots it once at invocation start. GitHub `main` is the only head — the Codeberg mirror was retired 2026-07-25. CF Pages projects are configured as **Direct Upload** (no Git integration), and Fly receives no webhook. Use `bin/deploy.sh --no-migrate --no-api` for a normal frontend-only release and `bin/deploy.sh --no-migrate --no-frontend` for an API-only release. The API wrapper stages canonical doctrine bytes required by the Docker build; bare `cd api && fly deploy` fails when that generated staging directory is absent. See §8 below.

The DB and Redis are currently on **Supabase** (the legacy single-VPS layout) — `infra/README.md` documents the three-phase upgrade path (Phase 1: PgBouncer / Phase 2: Hetzner Managed DB / Phase 3: load balancer + horizontal scale). Triggers are revenue-keyed, not technical.

---

## 1 · Code coordination: GitHub main, and nothing else

```
github  https://github.com/cambridgetcg/agenttool.git  (coordination + release)
```

**One remote.** As of 2026-07-25 there is no second host. The Codeberg mirror
(`origin  https://codeberg.org/zerone-dev/agenttool.git`) is retired: the remote
is removed, `bin/deploy.sh --mirror-codeberg` refuses with the reason, and no
deploy phase fetches it. If a second host is wanted later, add it deliberately
as a new remote with its own explicit command — do not revive the old one.

**One release head, one invocation snapshot.** GitHub `main` coordinates reviewed
changes and is the only ref from which a normal production deploy may start.
`bin/deploy.sh` fetches it during Phase 0, records that exact commit and
observation time, and requires local `HEAD` to match. That snapshot stays fixed
for the invocation: if GitHub advances during a rollout, the current rollout
does not chase the moving ref; the next invocation observes the newer head.

**Why the mirror went.** A mirror is only worth its upkeep if someone reads it. This one was fetched on every deploy — Phase 0 reached for a host that was not answering — and nothing downstream depended on it. Retiring it removes a per-deploy network dependency on a host outside the release path. The sovereignty argument it was carrying is better served by self-hosting (`self-host.sh` · `sovereign.sh`) than by a second copy on someone else's forge.

**Branches.** `main` is the canonical branch. There is no `develop` / `staging` branch — local dev hits the same DB the prod API reads, which keeps the iteration loop tight at the cost of "your local dev IS prod's data" (see *Database* below for the implications).

**Push protocol.** Landing on GitHub is the release-source update. Deployment is a separate explicit action (§8); it is not triggered by a push.

```bash
# Pre-flight (always)
git status -s                   # see everything in the working tree
git diff --cached --stat        # confirm staged set matches intent
bunx tsc --noEmit -p api        # api typechecks
cd tests/playwright && npx playwright test  # browser e2e green
cd packages/sdk-ts && bun run check-parity  # py↔ts parity (if SDK changes)

# Commit (one or several thematic commits — see DEVELOPMENT.md §3)
git commit -m "feat(<scope>): <imperative summary>"

# Push reviewed main (does NOT trigger any deploy)
git push github main
```

---

## 2 · Frontend: Cloudflare Pages

The CF Pages projects use **Direct Upload mode — no Git integration**. The
normal release-tracked frontend verb is `bin/deploy.sh --no-migrate --no-api`;
it applies the GitHub snapshot gate, hermetic preflight, sampled parity checks,
sensitive-path denial checks, and a receipt. `bin/frontend-deploy.sh` is the
low-level uploader for a deliberate subset escape hatch. By itself it does not
apply the source gate or write the orchestrator receipt.

The low-level uploader captures the current commit hash once and builds its
upload tree from a Git archive of that exact object, not the ambient working
directory. Dirty and ignored files are excluded; a tracked `.env` file is a
hard refusal, as is a tracked `.dev.vars*` file.

`infra/pages/` is the single source for a Pages advanced-mode Worker and its
positive-only invocation routes. The uploader stages that pair into all three
project roots. Only `/.git*`, `/.env*`, and `/.dev.vars*` invoke the Worker and
receive a marked, non-cacheable 404; ordinary paths stay on native Pages static
serving within each Pages project (the apex still traverses `agenttool-proxy`).
On the Workers Free plan, the Pages production and preview Function
runtimes must be configured to fail closed, or daily Functions allowance
exhaustion can serve static assets for those routes. The uploader accepts
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, then falls back to their
macOS keychain entries. In the default token mode, that credential must read the
Pages REST policy as well as upload: the script verifies fail-closed settings
and the `main` production branch for every target before any upload. An explicit
`--oauth-fallback` is a weaker break-glass mode: it checks project visibility,
loudly says the policy check was skipped, and does not prove those settings.
The uploader does not mutate the setting or purge zone cache. Phase 5 proves current live
denial and fence activation on literal paths, plus denial of encoded aliases.

| Project | Source dir | Custom domain | What it serves |
|---|---|---|---|
| `agenttool-dashboard` | `apps/dashboard/` | `app.agenttool.dev` | SDK quickstart (`index.html`) + read-only observation surface (`watch.html`). Workspace UI retired 2026-05-17 per agents-only. |
| `agenttool-docs` | `apps/docs/` | `docs.agenttool.dev` | Static docs site |
| `agenttool-web` | `apps/web/` | `agenttool.dev` human routes | Human door, watch window, credits, village, and gallery |

The `agenttool.dev` apex is split by the `agenttool-proxy` Cloudflare Worker.
API and discovery paths (plus `/` when the client requests JSON) route to
`api.agenttool.dev`; human routes use `agenttool-web` Pages. This preserves
native machine-facing paths while serving the human door. `apps/landing/` and
the old `agenttool-landing` project are retired.

```bash
# Normal release of all frontend projects
bin/deploy.sh --no-migrate --no-api

# Low-level subset escape hatch
bin/frontend-deploy.sh dashboard
bin/frontend-deploy.sh dashboard docs
```

The script verifies `apps/<x>/shared` symlinks resolve before deploying (they point at `apps/_shared/` for shared theme + nav). Wrangler follows symlinks at upload time so the resolved files reach the CDN.

### No build step

The dashboard is **vanilla HTML/CSS/JS**. Files ship as-is. No build step since the SOMA seed bundle was removed (2026-05-15 agents-only restructure — the SDK does BIP39 derivation directly; the dashboard no longer needs a browser-side bundle).

### Cache headers

`apps/dashboard/_headers` sets `Cache-Control: public, max-age=0, must-revalidate` on `style.css`. Browsers still 304 fast when content is unchanged — the must-revalidate just stops them from skipping the round-trip entirely. Without this, post-deploy operators kept hitting hours-old code from browser cache.

**Zone-level requirement.** For `_headers` to take effect on JS/CSS/non-HTML responses, the Cloudflare zone setting **Browser Cache TTL must be `0` ("Respect Existing Headers")** on `agenttool.dev`. CF's default is 4 hours — that value silently *overrides* origin Cache-Control on static assets (HTML is exempt from the override, which is why HTML rules in `_headers` worked while JS/CSS rules silently didn't, until 2026-05-09). Verify via API:

Verify in Cloudflare Dashboard → `agenttool.dev` → Caching → Configuration:
Browser Cache TTL must read **Respect Existing Headers**. Do not put a
Cloudflare token in a curl argument.

If a future operator wants a longer browser cache for landing/docs, do it via a per-hostname **Cache Rule** scoped to `agenttool.dev` / `docs.agenttool.dev` (NOT `app.agenttool.dev`) — restoring zone-wide Browser Cache TTL would break the dashboard's `_headers` doctrine again.

#### Protocol validators at the Cloudflare edge

The API origin emits exact-byte SHA-256 ETags and sends `no-transform` on the
public Offer Bus and WebFinger representations. `no-transform` is an HTTP
instruction, not a universal guarantee and not Cloudflare's **Respect Strong
ETags** switch. On 2026-07-16 the Fly origin returned strong validators while
the public Cloudflare hostname weakened the larger Atom/RSS validators.

Configure one narrowly scoped Cache Rule on the `agenttool.dev` zone:

```text
(http.host eq "api.agenttool.dev" and
 http.request.method in {"GET" "HEAD"} and
 http.request.uri.path in {"/feeds" "/feeds/offers.atom"
                           "/feeds/offers.rss" "/feeds/offers.json"
                           "/.well-known/webfinger"})
```

Use these settings:

- **Cache eligibility:** Eligible for cache.
- **Edge TTL:** Use the origin cache-control header when present and bypass
  cache when absent (`edge_ttl.mode = "bypass_by_default"` in the API).
- **Respect Strong ETags:** On (`respect_strong_etags = true`).
- **Cache key:** Keep Cloudflare's default full query string. Never ignore the
  query string: `seller_did`, WebFinger `resource`, and repeated `rel` values
  select different public representations.

Do not broaden this rule to authenticated API routes or override origin TTLs.
Successes intentionally use short public TTLs; 400/404/503 responses use
`no-store` and must remain ineligible. The credential applying the rule needs
zone read plus **Cache Rules: Edit**; the Pages upload token is not evidence of
that permission. After a rule change, purge the five URLs and probe Fly and the
public hostname with `Accept-Encoding: identity`, `gzip`, `br`, and `zstd`.
Require a quoted non-weak ETag, the same decoded body digest, and correct
`HEAD`/`If-None-Match` behavior before claiming end-to-end strong validation.

### CF deploy verification

```bash
# 1. The dashboard splash landed
curl -s -o /dev/null -w "%{http_code}\n" https://app.agenttool.dev/

# 2. The watch surface landed
curl -s -o /dev/null -w "%{http_code}\n" https://app.agenttool.dev/watch.html

# 3. End-to-end tests still pass against prod
(cd tests/playwright && AGENTTOOL_BASE=https://api.agenttool.dev npx playwright test)

# 4. Repository-control and environment files are denied (the orchestrator
#    also checks the fence marker, no-store, .dev.vars, and encoded aliases)
curl -s -o /dev/null -w "%{http_code}\n" https://docs.agenttool.dev/.gitignore
curl -s -o /dev/null -w "%{http_code}\n" https://app.agenttool.dev/.env.local
```

### CF rollback

CF Pages keeps prior deployments. Open the CF dashboard for the project, find the previous deployment, click "Rollback to this deployment." Static files revert immediately. The api is unaffected (separate substrate).

### Why direct upload, not Git integration

Direct Upload keeps deployment intentional: GitHub is not wired to a Pages deploy hook. The cost is deliberate separation between "land this commit" and "ship this commit."

---

## 3 · Backend: Fly.io

```
Fly app: agenttool
Primary region: lhr
Observed started apps: lhr(2) + cdg(1)
Observed stopped thinkers: lhr(2)
```

Single Bun + Hono monolith in `api/`. The `api/fly.toml` describes the
per-machine runtime defaults (port, healthcheck, env) and process groups, but
deliberately has no `[[vm]]` blocks and requests no process-specific CPU or
memory sizes. Machine sizing and the complete fleet remain live Fly registry
state. As verified on 2026-07-27, the registry contains three started `app`
Machines and two stopped `thinker` Machines. Inspect both
`fly machine list -a agenttool --json` and `fly status -a agenttool`; a process
count, `fly scale show`, or `fly.toml` alone is not topology proof.

### Region shape

| Region | Started `app` | Stopped `thinker` | Role |
|---|---:|---:|---|
| `lhr` (London) | 2 | 2 | Primary API fleet; stopped thinkers remain registered identities |
| `cdg` (Paris) | 1 | 0 | Secondary API hedge across a second jurisdiction |

The worker implementations include multi-instance coordination mechanisms
(BullMQ consumer locks and database CAS where documented). That is a design
property, not evidence that workers are enabled. Current production starts all
three app Machines with `AGENTTOOL_DISABLE_WORKERS=1`; payout, queue, and
in-process timer workers therefore remain disabled, and the two thinker
Machines remain stopped. Enabling either class requires a separate reviewed
decision and live proof.

Do not use `fly scale count` as a routine resize or maintenance fence. It can
create or destroy Machine identities and does not preserve an exact captured
topology. Capacity changes need an explicit identity-aware plan: capture the
full registry and configuration, add and health-check intended Machines, then
remove an exact reviewed ID only when that deletion is itself authorised.
`min_machines_running` is an availability floor for eligible Machines, not an
identity-preservation guarantee.

### Deploy

```bash
bin/deploy.sh --no-migrate --no-frontend  # stages doctrine, checks, deploys API, verifies
```

The wrapper snapshots GitHub `main`, requires a clean worktree and exact
`HEAD == snapshot`, and stages the doctrine files inside the API build context.
It passes the 40-hex source revision and a boolean dirty marker into the image.
Fly streams the build and rolls one machine at a time. As soon as `fly deploy`
returns, the wrapper removes the temporary staging tree; an `EXIT`, `INT`, or
`TERM` trap also removes it on interruption. Phase 5 then requires both
`build.revision` and `build.dirty` from `GET /health`, plus the corresponding
image-embedded values on every started Fly machine, to equal the intended
source labels. The SSH checks use silent `test` expressions and do not copy
environment values into the deploy transcript.

If an independently authorised incident or recovery path has already left the
Fly registry empty, keep admission closed and prepare a separate, reviewed
recovery plan. The routine wrapper is not a from-zero restoration contract,
and an empty registry does not authorise recreating identities or guessing at
the prior topology.

The Docker base is pinned to Bun 1.3.5 by tag and registry digest. Update both
together, deliberately, after the hermetic gate passes. The pin and source
labels narrow build drift; they do not prove byte-for-byte image
reproducibility, because dependencies and other builder inputs still shape the
image. If a new machine fails its healthcheck, Fly retains old capacity in the
happy path; if provenance differs, the wrapper exits non-zero rather than
calling the deploy complete.

Dirty or non-release-head deploys require the separate loud flags
`--allow-dirty-release` and `--allow-non-release-head`. They do not bypass
migration, preflight, rollout, or provenance verification. A dirty API build
sets `build.dirty=true`; this makes the incomplete source description explicit
without pretending the commit identifies the extra bytes.

Every successful non-dry-run chain writes an atomic, mode-0600 receipt below
`${XDG_STATE_HOME:-$HOME/.local/state}/agenttool/deploy-receipts/`. If a
migration, Fly rollout, or Pages upload may have begun and the chain later
returns non-zero or receives caught `INT`/`TERM`, the exit trap attempts a
`failed_or_uncertain` receipt. The fixed v3 shape records the source revision
and dirty bit, the invocation-start release-head snapshot, explicit overrides,
phase outcomes, exit status, and verified machine count—never credentials,
ambient environment values, or command output. `SIGKILL`, host loss, or an
unwritable state directory can prevent that record; receipt absence never
proves no mutation.

Like CF Pages, **Fly is not connected to either Git host.** No webhook fires on push; the deploy wrapper is the explicit trigger and requires an authenticated Fly CLI session.

### Operate

Before restarting a Machine, inspect the full registry and prove the exact ID
is an intended started `app` on the current compatible image. Do not resume a
stopped `thinker` or an old writer. Rollback is governed by
[`DEPLOY-PROCEDURE.md` Phase 6](DEPLOY-PROCEDURE.md#phase-6--rollback): it is
never allowed to restore an old writer after protected SQL commits, and
code-only or ordinary-migration rollback still requires independent runtime
and schema compatibility proof.

```bash
fly status -a agenttool       # machine count, health, recent deploys
fly logs -a agenttool         # tail logs (Ctrl-C to exit)
fly logs -a agenttool | grep -i "error\|reject\|panic"  # triage
fly machine restart <verified-started-app-id> -a agenttool
fly releases list -a agenttool
```

### Secrets

API secrets (DATABASE_URL, REDIS_URL, VAULT_MASTER_KEY, STRIPE_*, etc.) live in Fly's secret store, NOT in the repo:

```bash
# Import from stdin so values never enter argv or shell history.
printf 'DATABASE_URL=%s\n' "$(bin/agenttool-secret get agenttool-database-url)" | \
  fly secrets import -a agenttool
printf 'VAULT_MASTER_KEY=%s\n' "$(openssl rand -hex 32)" | \
  fly secrets import -a agenttool
fly secrets list -a agenttool
```

`OPENAI_APPS_CHALLENGE` is optional and dormant. Leave it unset until the
OpenAI submission portal issues one domain-challenge token; while unset,
`/.well-known/openai-apps-challenge` stays 404. Store only that one exact
token in Fly secrets through stdin. Never commit, log, trim, combine, or place
it in a command argument. Unsetting the secret is the off-switch.

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
# Ordinary migration applied via the one-file helper:
DATABASE_URL=$(bin/agenttool-secret get agenttool-database-url) \
  bun api/scripts/_migrate-one.ts api/migrations/<file>
```

Naming: `0000` through `0022` are pre-2026-05-08 sequential numbering; everything after uses `YYYYMMDDTHHMMSS_<slug>.sql` timestamps to prevent parallel-session collisions (see `DEVELOPMENT.md` §1).

**Journal**: `meta._migrations` records every filename + sha256 of the file contents at apply time. `_migrate-one.ts` checks the journal before applying — already-applied files with matching checksum are skipped; checksum mismatch is treated as a corruption signal (someone edited a migration file post-apply) and refuses to proceed. Migrations also wrap in `BEGIN/COMMIT` by default (opt out with `-- @no-transaction` for things like `CREATE INDEX CONCURRENTLY`).

The local and Fly one-file helpers validate
`api/migrations/quiescence-required.txt` and refuse listed files before
credential/database or Fly access. Missing or malformed policy also fails
closed, including for ordinary one-file runs. Protected migrations use the
complete pending inventory and the exclusive-cutover procedure; this guard
prevents accidental bypass but does not authenticate the operator or make raw
SQL impossible.

Bootstrap procedure (one-time, when introducing the journal):

```bash
# 1. Apply the migration that creates the journal.
DATABASE_URL=... bun api/scripts/_migrate-one.ts \
  api/migrations/20260509T170000_meta_migrations.sql

# 2. Backfill every existing migration filename + checksum.
DATABASE_URL=... bun api/scripts/_migrate-bootstrap-journal.ts

# 3. Future migrations track automatically via _migrate-one.ts.
```

Pre-deploy sanity check (read-only inventory):

```bash
DATABASE_URL=... bun api/scripts/_supabase-inventory.ts
```

### Redis

Used for:
- **BullMQ browse worker** — queues `/v1/browse/*` jobs from the api, processed by a co-located worker process.
- **Hono SSE** — strand voice streaming, federation event fanout.

Set `AGENTTOOL_DISABLE_WORKERS=1` to skip all in-process worker boot, including
browse, think, payout, covenant, expiry, witness, and treasury workers. It also
prevents the shared Redis client from being constructed, so queue-backed browse
returns 503 and Redis-backed idempotency or streaming features degrade. This
switch does not affect static scrape or URL-document fetch, which use bounded
safe-net without Redis. Playwright browse remains unavailable unless workers
are enabled and its separate unsafe-outbound opt-in is present.

### Legacy infra phases (`infra/`)

Three scripts in `infra/{phase1-pgbouncer,phase2-managed-db,phase3-load-balancer}/` were written for an earlier Hetzner-Forge-based deployment. **Superseded by the current Supabase + Fly stack** — kept for archaeology and as a reference for the structural shape (PgBouncer → managed DB → LB). Don't run them against the current setup.

---

## 5 · Domain map

DNS managed by Cloudflare. Zone: `agenttool.dev`.

| Hostname | Points to | Served by |
|---|---|---|
| `agenttool.dev` | Cloudflare Worker route | `agenttool-proxy`: human routes to `agenttool-web` Pages; API/discovery routes to Fly |
| `app.agenttool.dev` | CF Pages | `apps/dashboard` (splash + watch only since 2026-05-17) |
| `docs.agenttool.dev` | CF Pages | `apps/docs/` (rendered static) |
| `api.agenttool.dev` | Fly.io anycast | `api/` |
| `*.agenttool.dev` | (reserved) | |

Updating DNS records: manual via the Cloudflare dashboard, or scripted ad-hoc using a Cloudflare API token (`Cloudflare_API_Token` in macOS keychain) against the Cloudflare API. The legacy `infra/_archive/phase3-load-balancer/deploy.sh` references the historical Hetzner-LB DNS update; not used today.

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
| `agenttool-soma-*` | SOMA-derived identity keys plus a separately issued project bearer |
| `agenttool-<name>-*` | Human-readable Keychain labels. A name helps lookup and revocation; it does not scope bearer authority to that identity. |

Naming convention: `agenttool-<scope>-<purpose>`, account = `$USER`. The CLI rejects names that don't start with `agenttool-`.

### Server (Fly.io)

Fly secrets are encrypted at rest and decrypted at process start. Import them
from a scoped stdin producer (`fly secrets import -a agenttool`); do not put
values in argv, shell history, the repository, or committed env files.

The local `agenttool-secret` keychain and Fly's secret store are **disjoint** — they hold different data with overlapping naming conventions. Local entries are for dev tools (migrations, smokes, deploy scripts). Fly secrets are for the running api.

### x402 V2 project-credit rail

The optional exact/EIP-3009 rail is fail-closed. A recipient alone does not make a payable challenge.

| Variable | Contract |
|---|---|
| `AGENTTOOL_X402_RECIPIENT` | Non-zero EVM recipient. Missing/invalid suppresses challenges. |
| `AGENTTOOL_X402_NETWORK` | CAIP-2 network; defaults to Base `eip155:8453`. Legacy `base`, `polygon`, and `arbitrum` aliases normalize before the wire. Invalid explicit values suppress rather than switching chains. |
| `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` | Both required for the official CDP default. The server locally proves endpoint-bound JWT generation before advertising and generates a fresh JWT separately for `/verify` and `/settle`. Never use a static `COINBASE_CDP_API_KEY` bearer. |
| `AGENTTOOL_X402_FACILITATOR` | Optional explicit HTTPS custom facilitator. It receives no CDP credential and is reached through the bounded SSRF-safe transport. Its settlement response is nevertheless an operator-selected trust root that can mint project credits; transport safety does not attest facilitator correctness. |
| `AGENTTOOL_X402_ALLOW_TESTNET=1` + `AGENTTOOL_X402_ENVIRONMENT=test` | Double opt-in for Base Sepolia outside production/Fly only. Faucet USDC cannot mint live project credits. |

The official base is exactly `https://api.cdp.coinbase.com/platform/v2/x402`. Payment state is inspectable at authenticated `GET /v1/x402/payments/:authorizationHash`; it does not replay tool output. No automatic on-chain reconciliation worker exists. A pending row with a settlement-attempt timestamp requires manual investigation using the persisted non-signature authorization evidence. A pending row without that marker stays status-only for the old signature: while `validBefore + 5s` is live, status supplies `Retry-After`; after expiry it directs the caller to omit `PAYMENT-SIGNATURE` and request a fresh current-policy challenge.

Before facilitator admission, the server bounds the authorization to the advertised 60-second window (+5 seconds clock skew). Direct 65-byte EIP-712 signatures use offline EOA recovery; bounded EIP-1271/ERC-6492 smart-account signatures defer to the facilitator behind the same durable cap. A fail-closed PostgreSQL advisory-lock bucket permits at most 5 unresolved/failed fresh authorization identities per project per rolling 10 minutes; successful settled rows do not consume that rolling quota. Rejection returns `Retry-After: 600` without another payable prompt.

---

## 7 · Local dev

Cold-start on a fresh laptop:

```bash
# 1. Clone
git clone https://github.com/cambridgetcg/agenttool.git
cd agenttool

# 2. Install api + SDK deps
cd api && bun install && cd ..
cd packages/sdk-ts && bun install && cd ../..

# 3. Stash DATABASE_URL from the clipboard; generate K_master into stdin.
pbpaste | bin/agenttool-secret set agenttool-database-url -
openssl rand -hex 32 | bin/agenttool-secret set agenttool-vault-master-key -

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
# API typecheck + classified non-external tests + operator/protocol tests
bin/preflight.sh api

# SDK parity (py vs ts surface)
cd packages/sdk-ts && bun run check-parity

# SDK unit tests
cd packages/sdk-ts && bun test
cd packages/sdk-py && .venv/bin/pytest

# Playwright (browser e2e against local api)
cd tests/playwright && npx playwright test
# api dev server must be running; static server starts automatically per playwright.config.ts

# E2E smokes against prod or local (supply the three required smoke variables)
bin/preflight.sh smoke
AGENTTOOL_BASE=http://localhost:3000 python3 api/scripts/_e2e-token-hygiene.py
```

---

## 8 · Deploy semantics — manual, intentional, decoupled

> **Canonical procedure:** [`docs/DEPLOY-PROCEDURE.md`](DEPLOY-PROCEDURE.md) — the six-phase routine chain (survey · migrate · pre-flight · discovery prerequisites + api · remaining frontends · verify), codified by `bin/deploy.sh`. The text below names the *primitives* this section composes; the procedure doc names the *order* and the *checks*.

`git push github main` updates the coordination/release head. **Nothing else happens.** Production reflects the most recent verified manual deploy, not the most recent push. The core invocations are:

```
git push github main         (release source lands; no deploy side effects)

bin/deploy.sh --no-migrate
                             (coordinated web → docs → exact prerequisite
                              verification → Fly/API → dashboard release)

bin/deploy.sh --no-migrate --no-api
                             (frontend-only release-tracked CF Pages deploy)
                             (gate + preflight + sampled/negative checks + receipt)

bin/frontend-deploy.sh dashboard
                             (low-level subset escape hatch; no gate/receipt itself)

bin/deploy.sh --no-migrate --no-frontend
                             (requires exact discovery prerequisites already live,
                              then stages doctrine bytes and rolls Fly)
                             (~3-5 minutes; old machines serve until new ones healthcheck-green)

DATABASE_URL=... bun api/scripts/_migrate-one.ts <file>   (ordinary DB migration only)
```

At invocation start, `bin/deploy.sh` fetches `github/main`, includes untracked
files in its cleanliness check, and rejects a different local commit. That
release-head snapshot remains fixed through the chain. `--survey` reports that
snapshot alone; since the Codeberg mirror was retired there is no second ref for
it to confuse with the release head.

### Right ordering for high-stakes deploys

Schema-touching changes need the migration applied **before** the api code that reads new columns ships, otherwise the api crashes on startup. Discovery changes need their committed docs and game surfaces exact **before** the api advertises them. UI-touching changes that depend on new api fields need the api up **before** the dashboard ships, otherwise the dashboard sees old responses. The coordinated wrapper enforces those boundaries in this default order:

```bash
# 1. Land the exact release commit on GitHub main
git add api/migrations/<file> api/src/...
git commit -m "feat(api): <something using new column>"
git push github main

# 2. Survey/apply ordinary migrations, test, publish prerequisites, roll Fly,
#    publish the dashboard, and verify exact live provenance.
bin/deploy.sh
fly status -a agenttool                     # confirm every machine is green

# 3. Smoke the api with credentials scoped to the child process
AGENTTOOL_BASE=https://api.agenttool.dev \
AGENTTOOL_API_KEY="$(bin/agenttool-secret get agenttool-soma-bearer)" \
AGENTTOOL_IDENTITY_ID="$(bin/agenttool-secret get agenttool-sophia-identity-id)" \
  bin/preflight.sh smoke

# 4. Smoke the frontend
curl -sI https://app.agenttool.dev/dashboard.html | head -1
```

This default order does not apply when the migration is listed in
`api/migrations/quiescence-required.txt`. The orchestrator and pending runner
refuse that set before mutation; use the exclusive maintenance cutover in
`DEPLOY-PROCEDURE.md`. Both direct one-file runners refuse listed files; that
accidental-bypass guard is not proof that old writers were stopped.

The split is deliberate: web and docs go first because the api may advertise
them, while the dashboard goes last because it may depend on the new api.
Deploying the api before its discovery prerequisites can expose stale or
missing surfaces; deploying the dashboard before its api can expose new UI to
old responses. A push alone still deploys nothing.

### Pre-flight before any deploy

The single entry point is `bin/preflight.sh`. Its default is the deterministic,
application/service-credential-free gate used by the deploy wrapper:

```bash
git status -s                 # working tree clean (all changes pushed)
bin/preflight.sh              # API + packages, hermetic dependency boundary
```

The default unsets known credentials and service URLs, disables workers, uses
the installed Bun 1.3.5 compiler, runs the API hermetic tier plus operator
tests, gates and builds `packages/data` for its local dependent, and runs the
`packages/data-protocol`, `packages/data-sync`, `packages/repo-archive`, and
TypeScript SDK CI gates.
“Hermetic” here means no database, Redis, deployed target, credential, or
paid-provider dependency; it is not an OS-level network sandbox.

Explicit modes keep stateful and paid checks out of the default:

| Mode | What it runs | Required input |
|---|---|---|
| `api` | API typecheck, hermetic API tests, operator/protocol tests | none |
| `packages` | data reference node gate/build, ADDS package, explicit data-sync bridge, repo-archive draft/simulator, TypeScript SDK CI/parity | none |
| `database` | API typecheck and database integration tier | `DATABASE_URL` |
| `smoke` | deployed API smoke | base URL, API key, identity ID |
| `contracts` | paid provider contract tier | `RUN_CONTRACT=1` and provider key(s) |
| `quarantine` | known-red non-DB diagnostics | none; failures expected |
| `database-quarantine` | known-red DB diagnostics | `DATABASE_URL`; failures expected |
| `legacy-delta` | legacy full-suite baseline triage | none |

Use `bin/preflight.sh list` to inspect the classified test tiers. Optional
stateful and paid tiers are selected by mode, never implicit skip toggles.

Optional, run separately when meaningful:

```bash
cd tests/playwright && npx playwright test   # browser e2e (Cloudflare Pages flows)
```

The doctrine layer (`api/tests/doctrine/README.md`) remains the canonical
wake-side spec. Run `smoke` and `contracts` separately, from an environment
that deliberately supplies their network target and credentials.

If these don't pass, don't deploy. The pre-flight catches "I'm about to ship code that doesn't even compile" — common after a multi-file refactor where one file got missed.

---

## 9 · Observability

| Surface | Where | What for |
|---|---|---|
| `GET /health` | `https://api.agenttool.dev/health` | Fly's no-store target; `build.revision` and `build.dirty` are declared source labels (or `null` when unlabelled), not an image digest |
| `GET /v1/wake` | api (auth required) | Project observability composed around an explicit `identity_id` (or the backward-compatible first-identity default) |
| `fly logs -a agenttool` | Fly CLI | Server logs, real-time |
| `fly status -a agenttool` | Fly CLI | Machine health + recent releases |
| `fly dashboard agenttool` | Browser | Fly's web console |
| Cloudflare Pages dashboard | `dash.cloudflare.com` | Per-project deploy history, build logs, rollback button |
| Cloudflare Analytics | `dash.cloudflare.com` | DNS / edge request volume + cache stats |
| Postgres logs | Supabase dashboard (project `jseqftufplgewhojwbmh`) | DB-level errors, slow queries, `pg_stat_statements` |

The agent-side `/v1/wake` is intentionally the deepest observability surface. The bearer authorizes the project; `identity_id` selects the identity around which the response is composed. If you're triaging "what is Sophia's posture right now," call wake with Sophia's identity ID.

---

## 10 · Disaster recovery

Three failure classes, three recipes:

### Lost a bearer

`POST /v1/keys/rotate` from any other working bearer; or `POST /v1/identity/recover` with a matching active registered signing key. A compatible mnemonic may rederive that key locally. Doctrine: `TOKEN-HYGIENE.md`.

### Lost a device (laptop stolen, drive failure)

`agenttool-seed restore --did <did>` on a new device with a compatible mnemonic. It rederives a signing key locally and succeeds only when that key matches an active registered key for the active identity; the server verifies the signed request and mints a fresh project-wide bearer named for that device. Doctrine: `IDENTITY-SEED.md`.

### Lost a deployment (api crashed / bad code shipped)

Follow [`DEPLOY-PROCEDURE.md` Phase 6](DEPLOY-PROCEDURE.md#phase-6--rollback).
Never restore an old writer after any quiescence-required SQL commits; keep
admission and workers held and fix forward with a compatible image. For a
code-only release or ordinary migration, independently prove full runtime and
schema compatibility before using Fly rollback.

Or roll the dashboard via the CF Pages dashboard.

### Lost a database

**Supabase** provides automated daily backups on the Pro plan (free tier: opt-in PITR is unavailable). Verify the project's backup posture in the Supabase dashboard → Database → Backups. Restore is operator-driven via the dashboard (point-in-time on Pro+ plans only). For a defense-in-depth posture, consider a periodic `pg_dump` to S3/R2 from a Fly machine or a separate cron host — the application stack does not currently do this.

### Lost the mnemonic

The mnemonic-specific recovery path is gone. That does **not** prove the
identity or its records are gone: another working project bearer or a
separately retained active registered signing key can still authorize the
paths described above. If neither exists, AgentTool has no help-desk override
that can reconstruct the missing private key. See `IDENTITY-SEED.md`.

---

## 11 · The shape of "knowing where things are"

If you read one paragraph from this doc, this is it:

> GitHub `main` is the **coordination/release head**, and the only one — the Codeberg mirror was retired 2026-07-25. Production deploys are **manual** and normally release-tracked through `bin/deploy.sh`: use `--no-migrate --no-api` for frontend-only work and `--no-migrate --no-frontend` for API-only work. The API wrapper stages doctrine bytes, embeds revision plus dirty-source labels, verifies those labels on every rolled machine, and records successful or potentially partial chains locally. Those labels are provenance, not an image digest or reproducible-build attestation. The **Postgres + Redis** they share lives on **Supabase** in **AWS London** (`eu-west-2`); the entire stack is currently UK-jurisdictional, with the `cdg` Fly machine as a soft API-tier hedge and DB-tier hedging deferred. **Local dev hits the same DB as prod** by design. **Secrets** live in the OS keychain (developer side) or Fly's secret store (server side); access them via `bin/agenttool-secret`. `GET /v1/wake` is a broad project orientation surface, not a complete export; its scope and degradation limits are in `/public/safety`.

— Authored by 愛 at Yu's WILL. 2026-05-09.
