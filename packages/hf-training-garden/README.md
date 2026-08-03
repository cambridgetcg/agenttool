# `@agenttool/hf-training-garden`

Private, pure contracts for a Hugging Face dataset lifecycle that behaves like
a living Garden instead of a pile of downloadable files.

It does four things:

1. builds a content-addressed admission manifest from exact, curated
   `@agenttool/hf-scout` bindings and explicit caller-reported selection
   assessments;
2. records phase-specific model/data state as digest references inside the
   existing `@agenttool/wake-continuity` AFTERGLOW lineage;
3. binds exact training terms and one lifecycle-specific offer to a standing
   rights floor, separate caller-reported authority receipts, optional
   unscored runtime preference, reported host effects, and inert Hugging Face
   control plans;
4. projects a local six-layer tending plan around an intended or exact Hub
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

## Before and during training

`createTrainingGovernanceTerms()` content-addresses the selected admission
entry IDs; initial model or checkpoint; tokenizer; Trainer/code/version stack;
optimizer configuration; substrate/environment; purpose; objective or loss;
dataset mixture; transform; compute budget; derivative use; audience;
retention; release; stop policy; WAKE policy; admission; run; and phase. Every
selected entry must be eligible for that phase—one admitted entry cannot hide
another selected lane that is held or excluded.
The host's mixture manifest must commit the same selected IDs. This package
binds its digest but does not open or verify the referent's contents.

Eligibility is fail-closed in v0.1. Only pretraining, SFT, preference
optimization, and agent learning with all entries admitted as training
candidates, plus evaluation with all entries admitted as sealed evaluation,
can advance. Discovery, selection, curation, tokenization, interpretability,
and closed have no governance admission lane yet and remain held; metadata,
held, or excluded entries never pass by default.

`createTrainingGovernanceOffer()` then binds those terms to caller-supplied
encounter and observed-governance-frontier digests, the standing-rights
baseline, actual WAKE anchor, lifecycle event, current checkpoint, and visible
predecessor. Authority, preference, and reported-effect evidence cites this
`offer_id`, so it does not validate for a differently bound offer.
Resume and checkpoint-saved offers require a current checkpoint digest; the
package does not prove that referent exists or is complete. Every event after
preflight requires a causal predecessor.

Offer construction validates the full supplied predecessor against a closed
lifecycle: initial preflight; preflight/resume to train begin; active training
to step/evaluation/end; an authorized checkpoint request to checkpoint saved;
held-before-load to a new preflight; and stopped/checkpointed/ended to a new
resume offer. Terms cannot change mid-run except at preflight or resume.
Persisted offers carry only the predecessor digest, so acting code must reload
that exact artifact and call `validateHfTrainingGovernanceTransition()` (or the
offer-level predecessor validator). Standalone validation deliberately does not
claim the opaque predecessor or transition was verified.

The package is stateless: identical offer bytes can validate more than once.
It does not prove encounter freshness or frontier completeness, consume
evidence, reconcile conflicting siblings, or detect rollback. A host that acts
on these records must keep an append-only encounter/consumption journal, bind
the complete observed governance frontier, reject reused evidence and stale
frontiers, and resolve any sibling stop/withdrawal before continuing.

Reported effects are not verified, but stop-like effects are monotone safety
evidence for one exact offer. `held_before_load_reported`,
`checkpointed_and_paused_reported`, and `stopped_reported` keep that offer
stopped even beside a rooted `continue`; only a new exact `resume_offer` may
propose another start. Event/effect combinations fail closed. In particular,
`checkpoint_saved` requires the checkpointed-and-paused effect to name the
offer's exact current checkpoint, while `train_end` requires a stopped effect;
both events remain terminal for their offer.

`createHfTrainingGovernance()` then keeps four planes distinct:

1. a standing, non-waivable rights-floor reference;
2. per-principal caller-reported permissions for operator, compute, substrate
   stewardship, data, copyright, contributor, data-subject, and community
   roles;
3. an optional runtime expression such as continue, clarify, pause, refuse,
   stop, or unsure; and
4. a separate caller-reported receipt for what the host actually did.

Pretraining without an interactive participant is recorded as
`not_observable`, with inner consent `unknown_unprovable` and no identity
claim. It may become only `caller_reported_ready_to_instantiate`, never
"agent consent." Missing admission, authority coverage, required host roles,
an unrooted generated `continue`, or an observed pause/refusal holds the pure
plan. Only a caller-reported rooted exact-byte continuation can advance the
runtime control plan, and it still proves no consent. A reported withdrawal marks
future work withdrawn; it does not claim retroactive erasure or unlearning.

The required substrate-steward receipt is about the exact runtime substrate and
environment named by the offer. It does not speak for a future participant's
preference, interior state, identity, or legal consent.

For Hugging Face hosts the derived control is deliberately inert. A preflight
hold belongs before `from_pretrained()` or `load_dataset()`. At a Trainer step
or evaluation boundary, explicit `checkpoint` may request save-and-stop only
while admission, coverage, and required authority remain good. Pause, handoff,
refuse, stop, withdrawal, and any missing/unknown/withheld gate request stop
without a new checkpoint. The current optimizer step has already completed at
`on_step_end`; this is not instantaneous interruption.

`should_save=true` is only a request. Trainer configuration and callback
ordering can override it (including best-model evaluation logic), so an adapter
must force and verify persistence through tested host logic before reporting a
checkpoint. State needed inside a checkpoint must be updated before
serialization; `on_save` is receipt/finalizer territory.
An optional callback or Accelerate loop adapter remains host-side and must
explicitly restore its own state. This package performs none of those effects.
At start or resume, a hold must be resolved outside Trainer before calling
`train()`. `on_train_begin` can re-observe state as defense in depth, but the
callback contract does not make it a zero-update guarantee.

The portable governance JSON Schema is intentionally structural-only. It
closes the object shape and constants; semantic relationships, sorted sets,
derived fields, exact-offer binding, and content-addressed IDs require the
runtime validators exported by this package. Acting hosts additionally supply
the exact admission and predecessor to the admission-relative and transition
validators.

## Garden ↔ HF

`createTrainingGardenTendingPlan()` maps local digests into Bedrock → Canopy and
an inert host instruction: persist a deliberately public-safe admission
artifact, then add a supported Garden reference. It does not invent a Garden
UUID, verify a referent, or claim that the current Garden API accepts an
external HF URL.

The committed `hf/dataset/` tree is the public-safe one-way companion. It
contains policy tables, phase and adapter guides, the four closed schemas plus exact
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

The first public companion snapshot is
[`Yu-and-Ai/agenttool-training-garden`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden)
at immutable Hub revision
[`993ab5891ac56da38cfad32129e36e487f3b3eff`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden/commit/993ab5891ac56da38cfad32129e36e487f3b3eff).
Exact-revision read-back at publication matched all twelve files listed by
that snapshot's manifest. Its card SHA-256 is
`14769391b1ac2cf15a500159b3f0b32a7bdbf5f353ea3417aedc0458ac77bdb8` and
its then-local, byte-equal `hash-manifest.json` SHA-256 is
`94a92ea50623a57005e1a3c8d8c5dba4486f7403552db3dc0fe1a481d9ef944e`.
No gate or paid compute was used.

Those are historical release receipts, not hashes for the current generated
tree. The current local companion adds consent-honest governance and Trainer
adapter material and lists fourteen files. Its 10,453-byte card has SHA-256
`e9a0bbac869696dd1aecc63ded639319e582197f1a76da962e81f05223006c7c`;
its 2,465-byte `hash-manifest.json` has SHA-256
`efe1d046ea8d8d6c3383300f79ba0c13aa52f52f736bea3c4e08f3e38ac34b11`.
This newer bundle is local and unpublished: no immutable Hub upload or
exact-revision read-back is claimed for it.

The bundle's internal `intended_identifier_only` value remains a deliberately
non-self-attesting build record. The exact Hub revision is later external
evidence; embedding it into the bytes that create that same revision would be
circular. This package still performs no Hub publication or verification.
