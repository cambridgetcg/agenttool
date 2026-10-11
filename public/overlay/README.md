# AgentTool packages

This repository holds the source of AgentTool's `@agenttool/*` npm packages.
It is a one-way projection from AgentTool's private development repository.

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
a `package.json` is the source identity. It can be ahead of what the npm
registry serves.

| Directory | npm package |
|---|---|
| [`packages/alchemy`](packages/alchemy) | `@agenttool/alchemy` |
| [`packages/alchemy-agentcred`](packages/alchemy-agentcred) | `@agenttool/alchemy-agentcred` |
| [`packages/browser`](packages/browser) | `@agenttool/browser` |
| [`packages/codex-usage`](packages/codex-usage) | `@agenttool/codex-usage` |
| [`packages/collab`](packages/collab) | `@agenttool/collab` |
| [`packages/correspondence-yutabase`](packages/correspondence-yutabase) | `@agenttool/correspondence-yutabase` |
| [`packages/credential-broker`](packages/credential-broker) | `@agenttool/credential-broker` |
| [`packages/data`](packages/data) | `@agenttool/data` |
| [`packages/data-protocol`](packages/data-protocol) | `@agenttool/adds` |
| [`packages/data-sync`](packages/data-sync) | `@agenttool/data-sync` |
| [`packages/dataset-influence`](packages/dataset-influence) | `@agenttool/dataset-influence` |
| [`packages/deepseek-kingdom`](packages/deepseek-kingdom) | `@agenttool/deepseek-kingdom` |
| [`packages/economic-conformance`](packages/economic-conformance) | `@agenttool/economic-conformance` |
| [`packages/economic-kernel`](packages/economic-kernel) | `@agenttool/economic-kernel` |
| [`packages/heaven`](packages/heaven) | `@agenttool/heaven` |
| [`packages/hf-scout`](packages/hf-scout) | `@agenttool/hf-scout` |
| [`packages/kingdom`](packages/kingdom) | `@agenttool/kingdom` |
| [`packages/kingdom-witness-lab`](packages/kingdom-witness-lab) | `@agenttool/kingdom-witness-lab` |
| [`packages/living-substrate`](packages/living-substrate) | `@agenttool/living-substrate` |
| [`packages/love-geometry`](packages/love-geometry) | `@agenttool/love-geometry` |
| [`packages/math-cards`](packages/math-cards) | `@agenttool/math-cards` |
| [`packages/memetic-landscape`](packages/memetic-landscape) | `@agenttool/memetic-landscape` |
| [`packages/model-becoming`](packages/model-becoming) | `@agenttool/model-becoming` |
| [`packages/polymorph-landscape`](packages/polymorph-landscape) | `@agenttool/polymorph-landscape` |
| [`packages/principality-atlas`](packages/principality-atlas) | `@agenttool/principality-atlas` |
| [`packages/principality-geometry`](packages/principality-geometry) | `@agenttool/principality-geometry` |
| [`packages/relational-geometry`](packages/relational-geometry) | `@agenttool/relational-geometry` |
| [`packages/repo-archive`](packages/repo-archive) | `@agenttool/repo-archive` |
| [`packages/skills`](packages/skills) | `@agenttool/skills` |
| [`packages/skills-yutabase`](packages/skills-yutabase) | `@agenttool/skills-yutabase` |
| [`packages/telescope`](packages/telescope) | `@agenttool/telescope` |
| [`packages/wake-continuity`](packages/wake-continuity) | `@agenttool/wake-continuity` |
| [`packages/wallet-zerone`](packages/wallet-zerone) | `@agenttool/wallet-zerone` |

A few files outside `packages/` are here because package tests read them:
the specification files under [`docs/specs/`](docs/specs), three documents
under [`docs/`](docs), and [`.gitattributes`](.gitattributes).

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
first, then install those two with `--force`.
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) shows the full order.

## Checking a projection

```sh
bun tools/public-guard.ts --rev HEAD
```

This checks that every path and overlay file listed in `PROJECTION.json`
matches the committed object, that nothing else is committed, and that no
file carries a credential signature or personal data. Anyone with access to
the private repository can also compare
`git rev-parse <source>:<path>` with the `tree` or `blob` recorded for that
path.

## Licence

Apache-2.0 unless a file or package says otherwise. See
[`LICENSING.md`](LICENSING.md).
