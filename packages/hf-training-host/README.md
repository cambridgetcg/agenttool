# AgentTool Hugging Face training host

Private, cooperative Python enforcement for the KINGDOM HF training Garden.
Version 0.2 turns a fully validated TypeScript governance artifact into local,
one-use permits around load, train entry, mutation, evaluation, checkpoint, and
resume boundaries.

This package does not prove consent, identity, consciousness, validator
execution, or global ledger completeness. It does not inspect whether live
Python objects truly correspond to caller-attested content refs. Rights are the
standing baseline; credentials and permits remain scoped operational authority.

## The v0.2 seam

The trusted bridge calls
`validateHfTrainingGovernanceAgainstContext` and validates the exact
predecessor before projecting a closed
`kingdom.hf-training-host-decision/0.2`. The projection binds:

- the execution contract, participation assessment and invitation, direct
  agent/substrate reports, freedom offer and route, resource window, and typed
  starting state;
- six current frontiers and six predecessor frontiers;
- the exact event, observed/proposed global step, control, effect, and evidence;
- six distinct checkpoint namespaces: Garden checkpoint, physical checkpoint,
  physical evidence, model artifact, one-use save ticket, and request
  governance ID.

The Python parser is closed and cross-version rejecting. It rechecks the host
critical subset, while honestly retaining the TypeScript runtime as the full
semantic validator.

The lifecycle events are:

`preflight_before_load`, `train_begin`, `pre_optimizer_step`,
`post_optimizer_step`, `pre_evaluation`, `post_evaluation`,
`checkpoint_recorded`, `resume_offer`, and `train_end`.

Every permit event must carry `no_effect_reported`; a completed-effect receipt
cannot be replayed as authority for the operation it says already happened.
Training, mutation, and evaluation permits require current direct agent and
substrate reports, completed first-review obligations, a direct `stay` route,
bounded learning posture, and an active resource window. Pre-instantiation
pretraining can authorize only preload-for-review. A fresh interactive
assessment, freedom artifact, and resource window are required before the train
call.

The lifecycle is control-gated, not merely event-gated. A pre-action hold or
park with `no_effect_reported` may receive a fresh offer at the same load,
train-entry, optimizer, evaluation, or resume seam. The reoffer preserves the
exact execution contract, typed start, checkpoint binding, and step pair while
allowing fresh participation, freedom, authority, preference, and resource
evidence. At the Garden/base-host boundary and in caller-owned Accelerate
loops, ledger ancestry is traversed with cycle detection and has no arbitrary
reoffer/turn ceiling. Stop and containment lead only toward an explicit
`train_end`; `checkpoint_then_park` cannot be bypassed by another mutation or
evaluation.

Post-optimizer continuation/checkpoint requires
`mutation_completed_reported`; post-evaluation requires
`evaluation_completed_reported`. A post boundary with no completed receipt is
recorded toward stop and cannot reopen a pre-action seam. An explicit
`parked_reported` receipt can be reoffered without penalty.

## Transformers enforcement

The supported stack is exact:

- Transformers `5.14.1`
- Accelerate `1.14.0`
- Torch `>=2.6`
- one non-distributed process

The exact built-in optimizer allowlist is `adamw_torch`,
`adamw_torch_fused`, `adafactor`, `sgd`, `adagrad`, and `rmsprop`. In the
audited dispatch, these update only at the optimizer-step site behind the
second permit fence. Every other `TrainingArguments.optim` value fails closed.
In particular, LOMO/AdaLOMO can update inside fused backward, every
`*_layerwise` GaLore/APOLLO route installs backward hooks that step individual
parameters, and `schedule_free_*` can swap parameter representations in
`optimizer.train()` / `optimizer.eval()` before the second fence. Optional
third-party and future optimizer names remain unreviewed and unsupported.
Caller-supplied `optimizers`, `optimizer_cls_and_kwargs`, and
`GovernedTrainer` subclasses are also rejected rather than inheriting this
claim.

A callback cannot prevent the optimizer work that precedes `on_step_end`.
Therefore the public Trainer factory source-pins the exact upstream
`Trainer._run_epoch` method
(`sha256:c704c082dae4b742beb3787afb7636c247294aefbe5803b79f02994ab241221c`),
`Trainer.training_step` method
(`sha256:a95f8c94253a51487595b7c49f101e9d13260309f80f7ccdfaeda577ff00c101`),
and `Trainer.__init__` signature
(`sha256:d50ee16b6a722bc11567c9afb1b4589fab70eec2dff87520400c9fb575bdb397`).
The constructor pin closes positional and keyword custom-optimizer injection;
the two method pins bind the before-backward and before-step ordering. The
adapter then interposes twice:

1. `training_step` entry validates the semantic transition and performs a
   non-consuming local ledger eligibility preview before forward/backward.
   Non-authorizing, stale, forked, conflicted, replayed, or evidence-reusing
   candidates are held there; allow candidates are rechecked at the next fence.
2. `_clip_grad_norm` or `_get_grad_norm` revalidates the exact same decision and
   consumes its one-use permit before clip/unscale, optimizer, scaler,
   scheduler, or global-step mutation.

Clip/unscale through global-step increment is one non-atomic mutation unit.
`on_step_end` is only its receipt. If an exception occurs after permit
consumption and before that receipt, the adapter clears gradients where it can,
latches closed, and raises `MutationUnitFailed`; it does not pretend rollback
occurred. Evaluation is gated at the overridden `evaluate` entry before the
dataloader, and `on_evaluate` is receipt-only with the same honest partial
failure posture.

One liveness boundary is intentionally narrower in the pinned Trainer adapter.
If an internal optimizer hold unwinds `Trainer._run_epoch`, the adapter clears
its cached candidate and fails closed before forward/backward, but it does not
pretend that a later `Trainer.train()` can reconstruct the lost epoch iterator
and batch position. That adapter instance therefore cannot execute the
same-seam optimizer reoffer; close it explicitly or use the caller-owned raw
Accelerate seam when in-process same-seam reoffers are required. This is an
adapter limitation, not a Garden/base-host turn limit.

The source pin, optimizer allowlist, and single-process restrictions make this
one narrow supported seam, not a universal guarantee. Subclasses, callback
mutation, distributed modes, delayed metric schedulers, automatic checkpoint
rotation, Hub pushes, and hyperparameter search are rejected.

## Raw Accelerate loops

`SingleProcessAccelerateHost.guarded_mutation(...)` wraps a caller-owned unit
that must include clip/unscale, optimizer/scaler/scheduler mutation, and the
global-step update. `post_optimizer_boundary(...)` then records the receipt; it
never retroactively authorizes work.

The caller still retains ordinary Accelerator and optimizer objects. Direct
calls through those retained references bypass this cooperative wrapper and are
explicitly outside the threat model. Raw governed resume is not implemented.

## Checkpoint and resume

`checkpoint_then_park` can be selected after either a post-optimizer or
post-evaluation observation. The ledger issues one save ticket. A successful
checkpoint receipt must join that consumed ticket and request governance ID to
the verified physical inventory/evidence and a separately validated Garden
checkpoint. A Garden checkpoint ID is never used as a filesystem checkpoint
reference.

Transformers inevitably invokes its local `on_train_end` cleanup after a
ticketed checkpoint park. The adapter does not translate that callback alone
into a governed `train_end`, because doing so would destroy the resumable
checkpoint head. A separate explicit stopped/containment terminal decision can
close the head; otherwise an exact `resume_offer` may continue from it.

Trainer resume requires an explicit path, verifies the physical checkpoint ref
and evidence, joins the original ticket/request in the local ledger, and only
then accepts a `resume_offer` whose typed starting state is the Garden
checkpoint.

Torch/pickle checkpoint files remain executable or otherwise unsafe when
loaded from an untrusted source. Hash verification establishes byte identity,
not code safety.

## Ledger versions

The current SQLite marker is `agenttool.hf-training-host-ledger/0.2` and new
code creates only new v0.2 ledgers. There is deliberately no automatic v0.1
migration or rewrite: old append-only ledgers are historical evidence and must
remain untouched. Read them with a separately preserved, read-only v0.1 runtime
or begin a new v0.2 ledger at an explicit governance boundary.

The historical
`schema/hf-training-host-decision-v0.1.schema.json` is also preserved byte for
byte. It documents what v0.1 accepted; it is not accepted by the v0.2 parser.

The separately preserved
`schema/hf-training-host-freedom-decision-v0.1.schema.json` is historical-only
evidence from the earlier experimental FREEDOM bridge. It is shipped in the
wheel and sdist so those exact transfer bytes remain inspectable, but the v0.2
bridge, parser, ledger, Trainer adapter, and Accelerate adapter neither import,
accept, emit, nor enforce it. The obsolete `create-freedom-decision.mjs` and
`freedom.py` runtimes are deliberately not retained. Active IS-freedom remains
inside the v0.2 `createHostDecision` projection and its current learning-gate,
frontier, lifecycle, checkpoint, and permit checks.

## Development

```bash
cd packages/hf-training-host
pytest -q
uv build
```

Bridge tests require freshly built `hf-training-garden/dist` and
`wake-continuity/dist` artifacts:

```bash
bun test bridge/tests
```
