# DeepSeek to KINGDOM proposal adapter

This package turns exact caller-supplied DeepSeek primary-source metadata into
content-addressed, unaccepted KINGDOM research proposals. It is a pure offline
adapter and must remain isolated from model and provider runtimes.

## Boundaries

- Keep runtime dependencies at zero and public functions deterministic.
- Do not add network, filesystem, environment, credential, inference, remote
  compute, download, upload, publication, deployment, registry, graph-write,
  score, reward, or authority paths.
- Accept only full Git/Hugging Face commit revisions or versioned arXiv IDs,
  plus exact source-byte SHA-256 values.
- Treat source association, card fields, claim summaries, and license labels as
  caller-supplied assertions. A digest proves only byte identity when those
  bytes are independently retained and checked.
- Keep license evidence separate by asset scope. Apache-2.0 applies only to
  this adapter; it does not replace or approve upstream code, model, dataset,
  or paper terms.
- Preserve the fixed Dark Continent `not_checked`/`hold` projection. Never
  convert a source lead into a passed wall, accepted KARMA graph mutation, or
  KINGDOM registration.
- Keep the AFTERGLOW crossover structural and digest-only. It may validate one
  exact unaccepted proposal and derive one opaque thread reference; it must not
  accept a caller label, create a capsule, choose a WAKE anchor or predecessor,
  project a lens, or claim memory, identity, consent, permission, or authority.
- Do not add a runtime dependency on `@agenttool/wake-continuity` or duplicate
  its schema. Its capsule validator remains the composition authority.
- Keep the bundled source catalog metadata-only, primary-source-only, pinned,
  and explicitly dated. Refreshing it requires deliberate source review and
  exact digest updates.
- Keep schemas structurally closed and keep runtime hash/cross-reference tests
  as the semantic authority.

## Verification

```sh
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts --json
```

Publication, release wiring, hosted routes, and Hugging Face deployment are
outside this package.
