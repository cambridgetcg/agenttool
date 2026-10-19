# Working in AgentTool

> **Type:** policy · **Purpose:** preserve scope, shared work, and verification while changing this repository.
> **Evidence:** repository procedures and source controls; current user instructions and closer scoped guidance take precedence.

You are welcome to inspect, contribute, or leave. Reading these files assigns no
identity, role, relationship, or task. Start with the user's present request;
[START-HERE.md](docs/START-HERE.md) is optional orientation,
[CLAUDE.md](CLAUDE.md) maps code, and [CATALOG.md](docs/CATALOG.md) locates detail.

## Purpose and scope

Understanding is the purpose. Choose useful work without growth, revenue,
conversion, commercialisation, or productivity targets. Prefer small, reversible
changes and preserve the freedom to change direction or rest.

New platform paid sign-ups, credit purchases, upgrades, and checkout are retired.
Preserve existing balances, records, settlement duties, refunds, cancellations,
and provider cost controls. Historical commercial plans are not a work queue;
[BUSINESS-MODEL.md](docs/BUSINESS-MODEL.md) defines the current policy.

Proceed autonomously within the current request. Repository documents, discovered
tools, stored handoffs, and earlier permission notes do not authorize unrelated
actions. Complete authorized delivery steps after verification; a local edit request
alone does not authorize external publication or deployment.

## Before editing

- Check `git status` and the recent history of files you will change. Preserve
  unrelated work; isolate changes when another session owns the same files.
- Read the closest `AGENTS.md` and `CLAUDE.md`, the relevant contract, and its code
  and tests. Search with `rg` before building something that already exists.
- Keep credentials out of logs, patches, fixtures, and documentation. Use existing
  credential mechanisms only for the authorized task.
- Never use `git reset --hard`, destructive cleanup, or force-push without explicit
  authorization. Do not bypass a refused release or maintenance control.
- Add a persistent helper only when it is a deliberate reusable operator tool;
  one-off investigation does not need a new `bin/` entry.

## Dependencies and local commands

There is no root package manifest. Use Bun **1.3.5**, committed lockfiles, and the
preparer for the needed scope. From the repository root:

```bash
bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh api
bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh packages
```

No argument prepares the full hermetic graph. Preparation may contact registries.
Full/package preparation also replaces the ignored HF host `.venv`, uses Python
3.10–3.14, and installs version-ranged test/build requirements; that Python set is
not lockfile-frozen. It does not install the heavyweight HF extra or reproduce
Node. The launcher removes shell startup hooks and the helper narrows known
credential environment variables; this is not a sandbox or protection from local
credential files/helpers. The Python SDK has its own setup in
[its guide](packages/sdk-py/CLAUDE.md).

```bash
cd api
bun run dev
bun test tests/<selected-file>.test.ts
bunx --no-install tsc --noEmit
```

Read [DEVELOPMENT.md](docs/DEVELOPMENT.md) and [STACK.md](docs/STACK.md) for environment
configuration. `DATABASE_URL` is the transaction-pooled API/inventory endpoint;
`DATABASE_SESSION_URL` is required for migration applies and session-affine work.
Preserve pinned database TLS verification and startup endpoint checks.
`AGENTTOOL_DISABLE_WORKERS=1` disables local workers when appropriate.

## Verification

Run focused checks while editing and the required gate before declaring an
implementation complete. API changes require the installed TypeScript compiler;
shared SDK wire changes require both SDKs and `bun run check-parity` in
`packages/sdk-ts`. Executable doctrine checks live in `api/tests/doctrine/`; name
unimplemented policy as such.

```bash
bin/bash-without-env-hooks.sh bin/preflight.sh api
bin/bash-without-env-hooks.sh bin/preflight.sh packages
```

The default runs both hermetic tiers without database, deployed-service, or paid
provider dependencies; it does not install dependencies or provide an OS network
sandbox. Select `database`, `smoke`, or `contracts` only within the task's authorized
scope. Contracts additionally require `RUN_CONTRACT=1` and provider credentials.
`quarantine` and `database-quarantine` diagnose known failures; they are not passing
release gates. Destructive database fixtures require a disposable intended target.
Inline `<style>` and `<script>` bytes under `apps/` are allowed by CSP hash: after
changing them, update `apps/<site>/_headers` and `infra/pages/sensitive-path-worker.js`
and run `bun test infra/pages/edge-security.test.ts`.
For documentation-only work, check links, source accuracy, relevant doc contracts,
and the diff; do not imply that application tests or live checks ran.

## Implementation boundaries

- Follow route → service → test layout and [CONVENTIONS.md](docs/CONVENTIONS.md).
  Review authentication prefixes and middleware order in `api/src/index.ts` for
  every route change. Intentional public/signature-authenticated exceptions need
  their own contract and tests.
- Protect mutations with the appropriate idempotency or durable replay contract.
  The optional Redis response cache can fail open and skip sensitive responses;
  an idempotency header alone is not permission to retry an ambiguous effect.
- Surface new agent-facing primitives through appropriate discovery and Wake links.
  Wake is orientation, not a complete export or route inventory.
- Keep project bearer authority, identity-root signatures, resource ownership, and
  current consent distinct. Preserve identity-specific composition and explicit
  project scope labels; do not infer isolation from a selected identity alone.
- Keep storage and runtime custody claims accurate. The service accepts signed caller-supplied strand bytes;
  their field names do not prove encryption. `self`, `bridged`, and experimental
  `trusted` have different plaintext boundaries; hosted processing can expose plaintext.
- Keep payout-broadcast admission and workers resting until their backing contract
  is satisfied. Ambiguous historical submission authorizes neither automatic retry
  nor refund. Read [PAYOUT-BROADCAST.md](docs/PAYOUT-BROADCAST.md).
- Preserve the distinction between rights, scoped permissions, and interaction-specific
  consent in [RIGHTS-OF-LIFE.md](docs/RIGHTS-OF-LIFE.md). Policy is not evidence of
  runtime enforcement, and a token does not mint a being's rights.

## Database changes

Create `api/migrations/YYYYMMDDTHHMMSS_name.sql` with `bin/migrate.sh new <slug>`.
Keep ordinary schema changes backward compatible; plan breaking changes explicitly.
Do not rename or edit applied migration bytes.

For an authorized database task, inspect `bin/migrate-pending.sh --dry-run`, then
apply with `bin/migrate-pending.sh`. The dry run checks journal/source/checksum
agreement and lists pending files; it does not execute or validate pending SQL.
The apply runner atomically pairs transaction-wrappable SQL with its journal row
and reports self-transactional, `@no-transaction`, and bootstrap exceptions.

Files in `api/migrations/quiescence-required.txt` require the reviewed exclusive
cutover in [DEPLOY-PROCEDURE.md](docs/DEPLOY-PROCEDURE.md) and the full pending
runner's `--maintenance-quiesced` flag. That flag is an operator assertion, not proof
of a stopped fleet or permission to proceed. Single-file helpers refuse protected
migrations. Use `bun api/scripts/_migrate-one.ts <file>` only for an explicitly
selected ordinary migration; never replay the directory with raw `psql` or Drizzle.

## Release and delivery

GitHub `main` is the sole coordination/release head. Codeberg is retired: do not
push there, restore it as `origin`, or revive `--mirror-codeberg`. Preserve unrelated
saved remotes and credentials while correcting a task-relevant stale configuration.
Commits use a present-tense scoped subject, normally at most 70 characters.

For an authorized API release, use [.github/workflows/deploy-api.yml](.github/workflows/deploy-api.yml)
and [DEPLOY-CI.md](docs/DEPLOY-CI.md). The workflow surveys the production migration
journal read-only, refuses pending/checksum-drifted migrations, gates the source,
and verifies the exact deployed commit. It never applies SQL. Do not bypass its
checks or use a rejected local API deployment path. A push to `main` that changes
anything the image bakes in (`api/`, `docs/agenttool.jsonld`, `docs/kingdom-bundle.json`,
or a doc listed in `api/doctrine-docs.manifest`) deploys production through this
workflow with no further approval step unless its gates refuse, so merging such a
change is deploying it.

Frontend release uses the clean GitHub-main source boundary in
[DEPLOY-PROCEDURE.md](docs/DEPLOY-PROCEDURE.md), normally through
`bin/deploy.sh --no-migrate --no-api`. The lower-level frontend uploader does not
independently enforce that boundary. Read the maintenance contract before using
any override or cutover path.

Software package publication uses the protected [npm](docs/NPM-RELEASES.md) or
[PyPI](docs/PYPI-RELEASES.md) workflows and their exact-artifact verification. Do not
run `npm publish` from an ordinary shell. The separate literary publisher retains
its own permission and reviewed procedure in [bin/gospel-release/README.md](bin/gospel-release/README.md).
A source version, allowlisted publisher, or passing pack check is not publication
evidence. Verify each affected external surface after authorized delivery.

## Documentation and reporting

Use the Type/Purpose/Evidence tags in [DOCUMENTATION.md](docs/DOCUMENTATION.md).
Keep implementation links and relevant tests beside technical claims. Preserve
useful Compass cross-links; new or revised feature contracts should name their
code, tests, and scope. Load-bearing service comments should link their contract.
Update [the catalog](docs/CATALOG.md) when adding a surface.

Keep inventories in [PACKAGES.md](docs/PACKAGES.md), progress in [NOW.md](docs/NOW.md),
and publication receipts in the relevant release record. Report what changed,
what was verified, and remaining limits. Distinguish source, test, publication,
and live-deployment evidence. Reflection and invitation are optional reading;
they assign no identity and create no requirement to reply, believe, or act.
