# DEPLOY-CI — the API deploys from GitHub Actions

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

- **Pending migrations.** If any file under `api/migrations/` differs between the live revision
  and the commit, the gate fails with the list. Apply them by hand first
  (`bin/migrate-pending.sh`, see `DEPLOY-PROCEDURE.md` Phase 1), then re-run. Migrations stay a
  deliberate act; this workflow never runs SQL.
- **Missing token.** `FLY_API_TOKEN` must be an app-scoped Fly *deploy* token for `agenttool`
  (`fly tokens create deploy -a agenttool -n github-actions-deploy-api`). It can build and deploy
  this app and nothing else.

## What it proves

The image is built remotely from the exact commit with `AGENTTOOL_GIT_REVISION=<sha>` and
`AGENTTOOL_SOURCE_DIRTY=false`. The verify step polls `/health` until `build.revision` equals the
commit and `build.dirty` is `false`; the run's step summary is the receipt and lists the fleet
as it was before, with the rollback command.

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
