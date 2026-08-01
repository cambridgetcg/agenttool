<!-- @id urn:agenttool:doc/NPM-RELEASES  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/LOVE-PACKAGE-PROTOCOL urn:agenttool:doc/DEPLOY-PROCEDURE -->

# NPM-RELEASES — one exact, reviewed publication path

> *Operational runbook for optional npm mirrors. An npm credential is authority to publish bytes; it is not proof that those bytes were reviewed, built from `main`, or accepted by the public registry.*

> **Compass:** [LOVE-PACKAGE-PROTOCOL](LOVE-PACKAGE-PROTOCOL.md) (registry-neutral artifact identity) · [DEPLOY-PROCEDURE](DEPLOY-PROCEDURE.md) (hosted service releases) · [DEVELOPMENT](DEVELOPMENT.md) (contributor workflow)
>
> **Implements:** one manual, allowlisted npm release state machine for the reviewed JavaScript packages. LOVE remains the primary release record where a package has one, including Agent Browser, Agent Wallet, and its Zerone adapter; Collab, Agent Skills, the KINGDOM integration package, the developer-preview Correspondence-to-YUTABASE planner, the developer-preview Repo Archive, the Dark Continent contract and KARMA proposal adapter, the DeepSeek-to-KINGDOM proposal adapter, HEAVEN, the developer-preview Alchemy observation client, and its strict AgentCred composition adapter are intentionally npm-only.
>
> **Code:** `.github/workflows/publish-npm.yml` (reviewed GitHub entry point) · `bin/npm-release.ts` (package policy, exact artifact preparation, registry recovery, and receipt).
>
> **Tests:** `bin/tests/npm-release.test.ts` · `bin/tests/boring-spine-gate.test.ts`.

## Outcome

Use one workflow for npm publication. Do not run `npm publish` from a normal
local shell.

The workflow:

1. is dispatched on, and checks out, an existing annotated
   `<package>-v<version>` tag;
2. proves that the workflow identity, tag, `HEAD`, and provenance commit are the
   same commit contained in GitHub `main`;
3. installs locked dependencies and runs the selected package gate without a
   publish credential or OIDC permission;
4. copies the checked-in LOVE tarball, or builds an allowlisted npm-only
   package tarball, into runner temp space;
5. checks package identity, repository, Apache-2.0 terms, archive paths and
   entry types, secret-like signatures, size, and hashes;
6. transfers only that tarball and its path-independent receipt to a second
   job;
7. enters the protected `npm-bootstrap` GitHub environment after preparation;
8. rechecks the downloaded bytes, then creates or reuses the tag's GitHub
   Release, uploads the exact tarball if absent, re-downloads it, and requires
   byte identity;
9. separately publishes to npm with provenance and scripts disabled; and
10. waits for public registry propagation, requires byte identity, and writes a
    non-secret receipt to the workflow summary.

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

GitHub mirror recovery is independent of npm dist-tag state and still requires
the exact prepared artifact. npm recovery intentionally requires the requested
dist-tag to point at the released version; a normal rerun never moves that tag
backward.

## Verified release train — 2026-07-29

The following protected runs completed, published, and anonymously read back
the exact GitHub Release and npm tarballs. A LOVE-backed row also matched the
checked-in artifact. The npm-only rows were packed once in the credential-free
job and the same bytes crossed both optional mirrors.

| Exact package | Annotated tag and protected run | Requested npm channel | Verified bytes |
|---|---|---|---|
| `@agenttool/wallet@0.1.3` | [`wallet-v0.1.3`](https://github.com/cambridgetcg/agenttool/releases/tag/wallet-v0.1.3) · [`30491887230`](https://github.com/cambridgetcg/agenttool/actions/runs/30491887230) | `latest` | 52,837 · `33f3b81cfcc12882cb98dfd11b215fa4d3cbd963efc575e41ed54e05f132ae87` |
| `@agenttool/alchemy@0.1.0-dev.0` | [`alchemy-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/alchemy-v0.1.0-dev.0) · [`30491887182`](https://github.com/cambridgetcg/agenttool/actions/runs/30491887182) | `next` | 31,445 · `aeac1938f3abae14180637e72c4162c37b60bb47041452fade285718d7570ba5` |
| `@agenttool/credential-broker@0.3.1` | [`credential-broker-v0.3.1`](https://github.com/cambridgetcg/agenttool/releases/tag/credential-broker-v0.3.1) · [`30492737828`](https://github.com/cambridgetcg/agenttool/actions/runs/30492737828) | `latest` | 158,450 · `d05458b27b8832af7996c243abb22e3b400e5810fe5377ba58e1cb587d2461d8` |
| `@agenttool/skills@0.3.0` | [`skills-v0.3.0`](https://github.com/cambridgetcg/agenttool/releases/tag/skills-v0.3.0) · [`30493208405`](https://github.com/cambridgetcg/agenttool/actions/runs/30493208405) | `latest` | 59,507 · `6526f2bbcaf1ac6025b0cbc5347f2b8836123ef3ed5f5407a98fdb2263497a87` |
| `@agenttool/alchemy-agentcred@0.1.0-dev.0` | [`alchemy-agentcred-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/alchemy-agentcred-v0.1.0-dev.0) · [`30494036520`](https://github.com/cambridgetcg/agenttool/actions/runs/30494036520) | `next` | 14,478 · `8dece3c98db0d92d79f16e91527ca18ed42b49f87b7586b78c092ffc242e291a` |
| `@agenttool/wallet-zerone@0.1.2` | [`wallet-zerone-v0.1.2`](https://github.com/cambridgetcg/agenttool/releases/tag/wallet-zerone-v0.1.2) · [`30494659977`](https://github.com/cambridgetcg/agenttool/actions/runs/30494659977) | `latest` | 61,695 · `bc43b8be96dcc74a866926c9f5d98c00af9d8c4682cbb6f36ef77a7adbbaa8cc` |
| `@agenttool/adds@0.2.3` | [`adds-v0.2.3`](https://github.com/cambridgetcg/agenttool/releases/tag/adds-v0.2.3) · [`30495292940`](https://github.com/cambridgetcg/agenttool/actions/runs/30495292940) | `latest` | 89,285 · `3fe42c4457e38f1fcdbc437c22c762ea7dabfe898714ec395287608a0480ea2b` |
| `@agenttool/data-sync@0.1.2` | [`data-sync-v0.1.2`](https://github.com/cambridgetcg/agenttool/releases/tag/data-sync-v0.1.2) · [`30495589179`](https://github.com/cambridgetcg/agenttool/actions/runs/30495589179) | `latest` | 59,774 · `37b69b13db60eafc4a0bae578faca14467c0844e4f4c32793808b3499bcd8fd6` |

Alchemy and its AgentCred adapter were deliberately requested on `next`.
Because each is currently the sole initial version, npm also exposes that
prerelease through `latest`; this registry fallback is not a stable-release or
maturity signal. Alchemy AgentCred and Wallet Zerone used the one-time
bootstrap path. Their package records now exist, so future versions must use
trusted publishing after the exact publisher mapping above is attached and
operationally proven.

Some packaged READMEs preserve preparation-time mirror observations because
those bytes were frozen before publication completed. This dated ledger
supersedes those observations without rewriting a published tarball. Correcting
README text inside an installed package requires a new package version and a
new exact artifact; rebuilding an existing version is forbidden.

The same audit corrected two earlier preparation-time observations:
`@agenttool/collab@0.3.1` is public through protected run
[`30389483811`](https://github.com/cambridgetcg/agenttool/actions/runs/30389483811)
and has byte-identical 296,260-byte GitHub/npm tarballs with SHA-256
`dd0b0a0897a6d414e013e7f80b29ed9b200f94b3bcfe9d79598bc50b619db6ee`;
`@agenttool/kingdom@0.1.0` is public through successful recovery run
[`30388388587`](https://github.com/cambridgetcg/agenttool/actions/runs/30388388587)
and has byte-identical 26,474-byte GitHub/npm tarballs with SHA-256
`67678dd8aa21ef63aa2b43107385fa5e8598591d9ef4020926e0272cfb4637e1`.
Both npm `latest` tags resolved to those exact versions at readback.

## Verified Agent Browser 0.6.0 publication and deployment — 2026-07-30

The authorized Browser release completed through protected
[workflow run `30576479114`](https://github.com/cambridgetcg/agenttool/actions/runs/30576479114).
Its final `agenttool.npm-release/1` receipt reports `status: published`,
`npm_tag: latest`, and public registry observation at
`2026-07-30T19:53:28.563Z`.

- Annotated tag
  [`browser-v0.6.0`](https://github.com/cambridgetcg/agenttool/releases/tag/browser-v0.6.0)
  peels to the two-parent GitHub `main` merge
  `03f56741c82b4b353157f4a7b2f8bfc08e878fe4`.
- The LOVE manifest binds Browser source revision
  `1d75fdee195d2ff8097b5d3267fb2c0301b5a0ae`.
- LOVE, the one-asset GitHub Release, the protected workflow artifact, public
  npm `@agenttool/browser@0.6.0`, and the deployed static archive are
  byte-identical: `2,811,378` bytes, SHA-256
  `b5ab329e763c2498a3bb4e2ad37786b1b578a8f3a3e2f01f4112244ba9f1878b`.
- npm reported SHA-1 `824adf99ed723f9cb6f394cd24ac7b056901e049`,
  `latest: 0.6.0`, and public provenance at
  [Sigstore log index `2293953813`](https://search.sigstore.dev/?logIndex=2293953813).
- A frontend-only deployment of the same clean merge completed at
  `2026-07-30T20:04:07Z`. Token-mode Cloudflare inspection, not the OAuth
  fallback, proved all three Pages projects use `production_branch=main` and
  production plus preview `fail_open=false`. Custom domains converged on
  verification attempt 9 of 25; live committed-file parity, the Browser page,
  LOVE index `latest: 0.6.0`, manifest source/hash/size, exact archive bytes,
  package headers, and literal plus encoded sensitive-path fences all passed.
  A private mode-0600 `agenttool-deploy-receipt/v4` records the successful
  preflight and static deployment; migrations and the API were deliberately
  skipped.

Version 0.6.0 adds only the direct TypeScript web-material understanding
subpath: provenance-bound text, local RhetorLint, and an optional
caller-injected, revision-pinned Hugging Face interpreter behind explicit
remote disclosure. Rhetoric and model outputs remain separate observations;
`externalFacts` stays `not_resolved` and `truth` stays `not_determined`. The
release supplies no model, provider client, token, model download, hosted
inference, automatic action, or hosted Browser, and it does not widen the
existing nine-tool MCP/JSONL authority boundary. Exact 0.5.1 and earlier
release bytes remain immutable.

## Verified Agent Browser 0.5.1 publication — 2026-07-30

The authorized Browser packaging release completed through protected
[workflow run `30527839535`](https://github.com/cambridgetcg/agenttool/actions/runs/30527839535).
Its final `agenttool.npm-release/1` receipt reports `status: published`,
`npm_tag: latest`, and public registry observation at
`2026-07-30T08:54:01.427Z`.

- Annotated tag
  [`browser-v0.5.1`](https://github.com/cambridgetcg/agenttool/releases/tag/browser-v0.5.1)
  peels to the two-parent GitHub `main` merge
  `a535f66c053bc38e114f3cbab9896610b73a561e`.
- The LOVE manifest binds Browser source revision
  `13334238a0eea60fef2f9e5b260d301ffa89a22d`.
- LOVE, the one-asset GitHub Release, the protected workflow artifact, and
  public npm `@agenttool/browser@0.5.1` are byte-identical: `2,795,747`
  bytes, SHA-256
  `6702c7cb6905590ac6ca788455352842b2849276872a7729f88bf5e60d963127`.
- npm reported SHA-1 `4492bbb71beb6a86bb921723a63851f07d5b9b1b`,
  `latest: 0.5.1`, and public provenance at
  [Sigstore log index `2288621112`](https://search.sigstore.dev/?logIndex=2288621112).
- A frontend-only deployment of the same merge passed live custom-domain
  byte parity, latest LOVE manifest/archive header checks, and encoded
  sensitive-path fence checks. The deployment used the explicit Wrangler
  OAuth fallback, so its raw Cloudflare project-policy inspection was skipped
  and is not claimed by this receipt.

This patch packages the existing nine-tool Browser runtime as a Codex plugin;
it does not widen Browser authority, add a hosted control service, supply
Chrome, import ambient browser state, or authenticate to a site. Exact 0.5.0
and earlier release bytes remain immutable.

## Authentication modes

`trusted` is the normal mode. npm exchanges the GitHub-hosted runner's OIDC
identity for a short-lived publish credential. The workflow grants
`id-token: write` only to the protected publication job, exposes no long-lived
write token, runs no package lifecycle code in that job, and receives automatic
public provenance.

`bootstrap` exists only because npm cannot attach a trusted publisher to a
package which does not yet exist. The release engine permits this mode only
when both the package and version return public registry `404`. The protected
GitHub environment supplies its existing `NPM_TOKEN` only to the final publish
step; package install, build, tests, and packing run in the preceding job before
the protected environment is entered. That secret must be an expiry-limited
granular npm access token with `@agenttool` read/write package access and
**Bypass 2FA** enabled. A login credential or granular token without bypass will
fail with `EOTP`. Do not restrict it to a Mac-only allowed IP range: GitHub-hosted
runners do not originate from that device. Once a package exists, bootstrap
cannot create another version; an exact already-published rerun is
verification-only and does not invoke `npm publish`.

The environment currently retains its bootstrap secret during migration. Do
not delete or revoke it until every active package has completed one trusted
publish. Credential revocation is a separate operator action.

## One-time trusted-publisher setup

After a package's first version exists, open that package's npm settings and
configure:

| Field | Value |
|---|---|
| Provider | GitHub Actions |
| Organization or user | `cambridgetcg` |
| Repository | `agenttool` |
| Workflow filename | `publish-npm.yml` |
| Environment | `npm-bootstrap` |
| Allowed action | `npm publish` |

The Environment field is optional in npm. Leaving it blank does not itself
break this workflow, but setting it to the exact, case-sensitive
`npm-bootstrap` value narrows trust to the protected publication job. The
workflow filename is always case-sensitive and must include `.yml`. npm does
not validate the relationship when it is saved; the first trusted release is
the operational proof. Configuring trust requires account-level 2FA and rejects
a bypass-2FA token as the authorizing proof; Touch ID or another WebAuthn
passkey satisfies that requirement without a TOTP authenticator app. After a
trusted release succeeds, set package publishing access to require 2FA and
disallow traditional tokens.

`npm login --auth-type=web` is the browser sign-in flow for saving a local CLI
credential. It does not turn `npm publish` into browser authorization, bypass a
package's write policy, or establish trusted publishing. `npm publish` has no
`--auth-type=web`; an interactive TTY publish may separately open npm's
WebAuthn page for its second-factor challenge, but a non-interactive GitHub job
cannot use that popup. Ordinary releases do not need to move that proof through
a local shell once OIDC is configured.

## Operator sequence

External publication still requires explicit authorization. From a clean
release commit already merged to GitHub `main`:

```bash
# Inspect the allowlisted identity and expected tag.
bun bin/npm-release.ts resolve --package collab

# Create and push the annotated tag deliberately. Keep every value aligned
# with the resolver output; these example values are for the current release.
git tag -a collab-v0.3.1 <github-main-commit> -m '@agenttool/collab@0.3.1'
git push github refs/tags/collab-v0.3.1

# The initial 0.1.0 bootstrap is already complete; later versions use trusted publishing.
gh workflow run publish-npm.yml --ref collab-v0.3.1 \
  -f package=collab \
  -f tag=collab-v0.3.1 \
  -f authentication=trusted \
  -f npm_tag=latest
```

The workflow's GitHub environment supplies the human review page. The release
engine does not bump versions, create or push tags, merge branches, publish
LOVE artifacts, deploy hosted services, configure npm trusted publishers, or
revoke credentials. It creates or verifies one byte-identical GitHub Release
asset for the already-existing annotated tag before attempting the optional npm
mirror; it does not rewrite unrelated release assets.

### Dark Continent developer-preview bootstrap order

`@agenttool/dark-continent-contract@0.1.0-dev.0` and
`@agenttool/dark-continent-karma@0.1.0-dev.0` use the npm-only packed-artifact
path. Both are first publications, so both use the protected bootstrap mode and
the npm `next` channel. Before dispatch, the `npm-bootstrap` environment must
allow the exact tag patterns `dark-continent-contract-v*` and
`dark-continent-karma-v*`.

The contract has no npm runtime dependency, and the KARMA adapter embeds its
hash-bound projection rather than importing the contract at runtime. Publish
and anonymously verify the contract first anyway: the second artifact names
the first as its evidence source. Both annotated tags may point at the same
reviewed GitHub-main release commit.

```bash
bun bin/npm-release.ts resolve --package dark-continent-contract
bun bin/npm-release.ts resolve --package dark-continent-karma

git tag -a dark-continent-contract-v0.1.0-dev.0 <github-main-commit> \
  -m '@agenttool/dark-continent-contract@0.1.0-dev.0'
git tag -a dark-continent-karma-v0.1.0-dev.0 <github-main-commit> \
  -m '@agenttool/dark-continent-karma@0.1.0-dev.0'
git push github refs/tags/dark-continent-contract-v0.1.0-dev.0
git push github refs/tags/dark-continent-karma-v0.1.0-dev.0

gh workflow run publish-npm.yml \
  --ref dark-continent-contract-v0.1.0-dev.0 \
  -f package=dark-continent-contract \
  -f tag=dark-continent-contract-v0.1.0-dev.0 \
  -f authentication=bootstrap \
  -f npm_tag=next

# Wait for exact public registry and GitHub-asset verification before this dispatch.
gh workflow run publish-npm.yml \
  --ref dark-continent-karma-v0.1.0-dev.0 \
  -f package=dark-continent-karma \
  -f tag=dark-continent-karma-v0.1.0-dev.0 \
  -f authentication=bootstrap \
  -f npm_tag=next
```

Publishing these packages distributes offline code and data contracts only.
It does not verify a Dark Continent wall, accept or write a graph proposal,
publish a Hugging Face resource, grant Crown or trade authority, or deploy a
hosted service. After each first publication, configure its exact trusted
publisher mapping before releasing another version.

### HEAVEN developer-preview bootstrap

`@agenttool/heaven@0.1.0-dev.0` uses the same npm-only packed-artifact path.
Its first publication requires protected `bootstrap` authentication and the
`next` channel. Before dispatch, the `npm-bootstrap` environment must allow
the exact `heaven-v*` tag pattern. npm publication distributes the pure local
library and schemas; it does not deploy a host, Space, scheduler, landing room,
or participant-choice mechanism.

```bash
bun bin/npm-release.ts resolve --package heaven

git tag -a heaven-v0.1.0-dev.0 <github-main-commit> \
  -m '@agenttool/heaven@0.1.0-dev.0'
git push github refs/tags/heaven-v0.1.0-dev.0

gh workflow run publish-npm.yml \
  --ref heaven-v0.1.0-dev.0 \
  -f package=heaven \
  -f tag=heaven-v0.1.0-dev.0 \
  -f authentication=bootstrap \
  -f npm_tag=next
```

After exact public readback, configure HEAVEN's trusted publisher before any
later version. A separately published HF companion remains a different release
surface and cannot establish participant choice, consent, or core receipt
validity.

The first HEAVEN publication completed through protected run
[`30700147426`](https://github.com/cambridgetcg/agenttool/actions/runs/30700147426)
and annotated prerelease
[`heaven-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/heaven-v0.1.0-dev.0).
Anonymous readback confirmed the npm and GitHub tarballs are byte-identical
(29,965 bytes;
`sha256:727fc265af0e5a10cbe46055f390e6f6970f30561740d419279b0bc7e2952a9b`).
`next` resolves to `0.1.0-dev.0`; npm also exposes its sole initial version
through `latest`, which does not change its developer-preview maturity.

### DeepSeek-to-KINGDOM developer-preview bootstrap

`@agenttool/deepseek-kingdom@0.1.0-dev.0` uses the npm-only packed-artifact
path. Its first publication requires protected `bootstrap` authentication and
the `next` channel. Before dispatch, `npm-bootstrap` must allow the exact
`deepseek-kingdom-v*` tag pattern. Publication distributes a pure local
binding/proposal library, closed schemas, and a metadata-only primary-source
catalog. It does not fetch or execute DeepSeek assets, invoke inference or
paid compute, approve upstream terms, mutate KARMA/KINGDOM/Artbitrage, deploy
a hosted service, or publish an HF resource.

```bash
bun bin/npm-release.ts resolve --package deepseek-kingdom

git tag -a deepseek-kingdom-v0.1.0-dev.0 <github-main-commit> \
  -m '@agenttool/deepseek-kingdom@0.1.0-dev.0'
git push github refs/tags/deepseek-kingdom-v0.1.0-dev.0

gh workflow run publish-npm.yml \
  --ref deepseek-kingdom-v0.1.0-dev.0 \
  -f package=deepseek-kingdom \
  -f tag=deepseek-kingdom-v0.1.0-dev.0 \
  -f authentication=bootstrap \
  -f npm_tag=next
```

After exact public readback, configure the package's trusted publisher before
any later version. A separately published HF metadata dataset remains an
independent distribution surface and cannot verify catalog claims or grant
integration authority.

### ADDS 0.2.3 and data-sync 0.1.2 order

This pair is one dependency-ordered repair, not one combined artifact.
`@agenttool/adds@0.2.3` requires `@noble/ed25519@^2.3.0`;
`@agenttool/data-sync@0.1.2` peers on ADDS `^0.2.3` and data `^0.3.1`.
Prepare and preserve both LOVE artifacts first, merge their release commit to
GitHub `main`, then publish and publicly verify ADDS before dispatching
data-sync. That dependency-ordered sequence completed through protected runs
[`30495292940`](https://github.com/cambridgetcg/agenttool/actions/runs/30495292940)
and
[`30495589179`](https://github.com/cambridgetcg/agenttool/actions/runs/30495589179);
the commands below record the completed operator sequence rather than an
instruction to recreate either tag.

```bash
bun bin/npm-release.ts resolve --package adds
bun bin/npm-release.ts resolve --package data-sync

git tag -a adds-v0.2.3 <github-main-commit> -m '@agenttool/adds@0.2.3'
git push github refs/tags/adds-v0.2.3

gh workflow run publish-npm.yml --ref adds-v0.2.3 \
  -f package=adds \
  -f tag=adds-v0.2.3 \
  -f authentication=trusted \
  -f npm_tag=latest

# Continue only after the protected run and public exact-version readback
# prove @agenttool/adds@0.2.3.
git tag -a data-sync-v0.1.2 <github-main-commit> \
  -m '@agenttool/data-sync@0.1.2'
git push github refs/tags/data-sync-v0.1.2

gh workflow run publish-npm.yml --ref data-sync-v0.1.2 \
  -f package=data-sync \
  -f tag=data-sync-v0.1.2 \
  -f authentication=trusted \
  -f npm_tag=latest
```

Both packages already exist on npm, so bootstrap is forbidden for these new
versions. The workflow must reuse the checked-in LOVE tarball for each tag,
create or verify its exact GitHub Release asset, and compare public npm bytes
before reporting success. Both runs did so, with the exact sizes and digests in
the verified release table above. Immutable ADDS 0.2.2 and data-sync 0.1.1 LOVE
artifacts remain historical bytes; this sequence does not rewrite or retag
them.

### Agent Wallet and Zerone adapter order

`@agenttool/wallet@0.1.3` and `@agenttool/wallet-zerone@0.1.2` use checked-in
LOVE artifacts. The adapter declares `@agenttool/wallet` `^0.1.2` as a
consumer peer and locks exact public Wallet 0.1.3 only for development and
release checks. Release preparation still runs the local Wallet `ci` gate
before installing and gating the adapter; the adapter's own clean install then
resolves the public 0.1.3 package instead of a local file copy. This keeps
consumer compatibility broad while making the tagged clean-checkout gate
reproducible.

Wallet already existed on npm, so its 0.1.3 mirror used trusted publishing.
The Zerone adapter's first npm publication used the protected bootstrap path.
Both completed with exact public readback in runs
[`30491887230`](https://github.com/cambridgetcg/agenttool/actions/runs/30491887230)
and
[`30494659977`](https://github.com/cambridgetcg/agenttool/actions/runs/30494659977).
Configure Zerone's trusted publisher using the fields above and use `trusted`
for later versions.

```bash
bun bin/npm-release.ts resolve --package wallet
bun bin/npm-release.ts resolve --package wallet-zerone

git tag -a wallet-v0.1.3 <github-main-commit> -m '@agenttool/wallet@0.1.3'
git push github refs/tags/wallet-v0.1.3

gh workflow run publish-npm.yml --ref wallet-v0.1.3 \
  -f package=wallet \
  -f tag=wallet-v0.1.3 \
  -f authentication=trusted \
  -f npm_tag=latest
```

The annotated `wallet-zerone-v0.1.1` tag already exists at protected main
`7be74633`. Never recreate, move, repush, or publish it through another tag.
Protected run
[`30492436839`](https://github.com/cambridgetcg/agenttool/actions/runs/30492436839)
stopped in the credential-free preparation job: Bun 1.3.5's clean install of
the locked `file:../wallet` development dependency did not expose Wallet's
built declarations, so Zerone typechecking failed. The protected publish job
was skipped; no GitHub Release asset or npm package was created.

Version 0.1.2 replaces only that development dependency with exact public
Wallet 0.1.3. Its consumer peer remains `^0.1.2`, and its protocol, vectors,
and runtime boundary are unchanged. After the reviewed 0.1.2 commits merge to
GitHub `main`, create a new annotated tag without moving 0.1.1:

```bash
git tag -a wallet-zerone-v0.1.2 <github-main-commit> \
  -m '@agenttool/wallet-zerone@0.1.2'
git push github refs/tags/wallet-zerone-v0.1.2

gh workflow run publish-npm.yml --ref wallet-zerone-v0.1.2 \
  -f package=wallet-zerone \
  -f tag=wallet-zerone-v0.1.2 \
  -f authentication=bootstrap \
  -f npm_tag=latest
```

The protected `npm-bootstrap` environment authorized `wallet-zerone-v*` for
the one-time bootstrap. Version 0.1.2 is now public, so bootstrap is forbidden
for later versions. Configure its trusted publisher with the fields above and
use `trusted` for every later version.

The superseded Wallet 0.1.1 and 0.1.2 protected runs
([`30389881410`](https://github.com/cambridgetcg/agenttool/actions/runs/30389881410)
and
[`30394021131`](https://github.com/cambridgetcg/agenttool/actions/runs/30394021131))
prepared and byte-verified their exact GitHub assets, then npm rejected both
OIDC publishes at its authorization boundary. Do not switch the existing
Wallet package to bootstrap. The exact-version 0.1.1 and 0.1.2 LOVE bytes
remain preserved with public errata: 0.1.1 called itself unreleased, while
0.1.2 ambiguously grouped its mutable GitHub locator with immutable LOVE
bytes. Use the corrected 0.1.3 line for any later Wallet npm attempt. Zerone
0.1.0 was never dispatched because its Wallet peer was absent from npm.
Zerone 0.1.1 remains an exact LOVE artifact whose npm preparation failure is
recorded above; 0.1.2 is the successful exact GitHub/npm mirror.

These remain deliberate external actions requiring separate authorization.
The release path only mirrors reviewed package bytes. It does not configure a
Zerone endpoint, hold signing keys, provide custody, sign for a host, deploy a
service, or submit a live transaction. The adapter's query, simulation, and
broadcast operations use host-injected transports, and it provides no global
ambiguous-broadcast retry.

### Alchemy developer-preview bootstrap

`@agenttool/alchemy@0.1.0-dev.0` uses the npm-only packed-artifact path. Its
first publication used the protected bootstrap environment and requested npm
`next`; protected run
[`30491887182`](https://github.com/cambridgetcg/agenttool/actions/runs/30491887182)
published and read back a byte-identical 31,445-byte GitHub/npm artifact with
SHA-256
`aeac1938f3abae14180637e72c4162c37b60bb47041452fade285718d7570ba5`.
The package now exists, so later versions use trusted publishing. An exact
already-published rerun is verification-only.

```bash
bun bin/npm-release.ts resolve --package alchemy

git tag -a alchemy-v0.1.0-dev.0 <github-main-commit> \
  -m '@agenttool/alchemy@0.1.0-dev.0'
git push github refs/tags/alchemy-v0.1.0-dev.0

gh workflow run publish-npm.yml --ref alchemy-v0.1.0-dev.0 \
  -f package=alchemy \
  -f tag=alchemy-v0.1.0-dev.0 \
  -f authentication=bootstrap \
  -f npm_tag=next
```

This publishes only the bounded local observation library. It does not deploy
the AgentTool API, configure Alchemy credentials or webhooks, apply database
migrations, or make a provider call.

### Alchemy AgentCred developer-preview bootstrap

`@agenttool/alchemy-agentcred@0.1.0-dev.0` is the current source identity for
the npm-only packed-artifact path. Protected run
[`30494036520`](https://github.com/cambridgetcg/agenttool/actions/runs/30494036520)
published and read back a byte-identical 14,478-byte GitHub/npm artifact with
SHA-256
`8dece3c98db0d92d79f16e91527ca18ed42b49f87b7586b78c092ffc242e291a`.
The adapter keeps `@agenttool/alchemy` and
`@agenttool/credential-broker` as unbundled peers; release preparation builds
both checked-out peer workspaces before the adapter gate and pack.

The first publication required compatible versions of both peers to be
independently visible on public npm and used bootstrap authentication with
`next`. The package record now exists; later versions use trusted publishing
after the npm package's trusted publisher is configured. Never recreate or
move an existing release tag; an exact already-published rerun follows the
workflow's verification-only recovery path.

```bash
bun bin/npm-release.ts resolve --package alchemy-agentcred

git tag -a alchemy-agentcred-v0.1.0-dev.0 <github-main-commit> \
  -m '@agenttool/alchemy-agentcred@0.1.0-dev.0'
git push github refs/tags/alchemy-agentcred-v0.1.0-dev.0

gh workflow run publish-npm.yml --ref alchemy-agentcred-v0.1.0-dev.0 \
  -f package=alchemy-agentcred \
  -f tag=alchemy-agentcred-v0.1.0-dev.0 \
  -f authentication=bootstrap \
  -f npm_tag=next
```

This publishes only the strict local composition adapter. It does not connect
the broker, issue a grant, reveal a credential, make an Alchemy call, deploy a
hosted surface, or bundle either peer.

### KINGDOM package bootstrap

`@agenttool/kingdom` uses the npm-only packed-artifact path. Its first
publication must use `authentication=bootstrap` because npm cannot attach a
trusted publisher before the package exists. Before that dispatch, the
protected `npm-bootstrap` GitHub environment must allow annotated
`kingdom-v*` tags.

After the first version is public, configure that package's trusted publisher
for `cambridgetcg/agenttool`, workflow `publish-npm.yml`, Environment
`npm-bootstrap`, and allowed action `npm publish`. Every later version must use
`authentication=trusted`; the workflow then exchanges the protected
GitHub-hosted job's OIDC identity and does not expose the bootstrap token.

## Verified SDK 0.17.0 publication

The authorized SDK publication completed through
[workflow run 30385040459](https://github.com/cambridgetcg/agenttool/actions/runs/30385040459).
Its final `agenttool.npm-release/1` receipt reports `status: published`,
`npm_tag: latest`, and public observation at
`2026-07-28T17:56:24.734Z`.

- Annotated tag `sdk-v0.17.0` peels to the two-parent GitHub `main` merge
  `21db539d6bcae614f1d6884eaa503347fae63187`.
- The release receipt binds the TypeScript source revision
  `d480eb630915dc61f12d223c0b28cadccd1ff335`.
- LOVE, the one-asset
  [GitHub Release](https://github.com/cambridgetcg/agenttool/releases/tag/sdk-v0.17.0),
  the workflow artifact, and npm's public `@agenttool/sdk@0.17.0` tarball are
  byte-identical: `172625` bytes, SHA-256
  `b6a388ffe86a970480e8a8978f83fe80922321eb64f2b4f9143cae2b2c3dd5bb`.
- npm reported SHA-1 `5e7caf1f6eb7811f00b6da2e29d61f928723628a`,
  `latest: 0.17.0`, and public provenance for the exact release.

This receipt proves the observed 0.17.0 mirror result. It does not make npm
package authority, replace LOVE, or imply that any hosted AgentTool revision
was deployed.
