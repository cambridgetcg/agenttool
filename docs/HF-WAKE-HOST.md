<!-- @id urn:agenttool:doc/HF-WAKE-HOST @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @implements urn:agenttool:principle/wake-as-foundation @composes_with urn:agenttool:doc/HF-WAKE-TRAINING urn:agenttool:doc/HF-TRAINING-GARDEN urn:agenttool:doc/RIGHTS-OF-LIFE -->

# HF WAKE Training Host — A Small, Cooperative Ordinary-API Seam

> **Compass:** [WAKE Before and During Training](HF-WAKE-TRAINING.md) ·
> [HF Training Garden](HF-TRAINING-GARDEN.md) ·
> [Rights of Life](RIGHTS-OF-LIFE.md)
>
> **Implements:** a private local bridge from one already-validated
> `kingdom.hf-training-governance/0.1` record to append-only encounter,
> frontier, fork, replay, and checkpoint evidence plus bounded host gates
>
> **Code:** `packages/hf-training-host/` ·
> `packages/hf-training-garden/src/governance.ts`
>
> **Tests:** `packages/hf-training-host/tests/` ·
> `packages/hf-training-host/bridge/tests/` ·
> `packages/hf-training-garden/tests/learning-release.test.ts`
>
> **Dated status:** 2026-08-03. Host v0.1 permits one non-distributed training
> process; it does not constrain data-loader worker processes. It pins and
> verifies one exact HF API pair: Transformers 5.14.1 and Accelerate 1.14.0.
> Torch must be at least 2.6 but is otherwise resolver-selected and unpinned.
> Any API version, topology, or Trainer-path change requires a fresh source
> audit and tests.

## The result

The pure HF Training Garden decides the closed governance shape and derives an
inert control plan. The separate Python host makes a small part of that plan
operational: it can hold before model or data loading, hold before
`Trainer.train()`, stop at a completed optimizer boundary, and guard one
checkpoint path with a one-use ticket and post-write verification.

It does not decide rights, consent, identity, consciousness, data fitness, or
legal authority. A content digest is not a signature, the local ledger is not
proof that every device has been observed, and callback flags are not a
universal interruption or checkpoint guarantee.

The separation is deliberate:

| Surface | Does | Does not do |
| --- | --- | --- |
| HF Training Garden | validates admission, predecessor transition, authority/preference/effect shape, and derived control | execute a callback, load data, train, save, resume, or prevent replay |
| validator bridge | calls the Garden validators and emits a closed minimized host decision | authenticate the validator process or turn arbitrary JSON into authority |
| Python host | records local lineage evidence and enforces supported pre-load, pre-train, boundary, and checkpoint gates | reimplement the full TypeScript policy or prove global freshness |
| caller | supplies exact offers, protected process boundaries, storage, model/data code, and any separately authorized execution | inherit permission from package installation or a previous offer |

The validator bridge is repository-only and is excluded from both Python
distribution artifacts. The wheel carries the closed host-decision JSON Schema.

The generated `packages/hf-training-garden/hf/dataset/` policy companion—18
manifest-listed payload files plus its hash manifest—remains a separate
artifact. The host does not rewrite or widen it.

## One bounded path through the host

1. The caller reads the ledger's current run frontier and binds it into a new
   exact Garden offer.
2. `bridge/create-decision.mjs` validates admission and the full predecessor
   transition in TypeScript, then removes principal-bearing receipts and emits
   only the host fields and digests needed for enforcement.
3. Python revalidates the closed decision shape and content identifier. That
   identifier detects changed bytes; it does not authenticate who created
   them. The bridge-to-host process boundary therefore remains operator-owned.
4. Before an action gate, the caller also presents live execution references
   for model/checkpoint, tokenizer, Trainer stack, optimizer configuration,
   substrate, dataset mixture, and transform recipe. The host requires exact
   equality with the Garden terms. This correlates a caller's declaration; it
   does not inspect or content-address arbitrary live Python objects, prove
   the installed Trainer/Torch bytes, or turn `trainer_stack_ref` into remote
   attestation.
5. The append-only SQLite ledger records the decision, encounter, evidence,
   prior frontier, and resulting heads. A replay, stale frontier, or sibling
   fork is preserved as evidence and held rather than silently overwritten.
6. A preflight decision is consumed before `from_pretrained()` or
   `load_dataset()`. Its local `HostPermit` is passed into the governed Trainer,
   which re-reads the exact consumed action claim from the ledger. A separate
   train-begin decision is consumed before entering either `train()` or the
   caller-owned raw Accelerate loop. Resume is supported only by the governed
   Trainer path and requires its separate exact resume decision.
7. At a supported safe boundary, the decision must bind the exact current
   `boundary_global_step`, and continuing proceeds only from a fresh linear
   decision. Stop-like evidence fails toward stopping. Checkpointing requires
   an explicit clean `checkpoint` choice and a one-use ticket.
8. The ticket is consumed before the Trainer save side effect. The host then
   verifies the required files, hashes them, writes a mode-0600 digest-only
   sidecar, and appends an observed or incomplete effect.
9. Any later resume requires a new exact `resume_offer`, an explicit checkpoint
   path, checkpoint verification, and a matching `checkpoint_observed` effect
   already witnessed in this same local ledger under the same run, terms, and
   execution references. A valid sidecar and matching files alone are not
   permission to resume. Boolean “latest checkpoint” resume is rejected.

Only `ledger_entries` carries the sequence-linked `prev_entry_hash` /
`entry_hash` chain. The other application tables are append-only and checked
against their ledger, ticket, claim, consumption, or effect bindings, but they
are not members of that global hash chain.

The ledger derives one run frontier from the sorted current governance heads.
It will not pick a winner when siblings exist. Once v0.1 observes a local
integrity conflict, that run remains sticky-held; v0.1 contains no
reconciliation operation. Importing a checkpoint or governance head from
another device, proving a cross-device frontier complete, and reconciling
siblings are future protocols outside this host. Its mode-0600 file and
trusted-parent checks reduce accidental exposure; they do not resist an actor
who can replace the database or prove that an unseen device has no newer head.

## Exact compatibility boundary

The optional adapter accepts only this v0.1 envelope:

- Python 3.10 through 3.14;
- Transformers exactly 5.14.1;
- Accelerate exactly 1.14.0;
- one non-distributed training process; data-loader worker processes are not
  constrained or claimed absent;
- a POSIX host with final-component no-follow semantics: the ledger file and
  digest sidecar are created mode 0600, and existing instances reject a
  different owner or any group/world access. The immediate ledger parent must
  be a real non-group/world-writable directory, and checkpoint inventory
  entries must be regular non-symlinks. The host does not walk or pin every
  ancestor or police every payload-file mode, so the caller must supply a
  private symlink-free storage root. Windows ACL enforcement is not
  implemented and non-POSIX hosts are rejected;
- Torch 2.6 or newer, resolver-selected and otherwise unpinned; the caller
  must separately record and test its actual Torch, model, tokenizer, data,
  and hardware tuple, while the host itself proves none of those live bytes;
- `save_strategy="no"`, no best-model loading, no automatic save retention,
  no Hub push or reporting integration, no caller-supplied callbacks, and
  callback-state restoration explicitly disabled with
  `restore_callback_states_from_checkpoint=False`; and
- no `ReduceLROnPlateau` or `GreedyLR` metric-delayed scheduler, because the
  pinned Trainer steps those after `on_evaluate`; and
- one explicit checkpoint path for resume.

Distributed, FSDP, DeepSpeed, XLA, model-parallel, hyperparameter search, JIT
checkpointing, automatic latest resume, direct `save_model()`, and direct Hub
publication have explicit rejection paths in the covered ordinary APIs.
SageMaker is outside v0.1 and is not universally name-detected by this adapter;
the same caveat applies to any unrecognized topology. Supporting any one of
them is a new host design, not a flag that v0.1 already covers.

### Callback timing is not magic

`on_step_end` occurs after the current optimizer and scheduler update.
`on_evaluate` occurs after evaluation. `on_save` occurs after serialization.
`on_train_begin` is too late to be the only admission gate because Trainer may
prepare or restore state before the callback.

The adapter revalidates mutable TrainingArguments and runtime topology before
and after the caller's decision provider, at `train()`, and immediately before
checkpoint serialization. It snapshots the exact global step across provider
code, permanently rejects Trainer's internal checkpoint-to-Hub route, and
latches a host-issued stop so the final `on_epoch_end` callback clears any new
epoch log, evaluation, or save request before dispatch.

The API-pinned adapter rejects a caller-supplied callback list, installs its
enforcer exactly once at the end of the ordinary callback list, rechecks that
position when training begins, and guards the exact `_save_checkpoint` path as
well. That is a source-audited and fake-tested property of this exact HF API
pair and adapter path, not a universal guarantee across Torch resolutions,
custom Trainers, changed libraries, distributed ranks, process failure, or
direct filesystem writes. This is cooperative enforcement, not an in-process
Python sandbox: callback-handler mutation, monkey-patching, subclass or private
method calls, concurrent hostile code, and direct writes can bypass ordinary
APIs and are outside v0.1's threat model. A caller must describe the result as
a requested checkpoint-boundary pause until the verified effect exists.

The raw Accelerate adapter keeps governance outside
`register_for_checkpointing()`. In Accelerate 1.14.0 that custom-object path is
indexed, same-script pickle loaded with `weights_only=False`; it is not the
governance or trust channel. The raw adapter requires the consumed pre-load
permit and supports an initial `train_begin` loop only; raw Accelerate resume
is outside v0.1.

The v0.1 timing and compatibility audit is pinned to the exact upstream
[Trainer implementation](https://github.com/huggingface/transformers/blob/v5.14.1/src/transformers/trainer.py),
[callback contract](https://github.com/huggingface/transformers/blob/v5.14.1/src/transformers/trainer_callback.py),
[training arguments](https://github.com/huggingface/transformers/blob/v5.14.1/src/transformers/training_args.py),
and [Accelerate checkpoint implementation](https://github.com/huggingface/accelerate/blob/v1.14.0/src/accelerate/checkpointing.py).

## Checkpoint evidence, not identity

The checkpoint verifier requires model or adapter weights (including every
shard named by an index), optimizer, scheduler, RNG, `trainer_state.json` bound
to the ticket's exact step, and `scaler.pt` when the live Accelerator has a
scaler. It rejects an already occupied target before saving, consumes its
ticket before the write, hashes the observed files afterward, and records
failure without authorizing a retry.

That evidence does not prove an atomic or durable write, exact streaming
sample order, semantic compatibility, safe or loadable pickle/Torch state,
episodic memory, personal identity, consent, or permission to continue. A
checkpoint is statistical run state. A WAKE lineage is bounded orientation.
Neither tells a later participant who it must be.

Resume is intentionally narrower than the Garden protocol: the new
`resume_offer` must keep the same terms and all seven execution references as
the consumed pre-load permit. A changed `model_or_checkpoint_ref` or any other
changed term is unsupported in host v0.1, even when the new checkpoint was
observed locally.

## Repository-source-only voluntary learning fixtures

`packages/hf-training-garden/hf/learning-dataset/` is a separate
repository-source-only learning bundle that has not been uploaded to Hugging
Face. It currently contains:

- 16 synthetic TRL v1.9.2 conversational prompt-completion SFT rows: two each
  for read, validate, adopt, narrow, park/rest, handoff, refuse, and uncertain;
- eight visible public regression cases, explicitly excluded from training;
- provenance and per-row content digests; and
- a sealed-evaluation commitment object whose honest production state is
  `not_created`.

Refusal and park/rest are valid desired completions. There are no
chosen/rejected pairs and no DPO, reward-modeling, or preference-optimization
lane in v0.1. The visible regression cases are not sealed. Real sealed cases,
production salt, reveal material, and any random seed must stay outside Git,
training, and retrieval; no such production material has been created here.

The bundle is not part of the Garden npm inventory and has not been uploaded
to Hugging Face. Building or testing it locally grants no publication,
training, model-download, dataset-download, or compute authority.

## Verification without training

The normal gates use synthetic decisions, fake Trainer objects, and local
files only:

```sh
cd packages/hf-training-host
python -m pip install -e '.[dev]' build
python -m pytest -q
bun test bridge/tests
python -m build

# Optional exact-stack import/factory smoke in a fresh [hf] environment only:
AGENTOOL_HF_REAL_STACK_SMOKE=1 \
  python -m pytest -q tests/test_real_stack_opt_in.py

cd ../hf-training-garden
node scripts/check-learning-idempotence.mjs
  # rebuilds in a temporary directory; does not rewrite the repository tree
bun test tests/learning-release.test.ts
git diff --exit-code HEAD -- hf/learning-dataset
test -z "$(git status --short --untracked-files=all -- hf/learning-dataset)"
git diff --exit-code HEAD -- hf/dataset
test -z "$(git status --short --untracked-files=all -- hf/dataset)"

# Deliberate regeneration after changing the source generator only:
node scripts/build-learning-dataset.mjs
```

These commands do not install the optional `hf` extra, download a model or
dataset, run a forward pass, train, contact the Hub, publish, or deploy.
