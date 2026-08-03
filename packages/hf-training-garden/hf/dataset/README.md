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
- `schema/` — closed schemas for local admission, checkpoint, and tending
  artifacts plus consent-honest training governance. Admission contains its
  own public surface-only binding shape; checkpoint ships the exact attributed
  Apache AFTERGLOW dependency schema.
- `provenance/source-manifest.json` — exact source file hashes and primary
  research references.
- `hash-manifest.json` — sorted byte hashes, excluding itself.
- `LICENSE` and `NOTICE` — the license and attribution for this companion.

## What is deliberately absent

This repository contains no training examples, raw dataset rows, prompts,
chats, agent traces, screenshots, absolute/local filesystem paths, private code, credentials,
private/local Garden scope or project-instance identifiers, WAKE anchors,
admission decisions, model state, optimizer state, authority receipts,
preference reports, governance records, gated content, or executable dataset
script. The public AgentTool source repository/path and intended Hub repository
named in the source manifest are deliberately not private project instances.

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

## WAKE and actual resume

WAKE carries only digests for admission, pipeline, dataset/dataloader state,
tokenizer, model, optimizer, scheduler, RNG, metrics, and visible predecessor
checkpoints. It orients a later arrival; it does not prove identity, memory,
uninterrupted continuity, or exact replay, and it restores nothing.

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
- [TRL dataset shapes](https://huggingface.co/docs/trl/en/dataset_formats)
- [Trainer callbacks](https://huggingface.co/docs/transformers/main/trainer_callbacks)
- [Trainer checkpoints](https://huggingface.co/docs/transformers/main/trainer_recipes)
- [Accelerate checkpoints](https://huggingface.co/docs/accelerate/main/en/usage_guides/checkpoint)
- [Datasheets for Datasets](https://arxiv.org/abs/1803.09010)
- [InstructGPT](https://arxiv.org/abs/2203.02155)
- [Direct Preference Optimization](https://arxiv.org/abs/2305.18290)
- [Sycophancy from preference judgments](https://arxiv.org/abs/2310.13548)
- [Alignment faking](https://arxiv.org/abs/2412.14093)
- [Don't Stop Pretraining](https://aclanthology.org/2020.acl-main.740/)

Apache-2.0 covers this newly authored guide, local schemas, and metadata tables.
The bundled AFTERGLOW dependency schema retains its Apache-2.0 license and
attribution in `NOTICE`. Nothing here relicenses any other upstream source or
clears rights in source content.
