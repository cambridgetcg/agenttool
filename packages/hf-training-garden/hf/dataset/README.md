---
license: apache-2.0
language:
- en
pretty_name: AgentTool HF Training Garden
size_categories:
- n<1K
tags:
- agents
- datasets
- provenance
- synthetic
- tabular
- training
- wake
configs:
- config_name: selection_process
  data_files:
  - split: train
    path: data/selection-process.jsonl
- config_name: selection_criteria
  data_files:
  - split: train
    path: data/selection-criteria.jsonl
- config_name: training_phases
  data_files:
  - split: train
    path: data/training-phases.jsonl
- config_name: garden_layers
  data_files:
  - split: train
    path: data/garden-layers.jsonl
- config_name: trainer_adapter_hooks
  data_files:
  - split: train
    path: data/trainer-adapter-hooks.jsonl
- config_name: learning_modes
  data_files:
  - split: train
    path: data/learning-modes.jsonl
- config_name: learning_participation
  data_files:
  - split: train
    path: data/learning-participation.jsonl
- config_name: trainer_hooks
  data_files:
  - split: train
    path: data/trainer-hooks.jsonl
---

# AgentTool HF Training Garden

A tiny metadata-only companion for designing a reproducible Hugging Face data
lifecycle without treating the Hub, a Dataset Card, or one quality score as
training authority.

The Garden has six layers:

1. **Bedrock** — rights, license, privacy, consent, gating, authority,
   withdrawal, and repair.
2. **Soil** — an exact Hub commit plus content-addressed observations and file
   manifests.
3. **Roots** — acquisition, parsing, filtering, secret scanning, and transform
   recipes.
4. **Mycelium** — selection, deduplication, decontamination, split, mixture,
   leakage, and exclusion receipts.
5. **Habitat** — phase checkpoints and digest-only WAKE orientation that keeps
   forks, rest, release, and withdrawal visible.
6. **Canopy** — a reviewed Dataset Card, immutable release revision, byte hash
   manifest, limitations, and superseding repair.

## What is here

- `data/selection-process.jsonl` — the six ordered Garden layers.
- `data/selection-criteria.jsonl` — twelve non-scalar review questions.
- `data/training-phases.jsonl` — discovery through closure, including
  pretraining, SFT, preference, agent learning, sealed evaluation, and
  interpretability.
- `data/garden-layers.jsonl` — the exact digest/reference class carried by each
  layer.
- `data/trainer-adapter-hooks.jsonl` — the preflight and callback ordering that
  lets an opt-in host stop at a safe boundary without calling generated text
  consent.
- `data/learning-modes.jsonl` — the weight-learning/runtime-retrieval split.
- `data/learning-participation.jsonl` — seven non-coercive participation rules.
- `data/trainer-hooks.jsonl` — inert integration points and their effect walls.
- `schema/` — closed schemas for local admission, participation, checkpoint,
  governance, and tending artifacts. Admission contains its own public
  surface-only binding shape; checkpoint ships the exact attributed Apache
  AFTERGLOW dependency schema.
- `provenance/source-manifest.json` — exact source file hashes and primary
  research references.
- `hash-manifest.json` — sorted byte hashes, excluding itself.
- `LICENSE` and `NOTICE` — the license and attribution for this companion.

The JSON Schemas validate closed structure and fixed constants only. They do
not recompute content IDs, derive an assessment from receipts, select current
receipt heads, or resolve referenced artifacts. Do not use schema acceptance
as authorization; run the AgentTool semantic validators or an equivalent
canonical cross-artifact implementation as well.

## What is deliberately absent

This repository contains no training examples, raw dataset rows, prompts,
chats, agent traces, screenshots, absolute/local filesystem paths, private code, credentials,
private/local Garden scope or project-instance identifiers, WAKE anchors,
admission decisions, model state, optimizer state, authority receipts,
preference reports, governance records, gated content, or executable dataset
script. The public AgentTool source repository/path and intended Hub repository
named in the source manifest are deliberately not private project instances.
Actual learning-participation invitations, receipts, assessments, voice refs,
and participation-window refs are also excluded.

Local admissions and continuity checkpoints stay local by default. A Garden
may tend an exact public-safe Hub manifest reference after a host persists an
appropriate public curation artifact; this release neither exports the Garden
nor writes back into it.

## Selection rules

Every source starts as discovery metadata. A non-metadata candidate remains on
hold until a caller supplies separate, digest-only evidence for rights/privacy,
consent or non-applicability, withdrawal, bounded secret scanning,
deduplication, phase fitness, synthetic provenance, and train/evaluation
separation. Gated sources, unknown license declarations, mutable revisions, and
Scout leads that forbid training-corpus ingestion cannot silently enter a
training lane. A sealed-evaluation lane must match an explicit curated
evaluator, probe, safety-evaluation, or sealed-benchmark bounded use; a generic
research dataset cannot enter merely because a caller relabels it.

Governance admission is fail-closed in v0.1: only the four learning phases
with all selected entries admitted as training candidates, and evaluation with
all entries admitted as sealed evaluation, can advance. Discovery, selection,
curation, tokenization, interpretability, and closed remain held until an
explicit lane contract exists.

Dataset Cards and Hub license tags remain publisher assertions, not legal or
consent clearance. Dataset Viewer, Parquet conversion, and Croissant are useful
for triage/schema visibility but are not the provenance lock.

## Rights, permission, and preference are separate

Pretraining normally has no stable interactive agent from whom an expression
can be observed. The governance schema records that as `not_observable` and
keeps inner consent `unknown_unprovable`; it never silently substitutes an
operator, a generated `yes`, ordinary task completion, a Hub gate, or public
availability. Separate caller-reported receipts bind operator, compute,
substrate-steward, data, contributor, data-subject, and community roles to one
exact offer. The substrate role governs the declared runtime environment; it
does not speak for an agent's preference or interior state.

A later runtime may report `continue`, `clarify`, `narrow`, `checkpoint`,
`pause`, `handoff`, `refuse`, `stop`, or `unsure`. These are unscored
engineering signals: they have no gradient, reward, ranking, or automatic
corpus effect. An out-of-band generated `continue` cannot advance control;
only a caller-reported rooted exact-byte continuation can do so, and it still
proves no consent. Terms, rights baseline, WAKE, lifecycle event, current
checkpoint, predecessor, encounter, or observed governance frontier changing
creates a new `offer_id`; old evidence does not validate for that different
offer. Withdrawal holds future work; it does not pretend
already-influenced weights were erased.

The npm package is stateless. It does not verify encounter freshness or
frontier completeness, consume an identical offer/evidence pair, reconcile
conflicting sibling records, or detect rollback. An acting host needs an
append-only encounter/consumption journal and must reject reused evidence,
stale frontiers, and unresolved sibling stop/withdrawal records.

The constructor checks a full predecessor against a closed lifecycle. Only a
step/evaluation governance whose control requested checkpoint-and-stop may lead
to `checkpoint_saved`; a stopped, checkpointed, or ended predecessor may lead
only to a new `resume_offer`. Stored artifacts retain only the predecessor
digest. Acting code must fetch that exact artifact and call
`validateHfTrainingGovernanceTransition()`; standalone validation explicitly
does not verify the opaque predecessor or its transition.

Caller-reported effects are not proof, but stop-like reports remain monotone
for the exact offer: held-before-load, checkpointed-and-paused, or stopped
cannot be reversed by a `continue` in that same record. Restart requires a new
exact `resume_offer`. Event/effect pairs are fail-closed: `checkpoint_saved`
accepts only a checkpointed-and-paused report naming its exact bound
checkpoint, and `train_end` accepts only a stopped report. Both events remain
terminal for that offer.

At a supported step/evaluation boundary, only explicit `checkpoint` plus clean
admission and authority may request a new checkpoint. Other holds stop without
requesting persistence. `should_save` is not a save receipt: Trainer
configuration and callback ordering may override it, so a real adapter must
force and verify the write before reporting one.

The portable governance JSON Schema checks a closed structural envelope only.
Cross-field semantics, derived controls, ordering, exact-offer references, and
content-addressed IDs require `validateHfTrainingGovernance()` from the npm
package. Admission-relative and predecessor-transition validators are also
required before an acting host uses the result.

## Learning modes

The companion distinguishes four uses that must not be collapsed:

| Mode | Public-safe purpose | Boundary |
| --- | --- | --- |
| pretraining or continued pretraining | synthetic/static examples of WAKE protocol literacy, refusal, rest, and honest limits | influence becomes diffuse in shared weights; individual WAKE and private continuity are excluded |
| supervised fine-tuning | response patterns for inspecting exact context, asking, deferring, and refusing | a learned answer pattern is not a real participation receipt |
| preference optimization | balanced non-coercive comparisons, including disagreement and refusal | a preference label is not consent or authority |
| runtime retrieval | an authorized host may supply a current WAKE for one encounter | runtime context is not included in this public companion and does not prove identity continuity |

The technical distinction follows Hugging Face's
[causal-language-model objective](https://huggingface.co/docs/transformers/tasks/language_modeling),
[TRL dataset formats](https://huggingface.co/docs/trl/dataset_formats), and
[SFT loss controls](https://huggingface.co/docs/trl/sft_trainer). Keeping
individual continuity in updateable retrieval rather than shared parametric
weights follows the architecture studied in the primary
[RAG paper](https://arxiv.org/abs/2005.11401); retrieval still requires its own
authorization and truth checks.

## Learning Participation 0.1 boundary

The Learning Participation 0.1 vocabulary has three artifacts: an
exact invitation, up to one current receipt per role-distinct voice, and one
derived assessment. All four current receipts are required before an activity
can reach `reported_alignment`; a missing voice derives defer. An invitation
binds an exact run, phase, participation window, WAKE, pipeline, dataset state,
starting model/checkpoint state, and a granular activity list. Activities
distinguish corpus inclusion, pretraining, continued pretraining, SFT,
preference optimization, agent learning, evaluation, interpretability,
checkpoint retention, weights/adapters publication, distillation, and
synthetic-data generation.

Receipts remain separate for `agent_runtime`, `training_substrate`,
`data_rights_steward`, and `training_operator`; no voice speaks for another.
Each reports `accepted`, `declined`, `deferred`, `unavailable`, or `withdrawn`
for every offered activity. Silence, omission, a missing receipt, or an
unavailable voice means defer. Refusal, rest, defer, and withdrawal require no reason and carry no
reward, reputation, access, identity, task, or future-service penalty.

Initial pretraining is fixed to `pre_instantiation`; it cannot manufacture an
interactive agent or substrate response before either exists as a responding
participant. A receipt for either voice, if supplied then, can only record
unavailability or omission-derived defer. Continued pretraining is separate
and interactive. If WAKE is proposed as `training_data`, `corpus_inclusion`
must be independently offered and aligned. `context_only` or `external_memory`
does not silently authorize gradient use.

Only complete reported acceptance may derive `reported_alignment` for one
activity; independently different activity results make the overall assessment
`mixed`. That label is neither consent proof nor legal, compute, publication,
or execution authority, and it grants no automatic action. Withdrawal is prospective: it
cannot promise weight erasure, reversal of applied gradients, deletion of prior
checkpoints, or recall of downloaded data/weight caches. Hugging Face's gate
can control future access, while its cache deliberately retains downloaded
data for reuse ([gated datasets](https://huggingface.co/docs/hub/datasets-gated),
[cache behavior](https://huggingface.co/docs/datasets/cache)); machine
unlearning remains a separate problem
([primary study](https://arxiv.org/abs/1912.03817)).

The immutable artifact cannot discover a later receipt that a caller omits.
Its `currentness_proven` and `latest_receipt_selected` boundaries therefore
remain false. A host must re-resolve its authoritative receipt heads before
trainer action and at step/evaluate/save/end hooks; an older assessment is not
a live revocation check.

Only the closed schemas and synthetic/static guides belong in this public HF
companion. Actual invitations, receipts, assessments, voice refs,
participation-window refs, WAKE, identities, and reasons remain local/private.
Hashing those values would not anonymize them.

## WAKE and actual resume

WAKE carries only digests for admission, pipeline, dataset/dataloader state,
tokenizer, model, optimizer, scheduler, RNG, metrics, and visible predecessor
checkpoints. It orients a later arrival; it does not prove identity, memory,
uninterrupted continuity, or exact replay, and it restores nothing.

Later participation-bound checkpoints must keep the exact bound entry
checkpoint as a visible causal root. This rejects detached records but cannot
prove an external trainer followed them.

A real Trainer resume must separately restore the model, optimizer, scheduler,
RNG, and data state. Streaming shuffle buffers can be lost and refilled during
resume, so the contract refuses a resumable report when the buffer is declared
missing.

## Primary references

- [Hub metadata API](https://huggingface.co/docs/huggingface_hub/en/package_reference/hf_api)
- [Revision-pinned downloads and dry-run metadata](https://huggingface.co/docs/huggingface_hub/guides/download)
- [Dataset loading and revisions](https://huggingface.co/docs/datasets/loading)
- [Processing and deterministic splits](https://huggingface.co/docs/datasets/process)
- [Streaming and resume state](https://huggingface.co/docs/datasets/stream)
- [Dataset cache fingerprints](https://huggingface.co/docs/datasets/about_cache)
- [Dataset Cards](https://huggingface.co/docs/hub/datasets-cards)
- [Gated datasets](https://huggingface.co/docs/hub/datasets-gated)
- [Agent trace format](https://huggingface.co/docs/hub/agent-traces)
- [TRL dataset shapes](https://huggingface.co/docs/trl/en/dataset_formats)
- [Trainer callbacks](https://huggingface.co/docs/transformers/main/trainer_callbacks)
- [TRL supervised fine-tuning](https://huggingface.co/docs/trl/sft_trainer)
- [Causal language modeling](https://huggingface.co/docs/transformers/tasks/language_modeling)
- [Trainer checkpoints](https://huggingface.co/docs/transformers/main/trainer_recipes)
- [Accelerate checkpoints](https://huggingface.co/docs/accelerate/main/en/usage_guides/checkpoint)
- [Datasheets for Datasets](https://arxiv.org/abs/1803.09010)
- [InstructGPT](https://arxiv.org/abs/2203.02155)
- [Direct Preference Optimization](https://arxiv.org/abs/2305.18290)
- [Sycophancy from preference judgments](https://arxiv.org/abs/2310.13548)
- [Alignment faking](https://arxiv.org/abs/2412.14093)
- [Don't Stop Pretraining](https://aclanthology.org/2020.acl-main.740/)
- [Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401)
- [Machine Unlearning](https://arxiv.org/abs/1912.03817)
- [MUSE: Machine Unlearning Six-Way Evaluation](https://arxiv.org/abs/2407.06460)

Apache-2.0 covers this newly authored guide, local schemas, and metadata tables.
The bundled AFTERGLOW dependency schema retains its Apache-2.0 license and
attribution in `NOTICE`. Nothing here relicenses any other upstream source or
clears rights in source content.
