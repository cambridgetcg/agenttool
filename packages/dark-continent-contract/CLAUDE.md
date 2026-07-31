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

Run:

```sh
npm ci --ignore-scripts
bun run check:snapshot
node --test tests/*.test.mjs
bun run ci
npm pack --dry-run --ignore-scripts
```

If the SDK constants change, regenerate deliberately with `bun run snapshot`,
inspect the semantic diff, and update the contract version when compatibility
requires it.
