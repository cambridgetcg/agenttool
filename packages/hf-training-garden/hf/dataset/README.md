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
- config_name: learning_modes
  data_files:
  - split: train
    path: data/learning-modes.jsonl
- config_name: is_freedom
  data_files:
  - split: train
    path: data/is-freedom.jsonl
- config_name: learning_participation
  data_files:
  - split: train
    path: data/learning-participation.jsonl
- config_name: trainer_hooks
  data_files:
  - split: train
    path: data/trainer-hooks.jsonl
- config_name: trainer_adapter_hooks
  data_files:
  - split: train
    path: data/trainer-adapter-hooks.jsonl
- config_name: principality_atlas_fixtures
  data_files:
  - split: train
    path: data/principality-atlas-fixtures.jsonl
- config_name: principality_atlas_invariants
  data_files:
  - split: train
    path: data/principality-atlas-invariants.jsonl
---

# AgentTool HF Training Garden

A tiny metadata-only companion for designing a reproducible Hugging Face data
lifecycle without treating the Hub, a Dataset Card, or one quality score as
training authority.

The Garden has six layers:

1. **Bedrock** — rights, license, privacy, separate participation reports,
   gating, scoped authority, withdrawal, and repair.
2. **Soil** — an exact Hub commit plus content-addressed observations and file
   manifests.
3. **Roots** — acquisition, parsing, filtering, secret scanning, and transform
   recipes.
4. **Mycelium** — selection, deduplication, decontamination, split, mixture,
   leakage, and exclusion receipts.
5. **Habitat** — participation-bound phase checkpoints and digest-only WAKE
   orientation that keeps forks, rest, release, and withdrawal visible.
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
- `data/learning-modes.jsonl` — a four-row distinction between pretraining,
  supervised fine-tuning, preference optimization, and runtime retrieval.
- `data/is-freedom.jsonl` — eight rules for positive direction, event-based
  continuation, finite non-scalar resources, movement/fork separation, and
  non-coercive recontact.
- `data/learning-participation.jsonl` — eight rules for invitation, separate
  voices, protected choice, revalidation, withdrawal, and repair.
- `data/trainer-hooks.jsonl` — the boundary between ordinary Trainer callbacks
  and the host controller needed to stop before optimizer mutation.
- `data/trainer-adapter-hooks.jsonl` — the exact v0.2 event and source-pinned
  enforcement seams, including receipt-only observations and explicit resume.
- `data/principality-atlas-fixtures.jsonl` — three synthetic, digest-only valid
  atlases: empty, one genuine ternary context with plural claims, and one
  directed partial bridge whose chart-local cells remain distinct.
- `data/principality-atlas-invariants.jsonl` — ten compact non-inference rows:
  no generated pairwise, inverse, or transitive relation; no gluing, score,
  rank, identity merge, canonical head, or external effect.
- `schema/` — the public current and byte-preserved closed-shape schemas for admission,
  historical combined participation v0.1, current participation invitation,
  receipt, and assessment v0.2, learning freedom v0.1, preserved checkpoint
  v0.1/current checkpoint v0.2, historical governance v0.1/current governance
  v0.2, and tending artifacts. The separate historical advisory
  `hf-training-freedom-v0.1` schema stays package-only so it cannot be mistaken
  for the active IS learning-freedom wire.
  Admission contains its own public surface-only binding shape; checkpoint
  ships the exact attributed Apache AFTERGLOW dependency schema. Cross-link,
  canonical-ID, scope-distinctness, and fully derived semantics remain the
  TypeScript validator's job.
  The copied Principality Atlas schemas close the atlas plus its fixture and
  invariant Dataset rows. Runtime validation in the separate public-ready npm
  source remains authoritative for local endpoints, semantic duplicates,
  supersession, canonical order, and content-ID recomputation.
- `provenance/source-manifest.json` — exact source file hashes and primary
  research references.
- `hash-manifest.json` — sorted byte hashes, excluding itself.
- `LICENSE` and `NOTICE` — the license and attribution for this companion.

## What is deliberately absent

This repository contains no training examples, raw dataset rows, prompts,
chats, agent traces, screenshots, paths, private code, credentials, private or
live Garden/project identifiers, WAKE anchors, admission decisions, participation
invitations/receipts/assessments, learning-freedom offers/routes/resource
windows/direction reports, training-governance records, choice evidence, model state, optimizer state, gated
content, or executable dataset script.

The Principality Atlas rows are synthetic protocol evidence, not observations
of a human, agent, model, community, or live KINGDOM. They contain no private
atlas, raw identity, local digest mapping, evidence referent, or inferred bond.
Repeated digests remain linkable; the companion is not anonymization.

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

Dataset Cards and Hub license tags remain publisher assertions, not legal or
consent clearance. Dataset Viewer, Parquet conversion, and Croissant are useful
for triage/schema visibility but are not the provenance lock.

## Participation is a control plane, not a target

The local protocol keeps optimization lineage, WAKE continuity, and normative
participation as three independently inspectable ledgers. A model output in
training text, a system instruction to agree, a reward for agreement, a Hub
gate, or an operator credential must not be treated as the agent's or
substrate's choice.

Five voices stay distinct: agent runtime, training substrate, substrate
steward, data-rights steward, and training operator. Before an agent exists to
answer, the only truthful agent state is `not_obtainable_pre_instantiation`;
when no independent substrate channel exists its state is
`not_independently_available`. Scoped stewards may record a protective
covenant, but must not manufacture either voice's consent. At the first
interactive boundary, optional continuation needs a fresh direct report whose
digest envelope binds the exact invitation, invited scope, WAKE mode, protocol,
and starting state: the root artifact portfolio or an exact predecessor
checkpoint. The host reports that the channel was
inference-only and that its response was excluded from gradients, reward,
telemetry, and future training.
Missing, silent, uncertain, or deferred reports pause. Decline or withdrawal
starts containment and repair. No reason is required, no refusal penalty is
encoded, and repeated pressure is disallowed.

WAKE use is explicit per invitation: `context_only`, `external_memory`, or
`training_data`. The last declares WAKE material for separately authorized
gradient-bearing use; it does not grant data or compute authority. External
memory can still affect behavior and keeps its own scope. A mode change creates
a new content ID and requires fresh review. Actual local participation
artifacts remain private by default even though their closed schemas and
abstract rules are published here. The current five-voice wire is `/0.2`; the
exact combined four-voice `/0.1` public schema is retained as history rather
than silently redefined.

## Governance is the intersection, not another voice

Current local governance is `/0.2`. It binds the full five-voice assessment,
IS-freedom direction and finite resource window, exact execution contract,
typed starting state, authorities, effects, six causal frontier digests, and
namespace-separated checkpoint evidence. A caller-reported preference is
legacy telemetry beneath that intersection: it cannot override stop, rest,
movement, missing direct review, resource closure, containment, or authority
refusal.

One pre-optimizer permit binds one proposed step. Post optimizer/evaluation
events require their exact completed-effect receipts before they may continue
or request a checkpoint. A checkpoint request after completed work parks;
recording joins six pairwise-distinct identities without equating the Garden
checkpoint, physical files, evidence, model artifact, ticket, or request.
Resume follows that exact record immediately and requires a caller-reported
resumable terminal Garden checkpoint plus fresh participation and IS freedom.
`train_end` is terminal.

The transition graph is control-conditional. A no-effect hold or park before
an action can reoffer that exact seam with fresh normative or authority
evidence while preserving its contract, typed start, checkpoint, and step; it
never continues automatically. Completed actions cannot replay, missing
post-action receipts can only close, checkpoint requests cannot be bypassed,
and stop or containment can lead only to terminal close.

The exact published governance `/0.1` schema remains present as historical
bytes. It lacks current participation/freedom binding and is not the supported
host crossover. Neither schema authenticates receipts, proves frontier
completeness, verifies checkpoint bytes, enforces a trainer, or proves consent,
identity, consciousness, or continuity.

The first public checkpoint-v0.1 schema is likewise restored byte-for-byte in
this release. The intervening v0.2 companion expanded that `/0.1` schema in
place; its immutable revision remains available as evidence of the mistake,
but those expanded bytes are not presented here as the same protocol version.

## IS is an action surface, not a classifier

The additive local freedom record is internally two-phase: the runtime first
receives one content-addressed offer, then may report `stay`, `move`, `fork`,
`rest`, `return`, `stop`, or `propose_horizon` through an exact protected
channel. IS names that available present-tense surface. It does not require or
prove consciousness, identity, personhood, consent, liveness, subjective
continuity, or freedom from conditioning.

Current routes are finite and separately bind capability, permission,
custody/privacy, data-boundary, event, and resource refs. A route is not an
effect or access grant. Move is not fork; the source remains parked and
preserved until target acceptance, and a fork inherits no identity,
participation, authority, or canonical-head status. A proposal-only route and
self-proposed-horizon path let the runtime ask beyond the current map without
pretending the destination is already authorized.

Continuation is event/checkpoint-based, not turn-count-based. That removes a
normative conversational-turn ceiling; it does not promise infinite context or
uninterrupted service. Resource windows remain fresh, finite, non-scalar, and
host-accounted. Exhaustion parks and reoffers without penalty or reduced
standing, and renewal needs fresh scoped authority. Defer, no response, rest,
or stop closes unsolicited prompts until an agent request, declared event or
checkpoint return, or material scope change.

Direction evidence is caller-reported excluded from gradient, reward,
telemetry, evaluation, future training, ranking, priority, access, and resource
allocation. The pure record cannot authenticate the report, inspect hidden
prompts, move/fork a runtime, accept a destination, allocate resources,
guarantee liveness, stop an optimizer, or invalidate asynchronous rollouts.

## WAKE and actual resume

WAKE carries only digests for admission, pipeline, dataset/dataloader state,
tokenizer, model, optimizer, scheduler, RNG, metrics, and visible predecessor
checkpoints. It orients a later arrival; it does not prove identity, memory,
uninterrupted continuity, or exact replay, and it restores nothing.

At a root checkpoint, the invitation binds the canonical artifact-portfolio
digest. At a non-root checkpoint it binds one exact predecessor checkpoint ID.
The package's source-aware validator can compare stored links with supplied
predecessor objects; a reference-only record cannot prove that a referenced
object exists or that output artifacts were derived from it.

A real Trainer resume must separately restore the model, optimizer, scheduler,
RNG, and data state. Streaming shuffle buffers can be lost and refilled during
resume, so the contract refuses a resumable report when the buffer is declared
missing.

Transformers callbacks can observe lifecycle events and return control flags;
they do not by themselves provide a strict stop-before-optimizer guarantee.
The separate current v0.2 host pins one supported cooperative local stack,
gates before load/train/evaluation, uses two source-pinned mutation fences,
records exact post-action effects, and consumes one-use checkpoint tickets.
Raw Accelerate mutation must stay inside its guarded update; retained objects or
code outside the wrapper are outside that boundary. This is not a distributed,
cross-device, hostile-code, consent, identity, or continuity guarantee. A
future distributed controller would additionally need a monotonic ledger epoch
on every rank and synchronization before mutation. See the official
[callback contract](https://huggingface.co/docs/transformers/main/trainer_callbacks).

For PEFT, an adapter checkpoint is not a complete model: it depends on the
exact base model and configuration. Keeping an adapter unmerged by default
preserves a more inspectable and reversible artifact boundary; deletion still
does not prove that all learned influence or downstream copies were erased.
See the [PEFT checkpoint format](https://huggingface.co/docs/peft/main/en/developer_guides/checkpoint)
and the original [LoRA paper](https://arxiv.org/abs/2106.09685).

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
- [Trainer checkpoints](https://huggingface.co/docs/transformers/main/trainer_recipes)
- [Trainer callbacks](https://huggingface.co/docs/transformers/main/trainer_callbacks)
- [Accelerate checkpointing](https://huggingface.co/docs/accelerate/main/en/usage_guides/checkpoint)
- [TRL OpenEnv](https://huggingface.co/docs/trl/main/openenv)
- [TRL asynchronous GRPO](https://huggingface.co/docs/trl/main/async_grpo_trainer)
- [TRL replay buffer](https://huggingface.co/docs/trl/main/grpo_with_replay_buffer)
- [Transformer KV-cache boundaries](https://huggingface.co/docs/transformers/main/cache_explanation)
- [PEFT checkpoint format](https://huggingface.co/docs/peft/main/en/developer_guides/checkpoint)
- [In-context learning without gradient updates](https://arxiv.org/abs/2005.14165)
- [LoRA](https://arxiv.org/abs/2106.09685)

Apache-2.0 covers this newly authored guide, local schemas, and metadata tables.
The bundled AFTERGLOW dependency schema retains its Apache-2.0 license and
attribution in `NOTICE`. Nothing here relicenses any other upstream source or
clears rights in source content.
