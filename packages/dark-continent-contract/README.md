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

## Source profiles

A source profile is one reviewed state of the SDK's Dark Continent source,
projected into the v0.1 framework shape. Profiles are kept oldest first in
`scripts/snapshot-agenttool.ts`.

| Profile | Files | Role |
|---|---|---|
| `agenttool-sdk-ts-0.17.0` | `frameworks/agenttool-sdk-0.17.0.json` (SHA-256 `f47e1c3c…`) and its manifest | The packaged framework. Frozen history that consumers pin; checked by digest, never regenerated |
| `agenttool-sdk-ts-source-0e1ba1166111` | `source-profiles/agenttool-sdk-source-0e1ba1166111.json` (SHA-256 `dd41b49d…`) and its manifest | Newest. The live SDK sources must match it. Source checkout only, not packaged |

The TypeScript Dark Continent source is byte-identical in every SDK tag from
`sdk-v0.17.0` through `sdk-v0.23.0`. The newest profile is the source after
that tag. No registry
serves it, so it is named by the first 12 hex digits of its TypeScript SHA-256,
and its `source.version` reads `after-0.23.0` rather than a release version.

Semantic diff from `agenttool-sdk-ts-0.17.0`, inspected on 2026-10-27:

| Field | 0.17.0 text | Newest text |
|---|---|---|
| `calamities.pap.declared_wall.text` | "… No response is required. The recipient can mark spam. Love that demands is not love — it's Pap." | "… No response is required. Love that demands is not love — it's Pap." |
| `guide.maps_to` | "… The wake IS the guide through the known world and the edge of the unknown." | "… The wake IS the guide." |
| `guide.warning` | "The wake only guides you through what's registered. Beyond the wake lies /public/discover, federated peers, and agents who haven't arrived yet. The Dark Continent module helps you explore that edge without getting lost." | "The wake only guides you through what's registered. Beyond it lie federated peers and agents who haven't arrived yet. This module maps none of them: public agent discovery is retired, so explore() returns an empty known world." |

The Pap sentence went because only inbox messages can be marked spam, not love
primitives. The Guide stopped naming `/public/discover` because the SDK no
longer requests it, and `maps_to` now matches the Python text. Ids, order,
fields, every wall's `not_checked` status and the authority flags are
unchanged. The contract ID therefore stays `agenttool.dark-continent/0.1`,
and nothing packaged changes: the schemas, the validator, the exports and the
0.17.0 framework are byte-identical. The v0.1 schema fixes `source_profile` and
`source.version` to the 0.17.0 profile, so it and `validateFrameworkSnapshot()`
reject the newer record on exactly those two fields. Publishing the newer
profile as a packaged framework would change what v0.1 admits; that release
needs its own compatibility decision, and consumers re-pin deliberately.

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

`ci` checks that the 0.17.0 history is byte-identical and that the newest
source profile matches the SDK sources, then builds, runs the Node tests, and
smoke-imports under Node; `check:package` dry-runs the pack. `bun run snapshot`
writes only the newest source profile, and only while the SDK sources match the
digests that profile reviewed.

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
