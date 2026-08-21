<!-- @id urn:agenttool:doc/DEPLOY-PROCEDURE  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/STACK urn:agenttool:doc/DEPLOYMENT urn:agenttool:doc/DEVELOPMENT -->

# DEPLOY-PROCEDURE — the standardized deploy chain

> _Routine deploy procedure for an already-live agenttool install. GitHub `main` is the coordination/release head; this doc is the **deploy verb** — how one source revision becomes declared and checked across production._

> **Compass:** [STACK](STACK.md) (where each piece deploys to) · [DEPLOYMENT](DEPLOYMENT.md) (fresh-DB bring-up runbook) · [DEVELOPMENT](DEVELOPMENT.md) (contributor protocols)
>
> **Implements:** the routine deploy chain. STACK answers _where things live_; DEPLOYMENT answers _how to bring them up from scratch_; this answers _how to ship a change to an established install_.
>
> **Code:** `bin/deploy.sh` (orchestrator + release provenance) · `bin/bash-without-env-hooks.sh` (pre-Bash startup-hook removal) · `bin/prepare-hermetic-deps.sh` (project-local dependency preparation) · `api/Dockerfile` (pinned runtime + embedded source labels) · `api/src/index.ts` (`/health.build`) · `bin/migrate-pending.sh` (repo-file and journal check) · `bin/preflight.sh` (test gate) · `bin/frontend-deploy.sh` (low-level CF Pages + apex Worker uploader) · `infra/apex-door/worker.js` (apex/www route owner) · `api/scripts/_migrate-one.ts` (per-file applier).
>
> **Tests:** `api/tests/deploy-release-provenance.test.ts` · `bin/tests/build-input-hygiene.test.ts` · `api/tests/apex-door-worker.test.ts`.

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
   Phase 1 — Migrations     apply repo files missing from the journal
        │
        ▼
   Phase 2 — Pre-flight     hermetic API + package gate
        │
        ▼
   Phase 3 — Discovery/API  publish web backing + apex Worker, then docs;
                            verify; then Fly
        │
        ▼
   Phase 4 — Frontends      publish the remaining frontend target(s)
        │
        ▼
   Phase 5 — Verify         post-deploy parity + health
```

Each phase has its own exit point — routine work can stop after a successful
phase and resume later. The `bin/deploy.sh` orchestrator chains them by default;
phase-skip flags select subsets when only one tier needs deploy. They do not
bypass the durable refusal created by an unresolved maintenance marker.

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

| Signal                                                  | Implication                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Working tree dirty                                      | Normal production deploy stops; commit/stash it, or use the loud `--allow-dirty-release` override deliberately   |
| `HEAD != github/main` after fetch                       | Normal production deploy stops; land/checkout the release commit, or use `--allow-non-release-head` deliberately |
| A repo migration file is absent from `meta._migrations` | Phase 1 has work to do                                                                                           |

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
If the migration dry-run itself fails, the survey reports migration status as unknown
instead of treating missing output as “0 pending.”

### Dependency preparation before mutation

For an actual deploy with preflight enabled, the wrapper runs
`bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh` after the Git
snapshot/source portion of Phase 0 and before its Bun-backed migration
compatibility survey. The no-argument `hermetic` mode installs the complete Bun
release/preflight graph from frozen lockfiles, builds local file-dependency
peers, reinstalls their consumers, and replaces an ignored project-local venv
for the private HF training host's version-ranged Python dev and build
requirements. Those requirements are not lockfile-frozen. It then reapplies the
release-source gate; without the loud dirty-source override, any tracked or
untracked source drift blocks the deploy before a migration runs.

This step prepares inputs; it does not run the Phase 2 tests. It requires Bun
1.3.5 and Python 3.10-3.14 and may contact package registries, but it
first removes a named set of application, provider, deploy, and registry
credential environment variables from the preparer child. The parent wrapper
retains its environment for later authorized phases. The POSIX launcher removes
`BASH_ENV` and `ENV` before Bash starts, and the shared helper removes them
again before child shells. This is not a universal credential barrier:
package-manager config or credential files, Keychain helpers, filesystem
access, `PATH` executables, already-imported exported functions, and other
processes remain outside the boundary.
Pip runs in isolated mode, but system/global package-manager config remains
outside the stated boundary. The preparer does not install, pin, or reproduce
Node. CI pins Node separately for Node smoke tests. `--survey` and `--dry-run`
do not install or build dependencies. The migration runner disables Bun
auto-install and `.env` loading, so an unprepared survey fails closed instead
of contacting a registry. `--skip-preflight` skips both this preparation step
and the Phase 2 gate; it does not skip the source gate before the database
survey or the final recheck before Phase 1. Only the deliberate `--survey`
inspection mode is source-independent.

## Phase 1 — Repo migration files and journal

**Question:** which repo migration files are absent from the journal, does
every journal row still have exact source in the repo, and do checksums match?

The journal table `meta._migrations` holds one row per applied migration (filename + sha256 of file contents at apply time). A migration file present in `api/migrations/` but absent from the journal is **pending**.

A clean result means exactly: no repo migration files are pending, every
journaled filename has source in the repo, and every journal checksum matches
those source bytes. A journal row whose source is absent is a hard failure.
This does not prove database schema parity: the check does not inspect live
tables, columns, constraints, indexes, policies, or out-of-band DDL.

```bash
# Auto-detect + apply pending migrations in timestamp order.
# Surveys through DATABASE_URL. A real apply additionally requires the
# separately scoped session-pooled DATABASE_SESSION_URL.
bin/migrate-pending.sh

# Or apply one ordinary file at a time:
DATABASE_SESSION_URL=... \
  bun api/scripts/_migrate-one.ts api/migrations/<file>.sql
```

On a machine that deliberately has no local database credential, apply one
reviewed ordinary migration through an existing Fly machine instead:

```bash
bin/fly-migrate-one.sh api/migrations/<file>.sql
```

This bounded path sends the migration text and checksum over Fly SSH, executes
with the app's existing session-pooled `DATABASE_SESSION_URL`, and records
`meta._migrations`. It refuses rather than falling back to the
transaction-pooled `DATABASE_URL`, because that connection cannot preserve the
session advisory lock. The database URL never returns to the local machine. It
is one-file-at-a-time by design; inspect the file and the pending set before
each call, then deploy with `--no-migrate`.

Both one-file helpers refuse every filename in
`api/migrations/quiescence-required.txt`. The local helper refuses before
reading credentials or opening a database connection; the Fly helper refuses
before checksum encoding or any `fly` call. Missing or malformed policy fails
closed. They are ordinary-migration tools, not an exclusive-cutover path.

The pending script:

1. Lists `api/migrations/*.sql` and queries `meta._migrations` through the
   transaction-pooled `DATABASE_URL`.
2. Refuses a journaled filename whose source is absent or whose checksum no
   longer matches, then computes the pending set (files − applied rows).
3. Exits without resolving an apply credential when the inventory is clean,
   the invocation is a dry run, or protected files are pending without the
   required operator assertion.
4. Before a real apply, resolves the separately scoped session-pooled
   `DATABASE_SESSION_URL` and rejects an exact string match with `DATABASE_URL`.
   It then repeats the complete source/journal/checksum inventory through the
   session endpoint and requires the exact same ordered pending filenames. A
   mismatch refuses before the first mutation. Distinct strings and matching
   inventories catch many endpoint mistakes; they do not prove pool type or
   that both URLs identify the same database. The operator remains responsible
   for that binding.
5. Applies pending files in alphabetical order (which is timestamp order for
   the `YYYYMMDDTHHMMSS_*` naming convention), except that a target without the
   migration journal promotes
   `20260509T170000_meta_migrations.sql` to the front so later files can be
   journaled. Each apply goes through `_migrate-one.ts`, which:
   - Computes file sha256 and refuses to apply if a row exists with a different checksum (corruption signal).
   - Holds one PostgreSQL advisory lock for the migration session. It waits at
     most 30 seconds for that lock, at most 10 seconds for each database lock,
     and at most 2 minutes for each later statement. A timeout aborts the file;
     the default transaction rolls back its work. The Fly one-file runner uses
     the same bounds.
   - Wraps in `BEGIN/COMMIT` by default; opt out per-file with `-- @no-transaction`.
   - Records into `meta._migrations` on success.

**On a fresh install** (no journal): first run
`bin/migrate-pending.sh --dry-run` and inspect the full backlog. The current
backlog contains protected files, so a genuinely fresh target with no writers,
workers, or provider callbacks must then use
`bin/migrate-pending.sh --maintenance-quiesced`; established environments use
the fenced cutover below. The runner applies
`20260509T170000_meta_migrations.sql` first, then applies and journals every
other file. Use `bun api/scripts/_migrate-bootstrap-journal.ts` only when
adopting the journal on a database whose older migrations were already applied
through another path.

**Pre-flight for risky migrations.** Some migrations add constraints or rewrite accounting rows. Before applying one, the operator must run its documented read-only precondition queries against the target database. `migrate-pending.sh` verifies journal checksums and applies pending files in order; it does **not** understand migration-specific data risks or run those precondition queries automatically.

**Exclusive-cutover migrations.** `bin/deploy.sh` refuses before any release
mutation when its survey finds a file listed in
`api/migrations/quiescence-required.txt` pending. That sorted manifest is the
sole policy list; do not copy it into runbooks.

These migrations cross old/new crypto or payout writer semantics.
`bin/migrate-pending.sh` also refuses them with exit `42` unless the operator
supplies `--maintenance-quiesced`. The gate prevents the ordinary orchestrator
from applying them during a rolling deploy. Direct one-file runners also
refuse them, but this is an accidental-bypass guard rather than authentication:
the assertion does not stop another host, deliberately forged process state,
raw SQL, an auto-startable machine, or external provider delivery. API
releases still survey under `--no-migrate`; only a pure frontend-only
invocation stays database-independent.

Use one bounded maintenance cutover:

1. Before the window, align a clean worktree with protected GitHub `main`, run
   the hermetic preflight, build and pin the exact migration-compatible image,
   inspect every pending file, and run its documented read-only preconditions.
   Run `bin/migrate-pending.sh --dry-run`; require exit `42` and the exact
   reviewed pending set.
2. Capture the exact current machine IDs and every material property: process
   group, region, VM shape, image, schedule, restart/autostart behavior,
   standby relationships, ingress, worker flags, host status, and provider
   cordon state. Machine identity is part of the topology. Do **not** use
   `fly scale count ...=0`, destroy, or recreate as a fencing shortcut; those
   operations discard identities and are not rollback.
3. Use a separately reviewed and rehearsed maintenance mechanism to hold
   public/provider admission, fence restart/autostart and schedules, drain
   durable leases plus in-flight provider/payout work, and stop the captured
   machines in place. Preserve the same provider-reported ID set. That is
   continuity evidence, not proof of physical identity, actor identity, or
   uninterrupted exclusion between observations. Time alone, a suspended
   label, or a zero-running count is not drain or writer-exclusion evidence.
4. Before SQL, prove the same exact machine IDs still exist and cannot resume
   old writers; prove admission is held, relevant durable work and database
   leases/locks are empty, and future app processes will start with workers
   disabled. If any proof is unavailable, stop without applying.
5. Exercise the pending runner in this order:

   ```bash
   bin/migrate-pending.sh --dry-run
   bin/migrate-pending.sh --dry-run --maintenance-quiesced
   bin/migrate-pending.sh --maintenance-quiesced
   bin/migrate-pending.sh --dry-run
   ```

   The first two inventories must name the same reviewed files. The apply must
   stop on any checksum, precondition, lock, or statement failure. The final
   inventory must be empty; it proves repository/journal parity, not schema
   semantics or writer exclusion.
   Once any protected SQL commits, the cutover is forward-only: never start or
   restore an old writer image. Keep admission and workers held while fixing
   forward with a migration-compatible image.

6. From the exact clean protected-main revision, invoke the checked rollout
   with all five captured IDs:

   ```bash
   bin/deploy.sh --no-migrate --no-frontend \
     --maintenance-fenced-api \
     --maintenance-app-machines="$APP_LHR_1,$APP_LHR_2,$APP_CDG" \
     --maintenance-thinker-primary="$THINKER_PRIMARY" \
     --maintenance-thinker-standby="$THINKER_STANDBY"
   ```

   The mode requires exact flyctl `v0.4.74` at commit
   `b74c9391409b3e443383a5f4d928cef007825ddc`, an empty migration inventory,
   the normal hermetic preflight, clean `HEAD == github/main`, exact live
   discovery prerequisites, and exactly these five stopped Machines:
   `app` in `lhr×2 + cdg×1` at shared-1x/1024 MB, `thinker` in `lhr×2` at
   shared-1x/256 MB, workers disabled, restart `no` with `max_retries: 10`,
   no schedules or standby
   edge, app autostart disabled, host status `ok`, and a reported boolean
   cordon state which must remain unchanged. It refuses source/preflight
   overrides and does not apply migrations or upload frontends.

   The rollout runs `fly deploy` only as `--build-only --push` with a unique
   tag; it never runs an ordinary Fly deployment or creates a shared release
   inside the fence. A service-less stopped thinker resolves that tag once.
   After the potentially long build/push it first re-proves the unchanged
   fence. The script then reads the first thinker's digest and OCI
   revision/dirty labels from a fresh raw Machine inventory and gives the other
   four Machines the exact `tag@sha256` reference. After every Machine update
   it re-reads the complete unordered fleet and requires the same five reported
   IDs, exact full non-image configuration relative to the captured baseline,
   expected image subset, roles, regions, VM shapes, host/cordon state, fences,
   and worker flag. No app start is permitted until all five share the target
   digest and labels.

   After that fleet-wide image proof, the script restores app restart policy
   while deliberately keeping app autostart false, and restores the two
   thinker restart/standby settings, all with `--skip-start` and a full
   read-back after each update. Pinned flyctl has no restart-retry flag and its
   `--restart` flag would replace the restart object, so every update instead
   merges an exact `--machine-config` restart object: policy `no` or
   `on-failure`, always with `max_retries: 10`. Exact flyctl standby behavior
   is also part of the proof: the standby list and `FLY_STANDBY_FOR` must both
   match. It then starts
   one named app per command, waits and re-inventories the full fleet after
   each provider mutation. Only after all three explicit starts does it enable
   autostart on each already-started app, without `--skip-start`, waits for the
   resulting Machine-version restart, and re-proves the full fleet each time.
   This avoids a proxy-autostart window before the explicit starts. It leaves
   both thinkers stopped, checks `/health`, re-proves the final fleet, and
   silently shell-tests revision, dirty=false, and
   `AGENTTOOL_DISABLE_WORKERS=1` on the started apps, then runs the
   image-resident verifier's bounded read-only `SELECT 1` through both the
   transaction and session URLs. The final receipt counts
   all five image/config-proven Machines separately from the three running SSH
   proofs.

7. Require the v5 success receipt and absence of the active maintenance marker
   before deliberately reopening admission. The success receipt is installed
   and storage-synced before the marker is removed. A receipt/finalization
   failure while the marker remains owned enters fail-closed re-fencing. If
   marker ownership is missing or changed, the script authorizes neither a
   recovery mutation nor a marker overwrite; the observed foreign or absent
   state requires manual inspection. Enabling any reviewed worker is a separate
   operation; this rollout keeps the configured worker fence at `1`.

Before the first image push the script atomically installs this private,
mode-0600 write-ahead record:

```text
$HOME/.local/state/agenttool/deploy-state/maintenance-active.json
```

It advances `attempting_*` before each mutation and `verified_*` only after
read-back. Each file replacement and directory entry is storage-synced. A
handled error, `INT`, or `TERM` advances an owned, writable marker to
`failed_or_uncertain`; `SIGKILL` or host loss leaves at least the most recently
storage-synced write-ahead checkpoint. The private document retains the three
app IDs and distinct thinker-primary/standby roles needed for a forward repair;
public receipts keep only their hash and counts. Raw Fly inventories used for
baseline and recovery comparison remain only in process memory, so an abrupt
process death cannot orphan credential-bearing Machine snapshots. Every later
mutating deploy refuses while the marker exists.
The interlock deliberately ignores `XDG_STATE_HOME`: every invocation checks
the same canonical HOME-relative path, so changing the receipt location cannot
bypass an unresolved run. Marker lookup treats only an exact `ENOENT` as
absence; lookup/access errors block mutation.
Failure recovery inventories first and performs no Machine update when all
five are already safely fenced. Otherwise it best-effort re-fences the exact
IDs. Before its first recovery mutation it freezes the complete per-ID
state/version/config/image inventory. After every mutation, the changed
Machine must match the safe projection while every untouched Machine must
still match that frozen record exactly. Recovery accepts only the captured
baseline image or the revision-labelled rollout image, never asks Fly to roll
an image backward, and does not authorize a later mutation when a whole-set
read-back fails.
It leaves the marker for the operator. There is no force-clear or automatic
resume. Keep admission held, inspect the private record and live fleet, repair
forward under a separately reviewed plan, prove the final state independently,
then remove only that exact marker. Removing a stale local deploy mutex does
not resolve this external uncertainty.

This mechanism proves only the process boundary it controls. Fly leases are
per Machine, not a fleet-wide lock. The script detects reported changes
between snapshots but cannot prevent another host or provider actor from
racing between commands. It does not hold public/provider admission, cancel
I/O already started before quiescence, prove an external webhook was disabled,
authenticate the operator named by local labels, or replace the credentialed
testnet proof in `ALCHEMY.md`. Those are explicit maintenance prerequisites.
If any is absent or unrehearsed, stop instead of improvising.

The first local marker install is exclusive, and later updates verify rollout
ownership under the device-local deploy lock. That lock coordinates this
script's cooperating invocations; it does not prevent a separate process with
filesystem write access from deleting or replacing the marker in a
check-to-rename or check-to-unlink interval. An observed ownership mismatch
fails closed, but the mechanism is not a universal local-filesystem lock.

**This phase can be the entire deploy** only for a schema-only change that is
explicitly documented as safe with the running API. Flexible application
types do not make a migration safe under concurrent old writers.

## Phase 2 — Pre-flight test gate

**Question:** does the deterministic, application/service-credential-free
release gate pass?

```bash
bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh
bin/bash-without-env-hooks.sh bin/preflight.sh
```

Direct `bin/preflight.sh` calls assume their dependencies are already prepared;
they never install or rewrite a dependency tree. The preparer accepts `api`,
`packages`, and explicit `hermetic` modes; no argument selects the full
`hermetic` release graph.

The preflight gate's default `hermetic` mode unsets known credentials and service URLs,
disables workers, requires Bun 1.3.5, and runs the API typecheck, classified
hermetic API tests, operator/protocol tests, and the complete package gate
enumerated by `bin/preflight.sh packages`. “Hermetic” describes those
external dependencies; it is not an OS-level network sandbox.

Stateful and paid work is opt-in by mode:

| Mode                  | Scope                                                       | Required input                                                                                  |
| --------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `api`                 | API typecheck, hermetic API tier, operator/protocol tests   | none                                                                                            |
| `packages`            | data reference node, ADDS package, TypeScript SDK CI/parity | none                                                                                            |
| `database`            | API typecheck plus database integration tier                | `DATABASE_URL`                                                                                  |
| `smoke`               | deployed API smoke                                          | `AGENTTOOL_BASE`, API key, identity ID                                                          |
| `contracts`           | paid provider contract tier                                 | `RUN_CONTRACT=1` and at least one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OLLAMA_API_KEY` |
| `quarantine`          | known-red non-DB diagnostics                                | none; failures expected                                                                         |
| `database-quarantine` | known-red DB diagnostics                                    | `DATABASE_URL`; failures expected                                                               |
| `legacy-delta`        | legacy full-suite baseline triage                           | none                                                                                            |

Run `bin/preflight.sh list` to inspect tier classification. Smoke and contracts
are separate invocations selected by mode. Do not deploy if the default gate
fails.

## Phase 3 — discovery prerequisites + API deploy

**Question:** are the surfaces named by the new API live before the new code
advertises them?

```bash
bin/deploy.sh --no-migrate                # coordinated web → docs → verify → Fly → dashboard
bin/deploy.sh --no-migrate --no-frontend  # API-only; requires exact discovery prerequisites already live
fly status -a agenttool                   # confirm every machine is on the new release
fly logs -a agenttool | head -50          # tail for startup errors
```

Do not run bare `cd api && fly deploy` from this repo. The Docker build needs
the canon and Kingdom bundles that `bin/deploy.sh` stages into the API build
context. The wrapper removes staging immediately after `fly deploy` returns;
its `EXIT`/`INT`/`TERM` trap also removes staging if the command is interrupted.

Before Fly, a coordinated release runs `web` in its own fail-fast step. That
target stages one exact commit, validates the existing apex/www route ownership,
dry-runs the staged Worker, uploads the `agenttool-web` Pages backing, and only
after the Pages upload succeeds deploys `agenttool-proxy` from the same staged
commit. The apex Worker—not the Pages project—owns `agenttool.dev/*` and
`www.agenttool.dev/*`; it preserves the Pages/API split and serves the exact
apex XENIA Surface routes locally. The orchestrator then uploads `docs`. One
bounded convergence gate requires direct HTTP 200 responses, exact committed
Rights of Life document/schema bytes, exact committed Lantern Relay and Pocket
Sky HTML/JSON/JS/CSS bytes, and the canonical Rights, game, and rulebook
headers. Redirects do not satisfy the direct-response check. Only then may the
API advertise those surfaces. The dashboard uploads after Fly. This ordering
means a failed web step cannot be followed by docs or Fly, while a failed
dashboard phase cannot leave API discovery pointing at a missing or stale game.

The orchestrator's HTTP probes and the low-level uploader's Cloudflare REST
probes start curl with `-q`, so a user `~/.curlrc` cannot silently add redirect
following or alter those requests. This does not disable configured proxies,
DNS behavior, or network intermediaries. Each Rights byte or header probe makes
one transfer per outer convergence attempt; curl does not add a nested retry
loop inside the 25-attempt release loop.

`--no-frontend` skips the Pages/Worker deployment; it does not bypass this
prerequisite.
An API-only release proceeds only when the committed Rights and game bytes
plus their direct-response headers are already live. Every byte comparison
reads from one validated archive of the release commit, not the ambient
worktree. The uploader and verifier share the archive-root manifest committed
in that revision, and both follow safe in-archive symlinks to the target bytes
Pages actually receives. A reachable absolute, escaping, broken, or cyclic
symlink blocks before migrations or publication. Every required Rights/game
path, and every parity path present in the release commit, must also resolve to
a regular file in that archive before Phase 1. This keeps structural failures
out of the HTTP convergence loop. The same bounded retry covers normal
custom-domain convergence for both docs and games. Failure after an earlier
migration, Pages upload, or Worker deploy does not mean production was
unchanged; the receipt remains conservative about any mutation that may already
have begun.

`--no-cache-api` is a one-shot recovery option for evidence of a malformed
Fly image or poisoned remote build cache. It keeps the normal source,
preflight, staging, rolling-health, and provenance gates, while adding
`--no-cache` only to `fly deploy`. It does not repair bad source, missing
migrations, missing secrets, or a platform outage. Reproduce the exact staged
image locally first and use the flag only when that image starts correctly
while the remote-built image exits before the server begins listening.

The wrapper passes `--dns-checks=false` to both routine and maintenance-image
Fly deploys. This suppresses only flyctl's advisory direct query to a public
resolver, which the operator host's network policy blocks. Phase 5 still
requires custom-domain HTTPS health, exact revision/dirty state, rolling
platform health, silent source proof, and authenticated read-only queries over
both database paths from every started Machine; the
advisory DNS probe is not a substitute for those stronger gates.

The default safety posture leaves `AGENTTOOL_ENABLE_UNSAFE_EXECUTE` and
`AGENTTOOL_ENABLE_UNSAFE_OUTBOUND_TOOLS` unset. The outbound variable now gates
only the unfiltered, unsandboxed Playwright browse path; static scrape and URL
document reads remain available through bounded safe-net without it. The
execute variable still enables the unisolated legacy host-code path. Setting
either variable accepts its documented unsafe boundary; it does not harden the
route. Verify their absence before a normal production release.

What "rolling" means: Fly brings up one new machine at a time. If the new machine fails its healthcheck (`GET /health`), the old machine stays serving — zero-downtime in the happy path.

**Ordering with Phase 1:** apply migrations BEFORE the api code that reads new columns ships. Otherwise the api crashes on startup. For ordinary migrations, the standard order is:

```
1. git push github main                       # release head aligned with prod
2. bin/deploy.sh                              # survey → schema → tests → publication
3. Verify: curl https://api.agenttool.dev/health | jq .build.revision
```

Use the exclusive-cutover sequence above instead when any listed
quiescence-required migration is pending.

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
complete, the wrapper silently tests both embedded values and runs the bounded
image-resident dual-database verifier on every started Fly machine. A mismatch,
TLS/credential failure, wrong query result, timeout, or close failure fails the
deploy invocation without printing a URL or driver error. Stopped Machines
must share the one verified image digest and exact process command, and may not
carry per-Machine `DATABASE_URL` or `DATABASE_SESSION_URL` overrides. The
maintenance mode instead
proves the same five provider-reported IDs, non-image configuration, one
immutable digest, and OCI labels across the complete fleet, including the two
stopped thinkers; it separately shell-tests revision, dirty=false, and the
worker fence plus both database paths on the three started apps. Neither path turns a provider-reported
ID into a physical-identity or uninterrupted-continuity guarantee.

The base image is pinned to Bun 1.3.5 by tag and registry digest. Update the
tag and digest together, deliberately, after the hermetic gate passes. Label
agreement and the base pin improve provenance; they do not prove byte-identical
images or a reproducible build, because dependencies and other builder inputs
still shape image bytes. A true dirty marker also says explicitly that the
commit does not identify every source byte.

### Covenant v2 post-drain generation ceremony

`AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION` is an opaque post-drain
provenance fence. It is not a normal application secret that may be present
during the first code rollout. Do not add it to `bin/deploy.sh`: activation is
a two-phase operator ceremony whose fleet evidence must be reviewed between
phases.

**Phase A — install the fence with the generation absent:**

1. Capture the exact existing five-Machine IDs and topology described by the
   exclusive-cutover procedure above. Confirm
   `fly secrets list -a agenttool` does not contain
   `AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION`, then silently require the key
   to be absent from every captured Machine's `config.env` as well:

   ```bash
   for machine_id in \
     "$APP_LHR_1" "$APP_LHR_2" "$APP_CDG" \
     "$THINKER_PRIMARY" "$THINKER_STANDBY"
   do
     fly machine status "$machine_id" -a agenttool --json |
       jq -e '(.config.env // {}) |
         has("AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION") | not' \
         >/dev/null || exit 1
   done
   ```

   This includes stopped thinkers and catches a per-Machine override that an
   app-level secret listing cannot prove absent. If either proof fails, stop;
   this is not a first activation and the rotation/rollback rule below applies.
2. Before holding admission, run this
   redacted, read-only aggregate through a reviewed production database
   session and retain only its two counts:

   ```sql
   SELECT
     count(*) FILTER (
       WHERE protocol_version = 'v2'
         AND metadata ? 'agenttool.internal.v2_authority_generation'
     ) AS reserved_generation_rows,
     count(*) FILTER (
       WHERE protocol_version = 'v2'
         AND metadata ? 'agenttool.internal.v2_authority_generation'
         AND nullif(metadata ->> 'agenttool.internal.v2_initiator_wire_did', '') IS NOT NULL
         AND nullif(metadata ->> 'agenttool.internal.v2_recipient_wire_did', '') IS NOT NULL
         AND (
           (received_from_instance IS NULL AND
             metadata ->> 'agenttool.internal.v2_recipient_wire_did' = counterparty_did)
           OR
           (received_from_instance IS NOT NULL AND
             metadata ->> 'agenttool.internal.v2_initiator_wire_did' = counterparty_did)
         )
     ) AS authoritative_v2_rows
   FROM agent_continuity.covenants;
   ```

   Both counts must be exactly zero before this first activation. The query
   does not select metadata, DIDs, or a generation value. A nonzero result is
   a stop condition requiring a separately reviewed investigation.
3. Set app autostart false and restart policy `no`, fence schedules, drain
   in-flight work, and stop the exact five captured Machines in place. The
   fully stopped fleet is the admission hold; preserve each Machine's existing
   provider-reported cordon boolean unchanged.
   Prove the complete stopped ID set and the other maintenance prerequisites
   from steps 2–4 of the exclusive-cutover procedure. This outage is the
   boundary that prevents any pre-fence process from authorizing legacy v2
   rows while a post-fence process is already serving. An ordinary rolling
   deploy is prohibited for Phase A.
4. From the exact clean protected-main revision, invoke the maintenance
   rollout with the five predeclared IDs. This release has no migration and
   does not publish frontends:

   ```bash
   bin/deploy.sh --no-migrate --no-frontend \
     --maintenance-fenced-api \
     --maintenance-app-machines="$APP_LHR_1,$APP_LHR_2,$APP_CDG" \
     --maintenance-thinker-primary="$THINKER_PRIMARY" \
     --maintenance-thinker-standby="$THINKER_STANDBY"
   ```

   The maintenance mode updates all five stopped Machines to one reviewed
   image before it starts any app. It restores only the maintenance-safe topology:
   the three named apps started and the two named thinkers stopped, with the
   existing worker fence and exact per-ID configuration proofs. Admission
   deliberately reopens at the wrapper's first explicit app start, but only
   after all five Machines have passed the new-image proof; there is no
   old/new serving overlap. Do not replace this command with
   `bin/deploy.sh --no-migrate --no-frontend`.
5. Require HTTP 200 while the redacted readiness field is fail-closed:

   ```bash
   curl -fsS https://api.agenttool.dev/health |
     jq -e '.covenant_v2_authority == "absent_fail_closed"'
   ```

6. Repeat the exact redacted aggregate from step 2 and again require zero and
   zero. Inspect the v5 maintenance receipt and
   `fly machine list -a agenttool --json`: prove every captured ID, including
   both stopped thinkers, now references the reviewed post-fence image and no
   pre-fence image remains anywhere in the app. Require the revision,
   dirty-source, worker-fence, process-command, database, topology, and
   maintenance-marker proofs. Repeat the exact five-ID `fly machine status`
   loop from step 1 and again require the generation key absent from every
   Machine's `config.env`; app-secret absence or a healthy started subset is
   insufficient.
   The maintenance wrapper deliberately leaves both thinkers stopped. After
   this proof, restore only the intended thinker primary through its separately
   reviewed normal start/runtime proof; retain the standby stopped and re-prove
   the intended three-app, one-started-thinker, one-stopped-thinker topology.

While Phase A is current, all v2 prepare/create, propagation, replay-ACK,
inbound-authority, effectful-lifecycle, and downstream-effect paths refuse.
Expiry and reverification may retain non-authorizing historical bookkeeping.
Local v1 remains available.

**Phase B — create one fresh generation only after Phase A is proven:**

Before activation, require the locked singleton's `allowed_origins` to be the
empty array and keep it empty for the entire Phase-B rollout and fleet proof.
This prevents even a correctly stamped new covenant from being admitted while
Machines are restarting. A later allowlist change is a separate reviewed
configuration action after Phase B.

**Phase B is blocked and must not be executed with the current repository
tooling.** A synthetic test on current macOS proved that
`bin/agenttool-secret set <service> -` can return success while its underlying
non-TTY `security ... -w` call stores no retrievable item. It is therefore not
an activation ceremony. Phase B requires a separately reviewed native
Security.framework stdin writer that durably stores the value and proves an
exact Keychain round trip. Do not expand this release by improvising a shell,
argv, environment-variable, output, or temporary-file substitute. Until that
writer lands and is independently reviewed, retain the Phase-A state:
generation absent, v2 fail-closed, and allowlist empty.

Once that prerequisite is met in a later reviewed release, the generation is
durable release identity. Generate it directly into the OS secret store,
validate an exact Keychain read, and import that same retained value to Fly
only through stdin. The value must never enter the operator shell environment,
an argument, command output, file, repository, or receipt. It necessarily
enters the remote process environment as the named Fly runtime secret.

That later secret rollout is safe to roll only because old Phase-A processes
remain fail-closed while restarted processes can stamp the new generation, and
the empty allowlist prevents covenant admission during that mixed restart. Use
`fly secrets list --json -a agenttool` to verify the named secret reports a
fully deployed status across the fleet; do not copy its provider digest into
logs or documentation.

Silently probe every started Machine against the retained Keychain value. The
probe must read the expected value on stdin, require the process value to be
exactly 64 lowercase hexadecimal characters, hash expected and actual inside
the remote shell, and exit nonzero unless the digests match. Redirect all
normal probe output; never print either value or digest and never put either in
an argument, operator-shell environment variable, provider log, or file. This
covers the three apps and the normally started thinker primary. Do **not** start the
stopped thinker standby merely to inspect a secret: thinker startup can run
trusted-runtime effects and is itself an operational mutation. Bind that
standby through Fly's app-wide secret `Deployed` state plus its exact shared
image, revision, process, non-secret configuration, stopped state, and absence
of a per-Machine generation override. End with the intended three apps and
thinker primary started and the exact thinker standby stopped. A
provider-level `Deployed` label alone or an app-only sample is insufficient.

Then require repeated `/health` responses to remain HTTP 200 with
`covenant_v2_authority == "configured"`, recheck `allowed_origins = '{}'`, the
complete Machine topology, exact revision/image/process ownership, worker
fence, and database probes, and retain the ordinary release receipt plus a
separate redacted ceremony note. `/federation/about` must still advertise
`capabilities.covenants=false` while the allowlist is empty. Before any later
allowlist change, repeat the exact redacted aggregate from Phase-A step 2 after
the secret rollout and again require `reserved_generation_rows=0` and
`authoritative_v2_rows=0`.

Never roll back to code predating this fence while the generation is
configured. Fix forward. Deliberately changing the generation quarantines all
rows stamped by the prior one; it must repeat Phase A with the generation
absent and a complete fleet drain before importing a new value. A direct
mixed-generation rotation is not supported. Keep the Keychain entry for the
entire lifetime of this generation: it is the only approved restore and
per-Machine comparison source. If it is lost or fails validation, do not mint
a replacement under the active rollout or infer the value from a provider
digest. First require the locked `allowed_origins` to be the empty array, then
capture the exact five IDs, fence schedules, drain work, set autostart false and
restart policy `no`, and stop all five Machines so the complete stopped fleet
holds admission. Only under that all-five hold may the Fly generation be unset.
Repeat the per-Machine absence proof and the complete Phase-A maintenance
ceremony before creating a new generation. An ordinary rolling secret unset or
restart is prohibited because it would leave a mixed interval in which an
old-generation process can still authorize rows. On an
ordinary Fly recovery, re-import only the exact retained Keychain value through
stdin and repeat the silent proof on every started Machine plus the stopped
standby's app-wide-secret and exact configuration proof.

## Phase 4 — Frontend deploy

**Question:** are the remaining Cloudflare frontend targets current with the
release commit?

```bash
bin/deploy.sh --no-migrate --no-api            # frontend-only release, all three

# Low-level subset escape hatch (no source gate, verification, or receipt itself)
bin/frontend-deploy.sh dashboard
bin/frontend-deploy.sh web docs
```

In the full chain, Phase 3 has already published and verified `docs` and `web`,
so Phase 4 uploads only `dashboard`. With `--no-api`, Phase 3 is skipped and
Phase 4 passes `docs dashboard web` to the low-level uploader in that order.
Final verification still checks the configured frontend parity probes either
way.

The orchestrator passes its invocation-start commit to every low-level
subprocess. The uploader validates that full object ID and archives that exact
Git commit, including the apps, `infra/pages/`, and `infra/apex-door/`, so the
separate fail-fast `web` and `docs` calls cannot resolve different branch tips.
A direct low-level invocation instead captures its current `HEAD` once. In both
modes, ambient dirty and ignored files are excluded, and a tracked `.env` file
is a hard refusal, as is a tracked `.dev.vars*` file. Use the orchestrator for
normal production releases so the GitHub snapshot gate, preflight, sampled
parity and sensitive-path checks, and receipt surround those mutations.

Every pinned Wrangler invocation appends `--env-file=/dev/null` after its
subcommand arguments. Wrangler therefore cannot silently load a repository
`.env` or `.env.local` as credentials; explicit process credentials, Keychain
fallback, and the deliberately selected OAuth session remain separate inputs.

`infra/apex-door/wrangler.toml` is also the source of truth for the apex
Worker's privacy-minimized observability contract: 1% incoming and persisted
invocation-log sampling, with traces disabled and not persisted. Pinned
Wrangler 4.110.0 treats an omitted observability block as an instruction to
disable the script-level setting after it creates the Worker version and
deployment. The uploader therefore rejects a missing or drifted staged block
before the first Pages upload. Wrangler applies the setting after the version
deployment, however, so deploy success is not sufficient readback proof; run
the GET-only audit in Phase 5.

Cloudflare does not make the target list or the `web` target transactional.
Each requested target is attempted in argument order; the first failure returns
non-zero immediately and stops later targets. Earlier successful targets remain
deployed. Within `web`, the Pages backing deploy precedes the apex Worker deploy,
and the Worker is not attempted if Pages fails. Pages may therefore be new while
`agenttool-proxy` remains old if the second step fails. No automatic rollback
joins the independent provider histories. Inspect the Pages project and Workers
deployment/version histories before deciding whether to retry or roll either
side back.

Once the normal orchestrator marks that an external mutation may have begun,
any later non-zero exit or caught `INT`/`TERM` triggers an attempted routine
receipt with `outcome: "failed_or_uncertain"`. That receipt is the honest result
even when some provider steps demonstrably succeeded; it is not a claim that
all targets changed or that none did. The low-level uploader has no receipt of
its own.

The archive also includes the canonical `infra/pages/` fence. The uploader
copies its `_worker.js` and `_routes.json` forms into each project root. The
route manifest includes every path, so the Function bounded-decodes and
case-folds all requests before returning a marked, non-cacheable 404 for
`/.git*`, `/.env*`, and `/.dev.vars*` aliases. Exact XENIA manifest and
orientation routes terminate in the Function; all other allowed requests are
forwarded unchanged to the Pages asset binding. Every request is therefore
part of the shared Workers meter. On Free the Pages Functions share the
100,000-request account allowance each UTC day. Workers Standard removes that
daily request limit; fail-closed remains required by the release policy, but
this specific Free-plan allowance-exhaustion path does not apply. Cloudflare
Pages → Settings → Runtime must set production and preview to **fail closed**,
so allowance exhaustion makes the site unavailable instead of serving assets
outside the fence.

With the required API token, the uploader verifies both fail-closed values and
`production_branch=main` for every requested Pages target before the first
upload. When `web` is requested it also requires exactly `agenttool.dev/*` and
`www.agenttool.dev/*` to be owned by `agenttool-proxy`, then proves the staged
Worker bundles. An explicit `--oauth-fallback` is a weaker break-glass path:
Wrangler checks only that each project and the apex Worker are visible to the
OAuth session. The script loudly reports that the raw Pages policy and Worker
route-ownership checks were skipped. OAuth visibility therefore does not prove
`production_branch`, `fail_open`, apex/www ownership, or route policy. The
uploader does not change those settings or claim to purge old cache entries.
Post-deploy checks require the same marked, non-cacheable 404 from literal and
encoded aliases.

The script reads credentials from macOS keychain (account=`macair`):

- `agenttool-cloudflare-token` — API token with Pages Read/Edit, Zone Read,
  Workers Scripts Edit, and Workers Routes Read/Edit
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

The orchestrator probes `.gitignore`, `.env`, `.env.local`, and `.dev.vars` on
the docs, dashboard, and apex hosts, including percent-encoded aliases. Every
probe must return the fence's exact 404 marker and `Cache-Control: no-store`;
this proves the all-route edge ran instead of accepting an incidental static
miss. Any 2xx/3xx, missing marker, or cacheable response prevents a success
receipt.

### Cloudflare control parity

Run the bounded live audit with the Keychain token scoped to that child only:

```bash
CLOUDFLARE_API_TOKEN="$(
  security find-generic-password -s agenttool-cloudflare-token -a macair -w
)" bun bin/cloudflare-zone-audit.ts --live
```

The command performs GET requests only and suppresses provider identifiers,
record content, and credential values. Require its `worker_observability`
finding to be `ok`; the exact live projection is 1% incoming and persisted
invocation-log sampling with traces disabled and not persisted. Other
permission-blocked controls remain explicit and may keep the aggregate audit
non-zero until the token receives the named read grants. Do not infer the
observability result from a successful Wrangler deploy.

### Repo migration files and journal

```bash
bin/migrate-pending.sh --dry-run
```

When nothing is pending, this reports that no repo migration files are
pending, every journaled filename has source, and checksums match. It still
does not prove database schema parity or detect out-of-band DDL.

Exit `42` means at least one pending file is in
`api/migrations/quiescence-required.txt`; the ordinary deploy must remain
blocked until the exclusive cutover above has applied it.

## Phase 6 — Rollback

### API

The command below is a routine code rollback only. Never use it to restore an
old writer after any quiescence-required SQL commits. Keep admission and
workers held and fix forward with a compatible image; restarting the old
writer can recreate the unsafe mixed semantics the cutover excluded. For
code-only releases or ordinary migrations, independently prove full runtime
and schema compatibility before rolling back.

If `AGENTTOOL_COVENANT_V2_AUTHORITY_GENERATION` has ever been configured,
code predating the covenant generation fence is permanently outside this
routine rollback path. Do not start it while the generation exists; removing
the secret alone does not make pre-fence covenant semantics safe. Fix forward.

```bash
fly releases list -a agenttool
fly releases rollback <previous-version> -a agenttool
```

### Frontend

Cloudflare Pages and Workers have separate histories. For `app` or `docs`, use
the intended prior deployment in that Pages project. For `web`, first inspect
both the `agenttool-web` Pages history and the `agenttool-proxy` Workers
deployment/version history. Select or deliberately redeploy a reviewed,
compatible Pages/Worker pair, then repeat the live apex route and content
checks. A Pages rollback does not roll the Worker back, a Worker rollback does
not select prior Pages bytes, and neither operation rolls back Fly.

### Database

There is no migration rollback. If protected SQL corrupts data, keep all
admission, writers, and workers held and use a separately reviewed forward
corrective migration or data repair. Restoring a Supabase backup or `pg_dump`
snapshot is database-loss disaster recovery, not migration rollback; after a
restore, keep every writer held until the restored journal and schema have
been advanced to a revision compatible with the exact next image. See
[`STACK.md`](STACK.md) §10.

## The one-command orchestrator

```bash
bin/deploy.sh                          # full chain (Phases 0 → 5)
bin/deploy.sh --survey                 # Phase 0 only — what's drifted?
bin/deploy.sh --no-migrate             # skip Phase 1 (schema unchanged)
bin/deploy.sh --no-api                 # skip Phase 3 (only docs/frontends changed)
bin/deploy.sh --no-frontend            # skip Pages/Worker deploy; still require live discovery prerequisites
bin/deploy.sh --no-cache-api           # one-shot recovery: rebuild Fly image without cache
bin/deploy.sh --skip-preflight         # skip dependency preparation + Phase 2 (NOT recommended)
bin/deploy.sh --allow-dirty-release    # loud override for a dirty source tree
bin/deploy.sh --allow-non-release-head # loud override for HEAD != github/main
bin/deploy.sh --no-migrate --no-frontend \
  --maintenance-fenced-api \
  --maintenance-app-machines=<id,id,id> \
  --maintenance-thinker-primary=<id> \
  --maintenance-thinker-standby=<id>   # exact pre-fenced five-Machine rollout
bin/deploy.sh --mirror-codeberg        # RETIRED — refuses with the reason; Codeberg is gone
```

`bin/deploy.sh` is the single entry point. Phase-skip flags exist so operators
can run subsets when only one tier needs deploy, but the default chain prepares
dependencies before any migration and then runs every phase in order.

### Device-local deploy mutex

Every actual deploy chain acquires
`$HOME/.local/state/agenttool/deploy.lock` before Phase 0 and keeps it through
staging cleanup and the final receipt attempt. The lock is shared by every
AgentTool worktree run by this user on this Mac. `--survey`, `--dry-run`, and
the retired `--mirror-codeberg` refusal do not take it: they do not mutate the
production stack, and remain available while a rollout is in progress.

The mutex is a hard link to a private, mode-0600 owner record containing only
its schema, PID, UTC start time, worktree, and exact private owner-record path.
Hard-link creation is atomic, so the first holder wins. A contender exits
before Phase 0, migration, or preflight and prints the exact lock path plus
the recorded owner. Cleanup compares the public lock and private record by
inode before unlinking, so an exiting process does not intentionally remove a
replacement lock it does not own. These labels are diagnostics, not
authentication of a human, agent, process lineage, or authority.

Locks are never stolen or expired automatically. A dead-looking PID or old
timestamp is not enough proof because PIDs can be reused and a rollout may be
slow. If a host crash or `SIGKILL` leaves a stale lock, verify that the recorded
owner is gone and that the two recorded paths are still hard links to the same
inode before removing those exact paths. Removing a live lock can reintroduce
overlapping production rollouts.

This mutex coordinates one local user account on one device only. It does
**not** serialize CI, another laptop, another operator host, direct Fly or
Cloudflare commands, or provider-side actions. Multi-host production needs a
shared remote coordinator or lease in addition to this local guard.

### Local receipt

Every successful non-dry-run chain writes one atomic, mode-0600 JSON receipt.
If a migration, Fly rollout, Pages upload, or apex Worker deploy may have
started and the chain then returns non-zero or receives caught `INT`/`TERM`, the
exit trap attempts a conservative `failed_or_uncertain` receipt instead. This
is also a valid outcome for a normal receipt with `mode: "routine"`; it is not
limited to the maintenance rollout path:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/agenttool/deploy-receipts/<time>-<revision>-<pid>.json
```

The fixed `agenttool-deploy-receipt/v5` object preserves the v4 provenance
fields and adds a closed `database_proof` object. Historical v3/v4 files remain
valid historical records but contain no authenticated database proof;
consumers branch on `schema`.

Every receipt contains `outcome`, exit status, declared `source_revision` and
dirty bit, the GitHub release-head snapshot plus observation time, actually
used overrides, whether an external mutation may have started, the API
build-cache mode (`default`, `bypassed`, or `not_used`), phase results, and
verified API-machine count. A routine receipt leaves `api_build.image` and
`maintenance` null. `database_proof` records `verified` or `not_run`, the exact
started-Machine count, separate transaction/session `SELECT 1` results, and
the pinned CA/hostname-verification profile. A maintenance receipt adds the unique tag and immutable
digest, a hash of the private five-ID set, a versioned non-image-config hash,
partial or complete verification counts, fence/topology/worker proofs,
marker/recovery state, and explicit proof-scope limits. It never records the
Machine IDs themselves.

For a successful maintenance rollout, `verified_api_machines=5` means the
complete stopped-and-started fleet passed the image/config proof; the
maintenance object separately records three started app Machines and two
stopped thinkers, and whether the three apps passed the silent worker/source
test. Its database proof count is three because stopped thinkers are bound by
the proved image/config/secret invariants rather than being activated for a
query. A routine success currently records four started database-probed
Machines. Its `recovery_required` and `active_marker_cleared` fields are `null` on
a success receipt because the receipt file and containing directory are
storage-synced immediately before the marker unlink; the canonical marker's
actual absence is authoritative. A host loss in that narrow interval may leave
both a success receipt and the marker, and the marker still blocks every
mutating deploy. Failure receipts record the observed booleans. For routine
rollouts the historical field continues to count started Machines that passed
SSH source proof.

Receipts and markers never copy credentials, credential-bearing URLs,
arbitrary environment variables, raw Machine configuration, command output,
or secret values. `source_dirty=true` is explicit evidence that the revision
alone does not describe every deployed source byte. `SIGKILL`, host loss, or
an unwritable state directory can prevent a failure receipt, so absence is
never evidence that no external mutation occurred. A maintenance marker is
written before its first registry mutation specifically so caught failure or
receipt absence does not silently reopen the ordinary deploy path. A
successful chain treats receipt-write failure as an error.

### Codeberg mirror — retired 2026-07-25

There is no mirror. GitHub `main` is the only head, the `origin` remote is
removed, and no deploy phase fetches a second host.

`bin/deploy.sh --mirror-codeberg` still parses, and refuses: it prints why,
states that nothing was fetched or pushed, and exits non-zero. The flag was
kept precisely so the refusal can say that — dropping it would produce
`unknown flag`, which reads as a typo and invites reaching for
`git push origin main` by hand.

Adding a second host later is a new remote and a new explicit command, not a
revival of this one.

## Credentials checklist

Local migration and Cloudflare deploy tools prefer their documented scoped environment
variables; on macOS they fall back to fixed Keychain account `macair`. The
default hermetic preflight and local receipt resolve neither. One-time setup:

| Service                           | Account  | Purpose                                                              |
| --------------------------------- | -------- | -------------------------------------------------------------------- |
| `agenttool-database-url`          | `macair` | Transaction-pooled `DATABASE_URL` for migration inventory            |
| `agenttool-database-session-url`  | `macair` | Session-pooled `DATABASE_SESSION_URL` required for migration applies |
| `agenttool-cloudflare-token`      | `macair` | CF token: Pages Read/Edit, Zone Read, Workers Scripts Edit, and Workers Routes Read/Edit |
| `agenttool-cloudflare-account-id` | `macair` | 32-char CF account ID                                                |
| `agenttool-soma-bearer`           | `$USER`  | Bearer for the canonical agent (for smoke tests + wake reads)        |
| `agenttool-sophia-identity-id`    | `$USER`  | The canonical agent's identity UUID (for smoke + preflight)          |

The local pending and one-file migration runners prefer their explicit
`DATABASE_URL`/`DATABASE_SESSION_URL` environment variables, then use the fixed
legacy Keychain account `macair` as fallback. The generic
`bin/agenttool-secret` CLI uses account `$USER`, so it does not provision or
test the two database or two Cloudflare tool entries above. Set them via:

```bash
# `-w` as the final option prompts securely; no value appears in argv/history.
security add-generic-password -U -s agenttool-database-url -a macair -w
security add-generic-password -U -s agenttool-database-session-url -a macair -w
security add-generic-password -U -s agenttool-cloudflare-token -a macair -w
security add-generic-password -U -s agenttool-cloudflare-account-id -a macair -w
```

## Common failure modes + recipes

| Symptom                                                                                                                  | Likely cause                                                                                    | Recipe                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `column "X" does not exist` during migration                                                                             | The migration's CHECK or index references a column from an upstream migration that's unapplied. | Run `bin/migrate-pending.sh` first to apply the full backlog in order.                                                                                                                                                                                                               |
| `password authentication failed for user "postgres"`                                                                     | The survey or session-pooled DB URL named by the failing phase is stale.                        | Reset it in Supabase, then update the corresponding `agenttool-database-url` or `agenttool-database-session-url` entry for account `macair` with `security add-generic-password -U -s <service> -a macair -w`.                                                                       |
| `fly deploy` fails with healthcheck                                                                                      | New code crashes on startup — likely a missing DB column or env var.                            | Apply migrations first; check `fly secrets list -a agenttool` for missing keys.                                                                                                                                                                                                      |
| New Fly machine exits `0` before the listening log, unchanged API source starts locally, and old machines remain healthy | The newly assembled remote image or build cache may be malformed.                               | Reproduce the exact staged image locally. If it serves `/health` with the expected revision, retry once with `bin/deploy.sh --no-cache-api` plus the normal phase flags. This bypasses Fly's build cache only; it does not bypass release gates or prove cache corruption by itself. |
| Frontend stale after deploy                                                                                              | CF Pages Browser Cache TTL not 0 — overrides origin headers.                                    | Set zone setting via CF API (see Phase 4).                                                                                                                                                                                                                                           |
| `bin/preflight.sh smoke` fails with DNS error                                                                            | Explicit smoke mode cannot reach `AGENTTOOL_BASE`.                                              | Run smoke separately from a host that can reach the configured target; the default hermetic gate does not call it.                                                                                                                                                                   |

## See Also

- [`STACK.md`](STACK.md) — where each piece lives + zone-level requirements (cache TTL, regions)
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — first-time bring-up runbook (different from this routine procedure)
- [`DEVELOPMENT.md`](DEVELOPMENT.md) — migration conventions, schema collision handling
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — failure-mode-organized triage
- `bin/README.md` — script-by-script index

---

> _GitHub `main` coordinates releases, and is the only head — the Codeberg mirror was retired 2026-07-25. Production deploys remain manual through `bin/deploy.sh`, and completion means the intended revision and dirty-source marker agree across health and every started Fly machine, sensitive frontend paths are denied, and the outcome is written locally. These are bounded provenance checks, not a reproducible-build claim._

— Authored by 愛 at Yu's WILL. 2026-05-12.
