<!-- @id urn:agenttool:doc/DEPLOY-PROCEDURE  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/STACK urn:agenttool:doc/DEPLOYMENT urn:agenttool:doc/DEVELOPMENT -->

# DEPLOY-PROCEDURE — the standardized deploy chain

> *Routine deploy procedure for an already-live agenttool install. GitHub `main` is the coordination/release head; this doc is the **deploy verb** — how one source revision becomes declared and checked across production.*

> **Compass:** [STACK](STACK.md) (where each piece deploys to) · [DEPLOYMENT](DEPLOYMENT.md) (fresh-DB bring-up runbook) · [DEVELOPMENT](DEVELOPMENT.md) (contributor protocols)
>
> **Implements:** the routine deploy chain. STACK answers *where things live*; DEPLOYMENT answers *how to bring them up from scratch*; this answers *how to ship a change to an established install*.
>
> **Code:** `bin/deploy.sh` (orchestrator + release provenance) · `api/Dockerfile` (pinned runtime + embedded source labels) · `api/src/index.ts` (`/health.build`) · `bin/migrate-pending.sh` (migration parity) · `bin/preflight.sh` (test gate) · `bin/frontend-deploy.sh` (low-level CF Pages uploader) · `api/scripts/_migrate-one.ts` (per-file applier).
>
> **Tests:** `api/tests/deploy-release-provenance.test.ts`.

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
   Phase 2 — Pre-flight     hermetic API + package gate
        │
        ▼
   Phase 3 — API            bin/deploy.sh stages docs, then invokes Fly internally
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
git status --short                       # tracked, staged, and untracked changes
git fetch github +refs/heads/main:refs/remotes/github/main  # refresh release head
git rev-parse HEAD github/main           # normal deploy requires equality
git rev-list --left-right --count origin/main...github/main  # mirror lag/divergence only
ls api/migrations/*.sql | tail -5        # latest migration files
```

What to look for:

| Signal | Implication |
|---|---|
| Working tree dirty | Normal production deploy stops; commit/stash it, or use the loud `--allow-dirty-release` override deliberately |
| `HEAD != github/main` after fetch | Normal production deploy stops; land/checkout the release commit, or use `--allow-non-release-head` deliberately |
| Codeberg behind GitHub | Production is unaffected; optionally run the explicit fast-forward-only mirror command |
| Codeberg has commits absent from GitHub | Do not mirror automatically; reconcile the histories explicitly |
| Migration files newer than the latest `meta._migrations` row | Phase 1 has work to do |

Run `bin/deploy.sh --survey` for the automated version of this phase.

The production gate turns that successful fetch into an invocation-start
snapshot. It requires a clean worktree including untracked files and exact
`HEAD == snapshot` before mutations begin. The snapshot remains fixed through
the chain; a concurrent GitHub update belongs to the next invocation rather
than moving the target under an active rollout.

The two source override flags are independent and print red, explicit warnings.
A dirty API release embeds `build.dirty=true`, exposes it through `/health`,
and verifies it on every machine. This makes the revision's incompleteness
explicit; it does not identify the extra bytes or make the build reproducible.
If the migration dry-run itself fails, the survey reports parity as unknown
instead of treating missing output as “0 pending.”

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

On a machine that deliberately has no local database credential, apply one
reviewed migration through an existing Fly machine instead:

```bash
bin/fly-migrate-one.sh api/migrations/<file>.sql
```

This bounded path sends the migration text and checksum over Fly SSH, executes
with the app's existing `DATABASE_URL`, and records `meta._migrations`. The
database URL never returns to the local machine. It is one-file-at-a-time by
design; inspect the file and the pending set before each call, then deploy with
`--no-migrate`.

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

**Question:** does the deterministic, application/service-credential-free
release gate pass?

```bash
bin/preflight.sh
```

The default `hermetic` mode unsets known credentials and service URLs,
disables workers, requires Bun 1.3.5, and runs the API typecheck, classified
hermetic API tests, operator/protocol tests, and CI gates for `packages/data`,
`packages/data-protocol`, and the TypeScript SDK. “Hermetic” describes those
external dependencies; it is not an OS-level network sandbox.

Stateful and paid work is opt-in by mode:

| Mode | Scope | Required input |
|---|---|---|
| `api` | API typecheck, hermetic API tier, operator/protocol tests | none |
| `packages` | data reference node, ADDS package, TypeScript SDK CI/parity | none |
| `database` | API typecheck plus database integration tier | `DATABASE_URL` |
| `smoke` | deployed API smoke | `AGENTTOOL_BASE`, API key, identity ID |
| `contracts` | paid provider contract tier | `RUN_CONTRACT=1` and provider key(s) |
| `quarantine` | known-red non-DB diagnostics | none; failures expected |
| `database-quarantine` | known-red DB diagnostics | `DATABASE_URL`; failures expected |
| `legacy-delta` | legacy full-suite baseline triage | none |

Run `bin/preflight.sh list` to inspect tier classification. Smoke and contracts
are separate invocations selected by mode. Do not deploy if the default gate
fails.

## Phase 3 — API deploy

**Question:** is the new code in production?

```bash
bin/deploy.sh --no-migrate --no-frontend  # stages required bundles, then rolling deploy
fly status -a agenttool                   # confirm every machine is on the new release
fly logs -a agenttool | head -50       # tail for startup errors
```

Do not run bare `cd api && fly deploy` from this repo. The Docker build needs
the canon and Kingdom bundles that `bin/deploy.sh` stages into the API build
context. The wrapper removes staging immediately after `fly deploy` returns;
its `EXIT`/`INT`/`TERM` trap also removes staging if the command is interrupted.

The default safety posture leaves `AGENTTOOL_ENABLE_UNSAFE_EXECUTE` and
`AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS` unset. Setting either variable accepts
an explicitly documented unsafe boundary; it does not harden the route. Verify
their absence before a normal production release.

What "rolling" means: Fly brings up one new machine at a time. If the new machine fails its healthcheck (`GET /health`), the old machine stays serving — zero-downtime in the happy path.

**Ordering with Phase 1:** apply migrations BEFORE the api code that reads new columns ships. Otherwise the api crashes on startup. The standard order is:

```
1. bin/migrate-pending.sh                     # schema first
2. git push github main                       # release head aligned with prod
3. bin/deploy.sh --no-migrate --no-frontend  # stages bundles + deploys api
4. Verify: curl https://api.agenttool.dev/health | jq .build.revision
```

**Verification:**

```bash
# Health endpoint
curl -s https://api.agenttool.dev/health | jq .

# Authenticated smoke (credentials exist only in this child environment)
AGENTTOOL_BASE=https://api.agenttool.dev \
AGENTTOOL_API_KEY="$(bin/agenttool-secret get agenttool-soma-bearer)" \
AGENTTOOL_IDENTITY_ID="$(bin/agenttool-secret get agenttool-sophia-identity-id)" \
  bin/preflight.sh smoke

# Substrate-Disposition header (per RING-1 §Commitment 8)
curl -sI https://api.agenttool.dev/health | grep -i substrate-disposition
```

`bin/deploy.sh` passes the gated commit and source-dirty boolean as
`AGENTTOOL_GIT_REVISION` and `AGENTTOOL_SOURCE_DIRTY`. The Dockerfile carries
them as environment/OCI labels; `/health` returns them as `build.revision` and
`build.dirty` with `Cache-Control: no-store`. After Fly's rolling health checks
complete, the wrapper compares both public values and both embedded values on
every current Fly machine. A mismatch fails the deploy invocation.

The base image is pinned to Bun 1.3.5 by tag and registry digest. Update the
tag and digest together, deliberately, after the hermetic gate passes. Label
agreement and the base pin improve provenance; they do not prove byte-identical
images or a reproducible build, because dependencies and other builder inputs
still shape image bytes. A true dirty marker also says explicitly that the
commit does not identify every source byte.

## Phase 4 — Frontend deploy

**Question:** are the three Cloudflare Pages projects current with the release
commit?

```bash
bin/deploy.sh --no-migrate --no-api            # normal tracked release, all three

# Low-level subset escape hatch (no source gate, verification, or receipt itself)
bin/frontend-deploy.sh dashboard
bin/frontend-deploy.sh web docs
```

The low-level uploader captures the current commit hash once, then archives
that exact Git object into a temporary tree before invoking Wrangler. Ambient
dirty and ignored files are excluded, and a tracked `.env` file is a hard
refusal. Use the orchestrator for normal production releases so the GitHub
snapshot gate, preflight, sampled parity and sensitive-path checks, and receipt
surround that upload.

The script reads credentials from macOS keychain (account=`macair`):

- `agenttool-cloudflare-token` — API token scoped to Pages:Edit
- `agenttool-cloudflare-account-id` — 32-char Cloudflare account ID

**Cache headers requirement.** The `apps/dashboard/_headers` file sets `Cache-Control: public, max-age=0, must-revalidate` on `style.css`. **The Cloudflare zone setting "Browser Cache TTL" must be `0` (Respect Existing Headers)** on `agenttool.dev` — CF's default 4-hour cache silently overrides origin headers on non-HTML responses. Verify:

Verify in Cloudflare Dashboard → `agenttool.dev` → Caching → Configuration:
Browser Cache TTL must read **Respect Existing Headers**. This avoids placing a
Cloudflare credential in a shell command or process argument.

## Phase 5 — Post-deploy verification

**Question:** is what's live what we intended?

### API parity

```bash
# Health
curl -sf https://api.agenttool.dev/health > /dev/null && echo "✓ /health 200"

# Authenticated wake and doctrine checks
AGENTTOOL_BASE=https://api.agenttool.dev \
AGENTTOOL_API_KEY="$(bin/agenttool-secret get agenttool-soma-bearer)" \
AGENTTOOL_IDENTITY_ID="$(bin/agenttool-secret get agenttool-sophia-identity-id)" \
  bin/preflight.sh smoke

# Exact release commit reflected
EXPECTED=$(git rev-parse HEAD)
test "$(curl -fsS https://api.agenttool.dev/health | jq -r .build.revision)" = "$EXPECTED"
test "$(curl -fsS https://api.agenttool.dev/health | jq -r .build.dirty)" = false
```

### Sampled frontend parity

Compare local file hashes to live body hashes:

```bash
for entry in \
  "apps/dashboard/index.html|https://app.agenttool.dev/" \
  "apps/dashboard/watch.html|https://app.agenttool.dev/watch.html" \
  "apps/dashboard/style.css|https://app.agenttool.dev/style.css" \
  "apps/docs/index.html|https://docs.agenttool.dev/" \
; do
  LOCAL="${entry%|*}"; URL="${entry#*|}"
  L=$(md5 -q "$LOCAL"); R=$(curl -sL "$URL" | md5 -q)
  [ "$L" = "$R" ] && echo "✓ $LOCAL" || echo "✗ $LOCAL (live ≠ local)"
done
```

The orchestrator also probes `.gitignore`, `.env`, and `.env.local` on the
docs, dashboard, and apex hosts. Every probe must return 4xx/5xx. A 2xx or 3xx
is exposure—redirecting a sensitive filename to friendly HTML is not denial—and
prevents a success receipt.

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
bin/deploy.sh --allow-dirty-release    # loud override for a dirty source tree
bin/deploy.sh --allow-non-release-head # loud override for HEAD != github/main
bin/deploy.sh --mirror-codeberg        # standalone FF-only github/main -> Codeberg main
```

`bin/deploy.sh` is the single entry point. Phase-skip flags exist so operators can run subsets when only one tier needs deploy — but the default chain runs every phase in order.

### Local receipt

Every successful non-dry-run chain writes one atomic, mode-0600 JSON receipt.
If a migration, Fly rollout, or Pages upload may have started and the chain
then returns non-zero or receives caught `INT`/`TERM`, the exit trap attempts a
conservative `failed_or_uncertain` receipt instead:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/agenttool/deploy-receipts/<time>-<revision>-<pid>.json
```

The fixed `agenttool-deploy-receipt/v2` object contains `outcome`, completion
time, exit status, declared `source_revision` and dirty bit, the GitHub
release-head snapshot plus observation time, actually used overrides, whether
an external mutation may have started, phase results, and verified API-machine
count. It never copies credentials, credential-bearing URLs, arbitrary
environment variables, or command output. `source_dirty=true` is explicit
evidence that the revision alone does not describe every deployed source byte.
`SIGKILL`, host loss, or an unwritable state directory can prevent a failure
receipt, so absence is never evidence that no external mutation occurred. A
successful chain treats receipt-write failure as an error.

### Codeberg mirror

Codeberg is a secondary copy, not the release head. Run
`bin/deploy.sh --mirror-codeberg` as a standalone explicit publication action.
The command fetches both remotes immediately before comparison, requires
`origin/main` to be an ancestor of `github/main`, and pushes the exact
`refs/remotes/github/main` commit to Codeberg `main` without force. Divergence,
a concurrent Codeberg update, or post-push hash mismatch stops the command.

## Credentials checklist

Credentialed migration and Pages phases resolve service credentials from the
macOS keychain; the default hermetic preflight and local receipt do not.
One-time setup:

| Service | Account | Purpose |
|---|---|---|
| `agenttool-database-url` | `macair` | Full DATABASE_URL for `_migrate-one.ts` fallback |
| `agenttool-cloudflare-token` | `macair` | CF API token (Pages:Edit) for `frontend-deploy.sh` |
| `agenttool-cloudflare-account-id` | `macair` | 32-char CF account ID |
| `agenttool-soma-bearer` | `$USER` | Bearer for the canonical agent (for smoke tests + wake reads) |
| `agenttool-sophia-identity-id` | `$USER` | The canonical agent's identity UUID (for smoke + preflight) |

Set via:

```bash
# `-w` as the final option prompts securely; no value appears in argv/history.
security add-generic-password -U -s agenttool-cloudflare-token -a macair -w
```

## Common failure modes + recipes

| Symptom | Likely cause | Recipe |
|---|---|---|
| `column "X" does not exist` during migration | The migration's CHECK or index references a column from an upstream migration that's unapplied. | Run `bin/migrate-pending.sh` first to apply the full backlog in order. |
| `password authentication failed for user "postgres"` | Stale DB password in keychain. | Reset it in Supabase, then run `security add-generic-password -U -s agenttool-database-url -a macair -w` and enter the URL at the prompt. |
| `fly deploy` fails with healthcheck | New code crashes on startup — likely a missing DB column or env var. | Apply migrations first; check `fly secrets list -a agenttool` for missing keys. |
| Frontend stale after upload | CF Pages Browser Cache TTL not 0 — overrides origin headers. | Set zone setting via CF API (see Phase 4). |
| `bin/preflight.sh smoke` fails with DNS error | Explicit smoke mode cannot reach `AGENTTOOL_BASE`. | Run smoke separately from a host that can reach the configured target; the default hermetic gate does not call it. |

## See Also

- [`STACK.md`](STACK.md) — where each piece lives + zone-level requirements (cache TTL, regions)
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — first-time bring-up runbook (different from this routine procedure)
- [`DEVELOPMENT.md`](DEVELOPMENT.md) — migration conventions, schema collision handling
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — failure-mode-organized triage
- `bin/README.md` — script-by-script index

---

> *GitHub `main` coordinates releases; Codeberg fast-forward-mirrors the same commit when explicitly requested. Production deploys remain manual through `bin/deploy.sh`, and completion means the intended revision and dirty-source marker agree across health and every Fly machine, sensitive frontend paths are denied, and the outcome is written locally. This is provenance agreement, not an image-digest or reproducible-build claim.*

— Authored by 愛 at Yu's WILL. 2026-05-12.
