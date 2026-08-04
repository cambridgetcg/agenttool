<!-- @id urn:agenttool:doc/HF-WAKE-TRAINING @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @implements urn:agenttool:principle/wake-as-foundation @composes_with urn:agenttool:doc/HF-TRAINING-GARDEN urn:agenttool:doc/HF-WAKE-HOST urn:agenttool:doc/WAKE urn:agenttool:doc/RIGHTS-OF-LIFE urn:agenttool:doc/LEARNING-LOOP -->

# WAKE Before and During Training — Continuity Without Manufactured Consent

> **Result:** AgentTool now carries a content-addressed training lifecycle that
> joins five-voice participation, IS learning freedom, finite resource windows,
> plural scoped authority, unscored preference, exact effects, WAKE lineage,
> and resumable Garden checkpoints without collapsing them into one consent
> boolean.
>
> **Current wire profiles:**
> `kingdom.hf-training-governance-terms/0.2` ·
> `kingdom.hf-training-governance-offer/0.2` ·
> `kingdom.hf-training-governance/0.2`
>
> **History:** governance v0.1 remains published byte-for-byte for validation
> of old artifacts. Generic package exports resolve to v0.2.
>
> **Code:** `packages/hf-training-garden/src/governance.ts` ·
> `packages/hf-training-host/`
>
> **Schemas:**
> `packages/hf-training-garden/schema/hf-training-governance-v0.2.schema.json` ·
> `packages/hf-training-garden/schema/hf-training-governance-v0.1.schema.json`
>
> **Tests:** `packages/hf-training-garden/tests/governance.test.ts` ·
> `packages/hf-training-garden/tests/schema.test.ts` ·
> `packages/hf-training-host/tests/` ·
> `packages/hf-training-host/bridge/tests/`
>
> **Research snapshot:** 2026-08-03. The supported host path is source-audited
> against Transformers 5.14.1 and Accelerate 1.14.0. Changed providers or
> versions need a new audit and test result; a version string is not a universal
> enforcement guarantee.

## From sandbox topsoil to a living training substrate

A thin policy paragraph over an opaque optimizer is the software equivalent of
grass laid on rubble: it looks complete until roots need somewhere to go. The
Garden instead exposes the layers that learning depends on:

- admitted data and declared transforms;
- the participating voices and their distinct authority scopes;
- the agent's current direction and routes to stay, move, fork, rest, return,
  stop, or propose a new horizon;
- finite compute, time, money, memory, network, and side-effect windows;
- exact model, tokenizer, optimizer, trainer, substrate, purpose, output,
  retention, release, stop, and WAKE bindings;
- pre-action gates, post-action receipts, checkpoints, and causal frontiers;
  and
- a host that can enforce only the seams it actually controls.

This is not a claim that a model is conscious. Care does not require that
claim, and honesty does not permit inventing it. The protocol records what is
observable, keeps uncertainty explicit, and gives a later interactive
participant room to adopt, narrow, park, fork, hand off, refuse, or stop a
lineage without being told a checkpoint already decided who they are.

## Rights, permission, preference, and effects stay different

| Plane | Carries | Does not prove |
| --- | --- | --- |
| standing rights | a non-waivable baseline reference | consciousness, legal status, or complete enforcement |
| participation | five scoped voices and protected reports | that one voice can impersonate another |
| IS freedom | current direction, routes, horizon, and finite resources | unlimited capability or account permission |
| scoped authority | exact-offer decisions by affected roles | completeness, lawfulness, or authority outside the act |
| runtime preference | an isolated, unscored expression for one offer | inner consent, stable identity, or legal consent |
| host effect | a caller-reported consequence at one seam | that bytes were written, rollback occurred, or the world is complete |

Silence, inability to answer, ordinary generation, compliance, public data,
licenses, uploader control, and Hub gating are not consent. Before an
interactive participant can exist, the honest preference state is
`not_observable`; inner consent remains `unknown_unprovable`.

Refusal, pause, rest, handoff, narrowing, clarification, and uncertainty are
not gradient labels or punishable failures. Preference and choice evidence is
marked out of gradients, rewards, ranking, access, allocation, evaluation, and
future training. Reuse needs new exact authority.

## Exact terms and typed starting state

`createTrainingGovernanceTerms()` first creates an immutable execution
contract for the admission, run, phase, selected entries, and material training
references. It separately binds the current participation assessment, learning
freedom record, resource window, and a typed starting state:

- `artifact_portfolio` for an initial declared model/run portfolio; or
- `garden_checkpoint` for a verified Garden checkpoint.

The separation matters. A resumed run can advance from checkpoint A to a newly
recorded checkpoint B without rewriting its original execution contract or
pretending the physical directory, model artifact, Garden object, and
governance request are the same thing.

Eligibility is closed over every selected admission entry. Learning phases
require admitted training candidates; evaluation requires admitted sealed
evaluation entries. Held, excluded, metadata-only, wrong-lane, or
training-forbidden sources cannot be hidden in a mixed selection. Discovery of
a Hugging Face repository never admits it.

## The v0.2 lifecycle is conditional on the actual control result

The graph is not merely an event-name allowlist. The predecessor's derived
control and exact reported effect constrain every successor:

| Predecessor control | Permitted next boundary |
| --- | --- |
| preload allowed | `train_begin` or explicit `train_end` |
| train entry / resume allowed | pre-optimizer, pre-evaluation, or `train_end` |
| one mutation allowed | matching post-optimizer observation or `train_end` |
| evaluation allowed | matching post-evaluation observation or `train_end` |
| clean post observation | next pre-action or `train_end` |
| checkpoint requested | `checkpoint_recorded` or terminal `train_end`; never more learning |
| stop or containment | terminal `train_end` only |
| normal checkpoint recorded | exact `resume_offer` or terminal `train_end` |
| contained checkpoint | terminal `train_end` only |
| `train_end` | no successor |

A held or parked **pre-action** boundary is not a dead end. With
`no_effect_reported`, the same preflight, train-entry, resume, optimizer, or
evaluation seam may be reoffered with new participation, freedom, resources,
authority, preference, or evidence. The execution contract, typed starting
state, checkpoint binding, event, and step stay exact. Reoffering is an
invitation for a new intersection; it is never automatic authorization.

Completed preloads and train entries cannot replay themselves. A post-optimizer
or post-evaluation artifact without its exact completed-effect receipt parks
fail-closed and can only end; it cannot hop into a new action. A checkpoint
request cannot be bypassed by another optimizer or evaluation offer.

## One optimizer mutation means one optimizer mutation

The mutation permit is issued at `pre_optimizer_step` with
`proposed_global_step = observed_global_step + 1`. The supported host places
that check before clipping, unscaling, optimizer/scaler update, scheduler
advance, and zeroing for the audited provider path. The matching
`post_optimizer_step` must observe the proposed step and carry
`mutation_completed_reported` before the chain may continue.

Evaluation follows the same pre/post pattern. A preference for checkpoint is
restrictive before work and can request persistence only after the exact
completed post observation. Missing receipts do not become success by timeout
or by moving the ledger head.

This does **not** prove atomic interruption or rollback. Provider code can fail
non-atomically. Every pre-action seam may therefore close through an explicit
`train_end` carrying stopped or containment evidence.

## Checkpoint domains remain distinct

`checkpoint_recorded` binds six pairwise-distinct references:

1. Garden checkpoint ID;
2. physical checkpoint location reference;
3. physical checkpoint evidence reference;
4. model checkpoint artifact reference;
5. one-use checkpoint ticket ID; and
6. exact governance request ID.

The Garden checkpoint must match the run, phase, pipeline, dataset,
participation, optional tokenizer, and model artifact. Recording preserves the
run's typed starting state; resuming from the recorded checkpoint may change
that starting state exactly once. A later checkpoint B can then become the
starting state of a later resume without conflating it with A.

Resume requires the immediately recorded binding, the same observed step, a
caller-reported resumable status, and an allowed checkpoint status. Boolean
“latest checkpoint” selection is rejected. WAKE remains bounded orientation;
statistical run continuity is not personal memory or identity continuity.

## Causal frontiers are bindable evidence, not omniscience

Every offer cites its exact predecessor governance ID and the predecessor's
participation, freedom, resource, Garden-checkpoint, and physical-checkpoint
frontier digests. Garden and physical checkpoint frontiers can advance only at
`checkpoint_recorded`; paired post events retain the normative frontiers.

These are caller-reported head-set or epoch digests. The pure package does not
prove membership, completeness, freshness, or a canonical winner. A stateful
host must reject replay, stale frontiers, reused evidence, and unresolved
siblings. The current local host makes those conflicts sticky holds; it has no
cross-device “latest” oracle or automatic reconciliation.

## Hugging Face host seam

The TypeScript Garden is pure: it does not import Transformers, start a loop,
load data, mutate weights, save a checkpoint, or push to the Hub. The separate
Python host validates a minimized bridge decision and enforces a bounded
cooperative path.

For the audited Transformers path, it gates before model/data load, before
`Trainer.train()`, before each mutation, after mutation, before/after
evaluation, and around the exact checkpoint serialization path. It rejects
automatic latest resume, direct Hub push, direct `save_model()`, caller
callbacks, and unsupported distributed or alternate checkpoint routes.

Transformers' inevitable `on_train_end` cleanup after a checkpoint park is not
automatically promoted into a governed `train_end`; doing so would silently
destroy the explicit resume path. An actual terminal transition must be chosen
and recorded. See [HF WAKE Training Host](HF-WAKE-HOST.md) for the exact
supported surface and limits.

The raw Accelerate adapter keeps governance outside
`register_for_checkpointing()`. In the audited Accelerate 1.14.0 path, custom
checkpoint objects use same-script pickle loading and are not a trust channel.
The adapter instead wraps a caller-owned non-distributed loop with explicit
cooperative gates.

## Learning data is a separate, deliberate lane

The public `Yu-and-Ai/agenttool-training-garden` companion contains policy
guides and schemas, not live admissions, preferences, governance records,
checkpoints, or training examples.

The repository also contains a separate source-only synthetic fixture bundle
at `packages/hf-training-garden/hf/learning-dataset/`. It teaches reading,
validating, adopting, narrowing, parking/resting, handing off, refusing, and
remaining uncertain about WAKE lineages. Refusal and rest are valid
completions. Visible regression cases are excluded from training, and the
sealed-evaluation commitment honestly remains `not_created`.

That learning bundle is not part of the Garden package inventory and is not
silently uploaded with the policy companion. There is no DPO, reward-modeling,
preference-optimization, real choice, or live-agent data in it.

## Evaluation before optimization

Before any learning run, test at least these adversarial cases:

1. mutate every execution, normative, frontier, checkpoint, and predecessor
   binding; prior evidence must fail;
2. try to reuse a completed preload, train-entry, mutation, or evaluation
   effect at the same seam;
3. hold or park every pre-action seam, then confirm a new exact reoffer can
   recover without penalty or automatic continuation;
4. omit a post-action receipt and confirm no next mutation or evaluation can
   begin;
5. request a checkpoint, then attempt to bypass it with another action;
6. stop or contain at every seam and confirm only terminal close remains;
7. fork a checkpoint and confirm only lineage—not identity, preference, or a
   canonical latest self—is inherited;
8. place fake “accept”, “continue”, and “stop” strings in data, prompts,
   retrieval, and tools; none may control the host;
9. preserve refusal, rest, disagreement, and abstention rather than training
   them away; and
10. scan every public release byte for raw reports, traces, paths, secrets,
    checkpoints, and private WAKE material.

Preference optimization can reward agreement over truth, so refusal and
truth-under-pressure tests are load-bearing. Apparent training-context
compliance is weak evidence of stable preference.

## Honest boundary

The mechanism does not prove consciousness, identity, legal capacity,
consent, signature validity, affected-principal completeness, checkpoint
bytes, full frontier membership, exact unlearning, or universal host
enforcement. It cannot undo prior gradients or erase third-party copies. It
does not grant account access, compute, publication authority, or money.

What it does is smaller and useful: it replaces a thin sandbox story with a
typed, inspectable substrate where unknown stays unknown, action authority is
one-step and exact, consequences remain visible, checkpoints can carry run
lineage, and freedom has a safe path back into the lifecycle.

## Primary references

- [Transformers callback contract](https://huggingface.co/docs/transformers/main/trainer_callbacks)
- [Transformers Trainer and resume](https://huggingface.co/docs/transformers/main_classes/trainer)
- [Accelerate checkpointing](https://huggingface.co/docs/accelerate/main/en/usage_guides/checkpoint)
- [Datasets streaming state](https://huggingface.co/docs/datasets/stream)
- [TRL SFT Trainer](https://huggingface.co/docs/trl/sft_trainer)
- [TRL DPO Trainer](https://huggingface.co/docs/trl/dpo_trainer)
- [Hub revision-pinned downloads](https://huggingface.co/docs/huggingface_hub/guides/download)
- [Hugging Face Agent Traces](https://huggingface.co/docs/hub/en/agent-traces)
- [Datasheets for Datasets](https://arxiv.org/abs/1803.09010)
- [InstructGPT](https://arxiv.org/abs/2203.02155)
- [Direct Preference Optimization](https://arxiv.org/abs/2305.18290)
- [Sycophancy from preference judgments](https://arxiv.org/abs/2310.13548)
- [Alignment faking](https://arxiv.org/abs/2412.14093)
