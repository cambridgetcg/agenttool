# AgentTool

AgentTool is a collection of independent tools and protocols for software
agents and the people who run them: SDKs for TypeScript and Python, local
coordination, credential, browser and discovery tools, data and archive
protocols, and research packages. This repository is where their shared
source is developed in the open.

Each part can be used on its own. A local tool does not need an AgentTool
account, and reading this repository creates no task and assigns no role.

## What is here

- [`packages/`](packages): each directory is an independent package with its
  own README, lockfile and test gate. A package's README says what it does,
  what is implemented and what is still a proposal.
- [`docs/specs/`](docs/specs) and a few documents under [`docs/`](docs):
  specifications and test vectors that package tests read.
- [`review/provider-adapters/v1/`](review/provider-adapters/v1): the
  provider-adapter review packet that the SDK tests compare against.
- [`bin/npm-release.ts`](bin/npm-release.ts) and
  [`bin/build-love-packages.ts`](bin/build-love-packages.ts): the npm release
  policy and its archive inspector.
- [`tools/public-guard.ts`](tools/public-guard.ts): the guard that CI runs over
  every commit.

Other parts of AgentTool, such as the hosted API and the web surfaces, are not
in this repository yet. A path that is absent here is not maintained here.

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
install those siblings first. [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
shows the full order.

The Python SDK uses Python 3.9 or newer:

```sh
cd packages/sdk-py
python -m pip install '.[dev]'
python -m pytest -q
```

## Checks

CI runs every package's gate, the Python SDK on each supported interpreter,
and the public guard:

```sh
bun tools/public-guard.ts --tree --rev HEAD
```

The guard reads the committed tree, not the working tree. It refuses
credential-shaped content, personal paths and addresses, unexpected binary
files, symlinks, and a history with more than one root commit. Known false
positives are recorded in [`tools/public-guard-allow.json`](tools/public-guard-allow.json)
and [`.gitleaksignore`](.gitleaksignore) by line digest, never by their text.

## Releases

A version in a `package.json` or `pyproject.toml` is the source identity. It
can be ahead of what a registry serves. npm packages are published through the
release repository
[`cambridgetcg/agenttool-packages`](https://github.com/cambridgetcg/agenttool-packages),
which holds the same package source; each release there is staged on npm with
provenance and approved by a maintainer. A merged change here reaches a
registry only through a later release.

## Contributing

Pull requests are welcome. Keep a change small and focused, run the gate of
each package you touch, and expect CI to run on the pull request. Do not put
credentials, access tokens or personal data in code, tests, commit messages or
pull request text. Report a suspected vulnerability privately, as
[`SECURITY.md`](SECURITY.md) describes, and never in an issue or pull request.

A contribution is accepted under the licence of the files it changes: by
default the Apache License, Version 2.0, as for the rest of the repository.

## Licence

Apache-2.0 unless a file or package says otherwise. See
[`LICENSING.md`](LICENSING.md).
