# Operator custody note

> **Type:** reference
> **Purpose:** Keep the operator-only map of local credential custody and provider aliases out of the public documentation.
> **Evidence:** Moved from `docs/STACK.md` §3, §5 and §6 on 2026-10-19 without re-observation; each fact keeps its original date. The same fixed-account mapping was generalized in the public `docs/DEVELOPMENT.md` §5 and four 2026-05-12 `docs/NOW.md` records. Readers of these entries: `bin/migrate-pending.sh`, `bin/deploy.sh`, `bin/frontend-deploy.sh`. Boundary test: `bin/tests/operator-custody-boundary.test.ts`.

**Operator-only. Not published.** This note lives in `infra/`, a top-level area
that the public package projection (`bin/project-public.ts`) never includes,
whatever `public/allowlist.json` says. No Pages project serves it:
`apps/docs`, `apps/dashboard` and `apps/web` upload only files they hold or
symlink one by one, and the API image copies only `api/doctrine-docs.manifest`
entries. Keep it that way: do not symlink it into `apps/`, list it in either
manifest, or quote it in issues, pull requests, commit messages or logs.
`docs/STACK.md` names this file and nothing more.

Until the docs release that follows 2026-10-19, `docs.agenttool.dev/STACK.md`
served the facts below. From that release the docs site no longer serves
`STACK.md`, `DEVELOPMENT.md` or `NOW.md` at all, and `NPM-RELEASES.md` carries
only the release receipts (its runbook is `infra/NPM-RELEASE-RUNBOOK.md`). Earlier
Pages deployments keep their bytes at their own deployment URLs; whether to
delete them is Yu's decision.

## Local Keychain entries on the operator machine

Rows moved from STACK.md §6 ("Key services on this machine"). The generic
`bin/agenttool-secret` CLI uses account `$USER` and sees none of the
fixed-account or `agenttool`-account rows below.

| Service                           | Account                                              | What                                                                                     |
| --------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `agenttool-database-url`          | `$USER` for local API; `macair` for migration runner | Transaction-pooled general/survey URL; never substituted for a session-affine apply      |
| `agenttool-database-session-url`  | `macair` for migration runner                        | Session-pooled URL required by `_migrate-one.ts` and real batch applies                  |
| `agenttool-prod-vault-master-key` | `agenttool`                                          | Recovery copy of Fly `VAULT_MASTER_KEY` (2026-10-12); not read by any tool               |
| `agenttool-prod-platform-signing-key` | `agenttool`                                      | Recovery copy of Fly `AGENTTOOL_PLATFORM_SIGNING_KEY` (2026-10-12); not read by any tool |
| `agenttool-crypto-hd-mainnet` / `-testnet` | `agenttool`                                 | Deposit/payout HD roots; removed from Fly 2026-10-12, so these are the only online copies |
| `agenttool-cloudflare-token`      | `macair` for `frontend-deploy.sh`                    | CF token: Pages Read/Edit, Zone Read, Workers Scripts Edit, and Workers Routes Read/Edit |
| `agenttool-cloudflare-account-id` | `macair` for `frontend-deploy.sh`                    | CF account id                                                                            |

The local pending and one-file migration runners prefer their explicit
database environment variables, then query fixed legacy account `macair`
entries as fallback; `frontend-deploy.sh` likewise has documented environment
inputs and fixed `macair` fallbacks. Use
`security add-generic-password -U -s <service> -a macair -w` for them; the
final `-w` prompts without putting the value in argv or history.

The local keychain is not a mirror of Fly's secret store. Some local items are
deliberate recovery copies of production values (see the table above). Read
those with `security find-generic-password -a <account> -s <service> -w`;
`bin/agenttool-secret` uses account `$USER` and does not see them. On
2026-10-12 `CRYPTO_HD_MNEMONIC` and `CRYPTO_HD_MNEMONIC_TESTNET` were removed
from Fly, so `agenttool-crypto-hd-mainnet` and `agenttool-crypto-hd-testnet`
are their only online copies; keep an offline copy of each.

## Fixed-account Fly import

The exact form of the STACK.md §3 example, which now takes the account as an
argument:

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

## Provider aliases outside the agenttool.dev zone

Moved from STACK.md §5 (first recorded 2026-08-21, `e96e203d`):

The five source-unrecovered Workers had public provider aliases at
`{kingdom-canon,joke,love,party-chain,natlang}.axiepro.workers.dev`, which
bypass `agenttool.dev` zone rules. On 2026-10-20 the aliases and preview URLs of
`kingdom-canon`, `joke`, `love` and `party-chain` were disabled (the Workers are
kept and still serve at `canon`, `joke`, `love` and `party.agenttool.dev`).
`natlang` keeps its alias until the link to it in yutabase's LINKS.md points at
`speak.agenttool.dev`. Undo one with the Workers API:
`POST /accounts/<account>/workers/scripts/<name>/subdomain`
`{"enabled": true, "previews_enabled": true}`. `agenttool-proxy` deliberately has
its `workers.dev` alias disabled and is reached through its apex/www routes.
`agenttool-playground.pages.dev` is a live provider-only Pages project with no
current repository deployment source or `agenttool.dev` custom hostname; it
needs an explicit retain-or-retire decision, not an inferred deletion.
