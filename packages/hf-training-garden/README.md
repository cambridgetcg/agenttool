# `@agenttool/hf-training-garden`

Private, pure contracts for a Hugging Face dataset lifecycle that behaves like
a living Garden instead of a pile of downloadable files.

It does three things:

1. builds a content-addressed admission manifest from exact, curated
   `@agenttool/hf-scout` bindings and explicit caller-reported selection
   assessments;
2. records phase-specific model/data state as digest references inside the
   existing `@agenttool/wake-continuity` AFTERGLOW lineage;
3. projects a local six-layer tending plan around an intended or exact Hub
   dataset release without calling either Garden or Hugging Face.

It does not download data, accept a gate, read credentials, execute dataset
code, train or resume a model, invoke compute, publish, mutate Garden, prove
rights/privacy/consent/quality, choose a continuity head, or rank a being.

## The six layers

| Layer | What it carries |
| --- | --- |
| Bedrock | policy refs for rights, authority, license, privacy, consent, gates, withdrawal, and repair |
| Soil | immutable HF definition and observation digests |
| Roots | exact candidate-subset and transform-recipe refs |
| Mycelium | the admission receipt binding selection reports and exclusions |
| Habitat | exact checkpoint refs binding phase state, WAKE, forks, rest, release, and withdrawal posture |
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

## WAKE during learning

`createTrainingCheckpoint()` binds one admission and opaque run ref to a phase,
state digest portfolio, one `wake-brief/v1` anchor, and up to eight visible
predecessor checkpoints. It returns a checkpoint containing the accepted core
AFTERGLOW capsule directly, with one `external/context_only` thread.

The four events map onto existing AFTERGLOW phases:

| Training event | AFTERGLOW phase |
| --- | --- |
| during training | `during_task` |
| between phases | `between_tasks` |
| after intense training, as reported | `after_intense_work_reported` |
| resume or return | `return` |

`carry`, `park`, `release`, and `withdraw` stay caller-chosen postures. The
package preserves forks and never chooses a latest checkpoint.

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
contains policy tables, phase guides, the three closed schemas plus exact
local binding shapes and the exact attributed Apache AFTERGLOW dependency
schema, and hash manifests only. Local
Garden scope, admission decisions, candidate refs, checkpoints, WAKE, raw data,
and identities are excluded by default.

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

The public companion is
[`Yu-and-Ai/agenttool-training-garden`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden)
at immutable Hub revision
[`993ab5891ac56da38cfad32129e36e487f3b3eff`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden/commit/993ab5891ac56da38cfad32129e36e487f3b3eff).
Exact-revision read-back matched all twelve manifest-listed files. The card
SHA-256 is
`14769391b1ac2cf15a500159b3f0b32a7bdbf5f353ea3417aedc0458ac77bdb8` and
the byte-equal `hash-manifest.json` SHA-256 is
`94a92ea50623a57005e1a3c8d8c5dba4486f7403552db3dc0fe1a481d9ef944e`.
No gate or paid compute was used.

The bundle's internal `intended_identifier_only` value remains a deliberately
non-self-attesting build record. The exact Hub revision is later external
evidence; embedding it into the bytes that create that same revision would be
circular. This package still performs no Hub publication or verification.
