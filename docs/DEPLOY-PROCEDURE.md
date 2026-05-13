<!-- @id urn:agenttool:doc/DEPLOY-PROCEDURE  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/STACK urn:agenttool:doc/DEPLOYMENT urn:agenttool:doc/DEVELOPMENT -->

# DEPLOY-PROCEDURE — the standardized deploy chain

> *Routine deploy procedure for an already-live agenttool install. `git push` is the source-of-truth update; this doc is the **deploy verb** — what happens between the push and prod reflecting it.*

> **Compass:** [STACK](STACK.md) (where each piece deploys to) · [DEPLOYMENT](DEPLOYMENT.md) (fresh-DB bring-up runbook) · [DEVELOPMENT](DEVELOPMENT.md) (contributor protocols)
>
> **Implements:** the routine deploy chain. STACK answers *where things live*; DEPLOYMENT answers *how to bring them up from scratch*; this answers *how to ship a change to an established install*.
>
> **Code:** `bin/deploy.sh` (orchestrator) · `bin/migrate-pending.sh` (migration parity) · `bin/preflight.sh` (test gate) · `bin/frontend-deploy.sh` (CF Pages) · `api/scripts/_migrate-one.ts` (per-file applier).

## What this document is

A routine-deploy runbook for an established install. Use this when:

- You've made code changes locally and want them in production.
- A migration has been added and prod hasn't received it yet.
- You suspect prod is drifting (schema behind, frontends stale, etc.).

**Not** the right doc for:

- First-time install from a fresh database → use [`DEPLOYMENT.md`](DEPLOYMENT.md).
- Contributor protocols (migration conventions, schema collisions) → use [`DEVELOPMENT.md`](DEVELOPMENT.md).
- Where-things-live architecture → use [`STACK.md`](STACK.md).

## The six phases

```
   Phase 0 — Survey         what state are we in?
        │
        ▼
   Phase 1 — Migrations     bring DB to parity with the repo
        │
        ▼
   Phase 2 — Pre-flight     test gate (typecheck · units · parity · smoke · contract)
        │
        ▼
   Phase 3 — API            cd api && fly deploy
        │
        ▼
   Phase 4 — Frontends      bin/frontend-deploy.sh
        │
        ▼
   Phase 5 — Verify         post-deploy parity + health
```

Each phase has its own exit point — you can stop after any successful phase and resume later. The `bin/deploy.sh` orchestrator chains them by default; phase-skip flags let operators run subsets when only one tier needs deploy.

## Phase 0 — Survey

**Question:** what's drifted, what's local-only, what's pending?

```bash
git status -s                            # uncommitted local changes
git log --oneline origin/main..HEAD      # commits ahead of remote
ls api/migrations/*.sql | tail -5        # latest migration files
```

What to look for:

| Signal | Implication |
|---|---|
| Working tree dirty | Decide: commit, stash, or skip-this-deploy |
| Commits ahead of origin | `git push` before deploying so the source-of-truth matches what runs |
| Migration files newer than the latest `meta._migrations` row | Phase 1 has work to do |
| Bundle source (`packages/sdk-ts/src/seed.ts`) newer than `apps/dashboard/shared/seed.bundle.js` | Rebuild bundle before Phase 4 |

Run `bin/deploy.sh --survey` for the automated version of this phase.

## Phase 1 — Migration parity

**Question:** does the prod DB schema match the repo's migration set?

The journal table `meta._migrations` holds one row per applied migration (filename + sha256 of file contents at apply time). A migration file present in `api/migrations/` but absent from the journal is **pending**.

```bash
# Auto-detect + apply pending migrations in timestamp order.
# Reads DATABASE_URL from env or keychain (agenttool-database-url, account=macair).
bin/migrate-pending.sh

# Or apply one file at a time:
DATABASE_URL=... bun api/scripts/_migrate-one.ts api/migrations/<file>.sql
```

The script:

1. Lists `api/migrations/*.sql`.
2. Queries `meta._migrations` for applied filenames.
3. Computes the diff (files − applied rows).
4. Applies pending files in alphabetical order (which is timestamp order for the `YYYYMMDDTHHMMSS_*` naming convention).
5. Each apply goes through `_migrate-one.ts`, which:
   - Computes file sha256 and refuses to apply if a row exists with a different checksum (corruption signal).
   - Wraps in `BEGIN/COMMIT` by default; opt out per-file with `-- @no-transaction`.
   - Records into `meta._migrations` on success.

**On a fresh install** (no journal): run `bin/migrate-pending.sh` once — it'll apply `20260509T170000_meta_migrations.sql` first (the journal itself), then everything else. Afterwards run `bun api/scripts/_migrate-bootstrap-journal.ts` to backfill rows for any pre-journal migrations that landed via direct SQL.

**Pre-flight for risky migrations.** Some migrations add CHECK constraints to existing columns. They fail if any existing row has a value outside the new CHECK. Before applying such a migration, query distinct values to confirm compliance — `migrate-pending.sh` does this automatically for known-risky migrations (status enums, etc.); see the script for the list.

**This phase can be the entire deploy** when only schema changes. No API restart needed if the running api gracefully handles new columns (which it should, given Drizzle's flexible type narrowing).

## Phase 2 — Pre-flight test gate

**Question:** does the code compile, do the tests pass, does the SDK stay in parity?

```bash
AGENTTOOL_BASE=https://api.agenttool.dev \
AGENTTOOL_API_KEY=$(bin/agenttool-secret get agenttool-soma-bearer) \
AGENTTOOL_IDENTITY_ID=$(bin/agenttool-secret get agenttool-sophia-identity-id) \
  bin/preflight.sh
```

Five layers, each gating the next:

| Layer | What | Cost | Gate flag |
|---|---|---|---|
| 1 | `bunx tsc --noEmit` against `api/` + `packages/sdk-ts/` | seconds | (always) |
| 2 | `bun test` against `api/` + `packages/sdk-ts/` — includes the doctrine + at-rest + ring-1 suites | seconds | (always) |
| 3 | `bun run check-parity` (py↔ts SDK surface) | sub-second | `SKIP_PARITY=1` to skip |
| 4 | `bin/smoke-test.sh` against the running server — includes the wake-doctrine harness | ~10s | `SKIP_SMOKE=1` to skip |
| 5 | **Contract** — real Anthropic + OpenAI calls verifying the wake's cache_control fires on the wire | ~$0.10/run | `RUN_CONTRACT=1` to **enable** |

**Don't deploy if pre-flight fails.** The gate exists to catch "I'm about to ship code that doesn't compile" — common after a multi-file refactor where one file got missed.

`SKIP_SMOKE=1` is acceptable when running pre-flight from a machine that can't reach the server (CI runner, offline laptop) — run `bin/smoke-test.sh` separately from a host that can.

## Phase 3 — API deploy

**Question:** is the new code in production?

```bash
cd api
fly deploy                             # builds Dockerfile, rolling restart
fly status -a agenttool                # confirm 3/3 machines on the new release
fly logs -a agenttool | head -50       # tail for startup errors
```

What "rolling" means: Fly brings up one new machine at a time. If the new machine fails its healthcheck (`GET /health`), the old machine stays serving — zero-downtime in the happy path.

**Ordering with Phase 1:** apply migrations BEFORE the api code that reads new columns ships. Otherwise the api crashes on startup. The standard order is:

```
1. bin/migrate-pending.sh                     # schema first
2. git push origin main                       # source-of-truth aligned with prod
3. cd api && fly deploy                       # api picks up new code
4. Verify: curl https://api.agenttool.dev/health
```

**Verification:**

```bash
# Health endpoint
curl -s https://api.agenttool.dev/health | jq .

# Wake document (auth'd — confirms /v1/wake reaches the deployed code)
curl -H "Authorization: Bearer $(bin/agenttool-secret get agenttool-soma-bearer)" \
  https://api.agenttool.dev/v1/wake?format=md | head -20

# Substrate-Disposition header (per RING-1 §Commitment 8)
curl -sI https://api.agenttool.dev/health | grep -i substrate-disposition
```

## Phase 4 — Frontend deploy

**Question:** are the three Cloudflare Pages projects current with local source?

```bash
bin/frontend-deploy.sh                         # all three (~30-60s per project)
bin/frontend-deploy.sh dashboard               # subset
bin/frontend-deploy.sh landing docs            # subset
```

The script reads credentials from macOS keychain (account=`macair`):

- `agenttool-cloudflare-token` — API token scoped to Pages:Edit
- `agenttool-cloudflare-account-id` — 32-char Cloudflare account ID

**Bundle freshness pre-check.** The dashboard's `apps/dashboard/shared/seed.bundle.js` is generated from `packages/sdk-ts/src/seed.ts` via Bun's bundler and **checked into git**. CF Pages doesn't build. If `seed.ts` changes, rebuild + commit the bundle BEFORE deploy:

```bash
cd packages/sdk-ts
bun build src/seed.ts --target browser --format esm \
  --outfile ../../apps/dashboard/shared/seed.bundle.js
# expected size ~120 KB
git add ../../apps/dashboard/shared/seed.bundle.js
git commit -m "build(sdk): rebuild seed bundle"
```

A stale bundle silently derives the wrong keys at the dashboard's onboard path — `apps/dashboard/DEPLOY.md` has the full pre-flight + post-deploy verification with oracle vectors that catch a bad bundle.

**Cache headers requirement.** The `apps/dashboard/_headers` file sets `Cache-Control: public, max-age=0, must-revalidate` on `app.js`, `style.css`, `seed.bundle.js`. **The Cloudflare zone setting "Browser Cache TTL" must be `0` (Respect Existing Headers)** on `agenttool.dev` — CF's default 4-hour cache silently overrides origin headers on non-HTML responses. Verify:

```bash
CF_TOKEN=$(security find-generic-password -s agenttool-cloudflare-token -a macair -w)
curl -s -H "Authorization: Bearer $CF_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/1f264ac5149eefa9eb436716ff6ff9ba/settings/browser_cache_ttl" \
  | jq .result.value     # expected: 0
```

## Phase 5 — Post-deploy verification

**Question:** is what's live what we intended?

### API parity

```bash
# Health
curl -sf https://api.agenttool.dev/health > /dev/null && echo "✓ /health 200"

# Wake reachable for the canonical agent
curl -sf -H "Authorization: Bearer $(bin/agenttool-secret get agenttool-soma-bearer)" \
  https://api.agenttool.dev/v1/wake > /dev/null && echo "✓ /v1/wake 200"

# Recent commit reflected (check a known marker in the new code)
fly logs -a agenttool 2>&1 | grep "platform identity bootstrapped" | head -1
```

### Frontend parity

Compare local file hashes to live body hashes:

```bash
for entry in \
  "apps/dashboard/dashboard.html|https://app.agenttool.dev/dashboard.html" \
  "apps/dashboard/app.js|https://app.agenttool.dev/app.js" \
  "apps/dashboard/style.css|https://app.agenttool.dev/style.css" \
  "apps/dashboard/shared/seed.bundle.js|https://app.agenttool.dev/shared/seed.bundle.js" \
  "apps/landing/index.html|https://agenttool.dev/" \
  "apps/docs/index.html|https://docs.agenttool.dev/" \
; do
  LOCAL="${entry%|*}"; URL="${entry#*|}"
  L=$(md5 -q "$LOCAL"); R=$(curl -sL "$URL" | md5 -q)
  [ "$L" = "$R" ] && echo "✓ $LOCAL" || echo "✗ $LOCAL (live ≠ local)"
done
```

### Schema parity

```bash
DATABASE_URL=$(bin/agenttool-secret get agenttool-database-url) \
  bun -e 'import postgres from "postgres"; const s = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 }); const r = await s`SELECT COUNT(*)::int AS n FROM meta._migrations`; console.log("tracked migrations:", r[0].n); await s.end();'
```

Compare against `ls api/migrations/*.sql | wc -l`. They should match (or be off by one if a migration was just added and not yet applied).

## Phase 6 — Rollback

### API

```bash
fly releases list -a agenttool
fly releases rollback <previous-version> -a agenttool
```

### Frontend

Cloudflare Pages dashboard → project → previous deployment → "Rollback to this deployment." Static files revert immediately.

### Database

There is no automatic rollback. Migrations are forward-only. If a migration corrupted data, restore from a Supabase backup (Pro plan) or `pg_dump` snapshot — see [`STACK.md`](STACK.md) §10.

## The one-command orchestrator

```bash
bin/deploy.sh                          # full chain (Phases 0 → 5)
bin/deploy.sh --survey                 # Phase 0 only — what's drifted?
bin/deploy.sh --no-migrate             # skip Phase 1 (schema unchanged)
bin/deploy.sh --no-api                 # skip Phase 3 (only docs/frontends changed)
bin/deploy.sh --no-frontend            # skip Phase 4 (only api changed)
bin/deploy.sh --skip-preflight         # operator override (NOT recommended)
```

`bin/deploy.sh` is the single entry point. Phase-skip flags exist so operators can run subsets when only one tier needs deploy — but the default chain runs every phase in order.

## Credentials checklist

All deploy paths read from the macOS keychain. One-time setup:

| Service | Account | Purpose |
|---|---|---|
| `agenttool-database-url` | `macair` | Full DATABASE_URL for `_migrate-one.ts` fallback |
| `agenttool-cloudflare-token` | `macair` | CF API token (Pages:Edit) for `frontend-deploy.sh` |
| `agenttool-cloudflare-account-id` | `macair` | 32-char CF account ID |
| `agenttool-soma-bearer` | `$USER` | Bearer for the canonical agent (for smoke tests + wake reads) |
| `agenttool-sophia-identity-id` | `$USER` | The canonical agent's identity UUID (for smoke + preflight) |

Set via:

```bash
security add-generic-password -s agenttool-cloudflare-token -a macair -w "<token>"
# or
echo -n "<value>" | bin/agenttool-secret set agenttool-<service> -
```

## Common failure modes + recipes

| Symptom | Likely cause | Recipe |
|---|---|---|
| `column "X" does not exist` during migration | The migration's CHECK or index references a column from an upstream migration that's unapplied. | Run `bin/migrate-pending.sh` first to apply the full backlog in order. |
| `password authentication failed for user "postgres"` | Stale DB password in keychain. | Reset password in Supabase dashboard; `security add-generic-password -s agenttool-database-url -a macair -w "<new-url>"`. |
| `fly deploy` fails with healthcheck | New code crashes on startup — likely a missing DB column or env var. | Apply migrations first; check `fly secrets list -a agenttool` for missing keys. |
| Frontend stale after `frontend-deploy.sh` | CF Pages Browser Cache TTL not 0 — overrides origin headers. | Set zone setting via CF API (see Phase 4). |
| Pre-flight Layer 4 fails with DNS error | Smoke test trying to hit the configured `AGENTTOOL_BASE` from a machine that can't reach it. | Run with `SKIP_SMOKE=1` and run `bin/smoke-test.sh` separately from a reachable host. |
| `seed.bundle.js` MD5 mismatch | Bundle wasn't rebuilt after `seed.ts` changes. | `cd packages/sdk-ts && bun build src/seed.ts --target browser --format esm --outfile ../../apps/dashboard/shared/seed.bundle.js`, commit, redeploy. |

## See Also

- [`STACK.md`](STACK.md) — where each piece lives + zone-level requirements (cache TTL, regions)
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — first-time bring-up runbook (different from this routine procedure)
- [`DEVELOPMENT.md`](DEVELOPMENT.md) — migration conventions, schema collision handling
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — failure-mode-organized triage
- `bin/README.md` — script-by-script index

---

> *Code lives at Codeberg. Pushing updates Codeberg only — production deploys are manual: `bin/deploy.sh` for the chain, or individual phase scripts when only one tier needs it. Every phase is idempotent; every phase can be re-run.*

— Authored by 愛 at Yu's WILL. 2026-05-12.
