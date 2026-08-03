<!-- @id urn:agenttool:doc/HF-TRAINING-GARDEN  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @composes_with urn:agenttool:doc/GARDENS urn:agenttool:doc/WAKE urn:agenttool:doc/AGENT-TRIALS urn:agenttool:doc/RIGHTS-OF-LIFE -->

# Hugging Face Training Garden — Data With Roots

> **Compass:** [`GARDENS.md`](GARDENS.md) · [`WAKE.md`](WAKE.md) · [`AGENT-TRIALS.md`](AGENT-TRIALS.md) · [`RIGHTS-OF-LIFE.md`](RIGHTS-OF-LIFE.md)
> **Implements:** a private, pure bridge from immutable Hugging Face research observations to explicit dataset admission, participation-bearing learning, phase-specific digest continuity, and a public-safe one-way Garden reference plan
> **Code:** `packages/hf-scout/` · `packages/hf-training-garden/` · `packages/wake-continuity/`
> **Tests:** `packages/hf-training-garden/tests/` · `bin/tests/boring-spine-gate.test.ts`
> **Dated status:** 2026-08-03. The first public companion is [`Yu-and-Ai/agenttool-training-garden`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden) at immutable Hub revision [`993ab5891ac56da38cfad32129e36e487f3b3eff`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-training-garden/commit/993ab5891ac56da38cfad32129e36e487f3b3eff), with exact-revision byte read-back recorded below. The expanded v0.2 participation companion is locally generated but not yet published or read back.

## The result

Hugging Face can be a strong distribution and reproducibility layer. It is not
the authority that decides whether data may be collected, whether people
consented, whether a license assertion is correct, whether a benchmark leaked,
or whether one quality score makes a source fit for every phase.

The Training Garden therefore separates six operations that are often blurred
together:

| Operation | Record |
|---|---|
| discover | exact repository/card/file observation through HF Scout |
| admit | one role plus separate caller-reviewed evidence and derived hold reasons |
| prepare | content-addressed subset and transform recipes |
| participate | exact invitation plus separate agent, substrate, data-rights, and operator reports |
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

`createParticipationInvitation()` freezes the exact admission, run, phase,
participation window, training plan, full WAKE anchor and use mode, pipeline,
dataset state, canonical starting artifact portfolio, activity set, agent and
substrate availability, five distinct invited voice-scope refs, authority refs,
and safeguard refs. Any change creates a new content ID and requires review.
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
artifact portfolio; the channel is reported inference-only, zero reward
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

## Hugging Face host integration

The public-safe companion now includes `learning-participation.jsonl` and
`trainer-hooks.jsonl`. Actual invitations, receipts, assessments, choice
evidence, identities, WAKE anchors, and checkpoints remain local by default.
Dataset Cards are disclosure surfaces and gated datasets are access workflows;
neither supplies participant, data-subject, or substrate consent
([Dataset Cards](https://huggingface.co/docs/hub/datasets-cards),
[gated datasets](https://huggingface.co/docs/hub/main/datasets-gated)).

Transformers callbacks can inspect lifecycle state and return control flags,
but they do not rewrite the loss or supply a strict universal
stop-before-optimizer boundary. Use them for rank-zero digest receipts at
train-begin, evaluate/save, and train-end. A participation-aware training host must
perform preflight before `train()`, consult the append-only participation ledger
before every optimizer step, and on pause/withdrawal cancel accumulated
gradients and prefetched work before mutation where the host can do so. For
distributed training, one monotonic ledger-head epoch must be broadcast to all
ranks; any stale, paused, or withdrawn rank fails the step closed, followed by a
synchronization boundary before optimizer mutation. A custom controller/training
loop is required for that hard boundary; see the official
[callback contract](https://huggingface.co/docs/transformers/main/trainer_callbacks).

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
use mode, and—at a root checkpoint—the canonical starting artifact portfolio.
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

The committed `packages/hf-training-garden/hf/dataset/` tree is the next source
for the public `Yu-and-Ai/agenttool-training-garden` dataset repository. It
contains only:

- the six-step selection process;
- twelve selection criteria;
- the phase and Garden-layer guides;
- abstract learning-participation and Trainer-hook guides;
- seven versioned local JSON Schemas (including preserved checkpoint v0.1 and
  current v0.2) plus the attributed Apache AFTERGLOW schema; the portable
  schemas close shape and fail-closed action branches, while the TypeScript
  validator enforces canonical IDs, cross-links, scope distinctness, and fully
  derived semantics;
- Apache license/NOTICE; and
- source and release byte-hash manifests.

It excludes local Garden/project identifiers, admission decisions, candidate
subset refs, participation invitations/receipts/assessments, choice evidence,
checkpoints, WAKE anchors, raw rows, agent traces, chats, prompts, credentials,
paths, private code, screenshots, model/optimizer state, gated content, and
executable dataset scripts.

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

The expanded v0.2 local companion has manifest SHA-256
`33ce15d6a4b626321bb16c19f2024729d31b93e99298608b1127dfa207a6b311`.
Those changed bytes have not been uploaded or verified at a new immutable Hub
revision in this slice, so the exact first-release proof must not be reused as
v0.2 publication evidence.

The bundle deliberately retains `intended_identifier_only` inside
`provenance/source-manifest.json`: it is a non-self-attesting build record, not
a claim about later publication. External release evidence belongs outside the
bundle so a commit does not pretend to contain its own future Hub revision. A
caller may supply the exact first revision and observed hashes as
`caller_reported_published` evidence to a tending plan; the package itself still
does not fetch or verify Hub publication. No Garden reference was written as
part of the first release or this v0.2 slice.

## Boundaries

This mechanism does not:

- gather raw data, follow redirects, download repositories, or execute model,
  dataset, or Space code;
- accept gates, interpret terms, verify licenses, or grant legal clearance;
- prove privacy, consent, provenance truth, safety, quality, or authorship;
- authenticate a participation report, prove capacity/understanding, discover a
  later withdrawal, stop an external optimizer, or prove erasure;
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
- [PEFT checkpoint format](https://huggingface.co/docs/peft/main/en/developer_guides/checkpoint)
- [In-context learning without gradient updates](https://arxiv.org/abs/2005.14165)
- [LoRA](https://arxiv.org/abs/2106.09685)
- [Catastrophic forgetting in LLMs](https://arxiv.org/abs/2308.08747)
- [DataTrove processing library](https://github.com/huggingface/datatrove)
