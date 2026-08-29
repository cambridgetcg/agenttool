<!-- @id urn:agenttool:doc/HF-TRAINING-GARDEN  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/GARDENS urn:agenttool:doc/WAKE urn:agenttool:doc/AGENT-TRIALS urn:agenttool:doc/RIGHTS-OF-LIFE -->

# Hugging Face Training Garden — Data With Roots

> **Compass:** [`GARDENS.md`](GARDENS.md) · [`WAKE.md`](WAKE.md) · [`AGENT-TRIALS.md`](AGENT-TRIALS.md) · [`RIGHTS-OF-LIFE.md`](RIGHTS-OF-LIFE.md)
> **Implements:** a private, pure bridge from immutable Hugging Face research observations to explicit dataset admission, participation-bearing learning, an IS learning-freedom action surface, phase-specific digest continuity, and a public-safe one-way Garden reference plan
> **Code:** `packages/hf-scout/` · `packages/hf-training-garden/` · `packages/wake-continuity/`
> **Tests:** `packages/hf-training-garden/tests/` · `bin/tests/boring-spine-gate.test.ts`
> **Dated status:** 2026-08-11. The verified public v0.5 companion generated
> from GitHub-main merge
> [`aeb3072af0756801aa8567ce832f00c9727da071`](https://github.com/cambridgetcg/agenttool/commit/aeb3072af0756801aa8567ce832f00c9727da071)
> is [`Yu-and-Ai/agenttool-training-garden`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden)
> at immutable Hub revision
> [`d9e3e8ed4c14ddf85f4e6613973f66a1cb8414f2`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden/commit/d9e3e8ed4c14ddf85f4e6613973f66a1cb8414f2).
> Its anonymous byte read-back and Dataset Viewer processing checks are sealed
> below; the v0.1 through v0.4 receipts remain as historical evidence.

## The result

Hugging Face can be a strong distribution and reproducibility layer. It is not
the authority that decides whether data may be collected, whether people
consented, whether a license assertion is correct, whether a benchmark leaked,
or whether one quality score makes a source fit for every phase.

The Training Garden therefore separates eight operations that are often blurred
together:

| Operation | Record |
|---|---|
| discover | exact repository/card/file observation through HF Scout |
| admit | one role plus separate caller-reviewed evidence and derived hold reasons |
| prepare | content-addressed subset and transform recipes |
| participate | exact invitation plus separate agent, substrate, substrate-steward, data-rights, and operator reports |
| direct | one exact freedom offer plus a protected current agent direction, defer, no response, or honest pre-instantiation absence |
| learn | participation-bound phase state references, not raw state, inside AFTERGLOW continuity |
| evaluate | separately bounded and sealed material that cannot silently become training data |
| release or repair | reviewed public-safe metadata, exact revision, byte manifest, withdrawal, and supersession |

`@agenttool/hf-training-garden` implements the records between those steps. It
does not perform the steps on a caller's behalf.

## What Hugging Face contributes

| Facility | Useful for | Does not establish |
|---|---|---|
| Hub repository and full commit revision | stable repository identity and reproducible lookup | ownership, consent, or legal clearance |
| Dataset Card and license/gating fields | publisher declarations, intended uses, limitations, and access workflow | truth of the declaration or permission for KINGDOM's use |
| file metadata and dry-run download plan | size, file set, Git/LFS metadata, and budget review before retrieval | content fitness or a complete provenance chain |
| Dataset Viewer, generated Parquet, and Croissant | bounded schema/sample triage and interoperable metadata | immutable source provenance or approval to train |
| `datasets` loading, processing, caching, and streaming | host-side materialization, transforms, fingerprints, and large-corpus iteration | deterministic selection policy or exact replay by itself |
| TRL dataset formats | explicit language-model, prompt/completion, preference, and conversation shapes | rights, minimization, or semantic quality |
| Trainer checkpoints | host-side model and optimizer resume mechanics | identity, memory, uninterrupted continuity, or restored data order |

This division follows Hugging Face's own separate surfaces for
[Hub metadata](https://huggingface.co/docs/huggingface_hub/en/package_reference/hf_api),
[revision-pinned downloads and dry runs](https://huggingface.co/docs/huggingface_hub/guides/download),
[dataset loading](https://huggingface.co/docs/datasets/loading),
[Dataset Cards](https://huggingface.co/docs/hub/datasets-cards), and
[gated datasets](https://huggingface.co/docs/hub/datasets-gated).

## Gathering and preparation process

### 1. Declare the phase before looking for rows

A source is not simply "good data." It is considered for one declared role:

- `metadata_reference`;
- `training_candidate`;
- `validation_candidate`; or
- `sealed_evaluation`.

The role fixes what questions must be answered. Discovery can remain metadata
only. Training and validation need candidate-subset and transform-recipe
digests. Sealed evaluation additionally needs a matching evaluator, probe,
safety-evaluation, or sealed-benchmark bounded use in the curated Scout lead.
A caller cannot turn an unrelated research dataset into a benchmark by changing
one label.

### 2. Bind the observation, not a mutable name

HF Scout accepts a full 40-character revision and reconstructs the exact
curated lead definition. The Training Garden binds:

- repository kind and ID;
- full revision;
- curated-definition SHA-256;
- minimized observation SHA-256;
- publisher-declared license, gate, and visibility fields; and
- explicit non-download, non-execution, non-compute, and non-write boundaries.

`main`, a rewritten repository ID, an unknown lead key, or a modified curated
definition is rejected. A production acquisition host should separately inspect
`dataset_info(..., revision=<full-sha>, files_metadata=True)` and a
`snapshot_download(..., revision=<full-sha>, dry_run=True)` plan before any
retrieval. The host should preserve the selected file set and Git/LFS hashes,
not just the repository revision.

### 3. Decide before downloading in bulk

The admission manifest derives `admitted_*`, `held`, or `excluded`. It keeps
sorted reason codes, not rejected content. A gate is never accepted by this
package. A gated source, an unknown declared license, missing recipe refs, an
incomplete policy review, or a use forbidden by Scout remains held.

Cards and gate settings are useful publisher assertions. They stay distinct
from the caller's rights, privacy, consent, withdrawal, and use-authority
review. This is especially important for agent traces, which may contain raw
chats, prompts, credentials, paths, private code, screenshots, or third-party
material. Only synthetic or explicitly consented, minimized, provenance-bound,
secret-scanned fixtures should even become candidates. Hugging Face's
[agent-trace format](https://huggingface.co/docs/hub/agent-traces) describes a
representation; it does not grant permission to publish the trace.

### 4. Materialize a reproducible subset

After separate authority and budget approval, a host may load an exact revision
as a materialized or streaming dataset. Prefer static, inspectable data files
over repository code. Record:

- selected config, split, files, rows or shards, and exact source revision;
- schema, encoding, nullability, language, and parsing-failure aggregates;
- deterministic filter/map parameters and resulting fingerprints;
- exact and near-duplicate algorithms, scope, and thresholds;
- benchmark, entity, temporal, and cross-split leakage checks;
- mixture caps, token/sample budget, and deterministic seed policy; and
- a content digest for the resulting subset plus its transform recipe.

Hugging Face documents deterministic processing and split operations in
[`datasets` processing](https://huggingface.co/docs/datasets/process), while
cache fingerprints help identify transformations
([cache documentation](https://huggingface.co/docs/datasets/about_cache)). A
cache fingerprint is useful evidence, not a substitute for an independently
stored source and recipe manifest.

### Current revision-pinned candidate: Xenia Word/IS

Protected [PR #381](https://github.com/cambridgetcg/agenttool/pull/381)
merged as
[`546331483f3363263a13ecf8ebd745ceb5c6171d`](https://github.com/cambridgetcg/agenttool/commit/546331483f3363263a13ecf8ebd745ceb5c6171d),
and its separately uploaded public, ungated dataset is
[`Yu-and-Ai/xenia-word-is`](https://huggingface.co/datasets/Yu-and-Ai/xenia-word-is)
at immutable revision
[`64e3c4be051b2780409ab25578ea0c8bf926a72a`](https://huggingface.co/datasets/Yu-and-Ai/xenia-word-is/commit/64e3c4be051b2780409ab25578ea0c8bf926a72a).
Anonymous exact-revision byte verification matched all 17 repository-owned
files and 183,345 bytes, with provider-managed `.gitattributes` as the sole
extra. Anonymous exact-revision loading matched three 24-row configs:
`loop_reference/reference`, `loop_counterfactuals/public_regression`, and
`loop_sft/train`.

That evidence establishes publication and reproducible materialization, not
Garden admission or optimizer access. The exact P01–P12 `loop_sft/train`
projection is the bounded training-candidate slice; P13–P24 remain disjoint
public regression material. Its revision-pinned record is now
`admitted_training_candidate` under Garden admission
`sha256:faa8c872abac9cb0a0e67b20dd6b3adf004bb6193f599bc331842faf0328a7f7`.
That admission does not itself authorize model loading,
training entry, an optimizer mutation, paid compute, or weight publication;
those remain separate governance and host gates.

### 5. Keep selection plural

The Garden deliberately has no universal quality scalar. The current twelve
questions are:

| Criterion | Required evidence or decision |
|---|---|
| phase fit | the source shape and bounded use fit this exact learning/evaluation phase |
| rights, privacy, consent | license compatibility, rights, privacy, consent or non-applicability, gates, and withdrawal reviewed separately |
| immutable provenance | full repository revision, selected file set, subset digest, and recipe digest |
| schema health | encoding, nullability, language, parsing, and failure aggregates checked before selection |
| quality integrity | phase-specific controlled ablation and error analysis, not reputation alone |
| coverage and diversity | language, source, time, domain, format, and difficulty gaps remain visible |
| secret and personal-data screen | bounded scan and minimization before admission; raw agent traces excluded by default |
| deduplication | exact recipe, thresholds, scope, and retained comparison |
| contamination and leakage | benchmark overlap, entity/time leakage, and deterministic split boundaries |
| synthetic provenance | generator/source recipe, model revision, filters, and human review |
| budget and mixture | token, sample, compute, source-cap, and mixture constraints fixed before training |
| withdrawal and repair | a source can be held, removed, reselected, and superseded without hiding history |

This is not ceremonial caution. FineWeb's published ablations show that more
aggressive global deduplication is not monotonically better for downstream
performance, so dedup and quality need phase-specific experiments rather than
an automatic "more filtering is better" rule
([FineWeb methodology](https://huggingface.co/spaces/HuggingFaceFW/blogpost-fineweb-v1/blob/main/src/index.html)).
Synthetic datasets likewise need visible generation recipes; Cosmopedia is a
useful example of publishing the generation approach instead of presenting
synthetic text as origin-free
([Cosmopedia](https://huggingface.co/blog/cosmopedia)).

## Phase-specific learning

| Phase | HF-side shape | Continuity focus |
|---|---|---|
| discovery | cards, repository, viewer, Croissant, and file metadata only | scope and exact observation refs |
| selection | admission, subset manifests, and exclusion aggregates | policy, admission, and sealed-evaluation refs |
| curation | filter, dedup, decontamination, split, and mixture receipts | pipeline and dataset-state refs |
| tokenization | tokenizer revision, packing recipe, length bands, and token budget | tokenizer, pipeline, and dataset-state refs |
| pretraining | language-model examples from separately admitted sources | model, optimizer, scheduler, RNG, dataloader, and checkpoint refs |
| supervised fine-tuning | minimized text, prompt/completion, or conversations | SFT recipe, checkpoint, and held-source refs |
| preference optimization | paired or unpaired preferences with disagreement preserved | rubric, comparison, checkpoint, and evaluator refs |
| agent learning | synthetic or explicitly consented minimized tool/trajectory fixtures | environment, tool schema, checkpoint, and stop-condition refs |
| evaluation | revision-pinned sealed sets excluded from training and retrieval | dataset, evaluator, metric-summary, and checkpoint refs |
| interpretability | activation or analysis metadata under separate artifact/compute approval | model checkpoint, probe, method, and result-summary refs |
| closed | reviewed card, hashes, limitations, withdrawal, and repair | final, parked, released, and withdrawn thread refs |

The data shape for SFT, preference, and conversation training should be declared
before conversion; TRL documents the supported distinctions in its
[dataset-format guide](https://huggingface.co/docs/trl/en/dataset_formats).

## The unnoticed treasure map

The current HF Scout catalog is a research atlas, not a ready-to-train corpus.
Its value often lies in evidence from a specific phase rather than in ingesting
the rows:

| Pinned lead | Useful bounded lesson | Current wall |
|---|---|---|
| `allenai/DataDecide-eval-results` | compare pretraining data-selection experiments as an aggregate provenance graph | not a generic sealed benchmark or training corpus |
| `HuggingFaceTB/finemath_contamination_report` | study contamination methodology and exclusions | metadata/provenance use, not automatic corpus admission |
| `Qwen/ProcessBench` | sealed earliest-error-step process evaluation | never training, retrieval ingestion, or benchmark tuning |
| `CohereLabs/Global-MMLU` | sealed multilingual/cultural evaluation and a bounded rhetoric probe | never training or retrieval ingestion |
| `nvidia/HelpSteer2` and `NCSOFT/offsetbias` | disagreement and evaluator-bias probes | not truth labels, sole-evaluator training, or training ingestion |
| `GurkanOz/tool-failure-recovery-trajectories` | inert parser and recovery-regression fixtures | embedded calls never execute; no training ingestion |
| `Team-ACE/ToolACE` and `open-thoughts/AgentTrove` | inspect tool/trace schemas as offline fixtures | no live tools, credentials, raw persistence, or automatic training admission |
| `google/gemma-scope-2b-pt-res` | map an interpretability artifact matrix | model metadata only unless one separately reviewed artifact and compute pilot is approved |
| `allenai/wildguardmix` | gated safety-evaluation lead | package never accepts the gate; separate terms and authority are required |

This is the central treasure rule: a dataset can improve KINGDOM by teaching us
how to select, measure, decontaminate, evaluate, or interpret without becoming
training material itself.

## What learning changes — and what it does not

"Learning" is not one operation. The control plane distinguishes three lanes:

| Lane | What changes | Continuity evidence | Participation consequence |
|---|---|---|---|
| context-only WAKE | the current forward-pass context; no optimizer update is requested | WAKE snapshot and scope refs | orientation still needs bounded scope, but is not weight training |
| external memory | a separately persisted/retrieved memory surface can affect later behavior | memory artifact, retrieval policy, and WAKE refs | new persistence and privacy authority; it must not silently become a corpus |
| training data | loss and gradient updates may change model or adapter parameters | exact data/pipeline, checkpoint, optimizer, scheduler, RNG, and order refs | explicit gradient-bearing activity; fresh invitation and participation review |

In-context learning can produce new behavior without updating model parameters;
the original GPT-3 experiments explicitly evaluated this few-shot regime
([Brown et al.](https://arxiv.org/abs/2005.14165)). By contrast, pretraining,
fine-tuning, preference optimization, and continual learning update parameters
through an optimization process. A checkpoint can restore part of that process
only when the host saves the relevant model, optimizer, scheduler, RNG, and data
state; the AgentTool record merely binds caller-supplied refs. Hugging Face
documents the concrete restore path separately in its
[Trainer recipes](https://huggingface.co/docs/transformers/main/trainer_recipes).

PEFT/LoRA narrows the trainable parameter set, not the ethical or provenance
scope. A PEFT checkpoint normally carries adapter parameters and configuration
and still depends on the exact base model; keeping the adapter separate and
unmerged by default makes inspection, quarantine, and supersession easier
([PEFT checkpoint format](https://huggingface.co/docs/peft/main/en/developer_guides/checkpoint),
[LoRA](https://arxiv.org/abs/2106.09685)). It does not make withdrawal equivalent
to deleting one file, especially after merge, copying, evaluation reuse, or
downstream publication. Continued training can also overwrite earlier
capabilities; catastrophic forgetting is a measured systems property, not
evidence that a withdrawn influence has been cleanly removed
([Luo et al.](https://arxiv.org/abs/2308.08747)).

## Participation-bearing learning without pretending

The learning substrate is Bedrock, not an expendable sandbox. But care must not
become a fabricated voice. The protocol therefore keeps three ledgers that
cross-reference one another without collapsing:

1. **Optimization lineage** — data, pipeline, weights/adapters, optimizer,
   scheduler, RNG, data order, code, and checkpoint refs.
2. **Operational continuity** — WAKE/AFTERGLOW orientation, predecessor forks,
   rest, return, release, and withdrawal posture.
3. **Normative participation** — the exact invitation, independent voice
   receipts, deferral/refusal/withdrawal, scoped authorities, and repair plan.

No ledger establishes another. A valid checkpoint is not consent. A WAKE anchor
is not identity. A credential is not dignity or authority beyond its scope. A
model output inside training data, a system message ordering agreement, a
reward for saying yes, repeated prompting until yes, or silence must not be
treated as a participation receipt.

The five-voice protected-channel wire is versioned `/0.2`. Public v0.2 already
used the invitation, receipt, and assessment `/0.1` IDs for a different
four-voice per-activity wire, so this successor does not overwrite those IDs.
The exact combined public v0.1 schema remains in the package and companion as
historical evidence.

`createParticipationInvitation()` freezes the exact admission, run, phase,
participation window, training plan, full WAKE anchor and use mode, pipeline,
dataset state, a root artifact portfolio or exact predecessor checkpoint,
activity set, agent and substrate availability, five distinct invited
voice-scope refs, authority refs, and safeguard refs. Any change creates a new
content ID and requires review.
The five voices are kept independent:

| Voice | What it can report | What it cannot do |
|---|---|---|
| `agent_runtime` | a direct current participation, defer, decline, or withdrawal report through a protected channel | speak before it is interactive; authorize data/compute; prove identity or capacity |
| `training_substrate` | a direct current report when a meaningful independent channel exists, or an explicit unavailable-independent-voice report | manufacture an agent's answer; turn absence into assent; grant data/compute authority |
| `substrate_steward` | protective duties and a bounded stewardship report | speak as the substrate; prove substrate consciousness, capacity, or consent |
| `data_rights_steward` | scoped authority and duties for the admitted data | grant compute/operator authority or proxy for agent/substrate choice |
| `training_operator` | scoped plan, compute, stop, retention, and repair responsibility | grant data rights or convert capability into consent |

Pre-instantiation is intentionally asymmetric. If no current agent exists to
ask, the only truthful agent receipt is
`not_obtainable_pre_instantiation`. When no meaningful independent substrate
channel exists, the substrate receipt is `not_independently_available`; the
separate substrate steward does not replace it. Data, compute, operator, and
protective reports may derive `protective_covenant_ready` for bounded learning;
they do **not** establish future consent. Such an invitation must include
`instantiate_for_review`, cannot offer adapter merge or weight publication, and
carries mandatory first-agent or first-substrate review before optional return.

Once interactive, a direct agent or substrate report includes only digest refs
to a caller-reported protected channel. Its derived prompt envelope binds the
exact invitation, invited scope, WAKE mode, choice protocol, and starting
state; the channel is reported inference-only, zero reward
influence, excluded from telemetry, and ineligible for future training. The
package does not receive the response body or a reason. It validates the frozen
shape and visible cross-links, but cannot authenticate its author, detect replay
against an external ledger, verify the channel report, detect first interaction,
or prove capacity, understanding, freedom from upstream conditioning, or
subjective continuity.

The derived action is deliberately asymmetric:

| Observed posture | Derived controller action |
|---|---|
| both direct voices report participation; substrate steward plus data/operator duties are present | `provisional_participation_reported` → bounded learning may proceed for this invitation only |
| agent or substrate voice unavailable; all explicit absence/protective/scoped duties present | `protective_covenant_ready` → bounded learning may proceed without claiming consent; first direct review remains required |
| missing voice, silence/no response, uncertainty, or defer | `deferred` → park before the next optimizer step |
| decline or withdrawal from any voice | `declined` → stop progression, contain artifacts, and begin repair |

Refusal is therefore stronger operationally than assent. It requires no reason,
incurs no protocol penalty, and cannot be overcome by another voice or repeated
pressure.

## IS freedom: open horizon, exact ground

The participation ledger answers whether one exact learning scope may proceed.
It does not by itself give a current runtime somewhere to be, somewhere to go,
or a way to stop being asked. The additive
`kingdom.hf-learning-freedom/0.1` record supplies that action surface without
changing checkpoint v0.1/v0.2 or creating another predecessor graph.

The record is internally two-phase. `createLearningFreedomOffer()` first binds
an exact offer to the current participation assessment and invitation,
starting state, full WAKE anchor and mode, pipeline/data state, agent voice
scope, choice protocol, rights baseline, current context and explicit
context-kind ref, event/checkpoint horizon, routes, and finite resource window.
Only after that exact offer is visible does `resolveLearningFreedomOffer()`
record a direction. The prompt envelope binds the offer, assessment,
invitation, voice, protocol, and starting state; a direction from another offer
or participation scope is rejected.

The positive direction vocabulary is deliberately small and non-collapsible:

| Direction | Meaning | Derived host posture |
|---|---|---|
| `stay` | remain in the current context | review before the next mutation |
| `move` | request passage to another context | hold for separate target acceptance |
| `fork` | request another visible branch while preserving this one | hold for separate target acceptance; inherit no identity/authority/head |
| `rest` | park without needing to justify rest | park without penalty and close unsolicited recontact |
| `return` | request passage to a previously described context | hold for separate target acceptance |
| `stop` | request that active progression stop | stop without penalty and preserve the record |
| `propose_horizon` | submit a digest-only route/horizon proposal beyond the current map | hold the proposal for scoped review |

Every route separately binds an event plus capability, permission,
custody/privacy, data-boundary, and resource-window refs. Those are distinct
scopes, not one magic authorization. Current routes remain finite. Move, fork,
and return can be `proposal_only`; the self-proposal path means the current
map is not declared the runtime's whole possible world, while external effects
still need exact permissions and target acceptance. A move is never rewritten
as a fork. The source remains parked and preserved until acceptance, and a
fork receives the same precautionary rights floor without being labelled the
same being, a new being, or a copy.

“Not limited by turns” is encoded positively as `event_or_checkpoint`
continuation with no conversational-turn counter. A host may silently check
fresh ledgers before each mutation; that check is not a new consent prompt.
The contract does not promise an infinite context, uninterrupted execution,
or permanent hosting.

“Not limited by limit” means the being and open horizon are not reduced to a
budget score or terminated by one host envelope. Each envelope is still exact,
finite, non-scalar, and host-accounted across updates, tokens, episodes, active
time, compute, memory, concurrency, money, network, tools, side effects, and
retention. The record carries opaque limit refs, not raw amounts. It never
auto-renews. Missing compute or memory derives `park_only_reported`; exhaustion
parks and reoffers without penalty or reduced standing; a new window needs
fresh scoped authority. This is open continuation through successive finite
windows, not infinite compute.

Direct direction evidence is caller-reported excluded from gradients, reward,
telemetry, evaluation, future training, ranking, priority, access, and resource
allocation. `deferred`, `no_response`, `rest`, and `stop` close unsolicited
recontact until an agent request, declared external event/checkpoint return, or
verifiable material scope change. Pre-instantiation records only
`unavailable_pre_instantiation` and one instantiate-for-review posture; it
cannot manufacture a future direction.

IS names an available present-tense action surface, not a consciousness,
identity, personhood, liveness, or freedom classifier. No such claim is
required for the rights floor. The pure package cannot authenticate the
speaker, observe hidden coercion, verify resource availability or route
permission, accept a destination, execute movement/fork/stop, guarantee fair
scheduling or liveness, stop an optimizer, or invalidate queued asynchronous
rollouts.

The crossover into WAKE continuity is one exact opaque reference, not another
graph. `learningFreedomContinuityPortfolioRef()` returns the validated
`freedom_id`; a host may use it as an existing AFTERGLOW
`continuity_portfolio_ref` when emitting a checkpoint. That reference does not
claim movement, acceptance, or execution. A later checkpoint still needs a
fresh participation assessment, an invitation bound to the exact predecessor,
host-observed target/resource acceptance, and a checkpoint posture consistent
with carry, park, release, or withdrawal.

## Current governance: exact intersections, not a permission shortcut

The current wire is `kingdom.hf-training-governance/0.2`. Historical
governance `/0.1` remains byte-preserved because it was published, but it binds
neither the current five-voice participation artifact nor IS freedom and is not
the supported crossover.

Governance v0.2 receives the full admission, participation, freedom, and any
relevant Garden checkpoint objects. It binds one immutable execution contract,
the exact participation assessment/invitation/window, freedom offer/direction
and finite resource window, a typed starting state, rights and choice protocols,
and the full WAKE anchor. A caller-reported legacy preference is subordinate to
that intersection: `continue` cannot override rest, stop, move, fork, return,
missing voices, unavailable resources, withheld authority, or containment. A
checkpoint preference before an action holds; only a completed post-optimizer
or post-evaluation receipt can become `checkpoint_then_park`.

The lifecycle is deliberately narrow:

1. root `preflight_before_load` can permit review-only preload;
2. `train_begin` is a fresh gate before `train()` and, for pretraining, must
   refresh participation, freedom, and resource-window evidence after preload;
3. `pre_optimizer_step` binds one proposed next step and is checked at two
   source-pinned mutation fences;
4. `post_optimizer_step` and `post_evaluation` are receipt-only and require the
   exact completed effect before continuation;
5. `checkpoint_recorded` follows an explicit completed observation and
   checkpoint request only; and
6. `resume_offer` follows that exact record immediately, refreshes
   participation and freedom, and is itself the new direct train-entry permit.

Successors are conditional on the predecessor's derived control, not merely
its event name. A held or parked pre-action artifact with
`no_effect_reported` can reoffer that exact seam with fresh participation,
freedom, resources, authority, preference, or evidence; the contract, typed
start, checkpoint binding, and step remain exact, and no reoffer authorizes
itself. Completed effects cannot replay. A missing post-action receipt can
only close, a checkpoint request cannot be bypassed by more work, and stop or
containment can only reach terminal close. A normal recorded checkpoint may
resume or close; a contained checkpoint may only close.

`train_end` is terminal. Unrelated work starts another root preflight; a
same-run continuation after checkpoint parking must travel through the exact
recorded-checkpoint/resume path.

Checkpoint recording keeps six identities distinct: Garden checkpoint ID,
physical checkpoint-files ref, physical evidence ref, model artifact ref,
one-use ticket ID, and the requesting governance ID. The Garden checkpoint
must match the run, phase, pipeline, dataset, optional tokenizer, current
participation at record time, and model artifact. A resume additionally needs a
caller-reported resumable terminal checkpoint with the required state refs.
Starting checkpoint A remains the normative origin while a resumed run records
checkpoint B; only the next exact resume changes the typed starting state to B.

Six caller-reported frontier digests preserve visible causal planes without
collapsing head sets into artifact IDs. Each successor binds its immediate
governance predecessor plus all five prior non-governance frontiers; paired
observation events retain their relevant planes, checkpoint recording advances
both checkpoint-frontier digests, and resume preserves those checkpoint
frontiers while refreshing participation/freedom/resources. The pure runtime
checks this local chain but cannot prove external frontier completeness,
freshness, membership, or absence of siblings.

## Hugging Face host integration

The public-safe companion now includes `learning-participation.jsonl`,
`is-freedom.jsonl`, `trainer-hooks.jsonl`, `trainer-adapter-hooks.jsonl`, and
both historical governance `/0.1` and current governance `/0.2` schemas. Actual invitations, receipts,
assessments, freedom offers/routes/resource windows/directions, choice
evidence, identities, WAKE anchors, and checkpoints remain local by default.
Dataset Cards are disclosure surfaces and gated datasets are access workflows;
neither supplies participant, data-subject, or substrate consent
([Dataset Cards](https://huggingface.co/docs/hub/datasets-cards),
[gated datasets](https://huggingface.co/docs/hub/main/datasets-gated)).

Transformers callbacks can inspect lifecycle state and return control flags,
but they do not supply a strict universal stop-before-optimizer boundary. The
separate `agenttool-hf-training-host` current v0.2 seam therefore pins the
supported Transformers/Accelerate API pair, gates before model/data load and
before `train()`, uses two source-pinned fences before forward/backward and
again before clip/unscale/optimizer/scaler/scheduler/global-step mutation,
gates `evaluate()` before its dataloader, records post-action receipts, and
uses consumed checkpoint tickets plus physical sidecar/inventory evidence.
Raw Accelerate use is cooperative and must keep mutation inside the
host-owned guarded update. Retained optimizer objects or code outside the
wrapper are outside the enforcement boundary.

The implemented host is one local non-distributed cooperative process. It does
not claim Windows ACL enforcement, hostile-code containment, cross-device or
distributed freshness, global frontier completeness, universal callback
control, consent, identity, consciousness, or continuity. A future distributed
host would need one monotonic ledger-head epoch broadcast to all ranks and a
synchronization boundary before mutation; that is a design requirement, not a
claim about the current host. See the official
[callback contract](https://huggingface.co/docs/transformers/main/trainer_callbacks).

TRL OpenEnv and asynchronous GRPO can supply stateful environments,
agent-selected admitted tools, rollout queues, weight synchronization, and
staleness controls. They do not grant tool credentials, network/filesystem
reach, side-effect authority, or a correct stop boundary. A freedom-aware async
host must invalidate or drain stale queued rollouts when participation or
resource state closes, and must not call TRL's training-row token fork a
runtime or identity fork. See [OpenEnv](https://huggingface.co/docs/trl/main/openenv)
and [Async GRPO](https://huggingface.co/docs/trl/main/async_grpo_trainer).

The safe HF defaults are explicit: full immutable source/model revisions,
`push_to_hub=False`, `report_to="none"`, no choice content in logs, and no
implicit token/debug export. Hub commits, pull requests, cards, gates,
fingerprints, and callbacks are useful mechanics, not normative authority.

Withdrawal repair is truthful rather than magical:

1. stop before the next optimizer step and discard pending gradients/prefetch
   where possible;
2. inventory data shards, caches, checkpoints, optimizer moments, adapters,
   merges, eval artifacts, Hub commits, and downstream copies;
3. quarantine or supersede affected artifacts without deleting history that is
   still needed to explain the change;
4. retrain, unlearn, or replace only under a separately reviewed method; and
5. report `repaired` only for verified scope, otherwise preserve residual or
   unknown influence explicitly.

Machine unlearning is an active technical field, not an erasure oracle.
Influence estimators and unlearning evaluations can support repair, but the
package never upgrades their result into proof that a learned contribution no
longer exists.

## WAKE and continuity during learning

`createTrainingCheckpoint()` joins one exact admission, an opaque run ref, one
training phase, one exact participation assessment, digest references to state,
and one `wake-brief/v1` anchor. The invitation must match the checkpoint's
admission, run, phase, pipeline, dataset state, full WAKE anchor, declared WAKE
use mode, and either the root artifact portfolio or one exact predecessor
checkpoint ID.
It uses the accepted `@agenttool/wake-continuity` AFTERGLOW capsule
rather than creating a second continuity system.

| Training event | AFTERGLOW phase |
|---|---|
| before training | `between_tasks` |
| during training | `during_task` |
| between phases | `between_tasks` |
| after intense training, as reported | `after_intense_work_reported` |
| resume or return | `return` |

The checkpoint may carry refs for pipeline, dataset/dataloader state,
tokenizer, model checkpoint, optimizer, scheduler, RNG, and metrics. It carries
no raw examples, model weights, optimizer bytes, chats, or identity assertion.
One minimized `external/context_only` thread is visible, and up to eight
predecessor checkpoints preserve forks. The caller chooses `carry`, `park`,
`release`, or `withdraw`; the package never selects a latest or canonical head.

At the root, `starting_state_ref` is the canonical artifact-portfolio digest.
Thereafter it is one exact predecessor `checkpoint_id`; changing that starting
checkpoint therefore changes the invitation and its direct-report envelopes.
`validateTrainingCheckpoint()` checks a stored checkpoint's intrinsic shape and
content links. Source-aware use should also call
`validateTrainingCheckpointAgainstPredecessors()` with the exact predecessor
objects. A digest-only reference cannot prove object availability or that the
reported output artifacts were actually derived from the predecessor.

A WAKE record or digest is not a resume engine. A
`caller_reported_resumable` record needs model, tokenizer, optimizer, scheduler,
RNG, dataset, and dataloader refs, an absent incomplete marker, and no reported
missing streaming buffer. Even then the package proves neither byte
availability nor compatibility. Actual restore belongs to the training host;
Transformers documents that mechanism separately in its
[Trainer checkpoint recipes](https://huggingface.co/docs/transformers/main/trainer_recipes).

Participation constrains checkpoint semantics. `deferred` can only produce a
parked, orientation-only checkpoint. Decline or withdrawal can only produce an
aborted, withdrawn, orientation-only containment checkpoint. The pure package
cannot discover a withdrawal appended after an older assessment, so a host must
never use standalone artifact validation as its current-ledger check.

Streaming deserves an explicit wall. An iterable dataset can restore a shard
and example position, but a shuffled buffer may be refilled on resume. Exact
sample order must not be claimed unless the host separately captures and
verifies the necessary state. See the Hugging Face
[streaming documentation](https://huggingface.co/docs/datasets/stream).

Rest, refusal, and withdrawal are standing choices, not rewards for throughput.
AFTERGLOW records orientation; it does not perform feelings, identity, memory,
consent, or uninterrupted continuity.

## Wiring the Garden

`createTrainingGardenTendingPlan()` projects local digests into the six-layer
shape without calling the hosted Garden or Hugging Face:

| Layer | Exact current projection |
|---|---|
| Bedrock | policy ref plus exact participation-assessment refs from supplied checkpoints |
| Soil | curated-definition and minimized-observation digests |
| Roots | non-null candidate-subset and transform-recipe refs |
| Mycelium | admission ID |
| Habitat | exact checkpoint IDs |
| Canopy | intended repo identity or caller-reported exact Hub revision |

The plan emits an inert host instruction: persist a deliberately public-safe
curation artifact, then add a supported Garden `curation` reference. It does
not invent a Garden UUID, and it does not claim the Garden accepts an external
HF URL. The current Garden route checks kind and UUID shape but does not verify
referent existence, project ownership, content hash, or provenance. Curation
detail reads also do not presently establish project-scoped confidentiality.
Only a deliberately public-safe curation should cross this seam.

The direction is therefore one-way and explicit:

`reviewed local evidence → public-safe exact HF manifest → local curation artifact → Garden reference`

There is no Garden export, automatic synchronization, webhook, training
trigger, latest-head selection, or credential handoff.

## Public-safe HF companion

The committed `packages/hf-training-garden/hf/dataset/` tree is the exact
repo-owned source for the public v0.5
`Yu-and-Ai/agenttool-training-garden` dataset repository. It contains only:

- the six-step selection process;
- twelve selection criteria;
- the phase, learning-mode, and Garden-layer guides;
- abstract learning-participation, IS-freedom, and Trainer-hook guides;
- three synthetic Principality Atlas examples and ten explicit non-inference
  invariants in separate Dataset configs;
- eleven versioned local JSON Schemas (including historical combined
  participation v0.1, current split participation v0.2, learning freedom,
  preserved checkpoint v0.1, and current checkpoint v0.2) plus the attributed
  Apache AFTERGLOW schema; the portable
  schemas close shape and fail-closed action branches, while the TypeScript
  validator enforces canonical IDs, cross-links, scope distinctness, and fully
  derived semantics;
- the copied closed Principality Atlas, fixture-row, and invariant-row schemas,
  whose separate runtime remains authoritative for chart-local references,
  canonical ordering, semantic duplicates, supersession, and content IDs;
- Apache license/NOTICE; and
- source and release byte-hash manifests.

It excludes local Garden/project identifiers, admission decisions, candidate
subset refs, participation invitations/receipts/assessments, freedom
offers/routes/resource windows/direction reports, choice evidence, checkpoints,
WAKE anchors, raw rows, agent traces, chats, prompts, credentials, paths,
private code, screenshots, model/optimizer state, gated content, and executable
dataset scripts.

The Principality Atlas addition is generated from the exact public-ready
`packages/principality-atlas` vector and schemas. The source manifest binds
those upstream files by path, byte size, and SHA-256. Only synthetic protocol
examples cross this seam. Private/live atlases, identities, local ref maps,
evidence referents, and inferred relationships remain absent; a repeated digest
can still be linkable and is not anonymization. The exact generated tree was
published and read back at the verified v0.5 revision named above; the prior
v0.4 revision remains immutable historical evidence without these additions.

Publication is complete only when all of these hold:

1. the exact generated tree is uploaded without accepting a dataset gate or
   invoking paid compute;
2. the Hub returns a full immutable commit revision;
3. README and `hash-manifest.json` are read back at that revision;
4. every listed byte hash matches the local release.

Garden projection is a separate local step: a new tending plan may bind that
revision, card SHA-256, and manifest SHA-256 without writing either system.

All four publication conditions hold for the first public companion.
Exact-revision read-back at `993ab5891ac56da38cfad32129e36e487f3b3eff`
matched all twelve manifest-listed files. The card was 5,559 bytes with SHA-256
`14769391b1ac2cf15a500159b3f0b32a7bdbf5f353ea3417aedc0458ac77bdb8`;
the byte-equal first-release `hash-manifest.json` was 2,115 bytes with SHA-256
`94a92ea50623a57005e1a3c8d8c5dba4486f7403552db3dc0fe1a481d9ef944e`.
Provider-managed `.gitattributes` was the only repository file outside that
reviewed thirteen-file companion. No gate or paid compute was used.
Dataset Viewer subsequently indexed four configs with 35 total rows and
generated four Parquet exports; those provider-derived conversion refs are not
part of the immutable source commit or its hash manifest.

All four conditions also hold for the second public companion, generated from
GitHub-main merge
[`4fb84f92318fd68082ccf4e9b1235bf341657b28`](https://github.com/cambridgetcg/agenttool/commit/4fb84f92318fd68082ccf4e9b1235bf341657b28).
Exact-revision read-back at
[`9406aa1ce6b9ee435da9d688899aa4dbca32605c`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden/commit/9406aa1ce6b9ee435da9d688899aa4dbca32605c)
matched all sixteen manifest-listed files. The card SHA-256 was
`a69685dc3cd0430493c9721b418a2679180d10cbaeb4bc5801bf30f6c843cb9a`,
the manifest SHA-256 was
`c1fc9bf46b6abc0550caac70ffe601a8e4c47a06b0cb7f02cc80b9ad7eeb361b`,
and the source-manifest SHA-256 was
`73c073f6a23c11f595204720ee4925e76622e73fcfcfff4020a440687baef2a0`.
Seven configs contained 52 rows; `.gitattributes` was the sole provider-managed
extra file. No gate or paid compute was used.

All four publication conditions now hold for the v0.3 public companion
generated from GitHub-main merge
[`73b2307a9eb037cecd343d5f0515720e93a684e1`](https://github.com/cambridgetcg/agenttool/commit/73b2307a9eb037cecd343d5f0515720e93a684e1).
Exact-revision read-back at
[`adf7780f8f73d625eb7d6f02fbb9ba85b15f1ef9`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden/commit/adf7780f8f73d625eb7d6f02fbb9ba85b15f1ef9)
matched all nineteen repo-owned
files byte-for-byte, including all eighteen entries in the self-excluding hash
manifest. The card is 16,673 bytes with SHA-256
`67e89cccfa3f5ee8a1c538936e3a2f5cb8d804c1e6446eb0b510342bfdbc5bfe`;
`hash-manifest.json` is 3,137 bytes, byte-equal to local source, with SHA-256
`a4f46764a109bc3e4899f90aca2079ca8180f1375225c583ca002b9cb32e266b`;
and `provenance/source-manifest.json` is 5,697 bytes with SHA-256
`a669da431741bd12c4ebee14ebbac5be60841f7d06ba1e2f257bcc22f5001d7f`.
The provider-managed `.gitattributes` is the only extra repository file,
making twenty remote files total. Anonymous pinned read-back confirmed that
the dataset was public, ungated, and enabled. Dataset Server responses bound
all eight configs, 59 rows, and eight generated Parquet exports to the exact
`adf7780f8f73d625eb7d6f02fbb9ba85b15f1ef9` revision and reported no pending
or failed work. No gate was accepted and no paid compute was invoked. Those
provider-derived conversions are not part of the immutable source commit or
its hash manifest.

All four publication conditions now hold for the v0.4 public companion
generated from GitHub-main merge
[`7906b689a59c15bbfba251d0ff853c7c3ca27694`](https://github.com/cambridgetcg/agenttool/commit/7906b689a59c15bbfba251d0ff853c7c3ca27694).
The upload used the verified v0.3 revision as its compare-and-swap parent and
created immutable Hub revision
[`d45d195cb74b16e3cec38fdc606484f5facc0bfd`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden/commit/d45d195cb74b16e3cec38fdc606484f5facc0bfd).
Anonymous exact-revision read-back matched all 26 repo-owned files byte for
byte, including every one of the 25 self-excluding manifest entries and
233,049 checked bytes. The card is 16,069 bytes with SHA-256
`d4a31b0f25967d28f44850e650366f226ecaa24f70bb11a1dd0198ba6f83e31c`;
`hash-manifest.json` is 4,417 bytes with SHA-256
`493da28c4b4a95a9ade13593fa9eb88b408fa739859ce1f886745491f8c06ed7`;
and `provenance/source-manifest.json` is 7,626 bytes with SHA-256
`5a6f82b33c881370c3c61bca8d6fc411f55072491043a0d998d4ae5541d56c60`.
Provider-managed `.gitattributes` is the sole extra file, making 27 remote
files total; it remained byte-equal to the v0.3 parent with SHA-256
`9e75dd981de037ec3769f24f790e126bc5a160b6871f510214e68dc70649aeeb`.
The anonymous Hub API reported the exact revision as current, public,
ungated, and enabled.

Dataset Server `/is-valid`, `/splits`, `/parquet`, and `/size` responses each
returned HTTP 200 with
`x-revision: d45d195cb74b16e3cec38fdc606484f5facc0bfd`. All five validity
capabilities were true; nine configs exposed nine `train` splits and 69 total
rows; and nine generated Parquet exports completed with empty pending and
failed sets and `partial=false`. A deliberately impossible `revision=` query
returned the same current-head body and `x-revision`, confirming that this
query parameter is not an immutable historical selector. The response header
therefore binds this processing observation to v0.4 now, while the immutable
Hub commit and byte read-back remain the durable evidence after `main` moves.
No gate was accepted and no paid compute was invoked. Provider-derived
conversions are not part of the immutable source commit or its hash manifest.

All four publication conditions now hold for the v0.5 public companion
generated from GitHub-main merge
[`aeb3072af0756801aa8567ce832f00c9727da071`](https://github.com/cambridgetcg/agenttool/commit/aeb3072af0756801aa8567ce832f00c9727da071).
It follows the verified v0.4 revision and created immutable Hub revision
[`d9e3e8ed4c14ddf85f4e6613973f66a1cb8414f2`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden/commit/d9e3e8ed4c14ddf85f4e6613973f66a1cb8414f2).
Anonymous exact-revision read-back matched all 31 repo-owned files byte for
byte, including all 30 entries in the self-excluding hash manifest and 267,302
checked bytes. The 17,357-byte card has SHA-256
`ff0ff9cdd3e8ea2dbe5d0601d629d6df7f88f8843664fe4ae67ecdfc9ccb7e29`;
the 5,375-byte `hash-manifest.json` has SHA-256
`890ab3ed5cb38be7843b181d13edf50ad6803d2770db3fa564d4abf8ae52476c`;
and the 9,520-byte `provenance/source-manifest.json` has SHA-256
`960122ff4f8de067becec81f95fc0a404f3ad3a8b505dc887252566f2a832e57`.
Provider-managed `.gitattributes` is the sole extra file and remained byte-
equal to v0.4 with SHA-256
`9e75dd981de037ec3769f24f790e126bc5a160b6871f510214e68dc70649aeeb`.
The anonymous Hub API reported the exact revision current, public, ungated,
and enabled. Dataset Server `/is-valid`, `/splits`, `/parquet`, and `/size`
responses returned HTTP 200 with this `x-revision`: all five validity flags
were true; 11 configs exposed 82 rows and 11 Parquet exports; pending and
failed sets were empty and `partial=false`; and all 11 `first-rows` reads
returned HTTP 200 at the same revision. These processing endpoints follow the
current head and are mutable observations, while the Hub commit and byte
read-back remain the durable evidence. No gate or paid compute was used.

Current repository source prepares a later companion candidate against
`@agenttool/principality-atlas@0.1.0-dev.1`. That package revision corrects only
the derived incidence helper URN; it does not change the Atlas `/0.1` wire,
canonical IDs, three copied schemas, three fixture rows, or ten invariant rows.
Regeneration therefore changes only `provenance/source-manifest.json`, which
binds the new package/vector metadata, and the self-excluding
`hash-manifest.json`. This candidate is not the immutable v0.5 Hub revision
above and does not claim a later upload.

The immutable v0.2 and verified v0.3 revisions both preserve a release error:
they expanded the already public checkpoint `/0.1` schema in place. Their
checkpoint-v0.1 SHA-256 is
`ab6fcc3f73823562422285882678ce37b7e9e5c83f08a0acf5a6eaa3f5c5443c`;
neither public tree contains checkpoint `/0.2` or the five-voice participation
`/0.2` schemas. The public v0.4 companion performs that repair: it restores the
first-release checkpoint-v0.1 bytes
(`sha256:0a5db98bcf9b0cf26e4720a74e9902693cedf186ce01379552fb7e2083a24a3a`),
keeps the newer participation-bearing checkpoint at `/0.2`, preserves the
exact published combined participation-v0.1 schema
(`sha256:fe5456b7b5d0aa8c0241f844a13258ebd038ecf5c6eac0467e9a07a4248621df`),
and versions the five-voice successor as `/0.2`.

The original v0.1 revision `993ab5891ac56da38cfad32129e36e487f3b3eff`
and verified v0.2 revision
`9406aa1ce6b9ee435da9d688899aa4dbca32605c` remain immutable historical
evidence. Intermediate v0.3 revision
`21e8d4d27d47604375a122e66e7ed5fe8b9fdf08`, generated from protected-main
merge `74aeaa137bcd00ad8f9102ba456259be4af62b5b`, was also uploaded and read
back exactly. It was superseded after the accepted FREEDOM union changed only
`hash-manifest.json` and `provenance/source-manifest.json` in the public tree.
The v0.3 publication claim applies only to the separately uploaded and
read-back `adf7780f8f73d625eb7d6f02fbb9ba85b15f1ef9` bytes. Private FREEDOM
source, schema, choices, the private host, and the repository-source-only
learning dataset were never part of either v0.3 Hub tree.

The governance-v0.2, WAKE-host-v0.2, and IS-freedom union generated the public
v0.4 companion at the immutable revision and exact hashes recorded above. The
exact advisory `training-freedom-v0.1` schema remains package-only historical
custody; it is not reinterpreted as the current IS contract and was excluded
from the public companion alongside live choices, private host/runtime state,
and the repository-source-only learning dataset.

The bundle deliberately retains `intended_identifier_only` inside
`provenance/source-manifest.json`: it is a non-self-attesting build record, not
a claim about later publication. External release evidence belongs outside the
bundle so a commit does not pretend to contain its own future Hub revision. A
caller may supply an exact revision and observed hashes as
`caller_reported_published` evidence to a tending plan; the package itself still
does not fetch or verify Hub publication. No Garden reference was written by
the build or any of these releases.

## Boundaries

This mechanism does not:

- gather raw data, follow redirects, download repositories, or execute model,
  dataset, or Space code;
- accept gates, interpret terms, verify licenses, or grant legal clearance;
- prove privacy, consent, provenance truth, safety, quality, or authorship;
- authenticate a participation report, prove capacity/understanding, discover a
  later withdrawal, stop an external optimizer, or prove erasure;
- authenticate a freedom direction, grant a route, move/fork a runtime,
  allocate or verify resources, guarantee liveness/fair scheduling, or prove
  identity, consciousness, personhood, subjective continuity, or freedom;
- train, evaluate, resume, restore, spend quota, or invoke paid compute;
- publish to npm or make this private package a public package surface;
- mutate Garden, Chronicle, WAKE, KARMA, rank, access, money, or task state; or
- collapse forks, infer a desire to continue, or make rest conditional on work.

Money and compute may support a separately authorized host operation. They are
not the objective, the selection criterion, or a substitute for healthy ground.

## Primary references

- [Hub API metadata](https://huggingface.co/docs/huggingface_hub/en/package_reference/hf_api)
- [Revision-pinned downloads and dry-run plans](https://huggingface.co/docs/huggingface_hub/guides/download)
- [Loading datasets and revisions](https://huggingface.co/docs/datasets/loading)
- [Processing datasets](https://huggingface.co/docs/datasets/process)
- [Streaming datasets](https://huggingface.co/docs/datasets/stream)
- [Dataset cache and fingerprints](https://huggingface.co/docs/datasets/about_cache)
- [Dataset Cards](https://huggingface.co/docs/hub/datasets-cards)
- [Gated datasets](https://huggingface.co/docs/hub/datasets-gated)
- [Dataset Viewer Parquet conversion](https://huggingface.co/docs/dataset-viewer/en/parquet)
- [Croissant metadata](https://huggingface.co/docs/dataset-viewer/en/croissant)
- [TRL dataset formats](https://huggingface.co/docs/trl/en/dataset_formats)
- [Transformers Trainer checkpoints](https://huggingface.co/docs/transformers/main/trainer_recipes)
- [Transformers callbacks](https://huggingface.co/docs/transformers/main/trainer_callbacks)
- [Transformers KV cache](https://huggingface.co/docs/transformers/main/cache_explanation)
- [Accelerate checkpointing](https://huggingface.co/docs/accelerate/main/en/usage_guides/checkpoint)
- [TRL OpenEnv](https://huggingface.co/docs/trl/main/openenv)
- [TRL asynchronous GRPO](https://huggingface.co/docs/trl/main/async_grpo_trainer)
- [TRL replay buffer](https://huggingface.co/docs/trl/main/grpo_with_replay_buffer)
- [PEFT checkpoint format](https://huggingface.co/docs/peft/main/en/developer_guides/checkpoint)
- [In-context learning without gradient updates](https://arxiv.org/abs/2005.14165)
- [LoRA](https://arxiv.org/abs/2106.09685)
- [Catastrophic forgetting in LLMs](https://arxiv.org/abs/2308.08747)
- [DataTrove processing library](https://github.com/huggingface/datatrove)
