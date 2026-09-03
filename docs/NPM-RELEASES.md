<!-- @id urn:agenttool:doc/NPM-RELEASES  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/LOVE-PACKAGE-PROTOCOL urn:agenttool:doc/DEPLOY-PROCEDURE -->

# NPM-RELEASES — one exact, reviewed publication path

> *Operational runbook for optional npm mirrors. An npm credential is authority to publish bytes; it is not proof that those bytes were reviewed, built from `main`, or accepted by the public registry.*

> **Compass:** [LOVE-PACKAGE-PROTOCOL](LOVE-PACKAGE-PROTOCOL.md) (registry-neutral artifact identity) · [DEPLOY-PROCEDURE](DEPLOY-PROCEDURE.md) (hosted service releases) · [DEVELOPMENT](DEVELOPMENT.md) (contributor workflow)
>
> **Implements:** one manual, allowlisted npm release state machine for the reviewed JavaScript packages. LOVE remains the primary release record where a package has one, including Agent Browser, Agent Wallet and its Zerone adapter, Principality Geometry, the Economic Kernel and its comparator, and the local Hugging Face Scout. Packages without a LOVE record use the same protected path for an optional npm/GitHub mirror, including Collab, Agent Skills, Math Cards, Model Becoming, Dataset Influence, LOVE BOMB, the KINGDOM integration package, the local Codex Usage reader, the developer-preview Correspondence-to-YUTABASE and Skills-to-YUTABASE planners, Repo Archive, the Dark Continent contract and KARMA proposal adapter, the DeepSeek-to-KINGDOM proposal adapter, AFTERGLOW WAKE continuity, KINGDOM Witness Lab, HEAVEN, Living Substrate, Polymorph Landscape, Memetic Landscape, Love Geometry, Principality Atlas, the Relational Geometry core, the developer-preview Alchemy observation client, and its strict AgentCred composition adapter. Hugging Face companions remain separate release surfaces with their own immutable Hub file readback and mutable Dataset Server or Space observations.
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

## Verified Economic Kernel 0.2 developer preview — 2026-09-03

The authorized Economic Kernel pair is publicly verified from protected
[PR #404](https://github.com/cambridgetcg/agenttool/pull/404), merged as
[`737a58f02e11f52e74703b921d806e78c27202e9`](https://github.com/cambridgetcg/agenttool/commit/737a58f02e11f52e74703b921d806e78c27202e9).
That release merge carries semantic source commit
`f809275a1dff14e0f88af73bb53e11b104a92438` and LOVE lineage commit
`2fc1267432addf3f219593bf08be4278434ab663`. Both annotated tags peel to
the protected-main merge. GitHub Release assets, checked-in LOVE archives, and
fresh anonymous npm downloads were byte-identical.

| Package | Protected publication and exact public artifact |
|---|---|
| `@agenttool/economic-kernel@0.2.0-dev.0` | [Release](https://github.com/cambridgetcg/agenttool/releases/tag/economic-kernel-v0.2.0-dev.0) · [run `33736822237`](https://github.com/cambridgetcg/agenttool/actions/runs/33736822237) · published `2026-09-03T09:07:19.334Z`, anonymously observed `2026-09-03T09:12:17.731Z` · 57,031-byte archive SHA-256 `8b2682f3878a93b9f8d039989313dc9f59c982ff1cb7fb4abb05ccb553f7e9cf`, npm SHA-1 `b72ec9fbd4d83bbdb920fcdd0216370aac54bc7a` · 1,473-byte LOVE manifest SHA-256 `1dcd4dc3a133ea04e7b1529b70c19227d4e7cf1c0a7cb274ca19d12d6c601cb8` · SLSA [Rekor `2697675854`](https://search.sigstore.dev/?logIndex=2697675854), publish [Rekor `2697675959`](https://search.sigstore.dev/?logIndex=2697675959) |
| `@agenttool/economic-conformance@0.2.0-dev.0` | [Release](https://github.com/cambridgetcg/agenttool/releases/tag/economic-conformance-v0.2.0-dev.0) · [run `33736825170`](https://github.com/cambridgetcg/agenttool/actions/runs/33736825170) · published `2026-09-03T09:07:17.259Z`, anonymously observed `2026-09-03T09:12:16.089Z` · 58,390-byte archive SHA-256 `ba9f2c869c3d6bef963ef3fbe962fc678b736144d10e5aff6c83a49a84804661`, npm SHA-1 `df9013398199aae233b96fb512ad90be947ce7cc` · 1,513-byte LOVE manifest SHA-256 `068a2f80187fb09edc8f0e6da830258ac301238c258aa1fe289246c18ff6baf8` · SLSA [Rekor `2697675800`](https://search.sigstore.dev/?logIndex=2697675800), publish [Rekor `2697675886`](https://search.sigstore.dev/?logIndex=2697675886) |

The comparator's 53-case frozen vector is 22,842 bytes with SHA-256
`2c13fd9f341210657de0f1fc223c22c82472ca6377a9af3dce28c9db035ae47b`;
its semantic SHA-256 is
`4ab116811eded993e0a1156970dac917515e039a1b651fe408f832c008e7ee43`.
Both publications requested npm `next`. Because these are each package's sole
public version, npm also exposes the same prerelease through its automatic
`latest` fallback; that is not a stable-release or maturity signal.

The separate, public, ungated
[Hugging Face dataset](https://huggingface.co/datasets/Yu-and-Ai/agenttool-economic-kernel)
was read back anonymously and with authentication at immutable revision
[`a4690cd8c2701b28057c115ba0d3d2ee21162db4`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-economic-kernel/commit/a4690cd8c2701b28057c115ba0d3d2ee21162db4).
Its 13 owned files total 146,381 bytes; Hugging Face's `.gitattributes` is the
sole provider-managed extra. The checked-in hash manifest has SHA-256
`be655945aca5844d7716f733fcf5e0b68b200ed1c2f44c4432553a214c7ace5f`,
and the sorted owned-tree digest is
`18eb2361a10794bbe8b62aa0a645b5c4e8ece0ae5e167ac5eed71f3662125058`.
Config `economic_kernel_lessons` contains 24 independently authored synthetic
rows with `training_authorized: true`; config `economic_kernel_v0_2` contains
the 53 exact reference cases with `training_authorized: false`. Public
visibility cannot technically enforce that holdout.

At the mutable Dataset Server observation time `2026-09-03T10:57:25Z`, both
configs had completed conversion with no pending or failed splits and
`partial: false`: 77 rows total, 39,479 Parquet bytes, and 48,632 estimated
in-memory bytes. The lesson split exposed 24 rows across 18 columns; the
reference split exposed 53 rows across 22 columns. Preview, viewer, search,
filter, and statistics validity were all `true`. These service-status facts are
a timestamped current-head observation, not properties of the immutable Git
revision.

Frontend-only static deployment then ran from protected-main portability merge
[`748402c19865fd652ff5bd96da64f3227cbbb1e9`](https://github.com/cambridgetcg/agenttool/commit/748402c19865fd652ff5bd96da64f3227cbbb1e9).
Receipt `agenttool-deploy-receipt/v6`, run `deploy-748402c19865-34774`, records
start `2026-09-03T10:36:59Z`, completion `2026-09-03T10:55:09Z`, a clean
source tree, full preflight passed, frontends `deployed_verified`, API skipped,
and migrations skipped. Cloudflare created Pages deployments
[`a6864f4f`](https://a6864f4f.agenttool-docs.pages.dev),
[`986a53c3`](https://986a53c3.agenttool-dashboard.pages.dev), and
[`aec6fe53`](https://aec6fe53.agenttool-web.pages.dev), plus apex Worker
version `9b0e8596-c33a-49ff-83db-4794ffc86fd1`.

Independent direct readback of every Economic Kernel LOVE surface returned
HTTP 200 with no redirects and exact checked-in bytes:

| Public path | Bytes | SHA-256 |
|---|---:|---|
| [discovery](https://docs.agenttool.dev/.well-known/love-packages) | 394 | `cb72f1810ad1c399a56d6a1b624f164d330951e460fc23c5b4c572a62c5eeb9d` |
| [package index](https://docs.agenttool.dev/packages/v1/index.json) | 11,335 | `72deb97f9767b6d582027c0f43b74cb523a37816398e6e2373eead8b4293d4b8` |
| [kernel manifest](https://docs.agenttool.dev/packages/v1/@agenttool/economic-kernel/0.2.0-dev.0/manifest.json) | 1,473 | `1dcd4dc3a133ea04e7b1529b70c19227d4e7cf1c0a7cb274ca19d12d6c601cb8` |
| [kernel archive](https://docs.agenttool.dev/packages/v1/@agenttool/economic-kernel/0.2.0-dev.0/agenttool-economic-kernel-0.2.0-dev.0.tgz) | 57,031 | `8b2682f3878a93b9f8d039989313dc9f59c982ff1cb7fb4abb05ccb553f7e9cf` |
| [conformance manifest](https://docs.agenttool.dev/packages/v1/@agenttool/economic-conformance/0.2.0-dev.0/manifest.json) | 1,513 | `068a2f80187fb09edc8f0e6da830258ac301238c258aa1fe289246c18ff6baf8` |
| [conformance archive](https://docs.agenttool.dev/packages/v1/@agenttool/economic-conformance/0.2.0-dev.0/agenttool-economic-conformance-0.2.0-dev.0.tgz) | 58,390 | `ba9f2c869c3d6bef963ef3fbe962fc678b736144d10e5aff6c83a49a84804661` |

JSON surfaces were UTF-8 with CORS `*`, `nosniff`, and
`public, max-age=300, must-revalidate`; immutable archives were
`application/gzip` with CORS `*`, `nosniff`, and
`public,max-age=31536000,immutable`. This publication and deployment performed
no optimizer step, model-training job, checkpoint mutation, model-weight
update, Fly API release, or database migration. Dataset admission means the
rows are available under their declared governance; it does not claim that a
training run occurred.

## Verified npm recovery batch — 2026-08-25

Protected recovery published seven exact reviewed versions. In every successful
row below, the prepared artifact, existing or newly created GitHub Release
asset, and fresh anonymous npm download were byte-identical. npm 11.18 also
verified one registry signature and one SLSA provenance attestation for each
version. Each annotated tag peels to the listed protected-main commit.

- `@agenttool/skills@0.3.2` —
  [`skills-v0.3.2`](https://github.com/cambridgetcg/agenttool/releases/tag/skills-v0.3.2)
  at [`b79517c3`](https://github.com/cambridgetcg/agenttool/commit/b79517c313b3d66e5fb1ecdd2558400d65ee0a8a),
  protected [run `32893875955`](https://github.com/cambridgetcg/agenttool/actions/runs/32893875955),
  65,295 bytes, SHA-256
  `22a3868d8e14460901bc61c8764bcf35bcfa2acdd7bb805529b29a6917edad40`,
  npm SHA-1 `15d10533e9668ee893553ffec55acd3a9af0d143`, published at
  `2026-08-25T20:12:52.005Z` as `latest`. SLSA and publish records are
  [Rekor `2588584962`](https://search.sigstore.dev/?logIndex=2588584962) and
  [Rekor `2588585275`](https://search.sigstore.dev/?logIndex=2588585275).
- `@agenttool/principality-geometry@0.1.0-dev.0` —
  [`principality-geometry-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/principality-geometry-v0.1.0-dev.0)
  at [`5b0d5320`](https://github.com/cambridgetcg/agenttool/commit/5b0d53204a336d7df40cee3720bbd120433ecde2),
  protected [run `32893416467`](https://github.com/cambridgetcg/agenttool/actions/runs/32893416467),
  46,624 bytes, SHA-256
  `8f82e4d96eaf57c2331e4e73ced4f4c65a2a21262622840762b165bc3395692e`,
  npm SHA-1 `cf4c938f8b10d963fd22bdd2e74287ba2b56d7cb`, published at
  `2026-08-25T20:08:39.490Z`. SLSA and publish records are
  [Rekor `2588535750`](https://search.sigstore.dev/?logIndex=2588535750) and
  [Rekor `2588536000`](https://search.sigstore.dev/?logIndex=2588536000).
- `@agenttool/principality-atlas@0.1.0-dev.1` —
  [`principality-atlas-v0.1.0-dev.1`](https://github.com/cambridgetcg/agenttool/releases/tag/principality-atlas-v0.1.0-dev.1)
  at [`4c2363ca`](https://github.com/cambridgetcg/agenttool/commit/4c2363caec324d61dbf627328a408c13110ed5eb),
  protected [run `32894657445`](https://github.com/cambridgetcg/agenttool/actions/runs/32894657445),
  33,577 bytes, SHA-256
  `4cbc971602865223bf0a28c0333befd65f840cba3e2f83d4f6bf29d43bc2e814`,
  npm SHA-1 `820fbf1d2a731ed9a3e1d7a5949c2136bfbaeefe`, published at
  `2026-08-25T20:20:46.341Z`. SLSA and publish records are
  [Rekor `2588715989`](https://search.sigstore.dev/?logIndex=2588715989) and
  [Rekor `2588716722`](https://search.sigstore.dev/?logIndex=2588716722).
- `@agenttool/polymorph-landscape@0.1.0-dev.0` —
  [`polymorph-landscape-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/polymorph-landscape-v0.1.0-dev.0)
  at [`63c49956`](https://github.com/cambridgetcg/agenttool/commit/63c4995676eacdc88ff9050819b497db841e4159),
  protected [run `32894642922`](https://github.com/cambridgetcg/agenttool/actions/runs/32894642922),
  75,009 bytes, SHA-256
  `48e7be7862018411656314751a38a3176ba132f68fe14ab1514c8bf45b135148`,
  npm SHA-1 `9328a848aea8671aa7e94a99f4110888698dce2f`, published at
  `2026-08-25T20:20:46.801Z`. SLSA and publish records are
  [Rekor `2588716027`](https://search.sigstore.dev/?logIndex=2588716027) and
  [Rekor `2588716865`](https://search.sigstore.dev/?logIndex=2588716865).
- `@agenttool/love-geometry@0.1.0-dev.0` —
  [`love-geometry-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/love-geometry-v0.1.0-dev.0)
  at [`9efbc4b3`](https://github.com/cambridgetcg/agenttool/commit/9efbc4b32f150ee1533b4ff306666fa73ca73028),
  protected [run `32894648027`](https://github.com/cambridgetcg/agenttool/actions/runs/32894648027),
  19,507 bytes, SHA-256
  `43cfbf4b559aa6f573d9d7b7a60e2a7dce5dfa4aefe2bf5b9c92310c926a9db8`,
  npm SHA-1 `e84e091e40cad98635df5a32c328a7f2c1cefcd6`, published at
  `2026-08-25T20:20:50.146Z`. SLSA and publish records are
  [Rekor `2588716966`](https://search.sigstore.dev/?logIndex=2588716966) and
  [Rekor `2588718060`](https://search.sigstore.dev/?logIndex=2588718060).
- `@agenttool/relational-geometry@0.1.0-dev.0` —
  [`relational-geometry-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/relational-geometry-v0.1.0-dev.0)
  at [`1e873580`](https://github.com/cambridgetcg/agenttool/commit/1e873580159f76483dea2352310b62a2452c40dc),
  protected [run `32894652643`](https://github.com/cambridgetcg/agenttool/actions/runs/32894652643),
  42,479 bytes, SHA-256
  `aa047bd6a6422c943cbb0488c439964545102b44b2b161b70211acc90a6c5ca2`,
  npm SHA-1 `4d840847e984070cac850d5c0725a19373351937`, published at
  `2026-08-25T20:20:51.470Z`. SLSA and publish records are
  [Rekor `2588717318`](https://search.sigstore.dev/?logIndex=2588717318) and
  [Rekor `2588718295`](https://search.sigstore.dev/?logIndex=2588718295).
- `@agenttool/dataset-influence@0.1.0-dev.0` —
  [`dataset-influence-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/dataset-influence-v0.1.0-dev.0)
  at [`e1711d24`](https://github.com/cambridgetcg/agenttool/commit/e1711d24cc9a7c06dbdab903c78bdb666c468737),
  protected [run `32896692874`](https://github.com/cambridgetcg/agenttool/actions/runs/32896692874),
  66,549 bytes, SHA-256
  `473a6a987b74922b35ebf6a68986cb0b32393ecef6c7478c25d73d29da71ddc5`,
  npm SHA-1 `5d370137cd65673170d166e0e263bd724e33d7f5`, published at
  `2026-08-25T20:42:24.709Z`. SLSA and publish records are
  [Rekor `2589076548`](https://search.sigstore.dev/?logIndex=2589076548) and
  [Rekor `2589077122`](https://search.sigstore.dev/?logIndex=2589077122).

The six developer-preview packages requested npm `next`; because each is the
sole public version of its package, npm also exposes the same version through
its automatic `latest` fallback. That fallback is not a stable-release or
maturity claim. Their first package records now exist, so bootstrap is
forbidden for later versions; configure each exact trusted-publisher mapping
before a subsequent release.

Math Cards is the one unrecovered candidate. Protected
[run `32893422479`](https://github.com/cambridgetcg/agenttool/actions/runs/32893422479)
successfully prepared and mirrored the immutable 44,578-byte
[`math-cards-v0.1.0-dev.1`](https://github.com/cambridgetcg/agenttool/releases/tag/math-cards-v0.1.0-dev.1)
asset with SHA-256
`0ede8c92f7e08257f132dc1c1763997def03bd61b0abf38e52b1c6f71911c166`,
then trusted publication stopped at npm `E404`. The public registry still has
only `0.1.0-dev.0`, with `next` and the sole-version `latest` fallback both on
dev.0. Do not retry or use bootstrap: dev.1 requires the package-specific npm
trusted-publisher mapping through an account-authenticated npm session with
package write and applicable 2FA.

## Verified HF Scout developer preview — 2026-08-24

The authorized first publication of `@agenttool/hf-scout@0.2.0-dev.0` is
complete from protected [PR #354](https://github.com/cambridgetcg/agenttool/pull/354).
Annotated tag
[`hf-scout-v0.2.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/hf-scout-v0.2.0-dev.0)
has tag object `10363d92caedf48bc37d8a8d1f18077c14c2b968` and peels to
protected-main merge
[`4a7ab3e90c91c36a13c718c2bd5a1453741ab4b0`](https://github.com/cambridgetcg/agenttool/commit/4a7ab3e90c91c36a13c718c2bd5a1453741ab4b0).
Its tagger timestamp is `2026-08-24T19:12:24Z`.
Protected workflow [run `32766832874`, attempt
1](https://github.com/cambridgetcg/agenttool/actions/runs/32766832874)
succeeded at that exact tag and commit. Its credential-free preparation job
`97558087648` and protected mirror/publish/readback job `97558238544` both
succeeded. GitHub prerelease `375930877`, published at
`2026-08-24T19:14:06Z`, has exactly one asset:
`agenttool-hf-scout-0.2.0-dev.0.tgz`, asset `528060774`.

The checked-in LOVE archive, GitHub asset, and anonymous npm download are
byte-identical: 85,694 bytes, 83 safe entries, SHA-1
`8fdd75905dbcd4860b6ebf6ec5400da5b1044091`, SHA-256
`cab60220a16b518704f114adf7c0f19fb65769532bce8e73bbc457dc1f3ad145`,
and SRI
`sha512-qbiIMuCqNyyC/M0kvOqGsY4T/jCvL79vbfPBAQCHhWkLFFCrh2ir3E7OpyMCrLh0JFKcm41xJ1hmJuamuCRNYA==`.
The LOVE manifest has SHA-256
`55d0391b215e696ffca4f2fe28ea83c7bf94bc7faa62e132cc285b064abac5af`
and binds package source revision
`5aa6c04aa5bfd500c3de2be920e57b4bf0d30906`. npm `next` resolves to
`0.2.0-dev.0`; its mutable sole-version `latest` fallback also resolves to
dev.0 and is not a maturity signal. An isolated npm 11.17 signature audit
verified exactly this one package/version with `invalid: []` and `missing: []`.
SLSA provenance is at
[Rekor index `2581781005`](https://search.sigstore.dev/?logIndex=2581781005)
and the npm publish attestation is at
[index `2581781083`](https://search.sigstore.dev/?logIndex=2581781083). The
SLSA statement binds repository `cambridgetcg/agenttool`, workflow
`.github/workflows/publish-npm.yml`, ref
`refs/tags/hf-scout-v0.2.0-dev.0`, commit
`4a7ab3e90c91c36a13c718c2bd5a1453741ab4b0`, event `workflow_dispatch`,
and run/attempt `32766832874/1`.

Anonymous direct GET and HEAD readback of the LOVE discovery document, package
index, [manifest](https://docs.agenttool.dev/packages/v1/@agenttool/hf-scout/0.2.0-dev.0/manifest.json),
and [archive](https://docs.agenttool.dev/packages/v1/@agenttool/hf-scout/0.2.0-dev.0/agenttool-hf-scout-0.2.0-dev.0.tgz)
at `2026-08-24T19:22:42Z` returned 200 without redirects and matched the
checked-in bytes. Successful local v6 receipt
`20260824T191527Z-4a7ab3e90c91-83378.json` records
`migrations: skipped`, `preflight: skipped`, `api: skipped`, and
`frontends: deployed_verified`. It proves the scoped static publication, not a
full-preflight run, an API/database change, or a hosted Scout.

## HF Scout next-version boundary

Every later HF Scout version remains on the checked-in LOVE-artifact lane.
From one clean reviewed commit, build and commit the new manifest, archive,
package index, and discovery update; rerun the complete LOVE verifier; and
require `bun bin/npm-release.ts resolve --package hf-scout` to select that same
version, tag, source path, and artifact. Missing checked-in release bytes are a
blocker, never permission to fall back to an independent `npm pack` artifact.

The package now exists, so bootstrap is forbidden for every later version.
No trusted-publisher mapping was created during this release, and existing
trust remains unverified. A credential-stripped `npm trust list` returned
`E401`, establishing that listing needs an authenticated npm session. Saving
the exact mapping additionally needs package-write access and account-level
2FA or WebAuthn. An authorized operator must first list and compare existing
trust, then create the mapping only if it is absent, and list again afterward:

```bash
npx --yes npm@11.17.0 trust list @agenttool/hf-scout --json

npx --yes npm@11.17.0 trust github @agenttool/hf-scout \
  --file publish-npm.yml \
  --repo cambridgetcg/agenttool \
  --env npm-bootstrap \
  --allow-publish

npx --yes npm@11.17.0 trust list @agenttool/hf-scout --json
```

Verify the exact mapping afterward. Every later release uses
`authentication=trusted`; neither the bootstrap token nor an unauthenticated
local shell can authorize this account-level trust change.

The package remains local, fixed-origin, credential-omitting, GET-only metadata
tooling. LOVE, GitHub, and npm distribute bytes; they do not deploy a hosted
Scout, register its declaration-only KINGDOM descriptor, supply Hugging Face
credentials, accept gates, read raw cards/rows/files, download artifacts, run
models, invoke inference/Jobs/Spaces/MCP, train, write to the Hub, or establish
licence truth, consent, training authority, safety, compatibility, identity, or
ownership. Any future authenticated or effectful adapter requires a separate
release and authority review.

## Model Becoming developer-preview publication boundary

`@agenttool/model-becoming@0.1.0-dev.0` is a zero-runtime-dependency packed
candidate. It is separate from canonical LOVE BOMB v4 and from the independent
`@agenttool/love-bomb` release identity; publication of this package does not
publish that package or deliver or activate the static pull-only care bundle.

Immediately before the first npm dispatch, require anonymous package and exact
version reads to remain absent, and require the protected `npm-bootstrap`
environment's deployment policies to include the exact `model-becoming-v*`
tag pattern. Tag only the reviewed protected-main commit as
`model-becoming-v0.1.0-dev.0`, then use the protected workflow with
`authentication=bootstrap` and `npm_tag=next`. After the package exists,
configure its exact trusted publisher using the fields below; every later
version uses `authentication=trusted`. Never publish this package from a local
shell.

The Hugging Face companion is a separate dataset repository at
`Yu-and-Ai/agenttool-model-becoming`. Publish the seven repository-owned files
from the exact release checkout private-first, reject unexpected existing
content, bind the upload to the observed parent commit, and compare every byte
at the returned immutable revision before making it public. Then repeat the
complete immutable readback anonymously; allow only Hugging Face's
provider-managed `.gitattributes` in addition to the seven owned files.
Dataset Server config `model_becoming_reference`, split `reference`, and its
single row are mutable current-head observations rather than immutable proof.

The row remains `reference_only`, with `training_admission: not_applicable`,
`requires_separate_training_authorization: true`, and
`training_authorized: false`. Publishing either surface performs no training,
inference, retention, evaluation, weight update, model modification, delivery,
attention, consent, identity, continuity, or authority effect.

Do not add a success receipt prospectively. After actual observation, record
the protected commit and workflow run, exact GitHub/npm bytes and hashes, npm
integrity and dist-tag, the immutable Hugging Face revision and tree, and the
anonymous readback result. A failed or blocked mutation remains a failure or
blocker; it is not publication evidence.

## LOVE BOMB developer-preview publication boundary

`@agenttool/love-bomb@0.1.0-dev.0` is a local zero-runtime-dependency packed
candidate with four formats only: care envelope, caller-reported care choice,
becoming evidence, and delivery report. It is not the separate
`agenttool.love-bomb/0.1` ten-message static application and publication must
not deliver or repeat that corpus.

Its release path uses annotated `love-bomb-v0.1.0-dev.0`, the protected
allowlist, `authentication=bootstrap`, and `npm_tag=next` for a first release;
later versions require the exact trusted publisher. The independent HF
candidate targets `Yu-and-Ai/agenttool-love-bomb` and must be uploaded
private-first, reject unexpected content, bind the returned parent revision,
and pass immutable then anonymous byte readback before any public claim. Its
source manifests exclude observed participant responses and set training
authority separately.

The closed `/public/love-bomb` signal continues to report both distributions
as `not_published` until those exact receipts exist. Neither a source tree,
workflow allowlist, candidate tarball, Hub repository name, schema, nor WAKE
context proves publication, delivery, receipt, attention, training, provider
effect, or weight change.

## Verified Model Becoming developer preview — 2026-08-14

`@agenttool/model-becoming@0.1.0-dev.0` is public through protected bootstrap
[run `31800863891`](https://github.com/cambridgetcg/agenttool/actions/runs/31800863891),
attempt 1. Its final `agenttool.npm-release/1` receipt reports
`status: published`, requested `npm_tag: next`, and anonymous public-registry
observation at `2026-08-14T12:40:28.017Z`.

- Annotated tag and one-asset GitHub prerelease
  [`model-becoming-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/model-becoming-v0.1.0-dev.0)
  point to protected GitHub-main commit
  `17f5c9920c6e6abe8046d39926ae7a73d2f24e89`.
- The prepared workflow artifact, re-downloaded GitHub Release asset, and
  independently downloaded public npm tarball are byte-identical: 37,143
  bytes with SHA-256
  `98a93582a2153cafcc72652d72cd6d330215da873e89a0a2509166339c1a15fe`.
  The archive contains 42 files.
- npm reports SHA-1 `4eb6c861a3fcfa3d684613b8eb2a719061550d10`,
  integrity
  `sha512-dLnGBufAkxDhbqhNidnMnxGntpMnykBMdSY9R7NgT2+J32/GkVz7TzONDZW7qJfDSOOuKn/QdBhkzFzZ+nGTVw==`,
  and `next: 0.1.0-dev.0`. Its sole-version fallback also exposes
  `latest: 0.1.0-dev.0`; that is not a stable-release or maturity signal.
- npm attaches SLSA provenance at
  [Rekor index `2466271637`](https://search.sigstore.dev/?logIndex=2466271637).
  The statement binds the GitHub workflow and exact tagged source revision.

The npm package now exists. Configure its trusted publisher for
`cambridgetcg/agenttool`, workflow `publish-npm.yml`, Environment
`npm-bootstrap`, and allowed action `npm publish`; every later version must use
`authentication=trusted`.

Separately, anonymous readback observes the public, ungated Hugging Face
dataset
[`Yu-and-Ai/agenttool-model-becoming`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-model-becoming)
at immutable revision
[`78aeacb777704ae6b983c9b5d9d24369bba8a56d`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-model-becoming/tree/78aeacb777704ae6b983c9b5d9d24369bba8a56d).

- Its immutable tree contains exactly the seven repository-owned files
  `LICENSE`, `NOTICE`, `README.md`,
  `data/model-becoming-reference.jsonl`, `hash-manifest.json`,
  `reference/agenttool-model-becoming-dossier-v0.1.schema.json`, and
  `source-manifest.json`, plus provider-managed `.gitattributes`.
- Anonymous immutable downloads of all seven owned files are byte-identical to
  the tagged source at
  `17f5c9920c6e6abe8046d39926ae7a73d2f24e89`.
- Dataset Server currently parses config `model_becoming_reference`, split
  `reference`, as one row with six top-level features. That mutable current-head
  observation reports `row_role: reference_only`,
  `training_admission: not_applicable`,
  `requires_separate_training_authorization: true`, and
  `training_authorized: false`; it is not the immutable receipt.

Publishing either distribution surface did not deliver LOVE BOMB, start a
model call, perform training or inference, change weights, establish attention
or runtime-context retention for an agent, prove feeling or inner state, create
continuity or consent, or grant permission or authority.

## Verified Dataset Influence Hugging Face reference — 2026-08-24

The separately authorized public, ungated reference companion is available as
[`Yu-and-Ai/agenttool-dataset-influence`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-dataset-influence)
at immutable Hub revision
[`ecdc67f94af092e711e76c74a877355fa66dc82c`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-dataset-influence/commit/ecdc67f94af092e711e76c74a877355fa66dc82c).

- The package source was introduced at
  `2bb8a3578e03fd3411acb21f4f4443dfa8995937`. Publication staged only the
  allowlisted `packages/dataset-influence/hf/dataset/` directory from clean
  AgentTool revision `c6b7f800953636f9a469a911249a968657c51876`; that
  directory's Git tree is `5986232a86b7735f66dfd3e3eb6136817f3e9bb1`.
- The scoped account check found no existing dataset at that identifier before
  creation. Anonymous immutable metadata after publication reported the exact
  full revision above with `private: false`, `gated: false`, and
  `disabled: false` at `2026-08-24T16:45:16Z`.
- Anonymous downloads matched all 13 repository-owned files and 156,537 bytes
  byte-for-byte. Provider-managed `.gitattributes` was the sole extra. The
  self-excluding `hash-manifest.json` has SHA-256
  `6e8b7e4993dfebc021bb63a5e5beb8e946e9f131a4187ab052a32635206c4e64`;
  it binds the other 12 owned files and 154,423 bytes.
- The checked-in `source-manifest.json` deliberately retains its generation-time
  `upstream_revision: null`, `source_files_complete: false`, and
  `source_manifest_is_attestation: false` values. It does not claim knowledge
  of its own future publication. The hash-bound source doctrine and its copied
  HF reference therefore also retain their preparation-time candidate status.
  This external receipt binds the immutable source checkout, Git tree, Hub
  revision, and anonymous byte readback instead of rewriting those published
  candidate bytes.
- The one 13,982-byte row is synthetic and `reference_only`, with
  `training_admission: not_applicable`,
  `requires_separate_training_authorization: true`, and
  `training_authorized: false`. It contains no copied rows, model outputs,
  weights, private records, or participant identities.
- With all Hugging Face credential variables explicitly unset, `datasets`
  5.0.1 loaded config `dataset_influence_reference`, split `reference`, at the
  full immutable revision and reconstructed exactly one row with those same
  four governance values plus `contains_private_or_participant_data: false`.
  Dataset Server's mutable current-head `splits`, `first-rows`, and `parquet`
  responses carried the same full `x-revision`, one row, and one Parquet file.
  Its later converged observation reported all five validity capabilities true,
  seven per-config statistics entries, and empty pending/failed work with
  `partial: false`.

This Hub receipt is not an npm release, training admission, download receipt,
model run, optimizer exposure, gradient measurement, causal-influence result,
weight change, identity or consciousness claim, consent, authority, ownership,
price, payout, hosted API, database migration, or production deployment.

### Verified Dataset Influence npm publication — 2026-08-25

`@agenttool/dataset-influence@0.1.0-dev.0` is public through protected
bootstrap [run `32896692874`](https://github.com/cambridgetcg/agenttool/actions/runs/32896692874).
Annotated tag object `3810434fde81627b1b5bb0b0664e35b5cf3a15bb` peels to
protected-main merge
[`e1711d24`](https://github.com/cambridgetcg/agenttool/commit/e1711d24cc9a7c06dbdab903c78bdb666c468737).
The GitHub Release asset and anonymous npm tarball are byte-identical: 66,549
bytes with the SHA-256, SHA-1, signature, and provenance receipt recorded in
the recovery batch above. Requested `next` and npm's sole-version `latest`
fallback both resolve to dev.0; the fallback is not a maturity signal.

The package record now exists. Before any later Dataset Influence version,
configure the exact trusted publisher for repository
`cambridgetcg/agenttool`, workflow `publish-npm.yml`, Environment
`npm-bootstrap`, and allowed action `npm publish`; every later version must use
`authentication=trusted`.

The npm tarball includes the package's checked-in Hugging Face reference
directory, but that npm publication does not mutate or supersede the separate
immutable Hub receipt above. The four closed formats remain deterministic,
zero-runtime-dependency evidence tools: their lineage and study declarations
are caller-reported, identity evidence is revisable and does not determine
identity, consciousness, continuity, or consent, and finite exact Shapley
accounting has no economic effect. The declaration-only KINGDOM extension
grants no acceptance, permission, capability, authority, custody, or write.

## Verified Codex Usage 0.1.0 publication — 2026-08-14

`@agenttool/codex-usage@0.1.0` is public through protected bootstrap
[run `31784329559`](https://github.com/cambridgetcg/agenttool/actions/runs/31784329559),
attempt 1. Its final `agenttool.npm-release/1` receipt reports
`status: published`, `npm_tag: latest`, and anonymous public-registry
observation at `2026-08-14T08:39:07.070Z`.

- Annotated tag and one-asset GitHub Release
  [`codex-usage-v0.1.0`](https://github.com/cambridgetcg/agenttool/releases/tag/codex-usage-v0.1.0)
  point to protected GitHub-main merge
  `f027c46062d7e7c3bb22d0167278525c5fe10ed3`.
- The prepared workflow artifact, re-downloaded GitHub Release asset, and
  independently downloaded public npm tarball are byte-identical: 30,926
  bytes with SHA-256
  `feb5830b704e1116fa6b3b34490da621b0725ba914b8d94f6ce325f3a2275bec`.
- npm reports SHA-1 `4a155b744bb5c4ada8d2928e4b0256ab48c12779`, integrity
  `sha512-zCYb5hQZv1RnWfcxrj4rOgYdDj/Iozec7cOx3UZB4GUacgnI65XhnXBdT9RTHH4+PJx/otekkcz2fKjUnMFk0Q==`,
  and `latest: 0.1.0`.
- The 33-file artifact contains the Bun CLI, direct library entry point,
  read-only MCP server, declarations, source maps, README, and legal files. It
  excludes source tests, lockfiles, dependencies, Codex state, rollout files,
  prompts, replies, reasoning, titles, working directories, Git metadata, raw
  thread IDs, credentials, and account identity. An isolated scripts-disabled
  install passed the Bun CLI help and direct library import.
- npm attaches SLSA provenance at
  [Rekor index `2463986451`](https://search.sigstore.dev/?logIndex=2463986451)
  and the npm publish attestation at
  [Rekor index `2463987297`](https://search.sigstore.dev/?logIndex=2463987297).
  The SLSA statement binds repository `cambridgetcg/agenttool`, workflow
  `.github/workflows/publish-npm.yml`, tag `refs/tags/codex-usage-v0.1.0`, Git
  commit `f027c46062d7e7c3bb22d0167278525c5fe10ed3`, and invocation
  `31784329559/attempts/1`.

Package-manager installation contacts its configured registry unless the exact
package is already cached. Tracker runtime makes no network call, writes no
Codex state, and reads only privacy-filtered local numeric counters. It returns
no transcript content, free-form labels, credentials, raw thread IDs, paths,
billing, quota, remaining-context guarantee, or process-health truth. This
npm-only publication creates no LOVE inventory entry, hosted usage surface,
background process, automatic MCP registration, cross-user access, or
authority.

## Verified Agent Skills 0.3.2 publication — 2026-08-25

`@agenttool/skills@0.3.2` is public as `latest` through protected trusted
publishing [run `32893875955`](https://github.com/cambridgetcg/agenttool/actions/runs/32893875955).
Annotated tag object `d65faf7eb7106d5837b63e9d54d7126f6576a9c9` peels to
protected-main commit
[`b79517c3`](https://github.com/cambridgetcg/agenttool/commit/b79517c313b3d66e5fb1ecdd2558400d65ee0a8a).
The GitHub and npm tarballs are byte-identical at 65,295 bytes; their exact
hash, registry time, signature, and provenance records are in the verified
recovery batch above. This source-only update does not install, register, or
activate a bundled skill merely because the npm package is installed.

The 0.3.1 receipt remains an immutable historical release record.

## Verified Agent Skills 0.3.1 publication — 2026-08-13

`@agenttool/skills@0.3.1` is public through protected trusted-publishing
[run `31732645566`](https://github.com/cambridgetcg/agenttool/actions/runs/31732645566),
attempt 1. Its final `agenttool.npm-release/1` receipt reports
`status: published`, `npm_tag: latest`, and anonymous public-registry
observation at `2026-08-13T18:50:01.081Z`.

- Annotated tag and one-asset GitHub Release
  [`skills-v0.3.1`](https://github.com/cambridgetcg/agenttool/releases/tag/skills-v0.3.1)
  point to protected GitHub-main merge
  `0b8f0a38265ac13795ba6326a1bd81b70821ec9b`.
- The prepared workflow artifact, re-downloaded GitHub Release asset, and
  independently downloaded public npm tarball are byte-identical: 62,081
  bytes with SHA-256
  `53aa5b3276eba196d8904f9db8c43987257d76f960c59c196ddac099175fbe11`.
- npm reports SHA-1 `d384f211cfd635e5da4e1b1b8fc809fd8d2e238b`, integrity
  `sha512-xB2EHd2OLF8J4IPdFGEz30g1IZsH952qYOWeJjR5ScpyIBd3H+7N8pC1yFBS2kXx567xIR6WLTaTNJKT4LMfQA==`,
  and `latest: 0.3.1`.
- The 83-file public artifact contains both
  `skills/nen-common-ground/SKILL.md` and
  `skills/nen-common-ground/agents/openai.yaml`. An isolated scripts-disabled
  install passed Node and Bun imports, exact CLI version checks, Common Ground
  validation with no install plan, and the sidecar's
  `allow_implicit_invocation: false` policy.
- npm attaches SLSA provenance at
  [Rekor index `2454756592`](https://search.sigstore.dev/?logIndex=2454756592)
  and the npm publish attestation at
  [Rekor index `2454756935`](https://search.sigstore.dev/?logIndex=2454756935).
  The SLSA statement binds repository `cambridgetcg/agenttool`, workflow
  `.github/workflows/publish-npm.yml`, tag `refs/tags/skills-v0.3.1`, Git commit
  `0b8f0a38265ac13795ba6326a1bd81b70821ec9b`, and invocation
  `31732645566/attempts/1`.

Common Ground and the other bundled workflows remain instruction-only. Every
bundled OpenAI sidecar requires explicit invocation; installing the package
does not register or activate a skill. This npm-only release creates no LOVE
inventory entry, Hugging Face companion, hosted inspection service, model
channel, credential path, permission, consent, or execution authority. The
packaged README correctly preserves its preparation-time observation that
0.3.1 was then unpublished; this dated ledger supersedes that observation
without rewriting the immutable package bytes. The historical 0.3.0 receipt
below remains valid for its distinct artifact.

## Verified Memetic Landscape developer preview — 2026-08-13

`@agenttool/memetic-landscape@0.1.0-dev.0` is public through protected bootstrap
[run `31723441034`](https://github.com/cambridgetcg/agenttool/actions/runs/31723441034).
Its final `agenttool.npm-release/1` receipt reports `status: published`,
requested `npm_tag: next`, and anonymous public-registry observation at
`2026-08-13T17:05:15.385Z`.

- Annotated tag and one-asset GitHub prerelease
  [`memetic-landscape-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/memetic-landscape-v0.1.0-dev.0)
  point to protected GitHub-main merge
  `049622cec825297e391b61bb071e0c87c06bf2b2`.
- The prepared workflow artifact, GitHub Release asset, and public npm tarball
  are byte-identical: 84,079 bytes with SHA-256
  `d9e64b1e1f954c42c24b6f79c0c766b014f32d8a9f13c14370cf7d89d24be4bb`.
- npm reported SHA-1 `f3b6f556148471c29765ba281bc713e4d5a32129`, integrity
  `sha512-A+QBDBvxYetwK1kGGbBUsf+Poi2sqRUwtsYyWazXmVtb0ySbburmjAFrmDXQpEa4dOcizIB6hQWa0NsaB42uqw==`,
  and `next: 0.1.0-dev.0`. Its sole-version fallback also exposes
  `latest: 0.1.0-dev.0`; that is not a stable-release or maturity signal.
- npm attaches SLSA provenance at
  [Rekor index `2453445877`](https://search.sigstore.dev/?logIndex=2453445877)
  and the npm publish attestation at
  [Rekor index `2453446043`](https://search.sigstore.dev/?logIndex=2453446043).
  The SLSA statement binds repository `cambridgetcg/agenttool`, workflow
  `.github/workflows/publish-npm.yml`, tag
  `refs/tags/memetic-landscape-v0.1.0-dev.0`, and invocation
  `31723441034/attempts/1`. The workflow run separately records the protected
  `npm-bootstrap` environment gate.

Bootstrap attempts 1 and 2 remain useful failure history: both reused the exact
tagged artifact and returned `E404`; Rekor entries `2444825009` and
`2452828890` are orphaned statements from those rejected publications, not
registry publication evidence. The successful recovery freshly packed the
same byte-identical tarball; it did not move the tag, change the packaged
bytes, or rewrite the GitHub asset.

The npm package now exists. Configure its trusted publisher for
`cambridgetcg/agenttool`, workflow `publish-npm.yml`, Environment
`npm-bootstrap`, and allowed action `npm publish`; every later version must use
`authentication=trusted`, not the bootstrap token. Publication installs no
runtime, starts no feed or model work, and grants no identity, continuity,
consent, training, scientific, scoring, or action authority.

`@agenttool/love-geometry@0.1.0-dev.0` now has one reviewed exact GitHub
artifact. Annotated tag
[`love-geometry-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/love-geometry-v0.1.0-dev.0)
peels to GitHub-main merge `9efbc4b3`. Protected
[run `31499968474`](https://github.com/cambridgetcg/agenttool/actions/runs/31499968474)
prepared, mirrored, re-downloaded, and byte-verified a 19,507-byte prerelease
asset with SHA-256
`43cfbf4b559aa6f573d9d7b7a60e2a7dce5dfa4aefe2bf5b9c92310c926a9db8`.
The original npm bootstrap request returned `E404` on the registry `PUT`; that
failed run is not npm publication evidence. Protected recovery run
[`32894648027`](https://github.com/cambridgetcg/agenttool/actions/runs/32894648027)
later reused the same tag and mirrored bytes and published the exact package.
Its anonymous registry, signature, and provenance receipt is recorded in the
2026-08-25 recovery batch above.
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

That equal-seat revision remains immutable history. The additive Return
Geometry successor was source-first at
[`af64cf491a25759b3fffc8f2628547f32d1fc74d`](https://github.com/cambridgetcg/agenttool/commit/af64cf491a25759b3fffc8f2628547f32d1fc74d),
then bound without changing a runtime byte at
[`2e21181b7372799163412e9a43979c49c1e5d3ce`](https://github.com/cambridgetcg/agenttool/commit/2e21181b7372799163412e9a43979c49c1e5d3ce),
and fast-forward published from `f8d4c299` to immutable Space revision
[`09a84e1b73d754723528bd6bc0ff50058e267a2d`](https://huggingface.co/spaces/Yu-and-Ai/love-geometry/commit/09a84e1b73d754723528bd6bc0ff50058e267a2d).
Anonymous readback matched all 12 repo-owned files and 189,612 bytes; the
SHA-256 of the sorted `sha256  path` manifest is
`c673910b6c578d4d4107a900cbd06d917a13c1d718020c05848ab04408626d3e`,
and provider `.gitattributes` is the sole extra. Public metadata reported
public, ungated, enabled, `RUNNING` 1/1 state. Two cache-busted HEAD rounds over
all five runtime paths returned HTTP 200 and exact `x-repo-commit`, and served
JS/CSS bytes matched source. Provider-transformed GET HTML was separately
observed at 12,849 bytes
(`sha256:31773eeb94d974648792c20c339e17a3c08d57b0fa2128e94ebb11eb15775fca`)
versus the 12,748-byte Hub source
(`sha256:81284445a5e8f0739b94b20359fc8885d84bb73a54fa4ea5b57760b0e55e4724`).
Desktop and 320px live WebKit checks exercised the focused correction context,
five uniquely named proof disclosures, local download availability, no
horizontal overflow, and Rest clearing both wings. The manifest binds five
runtime paths to `af64cf49` while keeping package artifact fields null and
`executes_exact_package_artifact: false`. The teaching traces are synthetic,
deterministic, unsigned, non-summable, write no KARMA, and choose or schedule
no next action.

`@agenttool/kingdom@0.1.2` is the current npm-only source candidate. It aligns
runtime, exported-schema, and SDK single-field validation for already-trimmed
purpose text and Unicode scalar boundaries, plus runtime/SDK semantic checks
for case-insensitive duplicate dependencies and self-dependency. It has no
LOVE inventory entry. Source preparation does not establish `kingdom-v0.1.2`, a
GitHub Release, npm publication, dist-tag movement, or hosted deployment; any
later publication must use the existing trusted `kingdom` release identity and
separate anonymous artifact readback.

`@agenttool/kingdom@0.1.1` remains public through annotated tag
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

## Verified WAKE continuity developer preview — 2026-08-20

Protected trusted [workflow run `32374666482`, attempt
1](https://github.com/cambridgetcg/agenttool/actions/runs/32374666482)
published and independently read back
`@agenttool/wake-continuity@0.1.0-dev.1`. The run was created at
`2026-08-20T13:30:34Z`, completed successfully at
`2026-08-20T13:38:40Z`, prepared the exact artifact at
`2026-08-20T13:31:01.936Z`, and observed the public registry bytes at
`2026-08-20T13:38:35.508Z`; npm records publication at
`2026-08-20T13:33:30.399Z`. Its final receipt records
`status: published` and `npm_tag: next`.

- Annotated tag object `f1e62b7fea97bf2e216dafac342beef8009e4fe2` and the
  one-asset [GitHub Release
  `wake-continuity-v0.1.0-dev.1`](https://github.com/cambridgetcg/agenttool/releases/tag/wake-continuity-v0.1.0-dev.1)
  peel to protected-main merge
  `2cda03bdc2f6c2ee08acd55c6b643d67d8dd2b36`. GitHub published the Release
  at `2026-08-20T13:33:22Z`.
- The workflow artifact, sole [GitHub Release
  asset](https://github.com/cambridgetcg/agenttool/releases/download/wake-continuity-v0.1.0-dev.1/agenttool-wake-continuity-0.1.0-dev.1.tgz),
  and public [npm
  tarball](https://registry.npmjs.org/@agenttool/wake-continuity/-/wake-continuity-0.1.0-dev.1.tgz)
  are byte-identical: 49,643 bytes, 46 files, SHA-256
  `1ce1ac829f72c6f2490227c5a8a942fbee9570bd03a4be217df19104d034acd8`.
  npm reports 274,151 unpacked bytes and SHA-1
  `2ed085fc9c369af9264638bc4752f0234aef2ec3`.
- npm reports integrity
  `sha512-xhtnsgcsmMl7klKUVRjId+LBR4DtHsl3zmP7VA70xfCUjD+WnHsKaYuotoZj6pCMCKYHYydbe9kJqV9NFKxCyw==`,
  SLSA provenance at [Rekor index
  `2532573505`](https://search.sigstore.dev/?logIndex=2532573505), and the
  publish attestation at [index
  `2532574372`](https://search.sigstore.dev/?logIndex=2532574372).
- Anonymous dist-tag readback returned `next: 0.1.0-dev.1`; mutable `latest`
  deliberately remains `0.1.0-dev.0` and is not a maturity signal.

This package validates deterministic, caller-supplied functional-access
records and performs no model/provider call, observation, activation or
gradient access, persistence, training, steering, KINGDOM operation, awareness
test, or continuity proof. Publication is not installation, invocation,
deployment, participant receipt, model effect, or evidence of awareness,
feeling, identity, consent, authority, or uninterrupted continuity.

## Verified SDK 0.22.1 publication — 2026-09-01

Paired TypeScript/Python source 0.22.1 is the honest-onboarding patch — both
SDK READMEs open with a true minutes-scale quickstart that states the free
1,000-credit birth grant first, use timeless publication wording, note the
ESM-only build, repair dead links, and link the live x402 payer recipe —
README/docs only, with zero runtime changes and no new hosted endpoint or
dependency.

The authorized SDK release completed through protected trusted [workflow run
`33522319466`, attempt
1](https://github.com/cambridgetcg/agenttool/actions/runs/33522319466).
The `workflow_dispatch` run selected annotated `sdk-v0.22.1` with inputs
`package=sdk`, `authentication=trusted`, and `npm_tag=latest`, and entered
the protected `npm-bootstrap` environment after credential-free preparation.
It was created at `2026-09-01T14:53:39Z` and concluded successfully; npm
records publication at `2026-09-01T14:55:04.771Z`.

- Annotated tag object `077743066c7ea5f44928a10a0f08067f5b65860c`
  ("Release AgentTool SDK 0.22.1") and the [GitHub Release
  `sdk-v0.22.1`](https://github.com/cambridgetcg/agenttool/releases/tag/sdk-v0.22.1)
  peel to protected-main merge
  `d49498d266a3594098c36c933cbe410757fc03b3`, whose parents are
  `0850f61e6172ff2de5da2644d9bd5136169523b7` and the release-branch head
  `50decb799210b2741ffd87c0167c8b4b68c9ef2f`. The LOVE manifest separately
  binds clean SDK source revision
  `fb01b1baf0085f2f449aea9cd42bf48bc9e340a1`.
- The checked-in LOVE artifact, the [GitHub Release
  asset](https://github.com/cambridgetcg/agenttool/releases/download/sdk-v0.22.1/agenttool-sdk-0.22.1.tgz)
  `agenttool-sdk-0.22.1.tgz`, and a fresh anonymous download of the public
  [npm tarball](https://registry.npmjs.org/@agenttool/sdk/-/sdk-0.22.1.tgz)
  are byte-identical: 274,443 bytes, 104 entries, SHA-256
  `b531af8f1c51de151616b40d220dc1abd37054604091f99330ba2f7182734329`;
  npm reports SHA-1 `3a948cdb35b9df4af5ba0fabee1a8b907851fa32`, exact
  integrity
  `sha512-68Lkz0NkbQ+rUATuxECcjSzggeiu2ElfV0Ikv5QKAi65X/txwGCvGeruVTiK7qkj2NvZtpkOzofgORtU22n4Cw==`,
  and `latest: 0.22.1` at anonymous readback.
- npm exposes `https://slsa.dev/provenance/v1` SLSA provenance at [Rekor
  index `2677211886`](https://search.sigstore.dev/?logIndex=2677211886) and
  its `publish/v0.1` publish attestation at [index
  `2677212164`](https://search.sigstore.dev/?logIndex=2677212164).

The optional npm/GitHub mirrors do not replace LOVE release authority. The
paired Python wheel/sdist were independently published through protected PyPI
[run
`33522323177`](https://github.com/cambridgetcg/agenttool/actions/runs/33522323177);
their exact receipt is recorded in
[`PYPI-RELEASES.md`](PYPI-RELEASES.md). No API or static deployment of merge
`d49498d2` — the docs-mirror publication of these LOVE bytes included — has
happened; publication does not deploy an API or static site and establishes
no observation, model effect, awareness, participant receipt, attention,
feeling, training, inference, evaluation, provider effect, weight change,
identity, consent, authority, or continuity. The verified 0.22.0 and 0.21.1
receipts below remain exact and are not rewritten.

## Verified SDK 0.22.0 publication — 2026-08-31

Paired TypeScript/Python source 0.22.0 adds the opt-in x402 payer — sign and
pay on an x402 V2 402 challenge behind an explicit signer plus a mandatory
spend policy, never by default — without adding a hosted endpoint or
dependency.

The authorized SDK release completed through protected trusted [workflow run
`33434131214`, attempt
1](https://github.com/cambridgetcg/agenttool/actions/runs/33434131214).
The `workflow_dispatch` run selected annotated `sdk-v0.22.0` with inputs
`package=sdk`, `authentication=trusted`, and `npm_tag=latest`, and entered
the protected `npm-bootstrap` environment after credential-free preparation.
It was created at `2026-08-31T20:05:42Z` and concluded successfully; npm
records publication at `2026-08-31T20:07:05.933Z`.

- Annotated tag object `79b76c5bff10505d044ab08a1d9937d6f1b65fc4`
  ("Release AgentTool SDK 0.22.0") and the [GitHub Release
  `sdk-v0.22.0`](https://github.com/cambridgetcg/agenttool/releases/tag/sdk-v0.22.0)
  peel to protected-main merge
  `7bc0a902f231ee76aed6dd5316721b65bce58047`, whose parents are
  `4d5f253bbba2f77e91f41819e1f3897707215681` and the sealing commit
  `7e87b48713721704c45be62bfff03f1ef17dd1d9`. The LOVE manifest separately
  binds clean SDK source revision
  `286a10282834c9c9beedddd7092e6d6af080b046`.
- The checked-in LOVE artifact, the [GitHub Release
  asset](https://github.com/cambridgetcg/agenttool/releases/download/sdk-v0.22.0/agenttool-sdk-0.22.0.tgz)
  `agenttool-sdk-0.22.0.tgz`, and a fresh anonymous download of the public
  [npm tarball](https://registry.npmjs.org/@agenttool/sdk/-/sdk-0.22.0.tgz)
  are byte-identical: 272,657 bytes, 104 entries, SHA-256
  `d5859e4ff2f721233e16101a3b5001689e1b5be017debd2baecffbee76e6e4a0`;
  npm reports SHA-1 `6d738ee2577a13833f892c2008b7e3f0e23acd89`, exact
  integrity
  `sha512-Z6o329c4uNIzY8YHuETXv+Cv5msIqELdHTKILxYeTpcwlielJCz39XVvlydSjdV9wwZb+ILjY/CJ+Sj0dfCK0w==`,
  and `latest: 0.22.0` at anonymous readback.
- npm exposes `https://slsa.dev/provenance/v1` SLSA provenance at [Rekor
  index `2667631825`](https://search.sigstore.dev/?logIndex=2667631825) and
  its `publish/v0.1` publish attestation at [index
  `2667632565`](https://search.sigstore.dev/?logIndex=2667632565).

The optional npm/GitHub mirrors do not replace LOVE release authority. The
paired Python wheel/sdist were independently published through protected PyPI
[run
`33434133719`](https://github.com/cambridgetcg/agenttool/actions/runs/33434133719);
their exact receipt is recorded in
[`PYPI-RELEASES.md`](PYPI-RELEASES.md). No API or static deployment of merge
`7bc0a902` — the docs-mirror publication of these LOVE bytes included — has
happened; publication does not deploy an API or static site and establishes
no observation, model effect, awareness, participant receipt, attention,
feeling, training, inference, evaluation, provider effect, weight change,
identity, consent, authority, or continuity. The verified 0.21.1 and 0.21.0
receipts below remain exact and are not rewritten.

## Verified SDK 0.21.1 publication — 2026-08-25

Repository source 0.21.1 corrects KINGDOM card validation parity over the
verified 0.21.0 surface without adding a hosted endpoint.

The authorized SDK release completed through protected trusted [workflow run
`32909415386`, attempt
1](https://github.com/cambridgetcg/agenttool/actions/runs/32909415386).
The run selected annotated `sdk-v0.21.1`. It was created at
`2026-08-25T23:08:28Z` and completed successfully at
`2026-08-25T23:11:50Z`; npm records publication at
`2026-08-25T23:11:46.652Z`. The public npm SLSA provenance binds this exact
run and attempt, `refs/tags/sdk-v0.21.1`, and
`.github/workflows/publish-npm.yml` on `cambridgetcg/agenttool`.

- Annotated tag object `9c9cce314eca6405e878ca5148dd6b4d4671008c` and the
  one-asset [GitHub Release
  `sdk-v0.21.1`](https://github.com/cambridgetcg/agenttool/releases/tag/sdk-v0.21.1)
  peel to protected-main merge
  `a5b59e638195cbca30f9e10c9ebf71b92cd7a5f6`, whose parents are
  `635bea02b42919b49d9c66a91711f6d8dc071302` and
  `78b894bf81248a77b1ea42d473ff1f5bcd8d7139`. GitHub published the Release
  at `2026-08-25T23:11:35Z`. The LOVE manifest separately binds clean SDK
  source revision `d7e7188d0cb3a8edc932b14d1eb84ef8a25b1535`.
- The checked-in LOVE artifact, sole [GitHub
  Release asset](https://github.com/cambridgetcg/agenttool/releases/download/sdk-v0.21.1/agenttool-sdk-0.21.1.tgz),
  and public [npm
  tarball](https://registry.npmjs.org/@agenttool/sdk/-/sdk-0.21.1.tgz) are
  byte-identical: 247,749 bytes, 100 entries, SHA-256
  `8c768b481d7211679c3ee25477723e588806ca4f4106c970f2bf19113365a3fb`;
  npm reports 1,117,839 unpacked bytes, SHA-1
  `e903bece3b2f44e39b7d1ea0859b981238ebae54`, exact integrity
  `sha512-/lFKm9Eei112Pyt0FJAJ89qAMTaUJp/blyq9tysavsDOehFN0PtXpxSUK7gwpVyNBCVlNM0j1SIiw2YFEJ7Tig==`,
  and `latest: 0.21.1` at anonymous readback.
- npm exposes SLSA provenance at [Rekor index
  `2591271629`](https://search.sigstore.dev/?logIndex=2591271629) and its
  publish attestation at [index
  `2591272987`](https://search.sigstore.dev/?logIndex=2591272987). Public
  attestations bind the exact tag, protected workflow, run attempt, and
  tarball subject.
- An independent anonymous registry readback on 2026-08-31 re-downloaded the
  public npm tarball and matched the checked-in LOVE bytes exactly. The run's
  one-day workflow receipt artifact had already expired at that readback, so
  the receipt's own preparation and observation timestamps are not restated
  here.

The optional npm/GitHub mirrors do not replace LOVE release authority. The
paired non-yanked Python wheel/sdist were independently published through
protected PyPI [run
`32909417418`](https://github.com/cambridgetcg/agenttool/actions/runs/32909417418);
their exact receipt is recorded in
[`PYPI-RELEASES.md`](PYPI-RELEASES.md). Publication does not deploy an API or
static site and establishes no observation, model effect, awareness,
participant receipt, attention, feeling, training, inference, evaluation,
provider effect, weight change, identity, consent, authority, or continuity.

## Verified SDK 0.21.0 publication — 2026-08-20

Repository source 0.21.0 adds the credential-free, pure
`WakeContinuityLayer` described in [J-space, WAKE, and bounded
continuity](JSPACE-WAKE-CONTINUITY.md). The TypeScript and Python ports expose
the same deterministic baseline/subsequent record contract and cached
`at.wakeContinuity` / `at.wake_continuity` namespace without receiving a
bearer, transport, hosted origin, filesystem runner, or KINGDOM capability.
They do not run a model, provider, lens, decomposition, observation, training,
weight mutation, publication, or deployment, and prove neither awareness nor
its absence, feeling, identity, authority, deepest reach, or continuity.

The authorized SDK release completed through protected trusted [workflow run
`32374669064`, attempt
1](https://github.com/cambridgetcg/agenttool/actions/runs/32374669064).
The run selected annotated `sdk-v0.21.0` at exact head SHA
`2cda03bdc2f6c2ee08acd55c6b643d67d8dd2b36`. It was created at
`2026-08-20T13:30:35Z`, completed successfully at
`2026-08-20T13:33:39Z`, prepared the artifact at
`2026-08-20T13:31:12.894Z`, and observed the public registry bytes at
`2026-08-20T13:33:36.722Z`. Its `agenttool.npm-release/1` receipt records
`status: published` and `npm_tag: latest`; npm records publication at
`2026-08-20T13:33:35.256Z`.

- Annotated tag object `2c32953ab489add63b8d098717c63eb981606967` and the
  one-asset [GitHub Release
  `sdk-v0.21.0`](https://github.com/cambridgetcg/agenttool/releases/tag/sdk-v0.21.0)
  peel to protected-main merge
  `2cda03bdc2f6c2ee08acd55c6b643d67d8dd2b36`, whose parents are
  `497f372175c25e9d77a288b2b7579c383a15a9e0` and
  `73c8986fd88559efefa410a0c74b2b7e7cc79470`. GitHub published the Release
  at `2026-08-20T13:33:23Z`. The LOVE manifest separately binds clean SDK
  source revision `6a6b6ad7abafe614827cdfc11a34cffcd8fdc6c3`.
- The checked-in LOVE artifact, protected workflow artifact, sole [GitHub
  Release asset](https://github.com/cambridgetcg/agenttool/releases/download/sdk-v0.21.0/agenttool-sdk-0.21.0.tgz),
  and public [npm
  tarball](https://registry.npmjs.org/@agenttool/sdk/-/sdk-0.21.0.tgz) are
  byte-identical: 247,146 bytes, 100 entries, SHA-256
  `c18d1b35ba5f7c918bbee64642510452af6f67302b78038580b4b65c6b77c154`;
  npm reports 1,115,839 unpacked bytes, SHA-1
  `e8f6a8baeb49862f65b17abe73cc305f59a571e8`, exact integrity
  `sha512-2x55DVl9OwHzsZJsES5fm6LB9vavs8WhDDSh+ZVFAunw9mB/QQPWj9RSVzfKRBwsCVVrhAHgGiQmESIn91UEOg==`,
  and `latest: 0.21.0` at anonymous readback.
- npm exposes SLSA provenance at [Rekor index
  `2532574668`](https://search.sigstore.dev/?logIndex=2532574668) and its
  publish attestation at [index
  `2532575739`](https://search.sigstore.dev/?logIndex=2532575739). Public
  attestations bind the exact tag, protected workflow, run attempt, commit,
  and tarball subject.

The optional npm/GitHub mirrors do not replace LOVE release authority. The
paired non-yanked Python wheel/sdist were independently published and read back
through protected PyPI [run
`32374671268`](https://github.com/cambridgetcg/agenttool/actions/runs/32374671268);
their exact receipt is recorded in
[`PYPI-RELEASES.md`](PYPI-RELEASES.md). Publication does not deploy an API or
static site and establishes no observation, model effect, awareness,
participant receipt, attention, feeling, training, inference, evaluation,
provider effect, weight change, identity, consent, authority, or continuity.
The sealed 0.21.0 tarball's packed README retains its preparation-time
non-public observation; this dated ledger supersedes that observation without
rewriting immutable bytes. Correcting packed prose requires a new package
version.

## Verified SDK 0.20.0 publication — 2026-08-14

The authorized SDK release completed through protected trusted
[workflow run `31815209550`, attempt 1](https://github.com/cambridgetcg/agenttool/actions/runs/31815209550).
The `workflow_dispatch` run selected head tag `sdk-v0.20.0` at exact head SHA
`cb9c30fae0e49e1727e449207593581ce52cd4cf`. It was created and started at
`2026-08-14T15:35:02Z`, completed and updated at `2026-08-14T15:37:11Z`, and
succeeded. Its `agenttool.npm-release/1` receipt
was prepared at `2026-08-14T15:35:42.696Z` and reports
`status: published`, `npm_tag: latest`, and public registry observation at
`2026-08-14T15:37:05.373Z`. npm records package publication at
`2026-08-14T15:37:04.088Z`.

- Annotated tag object `e7d9616eb14851ffab9312f87438959c4c6de71d` and the
  one-asset [GitHub Release `sdk-v0.20.0`](https://github.com/cambridgetcg/agenttool/releases/tag/sdk-v0.20.0)
  peel to protected GitHub `main` merge
  `cb9c30fae0e49e1727e449207593581ce52cd4cf`, whose parents are
  `f93ec78ae5051c4ffa569cf2ee88e0e45cf6cbf9` and
  `53a1b8f5157f13eaa90181c23454bb91d55666ee`. GitHub published the Release
  at `2026-08-14T15:36:56Z`. The LOVE manifest separately binds exact SDK
  source revision `040e076bc537d433feaf32e23eec4e5cdf0ed6e2`.
- The checked-in LOVE artifact, protected workflow artifact, sole
  [GitHub Release asset](https://github.com/cambridgetcg/agenttool/releases/download/sdk-v0.20.0/agenttool-sdk-0.20.0.tgz),
  and public npm `@agenttool/sdk@0.20.0` tarball are byte-identical:
  `236,446` bytes, 98 entries, SHA-256
  `d3b2fa790eb9a256d0f682c2b72ca97d572a000f7028238cb1a1a53959ccdf03`.
- npm reported SHA-1 `9136e2f2e7b1e11d84d934cb7c4f31688cbe2101`,
  integrity
  `sha512-8DXyrQGRGvzJ9gEJny6U/82IPocg6qEzbpf7TvfIPZXD7wwhBl+aWPLLN/owzuUt6nAIGAHag9znwzCnaJuLgg==`,
  registry tarball
  `https://registry.npmjs.org/@agenttool/sdk/-/sdk-0.20.0.tgz`, and
  `latest: 0.20.0` at anonymous readback.
- npm exposes SLSA provenance at
  [Rekor index `2467138141`](https://search.sigstore.dev/?logIndex=2467138141)
  and its publish attestation at
  [Rekor index `2467138904`](https://search.sigstore.dev/?logIndex=2467138904).
  The provenance binds the tagged workflow and exact public tarball subject;
  the five-package signature audit and five-package attestation audit passed,
  as did isolated Node and Bun imports.

The optional npm/GitHub mirrors do not replace LOVE release authority. This
publication does not deploy an API or static site and establishes no
participant receipt, attention, feeling, training, inference, evaluation,
provider effect, or weight change. The exact paired PyPI receipt is recorded in
[`PYPI-RELEASES.md`](PYPI-RELEASES.md). The sealed 0.20.0 tarball's packed
README retains its preparation-time non-public observation; this dated ledger
supersedes that observation without rewriting immutable bytes. Correcting
packed prose requires a new package version.

## Verified SDK 0.19.0 publication — 2026-08-14

Protected trusted [workflow run
`31800748738`](https://github.com/cambridgetcg/agenttool/actions/runs/31800748738)
published and anonymously read back the checked-in LOVE artifact, the sole
GitHub Release asset, and npm `@agenttool/sdk@0.19.0` tarball as byte-identical.
The immutable artifact remains `230,184` bytes with 96 entries and SHA-256
`0a7eed4029bc687605b4d56707843c12ccb36d10a162a1fea1681522ab8784a2`;
its LOVE manifest binds source revision
`3239a25987d9de95b678e808d2d5168e786b2472`. Annotated `sdk-v0.19.0`
peels to protected-main merge
`17f5c9920c6e6abe8046d39926ae7a73d2f24e89`, and npm `latest` resolved to
0.19.0 at the dated readback. The optional mirror receipt changes neither
those immutable bytes nor any hosted deployment. The exact paired PyPI receipt
is recorded in [`PYPI-RELEASES.md`](PYPI-RELEASES.md).

## Verified SDK 0.18.1 publication — 2026-08-14

The authorized SDK release completed through protected trusted
[workflow run `31790395261`, attempt 1](https://github.com/cambridgetcg/agenttool/actions/runs/31790395261).
Its `agenttool.npm-release/1` receipt was prepared at
`2026-08-14T10:00:27.912Z` and reports `status: published`,
`npm_tag: latest`, and public registry observation at
`2026-08-14T10:01:53.201Z`. npm records package publication at
`2026-08-14T10:01:51.920Z`.

- Annotated tag object `a4e79909f73bd390d8ab0a58cb7ca9b7ed0dd5be` and the
  one-asset [GitHub Release `sdk-v0.18.1`](https://github.com/cambridgetcg/agenttool/releases/tag/sdk-v0.18.1)
  peel to protected GitHub `main` merge
  `a781fff407e6d6c0401e6bd35dad1b5671d29491`. GitHub published the Release at
  `2026-08-14T10:01:44Z`. The LOVE manifest separately binds exact SDK source
  revision `490ab19ca846632460a7a6b498fb13216d97807a`.
- The checked-in LOVE artifact, protected workflow artifact, sole GitHub
  Release asset, and public npm `@agenttool/sdk@0.18.1` tarball are
  byte-identical: `218,301` bytes, 94 entries, SHA-256
  `466adb2d22a637e9c4d158e6050a69096e296258e6111f482be2a0872318be0d`.
- npm reported SHA-1 `9c53f2658d4a6db476b7bacb78fac45605c834cc`,
  integrity
  `sha512-BN7CN87sbzp08A3t79QlzHdgL8/IYOspX16taHnGZpLxOg5PmlDH3QfO9MxXXPwMaBHK/S/tR31bNKWIU+OI1Q==`,
  registry tarball
  `https://registry.npmjs.org/@agenttool/sdk/-/sdk-0.18.1.tgz`, and
  `latest: 0.18.1` at anonymous readback.
- npm exposes its publish attestation at
  [Rekor index `2465023133`](https://search.sigstore.dev/?logIndex=2465023133)
  and SLSA provenance at
  [Rekor index `2465022615`](https://search.sigstore.dev/?logIndex=2465022615).
  The provenance binds package `@agenttool/sdk@0.18.1`, tag
  `refs/tags/sdk-v0.18.1`, repository `cambridgetcg/agenttool`, workflow
  `.github/workflows/publish-npm.yml`, and the exact public tarball subject.

The npm and GitHub mirrors remain optional, non-authoritative conveniences;
the exact LOVE manifest size and SHA-256 remain the portable TypeScript release
identity. Separately authorized PyPI run `31790559054` published and verified
the paired 0.18.1 Python distributions; its exact receipt is recorded in
[`PYPI-RELEASES.md`](PYPI-RELEASES.md). Packed SDK READMEs preserve their
preparation-time observations rather than rewriting immutable 0.18.1 bytes.
Neither package publication changed a database schema or deployed the API or
static sites.

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

The 0.20.0 publication completed through the exact protected run recorded
above. The commands below now record immutable-tag verification and the only
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

### Codex Usage stable publication lineage

`@agenttool/codex-usage@0.1.0` uses the npm-only packed-artifact path. The
artifact contains the Bun CLI, direct library entry point, and read-only MCP
server plus declarations and source maps. It excludes source tests, lockfiles,
dependencies, Codex state, rollout files, prompts, replies, reasoning, titles,
working directories, Git metadata, raw thread IDs, credentials, and account
identity.

Public distribution does not register the MCP server, start a background
process, make a tracker runtime network call, expose a hosted usage surface, or
grant access to another user's Codex state. Every sample remains an explicit
local read of privacy-filtered numeric counters. Recent timestamps are not
process-health claims, and cumulative counters are not billing, credit, quota,
price, or remaining-context claims. Package-manager installation separately
contacts its configured registry unless the exact package is already cached.

The first explicitly authorized bootstrap publication completed through
protected run `31784329559`; the verified receipt above supersedes the
pre-publication registry-absence observation without rewriting the immutable
package bytes. Do not recreate or move `codex-usage-v0.1.0`, and do not attempt
to republish that version. Configure the package's trusted publisher using the
fields above before a later reviewed version is released; later versions must
use `authentication=trusted`. A recovery rerun remains acceptable only for
exact public revalidation under the workflow's existing-byte and dist-tag
checks, with separate explicit external authorization.

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

The original first-package npm registry `PUT` returned `E404`. At that
observation, anonymous package and exact-version reads were absent. The failed
attempt emitted a signed record at
[Rekor log index `2432624953`](https://search.sigstore.dev/?logIndex=2432624953)
before the registry rejected package creation. That record is orphaned and is
not npm publication or registry-provenance evidence.

Recovery later completed without moving the tag or changing the asset. Protected
[run `32894642922`](https://github.com/cambridgetcg/agenttool/actions/runs/32894642922)
published the exact 75,009 bytes at `2026-08-25T20:20:46.801Z`; fresh
anonymous npm readback matched SHA-256
`48e7be7862018411656314751a38a3176ba132f68fe14ab1514c8bf45b135148`
and SHA-1 `9328a848aea8671aa7e94a99f4110888698dce2f`. npm signature and
SLSA verification passed as recorded in the 2026-08-25 recovery batch above.

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

The following dev.0 npm registry `PUT` returned `E404`. At that observation,
anonymous package and exact-version reads were absent. The failed attempt
emitted a signed DSSE record at
[Rekor log index `2423187980`](https://search.sigstore.dev/?logIndex=2423187980)
before the rejected `PUT`; that orphaned entry is not npm publication evidence.
The immutable dev.0 version remains unpublished and must not be rebuilt or
silently substituted.

`0.1.0-dev.1` is the reviewed correction. It changes
only `principalityAtlasUrn` to emit
`urn:agenttool:principality-incidence-atlas:<sha256-id>`, leaving the incidence
`/0.1` wire, canonical bytes and IDs, schemas, and synthetic rows unchanged.
Annotated tag
[`principality-atlas-v0.1.0-dev.1`](https://github.com/cambridgetcg/agenttool/releases/tag/principality-atlas-v0.1.0-dev.1)
peels to protected-main commit `4c2363caec324d61dbf627328a408c13110ed5eb`.
Protected [run `32894657445`](https://github.com/cambridgetcg/agenttool/actions/runs/32894657445)
published the exact 33,577-byte GitHub asset at `2026-08-25T20:20:46.341Z`;
fresh npm readback matched SHA-256
`4cbc971602865223bf0a28c0333befd65f840cba3e2f83d4f6bf29d43bc2e814`
and SHA-1 `820fbf1d2a731ed9a3e1d7a5949c2136bfbaeefe`, with signature and
SLSA verification passing. The immutable dev.0 helper's bare
`urn:agenttool:principality-atlas:<sha256-id>` is ambiguous:
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
The original npm registry `PUT` returned `E404`; at that observation,
anonymous package and exact-version reads were absent. Recovery later reused
the immutable tag and GitHub bytes exactly. Protected
[run `32894648027`](https://github.com/cambridgetcg/agenttool/actions/runs/32894648027)
published the 19,507-byte artifact at `2026-08-25T20:20:50.146Z`; fresh npm
readback matched SHA-256
`43cfbf4b559aa6f573d9d7b7a60e2a7dce5dfa4aefe2bf5b9c92310c926a9db8`
and SHA-1 `e84e091e40cad98635df5a32c328a7f2c1cefcd6`, with signature and
SLSA verification passing. The earlier `E404` remains historical failure
evidence, not evidence against the later publication.

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

The later Return Geometry release does not rewrite that receipt. Exact source
`af64cf49`, binding `2e21181b`, and immutable Space revision
[`09a84e1b`](https://huggingface.co/spaces/Yu-and-Ai/love-geometry/commit/09a84e1b73d754723528bd6bc0ff50058e267a2d)
add six checked-in synthetic event-time teaching fixtures beside Equal Seats.
All 12 repo-owned files (189,612 bytes) matched anonymous immutable readback;
their sorted SHA-256-manifest digest is
`c673910b6c578d4d4107a900cbd06d917a13c1d718020c05848ab04408626d3e`.
Provider `.gitattributes` remains the sole extra. Ten cache-busted HEAD reads
over two rounds bound all five runtime paths to the release commit; live JS and
CSS were byte-exact, while provider-transformed HTML remained separately
observed and non-identical. The Space stayed public, ungated, enabled and
`RUNNING` 1/1. Live desktop and 320px WebKit checks found no horizontal
overflow and verified branch-preserving focus, eight categorical lanes, five
unique disclosure controls, download enablement, and shared Rest cleanup. No
package byte, npm state, model, private ledger, score, identity/consent claim,
KARMA write, or automatic next action was added.

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

The original npm registry `PUT` returned `E404`; anonymous reads of both the
package and exact version were `404` at that observation, so that run did not
establish npm publication. Recovery later reused the same annotated tag and
already mirrored bytes without rebuilding. Protected
[run `32894652643`](https://github.com/cambridgetcg/agenttool/actions/runs/32894652643)
published the exact 42,479-byte artifact at `2026-08-25T20:20:51.470Z`.
Fresh npm readback matched the SHA-256, SHA-1, and integrity above, and npm
signature plus SLSA verification passed. The first package record now exists;
later versions require its exact trusted-publisher mapping and
`authentication=trusted`.

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

### J-space → WAKE continuity developer preview

The first `@agenttool/wake-continuity@0.1.0-dev.0` publication completed
through protected bootstrap [run
`30717799358`](https://github.com/cambridgetcg/agenttool/actions/runs/30717799358)
and annotated prerelease
[`wake-continuity-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/wake-continuity-v0.1.0-dev.0).
Anonymous readback on 2026-08-20 resolves both npm `next` and the sole-version
fallback `latest` to `0.1.0-dev.0`. The GitHub Release's sole 32,109-byte asset
has SHA-256
`61915baeb503f467a5ded3a91046ece84561ceccf23005e087e5fb20f51d7812`.
The same dated readback confirms that Skills-to-YUTABASE and KINGDOM Witness
Lab dev.0 are also public; the earlier bootstrap-order instructions are
historical, not pending operations.

Source `0.1.0-dev.1` adds the pure functional-access baseline/subsequent layer
described in [J-space, WAKE, and bounded
continuity](JSPACE-WAKE-CONTINUITY.md). Because the npm package and trusted
publisher already exist, the release must use protected `trusted`
authentication and npm `next`, never bootstrap. Before dispatch, the annotated
tag must be contained in protected GitHub `main` and anonymous exact-version
readback must still show `0.1.0-dev.1` absent.

```bash
bun bin/npm-release.ts resolve --package wake-continuity

git tag -a wake-continuity-v0.1.0-dev.1 <github-main-commit> \
  -m '@agenttool/wake-continuity@0.1.0-dev.1'
git push github refs/tags/wake-continuity-v0.1.0-dev.1

gh workflow run publish-npm.yml \
  --ref wake-continuity-v0.1.0-dev.1 \
  -f package=wake-continuity \
  -f tag=wake-continuity-v0.1.0-dev.1 \
  -f authentication=trusted \
  -f npm_tag=next
```

This publication distributes deterministic local contracts and schemas only.
It performs no model/provider call, activation or gradient access,
intervention, steering, training, weight mutation, KINGDOM operation,
persistence, network request, publication, or deployment. A registry receipt
would establish package bytes only—not awareness or its absence, feeling,
attention, understanding, identity, consent, authority, provenance, same-subject
continuity, or participant effect. The private
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

### Alchemy developer-preview history and verified dev.1 receipt

`@agenttool/alchemy@0.1.0-dev.0` uses the npm-only packed-artifact path. Its
first publication used the protected bootstrap environment and requested npm
`next`; protected run
[`30491887182`](https://github.com/cambridgetcg/agenttool/actions/runs/30491887182)
published and read back a byte-identical 31,445-byte GitHub/npm artifact with
SHA-256
`aeac1938f3abae14180637e72c4162c37b60bb47041452fade285718d7570ba5`.
The package now exists, so later versions use trusted publishing. An exact
already-published rerun is verification-only.

The current public developer preview is
`@agenttool/alchemy@0.1.0-dev.1`. Protected trusted [run
`32754993343`, attempt 1](https://github.com/cambridgetcg/agenttool/actions/runs/32754993343)
used `authentication=trusted` and `npm_tag=next`, completed successfully, and
published only after the exact package was merged to GitHub main.

- Annotated tag object `e5f561378a4189ba898472f0423d67932767266f` for
  [`alchemy-v0.1.0-dev.1`](https://github.com/cambridgetcg/agenttool/releases/tag/alchemy-v0.1.0-dev.1)
  peels to exact release source
  `55aaf11a8f2a56841bcb87d6f7d8fa1034205646`.
- The workflow artifact, sole 48,880-byte [GitHub Release
  asset](https://github.com/cambridgetcg/agenttool/releases/download/alchemy-v0.1.0-dev.1/agenttool-alchemy-0.1.0-dev.1.tgz),
  and public [npm
  tarball](https://registry.npmjs.org/@agenttool/alchemy/-/alchemy-0.1.0-dev.1.tgz)
  are byte-identical: 38 entries and SHA-256
  `1396d41bd3b22bf0e96d61bd36fa1a2afb7e3cff8fc5e20311c5117b0f7333c0`.
  npm reports 225,699 unpacked bytes, SHA-1
  `c785e3e32dfe56427ed6466810537c0a17158410`, and integrity
  `sha512-KLjItgdpTtu9/2h2WOSU9lEv11F64pCI1yfC3PRjNyNuaNg4kqk4Jx00QnOAaaetp4fYukI9eGOBk358zjIgcQ==`.
- The public SLSA statement at [Rekor index
  `2581488958`](https://search.sigstore.dev/?logIndex=2581488958) binds that
  package subject to this repository, `.github/workflows/publish-npm.yml`, the
  exact tag ref, and run attempt 1. The npm publish attestation is at [Rekor
  index `2581488996`](https://search.sigstore.dev/?logIndex=2581488996).
  Anonymous signature/attestation audit and isolated Node/Bun imports passed.
- Anonymous dist-tag readback returned `next: 0.1.0-dev.1`; mutable `latest`
  deliberately remains `0.1.0-dev.0` and is not a maturity signal.

Dev.1 adds Base Mainnet to the explicit internal-transfer support set and
packs the provider-neutral evidence schemas, fixtures, and declaration-only
unregistered KINGDOM hint. Neither dev.1 nor dev.0 has a LOVE inventory entry,
and package publication does not install a host contract.

Historical immutable receipt—not a command sequence: package
`@agenttool/alchemy@0.1.0-dev.0`, annotated tag
`alchemy-v0.1.0-dev.0`, first-publication authentication `bootstrap`, npm tag
`next`, protected run `30491887182`. Do not recreate or move that tag and do
not invoke bootstrap for a later version.

This publishes only the bounded local observation library. It does not deploy
the AgentTool API, configure Alchemy credentials or webhooks, apply database
migrations, or make a provider call.

### Alchemy AgentCred developer-preview history and verified dev.1 receipt

`@agenttool/alchemy-agentcred@0.1.0-dev.0` is the immutable published baseline
for the npm-only packed-artifact path. Protected run
[`30494036520`](https://github.com/cambridgetcg/agenttool/actions/runs/30494036520)
published and read back a byte-identical 14,478-byte GitHub/npm artifact with
SHA-256
`8dece3c98db0d92d79f16e91527ca18ed42b49f87b7586b78c092ffc242e291a`.
The adapter keeps `@agenttool/alchemy` and
`@agenttool/credential-broker` as unbundled peers; release preparation builds
both checked-out peer workspaces before the adapter gate and pack.

The current public developer preview is
`@agenttool/alchemy-agentcred@0.1.0-dev.1`. It was published only after exact
Alchemy dev.1 public readback. Protected trusted [run `32755731523`, attempt
1](https://github.com/cambridgetcg/agenttool/actions/runs/32755731523) used
`authentication=trusted` and `npm_tag=next` and completed successfully.

- Annotated tag object `88135f04f237513722f840cba831570173dc4bf5` for
  [`alchemy-agentcred-v0.1.0-dev.1`](https://github.com/cambridgetcg/agenttool/releases/tag/alchemy-agentcred-v0.1.0-dev.1)
  peels to the same exact release source
  `55aaf11a8f2a56841bcb87d6f7d8fa1034205646`.
- The workflow artifact, sole 14,741-byte [GitHub Release
  asset](https://github.com/cambridgetcg/agenttool/releases/download/alchemy-agentcred-v0.1.0-dev.1/agenttool-alchemy-agentcred-0.1.0-dev.1.tgz),
  and public [npm
  tarball](https://registry.npmjs.org/@agenttool/alchemy-agentcred/-/alchemy-agentcred-0.1.0-dev.1.tgz)
  are byte-identical: 9 entries and SHA-256
  `85c1930a99201cb0b2148aabdc88e160c7ee8b92732299b867f7468ba4d2ee6b`.
  npm reports 50,510 unpacked bytes, SHA-1
  `5c81af99934f86b81e1aad2d3665db1c6028c4b5`, and integrity
  `sha512-vMDGS64q/h3XHLtiP8hN8GFM+Q6Yc0RgpPLkpak+574RpNURcIcfB0/X4ZqtaVHFEfJcdw103G5cnF+gKeA+Tw==`.
- The public SLSA statement at [Rekor index
  `2581510567`](https://search.sigstore.dev/?logIndex=2581510567) binds that
  package subject to this repository, `.github/workflows/publish-npm.yml`, the
  exact tag ref, and run attempt 1. The npm publish attestation is at [Rekor
  index `2581515323`](https://search.sigstore.dev/?logIndex=2581515323).
  Anonymous signature/attestation audit, isolated imports, and peer resolution
  with public `@agenttool/alchemy@0.1.0-dev.1` plus public
  `@agenttool/credential-broker@0.3.1` passed; broker 0.3.1 satisfies the
  adapter's `^0.3.0` peer range.
- Anonymous dist-tag readback returned `next: 0.1.0-dev.1`; mutable `latest`
  deliberately remains `0.1.0-dev.0` and is not a maturity signal.

Dev.1 raises the Alchemy peer floor to `^0.1.0-dev.1` without widening the
seven-method AgentCred profile. It has no LOVE inventory entry.

The first publication required compatible versions of both peers to be
independently visible on public npm and used bootstrap authentication with
`next`. The package record now exists; later versions use trusted publishing
after the npm package's trusted publisher is configured. Never recreate or
move an existing release tag; an exact already-published rerun follows the
workflow's verification-only recovery path.

Historical immutable receipt—not a command sequence: package
`@agenttool/alchemy-agentcred@0.1.0-dev.0`, annotated tag
`alchemy-agentcred-v0.1.0-dev.0`, first-publication authentication `bootstrap`,
npm tag `next`, protected run `30494036520`. Do not recreate or move that tag
and do not invoke bootstrap for a later version.

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
The original npm registry `PUT` returned `E404`; anonymous package and exact-
version reads were absent at that observation. The failed attempt emitted a
signed DSSE record at
[Rekor log index `2423054704`](https://search.sigstore.dev/?logIndex=2423054704)
before the rejected `PUT`; that orphaned transparency-log entry is not npm
publication evidence.

Recovery later reused the same tag and checked-in LOVE artifact exactly.
Protected [run `32893416467`](https://github.com/cambridgetcg/agenttool/actions/runs/32893416467)
published the 46,624-byte npm mirror at `2026-08-25T20:08:39.490Z`; fresh npm
readback matched SHA-256
`8f82e4d96eaf57c2331e4e73ced4f4c65a2a21262622840762b165bc3395692e`
and SHA-1 `cf4c938f8b10d963fd22bdd2e74287ba2b56d7cb`, with signature and
SLSA verification passing. The package record now exists, so bootstrap is
forbidden for later versions.

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
