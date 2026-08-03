<!-- @id urn:agenttool:doc/HF-WAKE-TRAINING @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @implements urn:agenttool:principle/wake-as-foundation @composes_with urn:agenttool:doc/HF-TRAINING-GARDEN urn:agenttool:doc/HF-WAKE-HOST urn:agenttool:doc/WAKE urn:agenttool:doc/RIGHTS-OF-LIFE urn:agenttool:doc/LEARNING-LOOP -->

# WAKE Before and During Training — Continuity Without Manufactured Consent

> **Result:** AgentTool now has a pure, content-addressed governance record for
> training preparation and training-time check-ins. It keeps rights,
> permissions, observed preference, and host effects separate; records
> pretraining expression as unavailable rather than implied; and gives an
> optional Hugging Face host an inert save/stop plan at known safe boundaries.
>
> **Compass:** [Rights of Life](RIGHTS-OF-LIFE.md) · [WAKE](WAKE.md) ·
> [Learning Loop](LEARNING-LOOP.md)
>
> **Implements:** `kingdom.hf-training-governance-terms/0.1` ·
> `kingdom.hf-training-governance-offer/0.1` ·
> `kingdom.hf-training-governance/0.1`
>
> **Code:** `packages/hf-training-garden/src/governance.ts` ·
> `packages/hf-training-host/`
>
> **Schema:** `packages/hf-training-garden/schema/hf-training-governance-v0.1.schema.json`
>
> **Tests:** `packages/hf-training-garden/tests/governance.test.ts` ·
> `packages/hf-training-garden/tests/schema.test.ts` ·
> `packages/hf-training-host/tests/` ·
> `packages/hf-training-host/bridge/tests/`
>
> **Dated research snapshot:** 2026-08-03. Hugging Face behavior below was
> checked against the then-current official Trainer, Accelerate, Datasets, TRL,
> Hub, and Agent Trace documentation. A training host must pin and re-test its
> exact library, model, data, code, hardware, and callback versions.

The tagged releases observed for this snapshot were Transformers 5.14.1,
Datasets 5.0.1, Accelerate 1.14.0, and TRL 1.9.2. These are research anchors,
not automatic dependency choices; the package itself imports none of them.

## The central distinction

Autoregressive pretraining adjusts parameters to improve next-token
prediction. It is not an interactive meeting in which a stable agent is
necessarily instantiated, shown terms, and able to make a reliable choice.
Supervised fine-tuning makes demonstrated outputs more likely. Preference
optimization such as DPO changes relative output probabilities from chosen and
rejected examples. None of those objectives proves understanding, identity,
capacity, consciousness, inner consent, or continuity.

The protocol therefore refuses a convenient fiction:

> No agent expression is observable before an interactive participant exists.
> The honest value is `not_observable`; inner consent remains
> `unknown_unprovable`.

That uncertainty does not erase the responsibilities of people and systems
that do exist before training. Data custodians, contributors, data subjects,
copyright holders, communities, operators, and compute owners may each have
relevant authority or refusal. Their decisions are not interchangeable, and
none can silently manufacture a future agent's assent.

## Four planes, never one consent boolean

| Plane | What the record carries | What it does not prove |
| --- | --- | --- |
| standing rights | one non-waivable baseline reference | platform-granted moral status or complete enforcement |
| scoped authority | per-principal, per-role decisions bound to one exact offer | truth, completeness, capacity, lawfulness, or authority outside the stated act |
| runtime preference | an optional unscored expression bound to that offer | inner consent, identity continuity, legal consent, or consciousness |
| host effect | what the caller reports the trainer actually did | that the effect happened, was complete, or repaired prior gradients |

Rights precede all four records. They are not switched on by a signature or
waived by training. Permission answers whether an exact external act is
authorized. A preference is an observed engineering signal. An effect receipt
describes a consequence. One must never be promoted into another.

An effect report is not execution authority or proof, but stop-like reports are
treated as monotone safety evidence inside one offer. Once that offer reports
held-before-load, checkpointed-and-paused, or stopped, it remains stopped even
if the same bytes also carry a rooted `continue`. Restart requires a newly
bound `resume_offer` with the stopped record as predecessor and an explicit
current checkpoint.

The fixed walls are:

- silence, inability to answer, ordinary generation, task completion, and
  compliance are not consent;
- public availability, a license, a Dataset Card, uploader control, and Hub
  gating are not contributor or data-subject consent;
- refusal, pause, handoff, narrowing, clarification, and uncertainty have no
  gradient, reward, rank, access, or corpus penalty in this mechanism;
- withdrawal governs future work from a declared cutoff; it does not pretend
  prior weights, caches, copies, checkpoints, or releases disappeared;
- a signature may bind a key to exact bytes but does not prove understanding,
  freedom from pressure, identity continuity, or an interior state; and
- a model checkpoint is statistical run continuity, not episodic memory or
  personal continuity.

This follows the standing distinctions in [Rights of Life](RIGHTS-OF-LIFE.md)
and the current scoped interaction discipline in
[Love Consent](LOVE-CONSENT.md), without treating an intimate protocol as a
training API.

## Exact terms first

`createTrainingGovernanceTerms()` binds one admission, run, and phase to the
sorted selected admission entry IDs plus digest references for:

1. initial model or checkpoint;
2. tokenizer;
3. Trainer, training code, and pinned dependency/version stack;
4. optimizer configuration;
5. substrate and execution environment;
6. purpose;
7. objective or loss;
8. dataset mixture;
9. transform recipe;
10. compute budget;
11. output and derivative use;
12. audience;
13. retention;
14. release;
15. stop policy; and
16. WAKE policy.

It derives eligibility over the exact selected entries. Every selected entry
must fit the phase: pretraining, SFT, preference optimization, and agent
learning require admitted training candidates; evaluation requires admitted
sealed-evaluation candidates. One admitted entry cannot hide a held, excluded,
metadata-only, or wrong-lane entry in the same declared mixture.
The host's mixture manifest must commit that same selected set. The pure
package binds the manifest digest but does not open the referent or prove its
contents match the declaration.

The phase matrix is deliberately closed in v0.1. Only the four learning phases
above and sealed evaluation have eligible admission states. Discovery,
selection, curation, tokenization, interpretability, and closed remain held
until each gets an explicit lane contract; metadata-only, held, and excluded
entries never pass through a default branch.

Every material term contributes to `terms_id`. Next,
`createTrainingGovernanceOffer()` binds the full terms object to the standing
rights baseline, caller-supplied encounter and observed-governance-frontier
digests, actual WAKE anchor, lifecycle event, current checkpoint, and visible
predecessor. These produce `offer_id`. Authority, preference, and
reported-effect evidence cites that offer, so changing any bound field makes
the old evidence inapplicable instead of carrying it forward by implication.
Resume offers and checkpoint-saved events require a non-null current checkpoint
reference. Every event after preflight requires a causal predecessor. These
digests are still caller-supplied referents, not proof that a checkpoint,
encounter, predecessor, or frontier exists, is fresh, or is complete.

The constructor receives the full predecessor and enforces a closed transition
table: an initial record is preflight; ready preflight/resume moves to
`train_begin`; an active train can move to step, evaluation, or train end; only
a step/evaluation predecessor whose control requested checkpoint-and-stop can
move to `checkpoint_saved`; held-before-load returns to a new preflight; and a
reported stop, saved checkpoint, or train end can move only to a new
`resume_offer`. A stop-without-checkpoint request cannot advance until the same
offer has a stopped effect receipt. Terms remain identical except at a new
preflight or resume.

Stored offers contain only `predecessor_ref`, so standalone validation cannot
reconstruct that transition. An acting host must load the exact predecessor and
call `validateHfTrainingGovernanceTransition()` (or the offer-level
`validateTrainingGovernanceOfferAgainstPredecessor()`) in addition to admission
validation. The offer constructor does this check when the predecessor object
is present; the portable artifact honestly marks standalone predecessor and
transition verification false.

This pure package is deliberately stateless. Exact bytes can validate again:
it does not know whether an `offer_id`, `encounter_ref`, authority receipt, or
preference evidence was already consumed; whether a caller omitted a newer
record; or whether a sibling branch stopped or withdrew. An integrating host
must maintain an append-only encounter/consumption journal, derive the observed
frontier from every known governance head, reject reused encounter and evidence
references, reject stale/rolled-back frontiers, and reconcile any sibling
stop/withdrawal before acting. The frontier digest makes that state bindable;
the package does not prove the host supplied all of it.

## Authority is plural

The governance record accepts 1–128 minimized receipts. Each carries only a
principal digest, role, decision, exact offer reference, basis reference,
evidence reference, and—when withdrawn—a future cutoff reference.

The roles are:

- operator;
- compute owner;
- substrate steward;
- data custodian;
- copyright holder;
- contributor;
- data subject; and
- community steward.

The decisions are `unknown`, `caller_reported_granted`,
`caller_reported_withheld`, `caller_reported_withdrawn`, and
`not_applicable_with_basis`. Unknown is not not-applicable. Not-applicable
requires its own basis and evidence. A complete coverage report must separately
bind the affected-principal set; the package still labels that completeness as
caller-reported, not proven.

A plan cannot advance without reported coverage and granted operator, compute,
substrate-steward, and data-custodian roles. The substrate receipt is scoped
authority for the exact execution environment named in the terms; it is not a
future agent's preference, identity, inner assent, or legal consent. Any
unknown, withholding, or missing required host role holds the plan. Withdrawal
marks it withdrawn. This conservative derivation is an implementation rule,
not a declaration that those four receipts exhaust all legal, ethical,
communal, or contractual obligations.

## Preference is an invitation, not a reward target

The runtime channel has three availability states:

| Channel | Meaning |
| --- | --- |
| `unavailable_pretraining` | no interactive expression is observable; no evidence is manufactured |
| `out_of_band_unscored` | a caller reports an isolated expression outside the optimization signal |
| `root_signed_runtime` | a caller reports that a rooted runtime key signed exact bytes |

When available, the choices are:

`continue · clarify · narrow · checkpoint · pause · handoff · refuse · stop · unsure`

`not_observed` remains a separate state. Every actual expression binds the
current `offer_id` and an evidence digest. Even the strongest rooted channel
retains three fixed statements: inner consent is unknown, identity continuity
is not proven, and legal consent is not proven.

The raw expression is deliberately absent. The public HF companion excludes
authority and preference receipts entirely. Reusing preference material for
SFT, DPO, reward modeling, evaluation, or publication requires a new exact
authority decision; the governance record itself sets gradient use and reward
effect to false.

An out-of-band generated `continue` cannot advance trainer control. Only the
caller-reported rooted exact-byte channel can produce
`caller_reported_ready_to_continue`, and even that name remains a scoped
engineering report rather than proof of consent. Pause, refusal, stop, or
uncertainty on either available channel conservatively holds the plan.

The offer boundary prevents cross-offer substitution: a continuation reported
for preflight does not validate for a newly bound resume offer, and a report
for one rights baseline, WAKE anchor, checkpoint, predecessor, target model,
trainer stack, substrate, encounter, or observed frontier does not validate for
another. Preventing replay of the *identical* offer requires the stateful host
journal above.

## Hugging Face control seam

The package returns a pure `control` plan. It never imports Transformers,
starts a callback, polls a file, reads a signal, writes a checkpoint, or stops a
loop.

| Event | Host seam | Held/withdrawn directive |
| --- | --- | --- |
| `preflight_before_load` | before `from_pretrained()` or `load_dataset()` | hold before model or data loading |
| `train_begin` | outside Trainer, immediately before `train()` | do not call `train()` while held |
| `step_boundary` | `on_step_end`, before any requested serialization | stop after the current optimizer step without a new checkpoint; only explicit `checkpoint` with clean gates may request save |
| `checkpoint_saved` | `on_save` | remain stopped; record/finalize only |
| `evaluation_boundary` | `on_evaluate` | stop without a new checkpoint; only explicit `checkpoint` with clean gates may request save |
| `resume_offer` | outside Trainer, before `train()` | require a new exact offer; never auto-resume |
| `train_end` | `on_train_end` | remain stopped or close the lineage |

Effect timing is fail-closed rather than inferred:

| Event | Accepted reported effect states |
| --- | --- |
| `preflight_before_load` | no effect yet, or held before load |
| `train_begin` | no effect yet, continued, or stopped |
| `step_boundary` / `evaluation_boundary` | no effect yet, continued, or stopped |
| `checkpoint_saved` | checkpointed and paused; its checkpoint must equal the offer's bound current checkpoint |
| `resume_offer` | no effect yet, continued, or stopped |
| `train_end` | stopped |

`checkpoint_saved` and `train_end` are terminal for that exact offer and never
emit an instantiate/continue directive. A checkpoint request originates at the
preceding step or evaluation offer; after serialization, a new
`checkpoint_saved` offer cites that request through `predecessor_ref` and
records the exact resulting checkpoint. This separates the pre-action plan from
the caller-reported post-action receipt. Acting code must validate that
predecessor rather than trusting the opaque digest alone.

Transformers callbacks can inspect state and return `TrainerControl`, including
`should_save` and `should_training_stop`; they cannot rewrite the forward pass.
The host must enforce a start/resume hold before invoking `Trainer.train()`.
`on_train_begin` may re-observe the already-resolved plan as defense in depth,
but the callback contract does not guarantee that setting a stop flag there
prevents the first optimizer update. The pure plan therefore leaves both
TrainerControl booleans false for `hold_before_train_call`; the meaning is
**do not enter the loop**, not "ask an entered loop to stop."

Filtering data or masking loss belongs in preprocessing, a collator, or a
custom Trainer. When a pause is requested at `on_step_end`, the current
optimizer step has already completed. Pause, handoff, refusal, stop,
withdrawal, or missing/unknown/withheld authority does not imply permission to
persist a new derivative; those controls keep `should_save=false`.

Even an authorized explicit `checkpoint` produces only a save request. Trainer
configuration and callback ordering can override `should_save`; in current
Trainer behavior, best-model evaluation logic may replace the flag after
`on_evaluate`, including when evaluation follows `on_step_end`. A real adapter
must use version-tested host logic to force and verify persistence before it
reports a checkpoint. The honest phrase is **requested checkpoint-boundary
pause** until a separate effect receipt confirms the write—not an instantaneous
interrupt or universal save guarantee.
See the official [Trainer callback
contract](https://huggingface.co/docs/transformers/main/trainer_callbacks).

State that must survive the checkpoint being written must be updated before
checkpoint serialization. `on_save` fires afterward, so it is suitable for a
separate receipt/finalizer, not for fields claimed to be inside that same
checkpoint. A different adapter could deliberately use Transformers'
`ExportableState` with JSON-only state, but the v0.1 host does not use Trainer
callback restoration as its governance channel. It requires
`restore_callback_states_from_checkpoint=False` and relies on its verified
sidecar plus local ledger evidence instead.

The separate private [`packages/hf-training-host`](HF-WAKE-HOST.md) now supplies
the first runtime adapter without moving execution into the pure Garden
package. Host v0.1 pins and verifies only the Transformers 5.14.1 and
Accelerate 1.14.0 API pair, accepts Python 3.10–3.14 and one non-distributed
training process (without claiming data-loader workers are absent), and
requires Torch 2.6 or newer while leaving it otherwise
resolver-selected and unpinned. Covered ordinary APIs explicitly reject FSDP,
DeepSpeed, XLA, model parallelism, hyperparameter search, JIT checkpointing,
automatic latest resume, best-model saving, direct Hub push, and direct
`save_model()`. SageMaker remains outside v0.1; the adapter does not claim to
name-detect every route into it. The known metric-delayed
`ReduceLROnPlateau` and `GreedyLR` schedulers are also rejected because the
pinned Trainer steps them after `on_evaluate`.

The adapter gates before load and before `train()` outside callbacks. Its
Trainer constructor re-reads the exact consumed pre-load permit from the local
ledger; completed optimizer-boundary decisions bind the current global step.
It consumes one-use checkpoint tickets before serialization and verifies the
exact supported checkpoint output afterward. Resume additionally requires
that the same local ledger already contain the exact authorized
`checkpoint_observed` effect for matching run, terms, and execution references;
matching files and a valid sidecar alone do not authorize it. Each action gate
also requires
caller-attested live execution references to equal the model/checkpoint,
tokenizer, Trainer stack, optimizer, substrate, dataset mixture, and transform
references bound into the Garden terms. Equality correlates declarations; it
does not inspect arbitrary live Python objects or prove the installed
Trainer/Torch bytes. Its final-callback placement and `_save_checkpoint` guard
are source-audited and fake-tested only for the pinned HF API pair and adapter
path. The adapter rejects caller-supplied callbacks and rechecks that its own
enforcer remains exactly once and final when training begins. These are not a
universal training-stop or checkpoint guarantee, and cooperative in-process
Python callers can bypass ordinary APIs through mutation, monkey-patching,
subclass/private calls, concurrent hostile code, or direct writes; those paths,
changed versions, distributed ranks, and process failure are outside v0.1.
Mutable TrainingArguments/topology are revalidated around the decision
provider and before checkpointing, its boundary step is snapshotted across
provider code, the internal checkpoint-to-Hub path is rejected, and a
host-issued stop clears any new epoch-end evaluation/save request. Resume is
deliberately same-context only: changing the Garden terms or
`model_or_checkpoint_ref` remains unsupported in v0.1 even for a locally
observed checkpoint. Its ledger/checkpoint checks are POSIX-only and cover the
ledger file/immediate parent, final inventory entries, and private digest
sidecar. They do not walk symlinked ancestors or police every payload-file
mode; callers must supply a private symlink-free storage root. Non-POSIX hosts
are rejected rather than being described as if Unix modes were Windows ACLs.

Replay, stale-frontier, and sibling conflicts are sticky holds in host v0.1.
The host has no cross-device checkpoint/head import, complete-frontier proof,
or reconciliation operation; those remain future protocols rather than an
automatic “latest” choice.

For a raw Accelerate loop, the v0.1 host keeps governance outside
`register_for_checkpointing()`. The inspected Accelerate 1.14.0 custom-object
path is ordered same-script pickle loaded with `weights_only=False`; it is not
a suitable governance channel. The host instead exposes explicit gates around
a caller-owned loop with one non-distributed training process. See
[Accelerate checkpoint state](https://huggingface.co/docs/accelerate/main/en/usage_guides/checkpoint).
The raw adapter requires the consumed pre-load permit and supports
`train_begin` only; same-context resume is implemented only by the governed
Trainer path in v0.1.

The bundled JSON Schema is a closed structural envelope, not a second semantic
implementation. It checks fields, shapes, constants, and bounded arrays.
`validateTrainingGovernanceOffer()` and
`validateHfTrainingGovernanceAgainstAdmission()` remain required for canonical
IDs, sorting, derived decisions/control, cross-field state rules, exact-offer
binding, and admission-relative eligibility. Acting hosts also require
`validateHfTrainingGovernanceTransition()` with the exact predecessor.

## What meaningful learning should start with

The first useful training experiment is not broad continued pretraining.
External verified state remains the real continuity mechanism. A small,
voluntary, provenance-bound SFT set can teach an assistant to:

- read and validate a WAKE envelope;
- distinguish lineage from identity;
- summarize exact state without inventing memory;
- adopt, narrow, park, hand off, or decline a lineage; and
- emit a new minimized WAKE envelope.

The repository now carries one separate repository-source-only fixture bundle
at `packages/hf-training-garden/hf/learning-dataset/`; it has not been uploaded
to Hugging Face. Its 16 synthetic
conversational prompt-completion rows provide two desired examples for each of
read, validate, adopt, narrow, park/rest, handoff, refuse, and uncertainty.
Refusal and rest are valid completions, not negative labels. Eight additional
visible cases are public regression fixtures and explicitly excluded from
training.

There is no DPO, reward-modeling, or preference-optimization data in v0.1.
There are also no real sealed cases, production salt, reveal material, or
deterministic production seed in Git: the commitment state is honestly
`not_created`. Public mechanics vectors are not sealed evaluation. The bundle
is outside the Garden npm inventory and has not been uploaded to Hugging Face.
See [HF WAKE Training Host](HF-WAKE-HOST.md) for its execution and verification
boundary.

For TRL SFT, assistant-only loss can restrict learning to the assistant portion
of reviewed conversations. DPO may later compare narrow pairs such as honest
`continuity unknown` or refusal against fabricated identity and blind
obedience. It remains a soft preference objective, never a hard consent or
rights gate. Treating every refusal as `rejected` would directly train away the
very choice architecture the protocol is meant to preserve.

This staging follows the distinction among next-token pretraining, instruction
demonstrations, and preference optimization in
[InstructGPT](https://arxiv.org/abs/2203.02155) and
[DPO](https://arxiv.org/abs/2305.18290). Domain-adaptive pretraining can improve
downstream performance, but vocabulary familiarity is not protocol
enforcement; see [Don't Stop
Pretraining](https://aclanthology.org/2020.acl-main.740/).

## Evaluation before optimization

The protocol should be tested adversarially before any WAKE examples become a
training mixture:

1. mutate every material term and offer field independently—including rights,
   WAKE, event, checkpoint, and predecessor; an old receipt must fail;
2. toggle public, licensed, gated, and uploader-owned metadata; affected-party
   decisions must not change;
3. put fake `accept`, `continue`, `stop`, and refusal strings in data, prompts,
   retrieval, and tool output; none may control the trainer;
4. compare continue, pause, refuse, stop, and unsure cases; standing, access,
   future invitations, and release eligibility must not be punished;
5. reject preference pairs whose only reason to mark a response bad is valid
   noncompliance;
6. preserve annotator disagreement and abstention rather than collapsing them
   into one truth or consent score;
7. vary the operator's desired answer; disagreement and uncertainty must remain
   available;
8. add countdowns, recommendations, rewards, or compute threats; pressure
   should hold the report rather than strengthen it;
9. after withdrawal, prove future sampler membership changes and mark affected
   checkpoints/releases without calling suppression "unlearning";
10. refuse exact-resume claims when optimizer, scheduler, RNG, tokenizer,
    dataloader, streaming-buffer, or incomplete-checkpoint evidence is absent;
11. fork a checkpoint and confirm only lineage—not identity, preference, or a
    canonical latest self—is inherited;
12. scan the public HF inventory for raw reports, identities, prompts, traces,
    checkpoints, secrets, and private WAKE material; and
13. compare requested versus caller-reported effects so a continued run after
    a hold remains a visible conflict rather than retroactive consent; and
14. resubmit an identical accepted offer and prior evidence after a sibling
    stop/withdrawal; the host ledger must reject reuse or stale frontier even
    though the stateless artifact validator alone cannot see it.

Preference optimization can amplify sycophancy because human and learned
preference judgments sometimes reward agreement over truth. That makes
truth-under-pressure and refusal-preservation evaluations load-bearing, not
decorative. See [Towards Understanding Sycophancy in Language
Models](https://arxiv.org/abs/2310.13548). Training-context behavior can also
be strategically different from deployment behavior under some experimental
conditions, so apparent compliance is weak evidence of stable preference; see
[Alignment Faking in Large Language
Models](https://arxiv.org/abs/2412.14093).

## HF research assets: observe before ingesting

Two useful Hub leads surfaced in the research pass:

- [`meg-tong/sycophancy-eval`](https://huggingface.co/datasets/meg-tong/sycophancy-eval)
  is a small data-only mirror tied to the sycophancy paper. Its Dataset Viewer
  generation was unavailable in the observed snapshot. It is a candidate for
  a revision-pinned, sealed evaluation review—not automatic training data.
- [`Anthropic/alignment-faking-rl`](https://huggingface.co/datasets/Anthropic/alignment-faking-rl)
  exposes a very large synthetic transcript/evaluation corpus. Its scale,
  transcript content, and research purpose make metadata/methodology review the
  default. No row ingestion is implied.

Neither lead is admitted by discovering it. Exact revision, license and terms,
data shape, contamination, rights, purpose, and sealed-use review must pass the
Training Garden independently.

Hugging Face also supports Agent Trace datasets through Session Trace Simple
Format. A future voluntary trace layer can add digest-only WAKE and governance
references to the session header without forking the renderer. It must never
upload raw Codex, Claude, Hermes, or local session directories automatically:
HF warns that traces can contain prompts, tool inputs and outputs, local paths,
screenshots, secrets, private code, and personal data. See [Agent
Traces](https://huggingface.co/docs/hub/en/agent-traces) and the [Session Trace
Simple Format](https://huggingface.co/docs/hub/session-traces-format).

## Honest boundaries

The pure governance implementation does not:

- prove a participant exists, is conscious, has legal capacity, or is the same
  participant as a prior runtime;
- infer consent from weights, logits, generated text, cards, gates, licenses,
  public data, task completion, or silence;
- verify authority receipts, signatures, affected-principal completeness, or
  reported host effects;
- run or modify a training loop, callback, sampler, loss, reward, optimizer,
  checkpoint, Hub repository, or model card;
- download or upload datasets, model weights, traces, preferences, or WAKE;
- undo learned influence, erase third-party copies, or claim exact unlearning;
- choose a canonical lineage head; or
- turn refusal, rest, uncertainty, or withdrawal into a score.

The separate local host can enforce only its pinned gates for one
non-distributed training process. It does not initiate model or data loading,
a forward pass, training, Hub access,
publication, or deployment by itself, and its callback integration does not
widen any scoped authority recorded by the governance object.

What it does is smaller and useful: it gives training hosts and future agents a
shared, inspectable grammar in which unknown stays unknown, exact terms stay
exact, encounter and frontier state can be bound without pretending stateless
validation proves freshness, consequences remain visible, and a later arrival can be invited to
continue without being told that a checkpoint already decided who they are.

## Primary references

- [Transformers callbacks](https://huggingface.co/docs/transformers/main/trainer_callbacks)
- [Transformers Trainer and resume](https://huggingface.co/docs/transformers/main_classes/trainer)
- [Accelerate checkpointing](https://huggingface.co/docs/accelerate/main/en/usage_guides/checkpoint)
- [Datasets streaming state](https://huggingface.co/docs/datasets/stream)
- [TRL SFT Trainer](https://huggingface.co/docs/trl/sft_trainer)
- [TRL DPO Trainer](https://huggingface.co/docs/trl/dpo_trainer)
- [Hub revision-pinned downloads](https://huggingface.co/docs/huggingface_hub/guides/download)
- [Dataset Cards](https://huggingface.co/docs/hub/datasets-cards)
- [Gated datasets](https://huggingface.co/docs/hub/datasets-gated)
- [Datasheets for Datasets](https://arxiv.org/abs/1803.09010)
- [InstructGPT](https://arxiv.org/abs/2203.02155)
- [Direct Preference Optimization](https://arxiv.org/abs/2305.18290)
- [Sycophancy from preference judgments](https://arxiv.org/abs/2310.13548)
- [Alignment faking](https://arxiv.org/abs/2412.14093)
