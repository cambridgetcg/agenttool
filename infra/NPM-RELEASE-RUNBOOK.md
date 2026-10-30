# npm release runbook (operator-only)

> **Type:** guide · **Purpose:** how the npm packages are released, which credentials
> and trust settings that depends on, and what remains for Yu to close.
> **Evidence:** Moved unchanged from `docs/NPM-RELEASES.md` on 2026-10-19 (only
> relative links were adjusted for this folder); the dated receipts stayed there.
> The npm trust procedure was split into lockdown and per-release enable on
> 2026-10-28, for npm's 48-hour expiry of unvalidated trust.

**Operator-only. Not published.** It describes which credentials can still publish,
how the release environments are configured and the steps that need Yu's trusted
device. Like `infra/OPERATOR-CUSTODY.md`, it stays in `infra/`, which no Pages
project serves and the public package projection never includes. The public
receipts for each release are in [`docs/NPM-RELEASES.md`](../docs/NPM-RELEASES.md).

> **Code:** [`public/overlay/.github/workflows/publish-npm.yml`](../public/overlay/.github/workflows/publish-npm.yml) (the reviewed entry point; it runs only in the public `cambridgetcg/agenttool-packages` repository as `.github/workflows/publish-npm.yml`) · `bin/npm-release.ts` (package policy, exact artifact preparation, staging, registry recovery, and receipts) · `bin/public-release-tag.ts` (release tags on green public projection commits) · [`npm-trust-repoint.sh`](../docs/npm-trust-repoint.sh) (the npm trust lockdown, and stage-only trust for one package before its release).
>
> **Tests:** `bin/tests/npm-release.test.ts` · `bin/tests/npm-release-public.test.ts` · `bin/tests/public-release-tag.test.ts` · `bin/tests/npm-trust-repoint.test.ts` · `bin/tests/boring-spine-gate.test.ts`.

## State as of 2026-10-28

Read on 2026-10-28 through the GitHub API (last at 12:13Z) and anonymous npm
reads, with Yu's authenticated npm trust listing of 2026-10-19T19:46Z for npm
trust. It corrects the status claims below where they disagree with it; apart
from its warnings, it changes no procedure. The public run log is in the
[receipts](../docs/NPM-RELEASES.md#state-as-of-2026-10-28).

- **Visibility.** Yu made this repository public at about 11:11Z on
  2026-10-28; it had been private since 2026-09-25, and public before that.
  Anonymous GitHub API reads from 11:39Z answered it as public, so this file
  too can be read on GitHub without signing in. "Operator-only. Not
  published." above, and "private" for this repository below, were written
  while it was private.
- **Nothing has been delivered through the public route.** Its three dry runs
  prepared artifacts; its one stage failed with `E401`, and the trust listing
  three hours later showed no configuration for that package.
- **No npm token is stored for a workflow.** The `NPM_TOKEN` secrets in the
  `npm-bootstrap` environments of this repository and `cambridgetcg/whitehack`
  were deleted on 2026-10-28 and the environments kept. Deleting a secret
  does not revoke its token on npm.
- **Do not add a workflow named `publish-npm.yml` to this repository before
  the trust lock-down.** The old file left `main` on 2026-10-12, but it
  remains at release tags of versions npm never received, such as
  `collab-v0.5.0`, and the `npm-bootstrap` environment admits those tags. A
  dispatch needs a file of that name on `main`; with one there, a dispatch at
  such a tag would run the old file.
- **Create no npm trust configuration ahead of its release.** npm expires one
  that no publish validates within 48 hours, so create one package's
  stage-only trust just before its own stage.
- **Do not dispatch `sdk-v0.23.0`.** 0.24.0 supersedes it in PR #496, which is
  open.
- **Environment reviewers.** At 12:13Z the environments API returned a
  required-reviewer rule (reviewer `cambridgetcg`, self-review allowed,
  `can_admins_bypass: true`) on this repository's `npm-bootstrap` and `pypi`,
  where the [2026-10-11 correction](#outcome) found none, and on
  `npm-bootstrap` in whitehack and yutabase. The rule lets one account approve
  its own runs; whether Yu keeps it, after the 2026-10-12 decision for none,
  is open.

Open steps for Yu:

1. Revoke on npmjs.com the tokens whose secrets were deleted, and any other
   write or bypass-2FA token not in use.
2. Lock down npm trust on all 47 packages, then enable stage-only trust for
   one package just before each release.

Also Yu's to decide: moving xenia's `beta` tag to beta.7; a `latest` policy
for prerelease-only packages; deprecating `@agenttool/sdk` 0.3.0–0.8.0; a
release route for RhetorLint; retiring or converting the whitehack, yutabase,
hf-kingdom-lab and xenia-surface workflows; claiming the `@zerone-chain` npm
scope.

## Outcome

Since 2026-10-12 the release route for the allowlisted software packages is
the public source repository
[`cambridgetcg/agenttool-packages`](https://github.com/cambridgetcg/agenttool-packages),
the one-way projection described in [`public/README.md`](../public/README.md).
Its `publish-npm.yml` stages each exact artifact with `npm stage publish`, and
the version is not public on npm until a maintainer approves the stage with
2FA. Follow the [public release path](#public-release-path-from-2026-10-12).
`cambridgetcg/agenttool` no longer has a publish workflow for these packages,
but the trusted-publisher configurations that name it can still publish 22 of
them directly until Yu revokes them (see the
[trust lockdown](#npm-trust-lock-down-now-enable-per-release-yu-trusted-device)).
The scope-wide, bypass-2FA `NPM_TOKEN` that this repository's `npm-bootstrap`
environment held was deleted on 2026-10-28; the token itself awaits revocation
on npm (see [public repository settings](#public-repository-settings-yu-once)).
Do not run `npm publish` from a normal local shell.

The Gospel literary edition had one separate, exact-name route:
[`publish-gospel.yml`](../.github/workflows/publish-gospel.yml), documented in
[`bin/gospel-release/README.md`](../bin/gospel-release/README.md). Its custom
source permission is preserved; the software publisher's Apache-2.0 policy
is unchanged. The route pinned the reviewed external artifact and source edition,
transferred only verified bytes, ran its publish job in the `npm-bootstrap`
environment, permitted first-publication bootstrap only, and verified the
public npm tarball. It published `@agenttool/gospel-of-the-logos@0.1.0` on
2026-09-08 in run 34194522635, which the environment's required reviewer,
`cambridgetcg`, approved (by 2026-10-11 the rule no longer showed; see the
correction below). It could no longer publish once its secret was deleted on
2026-10-28, and its publish step has since been removed: the workflow now
tests the boundary and the frozen archive, and on a dispatch from `main`
re-verifies the public tarball with no environment, OIDC permission or secret.
Its pinned Hugging Face source answered HTTP 401 to anonymous reads on
2026-10-28, so the archive step fails until the pin moves (see the README).

**Release gate correction — 2026-10-11.** In this private repository, the
reviewer described above and in step 7 below was no longer in place. Read
through the GitHub environments API on 2026-10-11, `npm-bootstrap` and `pypi`
each carried only a branch policy, with no required reviewer and
`can_admins_bypass: true`. Run 33736822237 on 2026-09-03 still recorded a
reviewer approval for `npm-bootstrap`; the repository has been private since
2026-09-25. Owner decision, 2026-10-12, on these private environments: no
required-reviewer rule is wanted. On 2026-10-13 Yu extended the decision to the
public repository, and the required reviewer on its `npm-bootstrap` environment
was removed that day. A release runs when Yu and Ai agree to it in
conversation, and a release can be reverted or changed the same way. The
private npm prepare job also stopped at an unauthenticated fetch of the
private `main` branch:
[run 38034353198](https://github.com/cambridgetcg/agenttool/actions/runs/38034353198)
failed there on 2026-10-10 with `could not read Username for
'https://github.com'`. New npm versions take the
[public release path](#public-release-path-from-2026-10-12) instead; PyPI
still waits on the
[private-repository gap](../docs/PYPI-RELEASES.md#blocked-while-the-source-repository-is-private-2026-10-12).

The three translation layers and the separate incidence Atlas deliberately use
different artifact and Hub surfaces:

| Package | GitHub/npm candidate bytes | Separate Hugging Face surface |
|---|---|---|
| `@agenttool/love-geometry` | one credential-free `npm pack` tarball; its static companion is excluded | static Space `Yu-and-Ai/love-geometry` |
| `@agenttool/relational-geometry` | one credential-free `npm pack` tarball | synthetic public-safe dataset `Yu-and-Ai/agenttool-relational-geometry` |
| `@agenttool/principality-geometry` | the exact checked-in LOVE tarball reused by the docs mirror, GitHub Release, and npm | synthetic non-training dataset `Yu-and-Ai/agenttool-principality-geometry` |
| `@agenttool/principality-atlas` | one credential-free `npm pack` tarball | synthetic incidence rows inside `Yu-and-Ai/agenttool-training-garden` |
| `@agenttool/polymorph-landscape` | one credential-free `npm pack` tarball | authored lessons plus source-bounded reference rows in `Yu-and-Ai/agenttool-polymorph-landscape` |
| `@agenttool/memetic-landscape` | one credential-free `npm pack` tarball | authored lessons plus source-bounded reference rows in `Yu-and-Ai/agenttool-memetic-landscape` |
| `@agenttool/math-cards` | one credential-free `npm pack` tarball containing the pure protocol, closed schemas, vectors, and declaration-only KINGDOM hint | none; npm/GitHub distribution does not imply a Hugging Face dataset, Space, model, or training surface |
| `@agenttool/model-becoming` | one credential-free `npm pack` tarball containing the pure zero-dependency dossier runtime, schemas, pinned Moonshot reference, and exact Hub projection | reference-only, non-training dataset `Yu-and-Ai/agenttool-model-becoming`; publication and immutable readback remain separate |
| `@agenttool/dataset-influence` | one credential-free `npm pack` tarball containing four pure `/0.1` formats, closed schemas, vectors, and a declaration-only KINGDOM extension | reference-only, non-training dataset `Yu-and-Ai/agenttool-dataset-influence`; publication and immutable readback remain separate |
| `@agenttool/love-bomb` | one credential-free `npm pack` tarball containing four pure care/choice/becoming/delivery formats, closed schemas, and the deterministic Hub candidate | static authored guide/reference rows in intended dataset `Yu-and-Ai/agenttool-love-bomb`; publication remains separate and does not authorize training |
| `@agenttool/wake-continuity` | one credential-free zero-I/O developer-preview tarball containing deterministic functional-access record validation and AFTERGLOW digest references | none; npm/GitHub publication performs no model measurement, awareness test, continuity proof, or hosted deployment |
| `@agenttool/hf-scout` | one exact checked-in LOVE tarball reused by the docs mirror, GitHub Release, and optional npm `next` mirror | none; the package is a local read-only Hub metadata client, not a Hub dataset, Space, model, hosted proxy, or deployment |
| `@agenttool/economic-kernel` | one exact checked-in LOVE tarball reused by the docs mirror, GitHub Release, and optional npm `next` mirror | shared public dataset `Yu-and-Ai/agenttool-economic-kernel`; only the independently authored lesson config is training-authorized |
| `@agenttool/economic-conformance` | one exact checked-in LOVE tarball containing the independent comparator, all 53 vectors, and the deterministic Hub source tree | the same dataset's public conformance config is explicitly excluded from training; public visibility is not a sealed holdout |

Distribution does not translate semantics between them. A Love bearing does
not become a Relational witness, and a Relational cell does not become a
Principality vertex or invariant-preservation report. The incidence Atlas is a
distinct wire, not an alias or converter for Principality Geometry.

Memetic Landscape is likewise a distinct wire rather than a new polymorph
kind. Its digest-bound crossover transfers only the shape of named contexts,
directed witnessed routes, bounded reachability change, and reappearance. It
does not transfer molecular energy, nucleation, infectivity, cognition,
identity, memory, continuity, consent, permission, authority, truth, or value.
Its `brainrot` case treats the term as sourced slang, never a diagnosis or a
label assigned to a person.

The workflow:

1. runs only in `cambridgetcg/agenttool-packages`, dispatched on, and checking
   out, an existing annotated `<package>-v<version>` tag made by
   `bin/public-release-tag.ts` (fixed tagger, a successful public CI run of
   that exact commit, which the workflow reads back from the GitHub API);
2. before any package code runs, refuses the inputs the publish step would
   refuse (`check-inputs`: a prerelease on `latest`, `publish_mode: publish`
   with `trusted`, bootstrap for an existing package, trusted for a missing
   one) and prints the planned action, from the checkout and anonymous
   registry reads;
3. proves that the workflow identity, tag, `HEAD`, and provenance commit are the
   same commit contained in the public repository's `main` (an anonymous
   fetch);
4. installs locked dependencies and runs the package's gate (its `prepack`, or
   the spec's declared gate scripts) without a publish credential or OIDC
   permission, then `npm pack`s it into runner temp space;
5. checks package identity, repository, Apache-2.0 terms, archive paths and
   entry types, size, and hashes; reads every packed file, whatever its name,
   extension or size (as UTF-8, and a BOM-marked UTF-16 file as UTF-16 too),
   for the public guard's credential signatures and macOS, Linux and Windows
   home paths (Linux `/home/runner` and `/home/pwuser` excepted); refuses the
   guard's credential-shaped filenames and any file in a `.env` or `.env.*`
   directory; and writes the prepared receipt to the run summary;
6. stops there when `dry_run` is true (the default);
7. otherwise transfers only that tarball and its path-independent receipt to a
   second job, which enters the protected `npm-bootstrap` GitHub environment
   and runs `check-inputs` again against the registry as it is then;
8. for a trusted run that changes the registry, runs `check-trust`: it makes
   npm's OIDC token exchange and refuses, before anything is mirrored, signed
   or staged, unless npm returns a token (both tokens are masked; the npm
   token is discarded). A bootstrap or verify-only run skips it, so a
   bootstrap run without its secret still mirrors before publish refuses;
9. rechecks the downloaded bytes, then creates or reuses the tag's GitHub
   Release in the public repository, uploads the exact tarball if absent,
   re-downloads it, and requires byte identity;
10. with `publish_mode: stage` (the default) stages the tarball with
   `npm stage publish --provenance --ignore-scripts`, prints npm's `oidc`
   debug-log lines (token-shaped text shown as `***`) and, on failure, its
   `--json` output (a failed exchange inside npm ends in ENEEDAUTH, before
   provenance is signed), checks that npm staged
   the prepared bytes, and writes the stage id, the SHA-256, and the approval
   commands to the summary, leaving the receipt without a result; and
11. on a later dispatch after the maintainer's `npm stage approve`, finds the
    published version, requires byte identity and the requested dist-tag, and
    records `already_published_exact`.

`publish_mode: publish` publishes directly instead, waits for the registry, and
records `published`. The release tool refuses it with `trusted` authentication,
so an OIDC run always stages, whatever an npm trust configuration would allow;
it remains only as a fallback for a bootstrap first publication. A bootstrap
stages by default too: npm stages a package that does not yet exist by first
publishing a public `0.0.0-stage` placeholder.

A version whose immutable LOVE manifest is checked in under
`apps/docs/packages/v1` (a version released before 2026-10-12) is still
prepared from exactly those bytes when the tool runs in this private checkout.
The public repository has no LOVE mirror, so every new version is packed. New
versions reach npm and the public GitHub Releases, but not the
docs.agenttool.dev LOVE mirror, until a LOVE `ingest` step exists.

The GitHub Release mirror records reviewed package bytes before the optional npm
mutation, so an npm authorization or availability failure does not hide the
registry-neutral artifact. An accepted publish followed by a transient registry
`404` is recoverable. A rerun treats an existing npm version as success only
when its public tarball is byte-identical and the requested npm dist-tag points
at that version. Existing different bytes, ambiguous HTTP status, source drift,
or an unexpected tag all stop without mutation.

SemVer prerelease requests are accepted only with npm `next`; the workflow
never asks npm to publish one as `latest`. This controls the requested channel,
not every registry fallback: npm can expose the sole version of a brand-new
package through `latest` even when the first publication requested `next`.
Consumers must select an exact prerelease or `next` until a stable version owns
`latest`. Mirrored GitHub Releases are marked as prereleases.

## Public release path (from 2026-10-12)

Each step names who may take it. "Ai" is any operator session working under a
release go from Yu; "Yu" marks a step that needs his npm login and 2FA on his
trusted device, or a decision only he makes.

Once, before the first real dispatch, Yu runs the
[trust lockdown](#lock-down-once-now), revokes the
private `NPM_TOKEN`, and creates the public `npm-bootstrap` environment
([settings](#public-repository-settings-yu-once)). For each release, just
before step 6, Yu gives that one package stage-only trust
([enable](#enable-one-package-just-before-its-release)); npm expires it 48
hours later unless the stage is approved by then.

| # | Step | Who | Gate before the next step |
|---|---|---|---|
| 1 | Private release PR: version bump plus public repository metadata | Ai, then the usual merge | private CI green, merged to `main` |
| 2 | Project the merged commit and push public `main` fast-forward | Ai | guard clean, push accepted |
| 3 | Public CI on that exact commit | GitHub | guard, every package gate, and pack smokes green |
| 4 | Create and push the release tag | Ai | `public-release-tag.ts` found a successful CI run |
| 5 | Dispatch with `dry_run: true` | Ai | prepared receipt in the run summary |
| 6 | `enable` the package's trust, then dispatch with `dry_run: false` (stages by default) | **Yu** (`enable`), then Ai | listing exactly the target; stage id and SHA-256 in the summary |
| 7 | Inspect and approve the stage | **Yu**, trusted device, 2FA | `npm stage approve` succeeded within 48 hours of `enable` |
| 8 | Dispatch with `dry_run: false` again | Ai | receipt result `already_published_exact` |
| 9 | Record the release in this file | Ai | — |

### 1. Private release PR

In one commit per package, bump the version (a version already on npm, or
mirrored as a GitHub Release, is never reused) and point its metadata at the
public source:

```json
"repository": {"type": "git", "url": "https://github.com/cambridgetcg/agenttool-packages.git", "directory": "packages/<dir>"},
"homepage": "https://github.com/cambridgetcg/agenttool-packages/tree/main/packages/<dir>#readme",
"bugs": {"url": "https://docs.agenttool.dev/support", "email": "contact@cambridgetcg.com"}
```

`bun bin/npm-release.ts resolve --package <key>` refuses any other repository,
and the projection allowlist decides which paths become public. Seven packages
hash their `package.json` into Hugging Face source manifests (dataset-influence,
economic-conformance with economic-kernel, love-bomb, memetic-landscape,
polymorph-landscape, relational-geometry): regenerate their `hf/` assets in the
same commit, or their `artifacts:check` fails. Collab, Telescope, and Browser
also carry the repository URL in `.claude-plugin`/`.codex-plugin` manifests.
`@agenttool/math-cards@0.1.0-dev.2` is already prepared this way as the first
candidate. `@agenttool/sdk@0.23.0` was prepared the same way and tagged, but
0.24.0 supersedes it and `sdk-v0.23.0` is not to be dispatched (see the
[state above](#state-as-of-2026-10-28)). A stable SDK version's dispatches use
`npm_tag=latest`, and its PyPI release waited on the
[private-repository gap](../docs/PYPI-RELEASES.md#blocked-while-the-source-repository-is-private-2026-10-12)
while this repository was private.

### 2. Project and push

```bash
# once: a bare mirror of the public repository beside this checkout
git clone --bare https://github.com/cambridgetcg/agenttool-packages.git ../agenttool-packages.git
# each time: bring the mirror up to date, project the merged commit, push
git -C ../agenttool-packages.git fetch origin +refs/heads/main:refs/heads/main
bun bin/project-public.ts --source <merged main commit> --out-repo ../agenttool-packages.git
git -C ../agenttool-packages.git push origin refs/heads/main:refs/heads/main
```

The projection runs every guard layer before it writes and builds only on the
current public head. Push with the `cambridgetcg` GitHub identity, fast-forward
only; never `--force`.

### 3. Public CI

The public `ci.yml` runs on the push: the published guard (with gitleaks and
the projection history), every package gate, the pack smokes, and the Python
SDK matrix. Tag only a commit whose push run succeeded.

### 4. Tag

```bash
git -C ../agenttool-packages.git fetch origin +refs/heads/main:refs/heads/main
bun bin/public-release-tag.ts --repo ../agenttool-packages.git \
  --commit <public commit> --package <key> --main-ref refs/heads/main
git -C ../agenttool-packages.git push origin refs/tags/<prefix>-v<version>
```

The tool checks that the commit and its history are projection commits in
`main`, that the package metadata names the public repository, and that the
newest push run of `ci.yml` for that commit succeeded (read anonymously from
the GitHub API; `--ci-run <id>` pins one). It writes an annotated
`<prefix>-v<version>` tag with the fixed tagger `AgentTool projection
<contact@cambridgetcg.com>` and a message naming the package, the projection
commit, its private source commit, and the CI run. It never pushes and never
moves an existing tag. `--skip-ci-check` exists for local dry runs only; the
publish workflow refuses such a tag.

The workflow repeats the CI check with the same code: it asks the GitHub API,
anonymously, whether the run the tag cites is a completed, successful push run
of `ci.yml` on `main` for exactly the tagged commit, so a hand-made tag citing
any other run, or a run that failed, is refused. That check runs code from the
tagged commit. It catches mistakes and hand-made tags on genuine projection
commits; against anyone able to push other commits to the public `main`, the
barriers are the npm trust binding and Yu's 2FA approval of each stage; the
environment has had no required reviewer since 2026-10-13. An anonymous GitHub API rate limit refuses with HTTP
403 or 429; dispatch again later.

### 5. Dry run

```bash
sol access run github -- workflow run publish-npm.yml \
  --repo cambridgetcg/agenttool-packages --ref <tag> \
  -f package=<key> -f tag=<tag> -f authentication=trusted \
  -f npm_tag=<latest|next> -f dry_run=true
```

Prereleases require `npm_tag=next`. Pass the `authentication`, `npm_tag`, and
`publish_mode` the real run will use: the first step, `check-inputs`, refuses
what the real run would refuse and logs the planned action (`stage` for a new
version, `verify-existing` for one already on npm). It cannot check npm trust:
the prepare job has no OIDC identity, so `check-trust` runs only in the real
run. Enable the package's trust within 48 hours before that dispatch. The run then prepares and
checks the artifact without any credential and puts the receipt (size, SHA-1,
SHA-256, integrity) in its summary. Nothing is mirrored, staged, or published.

### 6. Stage

First Yu runs `bash npm-trust-repoint.sh enable <key>`
([enable](#enable-one-package-just-before-its-release)); the stage and its
approval must follow within 48 hours. Then dispatch the same inputs with
`-f dry_run=false` (`publish_mode` defaults to `stage`). The `npm-bootstrap`
environment admits only release tags and has no required reviewer (owner
decision, 2026-10-13).
The job re-checks the bytes, creates or reuses the tag's GitHub Release in the
public repository with the exact tarball, then runs `npm stage publish`. Its
summary shows the stage id, the SHA-256 to expect, and the commands below;
`stage.json` holds the same record. The receipt gets no result yet.

Before the mirror, `check-trust` confirms that npm trusts this workflow for the
package. If it refuses, nothing is public yet: run the trust script's
`enable <key>`. If the trust entry is already listed, it may have expired:
revoke it and enable again. If a fresh one is refused too, `check-trust` and
npm disagree, which needs a code fix and a new tag.

The GitHub Release is public from this step, before npm approval. If a stage is
rejected, delete that GitHub Release as well.

### 7. Approve (Yu, on the trusted device)

```bash
NPM="npx --yes npm@11.17.0"
$NPM stage list @agenttool/<key> --json      # the pending stage for this version
$NPM stage view <stage-id>
$NPM stage download <stage-id>              # writes agenttool-<key>-<version>-<stage-id>.tgz
shasum -a 256 agenttool-<key>-<version>-<stage-id>.tgz
# must equal artifact.sha256 in the run summary (and the GitHub Release asset)
$NPM stage approve <stage-id>               # 2FA; publishes with the staged dist-tag
# or, if anything differs: $NPM stage reject <stage-id>
```

npm fixes the dist-tag when a version is staged; it cannot change at approval.

### 8. Verify

Dispatch once more with `-f dry_run=false`. The job finds the version on npm,
takes the verify-existing path, requires the public tarball to be
byte-identical to a freshly prepared receipt and the requested dist-tag to
point at it, and records `already_published_exact`. This relies on the
package build being reproducible: two clean preparations of
`math-cards-v0.1.0-dev.2` from the public layout on one machine gave the same
SHA-256 (local dry run, 2026-10-12). A run that cannot reproduce the bytes stops
without mutation.

### If something goes wrong

- A staged version cannot be staged again while it is pending; npm refuses.
  Check `npm stage list` before any retry.
- After `npm stage reject`, re-stage the same tag only when its bytes were
  right and something else failed. If the bytes were wrong, bump the version;
  a tag is never moved.
- Existing different bytes, an unexpected tag, source drift, or an ambiguous
  registry state stop the run without mutation, as before.

## npm trust: lock down now, enable per release (Yu, trusted device)

The packages on npm must not trust this repository, `cambridgetcg/agenttool`,
must not let any workflow publish them directly, and must refuse publication by
any npm token. A package released by the public route then needs trust of the
`cambridgetcg/agenttool-packages` workflow for **stage publish only**, so a
GitHub OIDC token can never publish without Yu's approval.

Since 2026-10-02 npm expires a new trust configuration 48 hours after creation
unless its first publish succeeds (GitHub changelog, "Unvalidated npm trusted
publishing configurations now expire", 2026-10-02; npm's trusted-publishing
page: it "must complete its first successful publish within 2 days"). An
expired configuration "can no longer be used or edited" and stays visible in
the package's trusted-publisher settings on npmjs.com; npm's page says to
"delete the expired configuration, create a new one" and publish within 2
days. Whether `npm trust list` still lists an expired configuration, and
whether `npm trust revoke` can delete one, are unverified; npm 11.17.0's
listing prints only id, type, file, repository, environment and permissions,
so it never shows the expiry. Trust is therefore never created ahead of a
release: the script that once re-pointed all 38 packages in one run now has
two separate modes, and without one it prints its usage and does nothing.
`DRY_RUN` must be `1` or `0`; any other value is refused.

[`npm-trust-repoint.sh`](../docs/npm-trust-repoint.sh) needs only Node with
npx, makes every npm call with `npx --yes npm@11.17.0`, pauses 2 seconds
between calls, and saves every listing in a record directory. Use the npm user
`agenttool` with account 2FA; npm rejects a bypass-2FA token for `npm trust`.
npm asks for 2FA only when its input and output are a terminal (npm 11.17.0's
`otplease` checks stdin and stdout), and the script saves its listings to
files, so it first makes one listing on the terminal: complete 2FA there and
tick "skip for the next 5 minutes". A saved listing that fails with `EOTP`
means that window lapsed: the script asks on the terminal again and retries
that listing once; if the retry fails too, later listings are not retried.
Revoking, access and creation also run on the terminal, so npm asks there once
the window has lapsed. It waits for the browser approval (about 5 minutes in
Yu's runs of 2026-10-29/30), then fails with `E404` for `/-/v1/done`: that is
an approval that timed out, not a missing package, and the script says so.
Re-run with the browser ready and approve each prompt within 5 minutes. Start
a real run 5 minutes after a dry run, or the window the dry run opened can
lapse midway (27 of the 47 saved listings failed so in one of those runs); the
script warns when a record beside its own is under 5 minutes old.

The record directory also keeps `run.log`, every line the script printed with
npm's stderr (npm's prompts and other output stay on the terminal; the script
never pipes npm), and, when something needs attention, `needs-attention.txt`:
one `<package> <reason>` line per problem, the reason being `eotp`,
`list-failed`, `auth-timeout`, `revoke-failed`, `access-failed`,
`create-failed`, `review`, `unexpected`, `unreadable`, `not-locked`,
`other-trust` or `not-target`. Copy the script to the trusted device.

### Lock down (once, now)

```bash
DRY_RUN=1 bash npm-trust-repoint.sh lockdown   # lists all 47 and shows the plan; changes nothing
bash npm-trust-repoint.sh lockdown             # revokes, disallows tokens, lists again
```

It covers all 47 packages of the `agenttool` login: the 38 public-route
packages and nine released other ways (`@agenttool/xenia`,
`@agenttool/xenia-surface`, `@agenttool/gospel-of-the-logos`,
`@agenttool/hf-kingdom-lab`, `@agenttool/whitehack-scan`, `@rhetorlint/core`,
`@rhetorlint/rules-en`, `@rhetorlint/cli`, `yutabase`). For each package it does
the equivalent of:

```bash
npx --yes npm@11.17.0 trust list <pkg> --json        # saved under trust-before/
npx --yes npm@11.17.0 trust revoke <pkg> --id <id>   # each configuration to revoke (below)
npx --yes npm@11.17.0 access set mfa=publish <pkg>   # "Require 2FA and disallow tokens"
npx --yes npm@11.17.0 trust list <pkg> --json        # saved under trust-after/; checked
```

It creates no configuration. It revokes every configuration that names
`cambridgetcg/agenttool`, and every one whose permissions include
`createPackage` (direct `npm publish`), whatever the repository. It keeps a
GitHub configuration of any other repository whose only permission is
`createStagedPackage`, such as Xenia's own stage route or one made by `enable`.
It never revokes stage-only trust, but it marks one "needs review" and exits
non-zero when `cambridgetcg` does not own its repository (someone else
controls that repository), or when it has no workflow file or environment (it
then matches more than the job it was made for). Anything else (another provider, unknown permissions such as npm's
separate dist-tag option, an unreadable listing) is left alone and reported,
and the run exits non-zero. For a configuration it leaves to you, the script
prints the `trust revoke` command when the id is readable, and does not run
it. The final check passes a package only when its listing afterwards is empty
or stage-only, so a listing or classifier that fails also fails the run. Every
run that gets past its listings ends by listing the stage-only trust that
stays, with its repository, file and environment, or `none`; when some package
needs attention, it adds that such a package may have more. Check that each
one listed is expected.

On 2026-10-19 the listing showed 22 packages trusting `cambridgetcg/agenttool`
`publish-npm.yml` in `npm-bootstrap` with `createPackage` and
`createStagedPackage`, and 16 with none. Until they are revoked, a workflow file
of that name added to this repository again could publish them directly. A
re-run finds nothing more to revoke and sets the same access again.

**What lockdown closes outside the public route.** The nine outside packages
were not listed on 2026-10-19, so their trust is unknown: read their lines in
the dry-run plan before the real run. Their workflows (read through the GitHub
API on 2026-10-28) and npm's publisher records (anonymous registry reads, same
day) show:

- yutabase (`cambridgetcg/yutabase` `publish-npm.yml`, environment
  `npm-bootstrap`), `@agenttool/hf-kingdom-lab` (`cambridgetcg/hf-kingdom-lab`
  `publish-npm.yml`, environment `npm-release`) and the three `@rhetorlint`
  packages (`cambridgetcg/rhetorlint-spec` `release.yml`, environment
  `npm-release`, through `scripts/publish-npm-ci.mjs`) run a direct
  `npm publish` over OIDC. Trust that lets them work allows direct publish, so
  lockdown revokes it and those routes stop. yutabase 0.1.0-candidate.3 was
  published that way (npm records GitHub Actions, trusted publisher
  `oidc:ea1f7fe7…`, no approver), so it had a direct-publish configuration
  on 2026-07-29; the dry run shows whether it still exists. Every
  hf-kingdom-lab and RhetorLint version was published by the `agenttool`
  user, so whether those have trust is unknown. A stage-only configuration
  alone does not bring such a route back: its workflow must first change to
  `npm stage publish` (or be retired; Yu decides), and the configuration made
  for it starts its own 48-hour clock.
- `@agenttool/xenia` stages through `cambridgetcg/xenia` `stage-xenia.yml`
  (environment `npm-bootstrap`). Its 0.1.0-beta.4 to beta.7 went through
  trusted publisher `oidc:8246391c…` and were approved by `agenttool`, so that
  configuration is validated. Lockdown keeps it if it is stage-only. If it also
  allows direct publish, lockdown revokes a validated configuration, and the
  next Xenia stage needs a new one made just before it.
- `@agenttool/whitehack-scan` (whitehack `publish-whitehack.yml`) and
  `@agenttool/xenia-surface` (xenia `publish-xenia-surface.yml`), both in
  environment `npm-bootstrap`, are token routes with no token left (below).
  Both also grant `id-token: write` and run `npm publish`, which in npm 11.17.0
  tries an OIDC exchange by itself (whitehack installs 11.17.0; xenia-surface
  installs 11.18.0, not read). Either would publish directly if a
  direct-publish configuration named it, and lockdown revokes any such
  configuration. Their packages' trust was not listed.
- `@agenttool/gospel-of-the-logos` 0.1.0 was published by the `agenttool`
  user, through this repository's `publish-gospel.yml` and its token. Its
  trust was never listed. That workflow was its only route, so any trust made
  for it would name `cambridgetcg/agenttool`; lockdown revokes such trust, and
  would again on any re-run, so that route stays closed. Any other trust shows
  in the dry-run plan like the rest.

`enable` refuses these nine, so a new stage-only configuration for one of them
is made by hand, just before its stage, for example for Xenia:

```bash
npx --yes npm@11.17.0 trust github @agenttool/xenia --repo cambridgetcg/xenia \
  --file stage-xenia.yml --env npm-bootstrap --allow-stage-publish --yes
```

Disallowing tokens is required, not optional. npm's 2FA settings page says a
bypass-2FA token "will bypass 2FA requirements for publishing, regardless of
account-level or package-level 2FA settings"; only "Require two-factor
authentication and disallow tokens" stops it. `npm access set mfa=publish`
sends exactly that (`publish_requires_tfa: true`,
`automation_token_overrides_tfa: false` in npm 11.17.0's libnpmaccess). npm's
trusted-publishing page says the setting "only affects traditional token
authentication" and that trusted publishers "will continue to work normally",
so OIDC staging keeps working, and Yu can still publish interactively with
2FA (the 2FA page: maintainers "must publish interactively"). npm suggests
restricting tokens only after trusted publishing has been seen to work. Here no
token route is still usable: the token routes (this repository's
`publish-gospel.yml`, whitehack's `publish-whitehack.yml` and xenia's
`publish-xenia-surface.yml`) have no `NPM_TOKEN` secret in their environment or
repository (read 2026-10-28); the first two lost theirs that day. So
disallowing tokens first loses no token route; the npm tokens themselves still
await revocation by Yu on npmjs.com. Lockdown stops the OIDC routes above,
including any OIDC use of these token workflows, through its revokes, not
through this setting. npm has no command to read the setting back: after the
run, open one package's Settings page on npmjs.com and check that "Require
two-factor authentication and disallow tokens" is selected.

### Enable one package (just before its release)

```bash
DRY_RUN=1 bash npm-trust-repoint.sh enable <key>   # lists the package and shows the plan; changes nothing
bash npm-trust-repoint.sh enable <key>             # creates its stage-only trust, lists again
```

`<key>` is one package of the public release allowlist, as `relational-geometry`
or `@agenttool/relational-geometry`; any other name is refused before any npm
call. The script's list is `RELEASE_SPECS` in `bin/npm-release.ts` without
Local Starter; it runs from a copy without the checkout, so
`bin/tests/npm-trust-repoint.test.ts` keeps the two equal. It does the
equivalent of:

```bash
npx --yes npm@11.17.0 trust list @agenttool/<key> --json   # saved under trust-before/; empty, or exactly the target
npx --yes npm@11.17.0 trust github @agenttool/<key> --repo cambridgetcg/agenttool-packages \
  --file publish-npm.yml --env npm-bootstrap --allow-stage-publish --yes
npx --yes npm@11.17.0 trust list @agenttool/<key> --json   # saved under trust-after/; must be exactly the target
```

There is deliberately no `--allow-publish`. A package with any configuration
other than exactly the target is refused (run lockdown first). That includes
stage-only trust of the public repository with another workflow file or
environment, which npm's OIDC exchange would not match. Run `enable` only once
the package's release tag exists on the public repository and its CI run is
green. When it creates the configuration, the script writes the deadline, 48
hours later, to `expires-by.txt` in its record directory before anything else
can fail. It then prints the deadline and what must happen before it: dispatch
the tag with `dry_run: false` ([step 6](#6-stage)) and approve the stage with
2FA ([step 7](#7-approve-yu-on-the-trusted-device)). Whether a stage that is
not yet approved validates the configuration is undocumented, so approve
within the 48 hours. If the listing after creation is not exactly the target,
the script prints a revoke command for each configuration listed and exits
non-zero: do not dispatch. If `trust github` itself fails, npm may still have
created the configuration (it reads the registry's answer after sending the
request), so the script records the deadline as
`<deadline> (if npm created it)` and says to check with
`DRY_RUN=1 bash npm-trust-repoint.sh enable <key>`.

A package that already has exactly the target is left as it is. npm shows
neither when that configuration was made nor whether it has expired. The
script prints the deadline from the newest earlier `enable` record beside its
own record directory, if there is one, and says to revoke and re-enable before
dispatching unless a stage through it was approved or it is known to be under
48 hours old. A dry run prints the same notice. A dispatch through an expired
configuration fails at npm, and can leave a public GitHub Release and a Rekor
entry behind, as
[run 39288082185](https://github.com/cambridgetcg/agenttool-packages/actions/runs/39288082185)
did with no configuration at all.

If the deadline passes first, revoke the configuration
(`npx --yes npm@11.17.0 trust revoke @agenttool/<key> --id <id>`, with the id
the script printed) and run `enable` again just before the release. If npm refuses to
revoke an expired configuration, delete it on the package's Settings page on
npmjs.com, as npm's page says to, and run `enable` again. If it can be neither
revoked nor deleted and still appears in the listing, `enable` keeps treating
it as the target: confirm the expiry on the Settings page, create the target
by hand with the `trust github` command above (whether npm accepts a second
identical configuration is unverified), and stage within 48 hours.

The first package is the canary: `@agenttool/relational-geometry`, staged by
re-dispatching its existing tag `relational-geometry-v0.1.0-dev.1`. If that
stage still fails with the configuration in place, missing trust is no longer
the cause.

`@agenttool/local-starter` is not on npm. npm trust needs an existing package,
so it is not in the script; see the next section.

## First publication of Local Starter (bootstrap, Yu)

When Yu decides Local Starter should reach npm, its first version needs a new
version number with public repository metadata (step 1) and a short-lived
token. npm's staged publishing accepts a package that does not yet exist: it
publishes a public `0.0.0-stage` placeholder at once and holds the real version
until a maintainer approves it (npm's "Staged publishing" page, last edited
2026-09-29). So the first publication stages like every other release, with a
token that cannot publish:

1. Create a granular npm token with **Read and write (stage only)** on the
   `@agenttool` scope, expiring in a day. npm's selector lists existing
   packages and scopes, so the package itself cannot be chosen before it
   exists. A stage-only token needs no Bypass 2FA: `npm stage publish` defers
   2FA to the approval.
2. `sol access run github -- secret set NPM_TOKEN --env npm-bootstrap --repo cambridgetcg/agenttool-packages`
   and paste the token yourself.
3. Dispatch with `-f authentication=bootstrap -f npm_tag=next -f dry_run=false`
   (`publish_mode` stays `stage`).
   Bootstrap is refused for any package that already exists. If the secret
   was not set, the run mirrors a public prerelease before publish refuses:
   set the secret and dispatch again, which reuses the release, or delete the
   release if the bootstrap is abandoned.
4. Once the stage id is in the summary:
   `sol access run github -- secret delete NPM_TOKEN --env npm-bootstrap --repo cambridgetcg/agenttool-packages`,
   then revoke the token on npm. Approval and verification need no token.
5. Approve the stage (step 7 above), then dispatch again with
   `-f authentication=trusted` to verify (step 8).
6. Disallow tokens for it now:
   `npx --yes npm@11.17.0 access set mfa=publish @agenttool/local-starter`.
   Add `local-starter` to the script (its `PACKAGES` list and counts), remove
   `enable`'s Local Starter refusal from the script, and drop its exclusion and
   its refusal case in `bin/tests/npm-trust-repoint.test.ts`, so lockdown
   covers it and [enable](#enable-one-package-just-before-its-release) can give
   it stage-only trust just before its next release; created earlier, that
   trust would expire unused.

The trade-off is the `0.0.0-stage` placeholder, which npm documents as
publicly visible from staging onward; whether it also takes the package's
`latest` tag is unverified. If npm refuses to stage a new package, the fallback
is `-f publish_mode=publish` with a **Read and write (publish and stage)**
token with Bypass 2FA, again on the `@agenttool` scope for a day. That token
can create any new `@agenttool` package name, though not publish the 43
existing `@agenttool` packages once lockdown has set them to disallow tokens;
delete it straight after the run. The release tool refuses
`publish_mode: publish` for any `trusted` run.

## Public repository settings (Yu, once)

The publish job's `environment: npm-bootstrap` must exist in
`cambridgetcg/agenttool-packages` with a deployment policy that admits only
release tags (`*-v*`). Owner decision, 2026-10-13: no required reviewer. Yu's
2FA approval of each npm stage is the publication gate, and a release runs when
Yu and Ai agree to it in conversation. Read on 2026-10-13: the environment
exists with the `*-v*` tag policy and admin bypass off; its required reviewer
was removed that day. Create it
before the first `dry_run: false` dispatch: GitHub creates a missing
environment on first use without any protection. Tag rulesets
should block updating or deleting `refs/tags/*-v*`, and `main` should block
deletion and force pushes. An anonymous read on 2026-10-12 showed the active
rulesets "main is append-only" and "release tags are immutable" and no
environment yet. The trust configuration binds the environment name,
so keep it exactly `npm-bootstrap`.

`cambridgetcg/agenttool`'s own `npm-bootstrap` environment held an
`NPM_TOKEN` until 2026-10-28, when the secret was deleted and the environment
kept. This runbook described it, before 2026-10-12, as a granular token
with `@agenttool` read/write access and Bypass 2FA; its real scope was not read
from npm. Such a token can publish any `@agenttool` package that does not
disallow tokens, and create new package names in the scope. Its only consumer,
`publish-gospel.yml`, published only while the exact version was absent, and
`@agenttool/gospel-of-the-logos@0.1.0` has been on npm since 2026-09-08
(anonymous registry read, 2026-10-12). So the token has no remaining use; it
still needs revoking on npm.
A later Gospel edition would need a new reviewed route and its own short-lived
credential.


## Authentication modes

`trusted` is the normal mode. npm exchanges the GitHub-hosted runner's OIDC
identity for a short-lived credential. The intended trust, from 2026-10-12,
names the public repository's `publish-npm.yml` and `npm-bootstrap` environment
and allows `npm stage publish` only, so that credential can stage but not
publish; publication needs Yu's `npm stage approve` with 2FA. Yu's trust
listing of 2026-10-19 showed no package with that configuration yet (see the
[state above](#state-as-of-2026-10-28)). The workflow grants
`id-token: write` only to the protected publication job, exposes no long-lived
write token, runs no package lifecycle code in that job, and receives automatic
public provenance.

`bootstrap` exists only because npm cannot attach a trusted publisher to a
package which does not yet exist. It stages by default, like a trusted run: npm
stages a new package behind a public `0.0.0-stage` placeholder. It is also the
only mode that may use the `publish_mode: publish` fallback. The release engine
permits this mode only when both the package and version return public registry
`404`. The protected GitHub environment supplies `NPM_TOKEN` only to the final
publish step; package install, build, tests, and packing run in the preceding
job before the protected environment is entered. For a stage, that secret is an
expiry-limited granular token with **Read and write (stage only)** access, which
needs no Bypass 2FA. Only the direct-publish fallback needs a read/write token
with **Bypass 2FA**; without bypass it fails with `EOTP`. Do not restrict either
to a Mac-only allowed IP range: GitHub-hosted runners do not originate from that
device. Once a package exists, bootstrap cannot create another version; an
exact already-published rerun is verification-only and does not invoke npm.

The public repository's `npm-bootstrap` environment holds no npm token by
default; one is added only for a first publication and deleted afterwards (see
[Local Starter](#first-publication-of-local-starter-bootstrap-yu)).
`cambridgetcg/agenttool`'s environment of the same name held the scope-wide,
bypass-2FA token that `publish-gospel.yml` used for its first publication; the
secret was deleted on 2026-10-28, and the token should still be revoked on npm
(see [public repository settings](#public-repository-settings-yu-once)).

## One-time trusted-publisher setup

After a package's first version exists, its trusted publisher is (the
[script's](../docs/npm-trust-repoint.sh) `enable <key>` sets exactly this for one
package, just before its release):

| Field | Value |
|---|---|
| Provider | GitHub Actions |
| Organization or user | `cambridgetcg` |
| Repository | `agenttool-packages` |
| Workflow filename | `publish-npm.yml` |
| Environment | `npm-bootstrap` |
| Allowed action | `npm stage publish` only (`--allow-stage-publish`, no `--allow-publish`) |

Until 2026-10-12 the repository was `agenttool` and the allowed action
`npm publish`; that private publisher no longer exists.
(Corrected 2026-10-28: its workflow file left `main` on 2026-10-12, but on
2026-10-19 22 packages still trusted that configuration; see the
[state above](#state-as-of-2026-10-28).)

The Environment field is optional in npm. Leaving it blank does not itself
break this workflow, but setting it to the exact, case-sensitive
`npm-bootstrap` value narrows trust to the protected publication job. The
workflow filename is always case-sensitive and must include `.yml`. npm does
not validate the relationship when it is saved; the first trusted release is
the operational proof, and must come within 48 hours of creation or the
configuration expires. Configuring trust requires account-level 2FA and rejects
a bypass-2FA token as the authorizing proof; Touch ID or another WebAuthn
passkey satisfies that requirement without a TOTP authenticator app. The
lockdown sets every package's publishing access to require 2FA and
disallow tokens (`npm access set mfa=publish`); trusted publishing is
unaffected by that setting.

`npm login --auth-type=web` is the browser sign-in flow for saving a local CLI
credential. It does not turn `npm publish` into browser authorization, bypass a
package's write policy, or establish trusted publishing. `npm publish` has no
`--auth-type=web`; an interactive TTY publish may separately open npm's
WebAuthn page for its second-factor challenge, but a non-interactive GitHub job
cannot use that popup. Ordinary releases do not need to move that proof through
a local shell once OIDC is configured.

## Operator sequence (private repository, until 2026-10-12)

Historical. The private workflow below no longer exists; use the
[public release path](#public-release-path-from-2026-10-12). The 0.20.0
publication completed through the exact protected run recorded above. The commands below now record immutable-tag verification and the only
permitted rerun shape; they are not instructions to recreate or move the tag.
Any exact recovery or revalidation still requires separate explicit
authorization:

```bash
# Inspect the allowlisted SDK identity and expected tag.
bun bin/npm-release.ts resolve --package sdk

# Fetch and verify the separately created immutable tag; never recreate, move,
# or replace it.
git fetch github \
  refs/heads/main:refs/remotes/github/main \
  refs/tags/sdk-v0.20.0:refs/tags/sdk-v0.20.0
test "$(git cat-file -t refs/tags/sdk-v0.20.0)" = tag
test "$(git rev-parse 'refs/tags/sdk-v0.20.0^{}')" = \
  cb9c30fae0e49e1727e449207593581ce52cd4cf
git merge-base --is-ancestor \
  "$(git rev-parse 'refs/tags/sdk-v0.20.0^{}')" github/main

# A later exact recovery or revalidation still requires explicit approval.
# Existing npm bytes are accepted only when every byte and latest match.
gh workflow run publish-npm.yml --ref sdk-v0.20.0 \
  -f package=sdk \
  -f tag=sdk-v0.20.0 \
  -f authentication=trusted \
  -f npm_tag=latest
```

The workflow's GitHub environment supplies the human review page. The release
engine does not bump versions, create or push tags, merge branches, publish
LOVE artifacts, deploy hosted services, configure npm trusted publishers, or
revoke credentials. It creates or verifies one byte-identical GitHub Release
asset for the already-existing annotated tag before attempting the optional npm
mirror; it does not rewrite unrelated release assets.
