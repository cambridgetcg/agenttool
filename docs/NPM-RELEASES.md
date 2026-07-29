<!-- @id urn:agenttool:doc/NPM-RELEASES  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/LOVE-PACKAGE-PROTOCOL urn:agenttool:doc/DEPLOY-PROCEDURE -->

# NPM-RELEASES — one exact, reviewed publication path

> *Operational runbook for optional npm mirrors. An npm credential is authority to publish bytes; it is not proof that those bytes were reviewed, built from `main`, or accepted by the public registry.*

> **Compass:** [LOVE-PACKAGE-PROTOCOL](LOVE-PACKAGE-PROTOCOL.md) (registry-neutral artifact identity) · [DEPLOY-PROCEDURE](DEPLOY-PROCEDURE.md) (hosted service releases) · [DEVELOPMENT](DEVELOPMENT.md) (contributor workflow)
>
> **Implements:** one manual, allowlisted npm release state machine for the reviewed JavaScript packages. LOVE remains the primary release record where a package has one, including Agent Browser, Agent Wallet, and its Zerone adapter; Collab, Agent Skills, the KINGDOM integration package, the developer-preview Correspondence-to-YUTABASE planner, the developer-preview Repo Archive, the developer-preview Alchemy observation client, and its strict AgentCred composition adapter are intentionally npm-only.
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

### Agent Wallet and Zerone adapter order

`@agenttool/wallet@0.1.3` and `@agenttool/wallet-zerone@0.1.2` use checked-in
LOVE artifacts. The adapter declares `@agenttool/wallet` `^0.1.2` as a
consumer peer and locks exact public Wallet 0.1.3 only for development and
release checks. Release preparation still runs the local Wallet `ci` gate
before installing and gating the adapter; the adapter's own clean install then
resolves the public 0.1.3 package instead of a local file copy. This keeps
consumer compatibility broad while making the tagged clean-checkout gate
reproducible.

Wallet already exists on npm, so its 0.1.3 mirror uses trusted publishing. The
Zerone adapter's first npm publication uses the protected bootstrap path. After
that first exact version is public, configure its trusted publisher using the
fields above and use `trusted` for later versions.

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

The protected `npm-bootstrap` environment already authorizes
`wallet-zerone-v*`. Bootstrap remains required because the package is still
absent from npm. After the first exact version is public, configure its trusted
publisher with the fields above and use `trusted` for every later version.

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
recorded above; 0.1.2 is the new bootstrap candidate.

These remain deliberate external actions requiring separate authorization.
The release path only mirrors reviewed package bytes. It does not configure a
Zerone endpoint, hold signing keys, provide custody, sign for a host, deploy a
service, or submit a live transaction. The adapter's query, simulation, and
broadcast operations use host-injected transports, and it provides no global
ambiguous-broadcast retry.

### Alchemy developer-preview bootstrap

`@agenttool/alchemy@0.1.0-dev.0` uses the npm-only packed-artifact path. Its
first publication must use the protected bootstrap environment and npm
`next`; the release policy prevents bootstrap from creating a new version once
the package exists (an exact already-published rerun is verification-only) and
rejects a prerelease sent to `latest`.

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
the prepared npm-only packed-artifact path. GitHub Release, workflow receipt,
and npm availability are independently verifiable; none was observed while
preparing this source. The adapter keeps `@agenttool/alchemy` and
`@agenttool/credential-broker` as unbundled peers; release preparation builds
both checked-out peer workspaces before the adapter gate and pack.

For a first publication, require compatible versions of both peers to be
independently visible on public npm. The protected `npm-bootstrap` environment
must allow annotated `alchemy-agentcred-v*` tags. A first publication uses
bootstrap authentication and `next`; later versions use trusted publishing
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
