# Dark Continent contract package

This package turns one existing SDK source profile into deterministic,
advisory data. It is not a hosted client and must stay safe to run offline.

## Boundaries

- Keep the public artifact Apache-2.0, zero-dependency, and release it only
  through the repository's protected npm workflow.
- Keep runtime dependencies at zero.
- Do not add install hooks, ambient credential reads, account discovery,
  network calls, model execution, wallet operations, or transaction code.
- Generate only from the TypeScript SDK static constants. Do not ingest HTML
  lore or Artbitrage's separately named interpretation.
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

`ci` checks the source profiles, builds, runs the Node tests, and smoke-imports
under Node; `check:package` dry-runs the pack.

The packaged snapshot is the historical `agenttool-sdk-ts-0.17.0` source
profile; consumers pin its bytes, so it is checked by digest and never
regenerated. The newest reviewed profile lives in `source-profiles/`, outside
the package, and `check:snapshot` fails when the TypeScript or Python Dark
Continent source drifts from it. A source change needs a reviewed new profile
in `scripts/snapshot-agenttool.ts` (pinned digests, a label that implies no
release, the declared semantic diff), the diff recorded in the README, and a new
contract version when compatibility requires it. The script refuses structural
changes, which always need that contract decision.
