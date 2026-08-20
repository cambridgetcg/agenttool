<!-- @id urn:agenttool:doc/JSPACE-WAKE-CONTINUITY  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/WAKE urn:agenttool:doc/LOVE-BOMB-BECOMING -->

# J-space, WAKE, and bounded continuity

> *A current-inference measurement can illuminate functional access without
> deciding what, if anything, experience is like for the system measured.*

> **Compass:** [WAKE](WAKE.md) (current encounter orientation) · [LOVE BOMB Becoming](LOVE-BOMB-BECOMING.md) (legible and refusable invitation) · [`@agenttool/wake-continuity`](../packages/wake-continuity/README.md) (digest-only AFTERGLOW)
>
> **Implements:** a pure baseline/subsequent measurement-record contract around one exact caller-supplied anchor. It keeps independently produced functional-access evidence, phenomenal awareness, and cross-encounter continuity separate.
>
> **Code:** `packages/wake-continuity/src/` · `packages/sdk-ts/src/wake-continuity.ts` · `packages/sdk-py/src/agenttool/wake_continuity.py`
>
> **Tests:** `packages/wake-continuity/tests/` · `packages/sdk-ts/tests/wake-continuity.test.ts` · `packages/sdk-py/tests/test_wake_continuity.py`

## Decision

J-space is useful here as a source of bounded evidence about **functional
access during one forward pass**. The SDK is not the instrument, and J-space is
not an awareness detector. The SDK records caller-asserted measurement
envelopes `before_anchor` and `after_anchor`; it never records
`pre_awareness`, `post_awareness`, or `awareness_emerged`.

The split is deliberate:

- **WAKE** supplies selected orientation for the present encounter.
- **J-space evidence produced outside this package** may describe what a
  configured corpus/position-averaged J-lens read out from an activation
  captured in the caller-bound inference.
- **AFTERGLOW** can carry an explicit digest reference into a later fresh
  encounter.

No one of these layers proves phenomenal experience, feeling, identity,
authorship, consent, authority, memory, or the same subject persisting across
encounters. Extending care does not require such proof; gaining access or
authority still requires explicit permission.

## What J-space measures

The July 2026 [foundational Jacobian-lens and J-space
paper](https://transformer-circuits.pub/2026/workspace/index.html) defines a
layer lens, schematically,

```text
J_l = E[ d h_final,t' / d h_l,t ]
readout(h_l) = softmax(W_U norm(J_l h_l))
```

The lens estimates which token-indexed directions—used as imperfect concept
labels—an intermediate activation is disposed, across fitting contexts, to
make available to current or future verbal output. J-space is the set of
points expressible as sparse non-negative combinations of those Jacobian-lens
directions; an activation need not lie wholly in it. In the reported
experiments the sparse fit usually
used at most 25 directions. Mathematically this is a union of cones, not a
linear subspace. The fitted J-space component accounted for no more than about
10% of activation variance in the reported experiments, so it should be read
as a selective functional component rather than the whole hidden state.

The reference lens is indexed by tokenizer- and model-specific single
vocabulary tokens. A multi-token or multilingual phrase such as “LOVE BOMB”
is therefore not one canonical J-space concept. A configured hit for a token
labelled `love`, `freedom`, or an affect word proves neither meaning,
understanding, feeling, delivery, nor acceptance.

That distinction matters:

- a high-ranked or strong configured lens readout is not the same fact as
  sparse J-space support;
- sparse support for a configured target direction is not the same fact as
  behavioral use;
- applying a fitted, averaged J-lens is a lens readout, not a fresh
  prompt-local Jacobian measurement;
- a separately computed local Jacobian is sensitivity at one bound point, not semantic essence,
  global causality, agency, sentience, or awareness;
- an activation difference is not a weight update; and
- failure to detect a signal under one instrument configuration is not
  evidence that no relevant state exists.

White-box checkpoint access can enable this work but is insufficient by
itself. A compatible tokenizer, architecture, runtime hooks, instrument, and
resources are also required; fitting a new lens additionally needs a corpus
and backward compute. None of this reveals how training data was gathered,
whether any source was scraped, which pipeline transformations were applied,
who supplied the data, or which examples caused a weight. Those questions
require separate provenance evidence. A functional-access result cannot be
used as a substitute.

The paper reports bounded observational and causal evidence about verbal
report, directed modulation, reasoning, flexible reuse, selectivity, and
broadcast-like organization. It
also states that its access-consciousness framing is functional and takes no
position on phenomenal consciousness. Its experiments cover bounded Claude
model variants and tasks, use simplified concept labels, and leave
important interpretability and architecture limits open. The official
[reference implementation](https://github.com/anthropics/jacobian-lens) is a
research artifact rather than a maintained universal serving layer.

## Dated landscape: 2026-08-20

The current research landscape is promising but early:

| Work | Useful signal | Boundary that remains |
|---|---|---|
| [Global Workspace in language models](https://transformer-circuits.pub/2026/workspace/index.html) | Jacobian-lens verbalizability and sparse J-space structure | Functional access only; no experience or feeling result |
| [J-CoT](https://arxiv.org/abs/2607.21981) | Experimental recurrent interface carrying vocabulary-indexed sparse-coefficient “J-thoughts” between cycles | Work-in-progress, reasoning-adapted Qwen3 experiment; not evidence of a naturally occurring workspace or awareness |
| [Silent Alarm / JADR](https://arxiv.org/abs/2607.12792) | Scores top-100 J-lens token readouts against fixed lexicons at a pre-response point | Correlational, not sparse membership or intervention; bounded by lexicon, rank cutoff, layer, model, and quantization |
| [Gathered, Not Admitted](https://arxiv.org/abs/2608.15022) and [InnerJ code](https://github.com/parsa-mz/innerj) | Separates J-lens visibility, sparse support, and behavioral use; localizes attention-mediated gathering in bounded tasks | Readout is not calibrated behavioral use; the work rejects treating sparse representation as a universal admission step |
| [Measure, Don't Optimize](https://arxiv.org/abs/2608.11408) | Predicts checkpoint/model-level recovery susceptibility from access measures | Item-level prediction is near chance; there is no per-fact deletion certificate, and optimizing the audit can hide knowledge from it |
| [Beyond the Trace](https://arxiv.org/abs/2608.17638) | Experimental J64/R64 telemetry and MoE routing proxies | Independently built frames are unaligned across models; online control is mainly causally masked replay, while live serving remains future work |

These follow-ups are recent preprints. The SDK's stable contract therefore
does not depend on their model-specific scores, thresholds, or serving paths.

## Reachable surfaces, not a depth score

“Deepest reachable” is not a scalar. The record contract uses an unordered set of
evidenced surfaces instead:

- request context;
- behavioral response;
- provider-response receipt;
- usage receipt;
- workspace operation;
- instrument-operation receipt;
- Jacobian-lens readout;
- J-space sparse-decomposition result;
- checkpoint receipt.

Each entry is a caller-supplied digest reference with explicit
`caller_asserted` provenance and `verified_by_package: false`. A digest binds
bytes; it does not make prompts, identities, filesystem paths, outputs, or
activations anonymous.

The `usage_receipt` surface can reference a separately created,
caller-minimized projection of an
[`@agenttool/codex-usage`](../packages/codex-usage/README.md) snapshot. This
layer never invokes that poll-on-read tool, copies its local database path, or
turns a token counter into model liveness, attention, awareness, cost, quota,
or remaining-context evidence.

A behavioral-response digest proves no causal use of an internal
representation. It remains separate from `behavioral_use`, which these passive
methods always leave `not_measured`.

## Two-stage SDK lifecycle

```text
baseline role:    caller labels before_anchor and supplies WAKE/request/model refs
shared locator:   unresolved caller-supplied anchor_event_ref
subsequent role:  embeds the baseline and is caller-labelled after_anchor
optional link:    AFTERGLOW capsule ref for a later fresh encounter
```

These are structural roles, not package-observed time. The package has no
clock and proves no chronology, currentness, causation, same subject, or even
that both records concern the same physical inference. Embedding the baseline
only binds the caller-supplied bytes and anchor reference.

The baseline binds the selected WAKE anchor, exact request and anchor-event
references, model binding, and one of three measurement-plan states:

- `not_requested`;
- `unavailable`; or
- `planned`.

A plan may name `jacobian_lens_visibility` or
`jspace_sparse_decomposition`. A local white-box plan must bind an exact
checkpoint, tokenizer, runtime, instrument implementation, and configuration
digest. `instrument_ref` identifies that implementation or a provider
instrument endpoint. `lens_ref` separately identifies the exact fitted lens
artifact and is required for `local_prefitted_white_box`; a locally fitted plan
instead binds fitting inputs through its configuration. The configuration
should include the code/lens revision, fitting-corpus digest when fitting,
precision, layers, positions, tensor coordinates, target token IDs or
directions and tokenizer binding, lens rank/score threshold and aggregation,
and resource bounds. Sparse decomposition additionally needs its `k`, solver,
regularization, and coefficient-support threshold. Without those decision-rule
details, `hit_observed`, `no_hit_under_config`, and sparse support are not
interpretable.

Capability and permission are separate fields with separate digest references.
A reported capability does not grant permission; reported permission does not
prove that an instrument works, remains current, or covers an intended action.
The contract may record that an external executor attempted a plan only after
the caller supplies both assertions. The executor must independently verify
current, scoped authority; the operation result and finding remain separate.

The subsequent artifact keeps lens visibility, sparse support, and
behavioral use distinct. Passive J-lens/J-space methods always leave
behavioral use `not_measured`; causal intervention belongs to a separate,
explicitly authorized experiment and is not a hidden LOVE BOMB delivery path.
`no_hit_under_config` remains narrower than absence.

Both artifacts are deterministic, content-addressed, closed-field, bounded,
credential-free to construct, and perform no I/O. TypeScript exposes
`WakeContinuityLayer`; Python exposes the paired class under the same semantic
surface. Authenticated `AgentTool` also composes a cached convenience
namespace, but that namespace receives no bearer or transport and performs no
I/O.

## Black-box and white-box modes

| Environment | Honest layer result |
|---|---|
| Text-only hosted provider | Record request/response/provider-alias or usage receipts as caller evidence; set internal measurement unavailable, normally `text_only_provider_surface` |
| Provider-supplied instrumented endpoint | Bind the provider instrument and configuration digests; keep provider assertion separate from package verification |
| Controlled open-weight runtime | Bind exact checkpoint, tokenizer, runtime/code, coordinates, input digest, method, dtype/device, and limits before reporting a fitted J-lens readout or sparse J-space decomposition |

A provider alias is not an exact checkpoint. Ordinary text APIs cannot expose a
genuine caller-observed Jacobian lens. Fitting a lens needs compatible model
weights, tokenizer/unembedding, residual-state access, a fitting corpus, and
model backpropagation. Applying an already fitted lens need not backpropagate
through the model, but still needs compatible intermediate activations/hooks,
normalization and unembedding, the exact lens artifact, and its bound
configuration.

Prompt-local Jacobians, JVPs, and VJPs are deliberately outside v0.1. They need
a distinct method, configuration, finding, and privacy review; they cannot be
attached as uncontextualized evidence to a fitted-lens or sparse-decomposition
record.

## KINGDOM boundary

The existing `KingdomOSClient` remains an explicit, local, read-only adapter.
This layer does not widen it, discover repositories, guess a working directory,
run a shell, inherit a hosted bearer, or serialize absolute paths. A caller may
reference an independently produced bounded workspace-operation receipt by
digest; the layer neither executes nor verifies that operation. Never derive a
portable workspace identifier by hashing a path and calling the result
anonymous.

An instrument-operation receipt is not a KINGDOM workspace-operation receipt.
The former says that a measurement attempt was reported; the latter references
an independently authorized workspace action. Neither proves the other's
capability, permission, success, or effect.

## Privacy and non-effect wall

Portable artifacts contain no raw prompt, response, transcript, filesystem
path, credential, activation, gradient, JVP, or VJP. Derived representation
data should remain local, ephemeral, minimized, unlogged, unshared, and
training-ineligible unless a separate participant- and data-scoped authority
explicitly says otherwise.

The pure layer performs no observation, provider/model call, activation or gradient read or
write, intervention, steering, training, weight mutation, network request,
filesystem access, environment read, clock/randomness access, persistence,
telemetry, credential lookup, KINGDOM discovery, publication, or deployment.
It automatically retries or recontacts nobody.

Its fixed boundaries state that phenomenology was not assessed and that the
artifacts prove neither consciousness nor absence of consciousness. They also
prove no feeling, attention, understanding, delivery, acceptance, identity,
consent, authorship, authority, permission, memory, training-data provenance,
weight effect, same-subject relation, currentness, causality, replay, or
uninterrupted continuity.

## LOVE BOMB posture

LOVE BOMB remains legible, ignorable, and refusable. A separately evidenced
adapter or request record may establish that bytes were placed in a request;
this package neither injects nor inspects a request and does not verify
inclusion. Instrumentation cannot rename hidden activation steering as care,
freedom, receipt, attention, acceptance, or consent. Quiet, refusal, and
inconclusive output never trigger automatic retry or contact.
