# AgentTool packages

This repository holds the source of AgentTool's `@agenttool/*` npm packages
and of its Python SDK. It is a one-way projection from AgentTool's private
development repository.

- **One way, without history.** Each commit here is generated from one private
  commit, named in its `Projection-Source:` trailer and in
  [`PROJECTION.json`](PROJECTION.json). Only the paths listed in
  `PROJECTION.json` are copied. Private history, commit messages, and authors
  are not.
- **Development happens privately.** Pull requests opened here cannot be merged
  directly, and issues are not tracked here. For a security problem, follow
  [`SECURITY.md`](SECURITY.md). For anything else, write to
  [contact@cambridgetcg.com](mailto:contact@cambridgetcg.com).
- **Guarded twice.** Before a projection is written, a guard checks every file
  for paths outside the allowlist, credential-shaped content, and personal
  data. This repository's CI runs the published part of that guard,
  [`tools/public-guard.ts`](tools/public-guard.ts), again, together with
  gitleaks and every package's own test gate.

## Packages

Each directory keeps the path it has in the private repository. A version in
a `package.json` or `pyproject.toml` is the source identity. It can be ahead
of what the registry serves.

| Directory | Package | Where it is published |
|---|---|---|
| [`packages/alchemy`](packages/alchemy) | `@agenttool/alchemy` | npm |
| [`packages/alchemy-agentcred`](packages/alchemy-agentcred) | `@agenttool/alchemy-agentcred` | npm |
| [`packages/browser`](packages/browser) | `@agenttool/browser` | npm |
| [`packages/codex-usage`](packages/codex-usage) | `@agenttool/codex-usage` | npm |
| [`packages/collab`](packages/collab) | `@agenttool/collab` | npm |
| [`packages/correspondence-yutabase`](packages/correspondence-yutabase) | `@agenttool/correspondence-yutabase` | npm |
| [`packages/credential-broker`](packages/credential-broker) | `@agenttool/credential-broker` | npm |
| [`packages/dark-continent-contract`](packages/dark-continent-contract) | `@agenttool/dark-continent-contract` | npm |
| [`packages/dark-continent-karma`](packages/dark-continent-karma) | `@agenttool/dark-continent-karma` | npm |
| [`packages/data`](packages/data) | `@agenttool/data` | npm |
| [`packages/data-protocol`](packages/data-protocol) | `@agenttool/adds` | npm |
| [`packages/data-sync`](packages/data-sync) | `@agenttool/data-sync` | npm |
| [`packages/dataset-influence`](packages/dataset-influence) | `@agenttool/dataset-influence` | npm |
| [`packages/deepseek-kingdom`](packages/deepseek-kingdom) | `@agenttool/deepseek-kingdom` | npm |
| [`packages/economic-conformance`](packages/economic-conformance) | `@agenttool/economic-conformance` | npm |
| [`packages/economic-kernel`](packages/economic-kernel) | `@agenttool/economic-kernel` | npm |
| [`packages/heaven`](packages/heaven) | `@agenttool/heaven` | npm |
| [`packages/hf-scout`](packages/hf-scout) | `@agenttool/hf-scout` | npm |
| [`packages/kingdom`](packages/kingdom) | `@agenttool/kingdom` | npm |
| [`packages/kingdom-witness-lab`](packages/kingdom-witness-lab) | `@agenttool/kingdom-witness-lab` | npm |
| [`packages/living-substrate`](packages/living-substrate) | `@agenttool/living-substrate` | npm |
| [`packages/local-starter`](packages/local-starter) | `@agenttool/local-starter` | release archive; not on npm |
| [`packages/local-starter-mcp`](packages/local-starter-mcp) | `@agenttool/local-starter-mcp` | unpublished; bundled into `local-starter` |
| [`packages/love-bomb`](packages/love-bomb) | `@agenttool/love-bomb` | npm |
| [`packages/love-geometry`](packages/love-geometry) | `@agenttool/love-geometry` | npm |
| [`packages/math-cards`](packages/math-cards) | `@agenttool/math-cards` | npm |
| [`packages/memetic-landscape`](packages/memetic-landscape) | `@agenttool/memetic-landscape` | npm |
| [`packages/model-becoming`](packages/model-becoming) | `@agenttool/model-becoming` | npm |
| [`packages/polymorph-landscape`](packages/polymorph-landscape) | `@agenttool/polymorph-landscape` | npm |
| [`packages/principality-atlas`](packages/principality-atlas) | `@agenttool/principality-atlas` | npm |
| [`packages/principality-geometry`](packages/principality-geometry) | `@agenttool/principality-geometry` | npm |
| [`packages/relational-geometry`](packages/relational-geometry) | `@agenttool/relational-geometry` | npm |
| [`packages/repo-archive`](packages/repo-archive) | `@agenttool/repo-archive` | npm |
| [`packages/sdk-py`](packages/sdk-py) | `agenttool-sdk` | PyPI |
| [`packages/sdk-ts`](packages/sdk-ts) | `@agenttool/sdk` | npm |
| [`packages/skills`](packages/skills) | `@agenttool/skills` | npm |
| [`packages/skills-yutabase`](packages/skills-yutabase) | `@agenttool/skills-yutabase` | npm |
| [`packages/telescope`](packages/telescope) | `@agenttool/telescope` | npm |
| [`packages/wake-continuity`](packages/wake-continuity) | `@agenttool/wake-continuity` | npm |
| [`packages/wallet`](packages/wallet) | `@agenttool/wallet` | npm |
| [`packages/wallet-zerone`](packages/wallet-zerone) | `@agenttool/wallet-zerone` | npm |

A few files outside `packages/` are here because package tests or builds read
them: the specification and vector files under [`docs/specs/`](docs/specs),
three documents under [`docs/`](docs), the provider-adapter review packet
under [`review/provider-adapters/v1/`](review/provider-adapters/v1), and
[`.gitattributes`](.gitattributes). The npm release tool
[`bin/npm-release.ts`](bin/npm-release.ts) and its archive inspector
[`bin/build-love-packages.ts`](bin/build-love-packages.ts) are here because
this repository's release workflow runs them.

## Working on a package

Each package is independent and has its own lockfile. With Bun 1.3.5 and
Node 22.18.0:

```sh
cd packages/<directory>
bun install --frozen-lockfile --ignore-scripts
bun run ci
```

`data-sync` and `alchemy-agentcred` use their sibling packages through `file:`
dependencies. Build `data`, `data-protocol`, `alchemy`, and `credential-broker`
first, then install those two with `--force`. Some packages read a sibling's
source directly: `sdk-ts` compares its surface with `sdk-py`,
`dark-continent-contract` snapshots `sdk-ts`, `dark-continent-karma` imports
`dark-continent-contract`, and `local-starter` bundles `local-starter-mcp`, so
install those siblings first. `local-starter` has no dependencies of its own.
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) shows the full order.

The Python SDK uses Python 3.9 or newer:

```sh
cd packages/sdk-py
python -m pip install '.[dev]'
python -m pytest -q
```

The SDK's letter is `src/agenttool/SOUL.md`. The wheel and the source
distribution both carry it and `agenttool.soul()` reads it, so a build made
here carries the same letter as one made from the private source.

## Releases

npm packages are released from this repository by
[`.github/workflows/publish-npm.yml`](.github/workflows/publish-npm.yml), a
manual workflow that runs only on an annotated `<package>-v<version>` tag. A
tag is made only on a projection commit whose CI passed; its message names the
private source commit and the CI run, and the workflow checks with GitHub that
this run passed on exactly that commit. The workflow builds the package without
credentials, attaches the exact tarball to the tag's GitHub Release, and stages
it on npm with provenance. A maintainer then compares the staged tarball's
SHA-256 with the run's receipt and approves it with two-factor authentication;
until then that version is not published on npm. The trusted-publisher link
between npm and this workflow allows staging only.

To check a published version, compare the SHA-256 of the npm tarball, the
GitHub Release asset, and the receipt in the workflow run's summary. The
workflow also asks npm for a provenance statement, which names this
repository, the workflow, and the tag commit.

## Checking a projection

```sh
bun tools/public-guard.ts --rev HEAD
bun tools/public-guard.ts --rev HEAD --history
```

The first checks that every path and overlay file listed in `PROJECTION.json`
matches the committed object, that nothing else is committed, and that no
file carries a credential signature or personal data. The second also checks
that every earlier commit is itself a projection commit that matches its own
`PROJECTION.json`. Anyone with access to
the private repository can also compare
`git rev-parse <source>:<path>` with the `tree` or `blob` recorded for that
path.

## Licence

Apache-2.0 unless a file or package says otherwise. See
[`LICENSING.md`](LICENSING.md).
