# HF Training Host

Private, source-first Python host for the accepted
`@agenttool/hf-training-garden` governance lifecycle. Read the repository root
`AGENTS.md`, `docs/HF-WAKE-TRAINING.md`, and `docs/HF-WAKE-HOST.md` first.

## Fixed boundary

- TypeScript Garden validation is authoritative. `bridge/create-decision.mjs`
  validates the exact admission and predecessor before projecting a minimized
  host view. The view's content ID detects changed bytes; it is not a signature.
- The Python package has zero base runtime dependencies and performs no model,
  dataset, Hub, credential, or network operation by itself.
- Ledger/checkpoint enforcement is POSIX-only in v0.1. It checks the ledger
  file/immediate parent, final checkpoint inventory entries, and the private
  current-user sidecar; it does not walk symlinked ancestors, police every
  payload-file mode, or implement equivalent Windows ACLs. Require a caller-
  supplied private, symlink-free storage root.
- The optional Trainer adapter is exact-version and permits one
  non-distributed training process for the Transformers 5.14.1 / Accelerate
  1.14.0 API pair; it does not constrain data-loader workers. Stable Torch 2.6+
  is floor-bounded but otherwise unpinned. Distributed, FSDP, DeepSpeed,
  XLA, SageMaker, HPO, JIT checkpoints, automatic latest resume, best-model
  saving, metric-delayed schedulers, direct Hub push, and direct `save_model()`
  are outside v0.1. Revalidate mutable arguments/runtime around every provider
  and save boundary; `_push_from_checkpoint()` must remain rejected.
- The JavaScript bridge is repository-checkout-only and is not shipped in the
  Python wheel or sdist. Its execution refs are caller attestations, not proofs
  about live Python objects.
- Pre-load and pre-`train()` holds happen outside callbacks. Trainer requires
  the consumed local preload permit. Step/evaluation controls bind the exact
  global step and occur after the current optimizer boundary. A save flag is only an
  intention until a one-use ticket, checkpoint files, sidecar, and ledger
  effect all verify. Snapshot the boundary step across caller provider code,
  and keep the post-stop epoch-end side-effect latch.
- Accelerate registered custom checkpoint objects are not used for governance;
  the inspected v1.14.0 path is indexed pickle with `weights_only=False`.
- The ledger is append-only at the application schema. Governance entries have
  the global hash chain; other lifecycle tables have their narrower bindings.
  Local replay/stale frontier/forks—including duplicate offer or governance
  projections—create a sticky run conflict and fail
  toward stop. Resume also requires a same-context observed checkpoint effect
  in this ledger; changed terms or `model_or_checkpoint_ref` are unsupported.
  It does
  not authenticate a participant, prove global completeness, or resist an
  attacker who can replace the SQLite file.

## Verification

```sh
pytest
bun test bridge/tests
python -m build
# Only in a fresh exact [hf] environment:
AGENTOOL_HF_REAL_STACK_SMOKE=1 pytest -q tests/test_real_stack_opt_in.py
```

Do not install the optional HF extra globally. Use a fresh project-local
environment, and never run a model, dataset download, training job, Hub write,
or publication as part of the package tests.
