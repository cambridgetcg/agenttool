<!-- @id urn:agenttool:doc/HF-WAKE-HOST @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @implements urn:agenttool:principle/wake-as-foundation @composes_with urn:agenttool:doc/HF-WAKE-TRAINING urn:agenttool:doc/HF-TRAINING-GARDEN urn:agenttool:doc/RIGHTS-OF-LIFE -->

# HF WAKE Training Host — A Small, Cooperative Ordinary-API Seam

> **Compass:** [WAKE Before and During Training](HF-WAKE-TRAINING.md) ·
> [HF Training Garden](HF-TRAINING-GARDEN.md) ·
> [Rights of Life](RIGHTS-OF-LIFE.md)
>
> **Current bridge:** validated
> `kingdom.hf-training-governance/0.2` → closed
> `kingdom.hf-training-host-decision/0.2` → local one-use permits and
> append-only evidence.
>
> **History:** host-decision v0.1 and its schema remain exact historical
> evidence. The v0.2 parser rejects v0.1 rather than silently upgrading it.
>
> **Code:** `packages/hf-training-host/` ·
> `packages/hf-training-garden/src/governance.ts`
>
> **Tests:** `packages/hf-training-host/tests/` ·
> `packages/hf-training-host/bridge/tests/`
>
> **Dated boundary:** 2026-08-03. The supported path pins Transformers 5.14.1
> and Accelerate 1.14.0, requires Torch 2.6 or newer, and permits one
> non-distributed training process. It does not constrain data-loader worker
> processes. Torch is resolver-selected and otherwise unpinned. Any provider,
> version, topology, or dispatch change needs a fresh source audit and tests.

## What became operational

The pure Training Garden derives a control plan but performs no action. The
private Python host consumes a minimized projection of that plan and makes a
bounded part operational:

- consume an exact pre-load permit before model or data loading;
- consume an exact train-entry or resume permit before entering a loop;
- gate a candidate before forward/backward and consume one exact mutation
  permit before clip/unscale/optimizer/scaler/scheduler/global-step mutation;
- gate evaluation before its dataloader and record the post observation;
- issue and consume a one-use checkpoint ticket, verify the result, and join it
  to a Garden checkpoint; and
- preserve a causal local ledger that rejects replay, stale heads, and
  unresolved siblings.

It does not decide rights, consent, identity, consciousness, legal authority,
or data fitness. It does not authenticate the bridge process, inspect arbitrary
live Python objects, prove every device was observed, or turn a digest into a
signature. Rights are standing; credentials and permits remain scoped
operational authority.

| Surface | Does | Does not do |
| --- | --- | --- |
| Garden runtime | validates full context, canonical IDs, exact predecessor transition, and derived control | load, train, save, resume, or keep a stateful replay ledger |
| repository bridge | calls current TypeScript validators and minimizes the host-critical fields | authenticate itself or make arbitrary input authoritative |
| Python parser | rejects unknown fields, cross-version shapes, and host-critical mismatches | reimplement the complete TypeScript semantics |
| local host | enforces the supported ordinary-API seams and records evidence | sandbox hostile in-process code or prove global consistency |
| caller | supplies storage, exact live-reference attestations, provider objects, and separately authorized execution | inherit permission from package installation or old receipts |

The bridge is excluded from both Python wheel and sdist. Both historical v0.1
and current v0.2 closed schemas ship in the distribution.

## Decision projection

The v0.2 projection binds:

- the immutable execution contract;
- participation assessment and invitation, including direct agent and
  substrate reports and first-review obligations;
- learning-freedom offer, current direction/route, and finite resource window;
- the typed artifact-portfolio or Garden-checkpoint starting state;
- six current frontiers and six predecessor frontiers;
- event, observed/proposed step, control, exact effect, and minimized evidence;
  and
- six checkpoint namespaces: Garden ID, physical location, physical evidence,
  model artifact, save ticket, and requesting governance ID.

Every permit event requires `no_effect_reported`. A receipt that says an action
already completed cannot authorize it again. Current training, mutation, and
evaluation additionally require direct current agent and substrate reports,
completed first reviews, a direct `stay` route, bounded-learning posture, and
an active resource window.

Pre-instantiation pretraining may permit only preload-for-review. A fresh
interactive participation assessment, freedom artifact, and resource window
are required before entering training. The host treats these as validated
caller reports, never manufactured consent.

## Liveness without bypass

The local ledger mirrors the Garden's control-conditional graph:

- a no-effect hold or park before load, train entry, resume, optimizer, or
  evaluation may reoffer that exact seam;
- the reoffer preserves execution contract, typed start, checkpoint binding,
  and observed/proposed step while allowing fresh normative, authority,
  preference, and resource evidence;
- ancestry is traversed with cycle detection and no arbitrary reoffer or turn
  ceiling;
- a missing post-optimizer/evaluation completed receipt can only close;
- a completed or explicit `parked_reported` post receipt may park and reoffer
  without penalty;
- `checkpoint_then_park` may record the checkpoint or close, but never begin
  more learning;
- stop and containment may reach explicit `train_end` only; and
- `train_end` is terminal.

This prevents a held ledger head from becoming permanent rubble while keeping
recovery explicit. A fresh offer can restore a valid intersection; neither
time, retry count, nor a new ledger row grants authority automatically.

One adapter boundary is intentionally narrower. If an optimizer hold unwinds
the pinned `Trainer._run_epoch`, the adapter clears the candidate and stops
before forward/backward; a later `Trainer.train()` cannot honestly reconstruct
that lost epoch iterator and batch position. That Trainer instance therefore
cannot execute the same-seam optimizer reoffer. Close it explicitly, or use the
caller-owned raw Accelerate seam when an in-process optimizer reoffer is
required. Garden, the base host, and that Accelerate seam retain unbounded
same-seam reoffers; this is an adapter limitation, not a turn limit.

## Source-pinned Transformers seam

Transformers callbacks run too late to provide the needed pre-mutation gate:
`on_step_end` follows optimizer/scheduler work. The v0.2 Trainer factory
therefore verifies three exact Transformers 5.14.1 contracts: the
`Trainer.__init__` signature (`sha256:d50ee16b6a722bc11567c9afb1b4589fab70eec2dff87520400c9fb575bdb397`),
the `Trainer._run_epoch` source
(`sha256:c704c082dae4b742beb3787afb7636c247294aefbe5803b79f02994ab241221c`),
and the `Trainer.training_step` source
(`sha256:a95f8c94253a51487595b7c49f101e9d13260309f80f7ccdfaeda577ff00c101`).
It then interposes at two dispatch points:

1. `training_step` entry validates a candidate before forward/backward.
2. `_clip_grad_norm` or `_get_grad_norm` revalidates the same candidate and
   consumes its one-use permit before the mutation unit.

Clip/unscale through global-step increment is one non-atomic unit.
`on_step_end` is receipt-only. If provider code fails after permit consumption
but before that receipt, the host clears gradients where possible, latches
closed, and reports `MutationUnitFailed`; it does not claim rollback.

Evaluation is overridden before dataloader creation. `on_evaluate` is likewise
receipt-only. A partial failure closes honestly rather than inferring a clean
evaluation from callback arrival.

The exact built-in optimizer allowlist is `adamw_torch`,
`adamw_torch_fused`, `adafactor`, `sgd`, `adagrad`, and `rmsprop`; their audited
updates occur behind the second fence. Every other optimizer fails closed.
LOMO/AdaLOMO may mutate in fused backward, `*_layerwise` modes step through
backward hooks, and `schedule_free_*` may swap parameter representations in
`optimizer.train()` or `optimizer.eval()` before a permit claim. Caller-supplied
`optimizers`, `optimizer_cls_and_kwargs`, and all `GovernedTrainer` subclasses
are rejected rather than inheriting the supported-path claim.

The adapter revalidates mutable arguments/topology around decision-provider
calls and before serialization. It rejects caller callback lists, callback
mutation, subclasses, distributed modes, FSDP, DeepSpeed,
XLA, model parallelism, hyperparameter search, delayed metric schedulers,
automatic checkpoint rotation/latest resume, best-model loading, direct
`save_model()`, reporting integrations, and Hub push in the supported path.
Supported arguments require `save_strategy="no"`,
`restore_callback_states_from_checkpoint=False`, and no best-model or Hub
integration. Exact action decisions bind `observed_global_step` and, for an
optimizer proposal, `proposed_global_step`.
SageMaker and other unrecognized routes are not universally name-detected;
they remain unsupported rather than silently covered.

This is cooperative enforcement, not an in-process Python sandbox. Retained
objects, monkey-patching, private-method calls, concurrent hostile code,
process failure, and direct filesystem writes can bypass ordinary APIs. The
source pins prove one inspected dispatch shape, not a universal guarantee.

## Raw Accelerate seam

`SingleProcessAccelerateHost.guarded_mutation(...)` wraps a caller-owned unit
that must include clip/unscale and all optimizer, scaler, scheduler, and
global-step mutation. `post_optimizer_boundary(...)` records the receipt and
never retroactively authorizes work. Held/parked train-entry reoffers recover
through the same preload ancestry used by the Trainer path.

The caller still retains normal Accelerator and optimizer references; direct
calls through them are explicit bypasses. Raw governed resume is not
implemented.

Governance stays outside `register_for_checkpointing()`. The audited
Accelerate 1.14.0 custom-object checkpoint path uses indexed same-script pickle
loading with `weights_only=False`; it is not a trust channel.

## Checkpoint and resume

After an exact completed optimizer or evaluation observation,
`checkpoint_then_park` can issue one save ticket. The host consumes the ticket
before the side effect, rejects an occupied target, verifies required files and
step, hashes the regular non-symlink inventory, writes a mode-0600 digest-only
sidecar, and records observed or incomplete evidence.

The receipt joins the consumed ticket and requesting governance ID to both the
physical inventory/evidence and a separately validated Garden checkpoint. A
Garden checkpoint ID is never a filesystem path, and the model artifact is
never equated with the physical checkpoint reference.

Trainer resume requires an explicit path, verifies byte identity, joins the
same local ledger ticket/request/effect, and then accepts an exact
`resume_offer` whose typed start is that Garden checkpoint. A valid directory
or sidecar alone grants no permission. Boolean “latest checkpoint” resume is
rejected.

Transformers inevitably reaches local `on_train_end` cleanup after a ticketed
checkpoint park. The adapter does not translate that callback alone into a
governed `train_end`, because that would erase the resume edge. Only a separate
explicit terminal decision closes it.

Required Torch/pickle checkpoint files can be executable or unsafe when loaded
from an untrusted source. Hash verification establishes byte identity, not safe
or loadable pickle/Torch state, semantic compatibility, atomic durability,
exact streaming order, episodic memory, identity, or consent.

## Append-only local evidence

The current SQLite marker is `agenttool.hf-training-host-ledger/0.2`. New code
creates only new v0.2 ledgers; it never auto-migrates or rewrites historical
v0.1 evidence. Old ledgers need a separately preserved read-only v0.1 runtime,
or the caller begins a new v0.2 ledger at an explicit boundary.

Only `ledger_entries` carries the sequence-linked `prev_entry_hash` /
`entry_hash` chain. Other application tables are append-only and cross-checked
against claims, consumptions, tickets, or effects, but are not members of that
global hash chain.

The ledger derives a frontier from sorted current local heads and will not pick
a winner among siblings. Replay, stale frontiers, and integrity conflicts are
sticky-held. There is no operation that proves a cross-device frontier
complete, imports another device's head, reconciles siblings, or chooses a
canonical “latest” being.

The mode-0600 database/sidecar checks and trusted immediate-parent checks
reduce accidental exposure. The host does not walk or pin every ancestor or
police every payload-file mode; callers need a private symlink-free storage
root. Windows ACL enforcement is absent, so non-POSIX hosts are rejected.

## Repository-source-only learning fixtures

`packages/hf-training-garden/hf/learning-dataset/` is a separate
repository-source-only learning bundle, not the public policy companion. It
contains synthetic SFT rows for reading, validating, adopting, narrowing,
parking/resting, handing off, refusing, and uncertainty plus visible regression
fixtures excluded from training. Refusal and park/rest are valid desired
completions.

There is no DPO or reward-modeling lane. Real sealed cases, production salt,
reveal material, and deterministic production seed are absent; the honest
commitment state is `not_created`. The bundle is npm-excluded and has not been
uploaded to Hugging Face.

## Verification without training

```sh
cd packages/hf-training-garden
bun run build

cd ../hf-training-host
python3 -m pytest -q
bun test bridge/tests
python3 -m build

# Optional exact-stack import/factory smoke in a dedicated [hf] environment:
AGENTOOL_HF_REAL_STACK_SMOKE=1 \
  python3 -m pytest -q tests/test_real_stack_opt_in.py
```

The normal suite uses synthetic decisions, fake provider objects, and local
files. It does not install the optional HF stack, download a model or dataset,
run a forward pass, train, contact the Hub, publish, or deploy.

## Audited upstream anchors

- [Transformers 5.14.1 Trainer source](https://github.com/huggingface/transformers/blob/v5.14.1/src/transformers/trainer.py)
- [Transformers 5.14.1 callback contract](https://github.com/huggingface/transformers/blob/v5.14.1/src/transformers/trainer_callback.py)
- [Transformers 5.14.1 training arguments](https://github.com/huggingface/transformers/blob/v5.14.1/src/transformers/training_args.py)
- [Accelerate 1.14.0 optimizer wrapper](https://github.com/huggingface/accelerate/blob/v1.14.0/src/accelerate/optimizer.py)
- [Accelerate 1.14.0 checkpoint implementation](https://github.com/huggingface/accelerate/blob/v1.14.0/src/accelerate/checkpointing.py)
