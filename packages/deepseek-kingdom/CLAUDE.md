# DeepSeek to KINGDOM proposal adapter

This package turns exact caller-supplied DeepSeek primary-source metadata into
content-addressed, unaccepted KINGDOM research proposals. It is a pure offline
adapter and must remain isolated from model and provider runtimes.

## Boundaries

- Keep runtime dependencies at zero and public functions deterministic. The
  only runtime built-ins are `node:crypto` and the zero-trap Proxy fence from
  `node:util/types`.
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
- Keep canonical intake descriptor-only and finite. Plain/null-prototype
  objects and standard dense arrays may contain only own enumerable data
  properties; never call an input getter, index accessor, array method, or
  inherited behavior. Preserve the closed 64-by-64 proposal maximum when
  changing depth, node, string, aggregate-input, or canonical-byte bounds.
- Apply cheap string-length and array-length lower bounds before scanning or
  enumerating. Capture one unavoidable own-key list, enforce its cap, and only
  then fetch individual descriptors; do not materialize an unbounded
  all-descriptors map or embed unvalidated keys in diagnostics.
- Fence direct, nested, function, revoked, and byte-helper Proxy values with
  `node:util/types.isProxy` before array, prototype, descriptor, freeze, or
  hash-input reflection. Keep zero-trap Node and Bun regressions. This is a
  supported runtime boundary, not a portable JavaScript guarantee; another
  runtime must prove an equivalent fence before making the same claim.
- Keep byte hashing limited to strings and genuine `Uint8Array` values. Copy
  bytes through the intrinsic typed-array internal-slot path before hashing;
  never consume caller iterators or byte-property getters.
- Runtime-type-check and Proxy-fence public domain and Unicode-ordering string
  helpers before regex or iterator use.
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
