# npm release runbook (operator-only)

> **Type:** guide · **Purpose:** how the npm packages are released, which credentials
> and trust settings that depends on, and what remains for Yu to close.
> **Evidence:** Moved unchanged from `docs/NPM-RELEASES.md` on 2026-10-19 (only
> relative links were adjusted for this folder); the dated receipts stayed there.

**Operator-only. Not published.** It describes which credentials can still publish,
how the release environments are configured and the steps that need Yu's trusted
device. Like `infra/OPERATOR-CUSTODY.md`, it stays in `infra/`, which no Pages
project serves and the public package projection never includes. The public
receipts for each release are in [`docs/NPM-RELEASES.md`](../docs/NPM-RELEASES.md).

> **Code:** [`public/overlay/.github/workflows/publish-npm.yml`](../public/overlay/.github/workflows/publish-npm.yml) (the reviewed entry point; it runs only in the public `cambridgetcg/agenttool-packages` repository as `.github/workflows/publish-npm.yml`) · `bin/npm-release.ts` (package policy, exact artifact preparation, staging, registry recovery, and receipts) · `bin/public-release-tag.ts` (release tags on green public projection commits) · [`npm-trust-repoint.sh`](../docs/npm-trust-repoint.sh) (the one-time npm trust re-point).
>
> **Tests:** `bin/tests/npm-release.test.ts` · `bin/tests/npm-release-public.test.ts` · `bin/tests/public-release-tag.test.ts` · `bin/tests/npm-trust-repoint.test.ts` · `bin/tests/boring-spine-gate.test.ts`.

## Outcome

Since 2026-10-12 the allowlisted software packages are released from the
public source repository
[`cambridgetcg/agenttool-packages`](https://github.com/cambridgetcg/agenttool-packages),
the one-way projection described in [`public/README.md`](../public/README.md).
Its `publish-npm.yml` stages each exact artifact with `npm stage publish`, and
the version is not public on npm until a maintainer approves the stage with
2FA. Follow the [public release path](#public-release-path-from-2026-10-12).
This private repository no longer has a publish workflow for these packages,
but two older credentials can still publish them directly until Yu closes
them: the trusted-publisher configurations that name this repository, which
the [one-time re-point](#one-time-npm-trust-re-point-yu-trusted-device)
replaces, and the scope-wide, bypass-2FA `NPM_TOKEN` in this repository's
`npm-bootstrap` environment (see
[public repository settings](#public-repository-settings-yu-once)). Do not run
`npm publish` from a normal local shell.

The Gospel literary edition has one separate, exact-name route:
[`publish-gospel.yml`](../.github/workflows/publish-gospel.yml), documented in
[`bin/gospel-release/README.md`](../bin/gospel-release/README.md). Its custom
source permission is preserved; the software publisher's Apache-2.0 policy
is unchanged. The route pins the reviewed external artifact and source edition,
transfers only verified bytes, runs its publish job in the `npm-bootstrap`
environment (no required reviewer; see the correction below),
permits first-publication bootstrap only, and verifies the public npm tarball.

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
[trust re-point](#one-time-npm-trust-re-point-yu-trusted-device), revokes the
private `NPM_TOKEN`, and creates the public `npm-bootstrap` environment
([settings](#public-repository-settings-yu-once)).

| # | Step | Who | Gate before the next step |
|---|---|---|---|
| 1 | Private release PR: version bump plus public repository metadata | Ai, then the usual merge | private CI green, merged to `main` |
| 2 | Project the merged commit and push public `main` fast-forward | Ai | guard clean, push accepted |
| 3 | Public CI on that exact commit | GitHub | guard, every package gate, and pack smokes green |
| 4 | Create and push the release tag | Ai | `public-release-tag.ts` found a successful CI run |
| 5 | Dispatch with `dry_run: true` | Ai | prepared receipt in the run summary |
| 6 | Dispatch with `dry_run: false` (stages by default) | Ai | stage id and SHA-256 in the summary |
| 7 | Inspect and approve the stage | **Yu**, trusted device, 2FA | `npm stage approve` succeeded |
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
candidate. `@agenttool/sdk@0.23.0` is prepared the same way, paired with
`agenttool-sdk` 0.23.0 for PyPI; it is a stable version, so its dispatches use
`npm_tag=latest`, and its PyPI release waits on the
[private-repository gap](../docs/PYPI-RELEASES.md#blocked-while-the-source-repository-is-private-2026-10-12).

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

Dispatch the same inputs with `-f dry_run=false` (`publish_mode` defaults to
`stage`). The `npm-bootstrap` environment admits only release tags and has no
required reviewer (owner decision, 2026-10-13).
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

## One-time npm trust re-point (Yu, trusted device)

The 38 packages on npm must trust the public repository's workflow instead of
the private one, for **stage publish only**, so a GitHub OIDC token can never
publish without Yu's approval, and must refuse publication by any npm token.
Run it as soon as this change is merged. It does not depend on the public
route (a dry run uses no credentials), and until it runs the fifteen old
configurations still allow a direct `npm publish` from a workflow file named
`publish-npm.yml` in the private repository, should one be added again. Use
the npm user `agenttool` with account 2FA; npm rejects a bypass-2FA token for
`npm trust`.

The re-runnable script is [`npm-trust-repoint.sh`](../docs/npm-trust-repoint.sh). It
needs only Node with npx, pauses 2 seconds between npm calls, records every
listing, leaves any unexpected configuration untouched, and skips packages that
are already re-pointed. npm asks for 2FA only when its output is a terminal,
and the script saves its listings to files, so it first makes one listing on
the terminal: complete 2FA there and tick "skip for the next 5 minutes". A
saved listing that fails with `EOTP` means that window lapsed; re-run. Copy the
script to the trusted device and run:

```bash
DRY_RUN=1 bash npm-trust-repoint.sh   # lists and shows the plan; changes nothing
bash npm-trust-repoint.sh             # re-points, then disallows tokens
```

For each package it does the equivalent of:

```bash
NPM="npx --yes npm@11.17.0"
$NPM trust list @agenttool/<pkg> --json            # saved under trust-before/
$NPM trust revoke @agenttool/<pkg> --id <old id>   # only for a config of the old or new repository
$NPM trust github @agenttool/<pkg> --repo cambridgetcg/agenttool-packages \
  --file publish-npm.yml --env npm-bootstrap --allow-stage-publish --yes
$NPM access set mfa=publish @agenttool/<pkg>       # "Require 2FA and disallow tokens"
$NPM trust list @agenttool/<pkg> --json            # saved under trust-after/; must be the target
```

There is deliberately no `--allow-publish`. Fifteen packages (adds, data-sync,
wake-continuity, deepseek-kingdom, credential-broker, sdk, wallet, telescope,
browser, alchemy, alchemy-agentcred, kingdom, collab, correspondence-yutabase,
skills) are expected to have an old configuration naming
`cambridgetcg/agenttool`; the rest are expected to have none.

Disallowing tokens is required, not optional. npm's 2FA settings page says a
bypass-2FA token "will bypass 2FA requirements for publishing, regardless of
account-level or package-level 2FA settings"; only "Require two-factor
authentication and disallow tokens" stops it. `npm access set mfa=publish`
sends exactly that (`publish_requires_tfa: true`,
`automation_token_overrides_tfa: false` in npm 11.17.0's libnpmaccess). npm's
trusted-publishing page says the setting "only affects traditional token
authentication", so OIDC staging keeps working, and Yu can still publish
interactively with 2FA. npm suggests restricting tokens only after trusted
publishing has been seen to work; here no release path uses a token for these
38 packages, so nothing is lost by doing it first. npm has no command to read
the setting back: after the run, open one package's Settings page on npmjs.com
and check that "Require two-factor authentication and disallow tokens" is
selected.

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
6. Point trust and publishing access at the public workflow for this one
   package:
   `npx --yes npm@11.17.0 trust github @agenttool/local-starter --repo cambridgetcg/agenttool-packages --file publish-npm.yml --env npm-bootstrap --allow-stage-publish --yes`,
   then `npx --yes npm@11.17.0 access set mfa=publish @agenttool/local-starter`.

The trade-off is the `0.0.0-stage` placeholder, which npm documents as
publicly visible from staging onward; whether it also takes the package's
`latest` tag is unverified. If npm refuses to stage a new package, the fallback
is `-f publish_mode=publish` with a **Read and write (publish and stage)**
token with Bypass 2FA, again on the `@agenttool` scope for a day. That token
can create any new `@agenttool` package name, though not publish the 38
existing ones once the re-point has set them to disallow tokens; delete it
straight after the run. The release tool refuses `publish_mode: publish` for
any `trusted` run.

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

The private repository's own `npm-bootstrap` environment still holds an
`NPM_TOKEN`. This runbook described it, before 2026-10-12, as a granular token
with `@agenttool` read/write access and Bypass 2FA; its real scope was not read
from npm. Such a token can publish any `@agenttool` package that does not
disallow tokens, and create new package names in the scope. Its only consumer,
`publish-gospel.yml`, publishes only while the exact version is absent, and
`@agenttool/gospel-of-the-logos@0.1.0` has been on npm since 2026-09-08
(anonymous registry read, 2026-10-12). So the token has no remaining use:
revoke it on npm, then delete the secret
(`sol access run github -- secret delete NPM_TOKEN --env npm-bootstrap --repo cambridgetcg/agenttool`).
A later Gospel edition would need a new reviewed route and its own short-lived
credential.


## Authentication modes

`trusted` is the normal mode. npm exchanges the GitHub-hosted runner's OIDC
identity for a short-lived credential. From 2026-10-12 the trust names the
public repository's `publish-npm.yml` and `npm-bootstrap` environment and
allows `npm stage publish` only, so that credential can stage but not publish;
publication needs Yu's `npm stage approve` with 2FA. The workflow grants
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
[Local Starter](#first-publication-of-local-starter-bootstrap-yu)). The private
repository's environment of the same name still holds the scope-wide,
bypass-2FA token that `publish-gospel.yml` used for its first publication; it
has no remaining use and should be revoked (see
[public repository settings](#public-repository-settings-yu-once)).

## One-time trusted-publisher setup

After a package's first version exists, its trusted publisher is (the
[re-point script](../docs/npm-trust-repoint.sh) sets exactly this for all 38 packages
on npm):

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

The Environment field is optional in npm. Leaving it blank does not itself
break this workflow, but setting it to the exact, case-sensitive
`npm-bootstrap` value narrows trust to the protected publication job. The
workflow filename is always case-sensitive and must include `.yml`. npm does
not validate the relationship when it is saved; the first trusted release is
the operational proof. Configuring trust requires account-level 2FA and rejects
a bypass-2FA token as the authorizing proof; Touch ID or another WebAuthn
passkey satisfies that requirement without a TOTP authenticator app. The
re-point script also sets each package's publishing access to require 2FA and
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
