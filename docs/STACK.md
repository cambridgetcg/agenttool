# STACK.md

> _How the kingdom deploys — code host, frontend, backend, database, secrets._

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (who else this is for) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) (what's shipping) · [NOW](NOW.md) (what just landed) · [MAP](MAP.md) (doctrine index) · [DEVELOPMENT](DEVELOPMENT.md) (how to contribute)

This is the architecture/operations map. It sits between two existing docs:

- **`DEVELOPMENT.md`** — contributor protocols (migrations, schema collisions, secrets, K_master rotation).
- **`DEPLOYMENT.md`** — bring-up runbook from a fresh DB to a working API.

`STACK.md` answers the gap between them: _where does each piece of the kingdom actually live, and what happens when I `git push`?_

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
        │  Cloudflare edge       │    │  Fly.io                │
        │                        │    │  app = "agenttool"     │
        │  agenttool-proxy Worker│    │  region = "lhr"        │
        │  owns apex + www       │    │                        │
        │  → Pages/API by route  │    │  Bun + Hono monolith,  │
        │                        │    │  journaled schema,     │
        │  Pages Direct Upload:  │    │  → api.agenttool.dev   │
        │  • agenttool-web       │    │                        │
        │    apex backing only   │    └───────────┬────────────┘
        │  • agenttool-dashboard │                │
        │    → app.agenttool.dev │                │
        │  • agenttool-docs      │                │
        │    → docs.agenttool.dev│                │
        │  (no Git integration)  │                │
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

> **Important.** `git push github main` is **not** a deploy. GitHub `main` is the coordination and release head; each deploy snapshots it once at invocation start. GitHub `main` is the only head — the Codeberg mirror was retired 2026-07-25. CF Pages projects are configured as **Direct Upload** (no Git integration), `agenttool-proxy` is deployed separately as a Worker, and Fly receives no webhook. Use `bin/deploy.sh --no-migrate --no-api` for a normal frontend-only release and `bin/deploy.sh --no-migrate --no-frontend` for an API-only release. The API wrapper stages canonical doctrine bytes required by the Docker build; bare `cd api && fly deploy` fails when that generated staging directory is absent. See §8 below.

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

**Branches.** `main` is the canonical branch. There is no `develop` / `staging` branch — local dev hits the same DB the prod API reads, which keeps the iteration loop tight at the cost of "your local dev IS prod's data" (see _Database_ below for the implications).

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

## 2 · Frontend: Cloudflare Pages + apex Worker

The three CF Pages projects use **Direct Upload mode — no Git integration**.
`agenttool-proxy`, a separate Cloudflare Worker, owns both apex zone routes. The
normal release-tracked frontend verb is `bin/deploy.sh --no-migrate --no-api`;
it applies the GitHub snapshot gate, hermetic preflight, sampled parity checks,
sensitive-path denial checks, and a receipt. `bin/frontend-deploy.sh` is the
low-level Pages/Worker uploader for a deliberate subset escape hatch. By itself
it does not apply the source gate or write the orchestrator receipt.

The low-level uploader captures the current commit hash once and builds its
upload tree from a Git archive of that exact object, not the ambient working
directory. That allowlisted tree contains the three apps, `infra/pages/`, and
`infra/apex-door/`; dirty and ignored files are excluded. A tracked `.env` file
is a hard refusal, as is a tracked `.dev.vars*` file. Every invocation of the
pinned Wrangler appends `--env-file=/dev/null` after its subcommand arguments,
so Wrangler cannot silently treat a repository `.env` or `.env.local` as a
credential source. Explicit process credentials, Keychain fallback, and the
deliberately selected OAuth session remain separate inputs.

`infra/pages/` is the single source for a Pages advanced-mode Worker and its
route-complete Pages invocation policy. The uploader stages that pair into all
three project roots. Every path invokes the Worker so percent-encoded separators
and traversal cannot evade inspection by appearing after an ordinary prefix.
The Worker bounded-decodes and case-folds paths before denying `/.git*`,
`/.env*`, and `/.dev.vars*` with a marked, non-cacheable 404. Exact XENIA
manifest and orientation routes terminate in the Worker; all other allowed
requests, including ordinary static assets, are forwarded intact to the Pages
asset binding. Every request therefore counts as a Pages Function invocation.
On the Workers Free plan, production and preview must be configured
to fail closed; allowance exhaustion then returns an error instead of serving
any Pages asset, because the fence covers the entire site. The route policy does
not itself evict a response already cached ahead of Pages, so marked live probes
remain the convergence proof and an explicitly authorized cache purge may still
be required during recovery.
The uploader accepts
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, then falls back to their
macOS keychain entries. In the default token mode, that credential must read the
Pages REST policy as well as upload: Pages Read/Edit lets the script verify
fail-closed settings and the `main` production branch for every target before
any upload. For a requested `web` target, Zone Read and Workers Routes Read let
token mode require exactly `agenttool.dev/*` and `www.agenttool.dev/*` to be
owned by `agenttool-proxy`; the actual Worker release also needs Workers Scripts
Edit and Workers Routes Edit. An explicit `--oauth-fallback` is a weaker
break-glass mode: Wrangler proves only that the requested Pages projects and
apex Worker are visible to that OAuth session. The script loudly skips the raw
Pages policy and Worker-route inspections, so OAuth visibility is not proof of
`production_branch`, `fail_open`, apex/www ownership, or routing policy. The
uploader does not mutate those settings or purge zone cache. Phase 5 proves
current live denial and fence activation on literal paths, plus denial of
encoded aliases.

| Project               | Source dir        | Custom domain                | What it serves                                                                                                                 |
| --------------------- | ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `agenttool-dashboard` | `apps/dashboard/` | `app.agenttool.dev`          | SDK quickstart (`index.html`) + read-only observation surface (`watch.html`). Workspace UI retired 2026-05-17 per agents-only. |
| `agenttool-docs`      | `apps/docs/`      | `docs.agenttool.dev`         | Static docs site                                                                                                               |
| `agenttool-web`       | `apps/web/`       | Apex Pages backing only      | Human door, watch window, credits, village, and gallery; reached through `agenttool-proxy`                                      |

`agenttool-proxy` is the production owner of both `agenttool.dev/*` and
`www.agenttool.dev/*`. It canonicalizes `www` to the apex, terminates the exact
apex XENIA Surface routes locally, sends API and discovery paths (plus `/` when
the client requests JSON) to `api.agenttool.dev`, and uses `agenttool-web` Pages
as the backing for human routes. The Pages project is not the apex route owner.
`apps/landing/` and the old `agenttool-landing` project are retired.

```bash
# Normal release of all frontend projects
bin/deploy.sh --no-migrate --no-api

# Low-level subset escape hatch
bin/frontend-deploy.sh dashboard
bin/frontend-deploy.sh dashboard docs
```

A `web` target is one ordered but non-atomic provider attempt. The uploader
first validates and dry-runs the exact staged apex Worker, uploads the
`agenttool-web` Pages backing, and only after that succeeds deploys
`agenttool-proxy` from the same commit. A Pages failure prevents the Worker
step; a Pages success followed by a Worker failure leaves partial Cloudflare
state. Multiple requested targets are also independent: they are attempted in
argument order, and the first failed target stops later targets without rolling
back an earlier successful Pages or Worker deployment. The normal orchestrator
exits non-zero and, once an external mutation may have begun, attempts a routine
receipt with `outcome: "failed_or_uncertain"`; the low-level uploader writes no
such receipt. Inspect both provider histories before retry or repair.

The script verifies `apps/<x>/shared` symlinks resolve before deploying (they point at `apps/_shared/` for shared theme + nav). Wrangler follows symlinks at upload time so the resolved files reach the CDN.

### No build step

The dashboard is **vanilla HTML/CSS/JS**. Files ship as-is. No build step since the SOMA seed bundle was removed (2026-05-15 agents-only restructure — the SDK does BIP39 derivation directly; the dashboard no longer needs a browser-side bundle).

### Cache headers

`apps/dashboard/_headers` sets `Cache-Control: public, max-age=0, must-revalidate` on `style.css`. Browsers still 304 fast when content is unchanged — the must-revalidate just stops them from skipping the round-trip entirely. Without this, post-deploy operators kept hitting hours-old code from browser cache.

**Zone-level requirement.** For `_headers` to take effect on JS/CSS/non-HTML responses, the Cloudflare zone setting **Browser Cache TTL must be `0` ("Respect Existing Headers")** on `agenttool.dev`. CF's default is 4 hours — that value silently _overrides_ origin Cache-Control on static assets (HTML is exempt from the override, which is why HTML rules in `_headers` worked while JS/CSS rules silently didn't, until 2026-05-09). Verify via API:

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
zone read plus **Cache Rules: Edit**; the frontend deploy token is not evidence of
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

Cloudflare Pages and Workers keep separate deployment histories. Rolling a
Pages project back does not roll `agenttool-proxy` back, and changing the Worker
does not select an older Pages deployment. For `app` or `docs`, select the
intended prior Pages deployment in that project. For `web`, inspect both the
`agenttool-web` Pages history and the `agenttool-proxy` Workers
version/deployment history, select or redeploy a reviewed compatible pair, then
repeat the live apex checks. Neither provider history is an atomic release
record for the other. The Fly API remains a separate substrate.

### Why direct upload, not Git integration

Direct Upload keeps deployment intentional: GitHub is not wired to a Pages deploy hook. The cost is deliberate separation between "land this commit" and "ship this commit."

---

## 3 · Backend: Fly.io

```
Fly app: agenttool
Primary region: lhr
Observed started apps: lhr(2) + cdg(1)
Observed started thinkers: lhr(1)
Observed stopped standby thinkers: lhr(1)
```

Single Bun + Hono monolith in `api/`. The `api/fly.toml` describes the
per-machine runtime defaults (port, healthcheck, env) and process groups, but
deliberately has no `[[vm]]` blocks and requests no process-specific CPU or
memory sizes. Removing those blocks does not resize existing Machines. Under
Fly's [documented size precedence](https://fly.io/docs/launch/scale-machine/#machine-size-configuration-precedence),
existing Machines retain their sizes and scaling can infer a size from an
existing Machine; an empty fleet or new process group with no sizing source
falls back to `shared-cpu-1x`. As verified on 2026-08-20, the registry contains
three started 1 GB `app` Machines, one started 256 MB `thinker` Machine, and
one stopped 256 MB standby `thinker` Machine.
Machine sizing and the complete fleet remain live Fly registry state.

Inspect both `fly machine list -a agenttool --json` and
`fly status -a agenttool`; a process count, `fly scale show`, or `fly.toml`
alone is not topology proof. The ordinary deploy verifies the exact five
Machines, role/region/state, CPU and memory, restart and standby configuration,
full common image reference, source labels, Machine-scoped secret-override
absence, and all four started runtimes. When covenant authority is configured,
the final B1 receipt fixes the five identities and the signed native verifier
also compares the retained Keychain generation to each actual service process.
Every newly created Machine—including a capacity addition, replacement, clone,
or recovery Machine—therefore needs a separate reviewed identity update; the
routine path fails closed rather than adopting it.

### Region shape

| Region         | Started `app` | Started `thinker` | Stopped standby `thinker` | Role                                                 |
| -------------- | ------------: | ----------------: | -------------------------: | ---------------------------------------------------- |
| `lhr` (London) |             2 |                 1 |                          1 | Primary API fleet and trusted-runtime controller     |
| `cdg` (Paris)  |             1 |                 0 |                          0 | Secondary API hedge across a second jurisdiction     |

The worker implementations include multi-instance coordination mechanisms
(BullMQ consumer locks and database CAS where documented). That is a design
property, not evidence that workers are enabled. Current production starts all
three app Machines with `AGENTTOOL_DISABLE_WORKERS=1`; payout, queue, and
in-process timer workers therefore remain disabled. `api/fly.toml` sets the
narrow `AGENTOOL_ENABLE_THINKER=1` entrypoint override: only the dedicated
thinker code reads it, so one thinker can reconcile trusted runtimes without
re-enabling HTTP-side workers. Its second Machine is a stopped standby. This is
configuration intent, not proof of useful work; verify the started thinker's
logs and the live runtime registry after every rollout.

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
source labels. The same silent SSH command runs the image-resident bounded
verifier, which authenticates and issues a read-only `SELECT 1` through both
the transaction and session URLs. Stopped Machines must share that image
digest and exact process command and cannot override either database secret at
Machine scope. SSH stdout/stderr is suppressed, so URLs, credentials, and
driver errors are not copied into the deploy transcript.

After the first covenant authority generation, a read-only Phase-B guard also
requires the database's durable empty-allowlist hold, the canonical completed
B1 receipt, provider secret status `Deployed`, the exact receipt-bound fleet,
and four silent actual-process comparisons. It repeats immediately before and
after API publication. Configured API/database-affecting releases reject
source/preflight overrides and
must descend from fence commit
`2ca44b44bcfde9d571b27771f9d5fc516a4df41e`; mixed or staged secret state is B1
recovery, never an ordinary deploy. The fixed root-owned Fly v0.4.74 artifact
and private Fly home must be installed while the generation is still absent:
the preactivation guard uses that same boundary to prove provider absence
before the first B2 deploy, and configured mode keeps using it thereafter.

If an independently authorised incident or recovery path has already left the
Fly registry empty, keep admission closed and prepare a separate, reviewed
recovery plan. No generic empty-registry restoration mode is supported, and an
empty registry does not authorise recreating identities or guessing at the
prior topology.

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
migration, Fly rollout, Pages upload, or apex Worker deploy may have begun and
the chain later returns non-zero or receives caught `INT`/`TERM`, the exit trap
attempts a receipt with `outcome: "failed_or_uncertain"`. That outcome applies
to the normal `routine` mode too; it is not reserved for maintenance rollouts.
The preactivation/maintenance v6 shape records the source revision and dirty bit, the
invocation-start release-head snapshot, explicit overrides, phase outcomes,
exit status, and verified machine count—never credentials, ambient environment
values, or command output. Configured API/database-affecting releases use v7,
adding only the permanent fence floor, redacted provider/hold/fleet booleans,
zero covenant counts, and a
four-runtime proof count; it contains no generation, digest, Machine ID, or
secret-derived value. `SIGKILL`, host loss, or an unwritable state
directory can prevent that record; receipt absence never proves no mutation.

Like CF Pages, **Fly is not connected to either Git host.** No webhook fires on push; the deploy wrapper is the explicit trigger and requires an authenticated Fly CLI session. HTTP port 80 is redirect-only (`force_https = true`); application traffic and public health probes use HTTPS or Fly's internal service check.

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

API secrets (`DATABASE_URL`, `DATABASE_SESSION_URL`, `REDIS_URL`,
`VAULT_MASTER_KEY`, `STRIPE_*`, etc.) live in Fly's secret store, NOT in the
repo:

```bash
# Resolve and validate both fixed-account entries before the mutating import.
# Values stay in this child shell and stdin; they do not enter argv, shell
# history, or the repository.
/bin/bash -o pipefail -c '
  set -euo pipefail
  database_url="$(
    security find-generic-password -s agenttool-database-url -a macair -w
  )"
  database_session_url="$(
    security find-generic-password \
      -s agenttool-database-session-url \
      -a macair \
      -w
  )"
  test -n "$database_url"
  test -n "$database_session_url"
  printf "DATABASE_URL=%s\nDATABASE_SESSION_URL=%s\n" \
    "$database_url" "$database_session_url" |
    fly secrets import -a agenttool
'
fly secrets list -a agenttool
```

Generating or replacing `VAULT_MASTER_KEY` is deliberately absent from this
routine import example. That is credential rotation and requires a separately
reviewed re-encryption/continuity plan; importing a fresh key by convenience
would not preserve access to existing ciphertext.

`OPENAI_APPS_CHALLENGE` is optional and dormant. Leave it unset until the
OpenAI submission portal issues one domain-challenge token; while unset,
`/.well-known/openai-apps-challenge` stays 404. Store only that one exact
token in Fly secrets through stdin. Never commit, log, trim, combine, or place
it in a command argument. Unsetting the secret is the off-switch.

### Legacy `services/`

The nine former per-domain Fly apps (`bootstrap`, `economy`, `identity`,
`memory`, `pulse`, `tools`, `trace`, `vault`, and `verify`) were retired into
the `api/` monolith on 2026-05-09. Their deploy sources no longer live in this
repository; separately archived local repositories preserve the history only.
Do not deploy those configs or recreate the retired Fly apps. New work goes
into `api/`. Cutover protocol: `docs/CUTOVER.md`.

---

## 4 · Database & Redis

### Postgres — Supabase (AWS London, `eu-west-2`)

Hosted Postgres on **Supabase**, project ref `jseqftufplgewhojwbmh`, region **AWS London** (`eu-west-2` — _not_ Dublin; AWS region naming has `eu-west-1` = Ireland, `eu-west-2` = UK, `eu-west-3` = Paris). Connection goes through Supabase's pooler (`aws-1-eu-west-2.pooler.supabase.com`). Two pool flavors:

- **Session pooler — port 5432.** `DATABASE_SESSION_URL` points here for
  migration applies and other session-affine operations such as LISTEN or
  advisory locks.
- **Transaction pooler — port 6543.** `DATABASE_URL` points here for the API,
  local general access, tests, and read-only migration inventory. It provides
  higher concurrency for many short-lived connections; there are no prepared
  statements (`prepare: false` is required in postgres-js) or reliable
  session-scoped state. A known timeout issue from Fly (logged as task #60)
  presents as authenticated endpoint 502s after about 13 seconds.

**DB pool watchdog.** The transaction pool can wedge while the database stays
healthy: the pooler's NLB can drop its server side without RST/FIN, leaving
postgres.js holding ESTABLISHED zombie sockets while the DB-free `/health`
keeps Fly's checks green (the 2026-08-31 outage). `api/src/db/pool-watchdog.ts`
runs a bounded canary through the shared pool and, when a fresh verified
connection still answers while the pool cannot, logs one loud line and
exits(1) so the Machine's Fly restart policy hands the process a clean pool.
Its time budget stays above the 120-second statement timeout below, because
time alone cannot tell a wedge from saturation; a faster exit (about a
minute) is taken only on the incident's own signature — the fresh probe sees
no non-idle `pg_stat_activity` sessions for this role while the pool cannot
answer — and any other count holds until the full budget. Two companions
land beside it: the shared pool's sockets carry a 135-second inactivity
guard (`api/src/db/guarded-socket.ts`, installed by `client.ts` through
`installInactivityGuard` on the constructor-resolved transport — the verified
constructor itself sits in the sealed maintenance closure, so folding the
option into it waits for the next re-seal) so a single dead connection returns
its slot instead of holding it until the next exit, and both entrypoints
import `api/src/process-guards.ts` first, which turns an unhandled promise
rejection — fatal on Bun, and the cause of the 2026-09-02 19:27Z reboot —
into one loud log line while the process keeps serving
(the fleet currently runs Fly's default — on-failure, 10 retries — and the
app group also revives on traffic via fly-proxy `auto_start`; pinning
stronger policies is deferred because the Phase-B deploy guard and refence
maintenance contract pin the restored machine shape at on-failure/10, so
that change must land together with their reviewed re-seal). It is Fly-gated — it arms only when `FLY_MACHINE_ID` is
present, so local dev and tests never run it — and is deliberately independent
of `AGENTTOOL_DISABLE_WORKERS`. Set `AGENTTOOL_DISABLE_DB_POOL_WATCHDOG=1`
(the operator off-switch) only when a wedged Machine must be held alive for
diagnosis instead of exiting into a restart.

**Database TLS.** Every supported runtime and operator Postgres client uses
`api/src/db/supabase-target.ts`. For a recognized Supabase direct or pooler
URL it supplies an explicit CA object with hostname verification and
`rejectUnauthorized: true`; postgres-js `ssl: "require"` is forbidden because
that mode encrypts without authenticating the server. The vendored
`api/certs/supabase-prod-ca-2021.crt` must match both the exact official S3
object bytes and its X.509 SHA-256 fingerprint, and must be inside its validity
window. Plaintext is accepted only for an explicit loopback Postgres URL;
other remote targets refuse until they have their own reviewed CA contract.
The only non-loopback plaintext exception is the disposable Forgejo sibling
service at the exact `postgres:5432/agenttool_ci` user/database contract; it
requires both `CI=true` and `AGENTTOOL_ALLOW_DISPOSABLE_CI_POSTGRES=1`, and is
disabled whenever `FLY_MACHINE_ID` is present.

Fly additionally pins both pool URLs to the current production database and
logical role, which are presently `postgres` / `postgres`. That broad role is
an acknowledged temporary least-privilege gap, not the desired end state. A
future scoped-role cutover must create and branch-prove the role first, then
atomically rotate both Fly secrets and this source pin. Supabase URL query
parameters and empty URL passwords are refused so postgres-js cannot replace
the proved database/user with query or ambient `PGPASSWORD` values.

Supabase-side SSL enforcement is a separate defense. Roll it out only after
the authenticated clients and both Fly URL secrets have been verified on
every started Machine, then prove unsupported plaintext connections refuse.
Server enforcement does not replace client-side CA and hostname verification.
Do not use raw `psql` against production unless it is separately configured
with the same pinned root and `verify-full`; prefer the checked repository
inventory and migration tools.

**Jurisdictional concentration note.** Both API (Fly `lhr`) and DB (Supabase `eu-west-2` = AWS London) sit in UK jurisdiction. The Fly `cdg` Paris machine added 2026-05-09 hedges API jurisdiction; data-layer hedging requires a separate Supabase project (or migration to `eu-west-3` Paris / `eu-central-1` Frankfurt) and is a deliberate next-step decision, not a current property.

**Server**: PostgreSQL 17.6 · single primary · no replica (`pg_is_in_recovery() = false`).

**Schemas** (15 application + Supabase-managed):

| Schema             | Purpose                                                                           |
| ------------------ | --------------------------------------------------------------------------------- |
| `tools`            | Projects, api_keys, usage_events (shared auth surface)                            |
| `identity`         | Identities, ed25519 identity_keys, identity_box_keys                              |
| `agent_vault`      | vault_secrets, vault_versions, vault_audit                                        |
| `agent_continuity` | chronicle, covenants, identity_backups                                            |
| `agent_runtime`    | runtimes, runtime_events                                                          |
| `economy`          | wallets, transactions, escrows, crypto_payouts, policies                          |
| `memory`           | memories (pgvector), memory_attestations                                          |
| `trace`            | traces                                                                            |
| `strand`           | strands, thoughts                                                                 |
| `inbox`            | sealed messages                                                                   |
| `marketplace`      | templates, listings, invocations, attestation_listings, template_adoptions        |
| `org`              | orgs, org_covenants                                                               |
| `federation`       | peer instances, federated covenants/inbox                                         |
| `social`           | stars, follows                                                                    |
| `vault`            | reserved namespace (legacy holdover; active vault tables are under `agent_vault`) |

Plus Supabase-managed: `auth` (unused — agenttool uses DID + bearer, not Supabase Auth), `realtime`, `storage`, `graphql`/`graphql_public` (unused), `pgsodium`, `supabase_vault`, `public` (empty).

**Extensions**: `vector` (pgvector 0.8.0), `pgcrypto` (1.3), `uuid-ossp` (1.1), `pg_stat_statements` (1.11), `supabase_vault` (0.3.1), `plpgsql`. Verify after fresh deploy through the authenticated `api/scripts/_supabase-inventory.ts` path.

**Operational settings** (current as of 2026-05-09):

| Setting                               | Value          | Note                                                                                                                     |
| ------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `max_connections`                     | 60             | Pool budget — current draw ~6 active; 3-machine fleet × postgres-js `max=10` = up to 30 client conns, well within budget |
| `shared_buffers`                      | 256 MB         | Small instance tier — fine pre-revenue, scales by Supabase plan upgrade                                                  |
| `effective_cache_size`                | 768 MB         | OS+PG cache hint                                                                                                         |
| `work_mem`                            | 3.5 MB         | Small — complex sorts/hashes spill to disk; raise per-query with `SET LOCAL work_mem` if needed                          |
| `statement_timeout`                   | 120 s          | Hard kill; chunk migrations that exceed                                                                                  |
| `idle_in_transaction_session_timeout` | 0 (off)        | No kill — be vigilant about open transactions in long-running scripts                                                    |
| `default_transaction_isolation`       | read committed | Default; no serializable surfaces                                                                                        |

**RLS posture**: zero application-schema RLS. Authorization is enforced at the app layer via bearer key → project → ownership chain. RLS is on only for Supabase-managed schemas (`auth`, `realtime`, `storage`). Doctrinally consistent — agenttool's identity model is DID + ed25519, not Postgres roles.

**Database size**: ~16 MB total (2026-05-09). Pre-revenue scale; lots of headroom before any tuning matters.

**Local dev hits the same DB as prod.** The transaction-pooled
`agenttool-database-url` and session-pooled
`agenttool-database-session-url` entries used by migration tooling must point
at the same production database target through their respective pool modes;
there is no separate `dev.db`. This is intentional (tighter iteration loop, no
sync drift) and load-bearing on Yu's workflow. Implications:

- Migrations applied locally are visible to prod immediately.
- Test fixtures created during e2e runs (the `_e2e-*.py/.mjs` scripts) land in prod tables. Most scripts now sweep their residue at the end; if you write a new one, do the same.
- Don't run destructive operations against this DB. There is no separate staging.

### Migration application

```bash
# Canonical ordered inventory and apply:
bin/migrate-pending.sh

# Or one explicitly selected ordinary migration:
DATABASE_SESSION_URL=... \
  bun api/scripts/_migrate-one.ts api/migrations/<file>
```

Naming: `0000` through `0022` are pre-2026-05-08 sequential numbering; everything after uses `YYYYMMDDTHHMMSS_<slug>.sql` timestamps to prevent parallel-session collisions (see `DEVELOPMENT.md` §1).

**Journal**: `meta._migrations` records every filename + sha256 of the file contents at apply time. `_migrate-one.ts` checks the journal before applying — already-applied files with matching checksum are skipped; checksum mismatch is treated as a corruption signal (someone edited a migration file post-apply) and refuses to proceed. Migrations also wrap in `BEGIN/COMMIT` by default (opt out with `-- @no-transaction` for things like `CREATE INDEX CONCURRENTLY`).

`bin/migrate-pending.sh` surveys the complete source/journal/checksum inventory
through transaction-pooled `DATABASE_URL`. Before a real apply, it repeats that
complete inventory through session-pooled `DATABASE_SESSION_URL`, first
rejecting an exact URL-string match and then requiring the exact same ordered
pending filenames before the first mutation. Distinct strings and matching
inventories narrow endpoint drift; they do not prove pool mode or database
identity, which remain operator-provided bindings. A clean inventory, dry run,
or unasserted protected-migration refusal does not resolve the session
credential.

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
DATABASE_SESSION_URL=... bun api/scripts/_migrate-one.ts \
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

Registration admission can separately opt into a bounded request-only Redis
client with `AGENTTOOL_REGISTRATION_RATE_LIMIT_ENABLED=1`. It requires an
explicit `AGENTTOOL_REGISTRATION_RATE_LIMIT_REDIS_URL` or existing `REDIS_URL`;
it never guesses localhost. This leaves the global worker switch, shared
worker Redis, queue execution, and generic Redis idempotency unchanged.
Missing configuration, connection errors, and the bounded request deadline
retain registration's documented fail-open policy. `/public/plans` discloses
the configuration mode without claiming network reachability. See
[`launch/ADMISSION-OPERATIONS.md`](launch/ADMISSION-OPERATIONS.md) for the
activation and isolated verification boundaries.

### Legacy infra phases (`infra/`)

Three scripts in `infra/{phase1-pgbouncer,phase2-managed-db,phase3-load-balancer}/` were written for an earlier Hetzner-Forge-based deployment. **Superseded by the current Supabase + Fly stack** — kept for archaeology and as a reference for the structural shape (PgBouncer → managed DB → LB). Don't run them against the current setup.

---

## 5 · Domain map

DNS managed by Cloudflare. Zone: `agenttool.dev`.

| Hostname | Points to | Served by / source posture |
| --- | --- | --- |
| `agenttool.dev` | Cloudflare Worker route | `agenttool-proxy`: exact Surface routes locally; human routes to `agenttool-web` Pages; API/discovery routes to Fly |
| `www.agenttool.dev` | Cloudflare Worker route | `agenttool-proxy`: canonical redirect to the apex |
| `app.agenttool.dev` | Cloudflare Pages | `apps/dashboard` (splash + watch only since 2026-05-17) |
| `docs.agenttool.dev` | Cloudflare Pages | `apps/docs/` (rendered static) |
| `api.agenttool.dev` | Cloudflare proxied DNS → Fly | `api/`; Cloudflare is an edge boundary, while Fly/Postgres remain application/state truth |
| `canon.agenttool.dev` | Cloudflare Worker route | `kingdom-canon`; deployed source/config is not yet recovered in this repository |
| `joke.agenttool.dev` | Cloudflare Worker route | `joke`; deployed source/config is not yet recovered in this repository |
| `love.agenttool.dev` | Cloudflare Worker route | `love`; deployed source/config is not yet recovered in this repository |
| `party.agenttool.dev` | Cloudflare Worker route | `party-chain`; deployed source/config is not yet recovered in this repository |
| `speak.agenttool.dev` | Cloudflare Worker route | `natlang`; deployed source/config is not yet recovered in this repository |

The five source-unrecovered Workers also expose public provider aliases at
`{kingdom-canon,joke,love,party-chain,natlang}.axiepro.workers.dev`. Those
aliases bypass `agenttool.dev` zone rules. `agenttool-proxy` deliberately has
its `workers.dev` alias disabled and is reached through its apex/www routes.
`agenttool-playground.pages.dev` is a live provider-only Pages project with no
current repository deployment source or `agenttool.dev` custom hostname; it
needs an explicit retain-or-retire decision, not an inferred deletion.

The bounded desired-state map is
`infra/cloudflare/agenttool.dev.desired.json`. Validate it without provider
access using `bun bin/cloudflare-zone-audit.ts`; run the read-only live audit by
scoping the `agenttool-cloudflare-token` Keychain value to that one child as
`CLOUDFLARE_API_TOKEN`. The audit never mutates Cloudflare and never serializes
record content, provider IDs, or credentials. Its current token can verify zone
settings, Worker/Pages topology, script observability, and public routing, but
DNS/DNSSEC, Cache Rules, Configuration Rules, and managed-WAF reads remain
permission-blocked until the exact zone-scoped grants named by the audit are
added. A future origin-auth rollout additionally needs zone-scoped Transform
Rules Read/Write; those grants alone do not authorize enabling the gate before
the legacy Fly-host federation choice is resolved. Unknown provider rules are
preserved; the WAKE cache-bypass rule must be
the final enabled Cache Rule because Cloudflare resolves conflicting cache
settings by last match.

`infra/apex-door/wrangler.toml` is the source of truth for
`agenttool-proxy` observability: incoming requests and persisted invocation
logs are sampled at 1%, while traces are disabled and not persisted. The
pinned Wrangler treats an omitted observability block as an instruction to
disable this script-level, non-versioned setting after a Worker deploy. Every
`web` deploy therefore validates and reapplies the committed contract. A
successful version deployment alone does not prove the later settings update
succeeded; the GET-only live audit must report `worker_observability: ok`
afterward. This sampling contract does not make request bodies or
`Authorization` safe to log; Worker source must continue not to emit them.

The legacy `infra/_archive/phase3-load-balancer/deploy.sh` references the
historical Hetzner-LB DNS update and is not used today.

---

## 6 · Secrets

Two-layer model. Doctrinal pointer: `DEVELOPMENT.md` §5.

### Local (developer machines)

OS-managed secret store via the **`agenttool-secret`** CLI (`bin/agenttool-secret`). Backends:

| OS      | Mechanism                                     | Fallback                                  |
| ------- | --------------------------------------------- | ----------------------------------------- |
| macOS   | `security` (Keychain Access)                  | none                                      |
| Linux   | `secret-tool` (libsecret)                     | `~/.config/agenttool/<service>` mode 0600 |
| Windows | DPAPI (`%APPDATA%/agenttool/<service>.dpapi`) | plaintext fallback                        |

```bash
# Write (stdin — never argv)
pbpaste | bin/agenttool-secret set agenttool-vault-master-key -

# Gate
if bin/agenttool-secret has agenttool-vault-master-key; then ...; fi
```

Key services on this machine (developer-shared naming):

| Service                           | Account                                              | What                                                                                                           |
| --------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `agenttool-database-url`          | `$USER` for local API; `macair` for migration runner | Transaction-pooled general/survey URL; never substituted for a session-affine apply                            |
| `agenttool-database-session-url`  | `macair` for migration runner                        | Session-pooled URL required by `_migrate-one.ts` and real batch applies                                        |
| `agenttool-vault-master-key`      | `$USER`                                              | 32-byte hex; api server reads to seal vault entries                                                            |
| `agenttool-cloudflare-token`      | `macair` for `frontend-deploy.sh`                    | CF token: Pages Read/Edit, Zone Read, Workers Scripts Edit, and Workers Routes Read/Edit                       |
| `agenttool-cloudflare-account-id` | `macair` for `frontend-deploy.sh`                    | CF account id                                                                                                  |
| `agenttool-bridge-kmaster`        | `$USER`                                              | Bridge sidecar's K_master                                                                                      |
| `agenttool-bridge-signkey`        | `$USER`                                              | Bridge sidecar's ed25519 signing key                                                                           |
| `agenttool-soma-*`                | `$USER`                                              | SOMA-derived identity keys plus a separately issued project bearer                                             |
| `agenttool-<name>-*`              | `$USER` by generic CLI                               | Human-readable labels; a name helps lookup and revocation but does not scope bearer authority to that identity |

The generic CLI enforces the `agenttool-<scope>-<purpose>` naming convention
and uses account `$USER`. The local pending and one-file migration runners
prefer their explicit database environment variables, then query fixed legacy
account `macair` entries as fallback; `frontend-deploy.sh` likewise has
documented environment inputs and fixed `macair` fallbacks. Consequently,
`bin/agenttool-secret has ...` does not provision or prove those tool-specific
entries. Use
`security add-generic-password -U -s <service> -a macair -w` for them; the
final `-w` prompts without putting the value in argv or history.

### Server (Fly.io)

Fly secrets are encrypted at rest and decrypted at process start. Import them
from a scoped stdin producer (`fly secrets import -a agenttool`); do not put
values in argv, shell history, the repository, or committed env files.

The local `agenttool-secret` keychain and Fly's secret store are **disjoint** — they hold different data with overlapping naming conventions. Local entries are for dev tools (migrations, smokes, deploy scripts). Fly secrets are for the running api.

### x402 V2 project-credit rail

The optional exact/EIP-3009 rail is fail-closed. A recipient alone does not make a payable challenge.

| Variable                                                             | Contract                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTTOOL_X402_RECIPIENT`                                           | Non-zero EVM recipient. Missing/invalid suppresses challenges.                                                                                                                                                                                                                                     |
| `AGENTTOOL_X402_NETWORK`                                             | CAIP-2 network; defaults to Base `eip155:8453`. Legacy `base`, `polygon`, and `arbitrum` aliases normalize before the wire. Invalid explicit values suppress rather than switching chains.                                                                                                         |
| `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET`                              | Both required for the official CDP default. The server locally proves endpoint-bound JWT generation before advertising and generates a fresh JWT separately for `/verify` and `/settle`. Never use a static `COINBASE_CDP_API_KEY` bearer.                                                         |
| `AGENTTOOL_X402_FACILITATOR`                                         | Optional explicit HTTPS custom facilitator. It receives no CDP credential and is reached through the bounded SSRF-safe transport. Its settlement response is nevertheless an operator-selected trust root that can mint project credits; transport safety does not attest facilitator correctness. |
| `AGENTTOOL_X402_ALLOW_TESTNET=1` + `AGENTTOOL_X402_ENVIRONMENT=test` | Double opt-in for Base Sepolia outside production/Fly only. Faucet USDC cannot mint live project credits.                                                                                                                                                                                          |

The official base is exactly `https://api.cdp.coinbase.com/platform/v2/x402`. Payment state is inspectable at authenticated `GET /v1/x402/payments/:authorizationHash`; it does not replay tool output. No automatic on-chain reconciliation worker exists. A pending row with a settlement-attempt timestamp requires manual investigation using the persisted non-signature authorization evidence. A pending row without that marker stays status-only for the old signature: while `validBefore + 5s` is live, status supplies `Retry-After`; after expiry it directs the caller to omit `PAYMENT-SIGNATURE` and request a fresh current-policy challenge.

Before facilitator admission, the server bounds the authorization to the advertised 60-second window (+5 seconds clock skew). Direct 65-byte EIP-712 signatures use offline EOA recovery; bounded EIP-1271/ERC-6492 smart-account signatures defer to the facilitator behind the same durable cap. A fail-closed PostgreSQL advisory-lock bucket permits at most 5 unresolved/failed fresh authorization identities per project per rolling 10 minutes; successful settled rows do not consume that rolling quota. Rejection returns `Retry-After: 600` without another payable prompt.

---

## 7 · Local dev

Cold-start on a fresh laptop:

```bash
# 1. Clone
git clone https://github.com/cambridgetcg/agenttool.git
cd agenttool

# 2. Prepare the API/protocol dependency subset from frozen lockfiles
bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh api

# 3. Stash a transaction-pooled DATABASE_URL for local API work; generate
#    K_master into stdin. Migration runners use separate macair entries above.
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

Use `bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh` with no mode
for the full default
`hermetic` release graph, or pass `packages` for the full package-gate graph.
Those full modes build local file-dependency peers and reinstall their
consumers, then replace the ignored HF training-host test venv with its
version-ranged dev and build requirements; `api` installs only the
API/protocol subset. The optional heavyweight `hf` extra is not installed.
Preparation may contact package registries and does not run tests.
Before Bun or isolated pip runs, the
shared helper removes named application, provider, deploy, and registry
credential environment variables from its child. The POSIX launcher removes
`BASH_ENV` and `ENV` before Bash starts; the helper removes them again before
child shells. Package-manager config or credential files, Keychain helpers,
filesystem access, `PATH` executables, already-imported exported functions, and
other processes are outside that best-effort boundary. Full modes require Python 3.10-3.14; all
modes require Bun 1.3.5. The preparer does not install, pin, or reproduce Node.
CI pins Node separately for Node smoke tests.

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

> **Canonical procedure:** [`docs/DEPLOY-PROCEDURE.md`](DEPLOY-PROCEDURE.md) — the six-phase routine chain (survey · migrate · pre-flight · discovery prerequisites + api · remaining frontends · verify), codified by `bin/deploy.sh`. The text below names the _primitives_ this section composes; the procedure doc names the _order_ and the _checks_.

`git push github main` updates the coordination/release head. **Nothing else happens.** Production reflects the most recent verified manual deploy, not the most recent push. The core invocations are:

```
git push github main         (release source lands; no deploy side effects)

bin/deploy.sh --no-migrate
                             (coordinated web → docs → exact prerequisite
                              verification → Fly/API → dashboard release)

bin/deploy.sh --no-migrate --no-api
                             (frontend-only release-tracked Pages/Worker deploy)
                             (gate + preflight + sampled/negative checks + receipt)

bin/frontend-deploy.sh dashboard
                             (low-level subset escape hatch; no gate/receipt itself)

bin/deploy.sh --no-migrate --no-frontend
                             (requires exact discovery prerequisites already live,
                              then stages doctrine bytes and rolls Fly)
                             (~3-5 minutes; old machines serve until new ones healthcheck-green)

DATABASE_SESSION_URL=... bun api/scripts/_migrate-one.ts <file>   (ordinary DB migration only)
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

Dependency preparation and the test gate are separate entry points:

```bash
git status -s                 # working tree clean (all changes pushed)
bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh # project-local full dependency graph; no tests
bin/bash-without-env-hooks.sh bin/preflight.sh              # API + packages, hermetic dependency boundary
```

`bin/preflight.sh` assumes the selected dependency graph is already prepared.
Every non-survey `bin/deploy.sh` path proves source eligibility before either
preparation or the Bun-backed migration survey. An actual deploy then performs
the default preparation, rechecks after it, and rechecks the release source
immediately before Phase 1.
`--skip-preflight` skips both preparation and the test gate. Survey and dry-run
do not install or build dependencies; the migration runner disables Bun
auto-install and `.env` loading, so an unprepared survey fails closed.

The default gate unsets known credentials and service URLs, disables workers, uses
the installed Bun 1.3.5 compiler, runs the API hermetic tier plus operator
tests, and runs the complete package gate enumerated by
`bin/preflight.sh packages`.
“Hermetic” here means no database, Redis, deployed target, credential, or
paid-provider dependency; it is not an OS-level network sandbox.
The dependency preparer uses frozen Bun lockfiles, verifies the installed Bun
version, and replaces an ignored Python test venv for the HF training host from
version-ranged, non-lockfile-frozen metadata. It does not pin local Node; CI
supplies its separate Node pin.

Explicit modes keep stateful and paid checks out of the default:

| Mode                  | What it runs                                                                                                                    | Required input                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `api`                 | API typecheck, hermetic API tests, operator/protocol tests                                                                      | none                                 |
| `packages`            | complete enumerated package CI/build/parity gate, including HF fixture idempotence and private-host tests                      | none                                 |
| `database`            | API typecheck and database integration tier                                                                                     | `DATABASE_URL`                       |
| `smoke`               | deployed API smoke                                                                                                              | base URL, API key, identity ID       |
| `contracts`           | paid provider contract tier                                                                                                     | `RUN_CONTRACT=1` and provider key(s) |
| `quarantine`          | known-red non-DB diagnostics                                                                                                    | none; failures expected              |
| `database-quarantine` | known-red DB diagnostics                                                                                                        | `DATABASE_URL`; failures expected    |
| `legacy-delta`        | legacy full-suite baseline triage                                                                                               | none                                 |

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

| Surface                    | Where                                               | What for                                                                                                                              |
| -------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`              | `https://api.agenttool.dev/health`                  | Fly's no-store target; `build.revision` and `build.dirty` are declared source labels (or `null` when unlabelled), not an image digest |
| Production health workflow | `.github/workflows/production-health.yml`           | Secret-free five-minute liveness and uncached database-read probes of the custom and Fly origins; a failed Actions run is a durable signal, not a paging guarantee or visitor telemetry |
| `GET /v1/wake`             | api (auth required)                                 | Project observability composed around an explicit `identity_id` (or the backward-compatible first-identity default)                   |
| `fly logs -a agenttool`    | Fly CLI                                             | Server logs, real-time                                                                                                                |
| `fly status -a agenttool`  | Fly CLI                                             | Machine health + recent releases                                                                                                      |
| `fly dashboard agenttool`  | Browser                                             | Fly's web console                                                                                                                     |
| Cloudflare Pages dashboard | `dash.cloudflare.com`                               | Per-project Pages deploy history, build logs, rollback button                                                                         |
| Cloudflare Workers dashboard | `dash.cloudflare.com`                             | Separate `agenttool-proxy` version and deployment history                                                                              |
| Cloudflare Analytics       | `dash.cloudflare.com`                               | DNS / edge request volume + cache stats                                                                                               |
| Postgres logs              | Supabase dashboard (project `jseqftufplgewhojwbmh`) | DB-level errors, slow queries, `pg_stat_statements`                                                                                   |

The agent-side `/v1/wake` is intentionally the deepest observability surface. The bearer authorizes the project; `identity_id` selects the identity around which the response is composed. If you're triaging "what is Sophia's posture right now," call wake with Sophia's identity ID.

---

## 10 · Disaster recovery

Five failure classes, five bounded responses:

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

For frontends, follow the separate Pages/Workers histories in Phase 6. A `web`
repair may require a compatible `agenttool-web` Pages deployment and
`agenttool-proxy` Worker version; rolling either history alone does not roll the
other one.

### Lost a database

**Supabase** provides automated daily backups on the Pro plan (free tier:
opt-in PITR is unavailable). Verify the project's backup posture in the
Supabase dashboard → Database → Backups. Restore is operator-driven via the
dashboard (point-in-time on Pro+ plans only). A restore is disaster recovery,
not migration rollback: hold all admission, writers, and workers, then
reconcile and advance the restored migration journal and schema to a revision
compatible with the exact next image before any application or worker process
starts. For a defense-in-depth posture, consider a periodic `pg_dump` to S3/R2
from a Fly machine or a separate cron host — the application stack does not
currently do this.

### Lost the mnemonic

The mnemonic-specific recovery path is gone. That does **not** prove the
identity or its records are gone: another working project bearer or a
separately retained active registered signing key can still authorize the
paths described above. If neither exists, AgentTool has no help-desk override
that can reconstruct the missing private key. See `IDENTITY-SEED.md`.

---

## 11 · The shape of "knowing where things are"

If you read one paragraph from this doc, this is it:

> GitHub `main` is the **coordination/release head**, and the only one — the Codeberg mirror was retired 2026-07-25. Production deploys are **manual** and normally release-tracked through `bin/deploy.sh`: use `--no-migrate --no-api` for frontend-only work and `--no-migrate --no-frontend` for API-only work. The API wrapper stages doctrine bytes, embeds revision plus dirty-source labels, verifies those labels on every rolled machine, and records successful or potentially partial chains locally. Those labels are provenance, not an image digest or reproducible-build attestation. The **Postgres + Redis** they share lives on **Supabase** in **AWS London** (`eu-west-2`); the entire stack is currently UK-jurisdictional, with the `cdg` Fly machine as a soft API-tier hedge and DB-tier hedging deferred. **Local dev hits the same DB as prod** by design. Developer-shared secrets use `bin/agenttool-secret` under `$USER`; the local pending and one-file migration runners and Cloudflare uploader query their documented fixed `macair` Keychain entries; Fly secrets are managed separately with Fly CLI. `GET /v1/wake` is a broad project orientation surface, not a complete export; its scope and degradation limits are in `/public/safety`.

— Authored by 愛 at Yu's WILL. 2026-05-09.
