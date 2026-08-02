# Living Substrate package guidance

This subtree implements a portable, pure contract. Keep it smaller than any
hosted Garden, remediation engine, agent runtime, or ontology.

## Invariants

- `LivingSubstrateMap` contains only bounded caller-supplied digest topology.
- Ecological vocabulary is a structural metaphor, never life, consciousness,
  health, readiness, safety, or truth proof.
- Facet conditions remain caller-reported. Do not infer, summarize, diagnose,
  prioritize, score, rank, or recommend.
- `RegenerationProposal` contains only caller-supplied actions. Do not
  synthesize, select, accept, dispatch, retry, or execute actions.
- Every action stays `proposed_unaccepted` and
  `separate_authority_required`.
- Zero actions, rest, fallow, doing nothing, deferral, refusal, release, and
  leaving remain valid without explanation or penalty.
- Money and resource accumulation are never goals, worth, ranks, or scores.
- Core runtime dependencies stay empty. Core source may import only local
  modules, `node:crypto`, and `node:util/types`.
- No CLI, install hooks, network, filesystem, environment, clock, randomness,
  model/HF, credential, telemetry, persistence, hosted, task, wallet, KARMA,
  Chronicle, WAKE, HEAVEN, publication, or economic effect.
- Schemas close every object. Runtime validation remains authoritative for
  canonical order, semantic uniqueness, references, and hashes.
- Content hashes do not prove privacy, unlinkability, provenance, consent,
  authorship, authority, currentness, safety, or truth.
- The KINGDOM descriptor remains declaration-only and `not_registered`.

## Changes

Preserve the domain strings and pinned vectors. A change to canonical bytes,
vocabulary, fixed boundaries, limits, sorting, or semantic validation is a
protocol change and needs explicit version review.

Use TypeScript as the only source of truth. Do not add handwritten paired
JavaScript/declarations, alternate package entry points, compatibility aliases,
host routes, background jobs, or generated runtime configuration here.

## Verify

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```
