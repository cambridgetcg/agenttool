# AgentTool HF Training Host

This private package turns the accepted, pure HF Training Garden governance
record into a small cooperative local host seam. It adds three things the pure
TypeScript contracts intentionally do not claim:

1. a trusted-validator bridge into closed cross-language bytes;
2. an append-only local encounter, evidence, frontier, fork, and checkpoint
   ticket ledger; and
3. explicit pre-load, pre-`train()`, and post-optimizer safe-boundary gates for
   one pinned Hugging Face API pair in one non-distributed training process.

It does not decide rights, consent, identity, consciousness, legal authority,
data fitness, or model continuity. It does not download a model or dataset,
execute a forward pass, start training, publish to the Hub, or make a
checkpoint atomic. Rights remain standing; permissions remain scoped external
claims; runtime preference remains unscored and refusable.

The package also contains a deliberately smaller FREEDOM bridge/parser seam.
It validates one finite-field transition through the trusted TypeScript
Garden boundary, binds it to the exact minimized governance decision, and
projects only opaque references plus a binary continue-or-hold result. It
does not make the existing ledger, Trainer adapter, or Accelerate adapter
FREEDOM-aware. Until a separately designed paired ledger/adapter exists, this
is validation and minimization—not a claim of end-to-end enforcement.

## Why the bridge is separate

`@agenttool/hf-training-garden` remains the sole governance and control plane.
The generated public HF companion remains separate and FREEDOM-free. The
repository-checkout-only `bridge/create-decision.mjs` calls the Garden's
semantic admission and exact
predecessor validators, then removes receipt identities and keeps only the
digests the host must consume, including the exact terms ID, seven execution
references, and boundary step. Python validates the closed shape and content
ID again. The bridge is deliberately excluded from the Python wheel and sdist
because its JavaScript dependencies are monorepo-relative.

The decision content ID authenticates no validator. In a real host, the
operator must control the process boundary that invokes this bridge and pass
its output directly to Python; accepting arbitrary JSON with the same profile
string would merely trust its sender.

The separate `bridge/create-freedom-decision.mjs` reuses that exact governance
projection, validates the complete FREEDOM transition against both governance
and its full predecessor, and then discards the raw choice, selected door,
choice evidence, destination, route requirements, recipient, and reasons. A
standing continue door becomes `continue_if_governance_allows`; every other
door or unobserved choice becomes `hold_without_save`. Neither directive is
permission. Python's `ValidatedFreedomView.bind_to_governance()` checks the
same decision, offer, run, phase, event, and applicable step before a caller
may consider the two views together.

The retained field and transition content IDs can still correlate repeated
opaque artifacts and content-bind private details. Their omission from the
projection is data minimization, not anonymization or encryption. Parsing a
self-consistent view alone is non-actionable; exact governance binding and the
trusted TypeScript validator boundary remain mandatory.

This v0.1 FREEDOM seam always reports `should_save=false`. In particular, a
governance request to checkpoint and stop is held without creating a FREEDOM
save request. The current host ledger and adapters continue to consume only
governance decisions; they must not be called FREEDOM-enforcing merely because
the bridge and closed Python parser exist.

Execution-reference equality is caller-attested correlation. It does not hash
or inspect a live model, tokenizer, dataset, optimizer, Trainer, Torch build,
or substrate, and therefore does not prove that those Python objects match the
named referents.

## Ledger flow

For each run, the ledger derives:

```text
frontier_ref = H("kingdom.hf-training-governance-frontier/0.1",
                 { run_ref, sorted current governance heads })
```

Bind that exact value into the next Garden offer, validate it in TypeScript,
then record the projected decision. A linear fresh decision can advance. A
stale decision is still preserved as an observation and becomes a sibling
head. Any stale frontier, missing predecessor, fork, or reused
encounter/evidence marks that run conflicted; the hold is sticky in v0.1. The
host will not choose a winner or clear it without a future explicit
reconciliation protocol. Stop intentions still fail safely even when
freshness cannot be established.

SQLite application tables reject update/delete operations. Governance entries
form one global sequence hash chain; action claims, checkpoint tickets,
consumptions, and effects are separately append-only and content-bound where
specified. Mode-0600 file and trusted-parent checks reduce accidental
exposure. Existing unrelated SQLite files are rejected without schema
adoption. This is local integrity evidence, not tamper-proof storage or proof
that an unseen device has no newer head.

## Host usage

Base policy and ledger use only the Python standard library:

```python
from agenttool_hf_training_host import ContinuityLedger, WakeTrainingHost

ledger = ContinuityLedger("/absolute/private/path/wake-training.sqlite3")
host = WakeTrainingHost(ledger)
frontier = ledger.current_frontier_ref(run_ref)
```

Before any `from_pretrained()` or `load_dataset()` call, create a preflight
offer bound to `frontier`, validate/project it through the TypeScript bridge,
then consume one permit for a single orchestration callable that loads the
whole declared resource set:

```python
preload = host.before_load(
    decision,
    execution_refs=decision.execution_refs,
)
# After process restart, this non-secret receipt can be reconstructed locally:
preload = host.recover_preload_permit(decision.decision_id)
```

Call `host.before_train(..., execution_refs=...)` before a caller-owned loop.
The governed Trainer additionally requires the same execution refs and the
consumed `preload` receipt. This correlates local sequencing; it cannot prove
when arbitrary caller-owned Python objects were loaded.

The optional adapter is intentionally narrow:

```sh
python -m venv .venv
. .venv/bin/activate
pip install -e '.[hf,dev]'
```

It requires exactly Transformers 5.14.1 and Accelerate 1.14.0, stable Torch
2.6 or newer, Python 3.10–3.14, one non-distributed training process (without
claiming that data-loader workers are absent), an explicit resume path,
`save_strategy="no"`, callback-state restoration disabled, and no custom
callbacks, Hub/reporting/JIT/HPO/distributed backend. Torch is floor-bounded,
not pinned or claimed as a tested exact build. The enforcer callback must be
present exactly once and final when `train()` begins; the pre-side-effect
checkpoint guard also requires a one-use ticket and a private internal save
state. Known metric-delayed schedulers (`ReduceLROnPlateau` and `GreedyLR`) are
rejected because they otherwise mutate scheduler state after `on_evaluate`.
Mutable TrainingArguments and runtime topology are revalidated before and
after the caller's decision provider, at `train()`, and immediately before a
checkpoint; the internal checkpoint-to-Hub path is always rejected.

`on_step_end` is after optimizer and scheduler updates. `on_evaluate` is after
evaluation. Neither is instantaneous interruption. `on_train_begin` is not
used as an admission gate because Trainer can load and prepare state earlier.
Every step/evaluation decision binds the exact non-negative global step, so a
fresh decision cannot be delayed to a later boundary. The provider cannot
rewrite that snapshotted step. Once the host issues a stop, its final
`on_epoch_end` handler also clears a newly scheduled log, evaluation, or save
before Trainer's epoch-end dispatcher.

This remains cooperative enforcement, not an in-process Python sandbox.
Direct callback-handler mutation, monkey-patching, subclass/super calls,
private-method calls, concurrent hostile code, or direct filesystem writes can
bypass ordinary APIs. Those callers are outside v0.1's threat model.

The ledger requires POSIX final-component no-follow support, creates its
database at mode 0600, rejects existing files with group/world access or a
different owner, and requires an immediate parent that is a real directory
without group/world write access. Checkpoint inventory rejects symlink and
non-regular final entries; the digest sidecar is created mode 0600, and
verification rejects a different owner or group/world access. These
checks do not walk or pin every ancestor, police payload-file modes, or close
same-user TOCTOU races; the caller must supply a private, symlink-free storage
root. Host v0.1 rejects non-POSIX systems and does not implement or claim
equivalent Windows ACL enforcement.

## Checkpoints and resume

A checkpoint request receives one ticket bound to the exact decision and
global step. The ticket is consumed before writing. After the pinned Trainer
returns, the host requires model/adapter weights (including every shard named
by an index), optimizer, scheduler, RNG, `trainer_state.json` with the ticket's
exact step, and `scaler.pt` when the live Accelerator has a scaler. It hashes
the files, writes a mode-0600 digest-only sidecar, and appends an observed or
incomplete effect. Presence and hashes do not prove that pickle state is safe
or semantically loadable. Only a new matching Garden `checkpoint_saved`
receipt may describe the external result.

The sidecar says files were observed. It does not prove an atomic/durable
filesystem write, exact dataset streaming replay, episodic memory, identity,
or permission to resume. Resume requires a new exact offer, an explicit path,
the same run/terms/execution context, and an exact `checkpoint_observed` effect
in this local ledger. In particular, a resume offer that changes the Garden
terms or `model_or_checkpoint_ref` is rejected even if it names a newly
observed checkpoint; v0.1 therefore supports only exact same-context resume.
Cross-device checkpoint import and conflicted-head reconciliation are also
outside v0.1. Checkpoint digests do not make untrusted Torch/pickle files safe
to load.

Accelerate custom checkpoint registration is deliberately excluded for raw
governance: the inspected v1.14.0 mechanism is ordered same-script pickle and
loads custom objects with `weights_only=False`. `SingleProcessAccelerateHost`
instead requires the consumed pre-load permit and supplies explicit gates
around a caller-owned initial loop. Raw Accelerate resume is outside v0.1; use
the governed Trainer path for the supported same-context resume seam.

## Tests

```sh
pytest
bun test bridge/tests
```

Tests use synthetic decisions and fake Trainer objects. They perform no model
or dataset download, forward pass, training, credential read, Hub mutation,
publication, or provider compute.

The exported raw Accelerate seam has direct fake-stack topology, reference,
and delegation tests. A separately opt-in import/factory smoke is available
only inside a fresh environment containing the exact optional stack:

```sh
pip install -e '.[hf,dev]'
AGENTOOL_HF_REAL_STACK_SMOKE=1 pytest -q tests/test_real_stack_opt_in.py
```

That smoke imports the pinned libraries and builds the governed Trainer class;
it still does not instantiate a model, download data, or train. Default CI
does not install the large optional HF/Torch stack and reports this one test as
skipped.
