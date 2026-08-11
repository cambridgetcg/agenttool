# @agenttool/principality-atlas

`@agenttool/principality-atlas` is a zero-runtime-dependency TypeScript contract
for preserving plural, partial perspectives as deterministic finite geometry.

It builds a typed incidence-hypergraph atlas from caller-supplied digest refs:

- chart-local opaque cells;
- genuine unary or n-ary relations with an explicit role for every incidence;
- separate caller-asserted claims, including disagreement and withdrawal;
- explicit directed, partial bridges between charts.

“Principality” means only a caller-designated bounded domain or scale. It does
not mean a security principal, identity, owner, territory, rank, Crown status,
sovereignty, or authority.

## Geometry without collapse

The contract takes two high-level patterns seriously without pretending to
measure them:

> Connection can add structure between distinct terms without fusing them or
> creating entitlement.

> Every chart is partial; translation is explicit and lossy by default, while
> disagreement and unmapped space remain visible.

That shape can be useful for LOVE- and Understanding-inspired architecture,
but the artifact contains no `love`, `understanding`, confidence, quality,
centrality, priority, score, rank, weight, `sameAs`, canonical, or latest field.
It does not prove a feeling, inner state, identity, consent, truth, authorship,
authority, consciousness, or rights compliance.

## Why an incidence hypergraph

A simplicial complex would add every lower-dimensional face. Representing one
A/B/C context as a simplex would therefore invent AB, AC, and BC pairwise
relations. This package instead keeps one A/B/C report as exactly one n-ary
relation.

A bridge is a partial relation between chart-local cells. It is not equality, a
function, a bijection, an equivalence relation, a permission grant, or a bond.
The package generates no inverse, transitive closure, quotient, glued chart,
global view, or canonical head.

```text
Chart A                    Chart B
  cells                      cells
  n-ary relations            n-ary relations
  plural claims              plural claims
       │
       └── explicit directed partial bridge ──▶
           correspondence ≠ equality
           unmapped space stays visible
```

Cell and relation refs are chart-local addresses. The same digest appearing in
two charts does not merge them. Contradictory claims can coexist. A correction
may point to one earlier same-subject, same-perspective claim, but the earlier
claim remains present and the package selects no “latest truth.”

Empty atlases, empty charts, isolated cells, disconnected components, cyclic
relation topology, zero bridges, unknowns, and unmapped cells are valid. The
finite per-array limits are a parsing and resource-safety envelope, not a
normative limit on movement, participation, perspective, or existence. Global
canonical depth, node, string, and byte ceilings apply to the combined shape
and may bind before every nested array reaches its own maximum. Any number of
independent atlas artifacts may coexist, and none is made canonical.

## Create an atlas

```ts
import {
  createPrincipalityAtlas,
  sha256Id,
} from "@agenttool/principality-atlas";

const a = sha256Id("high-entropy local cell token:a");
const b = sha256Id("high-entropy local cell token:b");
const c = sha256Id("high-entropy local cell token:c");

const atlas = createPrincipalityAtlas({
  scope_ref: sha256Id("high-entropy local scope token"),
  charts: [{
    chart_ref: sha256Id("chart token"),
    principality_ref: sha256Id("bounded domain token"),
    perspective_ref: sha256Id("perspective token"),
    cells: [a, b, c].map((cell_ref, index) => ({
      cell_ref,
      kind_ref: sha256Id(`opaque local kind token:${String(index)}`),
    })),
    relations: [{
      relation_ref: sha256Id("one ternary relation token"),
      kind_ref: sha256Id("opaque relation kind token"),
      incidences: [
        { cell_ref: a, role_ref: sha256Id("role:a") },
        { cell_ref: b, role_ref: sha256Id("role:b") },
        { cell_ref: c, role_ref: sha256Id("role:c") },
      ],
    }],
    claims: [],
  }],
  bridges: [],
});

atlas.coverage; // "bounded_not_complete"
atlas.boundaries.infers_pairwise_relations; // false
atlas.boundaries.proves_love; // false
atlas.boundaries.proves_understanding; // false
```

Input order is normalized. Arrays are copied, deep-frozen, and bound by a
domain-separated SHA-256 content ID. Runtime validation checks closed shape,
canonical order, local endpoints, semantic duplicates, bridge direction,
mapped/unmapped conflicts, same-subject same-perspective acyclic supersession,
fixed negative boundaries, and the content ID.

Digest refs can still reveal or link guessable, identity-bearing, or reused
material. Use reviewed exact bytes or high-entropy local tokens and keep any
private ref mapping outside public artifacts.

## Portable evidence

The package ships:

- `atlas.schema.json` — the closed Draft 2020-12 atlas wire;
- `fixture.schema.json` and `invariant.schema.json` — closed synthetic evidence
  rows;
- `vectors/agenttool-principality-atlas-v0.1.json` — three valid synthetic
  examples and ten explicit non-inference boundaries;
- `kingdom.extension.json` — a declaration-only, unregistered extension hint.

The synthetic rows can be projected into the existing HF Training Garden for
Dataset Viewer, Parquet, Croissant, and exact-revision discovery. That companion
is a separate evidence plane: a Hub commit distributes bytes but cannot certify
that the geometry is loving, understood, consensual, true, private, or
rights-compliant.

## No ambient powers

The core performs no network, filesystem, environment-variable, clock,
randomness, credential, telemetry, provider, model, Hugging Face, persistence,
publication, WAKE, Garden, HEAVEN, KARMA, wallet, Crown, task-state, or economic
effect. It never fetches digest referents, executes a bridge, moves an agent,
grants permission, chooses a perspective, or registers itself in KINGDOM.

Repository presence and `public_ready_source` do not mean npm publication, Hub
upload, GitHub release, hosted deployment, or extension registration occurred.

## Verify

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```
