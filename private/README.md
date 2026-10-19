# The private namespace

> **Type:** guide · **Purpose:** explain what lives under `private/` and how this repository's root relates to the public development repository.
> **Evidence:** [`bin/project-public.ts`](../bin/project-public.ts), [`tools/public-guard.ts`](../tools/public-guard.ts), [`bin/tests/public-root-split.test.ts`](../bin/tests/public-root-split.test.ts), [`bin/tests/project-public.test.ts`](../bin/tests/project-public.test.ts), and [`bin/tests/`](bin/tests).

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
| [`projection/`](projection) | Inputs of the npm package projection into `cambridgetcg/agenttool-packages`: the allowlist, the overlay, and [its guide](projection/README.md). They lived under `public/` until 2026-10-19. The allowlist also drives the export (below). |
| [`guard/`](guard) | The relational denylist and `literal-sha256.json`, the SHA-256 digests of literal values (owner addresses, development machines' account names, the database project reference). Never published, read only in code; anything that applies them prints rule ids and line hashes, never terms. |
| `CANARY` | 32 random bytes. Their blob id, never the bytes, is listed in `tools/leak-canaries.txt`, so any copy that reaches a public tree is found. |
| [`root/`](root) | This repository's own texts for the root files that now hold shared text: `README.md`, `NOTICE`, `LICENSING.md`, and `SECURITY.md`. |
| [`bin/`](bin) | The one-way tooling, below. |
| [`githooks/`](githooks) | This repository's `pre-commit` and `pre-push`, run from a pinned copy. |
| [`public-repository.ts`](public-repository.ts) | The public and private repository names. |
| `export/public-root.txt` | Written by the adoption merge: the public root commit. Absent until then. |

## Shared root files and the shared scope

One file, [`projection/allowlist.json`](projection/allowlist.json), drives both
the npm projection and the export. Its `export` section lists the shared root
files (the public `README.md`, `SECURITY.md`, CI, the guard, the hooks, and
the rest) and withholds paths the export must not carry yet: `packages/wallet`,
until Yu decides the wallet option.

The **shared scope** is every path under an include entry or listed as an
export root file, minus the withheld paths, plus every path the last merged
public tip holds. Shared paths change only in the public repository. An add
under a shared tree here counts the same as an edit: the pre-commit hook, the
pre-push hook, and the merge-back drift check all refuse it.

- `.gitignore` is the union of this repository's patterns and the
  projection's, except that the projection's `*.tgz` is narrowed to
  `packages/**/*.tgz`: this repository commits LOVE archives under `apps/docs`.
- `.gitleaksignore` and `tools/public-guard-allow.json` start as copies of the
  projection overlay's.
- `NOTICE` names no vendored code: `bin/vendor` is not shared yet.

## CI

- `.github/workflows/ci.yml` (the shared CI) and `.github/workflows/public-watch.yml`
  (a scheduled check of every public branch and pull request head: one root,
  no canary object, no private-only path in any history) are the shared
  tree's workflows. Every job carries
  `if: github.repository == 'cambridgetcg/agenttool-open'`, so here they start
  nothing. [`tools/workflow-lint.ts`](../tools/workflow-lint.ts) enforces that in
  the shared CI and refuses secrets, deploys, write permissions, and unpinned actions.
- `.github/workflows/private-ci.yml` is this repository's CI. Every other
  workflow is private-only, and each job's condition holds
  `github.repository == 'cambridgetcg/agenttool'`; `local-starter.yml` and
  `production-health.yml` do not carry it yet (handed off).

## One guard, shapes only

`tools/public-guard.ts` is a single shared file that holds shape rules only:
credential formats (including AgentTool's own token shapes), home paths,
email addresses, the private namespace, the canary list, and one root. Any
check that needs a literal value lives in
[`bin/relational-scan.ts`](bin/relational-scan.ts), which loads its terms from
`guard/` at run time.

## Tooling

| Tool | What it does | Runs where |
|---|---|---|
| [`bin/public-export.ts`](bin/public-export.ts) | Writes shared-scope blobs from one commit into a public clone as plain files (`git ls-tree`/`cat-file`, no checkout, no symlink), after every guard layer; proves the clone's index equals the source entries. `--init` for the public root, `--upstream --paths` for a fix or a widening. | the designated machine |
| [`bin/shared-scope.ts`](bin/shared-scope.ts) | Lists the scope, reports drift, checks staged changes and merge results. | hooks, merge-back |
| [`bin/relational-scan.ts`](bin/relational-scan.ts) | The private scan: terms, joined path and ref names, literal digests, withheld files, the canary, commit and tag messages, and pull request and issue text through `gh api --method GET`. | hooks, export, merge-back, daily scan |
| [`bin/merge-back.sh`](bin/merge-back.sh) | One merge of public main into main, base from `git merge-base`, with the incoming scan, drift check, invariants, and gate; pushes only with `--push`. | the merge clone only |
| [`bin/scan-public.sh`](bin/scan-public.sh) | The daily scan of every public ref and of pull request and issue text, in its own mirror; alerts until handled. | launchd on the designated machine |
| [`bin/public-clone.sh`](bin/public-clone.sh) | A fresh development clone with a repo-local noreply identity and the pinned public hook. | any maintainer machine |
| [`bin/install-guards.sh`](bin/install-guards.sh) | Pins the hooks from one reviewed commit into `~/.local/share/agenttool/public-guards/<commit>/` and points checkouts at them. | each machine, with the owner's go |
| [`bin/public-settings.ts`](bin/public-settings.ts) | The public repository's rulesets, security, and Actions settings as a reviewed request list; prints them by default. | once, after the public flip |

None of these has run against a real public repository; the tests in
[`bin/tests/`](bin/tests) run them on scratch repositories only.

Before a projection once `public-sync` exists, check the source against it:
`bun private/bin/shared-scope.ts drift --public origin/public-sync --private <source>`.

## When something stops

- **Drift** (merge-back exit 4): revert the shared change here and make it in
  the public repository. A *collision* (the public side added a path this
  repository holds privately) is resolved by moving the private file under
  `private/`.
- **A conflict** (exit 5) usually means a private file sits in a directory the
  public side moved: relocate it under `private/` first. Public wins on shared
  paths.
- **A scan hit** (exit 3, a hook refusal, or a daily alert): do not merge. When
  the hit is an allowed line that moved, update its allow entry in
  `guard/` here first, then push the public change.

## Renaming the public repository

Change `PUBLIC_REPOSITORY` in [`public-repository.ts`](public-repository.ts),
then replace the old name in the files the root-split test lists: today
`.github/workflows/ci.yml`, `.github/workflows/public-watch.yml`, and this
guide. Tools read the constant.
