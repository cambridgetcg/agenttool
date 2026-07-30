# `@agenttool/dark-continent-contract`

A private development package for making AgentTool's Dark Continent framework
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
- Merge the SDK taxonomy with the separate legacy CLI, docs, or Artbitrage
  interpretations.
- Grant permission, authorize a trade, publish a resource, identify a being, or
  execute a Nen exercise.
- Read credentials, environment configuration, wallets, or account state.

## Contract surfaces

- Contract ID: `agenttool.dark-continent/0.1`
- Snapshot format: `agenttool-dark-continent-framework/v0.1`
- Projection format: `dark-continent-projection/v0.1`
- Source profile: `agenttool-sdk-ts-0.16.0`

The committed snapshot is generated from
`packages/sdk-ts/src/dark-continent.ts`. The Python file is recorded as a
sibling implementation, not falsely claimed to have byte-for-byte identical
prose.

## Local use

Run generation and drift checks from an AgentTool source checkout; the packed
consumer artifact intentionally excludes repository-only generator scripts and
tests.

```sh
npm ci --ignore-scripts
bun run snapshot
bun run check:snapshot
node --test tests/*.test.mjs
npm pack --dry-run --ignore-scripts
```

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
publish hooks, and the package remains `private`.

## Consumer rule

Consumers may copy the exact snapshot as a static artifact. They must retain
the SHA-256 of its exact pretty-printed bytes in their projection, keep local interpretations labelled
`parallel_not_equivalent`, and treat all wall checks as advisory until
independent evidence exists.
