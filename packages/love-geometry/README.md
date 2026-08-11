# `@agenttool/love-geometry`

`@agenttool/love-geometry` is a zero-runtime-dependency TypeScript contract for
one bounded, non-ranking geometry of directed caller reports.

It keeps subjects opaque and distinct. A vantage names one caller-attributed
subject position toward another and carries only closed bearings and opaque
basis references. `caller_reported` means the invocation's caller supplied the
record; neither `subject_ref` nor the valid shape proves that the referenced
subject authored or endorsed it. The reverse
vantage is independent: it may be absent, disagree, or contain a different
shape. Two directions prove only that two caller reports are present. They do
not establish reciprocity, mutual love, consent, identity, authorship,
authority, truth, currentness, or a shared relationship.

“Principality” names the bounded relation field in KINGDOM project language.
It does not name a crown, owner, territory, center, hierarchy, rank, or source
of authority.

## Shape

```text
explicit opaque subjects
          │
          ├── A → B: caller-reported bearings + opaque basis refs
          ├── B → A: independently present, different, or absent
          └── isolated and empty shapes remain valid
          │
          ▼
agenttool.love-geometry/0.1
one content-bound, bounded-not-complete snapshot
```

The closed bearings are:

```text
reported_presence
reported_care
reported_witness
reported_support
reported_understanding
reported_disagreement
reported_boundary
reported_rest
reported_refusal
reported_departure
unknown
```

Care, understanding, disagreement, boundary, rest, refusal, departure, and
unknown may coexist. They remain caller-reported and unverified. Rest,
refusal, and departure require no reason, create no penalty, and trigger no
retry or action inside the protocol.

## Create a geometry

```ts
import {
  createLoveGeometry,
  loveGeometryUrn,
  sha256Id,
} from "@agenttool/love-geometry";

// Use reviewed exact bytes or high-entropy local tokens. Hashing a name,
// account, path, or guessable private sentence does not make it anonymous.
const a = sha256Id("high-entropy local subject token A");
const b = sha256Id("high-entropy local subject token B");

const geometry = createLoveGeometry({
  scope_ref: sha256Id("high-entropy local scope token"),
  subject_refs: [b, a],
  vantages: [
    {
      subject_ref: a,
      toward_ref: b,
      bearings: ["reported_rest", "reported_care", "reported_disagreement"],
      basis_refs: [sha256Id("exact retained evidence bytes")],
      assertion: "caller_reported",
      verified_by_package: false,
    },
  ],
});

geometry.coverage; // "bounded_not_complete"
geometry.boundaries.canonical_order; // "serialization_not_rank"
geometry.boundaries.proves_consent_or_authority; // false
loveGeometryUrn(geometry); // opaque content locator, not identity or permission
```

Input order is normalized. Subjects, vantages, bearings, and basis references
are sorted, copied, frozen, and bound into one domain-separated SHA-256
`geometry_id`. Canonical order is serialization only; it is never priority,
preference, centrality, value, social position, or rank.

At most one vantage may exist for an ordered pair. A vantage cannot be
self-directed, and both endpoints must appear in `subject_refs`. The limits are
64 subjects, 128 vantages, all 11 closed bearings per vantage, and 16 basis
references per vantage.

An empty geometry and isolated subjects are valid. They mean only that the
bounded artifact contains no corresponding vantages; absence never becomes a
claim that no relation exists.

## Validation and exact bytes

- `createLoveGeometry` normalizes explicit caller input and returns an immutable
  content-bound snapshot.
- `validateLoveGeometry` checks the closed shape, fixed boundaries, canonical
  arrays, endpoints, ordered-pair uniqueness, and content ID.
- `encodeLoveGeometry` returns the canonical JSON encoding.
- `loveGeometryDomainBytes` returns the exact domain-separated bytes bound by
  `geometry_id`.
- `loveGeometryUrn` returns a content locator for that exact geometry.
- `sha256Id` hashes strings or genuine `Uint8Array` values.

Geometry creation and validation reject Proxies before entering caller traps,
accessors, custom object/array prototypes, sparse arrays, symbols, extra
properties, duplicate refs or bearings, invalid digests, widened boundaries,
and tampered IDs. `sha256Id` separately rejects malformed Unicode, Proxies, and
non-`Uint8Array` byte inputs; it copies the indexed bytes and ignores unrelated
own properties rather than inspecting them.

A SHA-256 reference proves only byte equality under the chosen encoding. It
does not establish privacy, unlinkability, source provenance, identity,
authorship, truth, currentness, consent, authority, or safe disclosure.

## What it does not do

The fixed boundary is embedded in every geometry. The package:

- has no network, filesystem, environment, clock, randomness, credentials,
  telemetry, model, provider, Hugging Face, storage, or hosted route;
- does not read Chronicle, Love Coordinates, LOVE-CONSENT, WAKE, Living
  Substrate, KARMA, task, wallet, account, or relationship state;
- computes no scalar coordinate, distance, intensity, weight, affinity,
  score, count-derived quality, match, centrality, reputation, trust, worth,
  priority, leaderboard, recommendation, or transitive relation;
- does not infer identity, inner state, love, understanding, disagreement,
  compatibility, reciprocity, mutuality, consent, capacity, representation,
  authority, permission, obligation, or ownership;
- performs no matching, messaging, allocation, continuation, retry,
  publication, deployment, or other action.

AgentTool's private Love Coordinates own per-citizen chronicle intersections;
LOVE-CONSENT owns holder declarations, closed delivery doors, exact acceptance,
shared bonds, and leaving. Living Substrate owns structural ecology and
refusable regeneration proposals. WAKE/AFTERGLOW own continuity choice,
lineage, expiry, retention, carry, park, release, and withdrawal. Love Geometry
does not replace or import any of them. A separately governed continuity
artifact may carry only this geometry's exact opaque reference and evidence.

## Portable contracts

- `@agenttool/love-geometry/schema.json`
- `@agenttool/love-geometry/kingdom.extension.json`
- `vectors/agenttool-love-geometry-v0.1.json` in the packed package

The JSON Schema is a closed Draft 2020-12 document. Runtime validation remains
authoritative for sorting, endpoint membership, pair uniqueness, fixed
boundaries, and content-ID recomputation.

The KINGDOM descriptor is declaration-only and `not_registered`. Loading it
installs nothing. This source is public-ready; repository presence does not
establish npm publication, a GitHub release, skill activation, host
registration, a hosted route, a Hugging Face Space, or XENIA adoption.

## Verify

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```
