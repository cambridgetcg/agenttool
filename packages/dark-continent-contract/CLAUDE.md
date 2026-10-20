# Dark Continent contract package

This package turns one existing SDK source profile into deterministic,
advisory data. It is not a hosted client and must stay safe to run offline.

## Boundaries

- Keep the public artifact Apache-2.0, zero-dependency, and release it only
  through the repository's protected npm workflow.
- Keep runtime dependencies at zero.
- Do not add install hooks, ambient credential reads, account discovery,
  network calls, model execution, wallet operations, or transaction code.
- Generate only from the TypeScript SDK static constants. Do not ingest
  `bin/dark-continent.ts`, HTML lore, or Artbitrage's parallel interpretation.
- Never turn a declared wall into a verified claim. In v0.1 every wall remains
  `status: "not_checked"`, `verified: false`, with no evidence references.
- Contract bytes are deterministic: no timestamps, absolute paths, hostnames,
  current branch names, or mutable remote revisions.

## Verification

Prepare dependencies with the root `AGENTS.md` preparer (the package keeps a
`bun.lock`, not an npm lockfile), then run here:

```sh
bun run ci
bun run check:package
```

`ci` checks the snapshot against the SDK constants, builds, runs the Node
tests, and smoke-imports under Node; `check:package` dry-runs the pack.

The committed snapshot is the historical `agenttool-sdk-ts-0.17.0` source
profile. `check:snapshot` fails when the TypeScript or Python Dark Continent
source drifts from it, and `bun run snapshot` refuses to rewrite it because the
SDK package is no longer that 0.17.0 input. A real constants change needs a
reviewed new source profile in `scripts/snapshot-agenttool.ts`, an inspected
semantic diff, and a new contract version when compatibility requires it.
