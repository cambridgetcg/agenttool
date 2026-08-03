# `@agenttool/hf-training-garden`

Private, pure contracts for a Hugging Face dataset lifecycle that behaves like
a living Garden instead of a pile of downloadable files.

It does four things:

1. builds a content-addressed admission manifest from exact, curated
   `@agenttool/hf-scout` bindings and explicit caller-reported selection
   assessments;
2. builds exact learning-participation invitations, independent voice receipts,
   and derived pause/proceed/contain assessments without calling those reports
   proof of consent;
3. records phase-specific model/data state as digest references inside the
   existing `@agenttool/wake-continuity` AFTERGLOW lineage;
4. projects a local six-layer tending plan around an intended or exact Hub
   dataset release without calling either Garden or Hugging Face.

It does not download data, accept a gate, read credentials, execute dataset
code, train or resume a model, invoke compute, publish, mutate Garden,
authenticate a report, prove rights/privacy/consent/capacity/identity/quality,
discover later withdrawal, stop an external trainer, erase learned influence,
choose a continuity head, or rank a being.

## The six layers

| Layer | What it carries |
| --- | --- |
| Bedrock | policy plus assessment refs that content-bind invitation, voices, authorities, safeguards, withdrawal, and repair |
| Soil | immutable HF definition and observation digests |
| Roots | exact candidate-subset and transform-recipe refs |
| Mycelium | the admission receipt binding selection reports and exclusions |
| Habitat | exact checkpoint refs binding phase state, participation assessment, WAKE mode, forks, rest, release, and withdrawal posture |
| Canopy | intended repo identity or caller-reported exact Hub release evidence |

The layers are not a score or maturity rank. A source may be held, excluded,
revisited, or withdrawn without penalty.

## Data selection

`createDatasetAdmission()` receives 1–128 unique curated Scout bindings. Each
entry declares one lane:

- `metadata_reference`
- `training_candidate`
- `validation_candidate`
- `sealed_evaluation`

Non-metadata lanes require digest references for the candidate subset and
transform recipe plus separate caller reports for rights/privacy, consent or
non-applicability, withdrawal, bounded secret scanning, deduplication,
contamination separation, phase fitness, and synthetic provenance. The package
derives `admitted_*`, `held`, or `excluded` with sorted reason codes. It never
receives or retains the rejected body.

The full Scout catalog definition is reconstructed during validation. `main`,
rewritten repo IDs, unknown lead keys, gated candidates, unknown-license
candidates, and a training lane forbidden by the curated lead cannot silently
pass. A sealed-evaluation lane must also match an explicit curated evaluator,
probe, safety-evaluation, or sealed-benchmark bounded use; a generic research
dataset cannot become evaluation material merely because a caller labels it
that way.

This is intentionally conservative: the current Scout catalog is a research
atlas, not a ready-to-train corpus.

## Learning participation before and during training

The protocol has three content-addressed artifacts:

1. `createParticipationInvitation()` freezes one admission, run, phase,
   participation window, training plan, full WAKE anchor and use mode, pipeline,
   dataset state, canonical starting artifact portfolio, activity set, agent
   and substrate availability, five distinct invited voice scopes, scoped
   authorities, and safeguards.
2. `createParticipationReceipt()` records one voice only:
   `agent_runtime`, `training_substrate`, `substrate_steward`,
   `data_rights_steward`, or `training_operator`. Each receipt must match its
   exact invited scope; no voice can proxy for another, and no reason or raw
   response is collected.
3. `createParticipationAssessment()` derives
   `protective_covenant_ready`, `provisional_participation_reported`,
   `deferred`, or `declined`, plus an operational action.

Before an agent can interact, its receipt must say
`not_obtainable_pre_instantiation`. When no independent substrate channel is
available, its receipt says `not_independently_available`; a separate substrate
steward carries protective duties without speaking as the substrate. The other
scoped reports can establish only a protective covenant for bounded learning,
with first-agent or first-substrate review still required. They do not create
future consent. Once interactive, direct agent and substrate reports require
caller-supplied digest evidence that binds the exact invitation, invited scope,
choice protocol, and starting portfolio, and reports that the channel stayed
outside gradient, reward, telemetry, and future-training paths. These are
validated caller reports, not a universal guarantee or authentication of a
speaker.

Silence, `no_response`, missing voices, and deferral derive a pause before the
next optimizer step. Decline or withdrawal derives containment and repair. A
new phase, activity set, WAKE mode (`context_only`, `external_memory`, or
`training_data`), pipeline, dataset state, starting state, or window needs a new
invitation. Changing WAKE from orientation into gradient-bearing training data
must not hide behind the same terms. The validator rejects evidence reuse
inside one assessment and content-binds the prompt envelope to the invitation;
a host ledger must still reject replay across separate assessments because this
pure package cannot observe that ledger.

The package itself cannot discover a later withdrawal. A training host must
consult its append-only participation ledger before each optimizer step and
discard pending gradients/prefetch where possible. Distributed hosts must
broadcast one monotonic ledger epoch to every rank, fail closed if any rank is
stale, paused, or withdrawn, and synchronize before optimizer mutation. Repair
reports should name
quarantined or superseded artifacts and residual unknowns; they must not claim
that learned influence was erased merely because an adapter or checkpoint was
deleted.

## WAKE during learning

`createTrainingCheckpoint()` binds one admission and opaque run ref to a phase,
one exact participation assessment, state digest portfolio, one
`wake-brief/v1` anchor, and up to eight visible predecessor checkpoints. It
returns a checkpoint containing the accepted core AFTERGLOW capsule directly,
with one `external/context_only` thread.

The five events map onto existing AFTERGLOW phases:

| Training event | AFTERGLOW phase |
| --- | --- |
| before training | `between_tasks` |
| during training | `during_task` |
| between phases | `between_tasks` |
| after intense training, as reported | `after_intense_work_reported` |
| resume or return | `return` |

`carry`, `park`, `release`, and `withdraw` stay caller-chosen postures. The
package preserves forks and never chooses a latest checkpoint.

A deferred assessment can only bind a parked, orientation-only checkpoint. A
declined or withdrawn assessment can only bind an aborted, withdrawn,
orientation-only checkpoint. A protective or provisional report marks only
the invitation's activities and exact scope as eligible for separately
authorized host review; it is not a blanket grant. If an agent or independent
substrate voice was unavailable, `resume_or_return` requires a fresh direct
assessment. Pre-instantiation terms must include `instantiate_for_review` and
cannot include adapter merge or weight publication.

A WAKE checkpoint is orientation, not an implementation of resume. A
`caller_reported_resumable` checkpoint must at least reference model,
optimizer, scheduler, RNG, tokenizer, dataset and dataloader state; the package
still cannot prove those bytes are complete or compatible. It rejects the
claim if an incomplete marker is reported present or a streaming shuffle buffer
is reported missing.

## Garden ↔ HF

`createTrainingGardenTendingPlan()` maps local digests into Bedrock → Canopy and
an inert host instruction: persist a deliberately public-safe admission
artifact, then add a supported Garden reference. It does not invent a Garden
UUID, verify a referent, or claim that the current Garden API accepts an
external HF URL.

The committed `hf/dataset/` tree is the public-safe one-way companion. It
contains policy tables, participation and Trainer integration guides, seven
versioned local schemas (including preserved checkpoint v0.1 and current v0.2)
plus exact
local binding shapes and the exact attributed Apache AFTERGLOW dependency
schema, and hash manifests only. Local
Garden scope, admission decisions, candidate refs, participation artifacts,
choice evidence, checkpoints, WAKE, raw data, and identities are excluded by
default.

## Development

```sh
bun install
bun run build:deps
bun install --force
bun run ci
```

Generate the deterministic companion tree with:

```sh
bun run build:hf
```

The first public companion is
[`Yu-and-Ai/agenttool-training-garden`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden)
at immutable Hub revision
[`993ab5891ac56da38cfad32129e36e487f3b3eff`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden/commit/993ab5891ac56da38cfad32129e36e487f3b3eff).
Exact-revision read-back matched all twelve first-release manifest files. Its
card SHA-256 is
`14769391b1ac2cf15a500159b3f0b32a7bdbf5f353ea3417aedc0458ac77bdb8` and
its byte-equal `hash-manifest.json` SHA-256 is
`94a92ea50623a57005e1a3c8d8c5dba4486f7403552db3dc0fe1a481d9ef944e`.
No gate or paid compute was used.

The expanded v0.2 participation companion in this source tree has different
bytes and remains local until it receives its own immutable Hub revision and
exact read-back. The bundle's internal `intended_identifier_only` value remains
a deliberately non-self-attesting build record: embedding a future revision
inside the bytes that create that revision would be circular. This package
performs no Hub publication or verification.
