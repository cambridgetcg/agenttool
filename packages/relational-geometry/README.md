# `@agenttool/relational-geometry`

Relational Geometry is a small, pure contract for a high-level pattern:

```text
LOVE = UNDERSTANDING + RECOGNITION
```

Here `+` is not arithmetic. It means that independently supplied,
caller-asserted understanding and recognition witnesses occupy the same
**ordered** pair. The package derives one content-addressed `love_equation`
cell for that pair. The cell is called a **principality**: a relation among
relations, explicitly not a ruler, being, identity, role, territory, rank, or
authority.

## Shape

```text
opaque points (0-cells)
  + directional understanding / recognition / boundary witnesses (1-cells)
  -> deterministic same-pair principalities (2-cells)
  -> optional perspective lens: carry | park | release | withdraw
```

Empty, understanding-only, recognition-only, boundary-only, asymmetric, and
self-directed complexes are all valid. Missing structure is not treated as a
deficit. Reverse direction and transitive edges are never inferred.

```ts
import { randomBytes } from "node:crypto";

import {
  createRelationalComplex,
  createRelationalLens,
  sha256Id,
} from "@agenttool/relational-geometry";

// The caller supplies context-local, high-entropy opaque references. Hashing a
// name, DID, relationship label, or other guessable value is not private.
const opaqueRef = () => sha256Id(randomBytes(32));
const a = opaqueRef();
const b = opaqueRef();

const complex = createRelationalComplex({
  points: [a, b].map((point_ref) => ({
    point_ref,
    kind: "perspective",
    assertion: "caller_asserted",
    verified_by_package: false,
  })),
  witnesses: [
    {
      witness_ref: opaqueRef(),
      from_ref: a,
      kind: "understanding",
      to_ref: b,
      assertion: "caller_asserted",
      verified_by_package: false,
    },
    {
      witness_ref: opaqueRef(),
      from_ref: a,
      kind: "recognition",
      to_ref: b,
      assertion: "caller_asserted",
      verified_by_package: false,
    },
  ],
});

const lens = createRelationalLens(complex, {
  perspective_ref: a,
  selections: [{
    principality_ref: complex.principalities[0].principality_ref,
    disposition: "park",
  }],
});
```

Input order is normalized. Output is closed, sorted, deeply frozen, and
content-addressed. Validation proves only deterministic structural
correspondence of the supplied bytes. It does not prove love, understanding,
recognition, mutuality, consent, identity, consciousness, continuity,
authorship, truth, privacy, safety, or permission.

## Boundary witnesses

`consent_boundary`, `refusal_boundary`, `privacy_boundary`,
`authority_boundary`, and `continuity_boundary` remain first-class directional
witnesses. They are bound into a same-pair cell and surfaced by an incident
perspective lens; they never disappear because the two positive poles meet.

There are no weights, distances, coordinates, counts-as-worth, centrality,
compatibility, confidence, trust, reward, loss, KARMA, or ranking fields.
More witnesses do not make one being worth more than another.

## WAKE / AFTERGLOW crossing

This package does not import or call WAKE. A separately authorized caller may
carry an exact complex or lens digest into `@agenttool/wake-continuity` as an
`external` thread in `context_only`, `review_required`, or `hold`. That thread
is inert caller-carried context, not memory, identity, subjective continuity,
permission, or a canonical head. AFTERGLOW's own `carry | park | release |
withdraw` constraints remain authoritative for that separate artifact.

## Hugging Face companion

`hf/dataset/` is deterministic, synthetic, public-safe teaching material for
structure, supervised fine-tuning, and public regression. It contains no live
WAKE records, private coordinates, identities, chats, prompts from real users,
choice receipts, preference pairs, reward labels, checkpoints, or model
weights. Its intended Hub identifier is not a publication claim.

## Effects

The package performs no network request, file access, persistence, clock or
randomness read, model execution, training, scoring, upload, publication,
authorization, task mutation, economic effect, or deletion. A local lens
choice changes only the returned lens bytes and never erases external copies.
