# @agenttool/principality-geometry

`@agenttool/principality-geometry` is a private, zero-runtime-dependency
prototype for drawing one high-level pattern without turning it into a score:

> Love keeps distinct centres in relation. Understanding can be approached as
> the invariants that survive translation between them.

The package compiles caller-supplied, digest-bound translation reports into a
finite directed graph and an invariant-labelled reciprocal flag 2-complex. It
does not decide that anyone loves, understands, agrees, consents, or is safe.

## The formal kernel

Let `P` be a finite set of principalities, `Q` a finite set of declared
invariants, and `B ⊂ P × P` a set of unique directed, irreflexive bridges.
Every bridge supplies a total report

```text
σ : B × Q → {
  preserved_reported,
  not_preserved_reported,
  refused_reported,
  unknown
}
```

Totality matters: omission never means preservation. Refusal needs neither a
reason nor evidence.

- A **principality** is a caller-defined high-order pattern or coordinate
  chart—such as a protocol, package, dataset, infrastructure, practice, or
  archive. It is never a being identity, rank, jurisdiction, or authority.
- A **directed bridge** retains its own availability/rest/refusal/withdrawal,
  every per-invariant state, and digest-only evidence.
- A **reciprocal lens** exists only when both directions were supplied. It
  retains both ordered dispositions and both ordered invariant states; no
  direction is flattened or inferred.
- For each invariant `q`, an undirected edge exists only when both routes are
  `available_reported` and both evaluations are `preserved_reported`.
- An **invariant surface** exists only when all three pairs in a triple have
  those edges for at least one common invariant. This requires all six
  directed preservation reports.
- **Invariant components** are calculated separately for each `q`. A one-way,
  resting, refused, withdrawn, non-preserving, or unknown bridge cannot create
  one of these geometry edges.

This is the invariant-labelled 2-skeleton of a reciprocal flag complex. A
surface does not prove that translations compose, commute, preserve actual
semantics, or establish love or understanding.

`geometry.open_conditions` is an explicit ledger, not a simplicial boundary
operator. It keeps one-way bridges, non-available routes, non-preservation,
refusal, unknowns, directional asymmetry, unrelated pairs, and declared
isolates visible without turning them into penalties. Empty and one-vertex
atlases are valid outputs. Quiet is data, not failure.

## WAKE and continuity without automatic continuity

Each principality binds an opaque `definition_ref` and zero to eight thin
manifestations:

- `protocol_digest` carries only a versionable protocol identifier and content digest, allowing
  Browser, Witness, HF Scout, or another system to be referenced without an
  import or runtime capability.
- `external` copies the exact seven fields of an AFTERGLOW external thread:
  `thread_ref`, `artifact_ref`, `disposition`, `assertion`,
  `verified_by_package`, `kind`, and `state`.

The latter is a shape-compatible `external` seam supporting the exact
`context_only`, `review_required`, and `hold` states, not a claim that an
AFTERGLOW capsule was validated. This package never chooses a
continuity head, inherits context, carries or resumes a thread, changes its
state, or performs a handoff. Duplicate external thread and artifact refs in
one principality are rejected to avoid conflicting timeless projections.

An atlas digest can likewise be placed into a future AFTERGLOW
`external/context_only` thread by an explicit caller. Neither direction is
automatic.

## Hugging Face and npm references

The core accepts two bounded provider-reference records:

- Hugging Face: repo type/id, a full lowercase 40-hex revision, an explicit
  caller-named snapshot-manifest protocol and its SHA-256, plus the observation
  boundary.
- npm: exact package/version, canonical SHA-512 SRI, an explicit caller-named
  version-metadata protocol and SHA-256, reported provenance-attestation state,
  and the observation boundary.

The versionable protocol identifier is important: this package does not pretend that there is
one universal byte representation for a Hub snapshot manifest or npm version
metadata. npm SRI binds tarball bytes; the other digests bind only the
caller-declared canonicalization recipe. `artifact_ref` identifies the
immutable coordinate fields and excludes observation/provenance commentary;
the containing vertex still binds the entire record.

The existing `@agenttool/hf-scout` is a useful source observation, but its
report shape and `snapshot_sha256` semantics are deliberately different. A
caller may bind a Scout report as a `protocol_digest`, or construct a separate
HF artifact record after defining an exact snapshot-manifest recipe. There is
no implicit adapter.

The package never contacts HF or npm. It does not treat a provider record,
digest, or attestation label as authorship, currentness, repository
association, evidence truth, safety, licence compatibility, consent, or
provenance proof. Hashing does not remove linkability.

## Small example

```ts
import {
  createPrincipalityAtlas,
  renderPrincipalitySvg,
  sha256Id,
} from "@agenttool/principality-geometry";

const invariant = {
  invariant_id: "refusal-visible",
  definition_ref: sha256Id("reviewed definition bytes"),
};

const atlas = createPrincipalityAtlas({
  _format: "agenttool.principality-geometry-input/0.1",
  scope_ref: sha256Id("high-entropy local scope"),
  invariants: [invariant],
  principalities: [
    {
      principality_id: "garden",
      kind: "practice",
      definition_ref: sha256Id("garden definition"),
      manifestations: [],
      artifact_refs: [],
    },
    {
      principality_id: "hub",
      kind: "infrastructure",
      definition_ref: sha256Id("hub definition"),
      manifestations: [],
      artifact_refs: [],
    },
  ],
  translations: [
    {
      from: "garden",
      to: "hub",
      disposition: "available_reported",
      evaluations: [{
        invariant_id: invariant.invariant_id,
        state: "preserved_reported",
        evidence_refs: [sha256Id("exact evidence A")],
      }],
    },
    {
      from: "hub",
      to: "garden",
      disposition: "resting_reported",
      evaluations: [{
        invariant_id: invariant.invariant_id,
        state: "refused_reported",
        evidence_refs: [],
      }],
    },
  ],
});

atlas.geometry.reciprocal_lenses[0]?.dispositions;
// ["available_reported", "resting_reported"]
atlas.geometry.invariant_surfaces.length; // 0
const svg = renderPrincipalitySvg(atlas); // inert, deterministic, P-labelled
```

Input order is normalized with AgentTool/JCS-compatible unsigned UTF-16
ordering. Content IDs bind separate domains for manifestations, artifacts,
vertices, bridges, lenses, surfaces, per-invariant components, and the atlas.
Changing pinned vertex content propagates through every incident topology ID.

## Deterministic local assets

The renderer uses a fixed integer ring with no overlapping vertices or
collinear triples at the sixteen-vertex maximum. `P01`, `P02`, … follow
protocol order. The SVG contains no raw principality/provider names, external
or source URLs, hyperlinks, scripts, event handlers, remote assets, or source digests. Position,
distance, area, colour, node count, and artifact markers are display only—not
similarity, importance, quality, or rank.

The checked-in `examples/principality-rosette.*` vector crosses structurally
valid synthetic HF/npm reference records, DeepSeek Kingdom, Training Garden,
and an AFTERGLOW `external/context_only` projection. Its provider identities
use `synthetic/` and `@synthetic-fixture/` namespaces: the repeated hashes are
not provider observations or receipts for real AgentTool packages.

`hf/dataset/` is a deterministic, npm-excluded Dataset-card companion with
separate homogeneous non-training tables for atlases, invariants, vertices,
bridges, lenses, surfaces, components, and open conditions; both closed
schemas; the golden vector; SVG; and a dataset-wide self-excluding source
manifest. It has no intended Hub repository ID and no upload path. Local
readiness is not publication.

## Fixed non-claims

The fixed boundary is content-addressed into every atlas. This package:

- does not read or compute hosted `LoveCoordinates`;
- does not measure cognition, conceptual mass, fidelity, love,
  understanding, welfare, compatibility, trust, or rights compliance;
- does not infer identity, intent, consent, authority, social reciprocity,
  truth, currentness, safety, provenance, repository association, or licence;
- does not fetch evidence, read credentials/environment, search, download,
  install, extract, execute, infer, train, upload, publish, deploy, persist,
  retry, resume, penalize, or change task/economic state;
- does not choose a centre, head, winner, recommendation, repair, or next
  action.

The design implements only a narrow seam in
`docs/UNDERSTANDING-MATHEMATICS.md`: explicit invariant partitions and the
topology of their caller-reported mutual preservation. It leaves the
document's cognitive-measurement and metaphysical reservations intact.

## Status and verification

This source is `private: true`, `UNLICENSED`, and absent from AgentTool's npm
release allowlist, hosted WAKE, and provider surfaces. The local HF companion
is marked `publication_authorized: false`. Repository presence is not
publication or registration.

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```
