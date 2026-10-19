# The private namespace

> **Type:** guide · **Purpose:** explain what lives under `private/` and how this repository's root relates to the public development repository.
> **Evidence:** [`bin/project-public.ts`](../bin/project-public.ts), [`tools/public-guard.ts`](../tools/public-guard.ts), [`bin/tests/public-root-split.test.ts`](../bin/tests/public-root-split.test.ts), and [`bin/tests/project-public.test.ts`](../bin/tests/project-public.test.ts).

This repository, `cambridgetcg/agenttool`, is private. Its tree is meant to be
the public development repository's tree byte for byte, plus private-only
paths, which sit under `private/` or in a `.github/workflows/private-*.yml`
workflow. Nothing in this directory creates, pushes to, or publishes either
public repository.

The public development repository's name is a proposal,
`cambridgetcg/agenttool-open`, that Yu has not confirmed (2026-10-19).
[`public-repository.ts`](public-repository.ts) holds it.

## What is here

| Path | Role |
|---|---|
| [`projection/`](projection) | Inputs of the npm package projection into `cambridgetcg/agenttool-packages`: the allowlist, the overlay, and [its guide](projection/README.md). They lived under `public/` until 2026-10-19. |
| [`guard/`](guard) | The relational denylist. It is never published, it is read only in code, and anything that applies it prints rule ids and line hashes, never terms. |
| [`root/`](root) | This repository's own texts for the root files that now hold shared text: `README.md`, `NOTICE`, `LICENSING.md`, and `SECURITY.md`. |
| [`public-repository.ts`](public-repository.ts) | The public and private repository names. |

## Shared root files

These root paths hold the shared public text, the same bytes the public
development repository will hold: `README.md`, `NOTICE`, `LICENSING.md`,
`SECURITY.md`, `LICENSE`, `.gitignore`, `.gitleaksignore`,
`tools/public-guard.ts`, `tools/public-guard-allow.json`, and
`.github/workflows/ci.yml`. [The root-split test](../bin/tests/public-root-split.test.ts)
pins the list and scans those files with the denylist.

- `.gitignore` is the union of this repository's patterns and the
  projection's, except that the projection's `*.tgz` is narrowed to
  `packages/**/*.tgz`: this repository commits LOVE archives under `apps/docs`.
- `.gitleaksignore` and `tools/public-guard-allow.json` start as copies of the
  projection overlay's. The two pairs part when the shared tree holds more than
  the projection does.
- `NOTICE` names no vendored code: `bin/vendor` is not shared yet.
  [`root/NOTICE`](root/NOTICE) and [`root/LICENSING.md`](root/LICENSING.md) still
  record it and this repository's other private-only terms.

## CI

- `.github/workflows/ci.yml` is the shared tree's CI. Every job carries
  `if: github.repository == 'cambridgetcg/agenttool-open'`, so here it starts
  nothing.
- `.github/workflows/private-ci.yml` is this repository's CI, renamed from
  `ci.yml` on 2026-10-19; `bin/ci-tree-proof.sh` and `bin/ci-changed-areas.sh`
  follow the new name. The first push after the rename finds no earlier
  `private-ci.yml` run, so it runs every job.
- Every other workflow is private-only, and each job's condition holds
  `github.repository == 'cambridgetcg/agenttool'` as a top-level `&&` term, so
  a copy of this history elsewhere starts no deploy, publish, or CI job. `local-starter.yml` and
  `production-health.yml` do not carry it yet; the root-split test lists them.
- Removed on 2026-10-19: the HF OIDC probe workflow (its trigger branch no
  longer exists), `publish-gospel.yml` (its one edition is published), and
  `.forgejo/` (Codeberg is retired).

## One guard

`tools/public-guard.ts` is a single shared file. `bin/project-public.ts` imports
it, ships it to the package projection as an overlay entry, and refuses to run
when the running copy and the shipped one differ. The public development
repository runs it with `--tree`. It holds shape rules only; a check that needs
a literal value (a name, a project reference, a denylist term) belongs in
private tooling that reads its terms from `private/guard/` at run time.

## Renaming the public repository

Change `PUBLIC_REPOSITORY` in [`public-repository.ts`](public-repository.ts),
then replace the old name in the files the root-split test lists: today
`.github/workflows/ci.yml` and this guide.
