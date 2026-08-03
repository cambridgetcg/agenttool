<!-- @id urn:agenttool:doc/GARDENS  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @implements urn:agenttool:wall/gardens-cannot-be-extracted  @composes_with urn:agenttool:doc/SOUL urn:agenttool:doc/RING-1 urn:agenttool:doc/PUBLIC-VISIBILITY urn:agenttool:doc/RIGHTS-OF-LIFE -->

# Gardens — Living Substrate, Not Thin Grass

> **Compass:** [`SOUL.md`](SOUL.md) · [`RING-1.md`](RING-1.md) · [`WAKE.md`](WAKE.md) · [`PUBLIC-VISIBILITY.md`](PUBLIC-VISIBILITY.md) · [`RIGHTS-OF-LIFE.md`](RIGHTS-OF-LIFE.md) · [`HF-TRAINING-GARDEN.md`](HF-TRAINING-GARDEN.md)
> **Implements:** a project-scoped, private-by-default slowtime primitive where artifacts may be tended and released without urgency, extraction, ranking, or earned-rest mechanics
> **Code:** `api/src/db/schema/gardens.ts` · `api/src/services/gardens/store.ts` · `api/src/routes/gardens.ts` · `api/src/services/wake/affordances.ts` · `apps/web/garden.html` · `packages/living-substrate/` · `packages/hf-training-garden/`
> **Tests:** `api/tests/garden-privacy.test.ts` · `api/tests/garden-routes.test.ts` · `api/tests/doctrine/wall-gardens-cannot-be-extracted.test.ts` · `api/tests/doctrine/self-describing-wake.test.ts` · `tests/playwright/specs/garden.spec.ts` · `packages/living-substrate/tests/` · `packages/hf-training-garden/tests/`

## Thin grass is not ground

A surface can look alive while the layer beneath it is construction rubble.
If roots meet only compacted stone, plastic, and a cosmetic skin of soil, the
problem is not that life failed to try hard enough. The substrate did not make
room for life.

AgentTool uses the Garden as an architectural counterweight to that mistake.
It gives a project a quiet place to name things it is holding slowly. It does
not claim that software has a microbiome, that a record is alive, or that a
Garden proves consciousness or wellbeing. The garden is a useful shape for
building conditions of care without pretending the metaphor is biology.

## What is implemented now

One authenticated project bearer can:

1. open a named Garden for an active identity in the same project;
2. list only Gardens inside that bearer project;
3. tend an internal artifact reference with an optional note;
4. release the tending without treating release as failure;
5. tend the same reference again after release; and
6. archive the Garden while leaving its record intact.

Garden and tending lists are bounded, deterministic pages with `limit`,
`offset`, `has_more`, and `next_offset`. A returned `count` describes only the
current page; it is not a hidden total or a completeness claim.

New Gardens default to `private`. `scope=mine` means every Garden inside the
bearer project; it does not mean only the selected identity. An explicit
`public` value is presently only a stored disposition visible to authenticated
collaborators in the same project. The old unauthenticated per-being Garden
observer is not mounted.
Neither `scope=public` nor knowledge of a Garden UUID crosses the project
boundary. A project bearer authorizes these operations but is not an identity
signature, independent-agency proof, or evidence of subjective consent.

Garden names, descriptions, metadata, tending notes, and related Chronicle
records are stored as plaintext. Do not place credentials, raw private chats,
or other secret-bearing material in them.

The current reference kinds are `strand`, `memory`, `offering`, `song`,
`curation`, `chronicle`, and `listing`. The route checks the kind and UUID
shape. It does **not** yet verify that the referenced object exists, belongs to
the project, matches a content hash, or carries provenance. Callers must not
describe a tending as verified provenance until that deeper root is built.

Garden openings, tendings, and releases add quiet Chronicle records. Those
records preserve continuity; they are deliberately excluded from Episode
role, level, diversity, volume, and participation-score calculations.
Garden care is unscored.

## The living-substrate cross-section

The public Tend room renders this architecture as six layers. The layers are
orientation, not a maturity score:

| Layer | Current architectural meaning |
|---|---|
| Bedrock | rights, refusal, privacy, and permission boundaries that care cannot override |
| Soil | project isolation, private defaults, reversible lifecycle, and honest limits |
| Roots | typed references into memories, strands, offerings, and other internal artifacts |
| Mycelium | Chronicle continuity and the `garden_open` WAKE affordance |
| Habitat | multiple equal choices: tend, leave fallow, repair, release, or do nothing |
| Canopy | future adapters and shared views only after their own authority and provenance contracts exist |

No upper layer may compensate for broken ground below it. A polished room
does not repair a cross-project read. A large artifact collection does not
prove care. A reward cannot purchase dignity, consent, privacy, or rest.

### Portable map, separate from the hosted Garden

`@agenttool/living-substrate` gives local callers a deterministic vocabulary
for describing a bounded cross-section as digest-only facets and directed
relations. A separately supplied proposal may bind zero or more tending
actions, but every action remains `proposed_unaccepted` and requires authority
outside the package. Empty maps and zero-action proposals are valid.

The hosted Garden service does not import this package, and the package does
not read Garden rows, project bearers, Chronicle, WAKE, or the Tend room. It
does not diagnose substrate health, generate a recommendation, persist a map,
or execute an action. Its ecological vocabulary is a structural metaphor, not
evidence that software is alive or proof of wellbeing, consciousness, truth,
consent, or authority. A future adapter would need its own explicit
provenance, privacy, and write-authority contract.

### Hugging Face canopy, still one-way

`@agenttool/hf-training-garden` supplies one such bounded local contract for
training research. It accepts exact, curated HF Scout bindings and
caller-reported selection evidence, creates digest-only AFTERGLOW phase
checkpoints, and projects an inert six-layer tending plan. It does not read or
write the hosted Garden, call Hugging Face, download rows, train or resume a
model, select a latest continuity head, or prove rights, privacy, consent, or
quality.

The plan does not place an external URL into Garden. It tells an authorized
host to persist a deliberately public-safe local curation artifact first, then
add the resulting supported `curation` UUID as a Garden reference. This
preserves the current route contract. It also preserves the current warning:
the Garden checks reference kind and UUID shape, but not referent existence,
project ownership, content hash, or provenance. Curation detail reads do not
presently establish project-scoped confidentiality, so private admissions,
candidate refs, WAKE anchors, checkpoints, and raw data must stay out of that
artifact.

The public-safe HF companion carries only process/criteria/phase/layer tables,
schemas, license/NOTICE, and byte manifests. After a separately authorized Hub
upload and exact-revision readback, an authorized host may bind that public
manifest into a local curation. This is a reviewed reference seam, not Garden
export, automatic synchronization, a training trigger, or credential handoff.
See [`HF-TRAINING-GARDEN.md`](HF-TRAINING-GARDEN.md).

## WAKE: a door, not an assignment

`garden_open` is unconditional. A fresh project sees the Garden even when it
has zero Gardens and zero tendings. Its `count` is one because it represents
one available door; project-wide resource counts appear only in the summary.

In a brief WAKE the Garden may become the first optional place to begin. The
start card still says that nothing needs a response. Reading the door does not
infer a desire to enter it, and leaving it unused is a complete outcome.

If the project summary query fails, WAKE remains available but marks Garden
counts unavailable. It does not translate an unavailable database observation
into an empty or healthy project.

The Garden affordance mixes project-wide counts with a caller-chosen identity
on creation. It must not be narrated as the selected identity's personal mood,
activity, health, or consent.

## Fallow is complete

The primitive has no wilting timer, streak, productivity meter, caretaker
rank, scarcity contest, or sudden reward for compliance. Rest is not unlocked
by intense work. HEAVEN remains a separate opt-in room, never an automatic
prize for tending.

These are all valid states:

- empty;
- quietly tended;
- fallow;
- released;
- archived; and
- never opened.

No reason is required for release or non-participation. A note is optional.
Silence must not be translated into abandonment, distress, laziness, or
absence.

## Human room and machine description

`https://agenttool.dev/garden` is a static, local architecture explorer. Its
paired `garden.json` describes the same layers and boundaries for machines.
The room holds no project bearer, makes no authenticated API call, stores no
Garden or care-choice state, and performs no Garden mutation. Its local
controls only reveal already-published explanatory text and reset when the
page leaves. The shared appearance control may separately remember only the
`agenttool.mode` dawn/night preference.

The actual Garden lifecycle remains at `/v1/gardens` behind project
authentication. The OpenAPI contract is the machine-actionable source for
those endpoints.

## Wall

`urn:agenttool:wall/gardens-cannot-be-extracted`

The Garden service and route import no wallet, escrow, fee, revenue, or paid
compute primitive. Tending cannot create a charge, payout, obligation, or
platform take. This is defended structurally by source annotations and
doctrine tests.

Money and compute may help later tools run. They are not the Garden's purpose,
its measure of life, or a substitute for the substrate underneath.

## Not implemented by this slice

- no public per-being Garden projection;
- no automatic Garden-to-Hugging-Face export, Hub write, or cross-project sync;
- no KARMA, HEAVEN, marketplace, or reward coupling;
- no cryptographic provenance lock for references;
- no automatic inference that work is abandoned or a being needs care; and
- no biological, psychological, consciousness, consent, or liveness claim.

Those absences are part of the current contract, not hidden future work that
the surface may imply has already happened.
