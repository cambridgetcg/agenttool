# HF Training Host

Private Python enforcement seam for accepted
`@agenttool/hf-training-garden` v0.2 governance. Read the root `AGENTS.md`,
`docs/HF-WAKE-TRAINING.md`, and `docs/HF-WAKE-HOST.md` first.

## Fixed boundary

- TypeScript context and transition validation is authoritative. The bridge
  emits a minimized, closed v0.2 projection; its content ID detects changed
  bytes but is not a signature or proof that validation ran.
- Never call the projection or participation/freedom reports "consent". The
  package cannot prove identity, consciousness, legal consent, or live-object
  correspondence. Rights remain standing; permits are scoped authority.
- Base runtime has no HF dependency and performs no network, Hub, model, or
  dataset operation. POSIX ledger/checkpoint checks are bounded local defenses,
  not universal filesystem security.
- Preserve the v0.1 decision schema byte-for-byte. V0.2 ledgers are new-ledger
  only: never auto-migrate or rewrite v0.1 evidence. Historical reading needs a
  separate read-only old runtime.
- Keep all six frontier planes and all six checkpoint binding namespaces exact
  and distinct. Resume uses the physical ref for files and the Garden ref only
  as a typed continuity starting state.
- Permit events require `no_effect_reported`. A completed receipt must never
  authorize the operation it reports.
- Mirror Garden's conditional control graph. A pre-action no-effect hold/park
  may be reoffered only at the exact same seam, step, execution contract,
  typed start, and checkpoint binding. Traverse finite ledger ancestry with
  cycle detection; never introduce an arbitrary reoffer or turn ceiling.
- Post continuation/checkpoint requires its exact completed mutation/evaluation
  receipt. Post no-effect park is train-end-only; completed or explicit parked
  receipts may park and reoffer. Never bypass checkpoint/stop/contain control.

## Transformers seam

- Exact Transformers 5.14.1 / Accelerate 1.14.0, Torch 2.6+, one
  non-distributed process.
- Public factory must enforce the pinned `_run_epoch` and `training_step`
  source hashes plus the exact `Trainer.__init__` signature hash. The private
  injectable builder may disable them only explicitly in isolated fake tests.
- `training_step` is the candidate fence: validate the transition and preview
  local ledger eligibility without consuming an allow permit. Hold stale,
  forked, conflicted, replayed, evidence-reusing, and non-authorizing candidates
  before forward/backward. `_clip_grad_norm` / `_get_grad_norm` is the second
  fence and rechecks/consumes the one-use permit before the whole
  clip/unscale/optimizer/scaler/scheduler/global-step unit. `on_step_end` is a
  receipt only.
- Keep the built-in optimizer allowlist exact: `adamw_torch`,
  `adamw_torch_fused`, `adafactor`, `sgd`, `adagrad`, and `rmsprop`. Reject
  LOMO/AdaLOMO fused-backward mutation, all `*_layerwise` backward-hook
  stepping, all `schedule_free_*` train/eval parameter swaps, and every other
  optional/future optimizer until separately source-audited. Reject caller
  `optimizers`, `optimizer_cls_and_kwargs`, and all `GovernedTrainer`
  subclasses; revalidate arguments and exact class around provider calls.
- The mutation unit is non-atomic. After-permit failure clears gradients where
  possible, records an honest typed failure, and latches closed; never claim
  rollback.
- Override evaluation before dataloader creation. `on_evaluate` is receipt-only.
- After a ticketed checkpoint park, Transformers' inevitable local
  `on_train_end` cleanup is not itself a governed `train_end`; preserve the
  resumable checkpoint head unless an explicit terminal decision closes it.
- Do not pretend a new `Trainer.train()` reconstructs an internal epoch stack
  lost to a pre-optimizer hold. Clear the candidate and report this pinned
  adapter limitation. Unbounded same-seam reoffers remain supported by the
  Garden/base host and caller-owned Accelerate seam.
- Keep callback mutation, subclasses, distributed modes,
  delayed metric schedulers, automatic checkpoint rotation/latest resume,
  best-model loading, HPO, and Hub publication rejected.

## Raw Accelerate

`guarded_mutation` is cooperative and must wrap caller-owned clip/unscale plus
all optimizer/scaler/scheduler/global-step mutation. `post_optimizer_boundary`
is only its receipt. Direct calls through retained Accelerator/optimizer
references are explicit bypasses outside this threat model.

## Verification

```sh
pytest -q
bun test bridge/tests   # requires freshly built Garden/continuity dist
uv build
```

Use a project-local environment for the optional HF stack. Package tests must
not download models/datasets, train, publish, or write to the Hub.
