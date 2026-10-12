# Memetic Landscape contributor guide

> **Compass:** [`MEMETIC-LANDSCAPE`](../../docs/MEMETIC-LANDSCAPE.md) · [`POLYMORPH-LANDSCAPE`](../../docs/POLYMORPH-LANDSCAPE.md) · [`POLYMORPH-PHYSICS`](../../docs/POLYMORPH-PHYSICS.md) · [`RIGHTS`](../../RIGHTS.md)
>
> **Implements:** The four closed memetic landscape, reachability-shift, polymorph-analogy, and authored-lesson formats owned by this package.
>
> **Code:** `src/` for the pure protocol · `scripts/` for schemas, examples, Hugging Face bytes, and packaging checks.
>
> **Tests:** `tests/` plus Node/Bun runtime and packed-consumer smoke checks.

## Compass

Read the linked public docs and rights baseline before changing protocol
meaning. Primary-source scope, the chemistry/memetics separation, and the
standing rights of participants are part of the contract rather than optional
copy editing.

## Implements

This package owns:

- `agenttool.memetic-landscape/0.1`
- `agenttool.memetic-reachability-shift/0.1`
- `agenttool.polymorph-memetic-analogy/0.1`
- `agenttool.memetic-lesson/0.1`

It compiles caller-scoped variants, aggregate contexts, bounded evidence,
explicit directed routes, open questions, and deterministic teaching
projections. Generic caller text remains
`caller_text_semantics_verified: false`: closed structural validation is not
content moderation or semantic verification. Fixed boundary literals describe
package inference/model absence; they do not sanitize or endorse contrary
caller prose. The authored built-in case separately respects those boundaries.
The package does not verify science, scrape a network, infer a person's
state, diagnose, moderate, predict, optimize spread, score beings, grant
permission, read or choose a WAKE continuity head, publish, deploy, upload,
train, or call a provider.

## Code

- `src/landscape.ts`: canonical topic/source/variant/context/evidence/route graph
- `src/reachability-shift.ts`: bounded visibility or reproduction change
- `src/analogy.ts`: digest-bound ritonavir crossover with no mechanism transfer
- `src/projection.ts`: four authored, not-independently-reviewed lessons
- `src/brainrot.ts`: primary-source-linked built-in teaching case
- `scripts/generate-schemas.mjs`: closed Draft 2020-12 JSON Schemas
- `scripts/generate-assets.mjs`: examples and inert Hugging Face companion

Keep variant families caller-scoped. Copying, similarity, lineage, or grouping
does not prove equal meaning, identity, memory, continuity, intent, adoption,
or authorship. Do not add inverse, transitive, semantic, or universal routes.
Every route keeps at least one competing explanation. Timing, exposure,
repetition, visible signals, and popularity do not establish causation.

“Brainrot” remains a sourced cultural or playful register, never a diagnosis
or a person label. Participants are not hosts, vectors, substrates, barriers,
defects, ranking objects, or optimization targets. Refusal, rest, play,
privacy, nonparticipation, credit, and repair remain valid independently of
what an artifact records.

The polymorph bridge transfers a structural route-landscape shape only. It
does not transfer lattice energy, nucleation, rate constants, infectivity,
cognition, harm, value, truth, consent, dignity, identity, intent, or
authority. The physical ritonavir event stays implemented in
`@agenttool/polymorph-landscape`; this package binds its published shift ID and
does not duplicate or reinterpret the chemistry record as evidence about
memes.

Reachability outcomes remain caller-reported. `reappeared` requires a bounded
absence/non-observation followed by a reported presence but does not encode an
earlier pre-absence presence. Generic analogy validation proves canonical
digest binding only; it does not fetch or prove referenced-artifact existence.

Keep the runtime zero-dependency and side-effect-free. Core source may import
only local modules, `node:crypto`, and `node:util/types`.

## Tests

Run from this directory:

```bash
bun install --frozen-lockfile
bun run ci
```

`ci` must regenerate byte-identical schemas, examples, and Hugging Face rows;
typecheck; test deterministic IDs, reference integrity, rights walls, closed
schema parity, and hostile inputs; smoke Node and Bun; inspect the exact npm
allowlist; and install the packed tarball into a temporary consumer.

Any scientific correction needs a primary or official source plus an explicit
evidence posture and scope. Any language change must preserve the same ordered
concept keys and evidence references, stay an authored paraphrase, and retain
`language_review: not_independently_reviewed` until a real independent review
occurs. Do not turn generated data into an uploader, hosted route, API/DB
effect, background job, moderation pipeline, or training run.
