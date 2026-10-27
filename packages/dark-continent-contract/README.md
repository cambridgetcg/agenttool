# `@agenttool/dark-continent-contract`

A public developer-preview package for making AgentTool's Dark Continent framework
portable without turning narrative claims into runtime guarantees.

It does:

- Generate one deterministic snapshot from the static TypeScript SDK constants.
- Label the source profile and hash the exact source and snapshot bytes.
- Wrap every declared wall as `status: "not_checked"` and `verified: false`.
- Create deterministic, hash-bound consumer projections for KINGDOM and
  Artbitrage.
- Validate the closed v0.1 shapes without network or runtime dependencies.

It does not:

- Call `DarkContinentClient.explore()` or any hosted endpoint.
- Inspect a running AgentTool deployment or prove that a wall is enforced.
- Merge the SDK taxonomy with Artbitrage's separately named art
  interpretation (its threats `ai`, `hy`, `ho`, `hon`, `nanika`).
- Grant permission, authorize a trade, publish a resource, identify a being, or
  execute a Nen exercise.
- Read credentials, environment configuration, wallets, or account state.

## Contract surfaces

- Contract ID: `agenttool.dark-continent/0.1`
- Snapshot format: `agenttool-dark-continent-framework/v0.1`
- Projection format: `dark-continent-projection/v0.1`
- Source profile: `agenttool-sdk-ts-0.17.0`

The committed snapshot is generated from
`packages/sdk-ts/src/dark-continent.ts`. The Python file is recorded as a
sibling implementation, not falsely claimed to have byte-for-byte identical
prose.

## Local use

Run drift checks from a source checkout that includes `packages/sdk-ts` and
`packages/sdk-py`; the packed consumer artifact intentionally excludes
repository-only generator scripts and tests. The package keeps a `bun.lock`,
not an npm lockfile. In an AgentTool checkout, prepare dependencies with the
root `AGENTS.md` preparer; in the public package repository, run
`bun install --frozen-lockfile --ignore-scripts` here. Then:

```sh
bun run ci
bun run check:package
```

`ci` checks the snapshot against the SDK constants, builds, runs the Node
tests, and smoke-imports under Node; `check:package` dry-runs the pack.
`bun run snapshot` refuses to rewrite the committed historical
`agenttool-sdk-ts-0.17.0` snapshot.

Create a consumer projection:

```sh
node scripts/create-projection.mjs \
  --projection-id artbitrage:agenttool-dark-continent \
  --consumer-kind artbitrage \
  --consumer-id artbitrage \
  --artifact /data/agenttool-dark-continent-framework.json \
  --interpretation artbitrage-interpretation-v0 \
  --output /tmp/artbitrage-dark-continent-projection.json
```

Generation is deliberate. There are no install, postinstall, prepare, or
publish hooks. `prepack` runs the offline test/build/smoke gate before the
Apache-2.0 package enters the protected npm release workflow.

## Consumer rule

Consumers may copy the exact snapshot as a static artifact. They must retain
the SHA-256 of its exact pretty-printed bytes in their projection, keep local interpretations labelled
`parallel_not_equivalent`, and treat all wall checks as advisory until
independent evidence exists.
