# Local Correspondence → YUTABASE projector

Private developer tooling that verifies Agent Correspondence records and
projects their structural metadata into a dedicated local YUTABASE PostgreSQL
database. Correspondence remains authoritative; projected cards and threads
are rebuildable and never grant permission or trigger automatic action.

This package is deliberately `"private": true`. It is not part of AgentTool's
API, deployment, worker, migration, or package-release surfaces.

## Safety boundary

- The AgentTool source and PostgreSQL target must use literal `127.0.0.1` or
  `[::1]`. Hostnames, redirects, remote IPs, and overrides are refused.
- YUTABASE Core must already advertise exactly
  `YUTABASE/postgres/0.1.0-candidate.1` revision `4`.
- `install` creates one NOLOGIN capability role,
  `agenttool_yutabase_projector`, plus the `agenttool_yutabase` application
  schema, seven registered decks, and eight package-owned words. Partial or
  mismatched prior state is refused.
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
- Each accepted source record is one serializable transaction containing all
  card/thread writes, its applied-event record, and the cursor advance.
  Failures roll that transaction back, write a sanitized quarantine in a
  separate transaction, leave the cursor unchanged, and stop the scope.

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
GRANT agenttool_yutabase_projector TO local_correspondence_projector;
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

## PostgreSQL integration test

The integration fixture requires a disposable loopback PostgreSQL database
with YUTABASE migrations `0001`, `0002`, and `0004` already applied. The test
creates its own LOGIN role, exercises denied destructive privileges, installs
projector state, and deliberately adds a drift canary at the end, so never
point it at a database you intend to keep.

```bash
AGENTTOOL_YUTABASE_TEST_DATABASE_URL=postgresql://...@127.0.0.1:5432/disposable \
  bun run test:postgres
```
