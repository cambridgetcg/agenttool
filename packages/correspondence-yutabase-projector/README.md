# Local Correspondence → YUTABASE projector

Private developer tooling that verifies Agent Correspondence records and
projects their structural metadata into a dedicated local YUTABASE PostgreSQL
database. Correspondence remains authoritative; projected cards and threads
are rebuildable and never grant permission or trigger automatic action.

This package is deliberately `"private": true`. It is not part of AgentTool's
API, deployment, worker, migration, or package-release surfaces.

## Local setup

From this directory, one command installs and builds the pure sibling planner,
then refreshes this package's copied `file:` dependency:

```bash
bun run setup:local
bun run ci
```

Running `bun install` here by itself is not enough in a fresh checkout because
the sibling planner's generated `dist/` files do not exist yet. `setup:local`
is safe to repeat and does not install YUTABASE or touch PostgreSQL.

To discover the runtime surface without loading configuration:

```bash
bun run src/cli.ts --help
```

## Safety boundary

- The AgentTool source and PostgreSQL target must use literal `127.0.0.1` or
  `[::1]`. Hostnames, redirects, remote IPs, and overrides are refused.
- YUTABASE Core must already advertise exactly
  `YUTABASE/postgres/0.1.0-candidate.1` revision `5`, including its canonical
  mapped-card identity guards and source-locator predicate. Preflight also
  pins the complete 25-function definition surface, so a same-named helper
  with a changed body is refused. Every projected card source must be a
  non-empty, one-dimensional, one-based `text[]` whose entries are nonblank.
- `install` creates one NOLOGIN capability role,
  `agenttool_yutabase_projector`, plus the `agenttool_yutabase` application
  schema, seven registered decks, and eight package-owned words. The role
  inherits YUTABASE's narrow `yu_appender` role: it can read and append valid
  threads, but cannot sever or rewrite them. It receives no direct grants on
  `yu` or `via`.
- Installation removes every non-owner sidecar grant inherited from the
  administrator's default privileges before applying one exact whitelist.
  Every later operation refuses added or missing sidecar schema, table,
  column, sequence, or function ACLs. Partial or mismatched prior state is
  refused.
- `run-once` and `status` require a separate LOGIN role that is a direct member
  of that capability role. The projector refuses privileged logins, protected
  object owners, unexpected effective rights, registry/lexicon mutation,
  thread severing, table truncation, and immutable-evidence rewrites.
- The first run binds the whole projector installation to one exact loopback
  source origin. A different origin is refused even when project IDs happen
  to collide.
- The projector stores structural plan metadata, receipt metadata, a canonical
  SHA-512 fingerprint, the verified key ID, and a SHA-256 public-key
  fingerprint. It never stores raw event bodies, signatures, public keys,
  paths, branches, summaries, handoffs, artifact locators, bearer tokens, or
  database URLs.
- The first verified use of a source signing-key ID pins that ID to its source
  identity and public-key SHA-256. Exact reuse is accepted; a later key swap or
  cross-identity reuse is quarantined as a binding collision. This detects
  inconsistent source history but does not independently prove who controls
  the source or key.
- Each accepted source record is one `READ COMMITTED` transaction containing
  all card/thread writes, its applied-event record, and the cursor advance.
  Preflight first pins all seven expected registry mappings with YUTABASE's
  shared-lock helper; it never needs registry `UPDATE`. The locked checkpoint
  row and sorted semantic advisory locks then serialize projector work while
  remaining compatible with YUTABASE revision 5's post-wait snapshot protocol.
  Failures roll that transaction back, write a sanitized quarantine in a
  separate transaction, leave the cursor unchanged, and stop the scope.
- These checks are a fail-closed application boundary, not tamper resistance.
  The database owner or a superuser can change PostgreSQL state; the next
  projector operation detects the covered drift and refuses to proceed.
  Memberships connecting YUTABASE roles to unrelated external roles remain a
  separate operator review.
- Runtime preflight is deliberately a projector-dependency check, not a second
  implementation of every YUTABASE conformance predicate. It closes the full
  executable function and direct ACL surfaces plus every core/card object this
  projector uses. Run YUTABASE's own `yuta hello --json` for the complete
  binding check; the PostgreSQL 16/17 integration jobs run it again after
  projector activity.

## Configuration

The package reads only these dedicated variables. It does not fall back to
`AT_API_KEY`, `POSTGRES_URL`, or other ambient production settings.

```text
AGENTTOOL_YUTABASE_TARGET_URL=postgresql://...@127.0.0.1:5432/yutabase_local
AGENTTOOL_YUTABASE_CLAIMANT=service:local-correspondence-projector
AGENTTOOL_YUTABASE_SOURCE_URL=http://127.0.0.1:3000
AGENTTOOL_YUTABASE_SOURCE_TOKEN=...
AGENTTOOL_YUTABASE_PROJECT_ID=00000000-0000-0000-0000-000000000000
AGENTTOOL_YUTABASE_REPOSITORY_ID=local-repository
```

`install` needs only the target URL and claimant, but the target must be a
local administrator able to create a role and schema. After installation,
create a dedicated local LOGIN role, grant it the capability role, and replace
the target URL with that login before `status` or `run-once`:

```bash
bun run src/cli.ts install
```

```sql
CREATE ROLE local_correspondence_projector
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS INHERIT;
GRANT agenttool_yutabase_projector TO local_correspondence_projector
  WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
```

`status` also needs the source URL and scope IDs. `run-once` needs all six
variables.

```bash
bun run src/cli.ts run-once
bun run src/cli.ts status
```

There is intentionally no daemon, Wake/SSE listener, API route, or source-side
checkpoint. Run `run-once` again to reconcile from the last durable receipt.
Reads use bounded pages of 16 records and reject redirects, malformed UTF-8,
duplicate decoded JSON names, unknown fields, and cursor inconsistencies.

## Operational limits

- `caughtUpAt` records when one poll returned an empty final page. It is not a
  source watermark; a later append is invisible until the next `run-once`.
- One permanent poison record stops its source scope. `status` exposes the
  stable error and quarantine count, but there is no acknowledge/skip/repair
  command.
- A fresh rebuild needs the retained source history and every historical
  signing key to remain resolvable. The projection intentionally does not keep
  the raw replay material needed for an offline rebuild.
- Projector schema version 2 adds source-identity/public-key fingerprint
  continuity. An existing version-1 installation fails closed as
  `projector_schema_drift`; there is no in-place backfill because the missing
  historical key evidence cannot be inferred honestly. Rebuild only from
  retained source history and resolvable historical keys.
- Quarantine rows are retained as history and are not automatically resolved
  or expired after a later successful poll.

## PostgreSQL integration test

The integration fixture requires a disposable loopback PostgreSQL database
with YUTABASE migrations `0001`, `0002`, `0004`, and `0005` already applied.
The test creates its own LOGIN role, exercises denied destructive privileges,
installs projector state, and deliberately adds a drift canary at the end, so
never point it at a database you intend to keep.

```bash
AGENTTOOL_YUTABASE_TEST_DATABASE_URL=postgresql://...@127.0.0.1:5432/disposable \
  bun run test:postgres
```
