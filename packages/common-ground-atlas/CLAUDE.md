# Common Ground Atlas

This private subtree owns only the deterministic, credential-free generator
and exact public verification material for the static Hugging Face dataset
`Yu-and-Ai/agenttool-common-ground`.

## Invariants

- The package is generator-only. It has no provider client, upload, download,
  model, inference, training, MCP, hosted route, credential, Keychain,
  publication, deployment, or runtime-authority path.
- `src/` and the generator are authoritative. `hf/dataset/` is generated and
  must be byte-deterministic.
- Every mathematical quantity is a canonical rational encoded with decimal
  integer strings. JSON floating-point values never carry proof semantics.
- Source literals also bind their exact IEEE-754 binary64 bits. Exact dyadic
  equality, underflow, and representability refusal are verified rather than
  trusted from labels.
- Every schema closes every object. Runtime verification additionally checks
  rational reduction, uniqueness, cross-references, content digests,
  certificate arithmetic, timestamp state, and the meaning of each closed
  outcome.
- Every public row is synthetic, public-reference-only, and
  `training_eligible: false`. There is no SFT, preference, reward, DPO, or
  sealed-evaluation lane.
- Geometry certifies only the declared model. It never establishes consensus,
  consent, fairness, authority, identity continuity, continuous selection, or
  a culprit.
- Expiry and withdrawal invalidate reuse and leave the affected fact unknown.
  Neither means acceptance, release, compatibility, or permission.
- The dataset contains no personal data, private constraints, real participant
  records, credentials, traces, or copied fictional story text, characters,
  dialogue, or artwork.
- The generated public verifier uses only Python's standard library. Package
  verification independently uses JavaScript BigInt and AJV.
- The hash manifest covers every repository-owned public file except itself.
  The public verifier permits only the Hub's root `.gitattributes` and local
  `.git/` or `.cache/huggingface/` checkout metadata outside that inventory.
- `training_eligible: false` is AgentTool admission metadata, not an added
  copyright restriction. Apache-2.0 governs licensed reuse.

## Verify

```bash
bun install --offline --frozen-lockfile
bun run ci
```

`bun run build:hf` is the only supported rebuild. `bun run check:hf` stages a
fresh tree and compares every byte without rewriting the checked-in dataset.
