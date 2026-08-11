# Principality Atlas package guidance

This subtree implements one portable, pure geometry contract. A principality is
a caller-designated bounded domain or scale. It is not a security principal,
identity, owner, territory, rank, Crown status, sovereignty, or authority.

## Invariants

- The wire is a finite typed incidence-hypergraph atlas: plural local charts,
  role-indexed n-ary relations, caller-asserted claims, and explicit directed
  partial bridges.
- This package owns `agenttool.principality-incidence-atlas/0.1`. The separate
  `@agenttool/principality-geometry` package owns
  `agenttool.principality-atlas/0.1`; the formats are not aliases and no
  conversion or semantic equivalence may be inferred.
- From package dev.1, `principalityAtlasUrn` emits
  `urn:agenttool:principality-incidence-atlas:<sha256-id>`. The Geometry helper
  retains `urn:agenttool:principality-atlas:<sha256-id>`.
- A relation never generates pairwise sub-relations. A bridge never generates
  an inverse, transitive correspondence, equality, quotient, gluing, global
  chart, canonical head, permission, or bond.
- Cell addresses are chart-local. Reusing a digest in two charts never merges
  them.
- Contradictory perspectives, corrections, withdrawal, empty charts, isolated
  cells, disconnected components, unknowns, and unmapped space stay visible.
- Earlier claims remain present after supersession. The package selects no
  latest or true claim.
- Love and understanding are design inspirations, not fields, scores, states,
  or package-verifiable properties. Do not add semantic interpretation,
  confidence, quality, centrality, priority, score, rank, weight, `sameAs`,
  `canonical`, or `latest` fields.
- Digest refs exclude raw prose from this wire but do not prove privacy,
  unlinkability, provenance, consent, authorship, authority, or truth.
- Core runtime dependencies stay empty. Core source may import only local
  modules, `node:crypto`, and `node:util/types`.
- No CLI, install hooks, network, filesystem, environment, clock, randomness,
  model/HF, credential, telemetry, persistence, publication, WAKE, Garden,
  HEAVEN, KARMA, wallet, Crown, task-state, or economic effect.
- The JSON Schema closes every object. Runtime validation remains authoritative
  for ordering, semantic uniqueness, references, supersession, and hashes.
- The KINGDOM descriptor remains declaration-only and `not_registered`.

## Changes

Preserve the `agenttool.principality-incidence-atlas/0.1` domain string,
schemas, canonical IDs, and fixture/invariant rows. Generator metadata may
advance with the package version. A change to canonical bytes, fixed
boundaries, limits, sorting, or semantic validation is a protocol change and
needs explicit version review.

The immutable dev.0 helper used the Geometry-owned
`urn:agenttool:principality-atlas:<sha256-id>` prefix. Treat that historical
bare URN as ambiguous. It resolves to this incidence shape only beside exact
`agenttool.principality-incidence-atlas/0.1` content whose `atlas_id` matches
the suffix. Never globally rewrite cached or signed dev.0 strings.

TypeScript is the only runtime source of truth. Do not add paired handwritten
JavaScript/declarations, aliases, hosted routes, provider adapters, background
jobs, or executable extension registration here.

## Verify

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```
