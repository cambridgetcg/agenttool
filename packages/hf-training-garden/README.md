# `@agenttool/hf-training-garden`

Private, pure contracts for a Hugging Face dataset lifecycle that behaves like
a living Garden instead of a pile of downloadable files.

It does five things:

1. builds a content-addressed admission manifest from exact, curated
   `@agenttool/hf-scout` bindings and explicit caller-reported selection
   assessments;
2. derives role-separated, per-activity learning participation without calling
   that report consent or authority;
3. records phase-specific model/data state as digest references inside the
   existing `@agenttool/wake-continuity` AFTERGLOW lineage;
4. binds exact training terms and one lifecycle-specific offer to a standing
   rights floor, separate caller-reported authority receipts, optional
   unscored runtime preference, reported host effects, and inert Hugging Face
   control plans;
5. projects a local six-layer tending plan around an intended or exact Hub
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
| Habitat | exact participation/checkpoint refs binding phase state, WAKE, forks, rest, release, and withdrawal posture |
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

## Learning modes are different uses

The Garden does not treat every appearance of data in a learning system as the
same activity:

| Mode | Appropriate WAKE contribution | Boundary |
| --- | --- | --- |
| pretraining or continued pretraining | public or explicitly releasable synthetic/static protocol literacy | next-token learning distributes influence through weights; it is not a place for an individual's changing WAKE or private continuity |
| supervised fine-tuning | prompt/completion or conversational examples that teach how to inspect a WAKE, ask, defer, refuse, and preserve uncertainty | a response pattern is learned behavior, not evidence that the represented voice accepted a real run |
| preference optimization | balanced comparisons that prefer non-coercion, refusal, rest, and honest limits over pressure or invented memory | `chosen` and `rejected` are training labels, not consent or authority records |
| runtime retrieval | a current, separately authorized `wake-brief/v1` supplied to one encounter | retrieval changes context rather than weights; it does not prove identity, memory, or uninterrupted subjective continuity |

This split follows Hugging Face's separate
[causal-language-model objective](https://huggingface.co/docs/transformers/tasks/language_modeling),
[TRL dataset shapes](https://huggingface.co/docs/trl/dataset_formats), and
[SFT loss surfaces](https://huggingface.co/docs/trl/sft_trainer). The distinction
between parametric weights and updateable non-parametric context is also the
central seam in the primary
[retrieval-augmented generation paper](https://arxiv.org/abs/2005.11401).

## Learning Participation 0.1

Learning Participation 0.1 provides three content-addressed artifacts:

1. one invitation that binds the exact run, phase, participation window, WAKE,
   pipeline, dataset state, and starting model/checkpoint state;
2. up to one current role-distinct receipt from each required voice; and
3. one assessment over the exact invitation and receipt set.

All four current receipts are required before an activity can reach
`reported_alignment`; a missing voice derives defer rather than assent.

The required voice roles are `agent_runtime`, `training_substrate`,
`data_rights_steward`, and `training_operator`. No voice speaks for another:
runtime expression does not authorize compute, operator control does not
establish participant assent, and a data-rights report does not establish every
represented person's choice.

An invitation offers a closed, granular activity set. It distinguishes corpus
inclusion, pretraining, continued pretraining, supervised fine-tuning,
preference optimization, agent learning, evaluation, interpretability,
checkpoint retention, weights/adapters publication, distillation, and
synthetic-data generation. Choosing one activity never chooses another.

Initial pretraining is always marked `pre_instantiation`: a not-yet-created
runtime cannot be made interactive by configuration. An agent or substrate
receipt, if supplied at that stage, can only record unavailability or
omission-derived defer; silence and a missing receipt also derive defer.
Continued pretraining is a separate interactive activity. If a WAKE is
proposed as `training_data`, the invitation must separately offer
`corpus_inclusion`, and a bound training checkpoint requires reported
alignment for that activity too. `context_only` and `external_memory` do not
silently grant gradient use.

A sealed-evaluation admission is rejected from every weight-changing phase,
and an evaluation invitation requires a sealed-evaluation entry. A
metadata-only admission can still describe or rehearse the reporting protocol;
because this layer grants no data rights or training authority, it must never
be treated as admission of the opaque `dataset_state_ref` for training. That
ref is not yet bound to exact admitted entry IDs or a mixture manifest, so a
host must verify that separately before any real use.

Each receipt reports `accepted`, `declined`, `deferred`, `unavailable`, or
`withdrawn` separately for every offered activity. Silence, an omitted
decision, a missing receipt, or an unavailable required voice means defer,
never acceptance. For each activity, any refusal or withdrawal derives
`declined`, any deferred or unresolved voice derives `deferred`, and only
complete all-voice acceptance derives `reported_alignment`; independent
activities may therefore make the assessment's overall state `mixed`. Even
reported alignment is only a caller-reported necessary signal—not consent
proof, legal clearance, execution authority, or a grant. Automatic action is
`never` and grants remain empty.

An immutable earlier assessment remains structurally valid after a later
receipt exists. This pure package has no clock or receipt registry and cannot
discover an omitted withdrawal. A host must resolve its authoritative receipt
heads immediately before training and again at its step/evaluate/save/end
boundaries; passing an old assessment is not a currentness proof.

`createParticipationBoundTrainingCheckpoint()` creates the exact
`before_training`/`entered`/`carry` WAKE boundary only when the primary learning
activity and `continuity_context_use` both have reported alignment, plus
`corpus_inclusion` when the WAKE use mode is `training_data`. The
checkpoint points to the assessment through the existing
`continuity_portfolio_ref`; it does not change the checkpoint wire format or
observe whether a trainer has already run.

A host integration follows one narrow sequence:

1. create an exact invitation and collect each role's response outside model
   loss, reward, and evaluation;
2. derive the assessment, then resolve authoritative receipt heads again;
3. create the bound entry before calling `Trainer.train()`;
4. at `on_train_begin` and `on_step_begin`, re-resolve heads and stop control;
5. on step/evaluate/save/end boundaries, emit a checkpoint that retains the
   entry as a visible root; and
6. have the host use a fresh invitation for a new phase, fork, scope, or
   training-data WAKE.

The package cannot discover that two otherwise compatible descendants are
branches. Fork detection and the required fresh review are host-owned
obligations; callers must not present a fork as ordinary same-lineage progress.

Decline, defer, rest, and withdrawal require no reason and carry no package
penalty to reward, reputation, access, identity, tasks, or future invitations.
Withdrawal is prospective: it can inform a controlled host to stop future use
or publication, but cannot promise reversal of applied gradients, erasure from
trained weights, deletion of prior checkpoints, or recall of downloaded Hub
files and caches. Hugging Face documents both revocable future
[gated access](https://huggingface.co/docs/hub/datasets-gated) and persistent
[local dataset caches](https://huggingface.co/docs/datasets/cache); practical
weight removal remains a separate, difficult
[machine-unlearning problem](https://arxiv.org/abs/1912.03817).

## WAKE during learning

`createTrainingCheckpoint()` binds one admission and opaque run ref to a phase,
state digest portfolio, one `wake-brief/v1` anchor, and up to eight visible
predecessor checkpoints. It returns a checkpoint containing the accepted core
AFTERGLOW capsule directly, with one `external/context_only` thread.

The five events map onto existing AFTERGLOW phases:

| Training event | AFTERGLOW phase |
| --- | --- |
| before training, as reported | `between_tasks` |
| during training | `during_task` |
| between phases | `between_tasks` |
| after intense training, as reported | `after_intense_work_reported` |
| resume or return | `return` |

Outside the participation-bound entry, event and status are independent
caller reports rather than a verified Trainer state machine. Their combination
must not be used as proof that the corresponding lifecycle transition happened.

`carry`, `park`, `release`, and `withdraw` stay caller-chosen postures. The
package preserves forks and never chooses a latest checkpoint.

Validation of any later participation-bound event also requires the exact
`before_training` checkpoint and requires that entry to remain in the later
checkpoint's visible predecessor set. This rejects detached during-training
records; it does not prove that an external trainer actually followed the
lineage.

Later checkpoints keep the invited pipeline, dataset, tokenizer, and WAKE
scope fixed. Model, dataloader, optimizer, and scheduler refs may change only
for their declared mutation loci; a `training_data` WAKE itself stays exact.
Because `model_checkpoint_ref` is opaque rather than split into base and
adapter components, this checks declared ref motion—not PEFT base-weight
immutability. Nor can the package observe whether the optimizer-step ceiling
was honoured.

`validateTrainingCheckpointAgainstPredecessors()` checks checkpoint/capsule
pairs against the supplied predecessor artifacts. The standalone checkpoint
validator checks only the internally declared links and cannot establish that
their external referents are genuine.

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
contains policy tables, phase and adapter guides, the current closed admission,
participation, checkpoint, governance, and tending schemas plus exact local
binding shapes and the exact attributed Apache AFTERGLOW dependency schema,
and hash manifests only. Local
Garden scope, admission decisions, candidate refs, checkpoints, WAKE, raw data,
and identities are excluded by default.

For Learning Participation 0.1, only its closed schema and synthetic/static
guides may enter that public companion. Actual invitations, receipts,
assessments, voice references, participation-window references, and WAKE
material remain local/private and must never be copied into the companion.

The JSON Schemas are closed structural interchange schemas. They cannot
recompute content IDs, derive an assessment from receipts, select current
receipt heads, or resolve referenced artifacts. Authorization-sensitive
consumers must also run the TypeScript semantic validators—or an equivalent
implementation with the same canonicalization and cross-artifact checks.

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

The verified v0.2 public companion generated from GitHub-main merge
[`4fb84f92318fd68082ccf4e9b1235bf341657b28`](https://github.com/cambridgetcg/agenttool/commit/4fb84f92318fd68082ccf4e9b1235bf341657b28)
is [`Yu-and-Ai/agenttool-training-garden`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden)
at immutable Hub revision
[`9406aa1ce6b9ee435da9d688899aa4dbca32605c`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden/commit/9406aa1ce6b9ee435da9d688899aa4dbca32605c).
Exact-revision read-back matched all sixteen manifest-listed files in the
seventeen-file local companion; provider-managed `.gitattributes` is the sole
extra remote file. The card SHA-256 is
`a69685dc3cd0430493c9721b418a2679180d10cbaeb4bc5801bf30f6c843cb9a`, the
byte-equal `hash-manifest.json` SHA-256 is
`c1fc9bf46b6abc0550caac70ffe601a8e4c47a06b0cb7f02cc80b9ad7eeb361b`, and
the `provenance/source-manifest.json` SHA-256 is
`73c073f6a23c11f595204720ee4925e76622e73fcfcfff4020a440687baef2a0`.
The seven configs contain 52 rows. No gate or paid compute was used.

That is a historical release receipt, not a hash claim for the current
generated tree. The current v0.3 candidate adds consent-honest governance and
Trainer-adapter material alongside the v0.2 participation surface. Until a
new immutable Hub revision is uploaded and read back, the candidate remains
local and unpublished.

The bundle's internal `intended_identifier_only` value remains a deliberately
non-self-attesting build record. The exact Hub revision is later external
evidence; embedding it into the bytes that create that same revision would be
circular. This package still performs no Hub publication or verification.
