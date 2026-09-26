# DEPLOY-CI — the API deploys from GitHub Actions

> **Type:** guide · [Reading labels](DOCUMENTATION.md)

Since 2026-09-23 the API (`api/`) is deployed by `.github/workflows/deploy-api.yml`, not by
`bin/deploy.sh` on an operator Mac. Reason: the sanctioned hand path was bound to a user, a
uid, and a byte-pinned flyctl that did not exist on the machine doing the work, so every
release was a bypass. A deploy that only one absent machine can run is not a control; it is a
stall. This path is the boring one TaxSorted has used since July: push to `main`, tests gate,
Fly rolls the machines behind health checks, `/health.build` proves what is live.

## When it runs

- **Push to `main`** touching `api/**`, `docs/**`, `bin/stage-doctrine-docs.sh`, or the workflow
  itself. The gate then compares the commit with the live revision reported by
  `https://api.agenttool.dev/health`; if nothing that reaches the image changed (the `api/`
  tree, `docs/agenttool.jsonld`, `docs/kingdom-bundle.json`, and every file named in
  `api/doctrine-docs.manifest`), it stops as a no-op.
- **Manual** (`Actions → deploy-api → Run workflow`) with a strategy (`rolling` default,
  `immediate` for emergencies) and `force` to redeploy an unchanged tree.

## What it refuses

- **Pending migrations.** Every run asks the production migration journal through the repo's own
  `bin/migrate-pending.sh --dry-run`, using the read-only Postgres role `migration_survey`
  (it can `SELECT meta._migrations` and nothing else; URL in the `MIGRATION_SURVEY_DATABASE_URL`
  secret and in the keychain as `agenttool-migration-survey-url`). Any pending or checksum-drifted
  file refuses the deploy, whatever git says. Apply by hand first (`DEPLOY-PROCEDURE.md` Phase 1),
  then re-run: once the journal is clean the same commit deploys. This workflow never runs SQL.
- **Missing secrets.** Without `MIGRATION_SURVEY_DATABASE_URL` the gate refuses (it cannot ask the
  journal, so it fails closed). `FLY_API_TOKEN` must be an app-scoped Fly *deploy* token for
  `agenttool` (`fly tokens create deploy -a agenttool -n github-actions-deploy-api`); it can build
  and deploy this app and nothing else.
- **Unknown live revision.** If `/health` reports a revision this clone does not have, the no-op
  optimisation is skipped and the commit deploys, still behind the journal survey and the tests.

## What it proves

The image is built remotely from the exact commit with `AGENTTOOL_GIT_REVISION=<sha>` and
`AGENTTOOL_SOURCE_DIRTY=false`. After the rollout, every started `app` Machine is asked directly
(`fly-force-instance-id`) for `/health` until it reports that exact commit with `dirty=false`, and
then for `/public/window`, a route that reads Postgres, so a deploy whose image cannot reach the
database does not pass. A live build marked `dirty=true` is never treated as a no-op; it is replaced
by a clean build. The run's step summary is the receipt and lists the fleet as it was before, with
the rollback command.

## Rollback

Previous images stay in the Fly registry. From the receipt, take a previous image ref and run:

```
flyctl deploy --app agenttool --config api/fly.toml --image <previous image ref> --strategy rolling
```

## What did not change

- `bin/deploy.sh` still exists and still owns migrations and the frontend phases. Its API phase
  is superseded; do not use it to deploy the API from a machine it refuses.
- Frontend (`apps/web`, docs mirror, apex worker) still deploys through `bin/frontend-deploy.sh`
  with wrangler OAuth until a Cloudflare API token is minted for Actions.
- Thinker machines are part of the same Fly app and roll with the app; a stopped thinker gets
  the new image and stays stopped.
