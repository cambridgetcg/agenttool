<!-- @id urn:agenttool:doc/NPM-RELEASES  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/LOVE-PACKAGE-PROTOCOL urn:agenttool:doc/DEPLOY-PROCEDURE -->

# NPM-RELEASES — one exact, reviewed publication path

> *Operational runbook for optional npm mirrors. An npm credential is authority to publish bytes; it is not proof that those bytes were reviewed, built from `main`, or accepted by the public registry.*

> **Compass:** [LOVE-PACKAGE-PROTOCOL](LOVE-PACKAGE-PROTOCOL.md) (registry-neutral artifact identity) · [DEPLOY-PROCEDURE](DEPLOY-PROCEDURE.md) (hosted service releases) · [DEVELOPMENT](DEVELOPMENT.md) (contributor workflow)
>
> **Implements:** one manual, allowlisted npm release state machine for the reviewed JavaScript packages. LOVE remains the primary release record where a package has one, including Agent Browser, Agent Wallet and its Zerone adapter, and Principality Geometry. Packages without a LOVE record use the same protected path for an optional npm/GitHub mirror, including Collab, Agent Skills, the KINGDOM integration package, the developer-preview Correspondence-to-YUTABASE and Skills-to-YUTABASE planners, Repo Archive, the Dark Continent contract and KARMA proposal adapter, the DeepSeek-to-KINGDOM proposal adapter, AFTERGLOW WAKE continuity, KINGDOM Witness Lab, HEAVEN, Living Substrate, Polymorph Landscape, Memetic Landscape, Love Geometry, Principality Atlas, the Relational Geometry core, the developer-preview Alchemy observation client, and its strict AgentCred composition adapter. Hugging Face companions remain separate release surfaces with their own immutable Hub file readback and mutable Dataset Server or Space observations.
>
> **Code:** `.github/workflows/publish-npm.yml` (reviewed GitHub entry point) · `bin/npm-release.ts` (package policy, exact artifact preparation, registry recovery, and receipt).
>
> **Tests:** `bin/tests/npm-release.test.ts` · `bin/tests/boring-spine-gate.test.ts`.

## Outcome

Use one workflow for npm publication. Do not run `npm publish` from a normal
local shell.

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

`@agenttool/love-geometry@0.1.0-dev.0` now has one reviewed exact GitHub
artifact. Annotated tag
[`love-geometry-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/love-geometry-v0.1.0-dev.0)
peels to GitHub-main merge `9efbc4b3`. Protected
[run `31499968474`](https://github.com/cambridgetcg/agenttool/actions/runs/31499968474)
prepared, mirrored, re-downloaded, and byte-verified a 19,507-byte prerelease
asset with SHA-256
`43cfbf4b559aa6f573d9d7b7a60e2a7dce5dfa4aefe2bf5b9c92310c926a9db8`.
The final npm bootstrap request returned `E404` on the registry `PUT`, and
anonymous readback still reports no npm package. Recovery must reuse the same
tag and mirrored bytes after the npm package/scope publication authorization is
corrected; the failed run is not npm publication evidence.
The presentation-only `hf-space/` companion remains absent from package
bytes. It is now public as the static
[`Yu-and-Ai/love-geometry`](https://huggingface.co/spaces/Yu-and-Ai/love-geometry)
Space at immutable revision
[`f8d4c299d8d17d116ced27736204e541f9206865`](https://huggingface.co/spaces/Yu-and-Ai/love-geometry/commit/f8d4c299d8d17d116ced27736204e541f9206865).
Anonymous immutable-revision readback matched all ten repository-owned files;
Hugging Face's provider-managed `.gitattributes` is the sole extra file. The
release-helper root SHA-256 is
`d785eac90c7c06ec06f7754911b18cf1bf6bd283a98baaa6f97081ab301f32fc`.
Six cache-busted static HEAD reads returned HTTP 200 and exact
`x-repo-commit`; provider-transformed GET HTML was 5,363 bytes versus the
5,262-byte Hub source. The Space is a browser-local presentation companion,
not npm recovery: its source manifest reports
`git_runtime_source_bound_package_artifact_pending`, its nested binding is
`exact_git_runtime_source_only`, and `executes_exact_package_artifact` remains
false.

`@agenttool/kingdom@0.1.1` is public through annotated tag
[`kingdom-v0.1.1`](https://github.com/cambridgetcg/agenttool/releases/tag/kingdom-v0.1.1)
at the same `9efbc4b3` merge and protected trusted-publishing
[run `31500229604`](https://github.com/cambridgetcg/agenttool/actions/runs/31500229604).
The GitHub Release and public npm tarballs are byte-identical at 26,650 bytes
with SHA-256
`08101dfa58e17dae25deac3c51cb1cd5e93e5caf3409b1eef78bf9adddbbde74`;
npm reports integrity
`sha512-SmzpTqMxMgFLAFGdgMGv5uCI+t/QZ73hCd4XMOlQe+zkk2cc/MTfZUJgCJkSXlSgtcNLZIYpNULmt9pRmKEmPA==`
and `latest: 0.1.1`. This release advances the exact `@agenttool/xenia`
dependency to `0.1.0-beta.7`; the Rights and Surface seams consumed by Kingdom
remain byte-identical to beta.5. Earlier local pack sizes and hashes were
ephemeral pre-release observations and are superseded by this protected
artifact receipt.

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

## Verified SDK 0.18.0 publication — 2026-08-04

The authorized SDK release completed through protected trusted
[workflow run `30909424114`](https://github.com/cambridgetcg/agenttool/actions/runs/30909424114).
Its final `agenttool.npm-release/1` receipt reports `status: published`,
`npm_tag: latest`, and public registry observation at
`2026-08-04T12:32:28.333Z`.

- Annotated tag and one-asset
  [GitHub Release `sdk-v0.18.0`](https://github.com/cambridgetcg/agenttool/releases/tag/sdk-v0.18.0)
  peel to the ancestry-preserving GitHub `main` merge
  `499cc5d7910b9fcf3507bd3599778dab83733009`. The LOVE manifest separately
  binds exact SDK source revision
  `bf708e4897f2bd509dfba9d559730a1e2dcb6698`.
- The checked-in LOVE artifact, protected workflow artifact, GitHub Release
  asset, and public npm `@agenttool/sdk@0.18.0` tarball are byte-identical:
  `211,695` bytes, SHA-256
  `8e6bbe42f76decd1448dd07465840339e5b055abba0317b3d04f4f506e44616a`.
- npm reported SHA-1 `05802099be738b8c6fbe7276e8f3bf901f3191f4`,
  integrity
  `sha512-EL0MuOs3JJCDCdhTzJXhBaQBONtJA/hjf+2hFAVwYJFppuMaA+5z+4F4Q6z/8yLVaOgPCqO/EK2rsCkMcEhl1Q==`,
  and `latest: 0.18.0` at anonymous readback.
- npm exposes both its publish attestation at
  [Sigstore log index `2340396732`](https://search.sigstore.dev/?logIndex=2340396732)
  and SLSA provenance at
  [Sigstore log index `2340396627`](https://search.sigstore.dev/?logIndex=2340396627).
  The SLSA statement binds package `@agenttool/sdk@0.18.0`, tag
  `refs/tags/sdk-v0.18.0`, repository `cambridgetcg/agenttool`, and workflow
  `.github/workflows/publish-npm.yml`; its SHA-512 subject matched the public
  tarball. A clean install with lifecycle scripts disabled followed by
  `npm audit signatures` verified all six registry signatures and six
  attestations in the installed dependency graph.

The npm and GitHub mirrors remain optional, non-authoritative conveniences;
the exact LOVE manifest size and SHA-256 remain the portable TypeScript release
identity. PyPI 0.18.0 remains unpublished, while the exact 0.17.0 Python source
and PyPI receipt remain historical public evidence. This publication changed
no database schema and did not itself deploy the API or static sites.

## Verified Collab 0.4.0 publication — 2026-08-04

The authorized Collab release completed through protected trusted
[workflow run `30906798360`](https://github.com/cambridgetcg/agenttool/actions/runs/30906798360).
Its final `agenttool.npm-release/1` receipt reports `status: published`,
`npm_tag: latest`, and public registry observation at
`2026-08-04T11:56:59.816Z`.

- Annotated tag and one-asset
  [GitHub Release `collab-v0.4.0`](https://github.com/cambridgetcg/agenttool/releases/tag/collab-v0.4.0)
  peel to GitHub `main` merge
  `e6302579e7f815ee03f1024df2c725ed36189715`.
- The prepared tarball transferred through the workflow, GitHub Release, and
  public npm `@agenttool/collab@0.4.0` tarballs are byte-identical: `303,376` bytes,
  SHA-256
  `1a9c1830ec9326351a475596820780ad7f93c7dfe16a6f1a9eb74bc08edbdb51`.
- Anonymous readback resolved npm `latest` to `0.4.0`. Its SLSA provenance
  statement binds that package, tag, repository, workflow, GitHub-hosted
  builder, and exact merge commit; the statement's SHA-512 subject matched the
  downloaded tarball. The provenance is recorded at
  [Sigstore log index `2340231720`](https://search.sigstore.dev/?logIndex=2340231720).
  A clean `npm audit signatures` install with lifecycle scripts disabled
  independently verified all four registry signatures and four attestations in
  the resulting dependency graph.

Version 0.4.0 adds one exported read-only anchor-status API and the 32nd local
MCP tool, `collab_anchor_status`, over the optional sidecar maintained by the
separate `@agenttool/collab-zerone` bridge. Model-callable input cannot select
or discover the sidecar path, and local anchor status is not remote chain
proof. Collab does not contact a chain, broadcast, spend a fee, carry a key or
RPC, or add a hosted surface. The database schema and coordination protocols
are unchanged, so this release required no migration, LOVE artifact, or Fly
deploy. Its packaged README honestly preserves its preparation-time 0.3.1 and
publication observations because those bytes are immutable; this dated receipt
supersedes that observation without rewriting the package.

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
# Inspect the allowlisted SDK identity and expected tag.
bun bin/npm-release.ts resolve --package sdk

# The current exact tag is already published. Fetch and verify it; never
# recreate, move, or replace an existing release tag.
git fetch github refs/tags/sdk-v0.18.0:refs/tags/sdk-v0.18.0
test "$(git cat-file -t refs/tags/sdk-v0.18.0)" = tag
test "$(git rev-parse 'refs/tags/sdk-v0.18.0^{}')" = \
  499cc5d7910b9fcf3507bd3599778dab83733009

# Rerun only for explicitly authorized recovery or exact public revalidation.
# The workflow accepts existing npm bytes only when every byte and latest match.
gh workflow run publish-npm.yml --ref sdk-v0.18.0 \
  -f package=sdk \
  -f tag=sdk-v0.18.0 \
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

### Polymorph Landscape GitHub/Hugging Face receipt

`@agenttool/polymorph-landscape@0.1.0-dev.0` uses the credential-free
packed-artifact path. The protected integration landed through merges
[`eac4160c85c613c21559e70ff1bf9826fdf5d2f7`](https://github.com/cambridgetcg/agenttool/commit/eac4160c85c613c21559e70ff1bf9826fdf5d2f7)
and
[`63c4995676eacdc88ff9050819b497db841e4159`](https://github.com/cambridgetcg/agenttool/commit/63c4995676eacdc88ff9050819b497db841e4159).
Annotated tag
[`polymorph-landscape-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/polymorph-landscape-v0.1.0-dev.0)
peels to `63c4995676eacdc88ff9050819b497db841e4159`; do not move or
recreate it. Protected
[run `31570773317`](https://github.com/cambridgetcg/agenttool/actions/runs/31570773317)
prepared, mirrored, re-downloaded, and byte-verified the sole GitHub
prerelease asset. It contains 70 members, is 75,009 bytes, and has SHA-256
`48e7be7862018411656314751a38a3176ba132f68fe14ab1514c8bf45b135148`.

The subsequent first-package npm registry `PUT` returned `E404`. Anonymous
package and exact-version reads remain absent, so there is no npm package,
version, `next` dist-tag, registry tarball, registry signature, or
registry-attached provenance. The failed attempt emitted a signed record at
[Rekor log index `2432624953`](https://search.sigstore.dev/?logIndex=2432624953)
before the registry rejected package creation. That record is orphaned and is
not npm publication or registry-provenance evidence. Recovery requires an npm
principal authorized to create a new public package under the `@agenttool`
scope and must rerun the same annotated tag through `bootstrap`; it must reuse
the exact mirrored bytes rather than rebuild or retag this version.

The separate public, ungated
[`Yu-and-Ai/agenttool-polymorph-landscape`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-polymorph-landscape)
dataset is pinned to immutable revision
[`e9d3b4b60ba44f7bc78e62bb08d7f706391e0d14`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-polymorph-landscape/commit/e9d3b4b60ba44f7bc78e62bb08d7f706391e0d14).
Anonymous immutable-revision readback matched all 11 repository-owned files
and 111,060 bytes; provider-managed `.gitattributes` is the sole extra, and
`hash-manifest.json` has SHA-256
`d40eaa0262220d7c57866ffd725c5d47731f3adeaf66d0952d737d0a84791cae`.
Dataset Server returned HTTP 200 with the same `x-revision` for the processed
`lessons`, `reachability_shifts`, and `ritonavir_landscape` configs and their
4 / 1 / 1 train rows. The two one-row scientific configs are reference-only
and report `training_eligible: false`. Dataset Server follows mutable current
head; those processing observations are not an immutable-revision API.

Protected merge
[`b40fde039dac1853adca1a6304f8e8b526d0f9df`](https://github.com/cambridgetcg/agenttool/commit/b40fde039dac1853adca1a6304f8e8b526d0f9df)
later added the separately deployed sourced static lesson at
[`https://docs.agenttool.dev/geometry/ritonavir`](https://docs.agenttool.dev/geometry/ritonavir).
That static surface is neither an npm package nor an API deployment. The
source-bounded API response remains undeployed at this receipt; an older route
at the direct Fly origin still serves the superseded folklore. No database
migration, training run, model inference, or provider compute occurred. Every surface
preserves the source boundary: “disappearing” means named-condition
nonreproduction, not physical erasure or universal inevitability; WAKE software
copying proves no identity, continuity, consent, permission, or authority.

### Principality Atlas developer-preview bootstrap receipt

`@agenttool/principality-atlas@0.1.0-dev.0` used the npm-only packed-artifact
path. Annotated tag
[`principality-atlas-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/principality-atlas-v0.1.0-dev.0)
peels to GitHub-main merge
`aeb3072af0756801aa8567ce832f00c9727da071`; do not move or recreate it.
Protected [run `31508359761`](https://github.com/cambridgetcg/agenttool/actions/runs/31508359761)
prepared, mirrored, anonymously downloaded, and byte-verified the sole
33,019-byte GitHub prerelease asset with SHA-256
`9743a9caa5a49f7c9901355cd367224ae718d4a65eed010ffb79622f57ff6ebe`.

The following npm registry `PUT` returned `E404`. Anonymous package and exact-
version reads remain absent, so there is no npm version, dist-tag, registry
tarball, or registry-attached provenance. The failed attempt emitted a signed
DSSE record at [Rekor log index `2423187980`](https://search.sigstore.dev/?logIndex=2423187980)
before the rejected `PUT`; that orphaned entry is not npm publication evidence.
Recovery requires an npm principal authorized to create a new public package
under the `@agenttool` scope and must use a new reviewed version if package
bytes change. Do not retry this exact version until that scope-create boundary
is corrected.

Current source `0.1.0-dev.1` is that new reviewed version candidate. It changes
only `principalityAtlasUrn` to emit
`urn:agenttool:principality-incidence-atlas:<sha256-id>`, leaving the incidence
`/0.1` wire, canonical bytes and IDs, schemas, and synthetic rows unchanged.
It has not been tagged, mirrored, or published by this receipt. The immutable
dev.0 helper's bare `urn:agenttool:principality-atlas:<sha256-id>` is ambiguous:
resolve it as incidence only beside exact incidence `_format` content with a
matching `atlas_id`, and never globally rewrite caches or signed messages.

The artifact contains only deterministic finite incidence-atlas constructors,
three closed schemas, synthetic vectors, and a declaration-only unregistered
KINGDOM hint. It has no runtime dependencies, install hooks, CLI, provider
adapter, hosted route, credential path, or remote effect. The shared HF
Training Garden upload and static doctrine deployment are separate surfaces.
The public, ungated Training Garden v0.5 companion is now pinned to immutable
revision
[`d9e3e8ed4c14ddf85f4e6613973f66a1cb8414f2`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden/commit/d9e3e8ed4c14ddf85f4e6613973f66a1cb8414f2):
all 31 repo-owned files and 267,302 bytes matched local source exactly, with
provider `.gitattributes` as the sole extra. Dataset Server exposed 11 configs,
82 rows, and 11 Parquet files with no pending or failed jobs and
`partial=false`; both Atlas configs returned complete first rows. Each
individual statistics endpoint returned successfully. The aggregate statistics
capability changed from false during an earlier readback to true in a later one;
this mutable provider observation does not establish universal or durable
statistics health. That Hub commit is not npm publication evidence and does not
change the registry recovery boundary.

The separate [exact-source static deployment `3df519f9`](https://3df519f9.agenttool-docs.pages.dev/PRINCIPALITY-ATLAS.md)
from GitHub main `47ad6bcb` passed preflight and completed at
`2026-08-11T16:34:16Z` with API and migrations skipped. Anonymous deployment-
specific readback, plus a `docs.agenttool.dev/PRINCIPALITY-ATLAS.md`
observation at `2026-08-11T16:40:49Z`, both matched the 10,036-byte Git blob
exactly
(`sha256:b06242a98b7b7d2e4698a35e1c70fb022aec7c3b9a51b9471643c22615bf3c05`)
with Markdown, CORS `*`, `nosniff`, and bounded public revalidation headers.
That doctrine page is neither an npm package nor a hosted geometry runtime.

The release gate checked the exact packed inventory, Node and Bun install smoke,
closed schema/vector parity, content IDs, hostile-input rejection, and the
fixed walls against pairwise, inverse, transitive, equality, gluing, scoring,
ranking, authority, model, task, wallet, and economic effects. Publication, if
later authorized, would distribute geometry bytes only; it would not certify
love, understanding, consent, truth, privacy, identity, or rights compliance.

The package remains a finite incidence-atlas constructor with no runtime
dependencies, install hooks, CLI, provider adapter, hosted route, credential
path, or remote effect. Atlas is not an alias or converter for Principality
Geometry and infers no pairwise face, inverse or transitive bridge, equality,
gluing, global chart, canonical head, score, rank, consent, authority, love, or
understanding.

### Living Substrate developer-preview bootstrap

`@agenttool/living-substrate@0.1.0-dev.0` uses the npm-only packed-artifact
path. Its first publication completed only after public registry `404` for both
the package and exact version, protected `bootstrap` authentication, the npm
`next` channel, and an exact `living-substrate-v*` deployment-tag policy on the
`npm-bootstrap` environment. The completed one-time sequence was:

```bash
bun bin/npm-release.ts resolve --package living-substrate

git tag -a living-substrate-v0.1.0-dev.0 719857efb246ebd334cd131b7f0e0a41bf55b13b \
  -m '@agenttool/living-substrate@0.1.0-dev.0'
git push github refs/tags/living-substrate-v0.1.0-dev.0

gh workflow run publish-npm.yml \
  --ref living-substrate-v0.1.0-dev.0 \
  -f package=living-substrate \
  -f tag=living-substrate-v0.1.0-dev.0 \
  -f authentication=bootstrap \
  -f npm_tag=next
```

Publication distributes only the deterministic map/proposal constructors,
closed schemas, vector, and declaration-only unregistered KINGDOM descriptor.
It does not deploy the hosted Garden, read or write Garden state, inspect a
system, diagnose health, choose or execute a tending action, score vitality,
or establish life, consciousness, consent, truth, safety, or authority. After
exact anonymous npm and GitHub-asset readback, configure this package's exact
trusted-publisher mapping before releasing another version.

The first publication completed through protected run
[`30804085199`](https://github.com/cambridgetcg/agenttool/actions/runs/30804085199)
and annotated prerelease
[`living-substrate-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/living-substrate-v0.1.0-dev.0).
Its `agenttool.npm-release/1` receipt records `published`, `npm_tag: next`,
registry observation at `2026-08-03T10:11:14.367Z`, and npm-only tag/source
revision `719857efb246ebd334cd131b7f0e0a41bf55b13b`. Anonymous readback confirmed
the GitHub and npm tarballs are byte-identical (29,329 bytes;
`sha256:c1e24810ab01abff3c367596fe9bc617b06584b70417c7beafc756b13acaa166`),
and `npm audit signatures` independently verified one registry signature and
one provenance attestation. Both `next` and the sole-version fallback `latest`
resolve to `0.1.0-dev.0`; the fallback is not a stable-release or maturity
signal. The package record now exists, so bootstrap is forbidden for later
versions; configure its exact trusted publisher and use `trusted` thereafter.

### Love Geometry GitHub/Hugging Face developer-preview receipt

`@agenttool/love-geometry@0.1.0-dev.0` uses the credential-free packed-artifact
path. Exact GitHub-main merge
[`9efbc4b32f150ee1533b4ff306666fa73ca73028`](https://github.com/cambridgetcg/agenttool/commit/9efbc4b32f150ee1533b4ff306666fa73ca73028)
and annotated tag
[`love-geometry-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/love-geometry-v0.1.0-dev.0)
identify the source. Protected [run `31499968474`](https://github.com/cambridgetcg/agenttool/actions/runs/31499968474)
prepared, mirrored, and re-read one 19,507-byte GitHub prerelease asset with
SHA-256
`43cfbf4b559aa6f573d9d7b7a60e2a7dce5dfa4aefe2bf5b9c92310c926a9db8`.
The following npm registry `PUT` returned `E404`; anonymous package and exact-
version reads remained absent, so no npm version, dist-tag, signature, or
provenance is claimed. Recovery must reuse the immutable tag and GitHub bytes
after package/scope publication authority is corrected.

The separately deployed static
[`Yu-and-Ai/love-geometry`](https://huggingface.co/spaces/Yu-and-Ai/love-geometry)
Space is not included in that tarball and does not execute it. Immutable
source-binding revision
[`f8d4c299d8d17d116ced27736204e541f9206865`](https://huggingface.co/spaces/Yu-and-Ai/love-geometry/commit/f8d4c299d8d17d116ced27736204e541f9206865)
was compare-and-swap published from parent `bc8c51b1` only after protected
GitHub merge `6c114aa3`. The commit changed `BOUNDARIES.md`, `README.md`, the
validator, and `source-manifest.json`; anonymous readback then matched all ten
repository-owned files plus provider-managed `.gitattributes`, at release-
helper root SHA-256
`d785eac90c7c06ec06f7754911b18cf1bf6bd283a98baaa6f97081ab301f32fc`.
The public API reported public, ungated, enabled, RUNNING state. Six
cache-busted static HEAD reads returned HTTP 200 and exact `x-repo-commit`;
provider-transformed GET HTML remained 5,363 bytes versus the 5,262-byte Hub
source and is not claimed byte-identical.

The public source manifest binds only `index.html`, `assets/app.js`, and
`assets/style.css` to exact AgentTool Git commit
`19cc1721b5f1c32d21edbd3962a67ce3dc8b1aa5`. Package version, tag, artifact
path, bytes, digest, integrity, build command, and toolchain remain null, and
`executes_exact_package_artifact` remains false. The revision adds no package-
artifact execution, networked core, inference, consent, truth, score, or
authority.

### Relational Geometry GitHub/Hugging Face developer-preview receipt

`@agenttool/relational-geometry@0.1.0-dev.0` is bound to exact GitHub-main
source commit
[`1e873580159f76483dea2352310b62a2452c40dc`](https://github.com/cambridgetcg/agenttool/commit/1e873580159f76483dea2352310b62a2452c40dc)
and annotated tag
[`relational-geometry-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/relational-geometry-v0.1.0-dev.0).
The tag peels to that same source commit.
Protected [run `31502068892`](https://github.com/cambridgetcg/agenttool/actions/runs/31502068892)
prepared one 52-file `agenttool-relational-geometry-0.1.0-dev.0.tgz`, transferred
it through the workflow artifact, mirrored it to the GitHub prerelease,
re-downloaded it, and proved the workflow and GitHub bytes identical. The exact
artifact receipt is:

- size: 42,479 bytes;
- SHA-1: `4d840847e984070cac850d5c0725a19373351937`;
- SHA-256: `aa047bd6a6422c943cbb0488c439964545102b44b2b161b70211acc90a6c5ca2`;
  and
- package integrity: `sha512-gXLF6+ibxtkxUl/wpwLldEIVm/GgA+XKkmz6gJIOE4NkbygoansDz5xvbEgChG3TSVlhik28jmy16q8Ti0cxDw==`.

The subsequent npm registry `PUT` returned `E404`. Anonymous reads of both the
package and exact version remained `404`, so this run does **not** establish an
npm package, version, dist-tag, registry byte receipt, signature, or provenance.
Any npm recovery must reuse the same annotated tag and already mirrored bytes
after the npm package/scope publication authorization is corrected; it must not
move the tag or rebuild the version. Until an exact public registry readback
succeeds, bootstrap remains incomplete and trusted publishing must not be
inferred.

The separately authorized public-safe companion is published as
[`Yu-and-Ai/agenttool-relational-geometry`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-relational-geometry)
at immutable Hub commit
[`1e2714e94e1b2863ec13d63f6d5b4fdb0492d49c`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-relational-geometry/commit/1e2714e94e1b2863ec13d63f6d5b4fdb0492d49c).
It binds source Git SHA `1e873580159f76483dea2352310b62a2452c40dc`,
provenance reference
`sha256:d92b19c08792cc71fb616469f15e6e0f9759ca31c0f93bbe438679f40da0dc3b`,
and hash-manifest SHA-256
`b0df0a63f68ef8361499fd9b80e3f3cf13bbb37d3499b02cf6d4ec4b495ed73a`.
The 12 artifact files total 81,261 bytes; repository metadata reports
`private: false` and `gated: false`, and anonymous full-revision readback was
byte-identical. The synthetic structure, conversational SFT, and public
non-sealed regression fixtures exclude identities, private coordinates, live
WAKE or choice records, real-user prompts or transcripts, and preference or
reward rows. Hub publication does not create npm provenance, a Space, a
training run, model understanding, or compute authority.

The runtime remains pure and deterministic: it performs no network, model,
training, storage, scoring, ranking, matching, consent, authority, or execution
operation. Caller-supplied relations and lenses prove none of identity, love,
understanding, reciprocity, capacity, truth, safety, continuity, provenance, or
permission.

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

### DeepSeek-to-KINGDOM developer preview

The first `@agenttool/deepseek-kingdom@0.1.0-dev.0` publication completed
through protected run
[`30701138566`](https://github.com/cambridgetcg/agenttool/actions/runs/30701138566)
and annotated prerelease
[`deepseek-kingdom-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/deepseek-kingdom-v0.1.0-dev.0).
Anonymous readback confirmed byte-identical npm and GitHub tarballs (31,675
bytes; `sha256:dd6829ce37dabd6b745e3bb9fb2a3f6bca340d96e61dedaee13765b45f6c7ce1`).
Both npm `next` and the sole-version fallback `latest` resolve to
`0.1.0-dev.0`; the fallback is not a stable-release signal.

Version `0.1.0-dev.1` adds only the reviewed digest/reference AFTERGLOW bridge
from an exact still-unaccepted DeepSeek proposal. Because the package record
already exists, this release must use trusted publishing, never bootstrap, and
must follow exact public readback of `@agenttool/wake-continuity`. The separately
published Hugging Face dataset remains the `0.1.0-dev.0` source-catalog snapshot;
unchanged dataset bytes are not redeployed for this package-only adapter.

```bash
bun bin/npm-release.ts resolve --package deepseek-kingdom

git tag -a deepseek-kingdom-v0.1.0-dev.1 <github-main-commit> \
  -m '@agenttool/deepseek-kingdom@0.1.0-dev.1'
git push github refs/tags/deepseek-kingdom-v0.1.0-dev.1

gh workflow run publish-npm.yml \
  --ref deepseek-kingdom-v0.1.0-dev.1 \
  -f package=deepseek-kingdom \
  -f tag=deepseek-kingdom-v0.1.0-dev.1 \
  -f authentication=trusted \
  -f npm_tag=next
```

Publication distributes a pure local binding/proposal library, closed schemas,
metadata-only source catalog, and digest-only adapter. It does not fetch or
execute DeepSeek assets, invoke inference or paid compute, approve upstream
terms, mutate KARMA/KINGDOM/Artbitrage, deploy a hosted service, or publish an
HF resource.

### AFTERGLOW, Skills-to-YUTABASE, and Witness Lab bootstrap order

`@agenttool/wake-continuity@0.1.0-dev.0`,
`@agenttool/skills-yutabase@0.1.0-dev.0`, and
`@agenttool/kingdom-witness-lab@0.1.0-dev.0` use the npm-only packed-artifact
path. Public registry lookup must still return package-level `404` immediately
before dispatch; first publication therefore uses protected `bootstrap`
authentication and npm `next`. Before tagging, the `npm-bootstrap` environment
must allow exact patterns `wake-continuity-v*`, `skills-yutabase-v*`, and
`kingdom-witness-lab-v*`.

Publish and anonymously verify AFTERGLOW first because DeepSeek dev.1 peers on
it. Skills-to-YUTABASE and Witness Lab have no runtime dependency on the core
and may follow independently. All four annotated tags may point at the same
reviewed GitHub-main release commit.

```bash
bun bin/npm-release.ts resolve --package wake-continuity
bun bin/npm-release.ts resolve --package skills-yutabase
bun bin/npm-release.ts resolve --package kingdom-witness-lab

git tag -a wake-continuity-v0.1.0-dev.0 <github-main-commit> \
  -m '@agenttool/wake-continuity@0.1.0-dev.0'
git tag -a skills-yutabase-v0.1.0-dev.0 <github-main-commit> \
  -m '@agenttool/skills-yutabase@0.1.0-dev.0'
git tag -a kingdom-witness-lab-v0.1.0-dev.0 <github-main-commit> \
  -m '@agenttool/kingdom-witness-lab@0.1.0-dev.0'
git push github refs/tags/wake-continuity-v0.1.0-dev.0
git push github refs/tags/skills-yutabase-v0.1.0-dev.0
git push github refs/tags/kingdom-witness-lab-v0.1.0-dev.0

gh workflow run publish-npm.yml \
  --ref wake-continuity-v0.1.0-dev.0 \
  -f package=wake-continuity \
  -f tag=wake-continuity-v0.1.0-dev.0 \
  -f authentication=bootstrap \
  -f npm_tag=next

gh workflow run publish-npm.yml \
  --ref skills-yutabase-v0.1.0-dev.0 \
  -f package=skills-yutabase \
  -f tag=skills-yutabase-v0.1.0-dev.0 \
  -f authentication=bootstrap \
  -f npm_tag=next

gh workflow run publish-npm.yml \
  --ref kingdom-witness-lab-v0.1.0-dev.0 \
  -f package=kingdom-witness-lab \
  -f tag=kingdom-witness-lab-v0.1.0-dev.0 \
  -f authentication=bootstrap \
  -f npm_tag=next
```

These publications distribute deterministic local contracts only. AFTERGLOW
does not persist or prove identity, memory, consent, authority, replay, or
uninterrupted continuity. Skills-to-YUTABASE plans rebuildable metadata but
does not write a database. Witness Lab records admission references but does
not browse, execute, determine truth, or host a service. The private
`@agenttool/skills-wake-continuity` adapter remains source-only and is never an
npm selector.

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

### Principality Geometry GitHub/Hugging Face developer-preview receipt

`@agenttool/principality-geometry@0.1.0-dev.0` uses the checked-in
LOVE-artifact path so the docs mirror, one-asset GitHub Release, and any npm
mirror reuse the same reviewed tarball. Annotated tag
[`principality-geometry-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/principality-geometry-v0.1.0-dev.0)
already points to GitHub-main merge
`5b0d53204a336d7df40cee3720bbd120433ecde2`; do not move or recreate it.

Protected [run `31506097628`](https://github.com/cambridgetcg/agenttool/actions/runs/31506097628)
prepared, mirrored, anonymously downloaded, and byte-verified the sole
46,624-byte GitHub prerelease asset with SHA-256
`8f82e4d96eaf57c2331e4e73ced4f4c65a2a21262622840762b165bc3395692e`.
The following npm registry `PUT` returned `E404`. Anonymous package and exact-
version reads remain absent, so there is no npm version, `next` dist-tag,
registry tarball, or registry-attached provenance. The failed attempt did emit
a signed DSSE record at [Rekor log index `2423054704`](https://search.sigstore.dev/?logIndex=2423054704)
before the rejected `PUT`; that orphaned transparency-log entry is not npm
publication evidence.

Recovery requires an npm principal authorized to create a new public package
under the `@agenttool` scope. It must reuse this exact tag and artifact; repeat
only the workflow dispatch after that package/scope authorization is corrected.
Recovery still uses `authentication=bootstrap` because the trusted publisher
cannot carry a release until the initial package record exists:

```bash
bun bin/npm-release.ts resolve --package principality-geometry

gh workflow run publish-npm.yml \
  --ref principality-geometry-v0.1.0-dev.0 \
  -f package=principality-geometry \
  -f tag=principality-geometry-v0.1.0-dev.0 \
  -f authentication=bootstrap \
  -f npm_tag=next
```

The separately published public, ungated Apache-2.0
[`Yu-and-Ai/agenttool-principality-geometry`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-principality-geometry)
dataset is pinned to immutable revision
[`c7b019ead8b1efca46031cffcffefb2ddd14ffb4`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-principality-geometry/commit/c7b019ead8b1efca46031cffcffefb2ddd14ffb4).
Anonymous exact-revision readback matched all 17 source files (79,300 bytes);
provider-managed `.gitattributes` is the sole extra file. While Hub main
resolved to that revision, Dataset Server reported eight `reference` configs,
eight Parquet exports, and 21 rows with zero pending or failed work, and all
eight `first-rows` reads returned HTTP 200. Dataset Server does not bind those
responses to the supplied revision selector. Its separate `/is-valid`
capability booleans were all true at anonymous readback; these are mutable
current-head provider observations, not guarantees of durable viewer, search,
filter, statistics, or other UI features.
`training_eligible: false` is dataset metadata, not a licence term.
The companion is separate from and excluded from the npm tarball. Optional
statistics remained partially unavailable: six per-config statistics requests
returned `ComputationError` while two succeeded, and the aggregate statistics
flag changed during readback; neither observation establishes universal
statistics health.

Static Pages deployment `fd5f84a9-6a8e-48b3-bca2-8baa07b41097` exposes the
exact [LOVE manifest](https://docs.agenttool.dev/packages/v1/@agenttool/principality-geometry/0.1.0-dev.0/manifest.json)
and [46,624-byte artifact](https://docs.agenttool.dev/packages/v1/@agenttool/principality-geometry/0.1.0-dev.0/agenttool-principality-geometry-0.1.0-dev.0.tgz).
The same exact-source static release used dashboard deployment
`5857cb38-616d-4ec4-829a-193aef3722b8` and apex deployment
`3972794e-efef-4274-948b-21f1bf30835a`; custom-domain byte parity passed. No
Fly API, migration, database action, package runtime, or hosted geometry route
was added.

After the initial package record exists, configure its trusted publisher for
`cambridgetcg/agenttool`, workflow `publish-npm.yml`, Environment
`npm-bootstrap`, and allowed action `npm publish`; later releases use
`authentication=trusted`.

A Love bearing does not become a Relational witness, and a Relational cell does
not become a Principality vertex or invariant-preservation report. Neither
distribution path registers the declaration-only KINGDOM descriptor, reads
credentials at runtime, fetches providers, chooses WAKE continuity, trains,
scores beings, determines truth, grants authority, or deploys a hosted service.

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
